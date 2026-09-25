import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dist, fromAngle, inRect, planBounds, rectCorners, snap, sub, wallDir } from "../../model/geometry";
import {
  addFan,
  addFurniture,
  addLabel,
  addOpening,
  addWall,
  moveVertex,
  nearestVertex,
  nearestWall,
  nextState,
  OPENING_DEFAULTS,
  openingAt,
  openingFits,
  updateFan,
  updateFurniture,
  updateOpening,
} from "../../model/ops";
import type { Plan, Vec2 } from "../../model/types";
import { paintField } from "../../render/field";
import { RULE } from "../../render/palette";
import { Streaks } from "../../render/streaks";
import type { RasterSummary } from "../../sim/protocol";
import { live } from "../../state/fields";
import { type Selection, useStore } from "../../state/store";
import { Inspector } from "../Inspector";
import { type OpeningInfo, PlanDrawing, type Preview } from "./PlanDrawing";
import { RoomTags } from "./RoomTags";
import { fitView, toPlan, toScreen, type View, zoomAt } from "./view";
import { WindBadge } from "./WindBadge";

type Drag =
  | { mode: "pan"; start: Vec2; view0: View; moved: boolean }
  | { mode: "vertex"; from: Vec2; key: string }
  | { mode: "fan"; id: string; grab: Vec2; key: string; moved: boolean; start: Vec2 }
  | { mode: "fanRotate"; id: string; key: string }
  | { mode: "furniture"; id: string; grab: Vec2; key: string }
  | { mode: "furnRotate"; id: string; key: string; base: number; start: number }
  | { mode: "opening"; id: string; grab: number; key: string; moved: boolean; start: Vec2 }
  | { mode: "fanPlace"; pos: Vec2; angle: number };

type Hit =
  | { kind: "vertex"; p: Vec2 }
  | { kind: "rotate"; sel: Selection }
  | { kind: "item"; sel: Selection };

const GRID = 0.05;

function fanTip(plan: Plan, id: string): Vec2 | null {
  const f = plan.fans.find((x) => x.id === id);
  if (!f) return null;
  const d = fromAngle(f.angle);
  const L = 0.2 + 0.55 + f.speed * 0.12 + 0.14;
  return { x: f.pos.x + d.x * L, y: f.pos.y + d.y * L };
}

function hitTest(plan: Plan, p: Vec2, tol: number, selection: Selection | null): Hit | null {
  if (selection?.kind === "fan") {
    const tip = fanTip(plan, selection.id);
    if (tip && dist(p, tip) < Math.max(tol, 0.14)) return { kind: "rotate", sel: selection };
  }
  if (selection?.kind === "furniture") {
    const f = plan.furniture.find((x) => x.id === selection.id);
    if (f && dist(p, rectCorners(f.pos, f.w, f.d, f.angle)[1]) < Math.max(tol, 0.14))
      return { kind: "rotate", sel: selection };
  }
  const v = nearestVertex(plan, p, tol * 1.1);
  if (v) return { kind: "vertex", p: v };
  const o = openingAt(plan, p, tol);
  if (o) return { kind: "item", sel: { kind: "opening", id: o.id } };
  for (const f of plan.fans) {
    if (inRect(p, f.pos, 0.26 + 2 * tol, f.size + 2 * tol, f.angle))
      return { kind: "item", sel: { kind: "fan", id: f.id } };
  }
  const w = nearestWall(plan, p, tol * 0.6);
  if (w) return { kind: "item", sel: { kind: "wall", id: w.wall.id } };
  for (let i = plan.furniture.length - 1; i >= 0; i--) {
    const f = plan.furniture[i];
    if (inRect(p, f.pos, f.w, f.d, f.angle)) return { kind: "item", sel: { kind: "furniture", id: f.id } };
  }
  return null;
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View, dpr: number, W: number, H: number) {
  const step = v.scale < 14 ? 5 : 1;
  const x0 = Math.floor(toPlan(v, { x: 0, y: 0 }).x / step) * step;
  const y0 = Math.floor(toPlan(v, { x: 0, y: 0 }).y / step) * step;
  const x1 = toPlan(v, { x: W, y: H }).x;
  const y1 = toPlan(v, { x: W, y: H }).y;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += step) {
    const sx = Math.round(x * v.scale + v.ox) + 0.5;
    ctx.strokeStyle = Math.round(x) % 5 === 0 ? "rgba(160,150,130,0.28)" : RULE;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, H);
    ctx.stroke();
  }
  for (let y = y0; y <= y1; y += step) {
    const sy = Math.round(y * v.scale + v.oy) + 0.5;
    ctx.strokeStyle = Math.round(y) % 5 === 0 ? "rgba(160,150,130,0.28)" : RULE;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(W, sy);
    ctx.stroke();
  }
  ctx.restore();
}

