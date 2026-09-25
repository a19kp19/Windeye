import type { Fan, Furniture, FurnitureKind, Opening, Plan, RoomLabel, Wall, WallKind } from "./types";

const T = { exterior: 0.3, party: 0.25, interior: 0.12 } as const;

function wall(id: string, ax: number, ay: number, bx: number, by: number, kind: WallKind): Wall {
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: T[kind], kind };
}

function win(
  id: string,
  wallId: string,
  offset: number,
  width: number,
  height: number,
  state: Opening["state"],
): Opening {
  return { id, wallId, kind: "window", offset, width, height, state };
}

function door(
  id: string,
  wallId: string,
  offset: number,
  width: number,
  state: Opening["state"],
  extra: Partial<Opening> = {},
): Opening {
  return { id, wallId, kind: "door", offset, width, height: 2.05, state, hinge: "a", swing: 1, ...extra };
}

export const FURNITURE_DEFAULTS: Record<
  FurnitureKind,
  { w: number; d: number; height: number; label: string }
> = {
  wardrobe: { w: 2.0, d: 0.6, height: 2.2, label: "Wardrobe" },
  bookcase: { w: 1.8, d: 0.35, height: 2.0, label: "Bookcase" },
  fridge: { w: 0.7, d: 0.7, height: 1.85, label: "Fridge" },
  bed: { w: 1.6, d: 2.0, height: 0.55, label: "Bed" },
  sofa: { w: 2.1, d: 0.9, height: 0.85, label: "Sofa" },
  table: { w: 1.4, d: 0.85, height: 0.75, label: "Table" },
  counter: { w: 2.4, d: 0.6, height: 0.9, label: "Counter" },
  desk: { w: 1.2, d: 0.6, height: 0.75, label: "Desk" },
  stairs: { w: 3.0, d: 0.9, height: 2.4, label: "Stairs" },
};

function furn(
  id: string,
  kind: FurnitureKind,
  x: number,
  y: number,
  w: number,
  d: number,
  angle = 0,
  height?: number,
): Furniture {
  return { id, kind, pos: { x, y }, w, d, angle, height: height ?? FURNITURE_DEFAULTS[kind].height };
}

const label = (id: string, name: string, x: number, y: number): RoomLabel => ({ id, name, pos: { x, y } });

const fan = (id: string, x: number, y: number, angle: number, on = false): Fan => ({
  id,
  pos: { x, y },
  angle,
  size: 0.5,
  speed: 3.2,
  on,
});

const H = Math.PI / 2;

/** A corner flat: street façade (north), side façade (east), courtyard (south); neighbour to the west. */
function cornerFlat(): Plan {
  return {
    version: 1,
    name: "Corner flat",
    ceiling: 2.6,
    northDeg: 0,
    walls: [
      wall("w-n", 0, 0, 12, 0, "exterior"),
      wall("w-e", 12, 0, 12, 9, "exterior"),
      wall("w-s", 12, 9, 0, 9, "exterior"),
      wall("w-w", 0, 9, 0, 0, "party"),
      wall("w-lh", 0, 4.8, 6.6, 4.8, "interior"),
      wall("w-core", 6.6, 0, 6.6, 9, "interior"),
      wall("w-kb", 6.6, 3.4, 12, 3.4, "interior"),
      wall("w-hb", 0, 6.2, 6.6, 6.2, "interior"),
      wall("w-bb", 3.8, 6.2, 3.8, 9, "interior"),
    ],
    openings: [
      win("o-l1", "w-n", 2.0, 1.4, 1.5, "open"),
      win("o-l2", "w-n", 4.8, 1.4, 1.5, "tilted"),
      win("o-k1", "w-n", 9.3, 1.2, 1.2, "open"),
      win("o-k2", "w-e", 1.7, 1.0, 1.2, "closed"),
      win("o-b1", "w-e", 6.2, 1.4, 1.5, "open"),
      win("o-b2", "w-s", 2.7, 1.2, 1.4, "closed"),
      win("o-s1", "w-s", 9.4, 1.2, 1.4, "open"),
      win("o-ba", "w-s", 6.8, 0.6, 0.6, "tilted"),
      door("d-entry", "w-w", 3.5, 0.95, "closed"),
      door("d-lh", "w-lh", 3.3, 1.2, "open", { passage: true }),
      door("d-lk", "w-core", 1.7, 1.2, "open", { passage: true }),
      door("d-hb", "w-core", 5.5, 0.9, "open", { hinge: "b", swing: 1 }),
      door("d-sb", "w-hb", 1.9, 0.85, "open", { hinge: "a", swing: -1 }),
      door("d-ba", "w-hb", 5.2, 0.75, "open", { hinge: "b", swing: -1 }),
    ],
    fans: [fan("f-1", 5.7, 5.5, 0, false)],
    furniture: [
      furn("fu-sofa", "sofa", 3.2, 3.75, 2.2, 0.9),
      furn("fu-book", "bookcase", 0.3, 2.4, 2.0, 0.35, H),
      furn("fu-table", "table", 5.1, 2.0, 1.4, 0.8),
      furn("fu-counter", "counter", 9.28, 0.45, 5.1, 0.6),
      furn("fu-fridge", "fridge", 11.45, 2.95, 0.7, 0.7),
      furn("fu-bed1", "bed", 9.4, 4.46, 1.6, 2.0),
      furn("fu-ward", "wardrobe", 6.96, 7.7, 2.2, 0.6, H),
      furn("fu-bed2", "bed", 0.83, 7.5, 1.4, 2.0, 0, 0.5),
      furn("fu-desk", "desk", 2.95, 8.5, 1.2, 0.6),
    ],
    labels: [
      label("r-liv", "Living room", 1.9, 1.3),
      label("r-kit", "Kitchen", 8.2, 1.9),
      label("r-bed", "Main bedroom", 10.3, 7.4),
      label("r-hall", "Hall", 4.9, 5.5),
      label("r-sb", "Small bedroom", 2.3, 7.2),
      label("r-bath", "Bath", 5.2, 7.7),
    ],
  };
}

