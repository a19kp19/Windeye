import type { Bounds } from "../../model/geometry";
import type { Vec2 } from "../../model/types";

/** screen = plan · scale + (ox, oy), in CSS pixels. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export const toScreen = (v: View, p: Vec2): Vec2 => ({ x: p.x * v.scale + v.ox, y: p.y * v.scale + v.oy });
export const toPlan = (v: View, s: Vec2): Vec2 => ({ x: (s.x - v.ox) / v.scale, y: (s.y - v.oy) / v.scale });

export function fitView(b: Bounds, width: number, height: number, pad = 56): View {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const scale = Math.max(8, Math.min((width - 2 * pad) / w, (height - 2 * pad) / h, 140));
  return {
    scale,
    ox: (width - w * scale) / 2 - b.minX * scale,
    oy: (height - h * scale) / 2 - b.minY * scale,
  };
}

export function zoomAt(v: View, s: Vec2, factor: number): View {
  const scale = Math.max(6, Math.min(420, v.scale * factor));
  const k = scale / v.scale;
  return { scale, ox: s.x - (s.x - v.ox) * k, oy: s.y - (s.y - v.oy) * k };
}
