import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../model/templates";
import type { Plan } from "../model/types";
import { cellAt, rasterize, TILT_FACTOR } from "./raster";

const corner = (): Plan => TEMPLATES.find((t) => t.id === "corner")!.make();

describe("rasterize", () => {
  it("finds and names every room of the corner flat", () => {
    const r = rasterize(corner(), { targetCells: 20000 });
    const names = r.rooms
      .filter((x) => x.area > 2)
      .map((x) => x.name)
      .sort();
    expect(names).toEqual(["Bath", "Hall", "Kitchen", "Living room", "Main bedroom", "Small bedroom"]);
    const living = r.rooms.find((x) => x.name === "Living room")!;
    // 6.6 m × 4.8 m minus walls ≈ 29 m²
    expect(living.area).toBeGreaterThan(26);
    expect(living.area).toBeLessThan(32);
  });

  it("tells exterior openings from interior ones and orients normals inward", () => {
    const plan = corner();
    const r = rasterize(plan, { targetCells: 20000 });
    const byId = new Map(r.openings.map((o) => [o.id, o]));
    expect(byId.get("o-l1")!.exterior).toBe(true);
    expect(byId.get("d-lh")!.exterior).toBe(false);
    // North façade window: inward normal points down the plan (+y).
    expect(byId.get("o-l1")!.normal.y).toBeGreaterThan(0.9);
    // Entry door is on the party wall: never carved.
    expect(byId.get("d-entry")!.cells.length).toBe(0);
  });

  it("only carves open windows, and tilted ones much narrower", () => {
    const plan = corner();
    const r = rasterize(plan, { targetCells: 20000 });
    const cells = (id: string) => r.openings.find((o) => o.id === id)!;
    expect(cells("o-k2").cells.length).toBe(0); // closed
    const open = cells("o-l1");
    const tilted = cells("o-l2");
    expect(open.cells.length).toBeGreaterThan(0);
    expect(tilted.effWidth).toBeCloseTo(open.effWidth * TILT_FACTOR, 5);
  });

  it("fills the neighbour side of a party wall with solid mass", () => {
    const r = rasterize(corner(), { targetCells: 20000 });
    const west = cellAt(r.grid, { x: -0.8, y: 4.5 });
    const north = cellAt(r.grid, { x: 3, y: -0.8 });
    expect(r.solid[west]).toBe(1);
    expect(r.outdoor[north]).toBe(1);
  });

  it("assigns every outdoor cell a pressure zone when windows are open", () => {
    const r = rasterize(corner(), { targetCells: 20000 });
    expect(r.zoneCount).toBeGreaterThan(3);
    let unzoned = 0;
    for (let c = 0; c < r.outdoor.length; c++) if (r.outdoor[c] && !r.solid[c] && r.zone[c] < 0) unzoned++;
    expect(unzoned).toBe(0);
  });
});
