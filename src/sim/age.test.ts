import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../model/templates";
import { AGE_CAP, solveAge } from "./age";
import { computeMetrics } from "./metrics";
import { rasterize } from "./raster";

describe("mean age of air", () => {
  it("grows linearly along a uniform channel flow (τ ≈ x / u)", () => {
    const nx = 60;
    const ny = 12;
    const n = nx * ny;
    const u = 0.05;
    const ux = new Float32Array(n).fill(u);
    const uy = new Float32Array(n);
    const nuT = new Float32Array(n);
    const solid = new Uint8Array(n);
    const outdoor = new Uint8Array(n);
    for (let i = 0; i < nx; i++) {
      solid[i] = 1;
      solid[(ny - 1) * nx + i] = 1;
    }
    for (let j = 0; j < ny; j++) {
      outdoor[j * nx] = 1; // inlet column is fresh air
      solid[j * nx + nx - 1] = 1;
    }
    const { tau } = solveAge(
      { nx, ny, ux, uy, nuT, solid, outdoor, minDiffusivity: 1e-4 },
      { maxSweeps: 400 },
    );
    const mid = Math.floor(ny / 2) * nx;
    for (const x of [10, 30, 50]) expect(tau[mid + x]).toBeGreaterThan(0.85 * (x / u));
    for (const x of [10, 30, 50]) expect(tau[mid + x]).toBeLessThan(1.15 * (x / u) + 30);
  });

  it("pins air with no path outdoors at the cap, and restarts it once it is opened up", () => {
    const nx = 30;
    const ny = 20;
    const n = nx * ny;
    const zeros = new Float32Array(n);
    const solid = new Uint8Array(n);
    const outdoor = new Uint8Array(n);
    for (let j = 0; j < ny; j++) outdoor[j * nx] = 1;
    // A sealed box: solid ring from (10,5) to (20,15).
    for (let i = 10; i <= 20; i++) solid[5 * nx + i] = solid[15 * nx + i] = 1;
    for (let j = 5; j <= 15; j++) solid[j * nx + 10] = solid[j * nx + 20] = 1;
    const inside = 10 * nx + 15;
    const input = { nx, ny, ux: zeros, uy: zeros, nuT: zeros, solid, outdoor };
    const sealed = solveAge(input, { maxSweeps: 50 });
    expect(sealed.tau[inside]).toBe(AGE_CAP);
    expect(sealed.tau[10 * nx + 5]).toBeLessThan(AGE_CAP);

    solid[10 * nx + 10] = 0; // open a gap in the ring
    const opened = solveAge(input, { maxSweeps: 50, init: sealed.tau });
    expect(opened.tau[inside]).toBeLessThan(AGE_CAP);
  });

  it("reports a room that outside air can't reach as stagnant, not as part of the home average", () => {
    const base = TEMPLATES.find((t) => t.id === "corner")!.make();
    // Bath window and door shut; the rest of the flat keeps its open windows.
    const plan = {
      ...base,
      openings: base.openings.map((o) =>
        o.id === "o-ba" || o.id === "d-ba" ? { ...o, state: "closed" as const } : o,
      ),
    };
    const r = rasterize(plan, { targetCells: 8000 });
    const n = r.grid.nx * r.grid.ny;
    const still = new Float32Array(n);
    const { tau } = solveAge(
      { nx: r.grid.nx, ny: r.grid.ny, ux: still, uy: still, nuT: still, solid: r.solid, outdoor: r.outdoor },
      { maxSweeps: 30 },
    );
    const m = computeMetrics(r, { ux: still, uy: still, tau, fresh: still }, 1, 0.01);
    const bath = m.rooms.find((x) => /bath/i.test(x.name))!;
    expect(bath.meanAge).toBe(Number.POSITIVE_INFINITY);
    expect(bath.ach).toBe(0);
    for (const room of m.rooms.filter((x) => x !== bath)) expect(Number.isFinite(room.meanAge)).toBe(true);
    expect(Number.isFinite(m.home.meanAge)).toBe(true);
    const total = m.rooms.reduce((s, x) => s + x.area, 0);
    expect(m.home.ventilatedShare).toBeCloseTo(1 - bath.area / total, 5);
  });
});
