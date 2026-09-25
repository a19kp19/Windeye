import { useRef } from "react";
import { addLabel, updateLabel } from "../../model/ops";
import { live } from "../../state/fields";
import { useStore } from "../../state/store";
import { formatAge } from "../format";
import { toPlan, toScreen, type View } from "./view";

export function RoomTags({ view }: { view: View }) {
  useStore((s) => s.rasterSeq);
  const metrics = useStore((s) => s.metrics);
  const hoverRoom = useStore((s) => s.hoverRoom);
  const labels = useStore((s) => s.plan.labels);
  const selection = useStore((s) => s.selection);
  const dragRef = useRef<{ id: string; dx: number; dy: number; key: string; moved: boolean } | null>(null);
  const raster = live.raster;
  if (!raster) return null;
  const byLabel = new Map(labels.map((l) => [l.id, l]));

  return (
    <div className="room-tags">
      {raster.rooms.map((r) => {
        if (r.area < 1.2) return null;
        const lab = r.labelId ? byLabel.get(r.labelId) : undefined;
        const anchor = lab?.pos ?? r.anchor;
        const s = toScreen(view, anchor);
        const m = metrics?.rooms.find((x) => x.index === r.index);
        const fresh = m ? Math.round(m.fresh * 100) : null;
        const compact = view.scale < 32 || r.area < 5;
        const selected = selection?.kind === "label" && selection.id === r.labelId;
        return (
          <div
            key={r.index}
            className={`room-tag${hoverRoom === r.index ? " is-hover" : ""}${compact ? " compact" : ""}${selected ? " is-selected" : ""}`}
            style={{ transform: `translate(${s.x}px, ${s.y}px)` }}
            data-testid={`room-tag-${r.name}`}
            onPointerEnter={() => useStore.getState().setHoverRoom(r.index)}
            onPointerLeave={() => useStore.getState().setHoverRoom(null)}
            onPointerDown={(e) => {
              e.stopPropagation();
              const st = useStore.getState();
              let id = r.labelId;
              if (!id) {
                const res = addLabel(st.plan, r.anchor, r.name);
                st.setPlan(() => res.plan);
                id = res.id;
              }
              st.select({ kind: "label", id });
              const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              const p = toPlan(view, { x: e.clientX - host.left, y: e.clientY - host.top });
              dragRef.current = {
                id,
                dx: p.x - anchor.x,
                dy: p.y - anchor.y,
                key: `tag${Date.now()}`,
                moved: false,
              };
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              const host = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              const p = toPlan(view, { x: e.clientX - host.left, y: e.clientY - host.top });
              d.moved = true;
              useStore
                .getState()
                .setPlan((pl) => updateLabel(pl, d.id, { pos: { x: p.x - d.dx, y: p.y - d.dy } }), {
                  coalesce: d.key,
                });
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
          >
            <div className="room-name">{r.name}</div>
            {!compact && <div className="room-area">{r.area.toFixed(1)} m²</div>}
            {m && (
              <div className="room-metric">
                <span className="k">air age</span> <span className="v">{formatAge(m.meanAge)}</span>
              </div>
            )}
            {fresh !== null && (
              <div
                className="fresh-row"
                title="Share of this room's air that has come in from outside since the clock started"
              >
                <div className="fresh-gauge">
                  <span style={{ width: `${fresh}%` }} />
                </div>
                {!compact && <em>{fresh}%</em>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
