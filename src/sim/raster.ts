import { dot, inRect, planBounds, sub, wallDir, wallLength, wallNormal } from "../model/geometry";
import type { FurnitureKind, OpeningKind, Plan, Vec2, Wall } from "../model/types";

export interface GridSpec {
  nx: number;
  ny: number;
  /** Cell size in metres. */
  dx: number;
  /** Plan coordinate of the grid's top-left corner. */
  x0: number;
  y0: number;
}

export interface RoomInfo {
  index: number;
  name: string;
  /** Label id this room was named from (if any). */
  labelId: string | null;
  area: number;
  cells: number;
  centroid: Vec2;
  /** Where to pin the room's tag (label position if present, else a well-inside point). */
  anchor: Vec2;
}

export interface OpeningCells {
  id: string;
  kind: OpeningKind;
  /** One side is open air. */
  exterior: boolean;
  /** Carved (air-passing) cells. */
  cells: Int32Array;
  /** Wall-thickness layer index of each carved cell; flux is averaged over layers. */
  layers: Int8Array;
  nLayers: number;
  /** Unit normal in plan coordinates. For exterior openings it points *into* the home. */
  normal: Vec2;
  /** Width of wall material the air passes through (m) — used to turn cell sums into a flux. */
  depth: number;
  /** Effective 2-D gap width after height/state scaling (m). */
  effWidth: number;
  /** Rooms either side; -2 = outdoors, -1 = unknown. `roomIn` is the side the normal points to. */
  roomIn: number;
  roomOut: number;
}

export interface ComfortSpot {
  id: string;
  kind: FurnitureKind;
  cells: Int32Array;
  pos: Vec2;
}

export interface Raster {
  grid: GridSpec;
  solid: Uint8Array;
  /** Partial blocking fraction 0..1 for "gray" cells (low furniture, sub-cell gaps). */
  porosity: Float32Array;
  outdoor: Uint8Array;
  room: Int16Array;
  /** Outdoor pressure-plenum zone per cell (index into `zoneOpening`), -1 elsewhere. */
  zone: Int16Array;
  /** Distance (cells) from the nearest opening, for plenum cells. */
  zoneDist: Uint16Array;
  zoneCount: number;
  /** For each zone, the index (into `openings`) of the exterior opening it feeds. */
  zoneOpening: number[];
  fanMask: Uint8Array;
  /** Target fan exit velocity, m/s, plan axes. */
  fanU: Float32Array;
  fanV: Float32Array;
  rooms: RoomInfo[];
  openings: OpeningCells[];
  comfort: ComfortSpot[];
  indoorArea: number;
  ceiling: number;
}

export interface RasterOptions {
  /** Desired number of cells; dx is derived from it (clamped). */
  targetCells?: number;
  dx?: number;
  margin?: number;
}

/** Fraction of the air cross-section a piece of furniture blocks at its default height. */
const BLOCKING: Record<FurnitureKind, number> = {
  wardrobe: 1,
  bookcase: 0.85,
  fridge: 0.9,
  stairs: 0.8,
  bed: 0.05,
  sofa: 0.1,
  table: 0.03,
  desk: 0.04,
  counter: 0.12,
};
const DEFAULT_H: Record<FurnitureKind, number> = {
  wardrobe: 2.2,
  bookcase: 2.0,
  fridge: 1.85,
  stairs: 2.4,
  bed: 0.55,
  sofa: 0.85,
  table: 0.75,
  desk: 0.75,
  counter: 0.9,
};
export const COMFORT_KINDS: ReadonlySet<FurnitureKind> = new Set(["bed", "sofa", "desk"]);

/** Effective open fraction of a tilted (top-hung / tilt-and-turn) window. */
export const TILT_FACTOR = 0.12;

