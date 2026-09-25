import type { Plan, Weather } from "../model/types";
import type { Metrics } from "./metrics";
import type { GridSpec, RoomInfo } from "./raster";

export type ToWorker =
  | { type: "load"; plan: Plan; weather: Weather; targetCells: number; keepFlow: boolean }
  | { type: "weather"; weather: Weather }
  | { type: "running"; running: boolean }
  | { type: "resetClock" }
  | { type: "tracerSpeed"; substeps: number }
  | { type: "recycle"; buffers: ArrayBuffer[] };

export interface RasterSummary {
  grid: GridSpec;
  solid: Uint8Array;
  outdoor: Uint8Array;
  room: Int16Array;
  rooms: RoomInfo[];
  /** Exterior openings with their façade pressure coefficient (for drawing +/− on façades). */
  facades: { id: string; cp: number }[];
  /** Every opening's normal (pointing into the home for exterior ones). */
  openings: { id: string; nx: number; ny: number; exterior: boolean; roomIn: number; roomOut: number }[];
  dt: number;
  vel: number;
  indoorArea: number;
}

export interface FrameMsg {
  type: "frame";
  /** Instantaneous velocity, m/s. */
  ux: Float32Array;
  uy: Float32Array;
  fresh: Float32Array;
  simTime: number;
  /** Simulated seconds of fresh-air tracer time (fast-forward aware). */
  tracerTime: number;
  realTime: number;
  stepsPerSec: number;
}

export interface MetricsMsg {
  type: "metrics";
  metrics: Metrics;
  /** Mean age of air per cell, seconds. */
  age: Float32Array;
  /** Perceived cooling from mean air speed, °C. */
  cooling: Float32Array;
  converged: boolean;
}

export type FromWorker =
  | ({ type: "raster" } & RasterSummary)
  | FrameMsg
  | MetricsMsg
  | { type: "error"; message: string };
