/**
 * Steel Chair's chair, as flat rectangles (docs/plans/2026-11-15-steel-chair-plan.md, Task 4), and how the world is drawn. Pure TypeScript: no
 * DOM, no clock. The effect draws each piece as a `div` inside a `transform-style: preserve-3d` group (steel-chair.css), so the chair turns in
 * a mild perspective of its own, and the body (body.ts) moves the group; this file says what the group is made of at a given fold, and where
 * a point of the world is drawn.
 *
 * The view is oblique, the way a 2D game shows a floor from above, and not a perspective of the whole layer: a point of the world at
 * (x, y, z) (z toward the reader) is drawn at x' = x, y' = y - K (Z_FRONT - z). So the side walls are drawn exactly on the content area's
 * left and right borders at every depth, a point of the floor at the front (z = Z_FRONT) is drawn on its bottom border, and the floor
 * recedes UP the screen, by at most the room under the words (ROOM, 28 px), so a resting chair is always drawn inside the content area.
 * A layer-wide perspective could not give that: whatever is near the reader is projected down and outward, past the borders.
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

import { DEPTH, HALF } from './body.ts';

/** A column-major 4 by 4, 16 numbers: what `matrix3d()` and `DOMMatrix` take. */
export type Matrix = [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number,
];

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
  const out: Matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
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
  const x = matrix[8], y = matrix[9], z = matrix[10];
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

/* ---------- the oblique projection ---------- */

/** The room above the content area's bottom border that a chair lying flat at the very back is lifted into: the floor's room (steel-chair.css). */
export const ROOM = 28;
/**
 * How far past `DEPTH` a chair's middle may go before the glass's spring (body.ts `GLASS_SPRING`, not exported) has pushed it back, px. The
 * rests measure at most about 6; 12 leaves room for the overshoot of a hard landing, and chair.test.ts proves over 200 seeded rests that no
 * corner passes `Z_FRONT`.
 */
export const GIVE = 12;
/** The reach of the folded box from its center: no corner of a chair is farther than this from it (body.ts `RADIUS`, not exported). */
const CHAIR_REACH = Math.hypot(...HALF);
/** The largest z any corner of a chair can reach: the glass, its give, and the chair's reach. A floor point at this depth is drawn on the border. */
export const Z_FRONT = DEPTH + GIVE + CHAIR_REACH;
/**
 * The px a point is drawn higher for each px it lies farther back. Chosen so that a chair lying flat at the very back (its middle at
 * -(DEPTH + GIVE)) has its lowest point lifted by at most ROOM, turned any way about the vertical: the worst is its short side, 46, along z,
 * which puts its front edge only 23 (HALF[0]) forward of its middle; with its long side along z the front edge is 45 forward and the lift less.
 */
export const K = ROOM / (Z_FRONT - (-(DEPTH + GIVE) + HALF[0]));

/** Where a point of the world is drawn, in the content area's px. */
export function project(p: { x: number; y: number; z: number }): { x: number; y: number } {
  return { x: p.x, y: p.y - K * (Z_FRONT - p.z) };
}

/** The distance of each chair's own perspective, px. Mild, so a chair foreshortens a little as it turns; far, so it moves a corner little. */
export const PERSPECTIVE = 1500;
/**
 * The most the chair's own perspective moves any corner from its oblique projection, px. A corner at depth c from the chair's center, with
 * the center-relative offset after the shear at most sqrt(R² - c²) + K·c across, moves by that offset times (1/(1 - c/D) - 1) = c/(D - c);
 * with c at most R (the reach) that is at most R²(1/2 + K)/(D - R), since c·sqrt(R² - c²) is at most R²/2 and K·c² at most K·R².
 */
export const REACH = (CHAIR_REACH * CHAIR_REACH * (0.5 + K)) / (PERSPECTIVE - CHAIR_REACH);
/**
 * How far the world the body simulates is drawn inside the content area's borders, px, so that the chair's own perspective cannot draw a corner
 * past one: the effect makes the world `2·INSET` narrower and `INSET` shorter than the content area, draws it `INSET` to the right, and a
 * corner on a wall or the floor is then drawn at most REACH from it, which is at most INSET. The walls and floor are the borders to within this.
 */
export const INSET = REACH;

/**
 * Where a corner of a chair is drawn, the whole picture: `corner` is a point of the world on the chair whose middle is `centre`. The
 * middle is drawn at its projection; the chair's offset from it is sheared by the oblique view and foreshortened by the chair's own
 * perspective (about its middle). `transformOf` is this as a CSS transform.
 */
export function drawn(corner: readonly [number, number, number], centre: { x: number; y: number; z: number }): { x: number; y: number } {
  const [a, b, c] = [corner[0] - centre.x, corner[1] - centre.y, corner[2] - centre.z];
  const w = 1 - c / PERSPECTIVE;
  const mid = project(centre);
  return { x: mid.x + a / w, y: mid.y + (b + K * c) / w };
}

/**
 * The group's CSS transform: its middle to the projection of its position, then (about that middle) the chair's own perspective, the
 * oblique shear (y gains K per px of z), the scale and the rotation (a column-major matrix3d's 16 numbers). The scale is in all three
 * axes, so a chair coming in at 2.2 times is as large in depth as across.
 */
export function transformOf(position: { x: number; y: number; z: number }, scale: number, rotation: readonly number[]): string {
  const at = project(position);
  const n = (v: number) => v.toFixed(5);
  return `translate3d(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px, 0px) perspective(${PERSPECTIVE}px) matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, ${n(K)}, 1, 0, 0, 0, 0, 1) scale3d(${scale.toFixed(3)}, ${scale.toFixed(3)}, ${scale.toFixed(3)}) matrix3d(${rotation.map(n).join(', ')})`;
}

/**
 * A chair's paint order among the chairs: groups are siblings that are each a stacking context, so a nearer one must be given a
 * larger `z-index`. The depth of its middle in tenths of a px, shifted to be non-negative.
 */
export function depthOf(z: number): number {
  return Math.round((z + Z_FRONT) * 10);
}
