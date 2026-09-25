import { describe, expect, it } from "vitest";
import { addFan, addFurniture, addLabel, addOpening, addWall, moveVertex, updateWall } from "../model/ops";
import { blankPlan, FURNITURE_DEFAULTS, TEMPLATES } from "../model/templates";
import type { FurnitureKind } from "../model/types";
import { decodeShare, encodeShare, parseSaved, type Saved } from "./persist";

const weather = { windFromDeg: 10, windSpeed: 3, exposure: "open" } as const;

describe("share links", () => {
  it("round-trips a plan through a compact URL-safe code", async () => {
    const plan = TEMPLATES[0].make();
    const code = await encodeShare({
      plan,
      weather: { windFromDeg: 10, windSpeed: 3, exposure: "open" },
      templateId: "corner",
    });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(JSON.stringify(plan).length);
    const back = await decodeShare(code);
    expect(back?.plan).toEqual(plan);
    expect(back?.weather.windFromDeg).toBe(10);
  });

  it("rejects garbage", async () => {
    expect(await decodeShare("not-a-real-code")).toBeNull();
  });

  it("accepts every template and the blank sheet", () => {
    for (const plan of [...TEMPLATES.map((t) => t.make()), blankPlan()]) {
      expect(parseSaved(JSON.parse(JSON.stringify({ plan, weather, templateId: null })))?.plan).toEqual(plan);
    }
  });

  it("accepts everything the editor can make, so an autosave is never dropped", () => {
    let p = blankPlan();
    const wallIds = (["exterior", "interior", "party"] as const).map((kind, i) => {
      const r = addWall(p, { x: 0, y: i * 3 }, { x: 6, y: i * 3 }, kind);
      p = r.plan;
      return r.id;
    });
    for (const [kind, at] of [
      ["window", 1.5],
      ["door", 4.5],
    ] as const) {
      const r = addOpening(p, p.walls.find((w) => w.id === wallIds[0])!, kind, at);
      expect(r).not.toBeNull();
      p = r!.plan;
    }
    p = addFan(p, { x: 3, y: 1 }, 0.5).plan;
    for (const kind of Object.keys(FURNITURE_DEFAULTS) as FurnitureKind[]) {
      p = addFurniture(p, kind, { x: 2, y: 4 }).plan;
    }
    p = addLabel(p, { x: 1, y: 1 }, "Room").plan;
    p = moveVertex(p, { x: 6, y: 0 }, { x: 7.5, y: 0.5 });
    p = updateWall(p, wallIds[1], { thickness: 0.05 });
    expect(p.openings).toHaveLength(2);
    expect(parseSaved(JSON.parse(JSON.stringify({ plan: p, weather, templateId: "blank" })))?.plan).toEqual(
      p,
    );
  });

  it("rejects well-formed links whose plan would break the app", async () => {
    const good = TEMPLATES[0].make();
    const broken: unknown[] = [
      { ...good, openings: undefined },
      { version: 1, name: "x", walls: [] },
      { ...good, walls: [{ ...good.walls[0], a: { x: null, y: 0 } }, ...good.walls.slice(1)] },
      { ...good, openings: [{ ...good.openings[0], wallId: "nope" }] },
      { ...good, openings: [{ ...good.openings[0], width: -1 }] },
      { ...good, furniture: [{ ...good.furniture[0], kind: "piano" }] },
      { ...good, furniture: [{ ...good.furniture[0], kind: "constructor" }] },
      { ...good, walls: Array.from({ length: 2001 }, () => good.walls[0]) },
      // …or hang it: at 1e300 the canvas grid loop's `x += step` never advances.
      { ...good, walls: [{ ...good.walls[0], b: { x: 1e300, y: 0 } }, ...good.walls.slice(1)] },
      { ...good, walls: [{ ...good.walls[0], thickness: 1e6 }, ...good.walls.slice(1)] },
      { ...good, fans: [{ ...good.fans[0], speed: 1e6 }] },
    ];
    for (const plan of broken) expect(parseSaved({ plan, weather, templateId: null })).toBeNull();
    // …including through the real link decoder.
    const code = await encodeShare({ plan: broken[1], weather, templateId: null } as unknown as Saved);
    expect(await decodeShare(code)).toBeNull();
  });

  it("keeps the plan when only the weather is off: clamps the speed, drops unknown values", () => {
    const good = TEMPLATES[0].make();
    const s = parseSaved({ plan: good, weather: { windFromDeg: 10, windSpeed: 1e300, exposure: "windy" } });
    expect(s?.plan).toEqual(good);
    expect(s?.weather).toEqual({ windFromDeg: 10, windSpeed: 60 });
    expect(parseSaved({ plan: good })?.weather).toEqual({});
  });

  it("refuses to inflate an oversized link", async () => {
    const plan = { ...TEMPLATES[0].make(), name: "a".repeat(5_000_000) };
    const code = await encodeShare({ plan, weather, templateId: null });
    expect(code.length).toBeLessThan(50_000); // deflate squeezes it into a short link…
    expect(await decodeShare(code)).toBeNull(); // …that must not expand to megabytes
  });
});
