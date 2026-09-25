import { describe, expect, it } from "vitest";
import { blankPlan, TEMPLATES } from "../model/templates";
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
    ];
    for (const plan of broken) expect(parseSaved({ plan, weather, templateId: null })).toBeNull();
    expect(parseSaved({ plan: good, weather: { ...weather, exposure: "windy" } })).toBeNull();
    // …including through the real link decoder.
    const code = await encodeShare({ plan: broken[1], weather, templateId: null } as unknown as Saved);
    expect(await decodeShare(code)).toBeNull();
  });
});
