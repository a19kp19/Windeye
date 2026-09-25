/**
 * Time series of window fluxes for the box case + density/speed snapshot.
 *   pnpm exec tsx scripts/diagnose.ts [targetCells] [seconds]
 */
import { mkdirSync } from "node:fs";
import type { Weather } from "../src/model/types";
import { FlowSolver } from "../src/sim/lbm";
import { computeMetrics } from "../src/sim/metrics";
import { rasterize } from "../src/sim/raster";
import { localWind, maxExpectedSpeed, PressureDriver, scalesFor } from "../src/sim/scene";
import { boxPlan } from "./calibrate-plan";
import { writePng } from "./png";

const [cellsArg = "30000", secsArg = "120"] = process.argv.slice(2);
const plan = boxPlan();
const weather: Weather = { windFromDeg: 180, windSpeed: 4, exposure: "open" };
const raster = rasterize(plan, { targetCells: Number(cellsArg) });
const { nx, ny, dx } = raster.grid;
const wind = localWind(weather, 0);
const sc = scalesFor(dx, maxExpectedSpeed(plan, wind));
const s = new FlowSolver(nx, ny);
s.setGeometry(raster, sc.velScale, false);
s.resetFlow();
const driver = new PressureDriver(raster, plan, weather);
console.log(`zone Cp: ${Array.from(driver.cp, (x) => x.toFixed(2)).join(", ")}`);
const total = Math.ceil(Number(secsArg) / sc.dt);
const every = Math.ceil(4 / sc.dt);
const zero = new Float32Array(nx * ny);
const line: string[] = [];
for (let k = 1; k <= total; k++) {
  if (k % 8 === 0) s.setZoneDensity(driver.densities(k * sc.dt, wind.speed * sc.velScale));
  s.step();
  if (k % every === 0) {
    const m = computeMetrics(raster, { ux: s.ux, uy: s.uy, tau: zero, fresh: zero }, sc.vel, sc.dt);
    const fl = m.openings.map((o) => o.flow.toFixed(0).padStart(6)).join(" ");
    let rmin = 9;
    let rmax = 0;
    for (let c = 0; c < nx * ny; c++)
      if (!raster.solid[c]) {
        rmin = Math.min(rmin, s.rho[c]);
        rmax = Math.max(rmax, s.rho[c]);
      }
    line.push(`t=${(k * sc.dt).toFixed(0).padStart(4)}s ${fl}  rho[${rmin.toFixed(4)},${rmax.toFixed(4)}]`);
  }
}
console.log(
  `grid ${nx}x${ny} dx=${dx} dt=${sc.dt.toFixed(4)} U=${wind.speed.toFixed(2)}  (flows: win-n win-s, m3/h)`,
);
console.log(line.join("\n"));
mkdirSync(".hoplite/artifacts", { recursive: true });
const S = 3;
const img = new Uint8Array(nx * S * ny * S * 4);
for (let y = 0; y < ny * S; y++)
  for (let x = 0; x < nx * S; x++) {
    const c = Math.floor(y / S) * nx + Math.floor(x / S);
    const o = (y * nx * S + x) * 4;
    if (raster.solid[c]) {
      img.set([20, 20, 24, 255], o);
      continue;
    }
    const p = (s.rho[c] - 1) / 0.01; // pressure: red = high, blue = low
    const sp = Math.min(1, Math.hypot(s.ux[c], s.uy[c]) / 0.15);
    const r = 255 * Math.min(1, Math.max(0, 0.5 + p));
    const b = 255 * Math.min(1, Math.max(0, 0.5 - p));
    img.set([r * (1 - 0.5 * sp), 110 + 100 * sp, b * (1 - 0.5 * sp), 255], o);
  }
writePng(".hoplite/artifacts/diag-box.png", nx * S, ny * S, img);
