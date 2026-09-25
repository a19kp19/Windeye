import { memo } from "react";
import {
  add,
  dot,
  openingSpan,
  planBounds,
  rectCorners,
  scale,
  sub,
  wallDir,
  wallLength,
  wallNormal,
} from "../../model/geometry";
import { FURNITURE_DEFAULTS } from "../../model/templates";
import type { Fan, Furniture, Opening, Plan, Vec2, Wall } from "../../model/types";
import type { Selection } from "../../state/store";

export interface OpeningInfo {
  nx: number;
  ny: number;
  exterior: boolean;
  cp?: number;
}

interface Props {
  plan: Plan;
  selection: Selection | null;
  info: Map<string, OpeningInfo>;
  /** Pixels per metre, for hiding small text. */
  pxPerM: number;
  preview: Preview | null;
}

export type Preview =
  | { kind: "wall"; a: Vec2; b: Vec2 }
  | { kind: "opening"; wall: Wall; offset: number; width: number; opening: "window" | "door" }
  | { kind: "fan"; pos: Vec2; angle: number }
  | { kind: "point"; p: Vec2 };

const pts = (ps: Vec2[]) => ps.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(" ");

/** Quad for the stretch of wall between `s0` and `s1` (m along the wall), with end caps at the wall ends. */
function wallQuad(w: Wall, s0: number, s1: number): Vec2[] {
  const d = wallDir(w);
  const n = wallNormal(w);
  const L = wallLength(w);
  const h = w.thickness / 2;
  const e0 = s0 <= 1e-6 ? -h : s0;
  const e1 = s1 >= L - 1e-6 ? L + h : s1;
  const p0 = add(w.a, scale(d, e0));
  const p1 = add(w.a, scale(d, e1));
  return [add(p0, scale(n, h)), add(p1, scale(n, h)), add(p1, scale(n, -h)), add(p0, scale(n, -h))];
}

function WallShape({ w, openings, selected }: { w: Wall; openings: Opening[]; selected: boolean }) {
  const L = wallLength(w);
  const cuts = openings
    .map((o) => [o.offset - o.width / 2, o.offset + o.width / 2] as const)
    .sort((a, b) => a[0] - b[0]);
  const segs: [number, number][] = [];
  let s = 0;
  for (const [c0, c1] of cuts) {
    if (c0 > s) segs.push([s, c0]);
    s = Math.max(s, c1);
  }
  if (s < L) segs.push([s, L]);
  const cls = `wall wall-${w.kind}${selected ? " is-selected" : ""}`;
  return (
    <g className={cls}>
      {segs.map(([a, b]) => (
        <polygon key={`${a}-${b}`} points={pts(wallQuad(w, a, b))} />
      ))}
    </g>
  );
}

/** Hatched neighbour mass behind a party wall (drawn outward, away from `inward`). */
function NeighbourMass({ w, inward }: { w: Wall; inward: Vec2 | null }) {
  const n = wallNormal(w);
  const side = inward ? (dot(n, inward) > 0 ? -1 : 1) : 1;
  const d = wallDir(w);
  const h = w.thickness / 2;
  const depth = 1.1;
  const o = scale(n, side * h);
  const o2 = scale(n, side * (h + depth));
  const a = add(w.a, scale(d, -h));
  const b = add(w.b, scale(d, h));
  return <polygon className="neighbour" points={pts([add(a, o), add(b, o), add(b, o2), add(a, o2)])} />;
}

