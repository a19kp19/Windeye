import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchForecast } from "./openmeteo";

const reply = (temps: (number | null)[]) => ({
  utc_offset_seconds: 7200,
  timezone: "Europe/Madrid",
  hourly: {
    time: temps.map((_, i) => `2026-09-25T${String(i).padStart(2, "0")}:00`),
    temperature_2m: temps,
    wind_speed_10m: temps.map(() => 2),
    wind_direction_10m: temps.map(() => 210),
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("forecast parsing", () => {
  it("stops at the first hour the API has no data for", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(reply([21.5, 20.9, null, 19]))));
    const f = await fetchForecast(37.39, -5.98);
    expect(f.times).toEqual(["2026-09-25T00:00", "2026-09-25T01:00"]);
    expect(f.temp).toEqual([21.5, 20.9]);
    expect(f.windDir).toHaveLength(2);
  });

  it("reports a place with no data rather than returning an empty forecast", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(reply([null, null]))));
    await expect(fetchForecast(0, 0)).rejects.toThrow(/no forecast data/);
  });
});
