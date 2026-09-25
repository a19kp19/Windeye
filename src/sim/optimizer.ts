import { compassName } from "../model/compass";
import { add, openingSpan, planToBearing, scale } from "../model/geometry";
import type { Opening, Plan } from "../model/types";
import type { Metrics } from "./metrics";

export type Goal = { kind: "flush" } | { kind: "cool"; room: string };

/** What the finder knows about each opening from the live raster. */
export interface OpeningFacts {
  id: string;
  exterior: boolean;
  /** Normal pointing into the home (plan coordinates). */
  nx: number;
  ny: number;
  roomName: string;
}

export interface Candidate {
  id: string;
  open: string[];
  fan: { openingId: string; out: boolean } | { aimAt: string; openingId: string } | null;
  plan: Plan;
}

export interface Evaluation {
  candidate: Candidate;
  metrics: Metrics;
  /** Room index of each comfort spot (bed/sofa/desk), from the coarse run. */
  comfortRooms: Record<string, string>;
  score: number;
}

const SET_LIMIT = 16;

/** Candidate plan: exactly `open` exterior openings open, interior doors open, finder's fan only. */
export function configure(
  plan: Plan,
  facts: Map<string, OpeningFacts>,
  open: Set<string>,
  fan: Candidate["fan"],
): Plan {
  const openings = plan.openings.map((o) => {
    const f = facts.get(o.id);
    if (!f) return o;
    if (f.exterior) {
      // Doors to the outside only open if chosen; party-wall doors are never "exterior".
      return { ...o, state: open.has(o.id) ? ("open" as const) : ("closed" as const) };
    }
    return o.kind === "door" ? { ...o, state: "open" as const } : o;
  });
  const fans = plan.fans.map((f) => ({ ...f, on: false }));
  if (fan) {
    const o = plan.openings.find((x) => x.id === fan.openingId);
    const w = o && plan.walls.find((x) => x.id === o.wallId);
    const f = o && facts.get(o.id);
    if (o && w && f) {
      const span = openingSpan(w, o);
      const inward = { x: f.nx, y: f.ny };
      if ("out" in fan) {
        // Box fan standing just inside the window.
        const pos = add(span.center, scale(inward, w.thickness / 2 + 0.2));
        const dir = fan.out ? scale(inward, -1) : inward;
        fans.push({
          id: "finder-fan",
          pos,
          angle: Math.atan2(dir.y, dir.x),
          size: Math.min(0.55, o.width * 0.8),
          speed: 3.4,
          on: true,
        });
      } else {
        const target = plan.furniture.find((x) => x.id === fan.aimAt);
        if (target) {
          // Floor fan between the window and the bed/sofa, aimed at it.
          const from = add(span.center, scale(inward, w.thickness / 2 + 0.2));
          const d = { x: target.pos.x - from.x, y: target.pos.y - from.y };
          const L = Math.hypot(d.x, d.y) || 1;
          const back = Math.min(1.4, L * 0.6);
          const pos = { x: target.pos.x - (d.x / L) * back, y: target.pos.y - (d.y / L) * back };
          fans.push({ id: "finder-fan", pos, angle: Math.atan2(d.y, d.x), size: 0.45, speed: 3.2, on: true });
        }
      }
    }
  }
  return { ...plan, openings, fans };
}

function pairs<T>(xs: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
}

