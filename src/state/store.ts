import { create } from "zustand";
import { TEMPLATES } from "../model/templates";
import type { FurnitureKind, Plan, WallKind, Weather } from "../model/types";
import type { Metrics } from "../sim/metrics";

export type Tool = "select" | "wall" | "window" | "door" | "fan" | "furniture" | "label" | "pan";
export type Layer = "fresh" | "age" | "breeze" | "none";
export type SelKind = "wall" | "opening" | "fan" | "furniture" | "label";
export interface Selection {
  kind: SelKind;
  id: string;
}

export interface SimStatus {
  simTime: number;
  tracerTime: number;
  stepsPerSec: number;
  cells: number;
  dx: number;
  error: string | null;
}

interface State {
  plan: Plan;
  past: Plan[];
  future: Plan[];
  /** Last history coalescing key: consecutive edits with the same key make one undo step. */
  coalesce: string | null;
  templateId: string | null;
  weather: Weather;
  tool: Tool;
  wallKind: WallKind;
  furnitureKind: FurnitureKind;
  selection: Selection | null;
  hoverRoom: number | null;
  layer: Layer;
  streaks: boolean;
  tracerSpeed: number;
  running: boolean;
  metrics: Metrics | null;
  status: SimStatus;
  /** One-off message for the status strip, e.g. a share link that couldn't be opened. */
  notice: string | null;
  /** Increments to ask the canvas to re-fit the plan into view. */
  fitSeq: number;
  /** Increments when the worker publishes a new raster (rooms, façade pressures). */
  rasterSeq: number;

  setPlan: (fn: (p: Plan) => Plan, opts?: { coalesce?: string; history?: boolean }) => void;
  replacePlan: (p: Plan, templateId?: string | null) => void;
  undo: () => void;
  redo: () => void;
  setWeather: (w: Partial<Weather>) => void;
  setTool: (t: Tool) => void;
  setWallKind: (k: WallKind) => void;
  setFurnitureKind: (k: FurnitureKind) => void;
  select: (s: Selection | null) => void;
  setHoverRoom: (r: number | null) => void;
  setLayer: (l: Layer) => void;
  setStreaks: (on: boolean) => void;
  setTracerSpeed: (s: number) => void;
  setRunning: (r: boolean) => void;
  setMetrics: (m: Metrics | null) => void;
  setStatus: (s: Partial<SimStatus>) => void;
  setNotice: (n: string | null) => void;
  requestFit: () => void;
  bumpRaster: () => void;
}

const HISTORY = 80;

export const DEFAULT_WEATHER: Weather = { windFromDeg: 225, windSpeed: 4, exposure: "suburban" };

export const useStore = create<State>((set, get) => ({
  plan: TEMPLATES[0].make(),
  past: [],
  future: [],
  coalesce: null,
  templateId: TEMPLATES[0].id,
  weather: DEFAULT_WEATHER,
  tool: "select",
  wallKind: "exterior",
  furnitureKind: "wardrobe",
  selection: null,
  hoverRoom: null,
  layer: "fresh",
  streaks: true,
  tracerSpeed: 2,
  running: true,
  metrics: null,
  status: { simTime: 0, tracerTime: 0, stepsPerSec: 0, cells: 0, dx: 0, error: null },
  notice: null,
  fitSeq: 0,
  rasterSeq: 0,

  setPlan: (fn, opts = {}) => {
    const { plan, past, coalesce } = get();
    const next = fn(plan);
    if (next === plan) return;
    if (opts.history === false) {
      set({ plan: next });
      return;
    }
    const key = opts.coalesce ?? null;
    const merge = key !== null && key === coalesce;
    set({
      plan: next,
      past: merge ? past : [...past.slice(-HISTORY + 1), plan],
      future: [],
      coalesce: key,
    });
  },
  replacePlan: (p, templateId = null) =>
    set((s) => ({
      plan: p,
      past: [...s.past.slice(-HISTORY + 1), s.plan],
      future: [],
      coalesce: null,
      templateId,
      selection: null,
      fitSeq: s.fitSeq + 1,
    })),
  undo: () => {
    const { past, plan, future } = get();
    if (!past.length) return;
    set({
      plan: past[past.length - 1],
      past: past.slice(0, -1),
      future: [plan, ...future],
      coalesce: null,
      selection: null,
    });
  },
  redo: () => {
    const { past, plan, future } = get();
    if (!future.length) return;
    set({ plan: future[0], past: [...past, plan], future: future.slice(1), coalesce: null, selection: null });
  },
  setWeather: (w) => set((s) => ({ weather: { ...s.weather, ...w } })),
  setTool: (tool) => set({ tool, selection: tool === "select" ? get().selection : null }),
  setWallKind: (wallKind) => set({ wallKind }),
  setFurnitureKind: (furnitureKind) => set({ furnitureKind }),
  select: (selection) => set({ selection }),
  setHoverRoom: (hoverRoom) => set({ hoverRoom }),
  setLayer: (layer) => set({ layer }),
  setStreaks: (streaks) => set({ streaks }),
  setTracerSpeed: (tracerSpeed) => set({ tracerSpeed }),
  setRunning: (running) => set({ running }),
  setMetrics: (metrics) => set({ metrics }),
  setStatus: (s) => set((st) => ({ status: { ...st.status, ...s } })),
  setNotice: (notice) => set({ notice }),
  requestFit: () => set((s) => ({ fitSeq: s.fitSeq + 1 })),
  bumpRaster: () => set((s) => ({ rasterSeq: s.rasterSeq + 1 })),
}));