function WindowSymbol({
  w,
  o,
  info,
  selected,
}: {
  w: Wall;
  o: Opening;
  info?: OpeningInfo;
  selected: boolean;
}) {
  const span = openingSpan(w, o);
  const n = wallNormal(w);
  const h = w.thickness / 2;
  const inward = info?.exterior ? { x: info.nx, y: info.ny } : n;
  const inn = dot(n, inward) >= 0 ? n : scale(n, -1);
  const d = wallDir(w);
  const faceIn = scale(inn, h);
  const faceOut = scale(inn, -h);
  const cls = `opening window state-${o.state}${selected ? " is-selected" : ""}`;
  const leaf = o.width / 2;
  const ang = (58 * Math.PI) / 180;
  const leafDirA = add(scale(d, Math.cos(ang)), scale(inn, Math.sin(ang)));
  const leafDirB = add(scale(d, -Math.cos(ang)), scale(inn, Math.sin(ang)));
  const tipA = add(add(span.a, faceIn), scale(leafDirA, leaf));
  const tipB = add(add(span.b, faceIn), scale(leafDirB, leaf));
  return (
    <g className={cls} data-id={o.id}>
      <polygon
        className="opening-hit"
        points={pts([add(span.a, faceIn), add(span.b, faceIn), add(span.b, faceOut), add(span.a, faceOut)])}
      />
      <line
        className="jamb"
        x1={span.a.x + faceIn.x}
        y1={span.a.y + faceIn.y}
        x2={span.a.x + faceOut.x}
        y2={span.a.y + faceOut.y}
      />
      <line
        className="jamb"
        x1={span.b.x + faceIn.x}
        y1={span.b.y + faceIn.y}
        x2={span.b.x + faceOut.x}
        y2={span.b.y + faceOut.y}
      />
      <line
        className="sill"
        x1={span.a.x + faceOut.x * 0.55}
        y1={span.a.y + faceOut.y * 0.55}
        x2={span.b.x + faceOut.x * 0.55}
        y2={span.b.y + faceOut.y * 0.55}
      />
      <line
        className="sill"
        x1={span.a.x + faceIn.x * 0.55}
        y1={span.a.y + faceIn.y * 0.55}
        x2={span.b.x + faceIn.x * 0.55}
        y2={span.b.y + faceIn.y * 0.55}
      />
      {o.state !== "open" && (
        <line className="glass" x1={span.a.x} y1={span.a.y} x2={span.b.x} y2={span.b.y} />
      )}
      {o.state === "open" && (
        <>
          <line className="leaf" x1={span.a.x + faceIn.x} y1={span.a.y + faceIn.y} x2={tipA.x} y2={tipA.y} />
          <line className="leaf" x1={span.b.x + faceIn.x} y1={span.b.y + faceIn.y} x2={tipB.x} y2={tipB.y} />
        </>
      )}
      {o.state === "tilted" && (
        <polyline
          className="tilt"
          points={pts([
            add(add(span.center, scale(d, -o.width * 0.18)), scale(inn, h + 0.05)),
            add(span.center, scale(inn, h + 0.2)),
            add(add(span.center, scale(d, o.width * 0.18)), scale(inn, h + 0.05)),
          ])}
        />
      )}
    </g>
  );
}

function DoorSymbol({ w, o, selected }: { w: Wall; o: Opening; selected: boolean }) {
  const span = openingSpan(w, o);
  const n = wallNormal(w);
  const d = wallDir(w);
  const h = w.thickness / 2;
  const side = scale(n, o.swing ?? 1);
  const hingeAtA = (o.hinge ?? "a") === "a";
  const hinge = hingeAtA ? span.a : span.b;
  const far = hingeAtA ? span.b : span.a;
  const face = add(hinge, scale(side, h));
  const tip = add(face, scale(side, o.width));
  const farFace = add(far, scale(side, h));
  const cls = `opening door state-${o.state}${o.passage ? " passage" : ""}${selected ? " is-selected" : ""}`;
  const sweep = (hingeAtA ? 1 : -1) * (o.swing ?? 1) * (d.x * n.y - d.y * n.x) > 0 ? 1 : 0;
  return (
    <g className={cls} data-id={o.id}>
      <polygon
        className="opening-hit"
        points={pts([
          add(span.a, scale(n, h)),
          add(span.b, scale(n, h)),
          add(span.b, scale(n, -h)),
          add(span.a, scale(n, -h)),
        ])}
      />
      <line
        className="jamb"
        x1={span.a.x + n.x * h}
        y1={span.a.y + n.y * h}
        x2={span.a.x - n.x * h}
        y2={span.a.y - n.y * h}
      />
      <line
        className="jamb"
        x1={span.b.x + n.x * h}
        y1={span.b.y + n.y * h}
        x2={span.b.x - n.x * h}
        y2={span.b.y - n.y * h}
      />
      {!o.passage && o.state === "open" && (
        <>
          <line className="leaf" x1={face.x} y1={face.y} x2={tip.x} y2={tip.y} />
          <path
            className="swing"
            d={`M ${tip.x} ${tip.y} A ${o.width} ${o.width} 0 0 ${1 - sweep} ${farFace.x} ${farFace.y}`}
          />
        </>
      )}
      {!o.passage && o.state !== "open" && (
        <line className="leaf closed" x1={span.a.x} y1={span.a.y} x2={span.b.x} y2={span.b.y} />
      )}
    </g>
  );
}