export function chooseGrid(plan: Plan, opts: RasterOptions = {}): GridSpec {
  const b = planBounds(plan);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  // Outdoor air is a thin pressure plenum around the envelope, so a small margin is enough.
  const margin = opts.margin ?? 1.2;
  const W = w + 2 * margin;
  const Hh = h + 2 * margin;
  let dx = opts.dx;
  if (!dx) {
    const target = opts.targetCells ?? 45000;
    dx = Math.sqrt((W * Hh) / target);
    dx = Math.min(0.2, Math.max(0.05, Math.round(dx * 200) / 200));
  }
  const nx = Math.ceil(W / dx);
  const ny = Math.ceil(Hh / dx);
  return { nx, ny, dx, x0: b.minX - margin, y0: b.minY - margin };
}

export const cellCenter = (g: GridSpec, i: number, j: number): Vec2 => ({
  x: g.x0 + (i + 0.5) * g.dx,
  y: g.y0 + (j + 0.5) * g.dx,
});

export function cellAt(g: GridSpec, p: Vec2): number {
  const i = Math.floor((p.x - g.x0) / g.dx);
  const j = Math.floor((p.y - g.y0) / g.dx);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -1;
  return j * g.nx + i;
}

/** Visit cells whose centres fall in an axis-aligned box (plan coords). */
function forCellsInBox(
  g: GridSpec,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  fn: (idx: number, p: Vec2) => void,
) {
  const i0 = Math.max(0, Math.floor((minX - g.x0) / g.dx - 0.5));
  const i1 = Math.min(g.nx - 1, Math.ceil((maxX - g.x0) / g.dx - 0.5));
  const j0 = Math.max(0, Math.floor((minY - g.y0) / g.dx - 0.5));
  const j1 = Math.min(g.ny - 1, Math.ceil((maxY - g.y0) / g.dx - 0.5));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      fn(j * g.nx + i, cellCenter(g, i, j));
    }
  }
}

interface WallFrame {
  wall: Wall;
  dir: Vec2;
  nrm: Vec2;
  L: number;
  half: number;
}

function frame(w: Wall, dx: number): WallFrame {
  // At least 1.5 cells thick so D2Q9 diagonal links can't leak through a thin partition.
  return {
    wall: w,
    dir: wallDir(w),
    nrm: wallNormal(w),
    L: wallLength(w),
    half: Math.max(w.thickness / 2, 0.75 * dx),
  };
}

function local(fr: WallFrame, p: Vec2) {
  const r = sub(p, fr.wall.a);
  return { along: dot(r, fr.dir), across: dot(r, fr.nrm) };
}

/** 8-connected flood fill over cells where `passable` is true. */
function flood(
  g: GridSpec,
  seeds: number[],
  passable: (i: number) => boolean,
  out: Uint8Array | Int16Array,
  value: number,
) {
  const stack = seeds.filter((s) => s >= 0 && passable(s) && out[s] !== value);
  for (const s of stack) out[s] = value;
  const { nx, ny } = g;
  while (stack.length) {
    const c = stack.pop()!;
    const ci = c % nx;
    const cj = (c - ci) / nx;
    for (let dj = -1; dj <= 1; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= ny) continue;
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const i = ci + di;
        if (i < 0 || i >= nx) continue;
        const k = j * nx + i;
        if (out[k] === value || !passable(k)) continue;
        out[k] = value;
        stack.push(k);
      }
    }
  }
}

