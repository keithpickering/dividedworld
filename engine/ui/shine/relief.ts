/**
 * The relief's light: engine code that names no card, pack or instance. It lights a relief, a picture of which way each
 * bit of a surface faces, with one moving light, and writes the highlight as pixels (docs/plans/2026-11-12-booster-pack-render-design.md
 * sections 2 and 7; the formula is the `draw` function of docs/research/2026-11-12-booster-pack-bench/01-bench.html).
 *
 * Units: `normals` and `tint` are 8-bit RGBA, `w * h` pixels row by row, top row first. A decoded normal is a unit vector
 * with x to the right, y DOWN the screen (as a `Light`'s is) and z toward the viewer. A light is in a `Light`'s units, -1..1
 * across the pack; the pack's pixels run x in -1..1 and y in -h/w..h/w. No DOM, no canvas; `lightRelief` allocates nothing.
 */
import type { Light } from './band.ts';

export type Relief = {
  readonly w: number;
  readonly h: number;
  /** `w * h * 3` floats: each pixel's unit normal. */
  readonly normals: Float32Array;
  /** `w * h * 3` 8-bit channels: each pixel's highlight color. */
  readonly color: Uint8ClampedArray;
  /** `w * h` alphas, 0..1: the relief's own. */
  readonly alpha: Float32Array;
};

/** A decoded normal shorter than this (about three 8-bit steps from the zero vector) has no direction and faces the viewer. */
const ZERO = 0.03;
const LIGHT_Z = 0.9;

/** Decode `normals` (and `tint`, or white) once; green's sign is turned so y runs down the screen. */
export function makeRelief(normals: Uint8ClampedArray, tint: Uint8ClampedArray | null, w: number, h: number): Relief {
  const n = w * h;
  const nrm = new Float32Array(n * 3);
  const color = new Uint8ClampedArray(n * 3);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const x = normals[j]! / 127.5 - 1;
    const y = 1 - normals[j + 1]! / 127.5;
    const z = normals[j + 2]! / 127.5 - 1;
    const len = Math.hypot(x, y, z);
    if (len < ZERO) {
      nrm[i * 3 + 2] = 1;
    } else {
      nrm[i * 3] = x / len;
      nrm[i * 3 + 1] = y / len;
      nrm[i * 3 + 2] = z / len;
    }
    alpha[i] = normals[j + 3]! / 255;
    for (let k = 0; k < 3; k++) color[i * 3 + k] = tint ? Math.min(255, tint[j + k]! * 0.6 + 120) : 255;
  }
  return { w, h, normals: nrm, color, alpha };
}

/** Write the highlight of `light` into `out` (`w * h` RGBA); rows outside `rows` are written transparent. */
export function lightRelief(relief: Relief, light: Light, out: Uint8ClampedArray, rows?: { top: number; bottom: number }): void {
  const { w, h, normals, color, alpha } = relief;
  const top = rows ? Math.max(0, rows.top) : 0;
  const bottom = rows ? Math.min(h, rows.bottom) : h;
  const aspect = h / w;
  const lx = light.x * 1.3;
  const ly = light.y * 1.3 * aspect;
  out.fill(0, 0, top * w * 4);
  out.fill(0, Math.max(top, bottom) * w * 4, w * h * 4);
  for (let r = top; r < bottom; r++) {
    const py = (2 * r / h - 1) * aspect;
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const o = i * 4;
      const a = alpha[i]!;
      if (a === 0) {
        out[o + 3] = 0;
        continue;
      }
      const px = 2 * c / w - 1;
      let dx = lx - px, dy = ly - py, dz = LIGHT_Z;
      let l = 1 / Math.hypot(dx, dy, dz);
      dx *= l; dy *= l; dz *= l;
      let hx = dx, hy = dy, hz = dz + 1;
      l = 1 / Math.hypot(hx, hy, hz);
      hx *= l; hy *= l; hz *= l;
      let s = normals[i * 3]! * hx + normals[i * 3 + 1]! * hy + normals[i * 3 + 2]! * hz;
      s = s > 0 ? s : 0;
      let s2 = s * s; s2 *= s2; s2 *= s2; s2 *= s2; // s^16
      const spec = s2 * s2 * s2 * 0.9 + s2 * 0.12; // s^48 and a broad s^16
      out[o] = color[i * 3]!;
      out[o + 1] = color[i * 3 + 1]!;
      out[o + 2] = color[i * 3 + 2]!;
      out[o + 3] = (spec > 1 ? 1 : spec) * a * 255;
    }
  }
}
