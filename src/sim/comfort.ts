/**
 * Cooling effect of moving air on a person, in °C of "feels cooler than still air".
 *
 * Interpolated from the ASHRAE 55 elevated-air-speed cooling effect (SET-based) for a lightly
 * dressed (≈0.5 clo), sedentary (≈1.1 met) person in warm conditions (~27 °C, 50 % RH). Values
 * below 0.1 m/s count as still air; the curve flattens above ~1.5 m/s as the benefit saturates.
 */
const TABLE: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0],
  [0.2, 0.45],
  [0.3, 0.95],
  [0.4, 1.35],
  [0.5, 1.7],
  [0.6, 2.0],
  [0.8, 2.5],
  [1.0, 2.9],
  [1.2, 3.2],
  [1.5, 3.6],
  [2.0, 4.1],
  [3.0, 4.7],
];

export function coolingEffect(speed: number): number {
  if (!(speed > TABLE[0][0])) return 0;
  for (let i = 1; i < TABLE.length; i++) {
    const [v1, c1] = TABLE[i];
    if (speed <= v1) {
      const [v0, c0] = TABLE[i - 1];
      return c0 + ((c1 - c0) * (speed - v0)) / (v1 - v0);
    }
  }
  return TABLE[TABLE.length - 1][1];
}

/** Words for a breeze, Beaufort-style but indoors. */
export function breezeWord(speed: number): string {
  if (speed < 0.1) return "still";
  if (speed < 0.25) return "barely felt";
  if (speed < 0.5) return "gentle";
  if (speed < 0.9) return "pleasant";
  if (speed < 1.5) return "breezy";
  return "papers fly";
}
