import { describe, expect, it } from "vitest";
import { boxPlan } from "../../scripts/calibrate-plan";
import type { Weather } from "../model/types";
import { facadeCp, localWind, runScene } from "./scene";

describe("façade pressure coefficients (Swami & Chandra)", () => {
  it("is +0.6 head-on, negative on the lee and side walls", () => {
    expect(facadeCp(0)).toBeCloseTo(0.6, 2);
    expect(facadeCp(Math.PI)).toBeLessThan(-0.25);
    expect(facadeCp(Math.PI)).toBeGreaterThan(-0.5);
    expect(facadeCp(Math.PI / 2)).toBeLessThan(0);
  });
});

describe("cross-ventilation calibration", () => {
  it("matches the empirical orifice model for a box with opposite windows (±40%)", () => {
    const weather: Weather = { windFromDeg: 180, windSpeed: 4, exposure: "open" };
    const res = runScene(boxPlan(), weather, { targetCells: 12000, spinUp: 20, average: 15 });
    const U = localWind(weather, 0).speed;
    const A = 1.2 * 1.4;
    const empirical = 0.61 * (A / Math.SQRT2) * U * Math.sqrt(0.9) * 3600; // m³/h
    const inflow = res.metrics.openings.find((o) => o.id === "win-s")!.flow;
    const outflow = res.metrics.openings.find((o) => o.id === "win-n")!.flow;
    // Windward window takes air in, leeward lets it out.
    expect(inflow).toBeGreaterThan(0);
    expect(outflow).toBeLessThan(0);
    const ratio = res.metrics.home.outdoorAir / empirical;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.4);
  }, 60_000);
});
