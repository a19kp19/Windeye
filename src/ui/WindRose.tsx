import { useRef } from "react";
import { compass } from "./format";

/**
 * A compass dial: drag anywhere to set where the wind comes FROM (meteorological convention).
 * The fletched arrow starts on the windward rim and flies across the dial.
 */
export function WindRose({
  value,
  onChange,
  north = 0,
}: {
  value: number;
  onChange: (deg: number) => void;
  north?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const set = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < 6) return;
    const deg = (Math.atan2(x, -y) * 180) / Math.PI;
    onChange(Math.round(((deg + 360) % 360) / 5) * 5);
  };
  const R = 62;
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  return (
    <svg
      ref={ref}
      className="wind-rose"
      viewBox="-80 -80 160 160"
      role="slider"
      tabIndex={0}
      aria-label="Wind direction (where the wind comes from)"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={value}
      aria-valuetext={`from ${compass(value)}, ${value} degrees`}
      onPointerDown={(e) => {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => e.buttons && set(e)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange((value + 355) % 360);
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange((value + 5) % 360);
      }}
    >
      <circle r={R} className="rim" />
      <circle r={R - 16} className="inner" />
      {ticks.map((t) => (
        <line
          key={t}
          className={t % 90 === 0 ? "tick major" : t % 45 === 0 ? "tick mid" : "tick"}
          x1={0}
          y1={-R}
          x2={0}
          y2={-R + (t % 90 === 0 ? 9 : t % 45 === 0 ? 6 : t % 15 === 0 ? 4 : 2)}
          transform={`rotate(${t})`}
        />
      ))}
      {["N", "E", "S", "W"].map((l, i) => (
        <text
          key={l}
          className="cardinal"
          transform={`rotate(${i * 90}) translate(0 ${-R - 8}) rotate(${-i * 90})`}
          textAnchor="middle"
          dy="3.5"
        >
          {l}
        </text>
      ))}
      <g transform={`rotate(${value})`} className="needle">
        <line x1={0} y1={-R - 2} x2={0} y2={R - 22} />
        <path d={`M 0 ${R - 12} l -6 -12 l 12 0 z`} />
        {[0, 6, 12].map((o) => (
          <g key={o}>
            <line x1={0} y1={-R + 2 + o} x2={-6} y2={-R - 4 + o} />
            <line x1={0} y1={-R + 2 + o} x2={6} y2={-R - 4 + o} />
          </g>
        ))}
      </g>
      <g transform={`rotate(${north})`} className="plan-north" aria-hidden>
        <path d="M 0 -30 L 4 -18 L -4 -18 Z" />
      </g>
      <text className="readout" y={4} textAnchor="middle">
        {compass(value)}
      </text>
      <text className="readout-sub" y={16} textAnchor="middle">
        {value}°
      </text>
    </svg>
  );
}
