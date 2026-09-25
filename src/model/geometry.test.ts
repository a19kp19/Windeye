import { describe, expect, it } from "vitest";
import { bearingToPlan, clampOffset, inRect, planToBearing, projectOnSegment, rectCorners } from "./geometry";

describe("compass <-> plan directions", () => {
  it("maps north/east to plan up/right when north is up", () => {
    const n = bearingToPlan(0, 0);
    const e = bearingToPlan(90, 0);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(-1);
    expect(e.x).toBeCloseTo(1);
    expect(e.y).toBeCloseTo(0);
  });

  it("round-trips bearings for any plan rotation", () => {
    for (const north of [0, 37, 90, 200, 355]) {
      for (const b of [0, 45, 133, 270, 359]) {
        expect(planToBearing(bearingToPlan(b, north), north)).toBeCloseTo(b, 6);
      }
    }
  });
});

describe("segments and rectangles", () => {
  it("projects and clamps onto a segment", () => {
    const h = projectOnSegment({ x: 5, y: 2 }, { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(h.t).toBeCloseTo(0.5);
    expect(h.distance).toBeCloseTo(2);
    expect(projectOnSegment({ x: -3, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).t).toBe(0);
  });

  it("keeps openings on their wall", () => {
    const w = { id: "w", a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.2, kind: "exterior" as const };
    expect(clampOffset(w, 1, -5)).toBeCloseTo(0.55);
    expect(clampOffset(w, 1, 99)).toBeCloseTo(3.45);
  });

  it("agrees between rectCorners and inRect under rotation", () => {
    const c = { x: 2, y: 1 };
    const corners = rectCorners(c, 2, 1, Math.PI / 6);
    const mid = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
    expect(mid.x).toBeCloseTo(c.x);
    expect(inRect(c, c, 2, 1, Math.PI / 6)).toBe(true);
    expect(inRect({ x: c.x + 1.2, y: c.y }, c, 2, 1, 0)).toBe(false);
  });
});
