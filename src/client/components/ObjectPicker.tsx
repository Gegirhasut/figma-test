import { Minus, Plus, X } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { CATALOG, type ObjectId } from '../../shared/catalog';
import { defaultTint } from '../../shared/layout';
import { resolveMarkup, tintPalette } from '../../shared/palette';
import type { LibraryData, Palette } from '../../shared/types';

const Thumb = memo(function Thumb({ id, lib, palette }: { id: ObjectId; lib: LibraryData; palette: Palette }) {
  const f = lib.objects[id].main;
  const html = resolveMarkup(f.markup, tintPalette(palette, defaultTint(lib, id, 'main')));
  return <svg viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
});

export interface ObjectPickerProps {
  lib: LibraryData;
  palette: Palette;
  counts: Partial<Record<ObjectId, number>>;
  onChange: (id: ObjectId, delta: 1 | -1) => void;
  onClose: () => void;
}

export function ObjectPicker({ lib, palette, counts, onChange, onClose }: ObjectPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const total = Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-label="Объекты композиции" tabIndex={-1} ref={ref}>
        <div className="sheet-head">
          <h2>Объекты</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <p className="muted small">Только элементы библиотеки. Композиция пересоберётся автоматически.</p>
        <div className="picker-grid">
          {CATALOG.map((c) => {
            const n = counts[c.id] ?? 0;
            return (
              <div key={c.id} className={'picker-tile' + (n ? ' on' : '')}>
                <button className="picker-thumb" onClick={() => onChange(c.id, 1)} aria-label={`Добавить: ${c.nameRu}`} disabled={total >= 8}>
                  <Thumb id={c.id} lib={lib} palette={palette} />
                </button>
                <div className="picker-row">
                  <span className="picker-name">{c.nameRu}</span>
                  <span className="stepper">
                    <button onClick={() => onChange(c.id, -1)} disabled={!n || total <= 1} aria-label={`Убрать: ${c.nameRu}`}>
                      <Minus size={14} />
                    </button>
                    <span className="count">{n}</span>
                    <button onClick={() => onChange(c.id, 1)} disabled={total >= 8} aria-label={`Добавить: ${c.nameRu}`}>
                      <Plus size={14} />
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
