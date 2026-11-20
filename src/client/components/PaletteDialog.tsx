import { Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parsePalette, ROLE_LABELS } from '../../shared/palette';
import { ROLES, type Palette } from '../../shared/types';

export interface PaletteDialogProps {
  current: Palette;
  onApply: (p: Palette) => void;
  onClose: () => void;
}

const EXAMPLE = '#E3F0D0 #B9DC8F #5E9E3A #181817 #FFE08A #FF9F80 #FFE6DB #FFFFFF';

export function PaletteDialog({ current, onApply, onClose }: PaletteDialogProps) {
  const [text, setText] = useState(() => ROLES.map((r) => current[r]).join(' '));
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = parsePalette(text);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = () => {
    if (parsed.palette) onApply(parsed.palette);
    else setError(parsed.error ?? 'Не удалось прочитать палитру');
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const t = await file.text();
    setText(t);
    const p = parsePalette(t);
    setError(p.error ?? '');
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet narrow" role="dialog" aria-label="Своя палитра">
        <div className="sheet-head">
          <h2>Своя палитра</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <p className="muted small">
          8 цветов в порядке образца из Figma: фон светлый, средний, тёмный, контур; затем акценты 1–3 и белый. Можно 6 цветов (контур и белый
          останутся) или JSON-файл с ролями. Цвета объектов не должны совпадать с цветами фона.
        </p>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          rows={3}
          spellCheck={false}
          aria-label="Цвета палитры"
          placeholder={EXAMPLE}
        />
        <div className="swatches" aria-hidden="true">
          {ROLES.map((r) => (
            <span key={r} title={ROLE_LABELS[r]} style={{ background: parsed.palette?.[r] ?? 'transparent' }} />
          ))}
        </div>
        {(error || (!parsed.palette && text.trim())) && <p className="error small">{error || parsed.error}</p>}
        <div className="sheet-actions">
          <button className="link-btn" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> Загрузить JSON
          </button>
          <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn" onClick={apply} disabled={!parsed.palette}>
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
