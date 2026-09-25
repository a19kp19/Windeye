import { useEffect, useRef } from "react";
import { live } from "../state/fields";
import { useStore } from "../state/store";
import type { FromWorker, ToWorker } from "./protocol";

/** How many lattice cells to aim for, from a quick guess at device speed. */
function targetCells(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4;
  return cores >= 8 ? 52000 : cores >= 4 ? 42000 : 30000;
}

/** Owns the simulation worker and keeps it in sync with the store. */
export function useSimulation() {
  const workerRef = useRef<Worker | null>(null);
  const plan = useStore((s) => s.plan);
  const weather = useStore((s) => s.weather);
  const running = useStore((s) => s.running);
  const tracerSpeed = useStore((s) => s.tracerSpeed);
  const loaded = useRef(false);

  useEffect(() => {
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      const st = useStore.getState();
      switch (msg.type) {
        case "raster": {
          live.raster = msg;
          live.age = null;
          live.cooling = null;
          st.setStatus({ cells: msg.grid.nx * msg.grid.ny, dx: msg.grid.dx, error: null });
          st.bumpRaster();
          break;
        }
        case "frame": {
          const old = [live.ux, live.uy, live.fresh].filter((a): a is Float32Array => a !== null);
          live.ux = msg.ux;
          live.uy = msg.uy;
          live.fresh = msg.fresh;
          live.simTime = msg.simTime;
          live.tracerTime = msg.tracerTime;
          live.stepsPerSec = msg.stepsPerSec;
          live.frameSeq++;
          if (old.length) {
            // Transfer (not copy) the previous frame's buffers back so the worker can reuse them.
            const buffers = old.map((a) => a.buffer as ArrayBuffer).filter((b) => b.byteLength > 0);
            worker.postMessage({ type: "recycle", buffers } satisfies ToWorker, buffers);
          }
          break;
        }
        case "metrics": {
          live.age = msg.age;
          live.cooling = msg.cooling;
          live.metricsSeq++;
          st.setMetrics(msg.metrics);
          st.setStatus({ simTime: live.simTime, tracerTime: live.tracerTime, stepsPerSec: live.stepsPerSec });
          break;
        }
        case "error":
          st.setStatus({ error: msg.message });
          break;
      }
    };
    worker.onerror = (e) => useStore.getState().setStatus({ error: e.message || "Simulation worker failed" });
    return () => {
      worker.terminate();
      workerRef.current = null;
      loaded.current = false;
    };
  }, []);

  // Geometry: debounce rapid edits (dragging) a little; keep the flow going across small edits.
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    const first = !loaded.current;
    const t = setTimeout(
      () => {
        w.postMessage({
          type: "load",
          plan,
          weather: useStore.getState().weather,
          targetCells: targetCells(),
          keepFlow: !first,
        } satisfies ToWorker);
        loaded.current = true;
      },
      first ? 0 : 90,
    );
    return () => clearTimeout(t);
  }, [plan]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: "weather", weather } satisfies ToWorker);
  }, [weather]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: "running", running } satisfies ToWorker);
  }, [running]);

  useEffect(() => {
    workerRef.current?.postMessage({ type: "tracerSpeed", substeps: tracerSpeed } satisfies ToWorker);
  }, [tracerSpeed]);

  return {
    resetClock: () => workerRef.current?.postMessage({ type: "resetClock" } satisfies ToWorker),
  };
}
