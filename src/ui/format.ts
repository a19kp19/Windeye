/** "45 s", "3.2 min", "1 h 10 min", "∞". */
export function formatAge(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds > 6 * 3600) return "stagnant";
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  const m = seconds / 60;
  if (m < 10) return `${m.toFixed(1)} min`;
  if (m < 90) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${Math.round(m - h * 60)} min`;
}

export function formatFlow(m3h: number): string {
  const a = Math.abs(m3h);
  return a >= 1000 ? `${(a / 1000).toFixed(1)}k m³/h` : `${Math.round(a)} m³/h`;
}

const COMPASS = [
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
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Beaufort description for a 10 m wind speed (m/s). */
export function beaufort(ms: number): { force: number; name: string } {
  const limits = [0.5, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  const names = [
    "Calm",
    "Light air",
    "Light breeze",
    "Gentle breeze",
    "Moderate breeze",
    "Fresh breeze",
    "Strong breeze",
    "Near gale",
    "Gale",
    "Strong gale",
    "Storm",
    "Violent storm",
    "Hurricane",
  ];
  const force = limits.findIndex((l) => ms < l);
  const f = force < 0 ? 12 : force;
  return { force: f, name: names[f] };
}
