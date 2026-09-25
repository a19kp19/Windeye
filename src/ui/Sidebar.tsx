import { LEGENDS } from "../render/palette";
import { advise } from "../sim/advice";
import { live } from "../state/fields";
import { type Layer, useStore } from "../state/store";
import { beaufort, compass, formatAge, formatFlow } from "./format";
import { WindRose } from "./WindRose";

function Section({
  index,
  title,
  children,
  id,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section className="tb-section" aria-labelledby={id}>
      <h2 id={id}>
        <span className="idx">{index}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function TitleBlock() {
  const plan = useStore((s) => s.plan);
  const status = useStore((s) => s.status);
  const weather = useStore((s) => s.weather);
  const setPlan = useStore((s) => s.setPlan);
  const date = new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="title-block">
      <div className="tb-cell wide">
        <label>
          <span>Project</span>
          <input
            value={plan.name}
            maxLength={40}
            aria-label="Project name"
            onChange={(e) => setPlan((p) => ({ ...p, name: e.target.value }), { coalesce: "name" })}
          />
        </label>
      </div>
      <div className="tb-cell">
        <span>Drawing</span>
        <strong>Airflow study</strong>
      </div>
      <div className="tb-cell">
        <span>Sheet</span>
        <strong>A-01</strong>
      </div>
      <div className="tb-cell">
        <span>Wind</span>
        <strong>
          {compass(weather.windFromDeg)} {weather.windSpeed.toFixed(1)} m/s
        </strong>
      </div>
      <div className="tb-cell">
        <span>Lattice</span>
        <strong>{status.dx ? `${(status.dx * 100).toFixed(1)} cm` : "—"}</strong>
      </div>
      <div className="tb-cell">
        <span>Ceiling</span>
        <label className="inline">
          <input
            type="number"
            step={0.1}
            min={2}
            max={5}
            value={plan.ceiling}
            aria-label="Ceiling height"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 2 && v <= 5) setPlan((p) => ({ ...p, ceiling: v }), { coalesce: "ceiling" });
            }}
          />
          m
        </label>
      </div>
      <div className="tb-cell">
        <span>Date</span>
        <strong>{date}</strong>
      </div>
    </div>
  );
}

export function WindPanel() {
  const weather = useStore((s) => s.weather);
  const setWeather = useStore((s) => s.setWeather);
  const plan = useStore((s) => s.plan);
  const setPlan = useStore((s) => s.setPlan);
  const bf = beaufort(weather.windSpeed);
  return (
    <Section index="01" title="Wind" id="sec-wind">
      <div className="wind-grid">
        <WindRose
          value={weather.windFromDeg}
          onChange={(windFromDeg) => setWeather({ windFromDeg })}
          north={0}
        />
        <div className="wind-controls">
          <label className="slider">
            <span>
              Speed <b>{weather.windSpeed.toFixed(1)} m/s</b>
            </span>
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={weather.windSpeed}
              aria-label="Wind speed"
              onChange={(e) => setWeather({ windSpeed: Number(e.target.value) })}
            />
            <em>
              F{bf.force} · {bf.name.toLowerCase()} · {(weather.windSpeed * 3.6).toFixed(0)} km/h
            </em>
          </label>
          <div className="field">
            <span>Surroundings</span>
            <div className="segmented small" role="radiogroup" aria-label="Surroundings">
              {(["sheltered", "suburban", "open"] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={weather.exposure === x}
                  className={weather.exposure === x ? "on" : ""}
                  onClick={() => setWeather({ exposure: x })}
                >
                  {x === "sheltered" ? "City" : x === "suburban" ? "Suburb" : "Open"}
                </button>
              ))}
            </div>
          </div>
          <label className="slider">
            <span>
              Plan north <b>{Math.round(plan.northDeg)}°</b>
            </span>
            <input
              type="range"
              min={0}
              max={355}
              step={5}
              value={plan.northDeg}
              aria-label="Rotate plan north"
              onChange={(e) =>
                setPlan((p) => ({ ...p, northDeg: Number(e.target.value) }), { coalesce: "north" })
              }
            />
          </label>
        </div>
      </div>
    </Section>
  );
}