/** Windows on one side only — the classic hard case for airing out. */
function singleAspectStudio(): Plan {
  return {
    version: 1,
    name: "Single-aspect studio",
    ceiling: 2.5,
    northDeg: 180,
    walls: [
      wall("w-n", 0, 0, 8, 0, "exterior"),
      wall("w-e", 8, 0, 8, 5.5, "party"),
      wall("w-s", 8, 5.5, 0, 5.5, "party"),
      wall("w-w", 0, 5.5, 0, 0, "party"),
      wall("w-bt", 0, 3.6, 2.6, 3.6, "interior"),
      wall("w-br", 2.6, 3.6, 2.6, 5.5, "interior"),
    ],
    openings: [
      win("o-1", "w-n", 1.6, 1.2, 1.4, "open"),
      win("o-2", "w-n", 4.0, 1.2, 1.4, "tilted"),
      win("o-3", "w-n", 6.4, 1.2, 1.4, "open"),
      door("d-entry", "w-s", 2.05, 0.95, "closed"),
      door("d-bath", "w-br", 0.9, 0.75, "open", { hinge: "a", swing: 1 }),
    ],
    fans: [fan("f-1", 6.4, 0.2, -H, false)],
    furniture: [
      furn("fu-bed", "bed", 7.17, 2.2, 1.4, 2.0),
      furn("fu-sofa", "sofa", 3.9, 2.4, 1.8, 0.85),
      furn("fu-counter", "counter", 4.1, 5.075, 2.4, 0.6),
      furn("fu-ward", "wardrobe", 7.2, 5.075, 1.2, 0.6),
    ],
    labels: [label("r-studio", "Studio", 4.6, 1.2), label("r-bath", "Bath", 1.3, 4.6)],
  };
}

/** New York style railroad flat: rooms in a row, windows only at the two ends. */
function railroadFlat(): Plan {
  return {
    version: 1,
    name: "Railroad flat",
    ceiling: 2.9,
    northDeg: 90,
    walls: [
      wall("w-n", 0, 0, 4.2, 0, "exterior"),
      wall("w-e", 4.2, 0, 4.2, 17, "party"),
      wall("w-s", 4.2, 17, 0, 17, "exterior"),
      wall("w-w", 0, 17, 0, 0, "party"),
      wall("w-p1", 0, 4.5, 4.2, 4.5, "interior"),
      wall("w-p2", 0, 8.5, 4.2, 8.5, "interior"),
      wall("w-p3", 0, 12, 4.2, 12, "interior"),
      wall("w-bath1", 1.8, 8.5, 1.8, 10.4, "interior"),
      wall("w-bath2", 0, 10.4, 1.8, 10.4, "interior"),
    ],
    openings: [
      win("o-f1", "w-n", 1.1, 1.0, 1.7, "open"),
      win("o-f2", "w-n", 3.1, 1.0, 1.7, "open"),
      win("o-r1", "w-s", 2.8, 1.0, 1.6, "open"),
      door("d-back", "w-s", 1.0, 0.9, "closed"),
      door("d-1", "w-p1", 3.4, 0.85, "open"),
      door("d-2", "w-p2", 3.4, 0.85, "open"),
      door("d-3", "w-p3", 3.4, 0.85, "open"),
      door("d-bath", "w-bath1", 1.2, 0.7, "closed", { hinge: "b", swing: -1 }),
    ],
    fans: [fan("f-1", 2.8, 16.7, -H, false)],
    furniture: [
      furn("fu-sofa", "sofa", 1.2, 3.4, 2.0, 0.9, H),
      furn("fu-book", "bookcase", 3.95, 2.2, 1.6, 0.35, H),
      furn("fu-bed", "bed", 1.2, 6.5, 1.5, 2.0),
      furn("fu-ward", "wardrobe", 3.9, 5.5, 1.6, 0.55, H),
      furn("fu-desk", "desk", 3.7, 10.8, 1.2, 0.6, H),
      furn("fu-table", "table", 1.6, 14.2, 1.2, 0.8),
      furn("fu-counter", "counter", 3.9, 14.6, 3.6, 0.6, H),
      furn("fu-fridge", "fridge", 0.5, 12.5, 0.7, 0.7),
    ],
    labels: [
      label("r-front", "Front room", 2.1, 1.4),
      label("r-bed", "Bedroom", 2.6, 7.2),
      label("r-mid", "Middle room", 3.0, 9.6),
      label("r-bath", "Bath", 0.9, 9.4),
      label("r-kit", "Kitchen", 2.0, 15.8),
    ],
  };
}

