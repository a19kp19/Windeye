/**
 * Steady local mean age of air (ISO 16000-8 / ASHRAE sense): how long, on average, the air at a
 * point has been indoors since it last entered from outside. Solves
 *
 *     u·∇τ = 1 + ∇·(D ∇τ),   τ = 0 in outdoor air,   ∂τ/∂n = 0 at walls
 *
 * on the lattice (dx = 1, time in lattice steps) with first-order upwinding, using Gauss–Seidel
 * sweeps that alternate direction so information travels along the flow in every orientation.
 */
export interface AgeInput {
  nx: number;
  ny: number;
  ux: Float32Array;
  uy: Float32Array;
  nuT: Float32Array;
  solid: Uint8Array;
  outdoor: Uint8Array;
  schmidt?: number;
  /** Floor on diffusivity (lattice units) so stagnant pockets stay finite. */
  minDiffusivity?: number;
}

export interface AgeResult {
  tau: Float32Array;
  sweeps: number;
  residual: number;
}

/** Hard cap (lattice steps) standing in for "effectively never refreshed". */
export const AGE_CAP = 2e7;

export function solveAge(
  input: AgeInput,
  opts: { maxSweeps?: number; tol?: number; init?: Float32Array } = {},
) {
  const { nx, ny, ux, uy, nuT, solid, outdoor } = input;
  const n = nx * ny;
  const invSc = 1 / (input.schmidt ?? 0.7);
  const Dmin = input.minDiffusivity ?? 0.004;
  const maxSweeps = opts.maxSweeps ?? 600;
  const tol = opts.tol ?? 2e-4;
  const tau = opts.init && opts.init.length === n ? opts.init : new Float32Array(n);
  // Air with no fluid path to outdoors is never replaced (leaks aren't modelled). Sweeping it would
  // only report a finite age that grows with the sweep count, so pin it at the cap instead.
  const reach = reachableFromOutdoors(nx, solid, outdoor);
  for (let c = 0; c < n; c++) {
    if (solid[c] || outdoor[c]) tau[c] = 0;
    else if (!reach[c]) tau[c] = AGE_CAP;
    else if (tau[c] >= AGE_CAP) tau[c] = 0; // sealed in the warm start, opened up since
  }

  let residual = Number.POSITIVE_INFINITY;
  let sweeps = 0;
  const relax = (c: number): number => {
    const t0 = tau[c];
    const u = ux[c];
    const v = uy[c];
    const D = nuT[c] * invSc + Dmin;
    const cW = c - 1;
    const cE = c + 1;
    const cN = c - nx;
    const cS = c + nx;
    let aP = 0;
    let rhs = 1;
    // Diffusion to fluid neighbours (walls are zero-flux, so they drop out).
    if (!solid[cW]) {
      aP += D;
      rhs += D * tau[cW];
    }
    if (!solid[cE]) {
      aP += D;
      rhs += D * tau[cE];
    }
    if (!solid[cN]) {
      aP += D;
      rhs += D * tau[cN];
    }
    if (!solid[cS]) {
      aP += D;
      rhs += D * tau[cS];
    }
    // Upwind advection.
    const up = u > 0 ? cW : cE;
    if (!solid[up]) {
      const au = Math.abs(u);
      aP += au;
      rhs += au * tau[up];
    }
    const vp = v > 0 ? cN : cS;
    if (!solid[vp]) {
      const av = Math.abs(v);
      aP += av;
      rhs += av * tau[vp];
    }
    let t = aP > 1e-9 ? rhs / aP : AGE_CAP;
    if (t > AGE_CAP) t = AGE_CAP;
    tau[c] = t;
    return Math.abs(t - t0) / (t + 50);
  };

  for (sweeps = 0; sweeps < maxSweeps; ) {
    let maxChange = 0;
    const dir = sweeps & 3;
    const iFwd = (dir & 1) === 0;
    const jFwd = (dir & 2) === 0;
    for (let jj = 1; jj < ny - 1; jj++) {
      const j = jFwd ? jj : ny - 1 - jj;
      const row = j * nx;
      for (let ii = 1; ii < nx - 1; ii++) {
        const i = iFwd ? ii : nx - 1 - ii;
        const c = row + i;
        if (solid[c] || outdoor[c] || !reach[c]) continue;
        const ch = relax(c);
        if (ch > maxChange) maxChange = ch;
      }
    }
    sweeps++;
    residual = maxChange;
    if (maxChange < tol && sweeps >= 8) break;
  }
  return { tau, sweeps, residual } satisfies AgeResult;
}

/** Fluid cells joined to an outdoor cell through fluid, 4-connected like the stencil. */
function reachableFromOutdoors(nx: number, solid: Uint8Array, outdoor: Uint8Array): Uint8Array {
  const n = solid.length;
  const reach = new Uint8Array(n);
  const queue = new Int32Array(n);
  let tail = 0;
  const visit = (c: number) => {
    if (reach[c] || solid[c]) return;
    reach[c] = 1;
    queue[tail++] = c;
  };
  for (let c = 0; c < n; c++) if (outdoor[c]) visit(c);
  for (let head = 0; head < tail; head++) {
    const c = queue[head];
    const i = c % nx;
    if (i > 0) visit(c - 1);
    if (i < nx - 1) visit(c + 1);
    if (c >= nx) visit(c - nx);
    if (c < n - nx) visit(c + nx);
  }
  return reach;
}
