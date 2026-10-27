import { useEffect, useRef, useState } from 'react';

/** Tweens to a new value so live numbers glide instead of jumping. */
export function useTween(value: number, ms = 650) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const reduced = document.documentElement.classList.contains('reduce-motion');
    if (reduced || Math.abs(value - from.current) < 1e-9) { from.current = value; setShown(value); return; }
    const start = performance.now();
    const a = from.current;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const v = a + (value - a) * e;
      setShown(v);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else from.current = value;
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf.current); from.current = value; };
  }, [value, ms]);
  return shown;
}

export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const v = useTween(value);
  return <span className="tabular-nums">{format(v)}</span>;
}
