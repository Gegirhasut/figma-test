import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { paletteKey, resolveMarkup } from '../../shared/palette';
import { decorPlacements, decorStyle, itemFragment, itemMarkup, itemPalette, itemTransform, objectLabel, pieceScale } from '../../shared/render';
import type { LibraryData, Palette, Scene, SceneItem } from '../../shared/types';

const markupCache = new Map<string, string>();

function cachedItemMarkup(item: SceneItem, lib: LibraryData, palette: Palette): string {
  const key = `${lib.size}|${item.id}|${item.role}|${paletteKey(itemPalette(item, palette))}`;
  let m = markupCache.get(key);
  if (!m) {
    m = itemMarkup(item, lib, palette);
    if (markupCache.size > 400) markupCache.clear();
    markupCache.set(key, m);
  }
  return m;
}

const ObjectArt = memo(function ObjectArt({ html }: { html: string }) {
  return <g dangerouslySetInnerHTML={{ __html: html }} />;
});

const Background = memo(function Background({ scene, lib, palette }: { scene: Scene; lib: LibraryData; palette: Palette }) {
  const parts = decorPlacements(decorStyle(lib, scene.decor), scene.width, scene.height);
  return (
    <g pointerEvents="none">
      <rect width={scene.width} height={scene.height} fill={palette.bgLight} />
      {parts.map((d) => (
        <g key={d.name} transform={`translate(${d.tx} ${d.ty})`} dangerouslySetInnerHTML={{ __html: resolveMarkup(d.fragment.markup, palette) }} />
      ))}
    </g>
  );
});

export interface SceneViewProps {
  scene: Scene;
  lib: LibraryData;
  palette: Palette;
  interactive?: boolean;
  selected?: string | null;
  onSelect?: (uid: string | null) => void;
  onMove?: (uid: string, x: number, y: number) => void;
  onMoveEnd?: () => void;
  /** Objects glide into place once on mount. */
  intro?: boolean;
  /** The objects present on mount drop in one by one (CSS only; remount to replay). */
  dropIn?: boolean;
  /** Reports the screen box of the selected object (for the floating toolbar). */
  onSelectionBox?: (box: DOMRect | null) => void;
  className?: string;
  label?: string;
}

