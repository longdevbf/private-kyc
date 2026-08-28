import { useCallback, useRef } from 'react';

const still = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Pointer-driven 3D tilt. Writes CSS custom properties straight onto the
 * node rather than going through state, so a mousemove never triggers a
 * React render — the transform is composited and the main thread stays free.
 *
 * `--rx/--ry` drive the rotation, `--mx/--my` drive the specular highlight,
 * so a single pointer position lights the card and turns it together.
 */
export function useTilt(maxDeg = 9) {
  const ref = useRef<HTMLDivElement | null>(null);

  const set = (rx: string, ry: string, mx: string, my: string) => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', rx);
    el.style.setProperty('--ry', ry);
    el.style.setProperty('--mx', mx);
    el.style.setProperty('--my', my);
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el || still()) return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      set(
        `${(0.5 - py) * 2 * maxDeg}deg`,
        `${(px - 0.5) * 2 * maxDeg}deg`,
        `${px * 100}%`,
        `${py * 100}%`,
      );
    },
    [maxDeg],
  );

  const onPointerLeave = useCallback(() => set('0deg', '0deg', '50%', '0%'), []);

  return { ref, onPointerMove, onPointerLeave };
}
