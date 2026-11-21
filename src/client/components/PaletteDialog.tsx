import { Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { conflictingRoles, parsePalette, validatePalette } from '../../shared/palette';
import { OBJ_ROLES, ROLES, type Palette, type Role } from '../../shared/types';

export interface PaletteDialogProps {
  /** The palette in use when the dialog opened; «Сбросить» returns to it. */
  current: Palette;
  onApply: (p: Palette) => void;
  /** Live preview on the canvas behind the dialog (null = back to the applied palette). */
  onPreview: (p: Palette | null) => void;
  onClose: () => void;
}

/** Short names under the swatches, in the order of the client's Figma swatch. */
export const SWATCH_NAMES: Record<Role, string> = {
  bgLight: 'Фон',
  bgMid: 'Фон 2',
  bgDark: 'Фон 3',
  ink: 'Контур',
  accent1: 'Акцент 1',
  accent2: 'Акцент 2',
  accent3: 'Акцент 3',
  paper: 'Белый',
};

const toText = (p: Palette) => ROLES.map((r) => p[r]).join(' ');
const upper = (p: Palette) => Object.fromEntries(ROLES.map((r) => [r, p[r].toUpperCase()])) as Palette;

export function PaletteDialog({ current, onApply, onPreview, onClose }: PaletteDialogProps) {
  const [colors, setColors] = useState<Palette>(() => upper(current));
  const [text, setText] = useState(() => toText(upper(current)));
  const [textError, setTextError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const conflicts = conflictingRoles(colors);
  const valid = !validatePalette(colors);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // The composition behind the dialog follows every change; closing without «Применить» drops the preview.
  useEffect(() => onPreview(colors), [colors, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const setAll = (p: Palette, fromText = false) => {
    const u = upper(p);
    setColors(u);
    if (!fromText) setText(toText(u));
    setTextError('');
  };

  const setRole = (r: Role, hex: string) => setAll({ ...colors, [r]: hex });

  const onText = (t: string) => {
    setText(t);
    const parsed = parsePalette(t, colors, { validate: false });
    if (parsed.palette) setAll(parsed.palette, true);
    else setTextError(parsed.error ?? 'Не удалось прочитать палитру');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const t = await file.text();
    const parsed = parsePalette(t, colors, { validate: false });
    if (parsed.palette) setAll(parsed.palette);
    else setTextError(`Файл не подошёл: ${parsed.error ?? 'не удалось прочитать палитру'}`);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="sheet-backdrop side" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet narrow palette-sheet" role="dialog" aria-label="Своя палитра">
        <div className="sheet-head">
          <h2>Своя палитра</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <p className="muted small">Нажмите на цвет, чтобы изменить его. Можно вставить hex-коды или загрузить файл палитры.</p>

        <div className="swatch-grid">
          {ROLES.map((r) => {
            const bad = conflicts.includes(r);
            return (
              <label key={r} className={'swatch' + (bad ? ' bad' : '')} title={`${SWATCH_NAMES[r]}: ${colors[r]} — нажмите, чтобы изменить`}>
                <span className="swatch-color" style={{ background: colors[r] }}>
                  <input type="color" value={colors[r].toLowerCase()} onChange={(e) => setRole(r, e.target.value)} aria-label={`${SWATCH_NAMES[r]}, ${colors[r]}`} />
                </span>
                <span className="swatch-name">{SWATCH_NAMES[r]}</span>
                <span className="swatch-hex">{colors[r]}</span>
                {bad && <span className="swatch-warn">Совпадает с фоном</span>}
              </label>
            );
          })}
        </div>
        {conflicts.length > 0 && <p className="error small">Цвета объектов не должны совпадать с цветами фона — измените отмеченный цвет.</p>}

        <label className="hex-field">
          <span className="small muted">Hex-коды</span>
          <textarea value={text} onChange={(e) => onText(e.target.value)} rows={2} spellCheck={false} aria-label="Цвета палитры hex-кодами" />
        </label>
        {textError && <p className="error small">{textError}</p>}

        <details className="palette-format">
          <summary>Формат</summary>
          <p className="small muted">
            8 цветов в порядке образца из Figma: фон светлый, средний, тёмный, контур; затем акценты 1–3 и белый. Можно 6 цветов (контур и белый
            останутся прежними) или JSON-файл: список цветов или объект с ролями {ROLES.join(', ')}. Фон и фоновые объекты используют только первые
            четыре цвета, поэтому цвета объектов ({OBJ_ROLES.length} последних) не должны совпадать с ними.
          </p>
        </details>

        <div className="sheet-actions palette-actions">
          <div className="palette-secondary">
            <button className="link-btn small" onClick={() => fileRef.current?.click()}>
              <Upload size={15} /> Загрузить файл палитры (JSON)
            </button>
            <button className="link-btn small" onClick={() => setAll(current)}>
              Сбросить
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn" onClick={() => valid && onApply(colors)} disabled={!valid}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