const INTRO_MS = 1500;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function SceneView(props: SceneViewProps) {
  const { scene, lib, palette, interactive, selected, onSelect, onMove, onMoveEnd, intro, dropIn, onSelectionBox, className, label } = props;
  /** Objects that drop in: the ones the scene had when it was mounted (later duplicates just appear). */
  const dropUids = useRef<Map<string, number> | null>(null);
  if (dropIn && !dropUids.current) dropUids.current = new Map(scene.items.map((it, i) => [it.uid, i]));
  const [, setDropsLeft] = useState(0);
  const finishDrop = (uid: string) => {
    if (dropUids.current?.delete(uid)) setDropsLeft(dropUids.current.size);
  };
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = 'clip' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const drag = useRef<{ uid: string; dx: number; dy: number; id: number } | null>(null);
  const [progress, setProgress] = useState(intro ? 0 : 1);

  useEffect(() => {
    if (!intro) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / INTRO_MS);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // The intro runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const onItemDown = (e: RPointerEvent<SVGGElement>, item: SceneItem) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelect?.(item.uid);
    const p = toSvg(e);
    drag.current = { uid: item.uid, dx: item.x - p.x, dy: item.y - p.y, id: e.pointerId };
    svgRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = toSvg(e);
    const x = Math.min(scene.width, Math.max(0, p.x + d.dx));
    const y = Math.min(scene.height, Math.max(0, p.y + d.dy));
    onMove?.(d.uid, Math.round(x * 100) / 100, Math.round(y * 100) / 100);
  };
  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    if (drag.current && drag.current.id === e.pointerId) {
      drag.current = null;
      onMoveEnd?.();
    }
  };

  // Report where the selected object is on screen. A layout effect runs before the browser paints, so the
  // floating toolbar is placed next to the object in the same frame instead of flashing at the canvas corner.
  const selRef = useRef<SVGPolygonElement | null>(null);
  // Last reported box. The effect runs after every render, so it reports only real changes; otherwise the
  // parent's state update would re-render this view and report again, forever.
  const lastBox = useRef<string>('');
  useLayoutEffect(() => {
    if (!onSelectionBox) return;
    const report = () => {
      const box = selRef.current ? selRef.current.getBoundingClientRect() : null;
      const key = box ? [box.left, box.top, box.width, box.height].map((v) => Math.round(v)).join(',') : '';
      if (key === lastBox.current) return;
      lastBox.current = key;
      onSelectionBox(box);
    };
    report();
    window.addEventListener('resize', report);
    window.addEventListener('scroll', report, true);
    return () => {
      window.removeEventListener('resize', report);
      window.removeEventListener('scroll', report, true);
    };
  });

  const items = useMemo(() => scene.items, [scene.items]);
  const n = items.length;

  return (
    <svg
      ref={svgRef}
      className={dropIn ? `${className ?? ''} demo-anim` : className}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      role="img"
      aria-label={label ?? 'Композиция'}
      onPointerDown={interactive ? () => onSelect?.(null) : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerUp : undefined}
      style={interactive ? { touchAction: 'none' } : undefined}
    >
      <defs>
        <clipPath id={clipId}>
          <rect width={scene.width} height={scene.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <Background scene={scene} lib={lib} palette={palette} />
        {items.map((item, i) => {
          const f = itemFragment(item, lib);
          let transform = itemTransform(item, f, scene.scale);
          let opacity = 1;
          if (progress < 1) {
            // Staggered glide from below-left, back to front.
            const start = (i / Math.max(1, n)) * 0.35;
            const t = easeOutCubic(Math.min(1, Math.max(0, (progress - start) / (1 - start))));
            const off = (1 - t) * Math.min(scene.width, scene.height) * 0.22;
            transform = `translate(${-off * 0.6} ${off}) ` + transform;
            opacity = Math.min(1, t * 1.6);
          }
          const isSel = interactive && selected === item.uid;
          const dropAt = dropUids.current?.get(item.uid);
          const art = (
            <g
              key={item.uid}
              transform={transform}
              opacity={opacity}
              onPointerDown={(e) => onItemDown(e, item)}
              className={interactive ? 'scene-item' : undefined}
              data-name={objectLabel(item)}
            >
              <ObjectArt html={cachedItemMarkup(item, lib, palette)} />
              {interactive && (
                <polygon
                  ref={isSel ? selRef : undefined}
                  points={f.hull.map((p) => `${f.x + p.x},${f.y + p.y}`).join(' ')}
                  fill="transparent"
                  pointerEvents="all"
                />
              )}
              {isSel && (
                // A plain outline, no handles: objects are moved, never resized (proportions are fixed by the TZ).
                <g pointerEvents="none" className="selection">
                  {/* The rect lives in the piece's own units, which are drawn at pieceScale (S pieces carry their
                      detail factor), so padding and radius are divided by it to look the same for S and L. */}
                  <rect
                    x={f.x - 10 / pieceScale(f, scene.scale)}
                    y={f.y - 10 / pieceScale(f, scene.scale)}
                    width={f.w + 20 / pieceScale(f, scene.scale)}
                    height={f.h + 20 / pieceScale(f, scene.scale)}
                    rx={14 / pieceScale(f, scene.scale)}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </g>
          );
          // The wrapper is always rendered so the element is never remounted. Its drop class is removed
          // once the drop has played: reordering layers moves the DOM node, and a node that still carries
          // the class would replay the animation and "jump" out of the scene.
          return (
            <g
              key={item.uid}
              className={dropAt === undefined ? undefined : 'demo-drop'}
              style={dropAt === undefined ? undefined : { animationDelay: `${260 + dropAt * 170}ms` }}
              onAnimationEnd={
                dropAt === undefined ? undefined : (e) => e.target === e.currentTarget && finishDrop(item.uid)
              }
            >
              {art}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
