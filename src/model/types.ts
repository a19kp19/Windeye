/** Plan coordinates are metres, x to the right, y down (screen convention). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * exterior — faces open air; interior — partition inside the home;
 * party — shared with a neighbour or the building core (no outside air behind it).
 */
export type WallKind = "exterior" | "interior" | "party";

export interface Wall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  kind: WallKind;
}

export type OpeningKind = "window" | "door";
/** "tilted" is the tilt-and-turn / top-hung position; doors only use closed/open. */
export type OpeningState = "closed" | "tilted" | "open";

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance along the wall from `a` to the centre of the opening (m). */
  offset: number;
  width: number;
  /** Clear height of the opening (m). Scales how much of the wall height actually passes air. */
  height: number;
  state: OpeningState;
  /** Door leaf drawing: which end the hinge sits at and which side it swings to. */
  hinge?: "a" | "b";
  swing?: 1 | -1;
  /** Doorless passage (drawn without a leaf, always open). */
  passage?: boolean;
}

export interface Fan {
  id: string;
  pos: Vec2;
  /** Direction the fan blows, radians in plan coordinates (0 = +x, π/2 = +y/down). */
  angle: number;
  /** Width of the fan face (m). */
  size: number;
  /** Exit air speed (m/s). A 20" box fan on high is roughly 3–4 m/s. */
  speed: number;
  on: boolean;
}

export type FurnitureKind =
  | "wardrobe"
  | "bookcase"
  | "fridge"
  | "bed"
  | "sofa"
  | "table"
  | "counter"
  | "desk"
  | "stairs";

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  /** Centre of the footprint. */
  pos: Vec2;
  /** Footprint along local x (w) and local y (d), metres. */
  w: number;
  d: number;
  angle: number;
  height: number;
}

export interface RoomLabel {
  id: string;
  pos: Vec2;
  name: string;
}

export interface Plan {
  version: 1;
  name: string;
  /** Ceiling height (m). */
  ceiling: number;
  /** Clockwise rotation (degrees) of the north arrow from plan-up. 0 means plan-up is north. */
  northDeg: number;
  walls: Wall[];
  openings: Opening[];
  fans: Fan[];
  furniture: Furniture[];
  labels: RoomLabel[];
}

/** How much the 10 m weather-station wind is reduced at window height. */
export type Exposure = "sheltered" | "suburban" | "open";

export interface Weather {
  /** Meteorological convention: bearing the wind blows FROM, degrees clockwise from north. */
  windFromDeg: number;
  /** Forecast / station wind speed at 10 m, m/s. */
  windSpeed: number;
  exposure: Exposure;
}
