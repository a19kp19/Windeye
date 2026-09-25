import type { Opening, Plan, Vec2, Wall } from "./types";

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
/** Rotate by `ang` radians. With y pointing down this turns clockwise on screen. */
export const rotate = (a: Vec2, ang: number): Vec2 => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
export const fromAngle = (ang: number): Vec2 => ({ x: Math.cos(ang), y: Math.sin(ang) });
export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

export const wallLength = (w: Wall) => dist(w.a, w.b);
export const wallDir = (w: Wall) => norm(sub(w.b, w.a));
/** Left-hand normal of the wall direction (rotated -90° on screen). */
export const wallNormal = (w: Wall): Vec2 => {
  const d = wallDir(w);
  return { x: d.y, y: -d.x };
};

export interface SegmentHit {
  t: number; // 0..1 along the segment
  point: Vec2;
  distance: number;
}

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): SegmentHit {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
  const point = lerp(a, b, t);
  return { t, point, distance: dist(p, point) };
}

/** Opening endpoints (centre ± width/2 along the wall), in plan coordinates. */
export function openingSpan(wall: Wall, o: Opening): { a: Vec2; b: Vec2; center: Vec2 } {
  const d = wallDir(wall);
  const center = add(wall.a, scale(d, o.offset));
  return { a: add(center, scale(d, -o.width / 2)), b: add(center, scale(d, o.width / 2)), center };
}

/** Keep an opening fully on its wall (with a small clearance to the wall ends). */
export function clampOffset(wall: Wall, width: number, offset: number): number {
  const L = wallLength(wall);
  const margin = Math.min(width / 2 + 0.05, L / 2);
  return Math.min(L - margin, Math.max(margin, offset));
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function planBounds(plan: Plan): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const grow = (p: Vec2, pad = 0) => {
    minX = Math.min(minX, p.x - pad);
    minY = Math.min(minY, p.y - pad);
    maxX = Math.max(maxX, p.x + pad);
    maxY = Math.max(maxY, p.y + pad);
  };
  for (const w of plan.walls) {
    grow(w.a, w.thickness / 2);
    grow(w.b, w.thickness / 2);
  }
  for (const f of plan.furniture) grow(f.pos, Math.max(f.w, f.d) / 2);
  for (const f of plan.fans) grow(f.pos, f.size / 2);
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 8, maxY: 6 };
  return { minX, minY, maxX, maxY };
}

/** Unit vector (plan coordinates) pointing toward a compass bearing, given the plan's north arrow. */
export function bearingToPlan(bearingDeg: number, northDeg: number): Vec2 {
  return rotate({ x: 0, y: -1 }, rad(northDeg + bearingDeg));
}

/** Compass bearing (degrees, 0..360) of a plan-space direction. */
export function planToBearing(dir: Vec2, northDeg: number): number {
  // Angle measured clockwise from plan-up.
  const a = deg(Math.atan2(dir.x, -dir.y));
  return (((a - northDeg) % 360) + 360) % 360;
}

/** Corners of an oriented rectangle (centre, width along local x, depth along local y). */
export function rectCorners(c: Vec2, w: number, d: number, angle: number): Vec2[] {
  const hx = rotate({ x: w / 2, y: 0 }, angle);
  const hy = rotate({ x: 0, y: d / 2 }, angle);
  return [
    { x: c.x - hx.x - hy.x, y: c.y - hx.y - hy.y },
    { x: c.x + hx.x - hy.x, y: c.y + hx.y - hy.y },
    { x: c.x + hx.x + hy.x, y: c.y + hx.y + hy.y },
    { x: c.x - hx.x + hy.x, y: c.y - hx.y + hy.y },
  ];
}

/** Is `p` inside the oriented rectangle? */
export function inRect(p: Vec2, c: Vec2, w: number, d: number, angle: number): boolean {
  const q = rotate(sub(p, c), -angle);
  return Math.abs(q.x) <= w / 2 && Math.abs(q.y) <= d / 2;
}

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36).slice(-4)}${idCounter.toString(36)}${Math.floor(
    Math.random() * 1296,
  )
    .toString(36)
    .padStart(2, "0")}`;
}

export const snap = (x: number, step: number) => Math.round(x / step) * step;
