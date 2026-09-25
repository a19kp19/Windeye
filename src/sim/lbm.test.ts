import { describe, expect, it } from "vitest";
import type { Plan } from "../model/types";
import { FlowSolver } from "./lbm";
import { rasterize } from "./raster";

function sealedRoom(withFan: boolean): Plan {
  const w = (id: string, ax: number, ay: number, bx: number, by: number) => ({
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 0.3,
    kind: "exterior" as const,
  });
  return {
    version: 1,
    name: "Sealed",
    ceiling: 2.5,
    northDeg: 0,
    walls: [w("n", 0, 0, 5, 0), w("e", 5, 0, 5, 4), w("s", 5, 4, 0, 4), w("w", 0, 4, 0, 0)],
    openings: [],
    fans: withFan ? [{ id: "f", pos: { x: 1.5, y: 2 }, angle: 0, size: 0.6, speed: 3, on: true }] : [],
    furniture: [],
    labels: [],
  };
}

describe("FlowSolver", () => {
  it("conserves mass in a sealed room stirred by a fan, and stays finite", () => {
    const r = rasterize(sealedRoom(true), { targetCells: 6000 });
    const s = new FlowSolver(r.grid.nx, r.grid.ny);
    s.setGeometry(r, 0.03, false);
    const mass = () => {
      let m = 0;
      for (let c = 0; c < s.n; c++) if (!s.solid[c] && r.room[c] >= 0) m += s.rho[c];
      return m;
    };
    for (let k = 0; k < 50; k++) s.step();
    const m0 = mass();
    let maxU = 0;
    for (let k = 0; k < 1500; k++) s.step();
    for (let c = 0; c < s.n; c++) {
      expect(Number.isFinite(s.ux[c])).toBe(true);
      maxU = Math.max(maxU, Math.hypot(s.ux[c], s.uy[c]));
    }
    expect(Math.abs(mass() - m0) / m0).toBeLessThan(1e-3);
    // The fan actually moves air (target 3 m/s × 0.03 = 0.09 lattice).
    expect(maxU).toBeGreaterThan(0.03);
    expect(s.resets).toBe(0);
  });

  it("leaves still air still", () => {
    const r = rasterize(sealedRoom(false), { targetCells: 4000 });
    const s = new FlowSolver(r.grid.nx, r.grid.ny);
    s.setGeometry(r, 0.03, false);
    for (let k = 0; k < 300; k++) s.step();
    let maxU = 0;
    for (let c = 0; c < s.n; c++) maxU = Math.max(maxU, Math.hypot(s.ux[c], s.uy[c]));
    expect(maxU).toBeLessThan(1e-6);
  });
});
