/// <reference lib="webworker" />
import type { Plan, Weather } from "../model/types";
import { AGE_CAP, solveAge } from "./age";
import { coolingEffect } from "./comfort";
import { FlowSolver } from "./lbm";
import { computeMetrics } from "./metrics";
import type { FromWorker, ToWorker } from "./protocol";
import { type Raster, rasterize } from "./raster";
import { localWind, maxExpectedSpeed, PressureDriver, type Scales, scalesFor } from "./scene";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let plan: Plan | null = null;
let weather: Weather | null = null;
let raster: Raster | null = null;
let solver: FlowSolver | null = null;
let driver: PressureDriver | null = null;
let scales: Scales | null = null;
let uLat = 0;
let running = true;
let simTime = 0;
let tracerTime = 0;
let tracerSubsteps = 1;
let tau: Float32Array | null = null;
let lastFrame = 0;
let lastMetrics = 0;
let stepsWindow = 0;
let windowStart = performance.now();
let stepsPerSec = 0;
let clockStart = performance.now();
const pool: ArrayBuffer[] = [];

/** Averaging window for the mean flow that metrics use (simulated seconds). */
const MEAN_WINDOW_S = 8;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

function take(n: number): Float32Array {
  while (pool.length) {
    const b = pool.pop()!;
    if (b.byteLength === n * 4) return new Float32Array(b);
  }
  return new Float32Array(n);
}

function applyWeather() {
  if (!plan || !weather || !raster || !solver) return;
  const wind = localWind(weather, plan.northDeg);
  const next = scalesFor(raster.grid.dx, maxExpectedSpeed(plan, wind));
  if (scales && Math.abs(next.uRef - scales.uRef) / scales.uRef > 0.02) {
    // Keep the physical flow when the lattice time step changes.
    solver.rescaleVelocity(scales.uRef / next.uRef);
  }
  scales = next;
  uLat = wind.speed * scales.velScale;
  driver = new PressureDriver(raster, plan, weather);
  solver.setFanVelocity(raster, scales.velScale);
  solver.meanAlpha = Math.min(0.05, scales.dt / MEAN_WINDOW_S);
}

function load(p: Plan, w: Weather, targetCells: number, keepFlow: boolean) {
  plan = p;
  weather = w;
  const r = rasterize(p, { targetCells });
  const sameGrid =
    solver &&
    raster &&
    raster.grid.nx === r.grid.nx &&
    raster.grid.ny === r.grid.ny &&
    Math.abs(raster.grid.dx - r.grid.dx) < 1e-9 &&
    Math.abs(raster.grid.x0 - r.grid.x0) < 1e-9 &&
    Math.abs(raster.grid.y0 - r.grid.y0) < 1e-9;
  if (!sameGrid) {
    solver = new FlowSolver(r.grid.nx, r.grid.ny);
    tau = null;
    simTime = 0;
    tracerTime = 0;
    scales = null;
  }
  raster = r;
  const wind = localWind(w, p.northDeg);
  const sc = scalesFor(r.grid.dx, maxExpectedSpeed(p, wind));
  solver!.setGeometry(r, sc.velScale, Boolean(sameGrid && keepFlow));
  if (!sameGrid || !keepFlow) solver!.resetTracer();
  applyWeather();
  // Age warm start only makes sense on an unchanged grid; zero it where cells changed role.
  if (tau && tau.length === r.solid.length) {
    for (let c = 0; c < tau.length; c++) if (r.solid[c] || r.outdoor[c]) tau[c] = 0;
  }
  lastMetrics = 0;
  post({
    type: "raster",
    grid: r.grid,
    solid: r.solid,
    outdoor: r.outdoor,
    room: r.room,
    rooms: r.rooms,
    facades: driver ? r.zoneOpening.map((oi, z) => ({ id: r.openings[oi].id, cp: driver!.cp[z] })) : [],
    openings: r.openings.map((o) => ({
      id: o.id,
      nx: o.normal.x,
      ny: o.normal.y,
      exterior: o.exterior,
      roomIn: o.roomIn,
      roomOut: o.roomOut,
    })),
    dt: scales!.dt,
    vel: scales!.vel,
    indoorArea: r.indoorArea,
  });
}

