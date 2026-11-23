import { useEffect, useState } from 'react';
import { reducedMotion } from './motion';

/** A number that counts up to its value when it first shows, then follows it. */
export function CountUp({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  useEffect(() => {
    if (reducedMotion()) return setShown(value);
    const from = shown;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 650);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="count-up">
      {shown}
      {suffix}
    </span>
  );
}
