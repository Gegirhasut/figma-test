// The home-page demo as a pure state machine plus a cancellable script, so the
// rules can be tested without a browser:
//  • whenever the demo stops early, the finished composition is shown complete;
//  • cancelling one run (React StrictMode mounts effects twice in development,
//    and leaving the home page unmounts them) never stops the next run — only
//    a real user interaction does.

export interface DemoView {
  /** Typing has not finished and nothing the visitor did has stopped it. */
  active: boolean;
  /** Text shown in the input as a ghost value. */
  ghost: string;
  /** The caret blinks while typing. */
  typing: boolean;
  /** The submit button shows its press. */
  pressing: boolean;
  /** The composition is shown (false: the frame keeps its place but shows nothing). */
  built: boolean;
  /** Background and objects animate in (false: they are simply there). */
  animate: boolean;
  /** The visitor took over: the demo never runs again on this page. */
  stopped: boolean;
}

export type DemoEvent = { type: 'type'; text: string } | { type: 'press' } | { type: 'build' } | { type: 'stop' };

export function initialDemo(reducedMotion: boolean, phrase: string): DemoView {
  // Reduced motion: the finished composition and the whole phrase, no typing, no falling.
  return reducedMotion
    ? { active: false, ghost: phrase, typing: false, pressing: false, built: true, animate: false, stopped: false }
    : { active: true, ghost: '', typing: true, pressing: false, built: false, animate: false, stopped: false };
}

export function demoReducer(s: DemoView, e: DemoEvent): DemoView {
  if (s.stopped) return s;
  switch (e.type) {
    case 'type':
      return { ...s, ghost: e.text };
    case 'press':
      return { ...s, pressing: true };
    case 'build':
      return { ...s, pressing: false, typing: false, active: false, built: true, animate: true };
    case 'stop':
      // The input clears for real typing; the composition is shown complete, without starting a fall.
      return { active: false, ghost: '', typing: false, pressing: false, built: true, animate: s.built ? s.animate : false, stopped: true };
  }
}

export class Cancelled extends Error {}

/** Waits `ms` of visible time; rejects with Cancelled as soon as `cancelled()` is true. */
export type Wait = (ms: number) => Promise<void>;

export function visibleWait(cancelled: () => boolean, now: () => number = () => performance.now(), hidden: () => boolean = () => document.hidden): Wait {
  return (ms) =>
    new Promise<void>((resolve, reject) => {
      let left = ms;
      let last = now();
      const step = () => {
        if (cancelled()) return reject(new Cancelled());
        const t = now();
        if (!hidden()) left -= t - last;
        last = t;
        if (left <= 0) resolve();
        else setTimeout(step, Math.min(left, 100));
      };
      setTimeout(step, Math.min(ms, 100));
    });
}

/** The script: type the phrase, press the button, build. */
export async function runDemo(phrase: string, dispatch: (e: DemoEvent) => void, wait: Wait, jitter: () => number = Math.random): Promise<void> {
  await wait(500);
  for (let i = 1; i <= phrase.length; i++) {
    dispatch({ type: 'type', text: phrase.slice(0, i) });
    await wait(60 + jitter() * 20);
  }
  await wait(260);
  dispatch({ type: 'press' });
  await wait(200);
  dispatch({ type: 'build' });
}
