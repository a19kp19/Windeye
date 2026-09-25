import { bearingToPlan, dot, planBounds } from "../model/geometry";
import type { Exposure, Plan, Vec2, Weather } from "../model/types";
import { solveAge } from "./age";
import { FlowSolver } from "./lbm";
import { computeMetrics, type Metrics } from "./metrics";
import { type Raster, type RasterOptions, rasterize } from "./raster";

/**
 * Ratio of wind at window height to the 10 m weather-station wind. Rough values combining a
 * power-law boundary layer with local sheltering by neighbouring buildings and trees.
 */
export const EXPOSURE_FACTOR: Record<Exposure, number> = {
  sheltered: 0.3,
  suburban: 0.5,
  open: 0.72,
};

export interface LocalWind {
  speed: number;
  /** Unit vector (plan coordinates) the air moves toward. */
  dir: Vec2;
}

export function localWind(weather: Weather, northDeg: number): LocalWind {
  return {
    speed: Math.max(0, weather.windSpeed) * EXPOSURE_FACTOR[weather.exposure],
    dir: bearingToPlan(weather.windFromDeg + 180, northDeg),
  };
}

export interface Scales {
  dx: number;
  /** Seconds per lattice step. */
  dt: number;
  /** m/s per lattice velocity unit (dx/dt). */
  vel: number;
  /** Lattice velocity units per m/s (dt/dx). */
  velScale: number;
  /** Physical speed mapped to the reference lattice speed. */
  uRef: number;
}

/** Lattice speed used for the fastest expected flow; keeps Mach low but Reynolds usable. */
export const U_LATTICE_REF = 0.1;

export function maxExpectedSpeed(plan: Plan, wind: LocalWind): number {
  let m = wind.speed;
  for (const f of plan.fans) if (f.on) m = Math.max(m, f.speed);
  return Math.max(0.6, m);
}

export function scalesFor(dx: number, uRef: number): Scales {
  const dt = (dx * U_LATTICE_REF) / uRef;
  return { dx, dt, vel: dx / dt, velScale: dt / dx, uRef };
}

/**
 * Surface-averaged wind pressure coefficient of a low-rise façade (Swami & Chandra 1987, as used
 * in ASHRAE Fundamentals / AIVC). θ = angle between the wind-from direction and the façade's
 * outward normal (0 = wind straight onto the wall); G = ln(façade width / adjacent depth).
 */
export function facadeCp(thetaRad: number, G = 0, cp0 = 0.6): number {
  const t = Math.abs(thetaRad) % (2 * Math.PI);
  const th = t > Math.PI ? 2 * Math.PI - t : t;
  const s2 = Math.sin(th / 2);
  const c2 = Math.cos(th / 2);
  const arg =
    1.248 -
    0.703 * s2 -
    1.175 * Math.sin(th) ** 2 +
    0.131 * Math.sin(2 * th * G) ** 3 +
    0.769 * c2 +
    0.07 * G * G * s2 * s2 +
    0.717 * c2 * c2;
  return cp0 * Math.log(Math.max(arg, 1e-3));
}

/** Turns wind into plenum pressures, with slow random gusting so single-sided rooms still breathe. */
export class PressureDriver {
  readonly cp: Float32Array;
  private readonly phase: Float32Array;
  private readonly omega: Float32Array;
  readonly gust = 0.12;
  private readonly out: Float32Array;

