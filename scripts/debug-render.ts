/**
 * Headless physics check: run a template, print metrics, and dump field images.
 *   pnpm exec tsx scripts/debug-render.ts [templateId] [windFromDeg] [windSpeed]
 */
import { mkdirSync } from "node:fs";
import { TEMPLATES } from "../src/model/templates";
import type { Weather } from "../src/model/types";
import { runScene } from "../src/sim/scene";
import { writePng } from "./png";

const [tid = "corner", wdir = "225", wspd = "4"] = process.argv.slice(2);
const tpl = TEMPLATES.find((t) => t.id === tid) ?? TEMPLATES[0];
const plan = tpl.make();
const weather: Weather = { windFromDeg: Number(wdir), windSpeed: Number(wspd), exposure: "suburban" };

const t0 = performance.now();
const res = runScene(plan, weather, { targetCells: 45000, spinUp: 30, average: 20 });
const ms = performance.now() - t0;
const { grid } = res.raster;
console.log(
  `${tpl.name}: grid ${grid.nx}x${grid.ny} dx=${grid.dx} dt=${res.scales.dt.toExponential(2)}s steps=${res.steps} in ${ms.toFixed(0)}ms (${((grid.nx * grid.ny * res.steps) / ms / 1000).toFixed(1)} MLUPS)`,
);
const m = res.metrics;
console.log(
  `home: outdoor air ${m.home.outdoorAir.toFixed(0)} m3/h, volume ${m.home.volume.toFixed(0)} m3, ACH ${m.home.ach.toFixed(1)}, mean age ${(m.home.meanAge / 60).toFixed(1)} min`,
);
for (const r of m.rooms)
  console.log(
    `  ${r.name.padEnd(14)} ${r.area.toFixed(1).padStart(5)} m2  age ${(r.meanAge / 60).toFixed(2).padStart(6)} min  ACH ${r.ach.toFixed(1).padStart(6)}  v ${r.meanSpeed.toFixed(2)} m/s`,
  );
for (const o of m.openings)
  if (Math.abs(o.flow) > 1) console.log(`  opening ${o.id.padEnd(8)} ${o.flow.toFixed(0)} m3/h`);
for (const c of m.comfort)
  console.log(`  comfort ${c.id} ${c.speed.toFixed(2)} m/s → feels ${c.cooling.toFixed(1)}°C cooler`);

mkdirSync(".hoplite/artifacts", { recursive: true });
const S = 3;
const W = grid.nx * S;
const Hh = grid.ny * S;
function paint(name: string, color: (c: number) => [number, number, number]) {
  const img = new Uint8Array(W * Hh * 4);
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      const c = Math.floor(y / S) * grid.nx + Math.floor(x / S);
      const [r, g, b] = res.raster.solid[c] ? [20, 22, 26] : color(c);
      const o = (y * W + x) * 4;
      img[o] = r;
      img[o + 1] = g;
      img[o + 2] = b;
      img[o + 3] = 255;
    }
  writePng(`.hoplite/artifacts/debug-${tid}-${name}.png`, W, Hh, img);
}
const vel = res.scales.vel;
const ramp = (t: number): [number, number, number] => {
  const u = Math.max(0, Math.min(1, t));
  return [Math.round(245 - 200 * u), Math.round(240 - 150 * u), Math.round(228 - 30 * u)];
};
paint("speed", (c) => ramp((Math.hypot(res.meanUx[c], res.meanUy[c]) * vel) / 2));
paint("age", (c) => {
  if (res.raster.outdoor[c]) return [230, 236, 246];
  const minutes = (res.tau[c] * res.scales.dt) / 60;
  const t = Math.min(1, minutes / 15);
  return [Math.round(60 + 170 * t), Math.round(110 + 60 * t), Math.round(220 - 170 * t)];
});
console.log(`wrote .hoplite/artifacts/debug-${tid}-*.png`);
