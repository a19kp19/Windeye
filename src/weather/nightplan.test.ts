import { describe, expect, it } from "vitest";
import { type Hour, planNight } from "./nightplan";
import { currentHourIndex, type Forecast } from "./openmeteo";

const hours = (temps: number[]): Hour[] =>
  temps.map((temp, i) => ({
    time: `2026-07-01T${String(i % 24).padStart(2, "0")}:00`,
    temp,
    windSpeed: 3,
    windDir: 225,
  }));

describe("night plan", () => {
  it("opens when it is cooler outside and cools the home faster than keeping it shut", () => {
    const plan = planNight(hours([30, 28, 25, 22, 20, 19, 18, 18, 19, 21, 24, 27]), () => 12, {
      indoorStart: 28,
      floorArea: 60,
      ceiling: 2.6,
      mass: "medium",
      floorTemp: 20,
    });
    expect(plan.windows.length).toBeGreaterThan(0);
    const first = plan.windows[0];
    expect(plan.hours[first.from].temp).toBeLessThan(plan.hours[first.from].indoor);
    expect(plan.minIndoor).toBeLessThan(plan.minIndoorShut - 1);
    expect(plan.minIndoor).toBeGreaterThan(19);
  });

  it("never opens on a night that stays hotter than indoors", () => {
    const plan = planNight(hours([31, 31, 30, 30, 30, 30]), () => 12, {
      indoorStart: 26,
      floorArea: 50,
      ceiling: 2.5,
      mass: "heavy",
      floorTemp: 20,
    });
    expect(plan.windows).toEqual([]);
  });

  it("stays physical at any ventilation rate", () => {
    // A small, light home with a huge draught: explicit time steps used to reach 180,000 °C here.
    for (const ach of [12, 800, 1500, 5000]) {
      const plan = planNight(hours([30, 26, 22, 19, 18, 18, 20, 24]), () => ach, {
        indoorStart: 28,
        floorArea: 12,
        ceiling: 2.6,
        mass: "light",
        floorTemp: 20,
      });
      for (const h of plan.hours) {
        expect(h.indoor).toBeGreaterThan(17.5);
        expect(h.indoor).toBeLessThan(30.5);
      }
    }
  });
});

describe("forecast hour alignment", () => {
  it("finds the local hour using the location's UTC offset", () => {
    const f: Forecast = {
      times: ["2026-09-25T20:00", "2026-09-25T21:00", "2026-09-25T22:00"],
      temp: [1, 2, 3],
      windSpeed: [1, 1, 1],
      windDir: [0, 0, 0],
      utcOffsetSeconds: 2 * 3600,
      timezone: "Europe/Berlin",
    };
    // 19:30 UTC is 21:30 in UTC+2.
    expect(currentHourIndex(f, Date.UTC(2026, 8, 25, 19, 30))).toBe(1);
  });
});
