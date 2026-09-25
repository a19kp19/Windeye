import { bearingToPlan, planBounds } from "../../model/geometry";
import type { Plan } from "../../model/types";
import { EXPOSURE_FACTOR } from "../../sim/scene";
import { useStore } from "../../state/store";
import { compass } from "../format";
import { toScreen, type View } from "./view";

/** Meteorological wind barb (staff points into the wind; 10 kt per full barb, 50 kt pennant). */
function Barb({ knots }: { knots: number }) {
  const L = 34;
  const els: React.ReactNode[] = [<line key="staff" x1={0} y1={0} x2={0} y2={-L} />];
  // Capped: for huge values `k -= 50` stops changing k and the loops below never end.
  let k = Math.round(Math.min(knots, 200) / 5) * 5;
  let y = -L;
  if (k < 5) return <circle r={5} className="calm" />;
  while (k >= 50) {
    els.push(<path key={`p${y}`} d={`M 0 ${y} l 12 3 l -12 5 z`} className="pennant" />);
    y += 9;
    k -= 50;
  }
  while (k >= 10) {
    els.push(<line key={`f${y}`} x1={0} y1={y} x2={13} y2={y - 5} />);
    y += 5.5;
    k -= 10;
  }
  if (k >= 5)
    els.push(
      <line key={`h${y}`} x1={0} y1={y + (y === -L ? 5 : 0)} x2={7} y2={y - 2.5 + (y === -L ? 5 : 0)} />,
    );
  return <g className="barb">{els}</g>;
}

export function WindBadge({
  plan,
  view,
  width,
  height,
}: {
  plan: Plan;
  view: View;
  width: number;
  height: number;
}) {
  const weather = useStore((s) => s.weather);
  const b = planBounds(plan);
  const c = toScreen(view, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
  const R = (Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2) * view.scale;
  const toward = bearingToPlan(weather.windFromDeg + 180, plan.northDeg);
  const calm = weather.windSpeed < 0.3;
  const pad = 64;
  const ax = Math.min(width - pad, Math.max(pad, c.x - toward.x * (R + 58)));
  const ay = Math.min(height - pad, Math.max(pad, c.y - toward.y * (R + 58)));
  const ang = (Math.atan2(toward.y, toward.x) * 180) / Math.PI;
  const facade = weather.windSpeed * EXPOSURE_FACTOR[weather.exposure];
  const northAng = plan.northDeg;
  return (
    <g className="wind-badge" pointerEvents="none">
      {!calm && (
        <g transform={`translate(${ax} ${ay})`}>
          <g transform={`rotate(${ang})`}>
            {[-14, 0, 14].map((o, i) => (
              <path
                key={o}
                className={`wind-stream s${i}`}
                d={`M -46 ${o} C -24 ${o - 4}, -8 ${o + 4}, 18 ${o} `}
                markerEnd="url(#wind-head)"
              />
            ))}
          </g>
          <g transform={`translate(0 30) rotate(${ang - 90 + 180}) `}>
            <Barb knots={weather.windSpeed * 1.944} />
          </g>
          <text className="wind-label" y={-26} textAnchor="middle">
            {compass(weather.windFromDeg)} {weather.windSpeed.toFixed(1)} m/s
          </text>
          <text className="wind-sub" y={-14} textAnchor="middle">
            ≈ {facade.toFixed(1)} m/s at the façade
          </text>
        </g>
      )}
      <defs>
        <marker
          id="wind-head"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M 0 1 L 9 5 L 0 9 z" className="wind-head" />
        </marker>
      </defs>
      <g className="north" transform={`translate(${width - 40} 44) rotate(${northAng})`}>
        <circle r={17} />
        <path d="M 0 -15 L 6 6 L 0 2 L -6 6 Z" />
        <text y={-21} textAnchor="middle" transform={`rotate(${-northAng} 0 -25)`}>
          N
        </text>
      </g>
    </g>
  );
}
