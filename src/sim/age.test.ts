import { describe, expect, it } from "vitest";
import { solveAge } from "./age";

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
});
