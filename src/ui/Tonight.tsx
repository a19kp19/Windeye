import { useEffect, useMemo, useRef, useState } from "react";
import { compassName } from "../model/compass";
import { OptPool } from "../sim/optClient";
import { live } from "../state/fields";
import { useStore } from "../state/store";
import { type Mass, planNight } from "../weather/nightplan";
import {
  currentHourIndex,
  type Forecast,
  fetchForecast,
  type Place,
  searchPlaces,
} from "../weather/openmeteo";

const PLACE_KEY = "windeye:place";
const HOURS = 36;
const REF_WIND = 4;

function hourLabel(t: string) {
  return `${t.slice(11, 13)}:00`;
}

function MiniBarb({ speed, from, x, y }: { speed: number; from: number; x: number; y: number }) {
  const kt = speed * 1.944;
  const barbs: React.ReactNode[] = [];
  let k = Math.round(Math.min(kt, 200) / 5) * 5; // capped so the loop always ends
  let yy = -13;
  while (k >= 10) {
    barbs.push(<line key={yy} x1={0} y1={yy} x2={5} y2={yy - 2.5} />);
    yy += 3;
    k -= 10;
  }
  if (k >= 5) barbs.push(<line key="h" x1={0} y1={yy} x2={3} y2={yy - 1.5} />);
  return (
    <g transform={`translate(${x} ${y}) rotate(${from})`} className="mini-barb">
      {kt < 2.5 ? (
        <circle r={2.5} />
      ) : (
        <>
          <line x1={0} y1={0} x2={0} y2={-13} />
          {barbs}
        </>
      )}
    </g>
  );
}

