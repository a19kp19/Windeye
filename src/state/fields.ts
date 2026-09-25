import type { RasterSummary } from "../sim/protocol";

/**
 * Latest simulation fields, deliberately outside React: the renderer reads these every animation
 * frame, and pushing 30 Hz typed arrays through state would re-render the whole tree.
 */
export interface LiveFields {
  raster: RasterSummary | null;
  ux: Float32Array | null;
  uy: Float32Array | null;
  fresh: Float32Array | null;
  age: Float32Array | null;
  cooling: Float32Array | null;
  simTime: number;
  tracerTime: number;
  stepsPerSec: number;
  /** Bumped whenever a new frame lands, so painters can skip redundant work. */
  frameSeq: number;
  metricsSeq: number;
}

export const live: LiveFields = {
  raster: null,
  ux: null,
  uy: null,
  fresh: null,
  age: null,
  cooling: null,
  simTime: 0,
  tracerTime: 0,
  stepsPerSec: 0,
  frameSeq: 0,
  metricsSeq: 0,
};
