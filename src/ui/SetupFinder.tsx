import { useEffect, useRef, useState } from "react";
import { OptPool } from "../sim/optClient";
import {
  benefit,
  type Candidate,
  describe,
  distinctByWindows,
  type Evaluation,
  fanCandidates,
  fanTrialSets,
  type Goal,
  type OpeningFacts,
  score,
  windowCandidates,
} from "../sim/optimizer";
import { live } from "../state/fields";
import { useStore } from "../state/store";
import { formatAge } from "./format";
import { Thumb, type ThumbData } from "./Thumb";

interface RunState {
  phase: "idle" | "running" | "done" | "error";
  done: number;
  total: number;
  results: Evaluation[];
  baseline: Evaluation | null;
  thumbs: Record<string, ThumbData>;
  error?: string;
  facts?: Map<string, OpeningFacts>;
}

const IDLE: RunState = { phase: "idle", done: 0, total: 0, results: [], baseline: null, thumbs: {} };
const COARSE_CELLS = 9000;

export function SetupFinder() {
  const plan = useStore((s) => s.plan);
  const metrics = useStore((s) => s.metrics);
  const [goal, setGoal] = useState<Goal>({ kind: "flush" });
  const [allowFan, setAllowFan] = useState(true);
  const [run, setRun] = useState<RunState>(IDLE);
  const pool = useRef<OptPool | null>(null);
  const runPlan = useRef(plan);

  useEffect(() => () => pool.current?.dispose(), []);
  // Results describe a specific plan; drop them if the plan's geometry changes underneath.
  useEffect(() => {
    if (run.phase === "done" && plan.walls !== runPlan.current.walls) setRun(IDLE);
  }, [plan, run.phase]);

  const rooms = metrics?.rooms.filter((r) => r.area >= 3).map((r) => r.name) ?? [];

  const start = async () => {
    const raster = live.raster;
    if (!raster) return;
    pool.current?.dispose();
    const p = new OptPool();
    pool.current = p;
    const snapshot = useStore.getState().plan;
    runPlan.current = snapshot;
    const weather = useStore.getState().weather;
    const facts = new Map<string, OpeningFacts>(
      raster.openings.map((o) => [
        o.id,
        {
          id: o.id,
          exterior: o.exterior,
          nx: o.nx,
          ny: o.ny,
          roomName: raster.rooms[o.roomIn]?.name ?? "Room",
        },
      ]),
    );
    const phase1 = windowCandidates(snapshot, facts);
    if (phase1.length === 0) {
      setRun({ ...IDLE, phase: "error", error: "Add some windows on outside walls first." });
      return;
    }
    const fanEstimate = allowFan ? Math.min(12, 3 * 2 * 2 + (goal.kind === "cool" ? 3 : 0)) : 0;
    let state: RunState = { ...IDLE, phase: "running", total: phase1.length + 1 + fanEstimate, facts };
    setRun(state);
    const push = (patch: Partial<RunState>) => {
      state = { ...state, ...patch };
      setRun(state);
    };
    const evaluate = async (c: Candidate): Promise<Evaluation | null> => {
      try {
        const res = await p.run({ id: c.id, plan: c.plan, weather, targetCells: COARSE_CELLS });
        const ev: Evaluation = {
          candidate: c,
          metrics: res.metrics,
          comfortRooms: res.comfortRooms,
          score: score(goal, res.metrics, c, res.comfortRooms),
        };
        if (pool.current !== p) return null;
        push({
          done: state.done + 1,
          thumbs: { ...state.thumbs, [c.id]: res.thumb },
          ...(c.id === "current"
            ? { baseline: ev }
            : { results: [...state.results, ev].sort((a, b) => b.score - a.score) }),
        });
        return ev;
      } catch (err) {
        if (pool.current === p && (err as Error).message !== "cancelled") push({ done: state.done + 1 });
        return null;
      }
    };
    const current: Candidate = { id: "current", open: [], fan: null, plan: snapshot };
    await Promise.all([evaluate(current), ...phase1.map(evaluate)]);
    if (pool.current !== p) return;
    if (allowFan) {
      const phase2 = fanCandidates(snapshot, facts, fanTrialSets(state.results), goal, 14);
      push({ total: state.done + phase2.length });
      await Promise.all(phase2.map(evaluate));
    }
    if (pool.current !== p) return;
    push({ phase: "done" });
    p.dispose();
    pool.current = null;
  };

  const cancel = () => {
    pool.current?.dispose();
    pool.current = null;
    setRun((r) => ({ ...r, phase: r.results.length ? "done" : "idle" }));
  };

  // Results answer one question; a different goal or fan choice needs a fresh search.
  const reset = () => {
    pool.current?.dispose();
    pool.current = null;
    setRun(IDLE);
  };
  const chooseGoal = (g: Goal) => {
    if (JSON.stringify(g) === JSON.stringify(goal)) return;
    setGoal(g);
    reset();
  };

  const gainLabel = (ev: Evaluation) => {
    if (!run.baseline) return null;
    const now = benefit(goal, run.baseline.metrics, run.baseline.comfortRooms);
    const g = benefit(goal, ev.metrics, ev.comfortRooms) / Math.max(1e-9, now);
    if (g <= 1.05) return null;
    // A shut home's age is capped, not infinite, so ratios against it are meaningless.
    if (g >= 50) return "vs. near-stagnant air now";
    return `${g < 10 ? g.toFixed(1) : Math.round(g)}× better than now`;
  };

  const apply = (ev: Evaluation) => {
    const fans = ev.candidate.plan.fans.map((f) =>
      f.id === "finder-fan" ? { ...f, id: `f${Date.now().toString(36)}` } : f,
    );
    useStore.getState().setPlan(() => ({ ...ev.candidate.plan, fans }));
  };

  const facts = run.facts;
  // Two window sets can read the same ("Living room N window" when a room has two); show one.
  const top: Evaluation[] = [];
  if (facts) {
    const seen = new Set<string>();
    for (const ev of distinctByWindows(run.results)) {
      const d = describe(ev.candidate, runPlan.current, facts);
      const key = `${d.open}|${d.fan ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      top.push(ev);
      if (top.length === 4) break;
    }
  }
  const metricLine = (ev: Evaluation) => {
    const m = ev.metrics;
    if (goal.kind === "flush") {
      return `${(3600 / Math.max(1, m.home.meanAge)).toFixed(0)} effective air changes/h · air age ${formatAge(m.home.meanAge)}`;
    }
    const room = m.rooms.find((r) => r.name === goal.room);
    const cool = Math.max(
      0,
      ...m.comfort.filter((s) => ev.comfortRooms[s.id] === goal.room).map((s) => s.cooling),
    );
    return `${goal.room}: air age ${room ? formatAge(room.meanAge) : "—"}${cool > 0.2 ? ` · feels ${cool.toFixed(1)} °C cooler` : ""}`;
  };

  return (
    <section className="tb-section finder" aria-labelledby="sec-finder">
      <h2 id="sec-finder">
        <span className="idx">04</span>Find a setup
      </h2>
      <div className="finder-goal">
        <div className="segmented" role="radiogroup" aria-label="Goal">
          <button
            type="button"
            role="radio"
            aria-checked={goal.kind === "flush"}
            className={goal.kind === "flush" ? "on" : ""}
            onClick={() => chooseGoal({ kind: "flush" })}
          >
            Air it all out
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={goal.kind === "cool"}
            className={goal.kind === "cool" ? "on" : ""}
            onClick={() => {
              if (goal.kind !== "cool")
                chooseGoal({ kind: "cool", room: rooms.find((r) => /bed/i.test(r)) ?? rooms[0] ?? "" });
            }}
          >
            Cool one room
          </button>
        </div>
        {goal.kind === "cool" && (
          <label className="insp-field wide">
            <span>Room</span>
            <select value={goal.room} onChange={(e) => chooseGoal({ kind: "cool", room: e.target.value })}>
              {rooms.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={allowFan}
            onChange={(e) => {
              setAllowFan(e.target.checked);
              reset();
            }}
          />
          <span>I have one box fan to place</span>
        </label>
      </div>
      <div className="finder-run">
        {run.phase === "running" ? (
          <button type="button" className="primary" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={start}
            disabled={!live.raster}
            data-testid="find-setup"
          >
            {run.phase === "done" ? "Search again" : "Find the best setup"}
          </button>
        )}
        {run.phase === "running" && (
          <span className="progress" aria-live="polite">
            <span className="bar">
              <span style={{ width: `${(100 * run.done) / Math.max(1, run.total)}%` }} />
            </span>
            tested {run.done} of ~{run.total}
          </span>
        )}
      </div>
      {run.error && <p className="muted">{run.error}</p>}
      {run.phase === "idle" && (
        <p className="muted small">
          Tries combinations of windows — and a fan in each open window, blowing in or out — as quick coarse
          simulations, then ranks them. Interior doors are assumed open.
        </p>
      )}
      {top.length > 0 && facts && (
        <>
          <p className="muted small">
            Simplest setup that works comes first: every window beyond two counts against a setup.
          </p>
          <ol className="results" data-testid="finder-results">
            {top.map((ev, i) => {
              const d = describe(ev.candidate, runPlan.current, facts);
              const thumb = run.thumbs[ev.candidate.id];
              const gain = gainLabel(ev);
              return (
                <li key={ev.candidate.id}>
                  <span className="rank">{i + 1}</span>
                  {thumb && <Thumb data={thumb} width={112} />}
                  <div className="res-body">
                    <div className="res-open">Open {d.open}</div>
                    {d.fan && <div className="res-fan">+ {d.fan}</div>}
                    <div className="res-metric">{metricLine(ev)}</div>
                    {gain && <div className="res-gain">{gain}</div>}
                  </div>
                  <button type="button" onClick={() => apply(ev)} aria-label={`Apply setup ${i + 1}`}>
                    Apply
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {run.baseline && top.length > 0 && (
        <p className="muted small">Your current setup: {metricLine(run.baseline)}.</p>
      )}
    </section>
  );
}
