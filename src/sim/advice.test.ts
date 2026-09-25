import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../model/templates";
import { advise } from "./advice";
import type { Metrics } from "./metrics";
import type { RasterSummary } from "./protocol";
import { rasterize } from "./raster";

function summary(plan = TEMPLATES[0].make()) {
  const r = rasterize(plan, { targetCells: 12000 });
  const s = {
    rooms: r.rooms,
    openings: r.openings.map((o) => ({
      id: o.id,
      nx: o.normal.x,
      ny: o.normal.y,
      exterior: o.exterior,
      roomIn: o.roomIn,
      roomOut: o.roomOut,
    })),
  } as unknown as RasterSummary;
  return { plan, s, r };
}

const metrics = (over: Partial<Metrics["home"]> = {}, rooms: Metrics["rooms"] = []): Metrics => ({
  rooms,
  openings: [],
  comfort: [],
  home: { outdoorAir: 100, volume: 200, ach: 3, meanAge: 600, ventilatedShare: 1, flushMinutes: 30, ...over },
});

describe("advice", () => {
  it("warns when every window is shut", () => {
    const { plan, s } = summary();
    const shut = { ...plan, openings: plan.openings.map((o) => ({ ...o, state: "closed" as const })) };
    const a = advise(shut, metrics(), s);
    expect(a[0].tone).toBe("warn");
  });

  it("points at the stalest room and the window that would fix it", () => {
    const { plan, s, r } = summary();
    const kitchen = r.rooms.find((x) => x.name === "Kitchen")!;
    const rooms = r.rooms.map((x) => ({
      index: x.index,
      name: x.name,
      area: x.area,
      meanAge: x.index === kitchen.index ? 1800 : 200,
      ach: 10,
      fresh: 0.5,
      meanSpeed: 0.1,
    }));
    const a = advise(plan, metrics({ meanAge: 300 }, rooms), s);
    expect(a.some((x) => x.text.startsWith("Kitchen") && /window/.test(x.text))).toBe(true);
  });

  it("says plainly when no outside air reaches a closed-off room", () => {
    const { plan, s, r } = summary();
    const bathIndex = r.rooms.find((x) => /bath/i.test(x.name))!.index;
    const rooms = r.rooms.map((x) => ({
      index: x.index,
      name: x.name,
      area: x.area,
      meanAge: x.index === bathIndex ? Number.POSITIVE_INFINITY : 200,
      ach: x.index === bathIndex ? 0 : 18,
      fresh: 0.5,
      meanSpeed: 0.1,
    }));
    // Bath window shut as well as its door.
    const closed = {
      ...plan,
      openings: plan.openings.map((o) =>
        o.id === "o-ba" || o.id === "d-ba" ? { ...o, state: "closed" as const } : o,
      ),
    };
    const tip = advise(closed, metrics({ meanAge: 200 }, rooms), s).find((x) => x.text.startsWith("Bath"));
    expect(tip?.text).toBe("Bath: no outside air reaches it. Open its window to give it its own supply.");
  });
});