const LAYER_INFO: Record<Exclude<Layer, "none">, { name: string; blurb: string; ticks: string[] }> = {
  fresh: {
    name: "Fresh air",
    blurb: "Live: how much of each spot's air has come in from outside since the clock started.",
    ticks: ["old air", "half", "all fresh"],
  },
  age: {
    name: "Air age",
    blurb: "Average time the air at a spot has been indoors (steady state).",
    ticks: ["0", "5", "20+ min"],
  },
  breeze: {
    name: "Breeze",
    blurb: "How much cooler the moving air feels to a lightly dressed person.",
    ticks: ["still", "1", "3 °C"],
  },
};

function LegendRamp({ layer }: { layer: Exclude<Layer, "none"> }) {
  const stops = LEGENDS[layer];
  const max = stops[stops.length - 1][0];
  const grad = stops
    .map(
      ([x, c]) =>
        `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.15, c[3] / 255)}) ${((x / max) * 100).toFixed(1)}%`,
    )
    .join(", ");
  const info = LAYER_INFO[layer];
  return (
    <div className="legend">
      <div className="ramp" style={{ background: `linear-gradient(90deg, ${grad})` }} />
      <div className="ticks">
        {info.ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <p>{info.blurb}</p>
    </div>
  );
}

export function LayersPanel() {
  const layer = useStore((s) => s.layer);
  const setLayer = useStore((s) => s.setLayer);
  const streaks = useStore((s) => s.streaks);
  const setStreaks = useStore((s) => s.setStreaks);
  return (
    <Section index="02" title="Show" id="sec-layers">
      <div className="segmented" role="radiogroup" aria-label="Colour wash">
        {(["fresh", "age", "breeze", "none"] as Layer[]).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={layer === l}
            className={layer === l ? "on" : ""}
            onClick={() => setLayer(l)}
          >
            {l === "none" ? "Plain" : LAYER_INFO[l].name}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={streaks} onChange={(e) => setStreaks(e.target.checked)} />
        <span>Streaklines (real-time air movement)</span>
      </label>
      {layer !== "none" && <LegendRamp layer={layer} />}
    </Section>
  );
}

export function ReportPanel() {
  const metrics = useStore((s) => s.metrics);
  const plan = useStore((s) => s.plan);
  const hoverRoom = useStore((s) => s.hoverRoom);
  const setHoverRoom = useStore((s) => s.setHoverRoom);
  useStore((s) => s.rasterSeq);
  const raster = live.raster;
  const advice = metrics && raster ? advise(plan, metrics, raster) : [];
  const rooms = metrics ? metrics.rooms.filter((r) => r.area >= 1.2) : [];
  const maxAge = Math.max(300, ...rooms.map((r) => (Number.isFinite(r.meanAge) ? r.meanAge : 0)));
  return (
    <Section index="03" title="Reading" id="sec-report">
      {!metrics ? (
        <p className="muted">Letting the air settle…</p>
      ) : (
        <>
          <div className="bignums">
            <div>
              <b data-testid="home-ach">{metrics.home.ach.toFixed(1)}</b>
              <span>air changes / h</span>
            </div>
            <div>
              <b>{formatFlow(metrics.home.outdoorAir)}</b>
              <span>outdoor air in</span>
            </div>
            <div>
              <b>{formatAge(metrics.home.meanAge)}</b>
              <span>mean air age</span>
            </div>
          </div>
          {advice.length > 0 && (
            <ul className="advice" data-testid="advice">
              {advice.map((a) => (
                <li key={a.text} className={`tone-${a.tone}`}>
                  {a.text}
                </li>
              ))}
            </ul>
          )}
          <table className="rooms">
            <thead>
              <tr>
                <th>Room</th>
                <th>Air age</th>
                <th title="Effective air changes per hour">ACH</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr
                  key={r.index}
                  className={hoverRoom === r.index ? "is-hover" : ""}
                  onPointerEnter={() => setHoverRoom(r.index)}
                  onPointerLeave={() => setHoverRoom(null)}
                >
                  <td>{r.name}</td>
                  <td>
                    <span className="agebar">
                      <span
                        style={{
                          width: `${Math.min(100, ((Number.isFinite(r.meanAge) ? r.meanAge : maxAge) / maxAge) * 100)}%`,
                        }}
                      />
                    </span>
                    {formatAge(r.meanAge)}
                  </td>
                  <td>{r.ach >= 100 ? "99+" : r.ach.toFixed(r.ach < 10 ? 1 : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Section>
  );
}
