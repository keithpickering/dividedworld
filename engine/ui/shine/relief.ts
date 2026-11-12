/**
 * The relief's light: engine code that names no card, pack or instance. It lights a relief, a picture of which way each
 * bit of a surface faces, with one moving light, and writes the highlight as pixels (docs/plans/2026-11-12-booster-pack-render-design.md
 * sections 2 and 7; the formula is the `draw` function of docs/research/2026-11-12-booster-pack-bench/01-bench.html).
 *
 * Units: `normals` and `tint` are 8-bit RGBA, `w * h` pixels row by row, top row first. A decoded normal is a unit vector
 * with x to the right, y DOWN the screen (as a `Light`'s is) and z toward the viewer. A light is in a `Light`'s units, -1..1
 * across the pack; the pack's pixels run x in -1..1 and y in -h/w..h/w. No DOM, no canvas; `lightRelief` allocates nothing.
 * A pixel that is transparent (the relief's alpha 0) is written as four zeros; a pixel too dim to reach half a level of alpha
 * keeps its color and gets alpha 0.
 */
import { LIGHT_SCALE, type Light } from './band.ts';

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

/** The highlight's two lobes, a tight s^48 and a broad s^16, for s = the normal's dot with the half vector. */
const specular = (s: number): number => {
  let s2 = s * s; s2 *= s2; s2 *= s2; s2 *= s2; // s^16
  return s2 * s2 * s2 * 0.9 + s2 * 0.12;
};
/**
 * Below this s the highlight cannot reach half a level of alpha even at relief alpha 1 (the lobes only grow with s), so the
 * power chain is skipped. Found once by bisection, then a hair lower so rounding can never skip a pixel that would show.
 */
const S_MIN = (() => {
  let lo = 0, hi = 1;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (specular(mid) * 255 < 0.5) lo = mid; else hi = mid;
  }
  return lo * 0.9999;
})();

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

/**
 * Write the highlight of `light` into `out`, which is `w * h * 4` bytes (RGBA); rows outside `rows` are written as four
 * zeros. `rows.top` is floored and `rows.bottom` ceiled, both clamped to 0..h, so a fractional bound still draws the rows
 * it touches.
 */
export function lightRelief(relief: Relief, light: Light, out: Uint8ClampedArray, rows?: { top: number; bottom: number }): void {
  const { w, h, normals, color, alpha } = relief;
  const top = rows ? Math.max(0, Math.floor(rows.top)) : 0;
  const bottom = rows ? Math.min(h, Math.ceil(rows.bottom)) : h;
  out.fill(0, 0, top * w * 4);
  out.fill(0, Math.max(top, bottom) * w * 4, w * h * 4);
  const aspect = h / w;
  const colStep = 2 / w;
  const lx = light.x * LIGHT_SCALE + 1; // the light's x less a pixel's x of 2 * c / w - 1 is this less c * colStep
  const ly = light.y * LIGHT_SCALE * aspect;
  const rowStep = 2 / h * aspect;
  const zz = LIGHT_Z * LIGHT_Z;
  for (let r = top; r < bottom; r++) {
    const dy = ly - (r * rowStep - aspect);
    const rest = dy * dy + zz; // everything of the light's distance that does not change along the row
    let i = r * w, o = i * 4, n = i * 3;
    for (let c = 0; c < w; c++, i++, o += 4, n += 3) {
      const a = alpha[i]!;
      if (a === 0) {
        out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
        continue;
      }
      const dx = lx - c * colStep;
      const l = 1 / Math.sqrt(dx * dx + rest); // 1 / the light's distance; its unit direction is (dx, dy, LIGHT_Z) * l
      // The half vector is that direction plus (0, 0, 1), whose length squared is 2 (1 + LIGHT_Z * l).
      const dl = LIGHT_Z * l;
      const s = (l * (normals[n]! * dx + normals[n + 1]! * dy) + normals[n + 2]! * (dl + 1)) / Math.sqrt(2 * (1 + dl));
      out[o] = color[n]!;
      out[o + 1] = color[n + 1]!;
      out[o + 2] = color[n + 2]!;
      if (s <= S_MIN) {
        out[o + 3] = 0;
        continue;
      }
      const spec = specular(s);
      out[o + 3] = (spec > 1 ? 1 : spec) * a * 255;
    }
  }
}
