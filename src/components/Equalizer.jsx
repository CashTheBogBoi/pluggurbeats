import { useMemo } from "react";

// 64 bars with randomized animation timing, computed once on mount.
export default function Equalizer() {
  const bars = useMemo(
    () => Array.from({ length: 64 }, () => ({
      delay: (Math.random() * 1.3).toFixed(2),
      dur: (0.9 + Math.random() * 0.9).toFixed(2)
    })),
    []
  );
  return (
    <div className="eq" aria-hidden="true">
      {bars.map((b, i) => (
        <span key={i} style={{ animationDelay: `-${b.delay}s`, animationDuration: `${b.dur}s` }} />
      ))}
    </div>
  );
}
