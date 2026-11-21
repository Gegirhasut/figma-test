import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DemoFrame } from '../src/client/components/HomeDemo';
import { DEMO_EXAMPLE } from '../src/client/demo-examples';
import { Cancelled, demoReducer, initialDemo, runDemo, type DemoEvent, type DemoView, type Wait } from '../src/client/demo-run';
import { layoutScene } from '../src/shared/layout';
import { loadLibrary } from '../src/shared/library-fs';

const PHRASE = DEMO_EXAMPLE.phrase;
const play = (events: DemoEvent[], from = initialDemo(false, PHRASE)) => events.reduce(demoReducer, from);

describe('demo state', () => {
  it('starts invisible: nothing built yet, so no empty decorated frame', () => {
    const s = initialDemo(false, PHRASE);
    expect(s.built).toBe(false);
    expect(s.active).toBe(true);
  });

  it('stopping before the build shows the finished composition at once, without a fall', () => {
    for (const before of [[], [{ type: 'type', text: 'Веч' }], [{ type: 'type', text: PHRASE }, { type: 'press' }]] as DemoEvent[][]) {
      const s = play([...before, { type: 'stop' }]);
      expect(s).toMatchObject({ built: true, animate: false, ghost: '', typing: false, pressing: false, active: false, stopped: true });
    }
  });

  it('stopping after the build keeps the composition', () => {
    const s = play([{ type: 'type', text: PHRASE }, { type: 'press' }, { type: 'build' }, { type: 'stop' }]);
    expect(s.built).toBe(true);
    expect(s.ghost).toBe('');
  });

  it('nothing changes the demo after a stop', () => {
    const s = play([{ type: 'stop' }, { type: 'type', text: 'x' }, { type: 'press' }]);
    expect(s.ghost).toBe('');
    expect(s.pressing).toBe(false);
  });

  it('reduced motion: the finished composition and the whole phrase, no animation', () => {
    expect(initialDemo(true, PHRASE)).toMatchObject({ built: true, animate: false, typing: false, ghost: PHRASE });
  });
});

describe('demo script', () => {
  const instant = (cancelled: () => boolean): Wait => async () => {
    if (cancelled()) throw new Cancelled();
  };

  it('types the phrase, presses and builds', async () => {
    let s: DemoView = initialDemo(false, PHRASE);
    await runDemo(PHRASE, (e) => (s = demoReducer(s, e)), instant(() => false), () => 0);
    expect(s).toMatchObject({ ghost: PHRASE, built: true, animate: true, active: false, typing: false });
  });

  it('a cancelled run (StrictMode double mount, leaving the page) does not stop the next one', async () => {
    let s: DemoView = initialDemo(false, PHRASE);
    const dispatch = (e: DemoEvent) => (s = demoReducer(s, e));
    let firstCancelled = false;
    const first = runDemo(PHRASE, dispatch, instant(() => firstCancelled));
    firstCancelled = true;
    await expect(first).rejects.toBeInstanceOf(Cancelled);
    await runDemo(PHRASE, dispatch, instant(() => false));
    expect(s.built).toBe(true);
    expect(s.stopped).toBe(false);
  });
});

describe('demo frame', () => {
  const lib = loadLibrary('L');
  const scene = layoutScene({ objects: DEMO_EXAMPLE.objects, format: DEMO_EXAMPLE.format, size: 'L', variant: DEMO_EXAMPLE.variant }, lib, 'demo-');
  const render = (built: boolean, animate: boolean, withLib = true) =>
    renderToStaticMarkup(createElement(DemoFrame, { lib: withLib ? lib : null, scene: withLib ? scene : null, example: DEMO_EXAMPLE, built, animate }));

  it('the stopped-early frame has the whole composition: background and every object', () => {
    const html = render(true, false);
    expect(html).toContain('<svg');
    expect(html.match(/class="demo-drop"/g)).toHaveLength(DEMO_EXAMPLE.objects.length);
    expect(html).toContain('class="demo-bg"');
    expect(html).not.toContain('demo-anim');
  });

  it('before the build the frame keeps its place but shows nothing', () => {
    for (const html of [render(false, false), render(true, false, false)]) {
      expect(html).toContain('demo-frame waiting');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('demo-bg');
    }
  });
});
