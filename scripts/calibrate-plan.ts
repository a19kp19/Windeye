import type { Plan } from "../src/model/types";

/** A plain 10 × 8 m box with one window centred in the north and south walls. */
export function boxPlan(): Plan {
  const w = (id: string, ax: number, ay: number, bx: number, by: number) => ({
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 0.3,
    kind: "exterior" as const,
  });
  return {
    version: 1,
    name: "Box",
    ceiling: 2.6,
    northDeg: 0,
    walls: [w("n", 0, 0, 10, 0), w("e", 10, 0, 10, 8), w("s", 10, 8, 0, 8), w("w", 0, 8, 0, 0)],
    openings: [
      { id: "win-n", wallId: "n", kind: "window", offset: 5, width: 1.2, height: 1.4, state: "open" },
      { id: "win-s", wallId: "s", kind: "window", offset: 5, width: 1.2, height: 1.4, state: "open" },
    ],
    fans: [],
    furniture: [],
    labels: [{ id: "l", name: "Room", pos: { x: 5, y: 4 } }],
  };
}
