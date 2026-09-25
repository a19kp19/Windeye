import type { Raster } from "./raster";

// D2Q9 lattice: rest, 4 axis links, 4 diagonals. Direction k moves by (EX[k], EY[k]) cells per step.
export const EX = [0, 1, 0, -1, 0, 1, -1, -1, 1] as const;
export const EY = [0, 0, 1, 0, -1, 1, 1, -1, -1] as const;
const WT = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const;

export interface FlowParams {
  /** Base BGK relaxation time; ν = (τ₀ − ½)/3 in lattice units. */
  tau0: number;
  /** Smagorinsky constant for the LES eddy viscosity. */
  smagorinsky: number;
  /** Fraction of the gap to the fan's target velocity closed per step. */
  fanGain: number;
  /**
   * Share of velocity a *distant* plenum cell keeps per step. Cells near an opening keep all of it
   * (a pure pressure boundary) — damping there acts as drag and throttles the window.
   */
  plenumKeep: number;
  /** Turbulent Schmidt number for the tracer. */
  schmidt: number;
}

export const DEFAULT_FLOW_PARAMS: FlowParams = {
  tau0: 0.508,
  smagorinsky: 0.16,
  fanGain: 0.25,
  plenumKeep: 0.9,
  schmidt: 0.7,
};

/** Plenum cells closer than this (in cells) to an opening are pure pressure boundaries. */
const PLENUM_FREE_CELLS = 14;

/** Lattice speed cap — above this we are outside the low-Mach regime LBM is valid for. */
const U_CLAMP = 0.3;

export function feq(k: number, rho: number, ux: number, uy: number): number {
  const eu = EX[k] * ux + EY[k] * uy;
  return WT[k] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * (ux * ux + uy * uy));
}

/**
 * Indoor airflow on a D2Q9 lattice with Smagorinsky LES.
 *
 * Outdoor air is not simulated as free wind (a 2-D plan view would force all of it *around* the
 * building and wildly overstate façade pressures). Instead outdoor cells form pressure plenums:
 * each is held at the wind pressure of its nearest exterior opening, the way multizone models
 * (e.g. NIST CONTAM) drive ventilation from façade pressure coefficients.
 */
export class FlowSolver {
  readonly nx: number;
  readonly ny: number;
  readonly n: number;
  readonly params: FlowParams;

  /** Post-collision populations (structure-of-arrays: f[k*n + cell]). */
  f: Float32Array;
  private g: Float32Array;
  readonly ux: Float32Array;
  readonly uy: Float32Array;
  readonly rho: Float32Array;
  /** Eddy viscosity (lattice units), drives tracer mixing. */
  readonly nuT: Float32Array;
  /** Exponentially time-averaged velocity — what metrics are computed from. */
  readonly meanUx: Float32Array;
  readonly meanUy: Float32Array;
  /** Fresh-air tracer: 1 = outdoor air, 0 = the air that was indoors when the clock started. */
  fresh: Float32Array;
  private freshNext: Float32Array;

  solid: Uint8Array;
  porosity: Float32Array;
  outdoor: Uint8Array;
  fanMask: Uint8Array;
  /** Plenum zone (index of the exterior opening an outdoor cell belongs to), -1 elsewhere. */
  zone: Int16Array;
  zoneDist: Uint16Array;
  /** Target density per plenum zone. */
  zoneRho: Float32Array = new Float32Array(0);
  readonly fanUl: Float32Array;
  readonly fanVl: Float32Array;

  /** Blend factor for the running mean, per step. */
  meanAlpha = 0.002;
  steps = 0;
  resets = 0;

  constructor(nx: number, ny: number, params: Partial<FlowParams> = {}) {
    this.nx = nx;
    this.ny = ny;
    this.n = nx * ny;
    this.params = { ...DEFAULT_FLOW_PARAMS, ...params };
    const n = this.n;
    this.f = new Float32Array(9 * n);
    this.g = new Float32Array(9 * n);
    this.ux = new Float32Array(n);
    this.uy = new Float32Array(n);
    this.rho = new Float32Array(n).fill(1);
    this.nuT = new Float32Array(n);
    this.meanUx = new Float32Array(n);
    this.meanUy = new Float32Array(n);
    this.fresh = new Float32Array(n);
    this.freshNext = new Float32Array(n);
    this.solid = new Uint8Array(n);
    this.porosity = new Float32Array(n);
    this.outdoor = new Uint8Array(n);
    this.fanMask = new Uint8Array(n);
    this.zone = new Int16Array(n).fill(-1);
    this.zoneDist = new Uint16Array(n);
    this.fanUl = new Float32Array(n);
    this.fanVl = new Float32Array(n);
    this.resetFlow();
  }