/** Ground floor of a terraced house: party walls both sides, front + garden façades. */
function terracedHouse(): Plan {
  return {
    version: 1,
    name: "Terraced house",
    ceiling: 2.5,
    northDeg: 200,
    walls: [
      wall("w-n", 0, 0, 5.4, 0, "exterior"),
      wall("w-e", 5.4, 0, 5.4, 11, "party"),
      wall("w-s", 5.4, 11, 0, 11, "exterior"),
      wall("w-w", 0, 11, 0, 0, "party"),
      wall("w-p1", 0, 4.5, 5.4, 4.5, "interior"),
      wall("w-p2", 0, 6.2, 5.4, 6.2, "interior"),
    ],
    openings: [
      win("o-f1", "w-n", 1.3, 1.3, 1.5, "open"),
      win("o-f2", "w-n", 3.1, 1.3, 1.5, "closed"),
      door("d-front", "w-n", 4.75, 0.85, "closed", { hinge: "b", swing: 1 }),
      door("d-patio", "w-s", 3.4, 1.8, "open", { passage: false, hinge: "b", swing: -1 }),
      win("o-r1", "w-s", 1.0, 1.0, 1.2, "tilted"),
      door("d-1", "w-p1", 4.4, 0.85, "open", { hinge: "b", swing: 1 }),
      door("d-2", "w-p2", 4.4, 0.85, "open", { hinge: "b", swing: 1 }),
    ],
    fans: [fan("f-1", 2.0, 10.6, -H, false)],
    furniture: [
      furn("fu-sofa", "sofa", 2.2, 3.7, 2.2, 0.9),
      furn("fu-book", "bookcase", 5.1, 2.3, 1.6, 0.35, H),
      furn("fu-stairs", "stairs", 1.7, 5.35, 3.0, 1.0),
      furn("fu-table", "table", 2.3, 8.4, 1.6, 0.9),
      furn("fu-counter", "counter", 0.45, 8.6, 3.6, 0.6, H),
      furn("fu-fridge", "fridge", 5.0, 6.7, 0.7, 0.7),
    ],
    labels: [
      label("r-front", "Front room", 2.5, 1.6),
      label("r-hall", "Hall", 4.2, 5.35),
      label("r-kit", "Kitchen–diner", 3.2, 9.6),
    ],
  };
}

export interface Template {
  id: string;
  name: string;
  blurb: string;
  make: () => Plan;
}

export const TEMPLATES: Template[] = [
  {
    id: "corner",
    name: "Corner flat",
    blurb: "Three façades — lots of ways to set up a cross-breeze.",
    make: cornerFlat,
  },
  {
    id: "single",
    name: "Single-aspect studio",
    blurb: "Windows on one wall only. Hard mode.",
    make: singleAspectStudio,
  },
  {
    id: "railroad",
    name: "Railroad flat",
    blurb: "Rooms in a row, windows only at the ends.",
    make: railroadFlat,
  },
  {
    id: "terrace",
    name: "Terraced house",
    blurb: "Party walls both sides; front and garden façades.",
    make: terracedHouse,
  },
];

export function blankPlan(): Plan {
  return {
    version: 1,
    name: "Untitled home",
    ceiling: 2.6,
    northDeg: 0,
    walls: [],
    openings: [],
    fans: [],
    furniture: [],
    labels: [],
  };
}
