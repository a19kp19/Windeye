import type { RasterSummary } from "../sim/protocol";
import type { Layer } from "../state/store";
import { ageColor, breezeColor, freshColor } from "./palette";

/** Paint one wash layer into an ImageData the size of the lattice (walls/outdoors transparent). */
export function paintField(
  img: ImageData,
  raster: RasterSummary,
  layer: Layer,
  data: { fresh: Float32Array | null; age: Float32Array | null; cooling: Float32Array | null },
  highlightRoom: number | null,
) {
  const px = img.data;
  const { room, solid } = raster;
  const n = room.length;
  const src =
    layer === "fresh" ? data.fresh : layer === "age" ? data.age : layer === "breeze" ? data.cooling : null;
  for (let c = 0; c < n; c++) {
    const o = c * 4;
    const r = room[c];
    if (layer === "none" || !src || solid[c] || r < 0) {
      px[o + 3] = 0;
      continue;
    }
    const v = src[c];
    const col = layer === "fresh" ? freshColor(v) : layer === "age" ? ageColor(v / 60) : breezeColor(v);
    const dim = highlightRoom !== null && r !== highlightRoom ? 0.35 : 1;
    px[o] = col[0];
    px[o + 1] = col[1];
    px[o + 2] = col[2];
    px[o + 3] = col[3] * dim;
  }
}