  /** Load masks from a raster of the same grid size. With `keep`, existing flow survives the edit. */
  setGeometry(r: Raster, velScale: number, keep: boolean) {
    const { n, nx, ny } = this;
    const wasSolid = this.solid;
    const solid = r.solid.slice();
    // The outermost ring is never streamed from; seal it so pulls stay in bounds.
    for (let i = 0; i < nx; i++) {
      solid[i] = 1;
      solid[(ny - 1) * nx + i] = 1;
    }
    for (let j = 0; j < ny; j++) {
      solid[j * nx] = 1;
      solid[j * nx + nx - 1] = 1;
    }
    this.solid = solid;
    this.porosity = r.porosity;
    this.outdoor = r.outdoor;
    this.fanMask = r.fanMask;
    this.zone = r.zone;
    this.zoneDist = r.zoneDist;
    if (this.zoneRho.length !== r.zoneCount) this.zoneRho = new Float32Array(r.zoneCount).fill(1);
    this.setFanVelocity(r, velScale);
    const f = this.f;
    for (let i = 0; i < n; i++) {
      if (solid[i]) {
        this.ux[i] = 0;
        this.uy[i] = 0;
        this.meanUx[i] = 0;
        this.meanUy[i] = 0;
        continue;
      }
      if (!keep || wasSolid[i]) {
        for (let k = 0; k < 9; k++) f[k * n + i] = WT[k];
        this.rho[i] = 1;
        this.ux[i] = 0;
        this.uy[i] = 0;
        this.meanUx[i] = 0;
        this.meanUy[i] = 0;
        this.fresh[i] = this.outdoor[i] ? 1 : 0;
      }
      if (this.outdoor[i]) this.fresh[i] = 1;
    }
  }

  setFanVelocity(r: Raster, velScale: number) {
    for (let i = 0; i < this.n; i++) {
      this.fanUl[i] = r.fanU[i] * velScale;
      this.fanVl[i] = r.fanV[i] * velScale;
    }
  }

  /** Target density for each plenum zone (1 + 3·Δp in lattice units). */
  setZoneDensity(rho: ArrayLike<number>) {
    for (let z = 0; z < this.zoneRho.length; z++) this.zoneRho[z] = rho[z] ?? 1;
  }

  /** Re-express the current flow for a new lattice velocity scale (keeps the physical flow). */
  rescaleVelocity(ratio: number) {
    const { n, f } = this;
    for (let i = 0; i < n; i++) {
      if (this.solid[i]) continue;
      const rho = 1 + (this.rho[i] - 1) * ratio * ratio;
      const ux = this.ux[i] * ratio;
      const uy = this.uy[i] * ratio;
      this.rho[i] = rho;
      this.ux[i] = ux;
      this.uy[i] = uy;
      this.meanUx[i] *= ratio;
      this.meanUy[i] *= ratio;
      for (let k = 0; k < 9; k++) f[k * n + i] = feq(k, rho, ux, uy);
    }
  }

