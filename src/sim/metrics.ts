import { AGE_CAP } from "./age";
import { coolingEffect } from "./comfort";
import type { Raster } from "./raster";

export interface RoomMetric {
  index: number;
  name: string;
  area: number;
  /** Mean age of the room's air (s); Infinity when no outside air can reach it. */
  meanAge: number;
  /** Effective air changes per hour ≈ 3600 / mean age. */
  ach: number;
  /** Share of the room's air that is fresh, right now, in the live tracer (0..1). */
  fresh: number;
  /** Mean air speed in the room (m/s). */
  meanSpeed: number;
}

export interface OpeningMetric {
  id: string;
  exterior: boolean;
  /** Volume flow (m³/h). Positive = along the opening normal (into the home for exterior openings). */
  flow: number;
}

export interface ComfortMetric {
  id: string;
  speed: number;
  cooling: number;
}

export interface HomeMetric {
  /** Outdoor air entering the home (m³/h). */
  outdoorAir: number;
  volume: number;
  /** Nominal whole-home air changes per hour (outdoor air / volume). */
  ach: number;
  /** Volume-weighted mean age (s) of the rooms outside air reaches; Infinity if none. */
  meanAge: number;
  /** Floor-area share of the rooms that outside air reaches at all (0..1). */
  ventilatedShare: number;
  /** Minutes until ~95 % of the air is replaced, assuming the rooms mix (3 × mean age). */
  flushMinutes: number;
}

export interface Metrics {
  rooms: RoomMetric[];
  openings: OpeningMetric[];
  comfort: ComfortMetric[];
  home: HomeMetric;
}

/**
 * Turn lattice fields into physical numbers.
 * @param vel lattice→m/s factor (dx/dt); @param dt seconds per lattice step.
 */
export function computeMetrics(
  r: Raster,
  fields: { ux: Float32Array; uy: Float32Array; tau: Float32Array; fresh: Float32Array },
  vel: number,
  dt: number,
): Metrics {
  const { room, grid } = r;
  const nRooms = r.rooms.length;
  const ageSum = new Float64Array(nRooms);
  const ageCount = new Float64Array(nRooms);
  const freshSum = new Float64Array(nRooms);
  const speedSum = new Float64Array(nRooms);
  const count = new Float64Array(nRooms);
  const n = grid.nx * grid.ny;
  for (let c = 0; c < n; c++) {
    const k = room[c];
    if (k < 0) continue;
    // Capped cells are sealed off; average only air that is actually exchanged.
    if (fields.tau[c] < AGE_CAP) {
      ageSum[k] += fields.tau[c];
      ageCount[k] += 1;
    }
    freshSum[k] += fields.fresh[c];
    speedSum[k] += Math.hypot(fields.ux[c], fields.uy[c]);
    count[k] += 1;
  }
  const rooms: RoomMetric[] = r.rooms.map((ri) => {
    const cnt = Math.max(1, count[ri.index]);
    const meanAge =
      count[ri.index] > 0 && ageCount[ri.index] === 0
        ? Number.POSITIVE_INFINITY
        : (ageSum[ri.index] / Math.max(1, ageCount[ri.index])) * dt;
    return {
      index: ri.index,
      name: ri.name,
      area: ri.area,
      meanAge,
      ach: meanAge > 0 ? 3600 / meanAge : 0,
      fresh: freshSum[ri.index] / cnt,
      meanSpeed: (speedSum[ri.index] / cnt) * vel,
    };
  });

  const H = r.ceiling;
  const openings: OpeningMetric[] = r.openings.map((o) => {
    let s = 0;
    for (const c of o.cells) s += fields.ux[c] * o.normal.x + fields.uy[c] * o.normal.y;
    // Flux per metre of height through each wall-thickness layer, averaged over layers; × ceiling height.
    const q2d = o.cells.length ? (s * vel * grid.dx) / o.nLayers : 0;
    return { id: o.id, exterior: o.exterior, flow: q2d * H * 3600 };
  });

  const comfort: ComfortMetric[] = r.comfort.map((spot) => {
    let s = 0;
    for (const c of spot.cells) s += Math.hypot(fields.ux[c], fields.uy[c]);
    const speed = (s / Math.max(1, spot.cells.length)) * vel;
    return { id: spot.id, speed, cooling: coolingEffect(speed) };
  });

  const inflow = openings.reduce((acc, o) => acc + (o.exterior && o.flow > 0 ? o.flow : 0), 0);
  const volume = r.indoorArea * H;
  let ageW = 0;
  let areaW = 0;
  let areaAll = 0;
  for (const rm of rooms) {
    areaAll += rm.area;
    if (!Number.isFinite(rm.meanAge)) continue;
    ageW += rm.meanAge * rm.area;
    areaW += rm.area;
  }
  const meanAge = areaW > 0 ? ageW / areaW : areaAll > 0 ? Number.POSITIVE_INFINITY : 0;
  return {
    rooms,
    openings,
    comfort,
    home: {
      outdoorAir: inflow,
      volume,
      ach: volume > 0 ? inflow / volume : 0,
      meanAge,
      ventilatedShare: areaAll > 0 ? areaW / areaAll : 0,
      flushMinutes: (3 * meanAge) / 60,
    },
  };
}