export function PlanCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const washRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const plan = useStore((s) => s.plan);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const layer = useStore((s) => s.layer);
  const streaksOn = useStore((s) => s.streaks);
  const running = useStore((s) => s.running);
  const fitSeq = useStore((s) => s.fitSeq);
  const hoverRoom = useStore((s) => s.hoverRoom);
  const rasterSeq = useStore((s) => s.rasterSeq);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ scale: 40, ox: 40, oy: 40 });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [cursor, setCursor] = useState("default");
  const viewRef = useRef(view);
  viewRef.current = view;
  const planRef = useRef(plan);
  planRef.current = plan;
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const streaksRef = useRef(streaksOn && running);
  streaksRef.current = streaksOn && running;
  const hoverRef = useRef(hoverRoom);
  hoverRef.current = hoverRoom;
  const drag = useRef<Drag | null>(null);
  const chain = useRef<Vec2 | null>(null);
  const space = useRef(false);
  const dragSeq = useRef(0);
  /** Once the user pans or zooms, stop auto-fitting on resize until the next explicit fit. */
  const userMoved = useRef(false);

  // Size tracking.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit on load, template change, and on resize until the user takes over the view.
  const lastFit = useRef(-1);
  useEffect(() => {
    if (!size.w || !size.h) return;
    if (lastFit.current !== fitSeq) userMoved.current = false;
    if (userMoved.current) return;
    lastFit.current = fitSeq;
    const b = planBounds(planRef.current);
    const pad = 1.6;
    setView(
      fitView(
        { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad },
        size.w,
        size.h,
        24,
      ),
    );
  }, [fitSeq, size.w, size.h]);

  // Animation loop: wash + streaks.
  useEffect(() => {
    const wash = washRef.current;
    const ink = inkRef.current;
    if (!wash || !ink || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    wash.width = ink.width = Math.round(size.w * dpr);
    wash.height = ink.height = Math.round(size.h * dpr);
    const wctx = wash.getContext("2d")!;
    const ictx = ink.getContext("2d")!;
    const streaks = new Streaks();
    let raster: RasterSummary | null = null;
    let off: HTMLCanvasElement | null = null;
    let octx: CanvasRenderingContext2D | null = null;
    let img: ImageData | null = null;
    let lastWash = -1e9;
    let lastKey = "";
    let last = performance.now();
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      let reset = false;
      if (live.raster !== raster) {
        raster = live.raster;
        reset = true;
        if (raster) {
          streaks.setRaster(raster);
          off = document.createElement("canvas");
          off.width = raster.grid.nx;
          off.height = raster.grid.ny;
          octx = off.getContext("2d");
          img = octx!.createImageData(raster.grid.nx, raster.grid.ny);
        }
      }
      const v = viewRef.current;
      const key = `${v.scale.toFixed(3)},${v.ox.toFixed(1)},${v.oy.toFixed(1)}`;
      const viewChanged = key !== lastKey;
      if (viewChanged || t - lastWash > 110 || reset) {
        lastWash = t;
        wctx.setTransform(1, 0, 0, 1, 0, 0);
        wctx.clearRect(0, 0, wash.width, wash.height);
        drawGrid(wctx, v, dpr, size.w, size.h);
        if (raster && off && octx && img) {
          paintField(img, raster, layerRef.current, live, hoverRef.current);
          octx.putImageData(img, 0, 0);
          const g = raster.grid;
          wctx.imageSmoothingEnabled = true;
          wctx.imageSmoothingQuality = "high";
          wctx.drawImage(
            off,
            (v.ox + g.x0 * v.scale) * dpr,
            (v.oy + g.y0 * v.scale) * dpr,
            g.nx * g.dx * v.scale * dpr,
            g.ny * g.dx * v.scale * dpr,
          );
        }
      }
      if (viewChanged || reset) {
        ictx.globalCompositeOperation = "source-over";
        ictx.clearRect(0, 0, ink.width, ink.height);
      } else {
        ictx.globalCompositeOperation = "destination-in";
        ictx.fillStyle = "rgba(0,0,0,0.9)";
        ictx.fillRect(0, 0, ink.width, ink.height);
        ictx.globalCompositeOperation = "source-over";
      }
      if (streaksRef.current && raster && live.ux && live.uy && live.ux.length === raster.solid.length) {
        streaks.step(dt, live.ux, live.uy);
        streaks.draw(ictx, { ...v, dpr }, live.fresh, live.ux);
      }
      lastKey = key;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h]);

  // Wheel zoom (non-passive so we can stop page scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
      userMoved.current = true;
      setView((v) => zoomAt(v, { x: e.clientX - r.left, y: e.clientY - r.top }, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard bits that need canvas state.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) space.current = true;
      if (e.key === "Escape") {
        chain.current = null;
        setPreview(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    if (tool !== "wall") chain.current = null;
    setPreview(null);
  }, [tool]);

  const local = useCallback((e: { clientX: number; clientY: number }): Vec2 => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const snapPoint = (p: Vec2, free: boolean, from: Vec2 | null, exclude?: Vec2): Vec2 => {
    const tol = 12 / viewRef.current.scale;
    const vtx = nearestVertex(planRef.current, p, tol);
    if (vtx && !(exclude && dist(vtx, exclude) < 1e-6)) return vtx;
    let q = { x: snap(p.x, GRID), y: snap(p.y, GRID) };
    if (from && !free) {
      const d = sub(q, from);
      q = Math.abs(d.x) >= Math.abs(d.y) ? { x: q.x, y: from.y } : { x: from.x, y: q.y };
    }
    return q;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    const s = local(e);
    const p = toPlan(viewRef.current, s);
    const tol = 9 / viewRef.current.scale;
    svgRef.current?.setPointerCapture(e.pointerId);
    const key = `d${++dragSeq.current}`;
    if (e.button === 1 || st.tool === "pan" || space.current) {
      drag.current = { mode: "pan", start: s, view0: viewRef.current, moved: false };
      return;
    }
    const plan0 = planRef.current;
    switch (st.tool) {
      case "select": {
        const hit = hitTest(plan0, p, tol, st.selection);
        if (!hit) {
          st.select(null);
          drag.current = { mode: "pan", start: s, view0: viewRef.current, moved: false };
          return;
        }
        if (hit.kind === "vertex") {
          drag.current = { mode: "vertex", from: hit.p, key };
          return;
        }
        if (hit.kind === "rotate") {
          if (hit.sel.kind === "fan") drag.current = { mode: "fanRotate", id: hit.sel.id, key };
          else {
            const f = plan0.furniture.find((x) => x.id === hit.sel.id)!;
            const a0 = Math.atan2(p.y - f.pos.y, p.x - f.pos.x);
            drag.current = { mode: "furnRotate", id: f.id, key, base: f.angle, start: a0 };
          }
          return;
        }
        st.select(hit.sel);
        if (hit.sel.kind === "fan") {
          const f = plan0.fans.find((x) => x.id === hit.sel.id)!;
          drag.current = { mode: "fan", id: f.id, grab: sub(p, f.pos), key, moved: false, start: s };
        } else if (hit.sel.kind === "furniture") {
          const f = plan0.furniture.find((x) => x.id === hit.sel.id)!;
          drag.current = { mode: "furniture", id: f.id, grab: sub(p, f.pos), key };
        } else if (hit.sel.kind === "opening") {
          const o = plan0.openings.find((x) => x.id === hit.sel.id)!;
          const w = plan0.walls.find((x) => x.id === o.wallId)!;
          const along = (p.x - w.a.x) * wallDir(w).x + (p.y - w.a.y) * wallDir(w).y;
          drag.current = { mode: "opening", id: o.id, grab: along - o.offset, key, moved: false, start: s };
        }
        return;
      }
      case "wall": {
        const q = snapPoint(p, e.shiftKey, chain.current);
        if (!chain.current) {
          chain.current = q;
          setPreview({ kind: "point", p: q });
          return;
        }
        const a = chain.current;
        if (dist(a, q) > 0.1) {
          const closes = nearestVertex(plan0, q, 1e-6) !== null && dist(a, q) > 0.1;
          const { plan: next, id } = addWall(plan0, a, q, st.wallKind);
          st.setPlan(() => next);
          st.select({ kind: "wall", id });
          chain.current = closes ? null : q;
          setPreview(closes ? null : { kind: "point", p: q });
        }
        return;
      }
      case "window":
      case "door": {
        const hitW = nearestWall(plan0, p, 0.45);
        if (!hitW) return;
        const res = addOpening(plan0, hitW.wall, st.tool, hitW.offset);
        if (res) {
          st.setPlan(() => res.plan);
          st.select({ kind: "opening", id: res.id });
        }
        return;
      }
      case "fan":
        drag.current = { mode: "fanPlace", pos: { x: snap(p.x, GRID), y: snap(p.y, GRID) }, angle: 0 };
        setPreview({ kind: "fan", pos: drag.current.pos, angle: 0 });
        return;
      case "furniture": {
        const { plan: next, id } = addFurniture(plan0, st.furnitureKind, {
          x: snap(p.x, GRID),
          y: snap(p.y, GRID),
        });
        st.setPlan(() => next);
        st.select({ kind: "furniture", id });
        st.setTool("select");
        st.select({ kind: "furniture", id });
        return;
      }
      case "label": {
        const { plan: next, id } = addLabel(plan0, p, "Room");
        st.setPlan(() => next);
        st.setTool("select");
        st.select({ kind: "label", id });
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    const s = local(e);
    const p = toPlan(viewRef.current, s);
    const d = drag.current;
    const plan0 = planRef.current;
    if (d) {
      switch (d.mode) {
        case "pan": {
          const dx = s.x - d.start.x;
          const dy = s.y - d.start.y;
          if (Math.hypot(dx, dy) > 2) {
            d.moved = true;
            userMoved.current = true;
          }
          setView({ ...d.view0, ox: d.view0.ox + dx, oy: d.view0.oy + dy });
          return;
        }
        case "vertex": {
          const q = snapPoint(p, true, null, d.from);
          if (dist(q, d.from) < 1e-6) return;
          const from = d.from;
          st.setPlan((pl) => moveVertex(pl, from, q), { coalesce: d.key });
          d.from = q;
          return;
        }
        case "fan": {
          if (Math.hypot(s.x - d.start.x, s.y - d.start.y) > 3) d.moved = true;
          if (!d.moved) return;
          const pos = { x: snap(p.x - d.grab.x, GRID), y: snap(p.y - d.grab.y, GRID) };
          st.setPlan((pl) => updateFan(pl, d.id, { pos }), { coalesce: d.key });
          return;
        }
        case "fanRotate": {
          const f = plan0.fans.find((x) => x.id === d.id);
          if (!f) return;
          let a = Math.atan2(p.y - f.pos.y, p.x - f.pos.x);
          if (!e.shiftKey) a = snap(a, Math.PI / 12);
          st.setPlan((pl) => updateFan(pl, d.id, { angle: a }), { coalesce: d.key });
          return;
        }
        case "furniture": {
          const pos = { x: snap(p.x - d.grab.x, GRID), y: snap(p.y - d.grab.y, GRID) };
          st.setPlan((pl) => updateFurniture(pl, d.id, { pos }), { coalesce: d.key });
          return;
        }
        case "furnRotate": {
          const f = plan0.furniture.find((x) => x.id === d.id);
          if (!f) return;
          let a = d.base + Math.atan2(p.y - f.pos.y, p.x - f.pos.x) - d.start;
          if (!e.shiftKey) a = snap(a, Math.PI / 12);
          st.setPlan((pl) => updateFurniture(pl, d.id, { angle: a }), { coalesce: d.key });
          return;
        }
        case "opening": {
          if (Math.hypot(s.x - d.start.x, s.y - d.start.y) > 4) d.moved = true;
          if (!d.moved) return;
          const o = plan0.openings.find((x) => x.id === d.id);
          const w = o && plan0.walls.find((x) => x.id === o.wallId);
          if (!o || !w) return;
          const dir = wallDir(w);
          const along = (p.x - w.a.x) * dir.x + (p.y - w.a.y) * dir.y;
          const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
          const off = Math.min(
            L - o.width / 2 - 0.05,
            Math.max(o.width / 2 + 0.05, snap(along - d.grab, GRID)),
          );
          if (openingFits(plan0, w.id, off, o.width, o.id))
            st.setPlan((pl) => updateOpening(pl, d.id, { offset: off }), { coalesce: d.key });
          return;
        }
        case "fanPlace": {
          const v = sub(p, d.pos);
          if (Math.hypot(v.x, v.y) > 0.15)
            d.angle = e.shiftKey ? Math.atan2(v.y, v.x) : snap(Math.atan2(v.y, v.x), Math.PI / 12);
          setPreview({ kind: "fan", pos: d.pos, angle: d.angle });
          return;
        }
      }
    }
    // Hover feedback.
    const tol = 9 / viewRef.current.scale;
    switch (st.tool) {
      case "select": {
        const hit = hitTest(plan0, p, tol, st.selection);
        setCursor(
          !hit
            ? "grab"
            : hit.kind === "vertex"
              ? "move"
              : hit.kind === "rotate"
                ? "alias"
                : hit.sel.kind === "opening"
                  ? "pointer"
                  : "move",
        );
        return;
      }
      case "wall": {
        const q = snapPoint(p, e.shiftKey, chain.current);
        setCursor("crosshair");
        setPreview(chain.current ? { kind: "wall", a: chain.current, b: q } : { kind: "point", p: q });
        return;
      }
      case "window":
      case "door": {
        const hitW = nearestWall(plan0, p, 0.45);
        setCursor(hitW ? "copy" : "not-allowed");
        setPreview(
          hitW
            ? {
                kind: "opening",
                wall: hitW.wall,
                offset: hitW.offset,
                width: OPENING_DEFAULTS[st.tool].width,
                opening: st.tool,
              }
            : null,
        );
        return;
      }
      case "fan":
        setCursor("crosshair");
        setPreview({ kind: "fan", pos: { x: snap(p.x, GRID), y: snap(p.y, GRID) }, angle: 0 });
        return;
      default:
        setCursor(st.tool === "pan" ? "grab" : "crosshair");
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    const d = drag.current;
    drag.current = null;
    svgRef.current?.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.mode === "opening" && !d.moved) {
      const o = planRef.current.openings.find((x) => x.id === d.id);
      if (o) st.setPlan((pl) => updateOpening(pl, o.id, { state: nextState(o) }));
    } else if (d.mode === "fanPlace") {
      const { plan: next, id } = addFan(planRef.current, d.pos, d.angle);
      st.setPlan(() => next);
      st.setTool("select");
      st.select({ kind: "fan", id });
      setPreview(null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    if (st.tool === "wall") {
      chain.current = null;
      setPreview(null);
      return;
    }
    if (st.tool !== "select") return;
    const p = toPlan(viewRef.current, local(e));
    const hit = hitTest(planRef.current, p, 9 / viewRef.current.scale, null);
    if (hit?.kind === "item" && hit.sel.kind === "fan") {
      const f = planRef.current.fans.find((x) => x.id === hit.sel.id);
      if (f) st.setPlan((pl) => updateFan(pl, f.id, { on: !f.on }));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: live.raster is mutable; rasterSeq/plan mark when it changed
  const info = useMemo(() => {
    const m = new Map<string, OpeningInfo>();
    const r = live.raster;
    if (!r) return m;
    const cps = new Map(r.facades.map((f) => [f.id, f.cp]));
    for (const o of r.openings) m.set(o.id, { nx: o.nx, ny: o.ny, exterior: o.exterior, cp: cps.get(o.id) });
    return m;
  }, [rasterSeq, plan]);

  const transform = `translate(${view.ox} ${view.oy}) scale(${view.scale})`;
  return (
    <div className="plan-host" ref={host} data-testid="plan-canvas">
      <canvas className="layer wash" ref={washRef} style={{ width: size.w, height: size.h }} />
      <canvas className="layer ink" ref={inkRef} style={{ width: size.w, height: size.h }} />
      <svg
        ref={svgRef}
        className={`layer plan tool-${tool}`}
        width={size.w}
        height={size.h}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => !drag.current && tool !== "wall" && setPreview(null)}
        onDoubleClick={onDoubleClick}
        role="application"
        aria-label="Floor plan editor"
      >
        <g transform={transform}>
          <PlanDrawing plan={plan} selection={selection} info={info} pxPerM={view.scale} preview={preview} />
        </g>
        <WindBadge plan={plan} view={view} width={size.w} height={size.h} />
      </svg>
      <RoomTags view={view} />
      <Inspector />
      <ScaleBar view={view} />
    </div>
  );
}

function ScaleBar({ view }: { view: View }) {
  const candidates = [0.5, 1, 2, 5, 10];
  const unit = candidates.find((c) => c * view.scale >= 60) ?? 10;
  const px = unit * view.scale;
  const origin = toScreen(view, { x: 0, y: 0 });
  void origin;
  return (
    <div className="scalebar" aria-hidden>
      <div className="scalebar-bar" style={{ width: px * 2 }}>
        <span style={{ width: px }} />
        <span style={{ width: px }} />
      </div>
      <div className="scalebar-labels" style={{ width: px * 2 }}>
        <span>0</span>
        <span>{unit}</span>
        <span>{unit * 2} m</span>
      </div>
    </div>
  );
}
