/// <reference lib="webworker" />
import type { Plan, Weather } from "../model/types";
import { runScene } from "./scene";

export interface OptTask {
  id: string;
  plan: Plan;
  weather: Weather;
  targetCells: number;
}

export interface OptResult {
  id: string;
  metrics: import("./metrics").Metrics;
  comfortRooms: Record<string, string>;
  thumb: { nx: number; ny: number; speed: Uint8Array; solid: Uint8Array; room: Int16Array };
  ms: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<OptTask>) => {
  const t0 = performance.now();
  const { id, plan, weather, targetCells } = e.data;
  try {
    const res = runScene(plan, weather, { targetCells, spinUp: 12, average: 8, maxSteps: 14000 });
    const { nx, ny } = res.raster.grid;
    const speed = new Uint8Array(nx * ny);
    for (let c = 0; c < speed.length; c++) {
      const v = Math.hypot(res.meanUx[c], res.meanUy[c]) * res.scales.vel;
      speed[c] = Math.min(255, Math.round((v / 1.2) * 255));
    }
    const comfortRooms: Record<string, string> = {};
    for (const spot of res.raster.comfort) {
      const counts = new Map<number, number>();
      for (const c of spot.cells) {
        const r = res.raster.room[c];
        if (r >= 0) counts.set(r, (counts.get(r) ?? 0) + 1);
      }
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) comfortRooms[spot.id] = res.raster.rooms[best[0]].name;
    }
    const out: OptResult = {
      id,
      metrics: res.metrics,
      comfortRooms,
      thumb: { nx, ny, speed, solid: res.raster.solid, room: res.raster.room },
      ms: performance.now() - t0,
    };
    ctx.postMessage(out, [speed.buffer]);
  } catch (err) {
    ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
