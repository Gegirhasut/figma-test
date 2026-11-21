import { ArrowDown, ArrowUp, Copy, Download, Layers, Palette as PaletteIcon, RotateCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CATALOG_BY_ID, type ObjectId } from '../shared/catalog';
import { convertSceneSize, defaultTint, layoutSceneFor, sceneRequests } from '../shared/layout';
import { DEFAULT_SCHEME, SCHEMES } from '../shared/palette';
import { sceneToSvg } from '../shared/render';
import type { Format, LibraryData, ObjectRequest, Palette, Scene, SceneItem, Size } from '../shared/types';
import { fetchAiStatus, interpretPhrase, type Interpretation } from './api';
import { PaletteDialog } from './components/PaletteDialog';
import { SceneView } from './components/SceneView';
import { DemoFrame, useHomeDemo } from './components/HomeDemo';
import { FirstResultHint } from './components/Hints';
import { LibraryStrip } from './components/LibraryStrip';
import { CHIPS, LIST_CHIPS, takeFirstHint, type Chip } from './onboarding';
import { addBlocker, addObject, clampInside, clearScene, insertByDepth, removeLatest, roleForNew, switchSize } from '../shared/place';
import { DEMO_EXAMPLE, findFixedSet, type DemoExample } from './demo-examples';
import { libraryIfReady, loadLibrary } from './library';

const PLACEHOLDER = 'Например, «Вечер с книгой»';