export function rasterize(plan: Plan, opts: RasterOptions = {}): Raster {
  const g = chooseGrid(plan, opts);
  const { nx, ny, dx } = g;
  const n = nx * ny;
  const solid = new Uint8Array(n);
  const porosity = new Float32Array(n);
  const outdoor = new Uint8Array(n);
  const room = new Int16Array(n).fill(-1);
  const fanMask = new Uint8Array(n);
  const fanU = new Float32Array(n);
  const fanV = new Float32Array(n);
  const wallById = new Map(plan.walls.map((w) => [w.id, w]));
  const frames = new Map(plan.walls.map((w) => [w.id, frame(w, dx)]));

  // 1. Walls.
  for (const fr of frames.values()) {
    const { a, b } = fr.wall;
    const pad = fr.half + dx;
    forCellsInBox(
      g,
      Math.min(a.x, b.x) - pad,
      Math.min(a.y, b.y) - pad,
      Math.max(a.x, b.x) + pad,
      Math.max(a.y, b.y) + pad,
      (idx, p) => {
        const { along, across } = local(fr, p);
        if (along >= -fr.half && along <= fr.L + fr.half && Math.abs(across) <= fr.half) solid[idx] = 1;
      },
    );
  }

  const border: number[] = [];
  for (let i = 0; i < nx; i++) border.push(i, (ny - 1) * nx + i);
  for (let j = 0; j < ny; j++) border.push(j * nx, j * nx + nx - 1);
  const fillOutdoor = () => {
    outdoor.fill(0);
    flood(g, border, (k) => !solid[k], outdoor, 1);
  };
  fillOutdoor();

  // 2. Party walls: solid neighbour mass from the wall's outer face to the edge of the domain.
  const far = (g.nx + g.ny) * dx;
  for (const fr of frames.values()) {
    if (fr.wall.kind !== "party") continue;
    const mid = { x: (fr.wall.a.x + fr.wall.b.x) / 2, y: (fr.wall.a.y + fr.wall.b.y) / 2 };
    const probe = (s: number) =>
      cellAt(g, {
        x: mid.x + fr.nrm.x * s * (fr.half + 2 * dx),
        y: mid.y + fr.nrm.y * s * (fr.half + 2 * dx),
      });
    const pPlus = probe(1);
    const pMinus = probe(-1);
    const plusOut = pPlus >= 0 && outdoor[pPlus] === 1;
    const minusOut = pMinus >= 0 && outdoor[pMinus] === 1;
    if (plusOut === minusOut) continue; // ambiguous (free-standing or fully enclosed) — leave as a plain wall
    const side = plusOut ? 1 : -1;
    const ends = [fr.wall.a, fr.wall.b].map((p) => ({
      x: p.x + fr.nrm.x * side * far,
      y: p.y + fr.nrm.y * side * far,
    }));
    const xs = [fr.wall.a.x, fr.wall.b.x, ends[0].x, ends[1].x];
    const ys = [fr.wall.a.y, fr.wall.b.y, ends[0].y, ends[1].y];
    forCellsInBox(g, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (idx, p) => {
      const { along, across } = local(fr, p);
      if (along >= -fr.half && along <= fr.L + fr.half && across * side >= 0) solid[idx] = 1;
    });
  }
  fillOutdoor();

  // 3. Rooms (all openings closed at this point).
  const inside = (k: number) => !solid[k] && !outdoor[k];
  const comps: number[][] = [];
  const seen = new Int16Array(n).fill(-1);
  for (let k = 0; k < n; k++) {
    if (!inside(k) || seen[k] >= 0) continue;
    const cid = comps.length;
    const cells: number[] = [];
    const stack = [k];
    seen[k] = cid;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const ci = c % nx;
      const cj = (c - ci) / nx;
      const nb = [
        ci > 0 ? c - 1 : -1,
        ci < nx - 1 ? c + 1 : -1,
        cj > 0 ? c - nx : -1,
        cj < ny - 1 ? c + nx : -1,
      ];
      for (const q of nb) {
        if (q >= 0 && seen[q] < 0 && inside(q)) {
          seen[q] = cid;
          stack.push(q);
        }
      }
    }
    comps.push(cells);
  }

  const minRoomCells = Math.max(4, Math.round(0.6 / (dx * dx)));
  const rooms: RoomInfo[] = [];
  const compToRoom = new Map<number, number>();
  const labelFor = new Map<number, { id: string; name: string; pos: Vec2 }>();
  for (const l of plan.labels) {
    const c = cellAt(g, l.pos);
    if (c >= 0 && seen[c] >= 0 && !labelFor.has(seen[c])) labelFor.set(seen[c], l);
  }
  let unnamed = 0;
  comps.forEach((cells, cid) => {
    if (cells.length < minRoomCells) return;
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      sx += c % nx;
      sy += Math.floor(c / nx);
    }
    const ci = sx / cells.length;
    const cj = sy / cells.length;
    const centroid = { x: g.x0 + (ci + 0.5) * dx, y: g.y0 + (cj + 0.5) * dx };
    // Anchor: centroid if it lies in the room, otherwise the member cell closest to it.
    let anchor = centroid;
    const cc = cellAt(g, centroid);
    if (cc < 0 || seen[cc] !== cid) {
      let best = cells[0];
      let bd = Number.POSITIVE_INFINITY;
      for (const c of cells) {
        const d = ((c % nx) - ci) ** 2 + (Math.floor(c / nx) - cj) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      anchor = cellCenter(g, best % nx, Math.floor(best / nx));
    }
    const lab = labelFor.get(cid);
    const area = cells.length * dx * dx;
    const index = rooms.length;
    rooms.push({
      index,
      name: lab?.name ?? (area < 2.5 ? "Closet" : `Room ${++unnamed}`),
      labelId: lab?.id ?? null,
      area,
      cells: cells.length,
      centroid,
      anchor: lab?.pos ?? anchor,
    });
    compToRoom.set(cid, index);
    for (const c of cells) room[c] = index;
  });

  // 4. Furniture as partial (gray) or full blockage.
  const comfort: ComfortSpot[] = [];
  for (const f of plan.furniture) {
    const base = BLOCKING[f.kind];
    const ns = Math.min(1, base * Math.max(0.2, f.height / DEFAULT_H[f.kind]));
    const r = Math.hypot(f.w, f.d) / 2 + dx;
    const cells: number[] = [];
    forCellsInBox(g, f.pos.x - r, f.pos.y - r, f.pos.x + r, f.pos.y + r, (idx, p) => {
      if (!inRect(p, f.pos, f.w, f.d, f.angle) || solid[idx] || outdoor[idx]) return;
      cells.push(idx);
      if (ns >= 0.92) {
        solid[idx] = 1;
        room[idx] = -1;
      } else porosity[idx] = Math.max(porosity[idx], ns);
    });
    if (COMFORT_KINDS.has(f.kind) && cells.length) {
      comfort.push({ id: f.id, kind: f.kind, cells: Int32Array.from(cells), pos: f.pos });
    }
  }

  // 5. Openings: carve an air gap through the wall, narrowed by opening height and state.
  const openings: OpeningCells[] = [];
  for (const o of plan.openings) {
    const w = wallById.get(o.wallId);
    const fr = frames.get(o.wallId);
    if (!w || !fr) continue;
    const probeSide = (s: number) => {
      const c = cellAt(g, {
        x: w.a.x + fr.dir.x * o.offset + fr.nrm.x * s * (fr.half + 1.5 * dx),
        y: w.a.y + fr.dir.y * o.offset + fr.nrm.y * s * (fr.half + 1.5 * dx),
      });
      if (c < 0) return -2;
      if (outdoor[c]) return -2;
      return room[c];
    };
    const plus = probeSide(1);
    const minus = probeSide(-1);
    const exterior = plus === -2 || minus === -2;
    // Normal pointing into the home for exterior openings; arbitrary but stable otherwise.
    const flip = plus === -2 ? -1 : 1;
    const normal = { x: fr.nrm.x * flip, y: fr.nrm.y * flip };
    const roomIn = flip === 1 ? plus : minus;
    const roomOut = flip === 1 ? minus : plus;

    const open = o.state !== "closed" && !(w.kind === "party" && o.kind === "door");
    const heightFactor = Math.min(1, Math.max(0.1, o.height / plan.ceiling));
    const stateFactor = o.state === "tilted" ? TILT_FACTOR : 1;
    const effWidth = open ? o.width * heightFactor * stateFactor : 0;
    const cells: number[] = [];
    const layers: number[] = [];
    if (open && effWidth > 0) {
      const halfSpan = Math.max(effWidth, dx) / 2;
      const gray = effWidth < dx ? 1 - effWidth / dx : 0;
      const r = fr.half + dx;
      const cx = w.a.x + fr.dir.x * o.offset;
      const cy = w.a.y + fr.dir.y * o.offset;
      const ext = halfSpan + r;
      forCellsInBox(g, cx - ext, cy - ext, cx + ext, cy + ext, (idx, p) => {
        if (!solid[idx]) return; // only cut through wall material; leave room/outdoor air untouched
        const { along, across } = local(fr, p);
        if (Math.abs(along - o.offset) <= halfSpan && Math.abs(across) <= fr.half + 0.25 * dx) {
          solid[idx] = 0;
          room[idx] = -1;
          outdoor[idx] = 0;
          porosity[idx] = Math.max(porosity[idx], gray);
          cells.push(idx);
          layers.push(Math.round(across / dx));
        }
      });
    }
    const layerSet = new Set(layers);
    const minLayer = layers.length ? Math.min(...layers) : 0;
    openings.push({
      id: o.id,
      kind: o.kind,
      exterior,
      cells: Int32Array.from(cells),
      layers: Int8Array.from(layers, (l) => l - minLayer),
      nLayers: Math.max(1, layerSet.size),
      normal,
      depth: 2 * fr.half,
      effWidth,
      roomIn,
      roomOut,
    });
  }

  // 6. Fans: momentum sources over the fan face (drawn as a thin slab across the blowing direction).
  for (const f of plan.fans) {
    if (!f.on) continue;
    const depth = Math.max(0.24, 2 * dx);
    const dirx = Math.cos(f.angle);
    const diry = Math.sin(f.angle);
    const r = f.size / 2 + depth + dx;
    forCellsInBox(g, f.pos.x - r, f.pos.y - r, f.pos.x + r, f.pos.y + r, (idx, p) => {
      if (solid[idx]) return;
      // Local frame: u along the blowing direction, w across the fan face.
      const rx = p.x - f.pos.x;
      const ry = p.y - f.pos.y;
      const u = rx * dirx + ry * diry;
      const wq = -rx * diry + ry * dirx;
      if (Math.abs(u) <= depth / 2 && Math.abs(wq) <= f.size / 2) {
        fanMask[idx] = 1;
        fanU[idx] = f.speed * dirx;
        fanV[idx] = f.speed * diry;
      }
    });
  }

  let indoorCells = 0;
  for (let k = 0; k < n; k++) if (room[k] >= 0) indoorCells++;

  // 7. Plenum zones: every outdoor cell takes the pressure of its nearest open exterior opening.
  const zone = new Int16Array(n).fill(-1);
  const zoneDist = new Uint16Array(n);
  const zoneOpening: number[] = [];
  let queue: number[] = [];
  openings.forEach((oc, oi) => {
    if (!oc.exterior || oc.cells.length === 0) return;
    const z = zoneOpening.length;
    zoneOpening.push(oi);
    for (const c of oc.cells) {
      const ci = c % nx;
      const cj = (c - ci) / nx;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
          const q = j * nx + i;
          if (outdoor[q] && zone[q] < 0) {
            zone[q] = z;
            queue.push(q);
          }
        }
    }
  });
  for (let layer = 1; queue.length; layer++) {
    const next: number[] = [];
    for (const c of queue) {
      const ci = c % nx;
      const nb = [ci > 0 ? c - 1 : -1, ci < nx - 1 ? c + 1 : -1, c - nx, c + nx];
      for (const q of nb) {
        if (q < 0 || q >= n || !outdoor[q] || zone[q] >= 0) continue;
        zone[q] = zone[c];
        zoneDist[q] = Math.min(65535, layer);
        next.push(q);
      }
    }
    queue = next;
  }

  return {
    grid: g,
    solid,
    porosity,
    outdoor,
    room,
    zone,
    zoneDist,
    zoneCount: zoneOpening.length,
    zoneOpening,
    fanMask,
    fanU,
    fanV,
    rooms,
    openings,
    comfort,
    indoorArea: indoorCells * dx * dx,
    ceiling: plan.ceiling,
  };
}