/** Phase 1: which windows. Pairs across different façades first, then all-open and singles. */
export function windowSets(plan: Plan, facts: Map<string, OpeningFacts>): string[][] {
  const ext = plan.openings.filter((o) => facts.get(o.id)?.exterior && o.kind === "window");
  const extDoors = plan.openings.filter(
    (o) => facts.get(o.id)?.exterior && o.kind === "door" && o.width >= 1.2,
  );
  const all = [...ext, ...extDoors];
  if (all.length === 0) return [];
  const facing = (o: Opening) => {
    const f = facts.get(o.id)!;
    return Math.atan2(-f.ny, -f.nx);
  };
  const angGap = (a: Opening, b: Opening) =>
    Math.abs(Math.atan2(Math.sin(facing(a) - facing(b)), Math.cos(facing(a) - facing(b))));
  const sets: string[][] = [all.map((o) => o.id)];
  const ps = pairs(all).sort((p, q) => angGap(q[0], q[1]) - angGap(p[0], p[1]));
  for (const [a, b] of ps) sets.push([a.id, b.id]);
  if (all.length <= 3) for (const o of all) sets.push([o.id]);
  const seen = new Set<string>();
  return sets
    .filter((s) => {
      const k = [...s].sort().join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, SET_LIMIT);
}

export function windowCandidates(plan: Plan, facts: Map<string, OpeningFacts>): Candidate[] {
  return windowSets(plan, facts).map((open, i) => ({
    id: `w${i}`,
    open,
    fan: null,
    plan: configure(plan, facts, new Set(open), null),
  }));
}

/** Phase 2: one fan, in each open window of the best window sets, blowing in or out (+ aimed at a bed). */
export function fanCandidates(
  plan: Plan,
  facts: Map<string, OpeningFacts>,
  best: Candidate[],
  goal: Goal,
  limit = 12,
): Candidate[] {
  const out: Candidate[] = [];
  best.forEach((c, bi) => {
    for (const id of c.open) {
      const o = plan.openings.find((x) => x.id === id);
      if (!o || o.kind !== "window") continue;
      for (const dirOut of [true, false]) {
        const fan = { openingId: id, out: dirOut };
        out.push({
          id: `f${bi}-${id}-${dirOut ? "o" : "i"}`,
          open: c.open,
          fan,
          plan: configure(plan, facts, new Set(c.open), fan),
        });
      }
    }
    if (goal.kind === "cool") {
      const target = plan.furniture.find((f) => f.kind === "bed" || f.kind === "sofa");
      const win = c.open.find((id) => facts.get(id)?.roomName === goal.room) ?? c.open[0];
      if (target && win) {
        const fan = { aimAt: target.id, openingId: win };
        out.push({ id: `a${bi}`, open: c.open, fan, plan: configure(plan, facts, new Set(c.open), fan) });
      }
    }
  });
  return out.slice(0, limit);
}

/**
 * Higher is better. Each window beyond two costs 7 %, so a sharp two-window cross-draught can beat
 * "open everything" — the useful answer is usually the minimal setup that works.
 */
export function score(goal: Goal, m: Metrics, c: Candidate, comfortRooms: Record<string, string>): number {
  const penalty = Math.max(0.4, 1 - 0.07 * Math.max(0, c.open.length - 2) - (c.fan ? 0.03 : 0));
  if (goal.kind === "flush") {
    const effAch = m.home.meanAge > 0 ? 3600 / m.home.meanAge : 0;
    return effAch * penalty;
  }
  const room = m.rooms.find((r) => r.name === goal.room);
  const roomAch = room && room.meanAge > 0 ? 3600 / room.meanAge : 0;
  const cooling = Math.max(
    0,
    ...m.comfort.filter((s) => comfortRooms[s.id] === goal.room).map((s) => s.cooling),
  );
  return (roomAch / 10 + 2 * cooling) * penalty;
}

/** Keep the best-scoring candidate per window set, best first. */
export function distinctByWindows(evals: Evaluation[]): Evaluation[] {
  const best = new Map<string, Evaluation>();
  for (const e of evals) {
    const k = [...e.candidate.open].sort().join("|");
    const cur = best.get(k);
    if (!cur || e.score > cur.score) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** Which window sets deserve fan trials: the best small sets plus the all-open set. */
export function fanTrialSets(evals: Evaluation[], n = 3): Candidate[] {
  const ranked = distinctByWindows(evals);
  const small = ranked.filter((e) => e.candidate.open.length <= 2).slice(0, n);
  const largest = ranked.reduce<Evaluation | null>(
    (acc, e) => (!acc || e.candidate.open.length > acc.candidate.open.length ? e : acc),
    null,
  );
  const picked = [...small];
  if (largest && !picked.includes(largest)) picked.push(largest);
  return picked.map((e) => e.candidate);
}

/** Human description of a candidate, e.g. "Kitchen N window + Small bedroom S window". */
export function describe(
  c: Candidate,
  plan: Plan,
  facts: Map<string, OpeningFacts>,
): { open: string; fan: string | null } {
  const name = (id: string) => {
    const o = plan.openings.find((x) => x.id === id);
    const f = facts.get(id);
    if (!o || !f) return "window";
    const bearing = planToBearing({ x: -f.nx, y: -f.ny }, plan.northDeg);
    return `${f.roomName} ${compassName(bearing, true)} ${o.kind === "door" ? "door" : "window"}`;
  };
  let fan: string | null = null;
  if (c.fan && "out" in c.fan)
    fan = `fan in the ${name(c.fan.openingId)}, blowing ${c.fan.out ? "out" : "in"}`;
  else if (c.fan) {
    const aimAt = c.fan.aimAt;
    const t = plan.furniture.find((x) => x.id === aimAt);
    fan = `floor fan aimed at the ${t?.kind ?? "bed"}`;
  }
  const exterior = plan.openings.filter(
    (o) => facts.get(o.id)?.exterior && (o.kind === "window" || o.width >= 1.2),
  );
  if (c.open.length >= 3 && c.open.length === exterior.length) return { open: "every window", fan };
  const counts = new Map<string, number>();
  for (const id of c.open) counts.set(name(id), (counts.get(name(id)) ?? 0) + 1);
  const open = [...counts.entries()].map(([n, k]) => (k > 1 ? `${n}s ×${k}` : n)).join(" + ");
  return { open: open || "nothing", fan };
}
