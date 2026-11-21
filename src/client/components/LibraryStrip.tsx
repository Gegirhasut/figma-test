// Editor strip with the ten library objects as small real-SVG thumbnails in the
// current scheme. Drag a thumbnail onto the canvas (mouse or touch) to put the
// object exactly there, or tap it to add it on a free spot. Used objects show
// their count and a «−» that removes the copy added last.

import { memo, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import { Minus } from 'lucide-react';
import { CATALOG, type ObjectId } from '../../shared/catalog';
import type { LibraryData, Palette } from '../../shared/types';
import { Thumb } from './ObjectPicker';

export const STRIP_TITLE = 'Добавить объект — нажмите или перетащите на холст';

/** Pointer travel that turns a press into a drag. */
const DRAG_START_PX = 6;

export interface LibraryStripProps {
  lib: LibraryData;
  palette: Palette;
  counts: Partial<Record<ObjectId, number>>;
  /** Why an object cannot be added right now (limit), or null. */
  blocker: (id: ObjectId) => string | null;
  /** The canvas, where a dragged thumbnail can be dropped. */
  dropTarget: RefObject<HTMLElement>;
  onAdd: (id: ObjectId) => void;
  onDrop: (id: ObjectId, clientX: number, clientY: number) => void;
  onRemove: (id: ObjectId) => void;
}

interface Drag {
  id: ObjectId;
  pointerId: number;
  x0: number;
  y0: number;
  dragging: boolean;
}

export const LibraryStrip = memo(function LibraryStrip({ lib, palette, counts, blocker, dropTarget, onAdd, onDrop, onRemove }: LibraryStripProps) {
  const drag = useRef<Drag | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [ghostAt, setGhostAt] = useState<{ id: ObjectId; x: number; y: number } | null>(null);
  /** The click that follows a finished drag is not an «add». */
  const suppressClick = useRef(false);

  const overTarget = (x: number, y: number) => {
    const r = dropTarget.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  const moveGhost = (x: number, y: number) => {
    const g = ghost.current;
    if (g) g.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    dropTarget.current?.classList.toggle('drop-over', overTarget(x, y));
  };
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const listeners = useRef<(() => void) | null>(null);
  const end = () => {
    listeners.current?.();
    listeners.current = null;
    drag.current = null;
    setGhostAt(null);
    dropTarget.current?.classList.remove('drop-over', 'drop-ready');
  };
  useEffect(() => () => listeners.current?.(), []);

  // The pointer leaves the thumbnail at once, so the drag is followed on the window.
  const onPointerDown = (e: RPointerEvent<HTMLButtonElement>, id: ObjectId) => {
    suppressClick.current = false;
    if (e.button !== 0 || blocker(id)) return;
    listeners.current?.();
    drag.current = { id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, dragging: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointerId !== ev.pointerId) return;
      if (!d.dragging) {
        if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < DRAG_START_PX) return;
        d.dragging = true;
        setGhostAt({ id: d.id, x: ev.clientX, y: ev.clientY });
        dropTarget.current?.classList.add('drop-ready');
      }
      ev.preventDefault();
      moveGhost(ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || d.pointerId !== ev.pointerId) return;
      if (d.dragging) {
        if (overTarget(ev.clientX, ev.clientY)) onDropRef.current(d.id, ev.clientX, ev.clientY);
        suppressClick.current = true;
      }
      end();
    };
    const cancel = (ev: PointerEvent) => {
      if (drag.current?.pointerId === ev.pointerId) end();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    listeners.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  };

  return (
    <section className="strip" aria-label="Добавить объект">
      <h2 className="strip-title">{STRIP_TITLE}</h2>
      <div className="strip-row">
        {CATALOG.map((c) => {
          const n = counts[c.id] ?? 0;
          const blocked = blocker(c.id);
          return (
            <div key={c.id} className={'strip-item' + (n ? ' lit' : '') + (blocked ? ' blocked' : '')} title={blocked ?? `${c.nameRu}: нажмите или перетащите на холст`}>
              <button
                type="button"
                className="strip-add"
                aria-disabled={!!blocked}
                aria-label={blocked ? `${c.nameRu}: ${blocked}` : `Добавить: ${c.nameRu}`}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  if (!blocked) onAdd(c.id);
                }}
                onPointerDown={(e) => onPointerDown(e, c.id)}
                onDragStart={(e) => e.preventDefault()}
              >
                <span className="strip-thumb">
                  <Thumb id={c.id} lib={lib} palette={palette} />
                </span>
                <span className="strip-name">{c.nameRu}</span>
              </button>
              {n > 0 && (
                <span className="strip-count" aria-hidden="true">
                  {n}
                </span>
              )}
              {n > 0 && (
                <button type="button" className="strip-remove" onClick={() => onRemove(c.id)} aria-label={`Убрать: ${c.nameRu}`} title={`Убрать последний добавленный: ${c.nameRu}`}>
                  <Minus size={12} strokeWidth={3} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {ghostAt && (
        <div className="strip-ghost" ref={ghost} aria-hidden="true" style={{ transform: `translate(${ghostAt.x}px, ${ghostAt.y}px) translate(-50%, -50%)` }}>
          <Thumb id={ghostAt.id} lib={lib} palette={palette} />
        </div>
      )}
    </section>
  );
});
