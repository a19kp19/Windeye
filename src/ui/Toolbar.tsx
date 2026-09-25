import { FURNITURE_DEFAULTS } from "../model/templates";
import type { FurnitureKind, WallKind } from "../model/types";
import { type Tool, useStore } from "../state/store";

/** Small drafting pictograms, drawn for this app (plan-symbol vocabulary, not an icon set). */
const GLYPHS: Record<Tool, React.ReactNode> = {
  select: <path d="M7 4 L7 19 L11 15 L14 21 L16.5 20 L13.5 14 L19 14 Z" />,
  pan: (
    <path d="M12 3 L12 21 M3 12 L21 12 M12 3 l-2.5 2.5 M12 3 l2.5 2.5 M12 21 l-2.5 -2.5 M12 21 l2.5 -2.5 M3 12 l2.5 -2.5 M3 12 l2.5 2.5 M21 12 l-2.5 -2.5 M21 12 l-2.5 2.5" />
  ),
  wall: (
    <>
      <rect x="3" y="10" width="18" height="4.5" className="fill" />
      <circle cx="3" cy="12.25" r="1.6" />
      <circle cx="21" cy="12.25" r="1.6" />
    </>
  ),
  window: (
    <>
      <rect x="2" y="9.5" width="5" height="5" className="fill" />
      <rect x="17" y="9.5" width="5" height="5" className="fill" />
      <path d="M7 10.6 H17 M7 12 H17 M7 13.4 H17" />
    </>
  ),
  door: (
    <>
      <rect x="2" y="16" width="5" height="4" className="fill" />
      <rect x="19" y="16" width="3" height="4" className="fill" />
      <path d="M7 16 L7 4 M7 4 A 12 12 0 0 1 19 16" />
    </>
  ),
  fan: (
    <>
      <rect x="4" y="5" width="4" height="14" />
      <path d="M6 12 C 8 9, 7 7, 6 6 M6 12 C 4 14, 5 17, 6 18 M9 12 H 19 M19 12 l-3 -2 M19 12 l-3 2" />
    </>
  ),
  furniture: (
    <>
      <rect x="4" y="5" width="16" height="14" />
      <rect x="6" y="6.5" width="12" height="3" />
    </>
  ),
  label: <path d="M4 18 L9 5 L14 18 M6 13.5 H12 M16 18 V11 M16 14 C 16 11, 20 11, 20 14 V18" />,
};

const TOOLS: { tool: Tool; name: string; key: string }[] = [
  { tool: "select", name: "Select & click windows", key: "V" },
  { tool: "wall", name: "Draw walls", key: "W" },
  { tool: "window", name: "Add window", key: "N" },
  { tool: "door", name: "Add door", key: "D" },
  { tool: "fan", name: "Place fan (drag to aim)", key: "F" },
  { tool: "furniture", name: "Place furniture", key: "U" },
  { tool: "label", name: "Name a room", key: "L" },
  { tool: "pan", name: "Pan (or hold Space)", key: "H" },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const wallKind = useStore((s) => s.wallKind);
  const setWallKind = useStore((s) => s.setWallKind);
  const furnitureKind = useStore((s) => s.furnitureKind);
  const setFurnitureKind = useStore((s) => s.setFurnitureKind);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  return (
    <nav className="toolbar" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className={`tool${tool === t.tool ? " on" : ""}`}
          aria-pressed={tool === t.tool}
          title={`${t.name} (${t.key})`}
          aria-label={t.name}
          data-testid={`tool-${t.tool}`}
          onClick={() => setTool(t.tool)}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            {GLYPHS[t.tool]}
          </svg>
          <kbd>{t.key}</kbd>
        </button>
      ))}
      <div className="tool-sep" />
      <button
        type="button"
        className="tool small"
        disabled={!canUndo}
        onClick={undo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        type="button"
        className="tool small"
        disabled={!canRedo}
        onClick={redo}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        ↷
      </button>
      {tool === "wall" && (
        <div className="tool-flyout" role="group" aria-label="Wall kind">
          <span className="flyout-title">Wall faces</span>
          {(["exterior", "interior", "party"] as WallKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={wallKind === k ? "on" : ""}
              onClick={() => setWallKind(k)}
            >
              {k === "exterior" ? "Outside" : k === "interior" ? "Inside" : "Neighbour"}
            </button>
          ))}
          <p>Click to start, click to add corners, double-click or Esc to finish. Shift = any angle.</p>
        </div>
      )}
      {tool === "furniture" && (
        <div className="tool-flyout" role="group" aria-label="Furniture kind">
          <span className="flyout-title">Piece</span>
          {(Object.keys(FURNITURE_DEFAULTS) as FurnitureKind[]).map((k) => (
            <button
              key={k}
              type="button"
              className={furnitureKind === k ? "on" : ""}
              onClick={() => setFurnitureKind(k)}
            >
              {FURNITURE_DEFAULTS[k].label}
            </button>
          ))}
          <p>Click on the plan to place.</p>
        </div>
      )}
    </nav>
  );
}
