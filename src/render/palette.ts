export const INK = "#1b1c1f";
export const PAPER = "#f2eee4";
export const GRAPHITE = "#6b6a66";
export const RULE = "#ddd6c7";
export const FRESH_RGB: readonly [number, number, number] = [34, 66, 205];
export const STALE_RGB: readonly [number, number, number] = [176, 104, 38];
export const FRESH = "#2242cd";
export const STALE = "#b06826";
export const ALERT = "#c23b22";

type RGBA = [number, number, number, number];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function mix(stops: ReadonlyArray<readonly [number, RGBA]>, x: number): RGBA {
  if (x <= stops[0][0]) return [...stops[0][1]] as RGBA;
  for (let i = 1; i < stops.length; i++) {
    const [x1, c1] = stops[i];
    if (x <= x1) {
      const [x0, c0] = stops[i - 1];
      const t = (x - x0) / (x1 - x0);
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t), lerp(c0[3], c1[3], t)];
    }
  }
  return [...stops[stops.length - 1][1]] as RGBA;
}

/** Share of outdoor air (0 = original indoor air, 1 = fresh). Pale watercolour tints on paper. */
const FRESH_STOPS: ReadonlyArray<readonly [number, RGBA]> = [
  [0, [236, 204, 158, 200]],
  [0.35, [240, 226, 204, 150]],
  [0.65, [214, 224, 246, 170]],
  [1, [170, 192, 246, 215]],
];
/** Mean age of air in minutes. */
const AGE_STOPS: ReadonlyArray<readonly [number, RGBA]> = [
  [0, [168, 190, 246, 215]],
  [2, [206, 219, 247, 180]],
  [5, [240, 234, 222, 120]],
  [10, [238, 205, 150, 190]],
  [20, [224, 160, 96, 215]],
  [40, [196, 116, 62, 230]],
];
/** Perceived cooling (°C) from air movement. */
const BREEZE_STOPS: ReadonlyArray<readonly [number, RGBA]> = [
  [0, [0, 0, 0, 0]],
  [0.3, [214, 230, 240, 90]],
  [1, [170, 208, 232, 170]],
  [2, [110, 170, 222, 205]],
  [3.2, [48, 110, 200, 225]],
];

export const freshColor = (t: number) => mix(FRESH_STOPS, t);
export const ageColor = (minutes: number) => mix(AGE_STOPS, Number.isFinite(minutes) ? minutes : 99);
export const breezeColor = (deg: number) => mix(BREEZE_STOPS, deg);

export function cssColor(c: RGBA, alphaScale = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${((c[3] / 255) * alphaScale).toFixed(3)})`;
}

/** Streak ink between fresh (blue) and stale (ochre). */
export function streakInk(fresh: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, fresh));
  return [
    lerp(STALE_RGB[0], FRESH_RGB[0], t),
    lerp(STALE_RGB[1], FRESH_RGB[1], t),
    lerp(STALE_RGB[2], FRESH_RGB[2], t),
  ];
}

export const LEGENDS = {
  fresh: FRESH_STOPS,
  age: AGE_STOPS,
  breeze: BREEZE_STOPS,
};
