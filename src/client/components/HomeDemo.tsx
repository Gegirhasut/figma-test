// Demo on the home page, run once: «Вечер с книгой» is typed into the real
// input, the button presses, and the composition from the real engine
// assembles itself (background first, then objects drop in paint order). The
// result stays on screen. Any interaction stops the demo for good.
//
// Only CSS transforms and opacity are animated, on the scene's own SVG groups;
// React renders the frame once per step, not per animation frame.

import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, type CSSProperties } from 'react';
import { layoutScene } from '../../shared/layout';
import { SCHEMES, resolveMarkup } from '../../shared/palette';
import { decorPlacements, decorStyle, itemFragment, itemMarkup, itemTransform } from '../../shared/render';
import type { LibraryData, Palette, Scene } from '../../shared/types';
import { DEMO_EXAMPLE, type DemoExample } from '../demo-examples';
import { Cancelled, demoReducer, initialDemo, runDemo, visibleWait, type DemoView } from '../demo-run';

/** Delay between objects dropping in. */
const DROP_STAGGER_MS = 170;
/** The objects start once the frame background has faded in. */
const BG_FADE_MS = 260;

export function paletteOf(ex: DemoExample): Palette {
  return (SCHEMES.find((s) => s.id === ex.scheme) ?? SCHEMES[0]).colors;
}

export interface DemoState extends DemoView {
  scene: Scene | null;
  stop: () => void;
}

/**
 * Drives the single run. Each effect run has its own cancel flag, so React
 * StrictMode (which mounts effects twice in development) or leaving the page
 * never stops the demo for good — only `stop()`, called on a real user
 * interaction, does. Time only counts while the tab is visible.
 */
export function useHomeDemo(lib: LibraryData | null): DemoState {
  const reduced = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const [view, dispatch] = useReducer(demoReducer, undefined, () => initialDemo(reduced, DEMO_EXAMPLE.phrase));
  const stopped = useRef(false);

  const scene = useMemo(
    () => (lib ? layoutScene({ objects: DEMO_EXAMPLE.objects, format: DEMO_EXAMPLE.format, size: 'L', variant: DEMO_EXAMPLE.variant }, lib, 'demo-') : null),
    [lib],
  );

  const stop = useCallback(() => {
    stopped.current = true;
    dispatch({ type: 'stop' });
  }, []);

  useEffect(() => {
    if (!lib || reduced || stopped.current || view.built) return;
    let cancelled = false;
    runDemo(DEMO_EXAMPLE.phrase, dispatch, visibleWait(() => cancelled || stopped.current)).catch((e) => {
      if (!(e instanceof Cancelled)) throw e;
    });
    return () => {
      cancelled = true;
    };
    // Starts once the library is there; a finished or stopped demo is never restarted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib, reduced]);

  return { ...view, scene, stop };
}

interface DemoSceneProps {
  scene: Scene;
  lib: LibraryData;
  palette: Palette;
  animate: boolean;
  label: string;
}

/** The scene as plain SVG with one wrapper group per object for the drop animation. */
export const DemoScene = memo(function DemoScene({ scene, lib, palette, animate, label }: DemoSceneProps) {
  const clipId = 'democlip' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const parts = decorPlacements(decorStyle(lib, scene.decor), scene.width, scene.height);
  return (
    <svg className={`scene${animate ? ' demo-anim' : ''}`} viewBox={`0 0 ${scene.width} ${scene.height}`} role="img" aria-label={label}>
      <defs>
        <clipPath id={clipId}>
          <rect width={scene.width} height={scene.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width={scene.width} height={scene.height} fill={palette.bgLight} />
        <g className="demo-bg">
          {parts.map((d) => (
            <g key={d.name} transform={`translate(${d.tx} ${d.ty})`} dangerouslySetInnerHTML={{ __html: resolveMarkup(d.fragment.markup, palette) }} />
          ))}
        </g>
        {scene.items.map((item, i) => (
            <g key={item.uid} className="demo-drop" style={{ animationDelay: `${BG_FADE_MS + i * DROP_STAGGER_MS}ms` } as CSSProperties}>
              <g transform={itemTransform(item, itemFragment(item, lib), scene.scale)} dangerouslySetInnerHTML={{ __html: itemMarkup(item, lib, palette) }} />
            </g>
          ))}
      </g>
    </svg>
  );
});

interface DemoFrameProps {
  lib: LibraryData | null;
  scene: Scene | null;
  example: DemoExample;
  built: boolean;
  animate: boolean;
}

/**
 * The frame takes the demo's own aspect ratio, so no space is reserved around
 * it. Until the build starts it keeps its place but shows nothing (no empty
 * decorated background); then background and objects come in together.
 */
export const DemoFrame = memo(function DemoFrame({ lib, scene, example, built, animate }: DemoFrameProps) {
  const palette = paletteOf(example);
  const w = scene?.width ?? 1200;
  const h = scene?.height ?? 630;
  const show = built && !!scene && !!lib;
  return (
    <div className={`demo-frame${show ? '' : ' waiting'}`} style={{ aspectRatio: `${w} / ${h}`, background: show ? palette.bgLight : undefined } as CSSProperties} aria-busy={!show}>
      {show ? <DemoScene scene={scene} lib={lib} palette={palette} animate={animate} label={`Пример: ${example.phrase}`} /> : null}
    </div>
  );
});
