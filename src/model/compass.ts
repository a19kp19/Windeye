const POINTS_16 = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
const POINTS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Compass point for a bearing in degrees (16-point by default, 8-point when `coarse`). */
export function compassName(deg: number, coarse = false): string {
  const d = ((deg % 360) + 360) % 360;
  return coarse ? POINTS_8[Math.round(d / 45) % 8] : POINTS_16[Math.round(d / 22.5) % 16];
}
