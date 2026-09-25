/**
 * Compare simulated cross-ventilation through a plain box with two opposite windows against the
 * empirical orifice model Q = Cd · A_eff · U · √ΔCp (Cd 0.61, ΔCp ≈ 0.9 for a low-rise block).
 *   pnpm exec tsx scripts/calibrate.ts
 */
import type { Plan, Weather } from "../src/model/types";
import { localWind, runScene } from "../src/sim/scene";

export function boxPlan(): Plan {
  const w = (id: string, ax: number, ay: number, bx: number, by: number) => ({
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 0.3,
    kind: "exterior" as const,
  });
  return {
    version: 1,
    name: "Box",
    ceiling: 2.6,
    northDeg: 0,
    walls: [w("n", 0, 0, 10, 0), w("e", 10, 0, 10, 8), w("s", 10, 8, 0, 8), w("w", 0, 8, 0, 0)],
    openings: [
      { id: "win-n", wallId: "n", kind: "window", offset: 5, width: 1.2, height: 1.4, state: "open" },
      { id: "win-s", wallId: "s", kind: "window", offset: 5, width: 1.2, height: 1.4, state: "open" },
    ],
    fans: [],
    furniture: [],
    labels: [{ id: "l", name: "Room", pos: { x: 5, y: 4 } }],
  };
}

const weather: Weather = { windFromDeg: 180, windSpeed: 4, exposure: "open" };
const plan = boxPlan();
const U = localWind(weather, 0).speed;
const A = 1.2 * 1.4;
const qEmp = 0.61 * (A / Math.SQRT2) * U * Math.sqrt(0.9) * 3600;
for (const cells of [30000, 45000]) {
  const res = runScene(plan, weather, { targetCells: cells, spinUp: 30, average: 20 });
  const inflow = res.metrics.openings.map((o) => `${o.id}=${o.flow.toFixed(0)}`).join(" ");
  console.log(
    `cells=${cells} dx=${res.raster.grid.dx} U=${U.toFixed(2)} m/s  sim: ${inflow} m3/h | home ${res.metrics.home.outdoorAir.toFixed(0)}  empirical ${qEmp.toFixed(0)}  ratio ${(res.metrics.home.outdoorAir / qEmp).toFixed(2)}`,
  );
}