/** What the S/L switch does (both are the client's library, S is the simplified set for small sizes). */
const SIZE_HINT: Record<Size, string> = {
  S: 'Простые объекты — для маленьких картинок',
  L: 'Подробные объекты — для больших картинок',
};
const SIZE_HINT_ALL = 'S — простые объекты для маленьких картинок (превью, карточки), L — подробные для больших (обложки, баннеры)';

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
  const [paletteDialog, setPaletteDialog] = useState(false);
  /** What went wrong with the last phrase (limit, timeout, offline), to offer the next step. */
  const [problem, setProblem] = useState<Interpretation['problem']>();
  /** AI quota of this browser; shown once at least one AI request was used. */
  const [ai, setAi] = useState<{ left: number; limit: number } | null>(null);
  /** Bumped per result: the canvas re-mounts and its objects drop in. */
  const [dropKey, setDropKey] = useState(0);
  /** The one-time hint after the first result. */
  const [hint, setHint] = useState(false);
  const hintTaken = useRef(false);
  const [demoFailed, setDemoFailed] = useState(false);
  /** The L library for the home-page demo. */
  const [demoLib, setDemoLib] = useState<LibraryData | null>(() => libraryIfReady('L') ?? null);
  /** Object order as the user named them, for the «Использованы» line. */
  const [order, setOrder] = useState<ObjectId[]>([]);
  const isPhone = useMedia('(max-width: 640px)');
  const canvasWrap = useRef<HTMLDivElement>(null);

  const applied: Palette = schemeId === 'custom' && custom ? custom : (SCHEMES.find((s) => s.id === schemeId) ?? DEFAULT_SCHEME).colors;
  /** Live preview from the palette dialog, shown on the canvas until applied or closed. */
  const [palettePreview, setPalettePreview] = useState<Palette | null>(null);
  const palette = palettePreview ?? applied;

  // First screen: the demo builds a real composition with the real engine.
  useEffect(() => {
    loadLibrary('L')
      .then((l) => {
        setLib((cur) => cur ?? l);
        setDemoLib(l);
      })
      // Without the library there is nothing to show: the demo block is hidden, the input still works.
      .catch(() => setDemoFailed(true));
  }, []);
  useEffect(() => {
    fetchAiStatus().then((st) => st && st.aiConfigured && setAi({ left: st.aiLeft, limit: st.aiLimit }));
  }, []);
  const demo = useHomeDemo(phase === 'home' ? demoLib : null);
  const stopDemo = demo.stop;
  /** The demo is typing, or its phrase still stands in the input. */
  const demoOn = demo.active || demo.ghost !== '';
  // Anything the visitor does stops the demo for good.
  useEffect(() => {
    if (!demoOn) return;
    window.addEventListener('pointerdown', stopDemo, true);
    window.addEventListener('keydown', stopDemo, true);
    return () => {
      window.removeEventListener('pointerdown', stopDemo, true);
      window.removeEventListener('keydown', stopDemo, true);
    };
  }, [demoOn, stopDemo]);

  /** `example`: a demo example with its fixed objects, scheme and format (no AI request). */
  const generate = useCallback(
    async (text: string, example?: DemoExample, keepLook = false) => {
      const p = text.trim();
      if (!p || busy) return;
      setBusy(true);
      try {
        // keepLook: a fixed phrase typed by hand keeps the user's current format and colours; the example's
        // tuned variant is used only in the format it was tuned for.
        const f = example && !keepLook ? example.format : format;
        const v = example && example.format === f ? example.variant : 0;
        const [interp, l, libL] = await Promise.all([
          example ? Promise.resolve({ objects: example.objects, note: '' }) : interpretPhrase(p),
          loadLibrary(size),
          loadLibrary('L'),
        ]);
        // Laid out with the L geometry, so S and L compositions are identical apart from the pieces.
        const s = relabel(layoutSceneFor({ objects: interp.objects, format: f, size, variant: v }, libL, l));
        if (example && !keepLook) {
          setFormat(f);
          setSchemeId(example.scheme);
        }
        setLib(l);
        setScene(s);
        setOrder(interp.objects.map((o) => o.id));
        setVariant(v);
        setPhrase(p);
        setInput(p);
        setNote(interp.note);
        setProblem((interp as Partial<Interpretation>).problem);
        const quota = interp as Partial<Interpretation>;
        if (quota.aiLeft !== undefined && quota.aiLimit) setAi({ left: quota.aiLeft, limit: quota.aiLimit });
        setDropKey((k) => k + 1);
        setSelected(null);
        setPhase('editor');
        // First result in this browser: one hint, once the objects have dropped in.
        if (!hintTaken.current) {
          hintTaken.current = true;
          if (takeFirstHint()) setTimeout(() => setHint(true), 1400);
        }
        window.scrollTo({ top: 0 });
      } finally {
        setBusy(false);
      }
    },
    [busy, format, size],
  );
  const runChip = (c: Chip) => generate(c.phrase, c.example);
  const closeHint = useCallback(() => setHint(false), []);
  const aiLeftLine = ai && ai.left < ai.limit ? <p className="ai-left">Осталось AI-запросов: {ai.left} из {ai.limit}</p> : null;
  const chipRow = (chips: Chip[], label: string) => (
    <div className="chips" role="group" aria-label={label}>
      {chips.map((c) => (
        <button key={c.phrase} type="button" className="chip" onClick={() => runChip(c)} disabled={busy}>
          {c.phrase}
        </button>
      ))}
    </div>
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      setInput('');
      (e.currentTarget as HTMLFormElement).querySelector('input')?.focus();
      return;
    }
    // The same phrase must give the same picture: an example phrase typed by hand (or re-submitted from the
    // editor) uses the example's fixed objects and layout, as its chip does, instead of a fresh interpretation.
    const fixed = findFixedSet(input);
    generate(input, fixed, phase === 'editor');
  };

  // ---- scene editing ----
  const relayout = (objects: ObjectRequest[], tints: number[] | undefined, f: Format, v: number, l: LibraryData) => {
    setScene(relabel(layoutSceneFor({ objects, tints, format: f, size: l.size, variant: v }, libraryIfReady('L') ?? l, l)));
    setSelected(null);
  };

  const update = (fn: (items: SceneItem[]) => SceneItem[]) => setScene((s) => (s ? { ...s, items: fn(s.items) } : s));
  const sel = scene?.items.find((i) => i.uid === selected) ?? null;

  const actions = {
    rotate: () => sel && update((items) => items.map((i) => (i.uid === sel.uid ? { ...i, rotation: (i.rotation + 15) % 360 } : i))),
    duplicate: () => {
      if (!sel || !scene || !lib || addBlocker(scene.items, sel.id)) return;
      // Same limits as the strip; the copy stays whole inside the frame and takes its place by depth.
      const shifted: SceneItem = { ...sel, uid: newUid(), x: sel.x + scene.width * 0.06, y: sel.y + scene.height * 0.06 };
      const copy = { ...shifted, ...clampInside(shifted, lib, scene) };
      update((items) => insertByDepth(items, copy, lib, scene.scale));
      setSelected(copy.uid);
    },
    remove: () => {
      if (!sel || !scene) return;
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

  /** Last S/L click; an older library load that finishes later is ignored. */
  const sizeRequest = useRef(0);
  const changeSize = async (s: Size) => {
    if (isPhone) flashSizeHint();
    setSize(s);
    const req = ++sizeRequest.current;
    if (!scene) return;
    const l = await loadLibrary(s);
    if (req !== sizeRequest.current) return;
    setLib(l);
    setScene((cur) => {
      if (!cur) return cur;
      const from = libraryIfReady(cur.size);
      return from ? switchSize(cur, from, l) : convertSceneSize(cur, l);
    });
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

  /** Adds one object without touching the others: on a free spot, or at the drop point (frame units). */
  const addItem = (id: ObjectId, at?: { x: number; y: number }) => {
    if (!scene || !lib) return;
    const uid = newUid();
    const next = addObject(scene, lib, { uid, id, tint: defaultTint(lib, id, roleForNew(scene.items)) }, at, libraryIfReady('L') ?? lib);
    if (!next) return;
    setScene(next);
    if (!order.includes(id)) setOrder([...order, id]);
    setSelected(uid);
  };
  const dropItem = (id: ObjectId, clientX: number, clientY: number) => {
    const svg = canvasWrap.current?.querySelector('svg');
    const m = svg?.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    addItem(id, { x: p.x, y: p.y });
  };
  /** «−» on a thumbnail: the copy added last goes; the rest stays in place. */
  const removeOne = (id: ObjectId) => {
    if (!scene) return;
    setScene({ ...scene, items: removeLatest(scene.items, id) });
    setSelected(null);
  };
  const blocker = useCallback((id: ObjectId) => (scene ? addBlocker(scene.items, id) : null), [scene]);
  /** Objects removed by «Очистить», for «Вернуть» while the canvas is still empty. */
  const [cleared, setCleared] = useState<SceneItem[] | null>(null);
  const clearAll = () => {
    if (!scene || !scene.items.length) return;
    setCleared(scene.items);
    setScene(clearScene(scene));
    setSelected(null);
  };
  const restoreCleared = () => {
    if (!scene || !cleared || scene.items.length) return;
    setScene({ ...scene, items: cleared });
    setCleared(null);
  };
  const empty = !!scene && scene.items.length === 0;
  // «Вернуть» only makes sense until something new is on the canvas.
  useEffect(() => {
    if (scene?.items.length) setCleared(null);
  }, [scene?.items.length]);

  const download = () => {
    if (!scene || !lib || !scene.items.length) return;
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
          <p className="lead">Опишите идею&nbsp;— соберём иллюстрацию из&nbsp;готовых объектов</p>
          <form className="prompt" onSubmit={onSubmit}>
            <div className="prompt-field">
              <input
                value={input}
                onChange={(e) => {
                  stopDemo();
                  setInput(e.target.value);
                }}
                placeholder={demoOn ? '' : PLACEHOLDER}
                aria-label="Идея или список объектов"
                maxLength={200}
              />
              {demoOn && (
                <span className="ghost" aria-hidden="true">
                  {demo.ghost}
                  {demo.typing && <span className="caret" />}
                </span>
              )}
            </div>
            <button className={`btn${demo.pressing ? ' pressing' : ''}`} type="submit" disabled={busy}>
              {busy ? 'Собираем…' : 'Создать иллюстрацию'}
            </button>
          </form>
          {aiLeftLine}
          {chipRow(CHIPS, 'Примеры запросов')}
          {!demoFailed && <DemoFrame lib={demoLib} scene={demo.scene} example={DEMO_EXAMPLE} built={demo.built && !busy} animate={demo.animate} />}
          {demoFailed ? null : busy ? (
            <p className="demo-caption loading" aria-live="polite">
              Подбираем объекты и собираем композицию…
            </p>
          ) : (
            <button
              className="link-btn demo-link"
              onClick={() => generate(DEMO_EXAMPLE.phrase, DEMO_EXAMPLE)}
              disabled={busy || !demo.built}
              // Hidden (space kept, so nothing jumps) until the demo composition has appeared.
              style={demo.built ? undefined : { visibility: 'hidden' }}
              aria-hidden={!demo.built}
            >
              Попробовать этот пример
            </button>
          )}
        </main>
      </div>
    );
  }

  const toolbar = sel && (
    <div className="toolbar" role="toolbar" aria-label="Действия с объектом" onPointerDown={(e) => e.stopPropagation()}>
      <button onClick={actions.rotate} title="Повернуть на 15°" aria-label="Повернуть">
        <RotateCw size={20} />
      </button>
      <button
        onClick={actions.duplicate}
        title={(scene && addBlocker(scene.items, sel.id)) || 'Дублировать'}
        aria-label="Дублировать"
        disabled={!scene || !!addBlocker(scene.items, sel.id)}
      >
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
      <button onClick={actions.remove} title="Удалить" aria-label="Удалить">
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
      {aiLeftLine}
      {note && (
        <div className="note-box">
          <p className="note">{note}</p>
          {(problem === 'limit' || problem === 'timeout' || problem === 'offline' || problem === 'rejected' || problem === 'server') && chipRow(LIST_CHIPS, 'Списки объектов работают без ограничений')}
        </div>
      )}
      <div className="editor-grid">
        <section className="canvas-col">
          <div className={`canvas-wrap fmt-${scene?.format}${busy ? ' busy' : ''}`} ref={canvasWrap}>
            {scene && lib && lib.size === scene.size && (
              <SceneView
                key={dropKey}
                dropIn
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
            {/* Rendered only once its position is known, so it never appears at the canvas corner first. */}
            {!isPhone && toolbar && floating && <div className="toolbar-float" style={floating}>{toolbar}</div>}
            {empty && <p className="canvas-empty">Добавьте объекты снизу — нажмите или перетащите на холст</p>}
          </div>
          <p className="used">
            {empty ? (
              <>
                Пока пусто
                {cleared && (
                  <>
                    <span className="dot">•</span>
                    <button className="link-btn" onClick={restoreCleared}>
                      Вернуть
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                Использованы: {usedLine}
                <span className="dot">•</span>
                <button className="link-btn" onClick={nextVariant}>
                  Другой вариант
                </button>
                <span className="dot">•</span>
                <button className="link-btn quiet" onClick={clearAll}>
                  Очистить
                </button>
              </>
            )}
          </p>
          {lib && (
            <LibraryStrip lib={lib} palette={palette} counts={counts} blocker={blocker} dropTarget={canvasWrap} onAdd={addItem} onDrop={dropItem} onRemove={removeOne} />
          )}
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
            <button
              className="link-btn small"
              onClick={() => {
                // On a phone the dialog is a bottom sheet: bring the canvas to the top so the live preview stays in view.
                if (isPhone) canvasWrap.current?.scrollIntoView({ block: 'start' });
                setPaletteDialog(true);
              }}
            >
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
              // Both captions share one grid cell and only the current one is visible, so the block is always
              // as tall as the longer caption and the «Скачать SVG» button below never jumps.
              <p className="size-hint stacked" id="size-hint">
                {(['S', 'L'] as const).map((s) => (
                  <span key={s} aria-hidden={s !== size} style={s === size ? undefined : { visibility: 'hidden' }}>
                    {SIZE_HINT[s]}
                  </span>
                ))}
              </p>
            )}
          </div>
          {isPhone && sizeHint && (
            <p className="size-hint phone" id="size-hint" role="status">
              {size} — {SIZE_HINT[size].toLowerCase()}
            </p>
          )}
          {!isPhone && (
            <button className="btn wide" onClick={download} aria-disabled={empty} title={empty ? 'Добавьте хотя бы один объект' : undefined}>
              Скачать SVG
            </button>
          )}
        </aside>
      </div>
      {isPhone && (
        <div className="bottom-bar">
          {toolbar}
          <button className="btn wide" onClick={download} aria-disabled={empty} title={empty ? 'Добавьте хотя бы один объект' : undefined}>
            <Download size={18} /> Скачать SVG
          </button>
        </div>
      )}
      {hint && <FirstResultHint target={canvasWrap} onClose={closeHint} />}
      {paletteDialog && (
        <PaletteDialog
          current={applied}
          onPreview={setPalettePreview}
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