  resetFlow() {
    const { n, f } = this;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 9; k++) f[k * n + i] = WT[k];
      this.rho[i] = 1;
      this.ux[i] = 0;
      this.uy[i] = 0;
      this.meanUx[i] = 0;
      this.meanUy[i] = 0;
    }
  }

  resetTracer() {
    for (let i = 0; i < this.n; i++) this.fresh[i] = this.outdoor[i] ? 1 : 0;
  }

  /** One lattice step: stream (pull) + collide, with walls, gray cells, fans and pressure plenums. */
  step() {
    const { nx, ny, n, f, g, solid, porosity, fanMask, outdoor, zone, zoneRho, zoneDist } = this;
    const { ux: UX, uy: UY, rho: RHO, nuT } = this;
    const { tau0, smagorinsky, fanGain, plenumKeep } = this.params;
    const cs2x18 = 18 * smagorinsky * smagorinsky * Math.SQRT2;
    const tau0sq = tau0 * tau0;
    const alpha = this.meanAlpha;
    const mUX = this.meanUx;
    const mUY = this.meanUy;
    const n2 = 2 * n;
    const n3 = 3 * n;
    const n4 = 4 * n;
    const n5 = 5 * n;
    const n6 = 6 * n;
    const n7 = 7 * n;
    const n8 = 8 * n;

    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx;
      for (let i = 1; i < nx - 1; i++) {
        const c = row + i;
        if (solid[c]) continue;
        // Pull streaming; a solid upstream neighbour reflects this cell's own opposite population.
        const cW = c - 1;
        const cE = c + 1;
        const cN = c - nx;
        const cS = c + nx;
        const f0 = f[c];
        const f1 = solid[cW] ? f[n3 + c] : f[n + cW];
        const f2 = solid[cN] ? f[n4 + c] : f[n2 + cN];
        const f3 = solid[cE] ? f[n + c] : f[n3 + cE];
        const f4 = solid[cS] ? f[n2 + c] : f[n4 + cS];
        const f5 = solid[cN - 1] ? f[n7 + c] : f[n5 + cN - 1];
        const f6 = solid[cN + 1] ? f[n8 + c] : f[n6 + cN + 1];
        const f7 = solid[cS + 1] ? f[n5 + c] : f[n7 + cS + 1];
        const f8 = solid[cS - 1] ? f[n6 + c] : f[n8 + cS - 1];

        let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
        if (!(rho > 0.2 && rho < 5)) rho = 1; // NaN / blow-up guard
        const ir = 1 / rho;
        let ux = (f1 - f3 + f5 - f6 - f7 + f8) * ir;
        let uy = (f2 - f4 + f5 + f6 - f7 - f8) * ir;
        let u2 = ux * ux + uy * uy;
        if (!(u2 < U_CLAMP * U_CLAMP)) {
          const s = u2 > 0 ? U_CLAMP / Math.sqrt(u2) : 0;
          ux = Number.isFinite(s) ? ux * s : 0;
          uy = Number.isFinite(s) ? uy * s : 0;
          u2 = ux * ux + uy * uy;
        }

        if (outdoor[c]) {
          // Pressure plenum: hold the façade pressure, let some velocity through so jets can leave.
          const z = zone[c];
          const pr = z >= 0 ? zoneRho[z] : 1;
          const keep = z >= 0 && zoneDist[c] < PLENUM_FREE_CELLS ? 1 : plenumKeep;
          const vx = ux * keep;
          const vy = uy * keep;
          for (let k = 0; k < 9; k++) g[k * n + c] = feq(k, pr, vx, vy);
          UX[c] = vx;
          UY[c] = vy;
          RHO[c] = pr;
          nuT[c] = 0;
          continue;
        }

        const uu = 1.5 * u2;
        const r9 = rho / 9;
        const r36 = rho / 36;
        const e0 = (4 / 9) * rho * (1 - uu);
        const e1 = r9 * (1 + 3 * ux + 4.5 * ux * ux - uu);
        const e3 = r9 * (1 - 3 * ux + 4.5 * ux * ux - uu);
        const e2 = r9 * (1 + 3 * uy + 4.5 * uy * uy - uu);
        const e4 = r9 * (1 - 3 * uy + 4.5 * uy * uy - uu);
        const p5 = ux + uy;
        const p6 = uy - ux;
        const e5 = r36 * (1 + 3 * p5 + 4.5 * p5 * p5 - uu);
        const e7 = r36 * (1 - 3 * p5 + 4.5 * p5 * p5 - uu);
        const e6 = r36 * (1 + 3 * p6 + 4.5 * p6 * p6 - uu);
        const e8 = r36 * (1 - 3 * p6 + 4.5 * p6 * p6 - uu);

        // Smagorinsky: local relaxation time from the non-equilibrium momentum flux.
        const q1 = f1 - e1;
        const q2 = f2 - e2;
        const q3 = f3 - e3;
        const q4 = f4 - e4;
        const q5 = f5 - e5;
        const q6 = f6 - e6;
        const q7 = f7 - e7;
        const q8 = f8 - e8;
        const pxx = q1 + q3 + q5 + q6 + q7 + q8;
        const pyy = q2 + q4 + q5 + q6 + q7 + q8;
        const pxy = q5 - q6 + q7 - q8;
        const Q = Math.sqrt(pxx * pxx + pyy * pyy + 2 * pxy * pxy);
        const tau = 0.5 * (tau0 + Math.sqrt(tau0sq + cs2x18 * Q * ir));
        const om = 1 / tau;
        nuT[c] = (tau - tau0) / 3;

        let g0 = f0 + om * (e0 - f0);
        let g1 = f1 + om * (e1 - f1);
        let g2 = f2 + om * (e2 - f2);
        let g3 = f3 + om * (e3 - f3);
        let g4 = f4 + om * (e4 - f4);
        let g5 = f5 + om * (e5 - f5);
        let g6 = f6 + om * (e6 - f6);
        let g7 = f7 + om * (e7 - f7);
        let g8 = f8 + om * (e8 - f8);

        if (fanMask[c]) {
          // Exact-difference forcing toward the fan's exit velocity.
          const dux = fanGain * (this.fanUl[c] - ux);
          const duy = fanGain * (this.fanVl[c] - uy);
          const vx = ux + dux;
          const vy = uy + duy;
          g0 += feq(0, rho, vx, vy) - e0;
          g1 += feq(1, rho, vx, vy) - e1;
          g2 += feq(2, rho, vx, vy) - e2;
          g3 += feq(3, rho, vx, vy) - e3;
          g4 += feq(4, rho, vx, vy) - e4;
          g5 += feq(5, rho, vx, vy) - e5;
          g6 += feq(6, rho, vx, vy) - e6;
          g7 += feq(7, rho, vx, vy) - e7;
          g8 += feq(8, rho, vx, vy) - e8;
          ux += 0.5 * dux;
          uy += 0.5 * duy;
        }

        const ns = porosity[c];
        if (ns > 0) {
          // Gray lattice Boltzmann: partial bounce-back = partial blockage.
          const m = 1 - ns;
          g0 = m * g0 + ns * f0;
          g1 = m * g1 + ns * f3;
          g2 = m * g2 + ns * f4;
          g3 = m * g3 + ns * f1;
          g4 = m * g4 + ns * f2;
          g5 = m * g5 + ns * f7;
          g6 = m * g6 + ns * f8;
          g7 = m * g7 + ns * f5;
          g8 = m * g8 + ns * f6;
          ux *= m;
          uy *= m;
        }

        g[c] = g0;
        g[n + c] = g1;
        g[n2 + c] = g2;
        g[n3 + c] = g3;
        g[n4 + c] = g4;
        g[n5 + c] = g5;
        g[n6 + c] = g6;
        g[n7 + c] = g7;
        g[n8 + c] = g8;
        UX[c] = ux;
        UY[c] = uy;
        RHO[c] = rho;
        mUX[c] += alpha * (ux - mUX[c]);
        mUY[c] += alpha * (uy - mUY[c]);
      }
    }
    this.g = f;
    this.f = g;
    this.steps++;
    if ((this.steps & 255) === 0) this.checkHealth();
  }

  /** If anything went non-finite, restart the flow rather than render garbage. */
  private checkHealth() {
    const { n } = this;
    for (let i = 0; i < n; i += 97) {
      if (!Number.isFinite(this.ux[i]) || !Number.isFinite(this.f[i])) {
        this.resets++;
        this.resetFlow();
        return;
      }
    }
  }

  /**
   * Advance the fresh-air tracer. `scale` = tracer steps per lattice step's worth of time
   * (>1 fast-forwards the tracer over the current, quasi-steady flow).
   */
  stepTracer(scale = 1) {
    const { nx, ny, solid, outdoor, ux, uy, nuT } = this;
    const c0 = this.fresh;
    const c1 = this.freshNext;
    const invSc = 1 / this.params.schmidt;
    const D0 = 0.0015;
    for (let j = 1; j < ny - 1; j++) {
      const row = j * nx;
      for (let i = 1; i < nx - 1; i++) {
        const c = row + i;
        if (solid[c]) continue;
        if (outdoor[c]) {
          c1[c] = 1;
          continue;
        }
        const v0 = c0[c];
        const vW = solid[c - 1] ? v0 : c0[c - 1];
        const vE = solid[c + 1] ? v0 : c0[c + 1];
        const vN = solid[c - nx] ? v0 : c0[c - nx];
        const vS = solid[c + nx] ? v0 : c0[c + nx];
        let u = ux[c] * scale;
        let w = uy[c] * scale;
        let D = (nuT[c] * invSc + D0) * scale;
        const cfl = Math.abs(u) + Math.abs(w) + 4 * D;
        if (cfl > 0.95) {
          const s = 0.95 / cfl;
          u *= s;
          w *= s;
          D *= s;
        }
        const adv = (u > 0 ? u * (v0 - vW) : u * (vE - v0)) + (w > 0 ? w * (v0 - vN) : w * (vS - v0));
        const val = v0 - adv + D * (vW + vE + vN + vS - 4 * v0);
        c1[c] = val < 0 ? 0 : val > 1 ? 1 : val;
      }
    }
    this.fresh = c1;
    this.freshNext = c0;
  }
}
