import { ArrowDown, ArrowUp, Copy, Download, Layers, Palette as PaletteIcon, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CATALOG_BY_ID, type ObjectId } from '../shared/catalog';
import { convertSceneSize, defaultTint, layoutScene, sceneRequests } from '../shared/layout';
import { matchObjects } from '../shared/matcher';
import { DEFAULT_SCHEME, SCHEMES } from '../shared/palette';
import { sceneToSvg } from '../shared/render';
import type { Format, LibraryData, ObjectRequest, Palette, Scene, SceneItem, Size } from '../shared/types';
import { interpretPhrase } from './api';
import { ObjectPicker } from './components/ObjectPicker';
import { PaletteDialog } from './components/PaletteDialog';
import { SceneView } from './components/SceneView';
import { libraryIfReady, loadLibrary } from './library';

const DEMO_PHRASE = 'Кошелёк, монета';
const PLACEHOLDER = 'Например, «копим на отпуск»';

/** What the S/L switch does (both are the client's library, S is the simplified set for small sizes). */
const SIZE_HINT: Record<Size, string> = {
  S: 'Упрощённые объекты для маленьких размеров',
  L: 'Подробные объекты для крупных размеров',
};
const SIZE_HINT_ALL = 'S — упрощённые объекты для маленьких размеров, L — подробные для крупных';

const FORMATS: { id: Format; label: string }[] = [
  { id: 'square', label: 'Квадрат' },
  { id: 'horizontal', label: 'Горизонтальный' },
  { id: 'vertical', label: 'Вертикальный' },
];

function useMedia(query: string): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

let uidCounter = 0;
const newUid = () => `u${++uidCounter}`;

function relabel(scene: Scene): Scene {
  return { ...scene, items: scene.items.map((it) => ({ ...it, uid: newUid() })) };
}

