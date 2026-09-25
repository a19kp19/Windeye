import {
  deleteSelection,
  updateFan,
  updateFurniture,
  updateLabel,
  updateOpening,
  updateWall,
  WALL_THICKNESS,
} from "../model/ops";
import { FURNITURE_DEFAULTS } from "../model/templates";
import type { FurnitureKind, OpeningState, WallKind } from "../model/types";
import { useStore } from "../state/store";

function Num({
  label,
  value,
  onChange,
  step = 0.05,
  min = 0,
  max = 50,
  unit = "m",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <label className="insp-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(2))}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
      <em>{unit}</em>
    </label>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const plan = useStore((s) => s.plan);
  const setPlan = useStore((s) => s.setPlan);
  const select = useStore((s) => s.select);
  if (!selection) return null;
  const key = `insp-${selection.id}`;
  const remove = () => {
    setPlan((p) => deleteSelection(p, selection));
    select(null);
  };
  let title = "";
  let body: React.ReactNode = null;

  if (selection.kind === "opening") {
    const o = plan.openings.find((x) => x.id === selection.id);
    if (!o) return null;
    title = o.kind === "window" ? "Window" : o.passage ? "Passage" : "Door";
    const states: { value: OpeningState; label: string }[] =
      o.kind === "window"
        ? [
            { value: "closed", label: "Shut" },
            { value: "tilted", label: "Tilted" },
            { value: "open", label: "Open" },
          ]
        : [
            { value: "closed", label: "Shut" },
            { value: "open", label: "Open" },
          ];
    body = (
      <>
        {!o.passage && (
          <Segmented
            label="Opening state"
            value={o.state}
            options={states}
            onChange={(state) => setPlan((p) => updateOpening(p, o.id, { state }))}
          />
        )}
        <div className="insp-row">
          <Num
            label="Width"
            value={o.width}
            min={0.3}
            max={4}
            onChange={(width) => setPlan((p) => updateOpening(p, o.id, { width }), { coalesce: key + "w" })}
          />
          <Num
            label="Height"
            value={o.height}
            min={0.2}
            max={3}
            onChange={(height) => setPlan((p) => updateOpening(p, o.id, { height }), { coalesce: key + "h" })}
          />
        </div>
        {o.kind === "door" && (
          <div className="insp-actions">
            <button
              type="button"
              onClick={() => setPlan((p) => updateOpening(p, o.id, { hinge: o.hinge === "b" ? "a" : "b" }))}
            >
              Flip hinge
            </button>
            <button
              type="button"
              onClick={() => setPlan((p) => updateOpening(p, o.id, { swing: o.swing === -1 ? 1 : -1 }))}
            >
              Flip swing
            </button>
            <button
              type="button"
              onClick={() => setPlan((p) => updateOpening(p, o.id, { passage: !o.passage, state: "open" }))}
            >
              {o.passage ? "Add leaf" : "No leaf"}
            </button>
          </div>
        )}
        {o.kind === "window" && (
          <p className="insp-hint">Tip: click any window on the plan to cycle open → tilted → shut.</p>
        )}
      </>
    );
  } else if (selection.kind === "fan") {
    const f = plan.fans.find((x) => x.id === selection.id);
    if (!f) return null;
    title = "Fan";
    body = (
      <>
        <Segmented
          label="Fan power"
          value={f.on ? (f.speed < 2.6 ? "low" : f.speed < 3.6 ? "med" : "high") : "off"}
          options={[
            { value: "off", label: "Off" },
            { value: "low", label: "Low" },
            { value: "med", label: "Med" },
            { value: "high", label: "High" },
          ]}
          onChange={(v) =>
            setPlan((p) =>
              updateFan(
                p,
                f.id,
                v === "off"
                  ? { on: false }
                  : { on: true, speed: v === "low" ? 2.2 : v === "med" ? 3.2 : 4.2 },
              ),
            )
          }
        />
        <div className="insp-row">
          <Num
            label="Face"
            value={f.size}
            min={0.2}
            max={1.2}
            onChange={(size) => setPlan((p) => updateFan(p, f.id, { size }), { coalesce: key + "s" })}
          />
          <Num
            label="Exit"
            value={f.speed}
            min={0.5}
            max={6}
            step={0.1}
            unit="m/s"
            onChange={(speed) => setPlan((p) => updateFan(p, f.id, { speed }), { coalesce: key + "v" })}
          />
        </div>
        <div className="insp-actions">
          <button
            type="button"
            onClick={() => setPlan((p) => updateFan(p, f.id, { angle: f.angle + Math.PI }))}
          >
            Reverse
          </button>
          <button
            type="button"
            onClick={() => setPlan((p) => updateFan(p, f.id, { angle: f.angle + Math.PI / 2 }))}
          >
            Turn 90°
          </button>
        </div>
        <p className="insp-hint">
          Drag the round handle to aim. Put a fan in an open window facing out to pull fresh air through the
          home.
        </p>
      </>
    );
  } else if (selection.kind === "furniture") {
    const f = plan.furniture.find((x) => x.id === selection.id);
    if (!f) return null;
    title = FURNITURE_DEFAULTS[f.kind].label;
    body = (
      <>
        <label className="insp-field wide">
          <span>Kind</span>
          <select
            value={f.kind}
            onChange={(e) => {
              const kind = e.target.value as FurnitureKind;
              const d = FURNITURE_DEFAULTS[kind];
              setPlan((p) => updateFurniture(p, f.id, { kind, w: d.w, d: d.d, height: d.height }));
            }}
          >
            {Object.entries(FURNITURE_DEFAULTS).map(([k, d]) => (
              <option key={k} value={k}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <div className="insp-row three">
          <Num
            label="W"
            value={f.w}
            min={0.2}
            max={6}
            onChange={(w) => setPlan((p) => updateFurniture(p, f.id, { w }), { coalesce: key + "w" })}
          />
          <Num
            label="D"
            value={f.d}
            min={0.2}
            max={6}
            onChange={(d) => setPlan((p) => updateFurniture(p, f.id, { d }), { coalesce: key + "d" })}
          />
          <Num
            label="H"
            value={f.height}
            min={0.1}
            max={3}
            onChange={(height) =>
              setPlan((p) => updateFurniture(p, f.id, { height }), { coalesce: key + "h" })
            }
          />
        </div>
        <div className="insp-actions">
          <button
            type="button"
            onClick={() => setPlan((p) => updateFurniture(p, f.id, { angle: f.angle + Math.PI / 2 }))}
          >
            Rotate 90°
          </button>
        </div>
        <p className="insp-hint">
          Tall pieces (wardrobes, bookcases) block air; low ones mostly let it pass over.
        </p>
      </>
    );
  } else if (selection.kind === "wall") {
    const w = plan.walls.find((x) => x.id === selection.id);
    if (!w) return null;
    title = "Wall";
    body = (
      <>
        <Segmented<WallKind>
          label="Wall kind"
          value={w.kind}
          options={[
            { value: "exterior", label: "Outside" },
            { value: "interior", label: "Inside" },
            { value: "party", label: "Neighbour" },
          ]}
          onChange={(kind) => setPlan((p) => updateWall(p, w.id, { kind, thickness: WALL_THICKNESS[kind] }))}
        />
        <div className="insp-row">
          <Num
            label="Thick"
            value={w.thickness}
            min={0.05}
            max={0.8}
            step={0.01}
            onChange={(thickness) =>
              setPlan((p) => updateWall(p, w.id, { thickness }), { coalesce: key + "t" })
            }
          />
          <label className="insp-field">
            <span>Length</span>
            <output>{Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y).toFixed(2)}</output>
            <em>m</em>
          </label>
        </div>
        <p className="insp-hint">
          “Neighbour” walls have no outside air behind them. Drag a wall corner to reshape.
        </p>
      </>
    );
  } else if (selection.kind === "label") {
    const l = plan.labels.find((x) => x.id === selection.id);
    if (!l) return null;
    title = "Room";
    body = (
      <label className="insp-field wide">
        <span>Name</span>
        <input
          type="text"
          value={l.name}
          maxLength={28}
          onChange={(e) => setPlan((p) => updateLabel(p, l.id, { name: e.target.value }), { coalesce: key })}
        />
      </label>
    );
  }

  return (
    <aside
      className="inspector"
      aria-label={`${title} properties`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header>
        <h3>{title}</h3>
        <button type="button" className="icon" aria-label="Close inspector" onClick={() => select(null)}>
          ×
        </button>
      </header>
      {body}
      <footer>
        <button type="button" className="danger" onClick={remove}>
          Delete
        </button>
      </footer>
    </aside>
  );
}
