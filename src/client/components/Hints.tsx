// The one-time hint after the first result: a small bubble inside the lower
// part of the canvas (it never covers the «Использованы» line), with «Понятно».

import { useEffect, useState, type RefObject } from 'react';
import { FIRST_RESULT_HINT } from '../onboarding';

export function FirstResultHint({ target, onClose }: { target: RefObject<HTMLElement>; onClose: () => void }) {
  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBox(target.current?.getBoundingClientRect() ?? null));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [target, onClose]);

  if (!box) return null;
  const vw = document.documentElement.clientWidth;
  const width = Math.min(340, box.width - 24, vw - 24);
  const left = Math.max(12, box.left + box.width / 2 - width / 2);
  // Anchored to the bottom edge of the canvas, inside it.
  const bottom = Math.max(12, window.innerHeight - box.bottom + 14);
  return (
    <div className="hint" role="status" aria-live="polite" style={{ left, bottom, width }}>
      <p>{FIRST_RESULT_HINT}</p>
      <button className="btn small" onClick={onClose}>
        Понятно
      </button>
    </div>
  );
}
