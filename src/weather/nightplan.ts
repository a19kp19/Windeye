/**
 * When to open the windows: a lumped (single-node, ISO 13790 style) thermal model of the home,
 * ventilated at the simulated air-change rate whenever it's cooler outside than in.
 */
export type Mass = "light" | "medium" | "heavy";

/** Effective internal heat capacity per m² of floor (J/K·m²), ISO 13790 Table 12. */
export const MASS_CAPACITY: Record<Mass, number> = { light: 110e3, medium: 165e3, heavy: 260e3 };

export interface Hour {
  time: string;
  temp: number;
  windSpeed: number;
  windDir: number;
}

export interface PlannedHour extends Hour {
  indoor: number;
  indoorShut: number;
  open: boolean;
  ach: number;
}

export interface NightPlanOptions {
  indoorStart: number;
  floorArea: number;
  ceiling: number;
  mass: Mass;
  /** Don't keep cooling below this (°C). */
  floorTemp: number;
  /** Envelope conductance per m² floor (W/K·m²) — walls, roof, closed windows. */
  envelope?: number;
  /** Internal gains (W/m²): people, appliances, lights. */
  gains?: number;
}

export interface NightPlan {
  hours: PlannedHour[];
  windows: { from: number; to: number }[];
  /** Lowest indoor temperature reached with the plan vs. keeping everything shut. */
  minIndoor: number;
  minIndoorShut: number;
}

export function planNight(hours: Hour[], achFor: (h: Hour) => number, o: NightPlanOptions): NightPlan {
  const C = MASS_CAPACITY[o.mass] * o.floorArea;
  const V = o.floorArea * o.ceiling;
  const Henv = (o.envelope ?? 1.1) * o.floorArea;
  const gains = (o.gains ?? 4) * o.floorArea;
  const air = 1.2 * 1005; // ρ·c_p of air, J/(m³·K)
  let tIn = o.indoorStart;
  let tShut = o.indoorStart;
  let open = false;
  const out: PlannedHour[] = [];
  const SUB = 12;
  for (const h of hours) {
    // Hysteresis: open once outside is clearly cooler; close when it no longer helps.
    if (!open && h.temp < tIn - 0.8 && tIn > o.floorTemp + 0.3) open = true;
    else if (open && (h.temp > tIn - 0.2 || tIn <= o.floorTemp)) open = false;
    const ach = open ? achFor(h) : 0.35; // shut: infiltration only
    const Hve = (air * ach * V) / 3600;
    out.push({ ...h, indoor: tIn, indoorShut: tShut, open, ach });
    const dt = 3600 / SUB;
    for (let s = 0; s < SUB; s++) {
      tIn += (dt * ((Hve + Henv) * (h.temp - tIn) + gains)) / C;
      tShut += (dt * (((air * 0.35 * V) / 3600 + Henv) * (h.temp - tShut) + gains)) / C;
    }
  }
  const windows: { from: number; to: number }[] = [];
  out.forEach((h, i) => {
    if (!h.open) return;
    const last = windows[windows.length - 1];
    if (last && last.to === i - 1) last.to = i;
    else windows.push({ from: i, to: i });
  });
  return {
    hours: out,
    windows,
    minIndoor: Math.min(...out.map((h) => h.indoor)),
    minIndoorShut: Math.min(...out.map((h) => h.indoorShut)),
  };
}
