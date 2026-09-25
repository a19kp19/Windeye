import { useEffect, useState } from "react";
import { live } from "../state/fields";
import { useStore } from "../state/store";

function clock(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function StatusStrip({ onResetClock }: { onResetClock: () => void }) {
  const running = useStore((s) => s.running);
  const setRunning = useStore((s) => s.setRunning);
  const tracerSpeed = useStore((s) => s.tracerSpeed);
  const setTracerSpeed = useStore((s) => s.setTracerSpeed);
  const status = useStore((s) => s.status);
  const notice = useStore((s) => s.notice);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);
  const raster = live.raster;
  const rtf = raster && live.stepsPerSec ? (live.stepsPerSec * raster.dt).toFixed(1) : "—";
  return (
    <div className="status-strip" role="status" aria-live="off">
      <span className="st-item" data-testid="sim-clock">
        <i>clock</i> {clock(live.tracerTime)}
      </span>
      <button
        type="button"
        onClick={onResetClock}
        title="Put the stale air back and watch it get flushed out again"
      >
        Restart clock
      </button>
      <span className="st-item">
        <i>flow</i> {rtf}× real time
      </span>
      <span className="st-item">
        <i>tracer</i>
        <span className="segmented tiny" role="radiogroup" aria-label="Fresh-air fast-forward">
          {[1, 2, 4].map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={tracerSpeed === k}
              className={tracerSpeed === k ? "on" : ""}
              onClick={() => setTracerSpeed(k)}
            >
              {k === 1 ? "1×" : `${k * 2}×`}
            </button>
          ))}
        </span>
      </span>
      <button type="button" onClick={() => setRunning(!running)} aria-pressed={!running}>
        {running ? "Pause" : "Resume"}
      </button>
      <span className="st-item grow" />
      {status.error ? (
        <span className="st-item err">{status.error}</span>
      ) : notice ? (
        <span className="st-item err" role="alert">
          {notice}
        </span>
      ) : (
        <span className="st-item">
          <i>lattice</i> {status.cells ? `${(status.cells / 1000).toFixed(0)}k cells` : "…"}
        </span>
      )}
    </div>
  );
}
