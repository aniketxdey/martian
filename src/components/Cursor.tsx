/**
 * Orange cursor follower for regions you click or drag: the graph canvases, zoomable
 * charts and the agent run list. Mark a region with data-cursor="Drag" (or "Open",
 * "Zoom"); a child can override the label with data-cursor-label. Everywhere else the
 * native cursor is left alone. Off on touch and coarse pointers and when motion is reduced.
 */
import { useEffect, useRef } from 'react';
import { usePrefs } from '../app/prefs';

export function Cursor() {
  const { prefs } = usePrefs();
  const ring = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fine = window.matchMedia?.('(pointer: fine)').matches ?? false;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!fine || reduced || prefs.reduceMotion) return;
    const root = document.documentElement;
    let x = -100;
    let y = -100;
    let rx = x;
    let ry = y;
    let on = false;
    let raf = 0;
    let text = '';

    const frame = () => {
      // Ease the ring toward the pointer; the dot is exact.
      rx += (x - rx) * 0.24;
      ry += (y - ry) * 0.24;
      if (ring.current) ring.current.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      raf = Math.abs(x - rx) + Math.abs(y - ry) > 0.3 ? requestAnimationFrame(frame) : 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

    const update = (el: Element | null) => {
      const region = el?.closest('[data-cursor-off]') ? null : el?.closest<HTMLElement>('[data-cursor]');
      const now = !!region;
      if (now !== on) {
        on = now;
        if (on) {
          // Show up under the pointer, not wherever the ring was last drawn.
          rx = x; ry = y;
          const at = `translate3d(${x}px, ${y}px, 0)`;
          if (ring.current) ring.current.style.transform = at;
          if (dot.current) dot.current.style.transform = at;
        }
        ring.current?.classList.toggle('is-on', on);
        dot.current?.classList.toggle('is-on', on);
        root.classList.toggle('cursor-active', on);
      }
      const want = on ? (el?.closest<HTMLElement>('[data-cursor-label]')?.dataset.cursorLabel ?? region?.dataset.cursor ?? '') : '';
      if (want !== text) {
        text = want;
        if (label.current) label.current.textContent = text;
        ring.current?.classList.toggle('has-label', !!text);
      }
      if (on) kick();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      update(e.target instanceof Element ? e.target : null);
    };
    // Dialogs and route changes can swap what's under a still pointer.
    const recheck = () => requestAnimationFrame(() => update(document.elementFromPoint(x, y)));
    const onLeave = () => {
      on = false;
      ring.current?.classList.remove('is-on');
      dot.current?.classList.remove('is-on');
      root.classList.remove('cursor-active');
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('click', recheck, true);
    window.addEventListener('keyup', recheck, true);
    window.addEventListener('scroll', recheck, { passive: true, capture: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', recheck, true);
      window.removeEventListener('keyup', recheck, true);
      window.removeEventListener('scroll', recheck, true);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      root.classList.remove('cursor-active');
    };
  }, [prefs.reduceMotion]);

  return (
    <>
      <div ref={ring} className="cursor-ring" aria-hidden="true"><span ref={label} /></div>
      <div ref={dot} className="cursor-dot" aria-hidden="true" />
    </>
  );
}
