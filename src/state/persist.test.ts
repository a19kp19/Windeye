import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../model/templates";
import { decodeShare, encodeShare } from "./persist";

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
});