  constructor(raster: Raster, plan: Plan, weather: Weather) {
    const nz = raster.zoneCount;
    this.cp = new Float32Array(nz);
    this.phase = new Float32Array(nz);
    this.omega = new Float32Array(nz);
    this.out = new Float32Array(nz).fill(1);
    const fromDir = bearingToPlan(weather.windFromDeg, plan.northDeg);
    const b = planBounds(plan);
    const W = Math.max(0.5, b.maxX - b.minX);
    const D = Math.max(0.5, b.maxY - b.minY);
    for (let z = 0; z < nz; z++) {
      const o = raster.openings[raster.zoneOpening[z]];
      const outward = { x: -o.normal.x, y: -o.normal.y };
      const theta = Math.acos(Math.max(-1, Math.min(1, dot(outward, fromDir))));
      const alongX = Math.abs(o.normal.y) > Math.abs(o.normal.x);
      const G = Math.log(alongX ? W / D : D / W);
      this.cp[z] = facadeCp(theta, G);
      let h = 2166136261;
      for (const ch of o.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const u = ((h >>> 0) % 10007) / 10007;
      this.phase[z] = u * 2 * Math.PI;
      this.omega[z] = (2 * Math.PI) / (5 + 4 * ((u * 7.31) % 1));
    }
  }

  /** Target plenum densities at physical time t for a lattice wind speed uLat. */
  densities(t: number, uLat: number): Float32Array {
    // Δρ per unit Cp is ½u²/c_s² = 1.5u²; the calibration factor centres the box test on the
    // empirical orifice model (see scripts/calibrate.ts and the regression test).
    const q = PRESSURE_CALIBRATION * 1.5 * uLat * uLat;
    for (let z = 0; z < this.cp.length; z++) {
      this.out[z] = 1 + q * (this.cp[z] + this.gust * Math.sin(this.omega[z] * t + this.phase[z]));
    }
    return this.out;
  }
}

/** Scales façade pressures; tuned so a plain box with opposite windows matches Q = Cd·A·U·√ΔCp. */
export const PRESSURE_CALIBRATION = 1.5;

export interface HeadlessOptions extends RasterOptions {
  /** Simulated seconds of flow development before averaging. */
  spinUp?: number;
  /** Simulated seconds of averaging. */
  average?: number;
  /** Hard cap on lattice steps (keeps coarse optimiser runs bounded). */
  maxSteps?: number;
}

export interface HeadlessResult {
  raster: Raster;
  scales: Scales;
  metrics: Metrics;
  meanUx: Float32Array;
  meanUy: Float32Array;
  tau: Float32Array;
  steps: number;
}

/** Run a plan to a quasi-steady state without any UI and measure it. */
export function runScene(plan: Plan, weather: Weather, opts: HeadlessOptions = {}): HeadlessResult {
  const raster = rasterize(plan, opts);
  const { nx, ny, dx } = raster.grid;
  const wind = localWind(weather, plan.northDeg);
  const scales = scalesFor(dx, maxExpectedSpeed(plan, wind));
  const solver = new FlowSolver(nx, ny);
  solver.setGeometry(raster, scales.velScale, false);
  solver.resetFlow();
  const driver = new PressureDriver(raster, plan, weather);
  const uLat = wind.speed * scales.velScale;
  let step = 0;
  const advance = () => {
    if (step % 8 === 0) solver.setZoneDensity(driver.densities(step * scales.dt, uLat));
    solver.step();
    step++;
  };

  const spin = opts.spinUp ?? 25;
  const avg = opts.average ?? 20;
  const cap = opts.maxSteps ?? 40000;
  const spinSteps = Math.min(cap / 2, Math.ceil(spin / scales.dt));
  const avgSteps = Math.min(cap / 2, Math.ceil(avg / scales.dt));
  solver.meanAlpha = 0.02;
  for (let s = 0; s < spinSteps; s++) advance();
  // Plain running average over the averaging window.
  const mux = new Float64Array(raster.solid.length);
  const muy = new Float64Array(raster.solid.length);
  const nut = new Float64Array(raster.solid.length);
  for (let s = 0; s < avgSteps; s++) {
    advance();
    for (let c = 0; c < mux.length; c++) {
      mux[c] += solver.ux[c];
      muy[c] += solver.uy[c];
      nut[c] += solver.nuT[c];
    }
  }
  const meanUx = Float32Array.from(mux, (x) => x / avgSteps);
  const meanUy = Float32Array.from(muy, (x) => x / avgSteps);
  const meanNu = Float32Array.from(nut, (x) => x / avgSteps);
  const age = solveAge({
    nx,
    ny,
    ux: meanUx,
    uy: meanUy,
    nuT: meanNu,
    solid: raster.solid,
    outdoor: raster.outdoor,
  });
  const fresh = new Float32Array(raster.solid.length);
  const metrics = computeMetrics(
    raster,
    { ux: meanUx, uy: meanUy, tau: age.tau, fresh },
    scales.vel,
    scales.dt,
  );
  return { raster, scales, metrics, meanUx, meanUy, tau: age.tau, steps: spinSteps + avgSteps };
}