function Wordmark({ onClick }: { onClick?: () => void }) {
  return (
    <a
      className="wordmark"
      href="/"
      onClick={(e) => {
        if (onClick) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      Складно
    </a>
  );
}

export default function App() {
  const [phase, setPhase] = useState<'home' | 'editor'>('home');
  const [input, setInput] = useState('');
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [size, setSize] = useState<Size>('L');
  const [format, setFormat] = useState<Format>('horizontal');
  const [schemeId, setSchemeId] = useState<string>(DEFAULT_SCHEME.id);
  const [custom, setCustom] = useState<Palette | null>(null);
  const [variant, setVariant] = useState(0);
  const [scene, setScene] = useState<Scene | null>(null);
  const [lib, setLib] = useState<LibraryData | null>(() => libraryIfReady('L') ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selBox, setSelBox] = useState<DOMRect | null>(null);
  const [picker, setPicker] = useState(false);
  const [paletteDialog, setPaletteDialog] = useState(false);
  const [demo, setDemo] = useState<Scene | null>(null);
  /** Object order as the user named them, for the «Использованы» line. */
  const [order, setOrder] = useState<ObjectId[]>([]);
  const isPhone = useMedia('(max-width: 640px)');
  const canvasWrap = useRef<HTMLDivElement>(null);

  const palette: Palette = schemeId === 'custom' && custom ? custom : (SCHEMES.find((s) => s.id === schemeId) ?? DEFAULT_SCHEME).colors;

  // First screen: the demo is a real composition from the real engine.
  useEffect(() => {
    loadLibrary('L').then((l) => {
      setLib((cur) => cur ?? l);
      setDemo(layoutScene({ objects: matchObjects(DEMO_PHRASE).objects, format: 'horizontal', size: 'L' }, l, 'demo'));
    });
  }, []);

  const generate = useCallback(
    async (text: string) => {
      const p = text.trim();
      if (!p || busy) return;
      setBusy(true);
      try {
        const [interp, l] = await Promise.all([interpretPhrase(p), loadLibrary(size)]);
        const s = relabel(layoutScene({ objects: interp.objects, format, size, variant: 0 }, l));
        setLib(l);
        setScene(s);
        setOrder(interp.objects.map((o) => o.id));
        setVariant(0);
        setPhrase(p);
        setInput(p);
        setNote(interp.note);
        setSelected(null);
        setPhase('editor');
        window.scrollTo({ top: 0 });
      } finally {
        setBusy(false);
      }
    },
    [busy, format, size],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      setInput('');
      (e.currentTarget as HTMLFormElement).querySelector('input')?.focus();
      return;
    }
    generate(input);
  };

  // ---- scene editing ----
  const relayout = (objects: ObjectRequest[], tints: number[] | undefined, f: Format, v: number, l: LibraryData) => {
    setScene(relabel(layoutScene({ objects, tints, format: f, size: l.size, variant: v }, l)));
    setSelected(null);
  };

  const update = (fn: (items: SceneItem[]) => SceneItem[]) => setScene((s) => (s ? { ...s, items: fn(s.items) } : s));
  const sel = scene?.items.find((i) => i.uid === selected) ?? null;

  const actions = {
    rotate: () => sel && update((items) => items.map((i) => (i.uid === sel.uid ? { ...i, rotation: (i.rotation + 15) % 360 } : i))),
    duplicate: () => {
      if (!sel || !scene || scene.items.length >= 8) return;
      const copy: SceneItem = {
        ...sel,
        uid: newUid(),
        x: Math.min(scene.width, sel.x + scene.width * 0.06),
        y: Math.min(scene.height, sel.y + scene.height * 0.06),
      };
      update((items) => {
        const k = items.findIndex((i) => i.uid === sel.uid);
        return [...items.slice(0, k + 1), copy, ...items.slice(k + 1)];
      });
      setSelected(copy.uid);
    },
    remove: () => {
      if (!sel || !scene || scene.items.length <= 1) return;
      update((items) => items.filter((i) => i.uid !== sel.uid));
      setSelected(null);
    },
    forward: () =>
      sel &&
      update((items) => {
        const k = items.findIndex((i) => i.uid === sel.uid);
        if (k >= items.length - 1) return items;
        const out = [...items];
        [out[k], out[k + 1]] = [out[k + 1], out[k]];
        return out;
      }),
    backward: () =>
      sel &&
      update((items) => {
        const k = items.findIndex((i) => i.uid === sel.uid);
        if (k <= 0) return items;
        const out = [...items];
        [out[k], out[k - 1]] = [out[k - 1], out[k]];
        return out;
      }),
    toggleRole: () =>
      sel &&
      lib &&
      update((items) =>
        items.map((i) => {
          if (i.uid !== sel.uid) return i;
          const role = i.role === 'main' ? 'background' : 'main';
          return { ...i, role, tint: role === 'main' ? defaultTint(lib, i.id, 'main') : 0 };
        }),
      ),
    recolor: () => sel && sel.role === 'main' && update((items) => items.map((i) => (i.uid === sel.uid ? { ...i, tint: (i.tint + 1) % 3 } : i))),
  };

  useEffect(() => {
    if (phase !== 'editor') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || !sel || !scene) return;
      if (e.key === 'Delete' || e.key === 'Backspace') actions.remove();
      else if (e.key === 'Escape') setSelected(null);
      else if (e.key.startsWith('Arrow')) {
        const step = (e.shiftKey ? 0.05 : 0.01) * scene.width;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        update((items) => items.map((i) => (i.uid === sel.uid ? { ...i, x: i.x + dx, y: i.y + dy } : i)));
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const changeFormat = (f: Format) => {
    setFormat(f);
    if (scene && lib) {
      const r = sceneRequests(scene);
      relayout(r.objects, r.tints, f, variant, lib);
    }
  };

  const [sizeHint, setSizeHint] = useState(false);
  const sizeHintTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(sizeHintTimer.current), []);
  /** Phones have no hover: the explanation shows for a moment after a switch or a long press. */
  const flashSizeHint = () => {
    setSizeHint(true);
    clearTimeout(sizeHintTimer.current);
    sizeHintTimer.current = setTimeout(() => setSizeHint(false), 3500);
  };

  const changeSize = async (s: Size) => {
    if (isPhone) flashSizeHint();
    setSize(s);
    if (!scene) return;
    const l = await loadLibrary(s);
    setLib(l);
    setScene((cur) => (cur ? convertSceneSize(cur, l) : cur));
  };

  const nextVariant = () => {
    if (!scene || !lib) return;
    const v = variant + 1;
    setVariant(v);
    const r = sceneRequests(scene);
    relayout(r.objects, r.tints, scene.format, v, lib);
  };

  const counts = useMemo(() => {
    const c: Partial<Record<ObjectId, number>> = {};
    for (const it of scene?.items ?? []) c[it.id] = (c[it.id] ?? 0) + 1;
    return c;
  }, [scene]);

  const changeCount = (id: ObjectId, delta: 1 | -1) => {
    if (!scene || !lib) return;
    const r = sceneRequests(scene);
    const objects = [...r.objects];
    const tints = [...r.tints];
    if (delta > 0) {
      if (objects.length >= 8) return;
      const mains = objects.filter((o) => o.role === 'main').length;
      objects.push({ id, role: mains >= 4 ? 'background' : 'main' });
      if (!order.includes(id)) setOrder([...order, id]);
      tints.push(defaultTint(lib, id, mains >= 4 ? 'background' : 'main'));
    } else {
      if (objects.length <= 1) return;
      const k = objects.map((o) => o.id).lastIndexOf(id);
      if (k < 0) return;
      objects.splice(k, 1);
      tints.splice(k, 1);
    }
    relayout(objects, tints, scene.format, variant, lib);
  };

  const download = () => {
    if (!scene || !lib) return;
    const svg = sceneToSvg(scene, lib, palette, { title: phrase });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skladno-${scene.format}-${scene.size}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const usedLine = useMemo(() => {
    const parts: string[] = [];
    const rank = (id: ObjectId) => (order.includes(id) ? order.indexOf(id) : 100);
    const entries = (Object.entries(counts) as [ObjectId, number][]).sort((a, b) => rank(a[0]) - rank(b[0]));
    for (const [id, n] of entries) parts.push(CATALOG_BY_ID[id].nameRu + (n > 1 ? ` ×${n}` : ''));
    return parts.join(', ');
  }, [counts, order]);

  // ---------------- views ----------------

  if (phase === 'home') {
    return (
      <div className="page home">
        <header className="topbar">
          <Wordmark />
        </header>
        <main className="hero">
          <h1>Иллюстрация из&nbsp;одной фразы</h1>
          <p className="lead">Опишите идею или перечислите объекты. Мы&nbsp;соберём композицию из&nbsp;готовых векторных элементов</p>
          <form className="prompt" onSubmit={onSubmit}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={PLACEHOLDER} aria-label="Идея или список объектов" maxLength={200} />
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Собираем…' : 'Создать иллюстрацию'}
            </button>
          </form>
          <p className="demo-caption">«{DEMO_PHRASE}» → готовая иллюстрация</p>
          <div className="demo-frame">
            {demo && lib ? <SceneView scene={demo} lib={lib} palette={DEFAULT_SCHEME.colors} intro label={`Пример: ${DEMO_PHRASE}`} className="scene" /> : <div className="scene placeholder" />}
          </div>
          <button className="link-btn demo-link" onClick={() => generate(DEMO_PHRASE)} disabled={busy}>
            Попробовать этот пример
          </button>
        </main>
      </div>
    );
  }

  const toolbar = sel && (
    <div className="toolbar" role="toolbar" aria-label="Действия с объектом" onPointerDown={(e) => e.stopPropagation()}>
      <button onClick={actions.rotate} title="Повернуть на 15°" aria-label="Повернуть">
        <RotateCw size={20} />
      </button>
      <button onClick={actions.duplicate} title="Дублировать" aria-label="Дублировать" disabled={(scene?.items.length ?? 0) >= 8}>
        <Copy size={20} />
      </button>
      <button onClick={actions.forward} title="Выше по слоям" aria-label="Выше по слоям">
        <ArrowUp size={20} />
      </button>
      <button onClick={actions.backward} title="Ниже по слоям" aria-label="Ниже по слоям">
        <ArrowDown size={20} />
      </button>
      <button onClick={actions.toggleRole} title={sel.role === 'main' ? 'Сделать фоновым' : 'Сделать главным'} aria-label="Главный или фоновый" className={sel.role === 'background' ? 'on' : ''}>
        <Layers size={20} />
      </button>
      <button onClick={actions.recolor} title="Другие цвета схемы" aria-label="Перекрасить" disabled={sel.role !== 'main'}>
        <PaletteIcon size={20} />
      </button>
      <button onClick={actions.remove} title="Удалить" aria-label="Удалить" disabled={(scene?.items.length ?? 0) <= 1}>
        <Trash2 size={20} />
      </button>
    </div>
  );

  let floating: React.CSSProperties | undefined;
  if (!isPhone && selBox && canvasWrap.current) {
    const wrap = canvasWrap.current.getBoundingClientRect();
    const tbW = 7 * 44 + 16;
    const cx = selBox.left + selBox.width / 2 - wrap.left;
    let top = selBox.top - wrap.top - 64;
    if (top < 8) top = Math.min(wrap.height - 60, selBox.bottom - wrap.top + 12);
    floating = { left: Math.max(8, Math.min(wrap.width - tbW - 8, cx - tbW / 2)), top: Math.max(8, top) };
  }

  return (
    <div className="page editor">
      <header className="editor-head">
        <Wordmark onClick={() => setPhase('home')} />
        <form className="prompt compact" onSubmit={onSubmit}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={PLACEHOLDER} aria-label="Идея или список объектов" maxLength={200} />
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Собираем…' : isPhone ? 'Создать' : 'Создать иллюстрацию'}
          </button>
        </form>
      </header>
      {note && <p className="note">{note}</p>}
      <div className="editor-grid">
        <section className="canvas-col">
          <div className={`canvas-wrap fmt-${scene?.format}${busy ? ' busy' : ''}`} ref={canvasWrap}>
            {scene && lib && lib.size === scene.size && (
              <SceneView
                scene={scene}
                lib={lib}
                palette={palette}
                interactive
                selected={selected}
                onSelect={setSelected}
                onMove={(uid, x, y) => update((items) => items.map((i) => (i.uid === uid ? { ...i, x, y } : i)))}
                onSelectionBox={setSelBox}
                className="scene"
                label={`Композиция: ${phrase}`}
              />
            )}
            {!isPhone && toolbar && <div className="toolbar-float" style={floating}>{toolbar}</div>}
          </div>
          <p className="used">
            Использованы: {usedLine}
            <span className="dot">•</span>
            <button className="link-btn" onClick={() => setPicker(true)}>
              Изменить объекты
            </button>
            <span className="dot">•</span>
            <button className="link-btn" onClick={nextVariant}>
              Другой вариант
            </button>
          </p>
        </section>
        <aside className="settings" aria-label="Настройки">
          <div className="group">
            <h3>Формат</h3>
            <div className="formats" role="radiogroup" aria-label="Формат">
              {FORMATS.map((f) => (
                <button key={f.id} role="radio" aria-checked={format === f.id} className={'fmt' + (format === f.id ? ' on' : '')} onClick={() => changeFormat(f.id)} title={f.label} aria-label={f.label}>
                  <span className={`fmt-shape ${f.id}`} />
                </button>
              ))}
            </div>
          </div>
          <div className="group">
            <h3>Цвет</h3>
            <div className="dots" role="radiogroup" aria-label="Цветовая схема">
              {SCHEMES.map((s) => (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={schemeId === s.id}
                  className={'dot-btn' + (schemeId === s.id ? ' on' : '')}
                  style={{ ['--c' as string]: s.colors.bgMid }}
                  onClick={() => setSchemeId(s.id)}
                  title={s.nameRu}
                  aria-label={s.nameRu}
                />
              ))}
              {custom && (
                <button
                  role="radio"
                  aria-checked={schemeId === 'custom'}
                  className={'dot-btn custom' + (schemeId === 'custom' ? ' on' : '')}
                  style={{ ['--c' as string]: custom.bgMid, ['--c2' as string]: custom.accent1 }}
                  onClick={() => setSchemeId('custom')}
                  title="Своя палитра"
                  aria-label="Своя палитра"
                />
              )}
            </div>
            <button className="link-btn small" onClick={() => setPaletteDialog(true)}>
              Своя палитра
            </button>
          </div>
          <div className="group">
            <h3>Детализация</h3>
            <div className="seg" role="radiogroup" aria-label="Детализация" aria-describedby="size-hint" title={SIZE_HINT_ALL} onContextMenu={(e) => {
              if (!isPhone) return;
              e.preventDefault();
              flashSizeHint();
            }}>
              {(['S', 'L'] as Size[]).map((s) => (
                <button key={s} role="radio" aria-checked={size === s} className={size === s ? 'on' : ''} onClick={() => changeSize(s)} title={`${s} — ${SIZE_HINT[s].toLowerCase()}`}>
                  {s}
                </button>
              ))}
            </div>
            {!isPhone && (
              <p className="size-hint" id="size-hint">
                {SIZE_HINT[size]}
              </p>
            )}
          </div>
          {isPhone && sizeHint && (
            <p className="size-hint phone" id="size-hint" role="status">
              {size} — {SIZE_HINT[size].toLowerCase()}
            </p>
          )}
          {!isPhone && (
            <button className="btn wide" onClick={download}>
              Скачать SVG
            </button>
          )}
        </aside>
      </div>
      {isPhone && (
        <div className="bottom-bar">
          {toolbar}
          <button className="btn wide" onClick={download}>
            <Download size={18} /> Скачать SVG
          </button>
        </div>
      )}
      {picker && lib && <ObjectPicker lib={lib} palette={palette} counts={counts} onChange={changeCount} onClose={() => setPicker(false)} />}
      {paletteDialog && (
        <PaletteDialog
          current={palette}
          onApply={(p) => {
            setCustom(p);
            setSchemeId('custom');
            setPaletteDialog(false);
          }}
          onClose={() => setPaletteDialog(false)}
        />
      )}
    </div>
  );
}