export function Tonight() {
  const plan = useStore((s) => s.plan);
  const weather = useStore((s) => s.weather);
  const setWeather = useStore((s) => s.setWeather);
  const metrics = useStore((s) => s.metrics);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(() => {
    try {
      const raw = localStorage.getItem(PLACE_KEY);
      return raw ? (JSON.parse(raw) as Place) : null;
    } catch {
      return null;
    }
  });
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [indoor, setIndoor] = useState(27);
  const [mass, setMass] = useState<Mass>("medium");
  const [ach, setAch] = useState<{ byDir: Record<number, number>; calm: number; key: string } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pool = useRef<OptPool | null>(null);

  useEffect(() => () => pool.current?.dispose(), []);

  useEffect(() => {
    if (!place) return;
    const ctl = new AbortController();
    setMsg("Fetching forecast…");
    fetchForecast(place.lat, place.lon, ctl.signal)
      .then((f) => {
        setForecast(f);
        setMsg(null);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setMsg(`Couldn't load the forecast: ${e.message}`);
      });
    return () => ctl.abort();
  }, [place]);

  const hours = useMemo(() => {
    if (!forecast) return [];
    const i0 = currentHourIndex(forecast);
    return forecast.times.slice(i0, i0 + HOURS).map((time, k) => ({
      time,
      temp: forecast.temp[i0 + k],
      windSpeed: forecast.windSpeed[i0 + k],
      windDir: forecast.windDir[i0 + k],
    }));
  }, [forecast]);

  // Simulate the current setup once per wind direction the forecast actually contains.
  const setupKey = JSON.stringify([
    plan.walls,
    plan.openings.map((o) => [o.id, o.state, o.offset, o.width]),
    plan.fans,
    plan.northDeg,
    weather.exposure,
  ]);
  // From the live metrics, so the effect below re-runs once the first room gets closed off.
  const hasRooms = (metrics?.rooms.length ?? 0) > 0;
  const noRooms = metrics !== null && metrics.rooms.length === 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: setupKey captures the parts of plan/weather that matter
  useEffect(() => {
    if (!hours.length || !live.raster) return;
    if (!hasRooms) {
      // No enclosed room means no indoor air to simulate or floor area to heat.
      pool.current?.dispose();
      pool.current = null;
      setAch(null);
      setMsg(null);
      return;
    }
    // Debounced: clicking through windows shouldn't launch a batch of simulations per click.
    const timer = setTimeout(() => {
      const dirs = [...new Set(hours.map((h) => Math.round(h.windDir / 45) % 8))];
      const fansOn = plan.fans.some((f) => f.on);
      pool.current?.dispose();
      const p = new OptPool();
      pool.current = p;
      setAch(null);
      let done = 0;
      const total = dirs.length + (fansOn ? 1 : 0);
      setMsg(`Simulating your home in tonight's winds (0/${total})…`);
      const byDir: Record<number, number> = {};
      let calm = 1.2;
      const jobs = dirs.map((d) =>
        p
          .run({
            id: `d${d}`,
            plan,
            weather: { ...weather, windFromDeg: d * 45, windSpeed: REF_WIND },
            targetCells: 8000,
          })
          .then((r) => {
            byDir[d] = r.metrics.home.ach;
            setMsg(`Simulating your home in tonight's winds (${++done}/${total})…`);
          }),
      );
      if (fansOn) {
        jobs.push(
          p.run({ id: "calm", plan, weather: { ...weather, windSpeed: 0 }, targetCells: 8000 }).then((r) => {
            calm = Math.max(calm, r.metrics.home.ach);
            setMsg(`Simulating your home in tonight's winds (${++done}/${total})…`);
          }),
        );
      }
      Promise.all(jobs)
        .then(() => {
          if (pool.current !== p) return;
          setAch({ byDir, calm, key: setupKey });
          setMsg(null);
          p.dispose();
          pool.current = null;
        })
        .catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [hours, setupKey, hasRooms]);

  const night = useMemo(() => {
    if (!hours.length || !ach || !hasRooms || !live.raster || live.raster.indoorArea <= 0) return null;
    return planNight(
      hours,
      (h) => {
        const base = ach.byDir[Math.round(h.windDir / 45) % 8] ?? metrics?.home.ach ?? 3;
        return Math.max(ach.calm, (base * h.windSpeed) / REF_WIND);
      },
      { indoorStart: indoor, floorArea: live.raster.indoorArea, ceiling: plan.ceiling, mass, floorTemp: 20 },
    );
  }, [hours, ach, hasRooms, indoor, mass, plan.ceiling, metrics]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setMsg("Searching…");
    try {
      const res = await searchPlaces(query.trim());
      setPlaces(res);
      setMsg(res.length ? null : "No matching places.");
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const choose = (p: Place) => {
    setPlace(p);
    setPlaces([]);
    setQuery("");
    try {
      localStorage.setItem(PLACE_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };
  const locate = () => {
    if (!navigator.geolocation) return setMsg("Location isn't available in this browser.");
    setMsg("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => choose({ name: "Your location", lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setMsg("Location permission denied — search for a town instead."),
      { timeout: 10000 },
    );
  };

  // Chart geometry.
  const W = 318;
  const Hc = 150;
  const padL = 26;
  const padR = 6;
  const padT = 24;
  const padB = 20;
  const temps = night
    ? night.hours.flatMap((h) => [h.temp, h.indoor, h.indoorShut])
    : hours.map((h) => h.temp);
  const tMin = Math.floor(Math.min(...temps, indoor) - 1);
  const tMax = Math.ceil(Math.max(...temps, indoor) + 1);
  const xs = (i: number) => padL + (i / Math.max(1, hours.length - 1)) * (W - padL - padR);
  const ys = (t: number) => padT + ((tMax - t) / Math.max(1, tMax - tMin)) * (Hc - padT - padB);
  const line = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");

  const first = night?.windows[0];
  const endIdx = first ? first.to : -1;

  return (
    <section className="tb-section tonight" aria-labelledby="sec-tonight">
      <h2 id="sec-tonight">
        <span className="idx">05</span>Tonight
      </h2>
      <form className="place-search" onSubmit={search}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={place ? place.name : "Town or city"}
          aria-label="Search for a place"
        />
        <button type="submit">Search</button>
        <button type="button" onClick={locate}>
          Locate me
        </button>
      </form>
      {places.length > 0 && (
        <ul className="places">
          {places.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" onClick={() => choose(p)}>
                {p.name}
                <span>{[p.region, p.country].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {place && (
        <div className="tonight-opts">
          <span className="place-name">
            {place.name}
            {place.country ? `, ${place.country}` : ""}
          </span>
          <label className="insp-field">
            <span>Indoors now</span>
            <input
              type="number"
              value={indoor}
              min={10}
              max={40}
              step={0.5}
              onChange={(e) => setIndoor(Number(e.target.value))}
            />
            <em>°C</em>
          </label>
          <div className="segmented tiny" role="radiogroup" aria-label="Building mass">
            {(["light", "medium", "heavy"] as Mass[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mass === m}
                className={mass === m ? "on" : ""}
                onClick={() => setMass(m)}
                title={
                  m === "light"
                    ? "Timber / drywall"
                    : m === "medium"
                      ? "Brick, some concrete"
                      : "Concrete floors & walls"
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}
      {hours.length > 0 && noRooms && (
        <p className="muted small">
          Close off a room — walls all the way round — and Windeye will plan the night for it.
        </p>
      )}
      {!place && !msg && (
        <p className="muted small">
          Pick your town to get tonight's hour-by-hour plan: when it's worth opening up, with which wind, and
          how cool it'll get by morning.
        </p>
      )}
      {hours.length > 0 && (
        <svg
          className="tonight-chart"
          viewBox={`0 0 ${W} ${Hc}`}
          role="img"
          aria-label="Temperature forecast and window plan"
          onPointerLeave={() => setHover(null)}
        >
          {night?.windows.map((w) => (
            <rect
              key={w.from}
              className="open-band"
              x={xs(w.from)}
              y={padT - 4}
              width={Math.max(2, xs(w.to + 1 > hours.length - 1 ? hours.length - 1 : w.to + 1) - xs(w.from))}
              height={Hc - padT - padB + 4}
            />
          ))}
          {Array.from({ length: tMax - tMin + 1 }, (_, k) => tMin + k)
            .filter((t) => t % 2 === 0)
            .map((t) => (
              <g key={t}>
                <line className="grid" x1={padL} x2={W - padR} y1={ys(t)} y2={ys(t)} />
                <text className="axis" x={padL - 4} y={ys(t) + 3} textAnchor="end">
                  {t}°
                </text>
              </g>
            ))}
          {hours.map((h, i) =>
            h.time.endsWith("00:00") ||
            h.time.slice(11, 13) === "06" ||
            h.time.slice(11, 13) === "12" ||
            h.time.slice(11, 13) === "18" ? (
              <text key={h.time} className="axis" x={xs(i)} y={Hc - 6} textAnchor="middle">
                {h.time.slice(11, 13) === "00"
                  ? new Date(`${h.time}:00`).toLocaleDateString(undefined, { weekday: "short" })
                  : `${h.time.slice(11, 13)}h`}
              </text>
            ) : null,
          )}
          {hours.map((h, i) =>
            i % 3 === 0 ? (
              <MiniBarb key={h.time} speed={h.windSpeed} from={h.windDir} x={xs(i)} y={17} />
            ) : null,
          )}
          <path className="t-out" d={line(hours.map((h) => h.temp))} />
          {night && (
            <>
              <path className="t-shut" d={line(night.hours.map((h) => h.indoorShut))} />
              <path className="t-in" d={line(night.hours.map((h) => h.indoor))} />
            </>
          )}
          {hover !== null && (
            <g className="hover">
              <line x1={xs(hover)} x2={xs(hover)} y1={padT - 4} y2={Hc - padB} />
              <text x={Math.min(W - 90, xs(hover) + 4)} y={padT + 8}>
                {hourLabel(hours[hover].time)} · {hours[hover].temp.toFixed(0)}° ·{" "}
                {compassName(hours[hover].windDir, true)} {hours[hover].windSpeed.toFixed(1)} m/s
              </text>
            </g>
          )}
          {hours.map((h, i) => (
            <rect
              key={`hit${h.time}`}
              className="hit"
              x={xs(i) - (W - padL - padR) / hours.length / 2}
              y={0}
              width={(W - padL - padR) / hours.length}
              height={Hc}
              onPointerEnter={() => setHover(i)}
              onClick={() =>
                setWeather({ windFromDeg: Math.round(h.windDir), windSpeed: Math.round(h.windSpeed * 2) / 2 })
              }
            />
          ))}
        </svg>
      )}
      {hours.length > 0 && (
        <div className="chart-key">
          <span className="k-out">outside</span>
          <span className="k-in">indoors, with plan</span>
          <span className="k-shut">if kept shut</span>
          <span className="k-open">windows open</span>
        </div>
      )}
      {night && (
        <p className="verdict" data-testid="tonight-verdict">
          {first ? (
            <>
              Open up <b>{hourLabel(night.hours[first.from].time)}</b> →{" "}
              <b>{hourLabel(night.hours[Math.min(hours.length - 1, first.to + 1)].time)}</b>. With this setup
              the home cools from {indoor.toFixed(1)}° to about{" "}
              <b>{night.hours[Math.min(hours.length - 1, endIdx + 1)].indoor.toFixed(1)}°</b> (≈
              {night.minIndoorShut.toFixed(1)}° if kept shut). Click an hour to see its wind on the plan.
            </>
          ) : (
            <>
              It won't be cooler outside than in for the next day and a half — keep windows shut against the
              heat and use fans on people for comfort.
            </>
          )}
        </p>
      )}
      {/* Open-Meteo's CC BY 4.0 terms ask for this link wherever its data is shown. */}
      <p className="credit">
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Weather data by Open-Meteo.com
        </a>
      </p>
    </section>
  );
}