function FanSymbol({ f, selected }: { f: Fan; selected: boolean }) {
  const deg = (f.angle * 180) / Math.PI;
  const s = f.size;
  const arrow = 0.55 + f.speed * 0.12;
  return (
    <g
      className={`fan ${f.on ? "is-on" : "is-off"}${selected ? " is-selected" : ""}`}
      data-id={f.id}
      transform={`translate(${f.pos.x} ${f.pos.y}) rotate(${deg})`}
    >
      <rect className="fan-body" x={-0.13} y={-s / 2} width={0.26} height={s} />
      <g
        className="fan-rotor"
        style={{ animationDuration: `${Math.max(0.25, 1.6 / Math.max(0.5, f.speed))}s` }}
      >
        <circle className="fan-hub" r={s * 0.07} />
        {[0, 120, 240].map((a) => (
          <path
            key={a}
            className="fan-blade"
            transform={`rotate(${a})`}
            d={`M 0 0 C ${s * 0.1} ${-s * 0.1}, ${s * 0.12} ${-s * 0.34}, 0 ${-s * 0.4} C ${-s * 0.06} ${-s * 0.3}, ${-s * 0.04} ${-s * 0.1}, 0 0 Z`}
          />
        ))}
      </g>
      <line className="fan-jet" x1={0.2} y1={0} x2={0.2 + arrow} y2={0} />
      <path className="fan-head" d={`M ${0.2 + arrow} 0 l -0.16 -0.09 l 0 0.18 z`} />
      {selected && <circle className="handle rotate" cx={0.2 + arrow + 0.14} cy={0} r={0.09} />}
    </g>
  );
}

function FurnitureShape({ f, selected, pxPerM }: { f: Furniture; selected: boolean; pxPerM: number }) {
  const c = rectCorners(f.pos, f.w, f.d, f.angle);
  const tall = f.height >= 1.6;
  const label = FURNITURE_DEFAULTS[f.kind].label.toUpperCase();
  const fontM = Math.min(0.17, Math.min(f.w, f.d) * 0.32);
  const showText = fontM * pxPerM >= 7.5;
  const deg = ((f.angle * 180) / Math.PI) % 180;
  const textDeg = Math.abs(deg) > 90 ? deg - 180 : deg;
  return (
    <g
      className={`furniture kind-${f.kind}${tall ? " tall" : ""}${selected ? " is-selected" : ""}`}
      data-id={f.id}
    >
      <polygon points={pts(c)} />
      {tall && (
        <>
          <line className="x" x1={c[0].x} y1={c[0].y} x2={c[2].x} y2={c[2].y} />
          <line className="x" x1={c[1].x} y1={c[1].y} x2={c[3].x} y2={c[3].y} />
        </>
      )}
      {f.kind === "bed" && (
        <polygon
          className="pillow"
          points={pts(
            rectCorners(
              add(f.pos, rotateLocal({ x: 0, y: -f.d / 2 + 0.22 }, f.angle)),
              f.w * 0.8,
              0.28,
              f.angle,
            ),
          )}
        />
      )}
      {showText && (
        <text
          transform={`translate(${f.pos.x} ${f.pos.y}) rotate(${textDeg})`}
          fontSize={fontM}
          dy={fontM * 0.35}
        >
          {label}
        </text>
      )}
      {selected && (
        <circle className="handle rotate" cx={c[1].x + (c[1].x - c[0].x) * 0.001} cy={c[1].y} r={0.09} />
      )}
    </g>
  );
}