function sendFrame(now: number) {
  if (!solver || !scales) return;
  const n = solver.n;
  const ux = take(n);
  const uy = take(n);
  const fresh = take(n);
  const v = scales.vel;
  const sx = solver.ux;
  const sy = solver.uy;
  for (let c = 0; c < n; c++) {
    ux[c] = sx[c] * v;
    uy[c] = sy[c] * v;
  }
  fresh.set(solver.fresh);
  post(
    {
      type: "frame",
      ux,
      uy,
      fresh,
      simTime,
      tracerTime,
      realTime: (now - clockStart) / 1000,
      stepsPerSec,
    },
    [ux.buffer, uy.buffer, fresh.buffer],
  );
}

function sendMetrics() {
  if (!solver || !raster || !scales) return;
  const { nx, ny } = raster.grid;
  const age = solveAge(
    {
      nx,
      ny,
      ux: solver.meanUx,
      uy: solver.meanUy,
      nuT: solver.nuT,
      solid: solver.solid,
      outdoor: raster.outdoor,
    },
    { maxSweeps: tau ? 40 : 160, init: tau ?? undefined, tol: 5e-4 },
  );
  tau = age.tau;
  const n = solver.n;
  const ageS = new Float32Array(n);
  const cooling = new Float32Array(n);
  const v = scales.vel;
  for (let c = 0; c < n; c++) {
    if (raster.room[c] < 0) continue;
    ageS[c] = tau[c] >= AGE_CAP ? Number.POSITIVE_INFINITY : tau[c] * scales.dt;
    cooling[c] = coolingEffect(Math.hypot(solver.meanUx[c], solver.meanUy[c]) * v);
  }
  const metrics = computeMetrics(
    raster,
    { ux: solver.meanUx, uy: solver.meanUy, tau, fresh: solver.fresh },
    v,
    scales.dt,
  );
  post({ type: "metrics", metrics, age: ageS, cooling, converged: age.residual < 5e-3 }, [
    ageS.buffer,
    cooling.buffer,
  ]);
}

// Zero-delay scheduling (setTimeout(0) is clamped to 4 ms when nested).
const channel = new MessageChannel();
channel.port1.onmessage = tick;
const schedule = () => channel.port2.postMessage(0);

function tick() {
  const now = performance.now();
  if (running && solver && scales && driver) {
    const budgetEnd = now + 14;
    let k = 0;
    do {
      if ((solver.steps & 7) === 0) solver.setZoneDensity(driver.densities(simTime, uLat));
      solver.step();
      simTime += scales.dt;
      for (let s = 0; s < tracerSubsteps; s++) solver.stepTracer(tracerSubsteps > 1 ? 2 : 1);
      tracerTime += scales.dt * (tracerSubsteps > 1 ? 2 * tracerSubsteps : 1);
      k++;
    } while (performance.now() < budgetEnd);
    stepsWindow += k;
  }
  const t = performance.now();
  if (t - windowStart > 1000) {
    stepsPerSec = (stepsWindow * 1000) / (t - windowStart);
    stepsWindow = 0;
    windowStart = t;
  }
  if (t - lastFrame > 33) {
    lastFrame = t;
    sendFrame(t);
  }
  if (running && t - lastMetrics > 1200) {
    lastMetrics = t;
    sendMetrics();
  }
  if (running) schedule();
  else setTimeout(tick, 100);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "load":
        load(msg.plan, msg.weather, msg.targetCells, msg.keepFlow);
        break;
      case "weather":
        weather = msg.weather;
        applyWeather();
        break;
      case "running":
        running = msg.running;
        break;
      case "resetClock":
        solver?.resetTracer();
        tracerTime = 0;
        clockStart = performance.now();
        break;
      case "tracerSpeed":
        tracerSubsteps = Math.max(1, Math.min(4, Math.round(msg.substeps)));
        break;
      case "recycle":
        for (const b of msg.buffers) if (pool.length < 12) pool.push(b);
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

tick();
