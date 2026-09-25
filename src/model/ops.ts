import type { Selection } from "../state/store";
import { clampOffset, dist, openingSpan, projectOnSegment, uid, wallLength } from "./geometry";
import { FURNITURE_DEFAULTS } from "./templates";
import type {
  Fan,
  Furniture,
  FurnitureKind,
  Opening,
  OpeningKind,
  Plan,
  RoomLabel,
  Vec2,
  Wall,
  WallKind,
} from "./types";

const EPS = 1e-6;
export const WALL_THICKNESS: Record<WallKind, number> = { exterior: 0.3, interior: 0.12, party: 0.25 };

const same = (a: Vec2, b: Vec2) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

/** All distinct wall endpoints. */
export function vertices(plan: Plan): Vec2[] {
  const out: Vec2[] = [];
  for (const w of plan.walls) for (const p of [w.a, w.b]) if (!out.some((q) => same(p, q))) out.push(p);
  return out;
}

export function nearestVertex(plan: Plan, p: Vec2, tol: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bd = tol;
  for (const q of vertices(plan)) {
    const d = dist(p, q);
    if (d <= bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Keep openings on their walls after a wall changes length. */
function reclampOpenings(plan: Plan, walls: Wall[]): Opening[] {
  const byId = new Map(walls.map((w) => [w.id, w]));
  return plan.openings
    .filter((o) => {
      const w = byId.get(o.wallId);
      return w && wallLength(w) > o.width + 0.1;
    })
    .map((o) => {
      const w = byId.get(o.wallId)!;
      const offset = clampOffset(w, o.width, o.offset);
      return offset === o.offset ? o : { ...o, offset };
    });
}

/** Move every wall endpoint sitting at `from` to `to` (walls stay joined). */
export function moveVertex(plan: Plan, from: Vec2, to: Vec2): Plan {
  const walls = plan.walls.map((w) => {
    const a = same(w.a, from) ? to : w.a;
    const b = same(w.b, from) ? to : w.b;
    return a === w.a && b === w.b ? w : { ...w, a, b };
  });
  const next = { ...plan, walls: walls.filter((w) => wallLength(w) > 0.05) };
  return { ...next, openings: reclampOpenings(next, next.walls) };
}

export function addWall(plan: Plan, a: Vec2, b: Vec2, kind: WallKind): { plan: Plan; id: string } {
  const id = uid("w");
  const w: Wall = { id, a, b, thickness: WALL_THICKNESS[kind], kind };
  return { plan: { ...plan, walls: [...plan.walls, w] }, id };
}

export function updateWall(plan: Plan, id: string, patch: Partial<Wall>): Plan {
  const walls = plan.walls.map((w) => (w.id === id ? { ...w, ...patch } : w));
  return { ...plan, walls, openings: reclampOpenings(plan, walls) };
}

export const OPENING_DEFAULTS: Record<OpeningKind, { width: number; height: number }> = {
  window: { width: 1.2, height: 1.4 },
  door: { width: 0.85, height: 2.05 },
};

/** Would an opening of `width` centred at `offset` collide with others on the wall? */
export function openingFits(plan: Plan, wallId: string, offset: number, width: number, ignoreId?: string) {
  return !plan.openings.some(
    (o) =>
      o.wallId === wallId && o.id !== ignoreId && Math.abs(o.offset - offset) < (o.width + width) / 2 + 0.08,
  );
}

export function addOpening(
  plan: Plan,
  wall: Wall,
  kind: OpeningKind,
  offset: number,
): { plan: Plan; id: string } | null {
  const d = OPENING_DEFAULTS[kind];
  const width = Math.min(d.width, wallLength(wall) - 0.2);
  if (width < 0.4) return null;
  const off = clampOffset(wall, width, offset);
  if (!openingFits(plan, wall.id, off, width)) return null;
  const id = uid(kind === "window" ? "o" : "d");
  const o: Opening = {
    id,
    wallId: wall.id,
    kind,
    offset: off,
    width,
    height: d.height,
    state: "open",
    ...(kind === "door" ? { hinge: "a" as const, swing: 1 as const } : {}),
  };
  return { plan: { ...plan, openings: [...plan.openings, o] }, id };
}

export function updateOpening(plan: Plan, id: string, patch: Partial<Opening>): Plan {
  return { ...plan, openings: plan.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) };
}

/** Click-to-cycle: windows open → tilted → closed; doors open ↔ closed. */
export function nextState(o: Opening): Opening["state"] {
  if (o.passage) return "open";
  if (o.kind === "door") return o.state === "open" ? "closed" : "open";
  return o.state === "open" ? "tilted" : o.state === "tilted" ? "closed" : "open";
}

export function addFan(plan: Plan, pos: Vec2, angle: number): { plan: Plan; id: string } {
  const id = uid("f");
  const f: Fan = { id, pos, angle, size: 0.5, speed: 3.2, on: true };
  return { plan: { ...plan, fans: [...plan.fans, f] }, id };
}

export function updateFan(plan: Plan, id: string, patch: Partial<Fan>): Plan {
  return { ...plan, fans: plan.fans.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function addFurniture(plan: Plan, kind: FurnitureKind, pos: Vec2): { plan: Plan; id: string } {
  const d = FURNITURE_DEFAULTS[kind];
  const id = uid("fu");
  const f: Furniture = { id, kind, pos, w: d.w, d: d.d, angle: 0, height: d.height };
  return { plan: { ...plan, furniture: [...plan.furniture, f] }, id };
}

export function updateFurniture(plan: Plan, id: string, patch: Partial<Furniture>): Plan {
  return { ...plan, furniture: plan.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function addLabel(plan: Plan, pos: Vec2, name: string): { plan: Plan; id: string } {
  const id = uid("r");
  const l: RoomLabel = { id, pos, name };
  return { plan: { ...plan, labels: [...plan.labels, l] }, id };
}

export function updateLabel(plan: Plan, id: string, patch: Partial<RoomLabel>): Plan {
  return { ...plan, labels: plan.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}

export function deleteSelection(plan: Plan, sel: Selection): Plan {
  switch (sel.kind) {
    case "wall":
      return {
        ...plan,
        walls: plan.walls.filter((w) => w.id !== sel.id),
        openings: plan.openings.filter((o) => o.wallId !== sel.id),
      };
    case "opening":
      return { ...plan, openings: plan.openings.filter((o) => o.id !== sel.id) };
    case "fan":
      return { ...plan, fans: plan.fans.filter((f) => f.id !== sel.id) };
    case "furniture":
      return { ...plan, furniture: plan.furniture.filter((f) => f.id !== sel.id) };
    case "label":
      return { ...plan, labels: plan.labels.filter((l) => l.id !== sel.id) };
  }
}

export interface WallHit {
  wall: Wall;
  offset: number;
  distance: number;
  point: Vec2;
}

export function nearestWall(plan: Plan, p: Vec2, tol: number): WallHit | null {
  let best: WallHit | null = null;
  for (const w of plan.walls) {
    const h = projectOnSegment(p, w.a, w.b);
    const d = h.distance - w.thickness / 2;
    if (d <= tol && (!best || d < best.distance)) {
      best = { wall: w, offset: h.t * wallLength(w), distance: d, point: h.point };
    }
  }
  return best;
}

export function openingAt(plan: Plan, p: Vec2, tol: number): Opening | null {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  for (const o of plan.openings) {
    const w = walls.get(o.wallId);
    if (!w) continue;
    const span = openingSpan(w, o);
    const h = projectOnSegment(p, span.a, span.b);
    if (h.distance <= w.thickness / 2 + tol && h.t > 0 && h.t < 1) return o;
    if (h.distance <= w.thickness / 2 + tol && dist(p, span.center) < o.width / 2 + tol) return o;
  }
  return null;
}