function rotateLocal(p: Vec2, a: number): Vec2 {
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

function FacadeMarks({ plan, info }: { plan: Plan; info: Map<string, OpeningInfo> }) {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  return (
    <g className="facade-marks">
      {plan.openings.map((o) => {
        const i = info.get(o.id);
        const w = walls.get(o.wallId);
        if (!i || !w || !i.exterior || i.cp === undefined) return null;
        const span = openingSpan(w, o);
        const out = { x: -i.nx, y: -i.ny };
        const p = add(span.center, scale(out, w.thickness / 2 + 0.42));
        const pos = i.cp >= 0;
        const r = 0.12 + Math.min(0.1, Math.abs(i.cp) * 0.12);
        return (
          <g key={o.id} className={`facade ${pos ? "push" : "pull"}`} transform={`translate(${p.x} ${p.y})`}>
            <circle r={r} />
            <line x1={-r * 0.5} y1={0} x2={r * 0.5} y2={0} />
            {pos && <line x1={0} y1={-r * 0.5} x2={0} y2={r * 0.5} />}
          </g>
        );
      })}
    </g>
  );
}

function PreviewShape({ p }: { p: Preview }) {
  switch (p.kind) {
    case "wall": {
      const L = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
      const mid = { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 };
      return (
        <g className="preview">
          <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} className="preview-wall" />
          <circle cx={p.a.x} cy={p.a.y} r={0.06} />
          <circle cx={p.b.x} cy={p.b.y} r={0.06} />
          {L > 0.2 && (
            <text x={mid.x} y={mid.y - 0.18} fontSize={0.22} className="dim">
              {L.toFixed(2)} m
            </text>
          )}
        </g>
      );
    }
    case "opening": {
      const d = wallDir(p.wall);
      const c = add(p.wall.a, scale(d, p.offset));
      const a = add(c, scale(d, -p.width / 2));
      const b = add(c, scale(d, p.width / 2));
      return (
        <g className="preview">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="preview-opening" />
        </g>
      );
    }
    case "fan":
      return (
        <g
          className="preview"
          transform={`translate(${p.pos.x} ${p.pos.y}) rotate(${(p.angle * 180) / Math.PI})`}
        >
          <rect x={-0.13} y={-0.25} width={0.26} height={0.5} />
          <line x1={0.2} y1={0} x2={0.9} y2={0} />
        </g>
      );
    case "point":
      return <circle className="preview-point" cx={p.p.x} cy={p.p.y} r={0.07} />;
  }
}

export const PlanDrawing = memo(function PlanDrawing({ plan, selection, info, pxPerM, preview }: Props) {
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  const openingsByWall = new Map<string, Opening[]>();
  for (const o of plan.openings) {
    const list = openingsByWall.get(o.wallId) ?? [];
    list.push(o);
    openingsByWall.set(o.wallId, list);
  }
  const sel = (kind: Selection["kind"], id: string) => selection?.kind === kind && selection.id === id;
  const b = planBounds(plan);
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  return (
    <g className="plan-drawing">
      <defs>
        <pattern
          id="hatch"
          patternUnits="userSpaceOnUse"
          width={0.16}
          height={0.16}
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={0.16} className="hatch-line" />
        </pattern>
      </defs>
      {plan.walls
        .filter((w) => w.kind === "party")
        .map((w) => {
          const mid = scale(add(w.a, w.b), 0.5);
          return <NeighbourMass key={`nm-${w.id}`} w={w} inward={norm2(sub(center, mid))} />;
        })}
      {plan.furniture.map((f) => (
        <FurnitureShape key={f.id} f={f} selected={sel("furniture", f.id)} pxPerM={pxPerM} />
      ))}
      {plan.walls.map((w) => (
        <WallShape key={w.id} w={w} openings={openingsByWall.get(w.id) ?? []} selected={sel("wall", w.id)} />
      ))}
      {plan.openings.map((o) => {
        const w = walls.get(o.wallId);
        if (!w) return null;
        return o.kind === "window" ? (
          <WindowSymbol key={o.id} w={w} o={o} info={info.get(o.id)} selected={sel("opening", o.id)} />
        ) : (
          <DoorSymbol key={o.id} w={w} o={o} selected={sel("opening", o.id)} />
        );
      })}
      <FacadeMarks plan={plan} info={info} />
      {plan.fans.map((f) => (
        <FanSymbol key={f.id} f={f} selected={sel("fan", f.id)} />
      ))}
      {preview && <PreviewShape p={preview} />}
    </g>
  );
});

function norm2(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}
