import { useEffect, useRef } from "react";

export interface ThumbData {
  nx: number;
  ny: number;
  speed: Uint8Array;
  solid: Uint8Array;
  room: Int16Array;
}

/** Small-multiple rendering of a coarse run: walls in ink, indoor air speed as a blue wash. */
export function Thumb({ data, width = 132 }: { data: ThumbData; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const { nx, ny, speed, solid, room } = data;
    cv.width = nx;
    cv.height = ny;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(nx, ny);
    for (let c = 0; c < nx * ny; c++) {
      const o = c * 4;
      let r = 247;
      let g = 243;
      let b = 236;
      if (solid[c]) {
        r = 27;
        g = 28;
        b = 31;
      } else if (room[c] >= 0) {
        const t = Math.min(1, speed[c] / 255) ** 0.7;
        r = 240 - 206 * t;
        g = 232 - 166 * t;
        b = 214 - 9 * t;
      }
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [data]);
  return (
    <canvas ref={ref} className="thumb" style={{ width, height: (width * data.ny) / data.nx }} aria-hidden />
  );
}
