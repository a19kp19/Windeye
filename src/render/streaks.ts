import type { RasterSummary } from "../sim/protocol";
import { streakInk } from "./palette";

export interface ViewXform {
  scale: number;
  ox: number;
  oy: number;
  dpr: number;
}

const BUCKETS = 8;
/** Screen-speed classes (px per frame): slow strokes are drawn fainter so still air reads as still. */
const SPEED_CLASSES = [0.35, 1.2] as const;
const SPEED_ALPHA = [0.28, 0.6, 0.9] as const;

/**
 * Streaklines: particles advected by the live velocity field in real time, drawn as short ink
 * strokes whose trails fade — like smoke in a wind tunnel, coloured by how fresh the air is.
 */
export class Streaks {
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private life = new Float32Array(0);
  private spawn = new Int32Array(0);
  private raster: RasterSummary | null = null;
  count = 0;

  setRaster(r: RasterSummary) {
    this.raster = r;
    const cells: number[] = [];
    for (let c = 0; c < r.solid.length; c++)
      if (!r.solid[c] && (r.room[c] >= 0 || !r.outdoor[c])) cells.push(c);
    this.spawn = Int32Array.from(cells);
    this.count = Math.min(7000, Math.max(800, Math.round(r.indoorArea * 70)));
    this.x = new Float32Array(this.count);
    this.y = new Float32Array(this.count);
    this.px = new Float32Array(this.count);
    this.py = new Float32Array(this.count);
    this.life = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) this.respawn(i, true);
  }

  private respawn(i: number, randomLife = false) {
    const r = this.raster;
    if (!r || this.spawn.length === 0) return;
    const c = this.spawn[(Math.random() * this.spawn.length) | 0];
    const nx = r.grid.nx;
    const ci = c % nx;
    const cj = (c - ci) / nx;
    this.x[i] = ci + Math.random();
    this.y[i] = cj + Math.random();
    this.px[i] = this.x[i];
    this.py[i] = this.y[i];
    this.life[i] = randomLife ? Math.random() * 5 : 2.5 + Math.random() * 4;
  }

  /** Bilinear sample of a cell-centred field at continuous grid coords (cell (i,j) centre = i+.5, j+.5). */
  private sample(f: Float32Array, x: number, y: number, nx: number, ny: number): number {
    const gx = x - 0.5;
    const gy = y - 0.5;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(gx)));
    const j = Math.max(0, Math.min(ny - 2, Math.floor(gy)));
    const tx = Math.max(0, Math.min(1, gx - i));
    const ty = Math.max(0, Math.min(1, gy - j));
    const c = j * nx + i;
    return (
      f[c] * (1 - tx) * (1 - ty) +
      f[c + 1] * tx * (1 - ty) +
      f[c + nx] * (1 - tx) * ty +
      f[c + nx + 1] * tx * ty
    );
  }

  /** Advance by `dt` wall-clock seconds. Velocities are in m/s. */
  step(dt: number, ux: Float32Array, uy: Float32Array) {
    const r = this.raster;
    if (!r) return;
    const { nx, ny, dx } = r.grid;
    const k = dt / dx;
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      const x = this.x[i];
      const y = this.y[i];
      this.px[i] = x;
      this.py[i] = y;
      const u1 = this.sample(ux, x, y, nx, ny);
      const v1 = this.sample(uy, x, y, nx, ny);
      const mx = x + 0.5 * k * u1;
      const my = y + 0.5 * k * v1;
      const u2 = this.sample(ux, mx, my, nx, ny);
      const v2 = this.sample(uy, mx, my, nx, ny);
      const X = x + k * u2;
      const Y = y + k * v2;
      const ci = X | 0;
      const cj = Y | 0;
      const inside = ci > 0 && cj > 0 && ci < nx - 1 && cj < ny - 1;
      const cell = cj * nx + ci;
      if (this.life[i] <= 0 || !inside || r.solid[cell] || (r.outdoor[cell] && Math.random() < 0.08)) {
        this.respawn(i);
        continue;
      }
      this.x[i] = X;
      this.y[i] = Y;
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewXform, fresh: Float32Array | null, ux: Float32Array) {
    const r = this.raster;
    if (!r) return;
    const { nx, ny, dx, x0, y0 } = r.grid;
    const s = view.scale * view.dpr;
    const ox = view.ox * view.dpr + x0 * s;
    const oy = view.oy * view.dpr + y0 * s;
    const cs = dx * s;
    const nPaths = BUCKETS * SPEED_ALPHA.length;
    const paths: Path2D[] = Array.from({ length: nPaths }, () => new Path2D());
    const used = new Uint8Array(nPaths);
    const minLen = 0.25 * view.dpr;
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i];
      const y = this.y[i];
      const pxv = this.px[i];
      const pyv = this.py[i];
      const segLen = Math.hypot(x - pxv, y - pyv) * cs;
      // Zero-length round-capped strokes would pile up as speckle in still air.
      if (segLen < minLen) continue;
      const f = fresh ? this.sample(fresh, x, y, nx, ny) : 1;
      const b = Math.min(BUCKETS - 1, Math.max(0, Math.round(f * (BUCKETS - 1))));
      const sc = segLen < SPEED_CLASSES[0] * view.dpr ? 0 : segLen < SPEED_CLASSES[1] * view.dpr ? 1 : 2;
      const k = sc * BUCKETS + b;
      const p = paths[k];
      p.moveTo(ox + pxv * cs, oy + pyv * cs);
      p.lineTo(ox + x * cs, oy + y * cs);
      used[k] = 1;
    }
    void ux;
    ctx.lineWidth = Math.max(1, 1.1 * view.dpr);
    ctx.lineCap = "butt";
    for (let k = 0; k < nPaths; k++) {
      if (!used[k]) continue;
      const b = k % BUCKETS;
      const sc = (k - b) / BUCKETS;
      const [R, G, B] = streakInk(b / (BUCKETS - 1));
      ctx.strokeStyle = `rgba(${R | 0},${G | 0},${B | 0},${SPEED_ALPHA[sc]})`;
      ctx.stroke(paths[k]);
    }
  }
}
