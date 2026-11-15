/**
 * Steel Chair's chair, as flat rectangles (docs/plans/2026-11-15-steel-chair-plan.md, Task 4). Pure TypeScript: no DOM, no clock. The effect
 * draws each piece as a `div` inside a `transform-style: preserve-3d` group (steel-chair.css), so the chair turns in real perspective, and
 * the body (body.ts) moves the group; this file only says what the group is made of at a given fold.
 *
 * The chair's frame: x right, y down, z toward the reader, the origin at the center of the folded 46 by 90 by 8 box the body simulates.
 * A piece's own rectangle is centered on that origin, so the effect places it with `left`/`top` (the negative half of its size) and its
 * `matrix` (column-major, the 16 numbers `matrix3d()` takes) moves it into the chair's frame; the default `transform-origin` (the center)
 * is then the chair's origin, which is what the matrix assumes.
 *
 * Open (`fold = 1`) the seat stands 88 degrees from the back frame and the rear legs' frame -32 degrees, both turned about the hinge line
 * across the back frame; shut (`fold = 0`) every piece lies in the back frame's plane, the little z offsets below keep the layers from
 * fighting and keep the whole inside the box's 8 px of thickness. A tube is two thin strips crossed at right angles, so it does not
 * vanish when seen edge-on.
 */

/** A column-major 4 by 4, 16 numbers: what `matrix3d()` and `DOMMatrix` take. */
export type Matrix = number[];

export interface Piece {
  /** `back`, `backrest`, `seat`, `rear`, or a tube strip's name (`back-leg-left-a` and so on). */
  name: string;
  /** `frame` is a bordered box with no bottom edge, `panel` a plain rectangle, `tube` one strip of a tube. */
  kind: 'frame' | 'panel' | 'tube';
  width: number;
  height: number;
  /** The CSS offsets that center the rectangle on the piece's origin: minus half its size. */
  left: number;
  top: number;
  matrix: Matrix;
  /** The unit normal the rectangle faces, in the chair's frame, for `shadeOf`. */
  normal: [number, number, number];
}

/** The folded chair's box, the one the body simulates. */
export const BOX = { width: 46, height: 90, depth: 8 } as const;

/** The hinge line's height in the chair's frame: the rear frame (58 tall) hangs from it down to the box's bottom. */
const HINGE_Y = BOX.height / 2 - 58;
const SEAT_OPEN = 88;
const REAR_OPEN = -32;
const TUBE = 3;

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
const translate = (x: number, y: number, z: number): Matrix => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
function rotateX(deg: number): Matrix {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
function rotateY(deg: number): Matrix {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function piece(name: string, kind: Piece['kind'], width: number, height: number, matrix: Matrix): Piece {
  /* The rectangle's normal is its local z axis through the matrix: the third column. The matrices here are rotations and translations. */
  const [x, y, z] = [matrix[8], matrix[9], matrix[10]];
  const len = Math.hypot(x, y, z) || 1;
  return { name, kind, width, height, left: -width / 2, top: -height / 2, matrix, normal: [x / len, y / len, z / len] };
}

/** One tube: two strips of `TUBE` by `length`, the second turned 90 degrees about its long axis. */
function tube(name: string, length: number, at: Matrix): Piece[] {
  return [piece(`${name}-a`, 'tube', TUBE, length, at), piece(`${name}-b`, 'tube', TUBE, length, mul(at, rotateY(90)))];
}

/**
 * The chair's pieces at `fold` (0 shut, 1 open; between is a hinge part way). The back frame and its backrest stay in the chair's frame;
 * the seat and the rear frame hang from the hinge line and turn with `fold`.
 */
export function piecesOf(fold: number): Piece[] {
  const f = Math.min(1, Math.max(0, fold));
  const hinge = (deg: number) => mul(translate(0, HINGE_Y, 0), rotateX(deg * f));
  const seatAt = mul(hinge(SEAT_OPEN), translate(0, 19, 2));
  const rearAt = mul(hinge(REAR_OPEN), translate(0, 29, -2));
  const legX = BOX.width / 2 - TUBE / 2;
  const rearX = 42 / 2 - TUBE / 2;
  return [
    piece('back', 'frame', BOX.width, BOX.height, IDENTITY),
    piece('backrest', 'panel', 42, 26, translate(0, -BOX.height / 2 + 13, 1)),
    piece('seat', 'panel', 42, 38, seatAt),
    piece('rear', 'frame', 42, 58, rearAt),
    ...tube('back-leg-left', BOX.height, translate(-legX, 0, 0)),
    ...tube('back-leg-right', BOX.height, translate(legX, 0, 0)),
    ...tube('rear-leg-left', 58, mul(rearAt, translate(-rearX, 0, 0))),
    ...tube('rear-leg-right', 58, mul(rearAt, translate(rearX, 0, 0))),
  ];
}

/**
 * A piece's steel gray from the angle it faces, lit from above and in front: `150 + 70·|n.z| − 40·n.y`, clamped to 60 to 235, with a
 * little blue. Up is negative y, so a face turned up is lighter; the absolute value of z makes the back of a piece as bright as its front.
 */
export function shadeOf(normal: readonly [number, number, number]): string {
  const b = Math.round(Math.min(235, Math.max(60, 150 + 70 * Math.abs(normal[2]) - 40 * normal[1])));
  return `rgb(${b}, ${b + 6}, ${b + 16})`;
}
