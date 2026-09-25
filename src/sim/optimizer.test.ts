import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../model/templates";
import type { Metrics } from "./metrics";
import { configure, describe as describeCandidate, type OpeningFacts, score, windowSets } from "./optimizer";
import { rasterize } from "./raster";

function setup() {
  const plan = TEMPLATES.find((t) => t.id === "corner")!.make();
  const r = rasterize(plan, { targetCells: 15000 });
  const facts = new Map<string, OpeningFacts>(
    r.openings.map((o) => [
      o.id,
      {
        id: o.id,
        exterior: o.exterior,
        nx: o.normal.x,
        ny: o.normal.y,
        roomName: r.rooms[o.roomIn]?.name ?? "Room",
      },
    ]),
  );
  return { plan, facts };
}

describe("setup finder", () => {
  it("tries all-open first, then pairs across opposite façades before same-side pairs", () => {
    const { plan, facts } = setup();
    const sets = windowSets(plan, facts);
    expect(sets[0].length).toBeGreaterThan(2);
    const facing = (id: string) => Math.atan2(-facts.get(id)!.ny, -facts.get(id)!.nx);
    const gap = (s: string[]) =>
      Math.abs(Math.atan2(Math.sin(facing(s[0]) - facing(s[1])), Math.cos(facing(s[0]) - facing(s[1]))));
    expect(gap(sets[1])).toBeGreaterThan(3); // ~180°
    expect(sets.length).toBeLessThanOrEqual(16);
  });

  it("configures exactly the chosen windows, opens interior doors and places the finder's fan", () => {
    const { plan, facts } = setup();
    const p = configure(plan, facts, new Set(["o-k1", "o-s1"]), { openingId: "o-k1", out: true });
    const state = (id: string) => p.openings.find((o) => o.id === id)!.state;
    expect(state("o-k1")).toBe("open");
    expect(state("o-l1")).toBe("closed");
    expect(state("d-hb")).toBe("open");
    const fan = p.fans.find((f) => f.id === "finder-fan")!;
    expect(fan.on).toBe(true);
    // Blowing out through a north window means pointing plan-up.
    expect(Math.sin(fan.angle)).toBeLessThan(-0.9);
    expect(p.fans.filter((f) => f.id !== "finder-fan").every((f) => !f.on)).toBe(true);
  });

  it("describes candidates in plain words", () => {
    const { plan, facts } = setup();
    const all = windowSets(plan, facts)[0];
    const d = describeCandidate({ id: "x", open: all, fan: null, plan }, plan, facts);
    expect(d.open).toBe("every window");
    const two = describeCandidate({ id: "y", open: ["o-l1", "o-l2"], fan: null, plan }, plan, facts);
    expect(two.open).toBe("Living room N windows ×2");
  });

  it("prefers a slightly weaker two-window setup over opening everything", () => {
    const m = (meanAge: number) => ({ home: { meanAge } }) as unknown as Metrics;
    const eight = { id: "a", open: ["1", "2", "3", "4", "5", "6", "7", "8"], fan: null, plan: {} as never };
    const two = { id: "b", open: ["1", "2"], fan: null, plan: {} as never };
    expect(score({ kind: "flush" }, m(100), two, {})).toBeGreaterThan(
      score({ kind: "flush" }, m(80), eight, {}),
    );
  });
});
