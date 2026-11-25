/**
 * Steel Chair's chair, as flat rectangles (docs/plans/2026-11-15-steel-chair-plan.md, Task 4), and how the world is drawn. Pure TypeScript: no
 * DOM, no clock. The effect draws each piece as a `div` inside a `transform-style: preserve-3d` group (steel-chair.css), so the chair turns in
 * a mild perspective of its own, and the body (body.ts) moves the group; this file says what the group is made of at a given fold, and where
 * a point of the world is drawn.
 *
 * The view is oblique, the way a 2D game shows a floor from above, and not a perspective of the whole layer: a point of the world at
 * (x, y, z) (z toward the reader) is drawn at x' = x, y' = y - K (Z_FRONT - z). So the side walls are drawn exactly on the content area's
 * left and right borders at every depth, a point of the floor at the front (z = Z_FRONT) is drawn on its bottom border, and the floor
 * recedes UP the screen, by at most the floor's depth (FLOOR_DEPTH, 28 px), so a resting chair is always drawn inside the content area.
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

import { DEPTH, HALF, SHAPES } from './body.ts';
import type { ThrownObject } from './objects.ts';

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
  /** The color `shadeOf` tints instead of steel gray: an `[r, g, b]` as the piece looks lit full on. The extinguisher's red, the can's galvanized gray, the ladder's aluminum. */
  color?: readonly [number, number, number];
  /** A CSS `clip-path` shape (`polygon(...)`, `circle(...)`): a 12-gon cap is a rectangle clipped to its twelve corners. */
  clip?: string;
  /** The can's lid and its handle: the pieces its arc moves (Task 6 of the objects plan); `canPiecesOf(false)` leaves them out. */
  lid?: true;
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

type Extras = Pick<Piece, 'color' | 'clip' | 'lid'>;
function rotateZ(deg: number): Matrix {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function piece(name: string, kind: Piece['kind'], width: number, height: number, matrix: Matrix, extras: Extras = {}): Piece {
  /* The rectangle's normal is its local z axis through the matrix: the third column. The matrices here are rotations and translations. */
  const x = matrix[8], y = matrix[9], z = matrix[10];
  const len = Math.hypot(x, y, z) || 1;
  return { name, kind, width, height, left: -width / 2, top: -height / 2, matrix, normal: [x / len, y / len, z / len], ...extras };
}

/** One tube: two strips of `thick` (the chair's `TUBE`) by `length`, the second turned 90 degrees about its long axis. */
function tube(name: string, length: number, at: Matrix, extras: Extras = {}, thick: number = TUBE): Piece[] {
  return [piece(`${name}-a`, 'tube', thick, length, at, extras), piece(`${name}-b`, 'tube', thick, length, mul(at, rotateY(90)), extras)];
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

/* ---------- the ladder ---------- */

const LADDER_HALF = [15, 48, 3] as const;
const ALUMINUM: Piece['color'] = [214, 222, 232];
const GALVANIZED: Piece['color'] = [184, 190, 194];
const GALVANIZED_DARK: Piece['color'] = [118, 124, 130];
const RED: Piece['color'] = [196, 30, 28];
const BLACK: Piece['color'] = [44, 44, 48];

/**
 * The ladder's pieces at `fold` (0 shut, 1 open), a three-step A-frame: the front frame (two rails, a tube down each and three treads
 * between them) stays in the ladder's frame, and the rear frame and the spreader hang from the hinge at the top and turn with `fold`. The
 * spreader is the brace between the frames: shut it lies along the rails, open it turns across, from one frame to the other. Shut, every
 * piece fits in the 30 by 96 by 6 box the body simulates.
 */
export function ladderPiecesOf(fold: number): Piece[] {
  const f = Math.min(1, Math.max(0, fold));
  const [hw, hh] = LADDER_HALF;
  const hingeY = -hh + 2;
  const rearOpen = -28;
  const rearAt = mul(mul(translate(0, hingeY, 0), rotateX(rearOpen * f)), translate(0, (hh * 2 - 4) / 2, -1.5));
  const braceAt = mul(mul(mul(translate(0, hingeY, 0), rotateX((rearOpen * f) / 2)), translate(0, 30, 0)), rotateX(90 * f));
  const rail = hw - TUBE / 2;
  const own = { color: ALUMINUM };
  return [
    piece('front', 'frame', hw * 2, hh * 2, IDENTITY, own),
    ...[-26, 0, 26].map((y, i) => piece(`tread-${i}`, 'panel', hw * 2 - 8, 6, translate(0, y, 1), own)),
    piece('rear', 'frame', hw * 2 - 4, hh * 2 - 4, rearAt, own),
    piece('spreader', 'panel', 20, 16, braceAt, own),
    ...tube('rail-left', hh * 2, translate(-rail, 0, 0), own),
    ...tube('rail-right', hh * 2, translate(rail, 0, 0), own),
    ...tube('rear-rail-left', hh * 2 - 4, mul(rearAt, translate(-(rail - 2), 0, 0)), own),
    ...tube('rear-rail-right', hh * 2 - 4, mul(rearAt, translate(rail - 2, 0, 0)), own),
  ];
}

/* ---------- the prisms: the can and the extinguisher ---------- */

/** The rim's corner `k` of `sides`, as the body's `prismShape` puts it, in the unit circle's percentages for a `polygon(...)`. */
function polygonOf(sides: number): string {
  const points = [];
  for (let k = 0; k < sides; k++) {
    const t = (k * 2 * Math.PI) / sides;
    points.push(`${(50 + 50 * Math.cos(t)).toFixed(3)}% ${(50 + 50 * Math.sin(t)).toFixed(3)}%`);
  }
  return `polygon(${points.join(', ')})`;
}

/**
 * A ring of `sides` strips round the axis, each as wide as one side of a prism of `radius` (corner to axis), standing `height` tall with its
 * middle `y` along the axis. A strip's normal points out along its side, so the side takes the light the way a face does.
 */
function ringOf(name: string, radius: number, height: number, sides: number, y: number, extras: Extras = {}): Piece[] {
  const turn = (2 * Math.PI) / sides;
  const apothem = radius * Math.cos(turn / 2);
  const width = 2 * radius * Math.sin(turn / 2);
  const out: Piece[] = [];
  for (let k = 0; k < sides; k++) {
    const mid = (k + 0.5) * turn;
    const [c, s] = [Math.cos(mid), Math.sin(mid)];
    /* Local x is the side's direction, local y the axis, local z the way the side faces (x cross y is z, so x is (sin, 0, -cos)). */
    const m: Matrix = [s, 0, -c, 0, 0, 1, 0, 0, c, 0, s, 0, apothem * c, y, apothem * s, 1];
    out.push(piece(`${name}-${k}`, 'panel', width, height, m, extras));
  }
  return out;
}

/** A cap: the prism's end, a square panel clipped to the rim's `sides` corners (the body's rim runs round the local x and z, so the panel lies flat). */
function capOf(name: string, radius: number, sides: number, y: number, extras: Extras = {}): Piece {
  return piece(name, 'panel', 2 * radius, 2 * radius, mul(translate(0, y, 0), rotateX(90)), { clip: polygonOf(sides), ...extras });
}

/**
 * A prism's pieces: its `sides` side strips and its two caps, each cap a 12-gon (a square panel with a `clip-path`), as `prismShape`
 * (body.ts) shapes the body: `radius` is the rim's corner distance from the axis, `height` the length along it.
 */
export function prismPiecesOf(radius: number, height: number, sides: number, extras: Extras = {}): Piece[] {
  return [
    ...ringOf('side', radius, height, sides, 0, extras),
    capOf('cap-top', radius, sides, -height / 2, extras),
    capOf('cap-bottom', radius, sides, height / 2, extras),
  ];
}

const CAN = { radius: 15, height: 40, sides: 12 } as const;
/** Where the can's lid stands on it: the lid's middle, in the can's frame (y down), which the lid's arc turns about (lid.ts, Effect.tsx). */
export const LID_TOP = -CAN.height / 2 - 0.5;

/**
 * The trash can: the galvanized barrel (a little inside the body's own 15 px rim, so its bands, which stand proud of it, are not outside
 * it), three corrugation bands, two side handles and, last, the lid with its handle. The lid's pieces carry `lid: true`, so that Task 6 can
 * move them on their arc and the can without its lid (`lidOn` false) is the same list less its end.
 */
export function canPiecesOf(lidOn: boolean): Piece[] {
  const { radius, height, sides } = CAN;
  const body = { color: GALVANIZED };
  const bands = { color: GALVANIZED_DARK };
  const barrel = radius - 0.6;
  const out: Piece[] = [
    ...prismPiecesOf(barrel, height, sides, body),
    ...[-11, 0, 11].flatMap((y, i) => ringOf(`band-${i}`, radius - 0.1, 2.4, sides, y, bands)),
    ...tube('handle-left', 12, mul(translate(-radius, -8, 0), rotateZ(0)), { color: GALVANIZED_DARK }, 2),
    ...tube('handle-right', 12, mul(translate(radius, -8, 0), rotateZ(0)), { color: GALVANIZED_DARK }, 2),
  ];
  if (lidOn) {
    const lid = { color: GALVANIZED, lid: true as const };
    const top = LID_TOP;
    out.push(
      { ...capOf('lid-cap', radius + 0.4, sides, top, lid) },
      ...tube('lid-handle', 12, mul(translate(0, top - 3.5, 0), rotateZ(90)), { color: BLACK, lid: true }, 2),
      ...tube('lid-post-left', 4, translate(-5, top - 1.5, 0), { color: BLACK, lid: true }, 2),
      ...tube('lid-post-right', 4, translate(5, top - 1.5, 0), { color: BLACK, lid: true }, 2),
    );
  }
  return out;
}

/**
 * The fire extinguisher: the red cylinder, a black collar below its top, a valve head, a short hose from the head down to the nozzle at the
 * spout's side, and the gauge disc on its front. Its body's spout is `SHAPES.extinguisher.spout`, at the top.
 */
export function extinguisherPiecesOf(): Piece[] {
  const radius = 7.5, height = 50, sides = 12;
  const half = height / 2;
  const red = { color: RED };
  const black = { color: BLACK };
  /* The hose runs from the valve head to its nozzle, slanting out and down: its long axis is local y, so it turns about z to lie along the run. */
  const from = [1, -half - 2], to = [9, -half + 14];
  const run = [to[0]! - from[0]!, to[1]! - from[1]!];
  const length = Math.hypot(run[0]!, run[1]!);
  const turnDeg = (Math.atan2(-run[0]!, run[1]!) * 180) / Math.PI;
  const hoseAt = mul(translate((from[0]! + to[0]!) / 2, (from[1]! + to[1]!) / 2, 0), rotateZ(turnDeg));
  return [
    ...prismPiecesOf(radius - 0.4, height, sides, red),
    ...ringOf('collar', radius - 0.05, 5, sides, -half + 9, black),
    ...tube('valve', 6, translate(0, -half - 2, 0), black, 3),
    ...tube('hose', length, hoseAt, black, 1.6),
    piece('gauge', 'panel', 6, 6, translate(0, -half + 20, radius - 0.4), { clip: 'circle(50%)', color: [236, 236, 228] }),
  ];
}

/** The pieces of whatever is thrown, at `fold` (a chair's and a ladder's hinge; the others do not fold) and with the can's lid on or off. */
export function piecesFor(object: ThrownObject, fold: number, lidOn: boolean): Piece[] {
  switch (object) {
    case 'chair': return piecesOf(fold);
    case 'ladder': return ladderPiecesOf(fold);
    case 'can': return canPiecesOf(lidOn);
    case 'extinguisher': return extinguisherPiecesOf();
  }
}

/**
 * A piece's steel gray from the angle it faces, lit from above and in front: `150 + 70·|n.z| − 40·n.y`, clamped to 60 to 235, with a
 * little blue. Up is negative y, so a face turned up is lighter; the absolute value of z makes the back of a piece as bright as its front.
 * With a `color` (a piece's own `[r, g, b]`, as it looks lit full on) the same light scales that color instead: 235 is the color itself.
 */
export function shadeOf(normal: readonly [number, number, number], color?: readonly [number, number, number]): string {
  const b = Math.round(Math.min(235, Math.max(60, 150 + 70 * Math.abs(normal[2]) - 40 * normal[1])));
  if (color) {
    const [r, g, bl] = color.map((c) => Math.round(Math.min(255, (c * b) / 235)));
    return `rgb(${r}, ${g}, ${bl})`;
  }
  return `rgb(${b}, ${b + 6}, ${b + 16})`;
}

/* ---------- the oblique projection ---------- */

/**
 * How deep the floor is drawn, px: the height above the content area's bottom border that a chair lying flat at the very back is lifted by
 * (the depth lift K below derives from it). It is the floor's DRAWN DEPTH, not the room the content area keeps for resting chairs: that is
 * `roomHeightOf`, below, which is taller, since a stack of chairs and a chair lying across one reach higher than one lying flat.
 */
export const FLOOR_DEPTH = 28;
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
 * -(DEPTH + GIVE)) has its lowest point lifted by at most FLOOR_DEPTH, turned any way about the vertical: the worst is its short side, 46, along z,
 * which puts its front edge only 23 (HALF[0]) forward of its middle; with its long side along z the front edge is 45 forward and the lift less.
 */
export const K = FLOOR_DEPTH / (Z_FRONT - (-(DEPTH + GIVE) + HALF[0]));

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
 * The height of the room the content area keeps above its bottom border while a body is live, px, so that a resting body reaches neither
 * the reactions row nor the last line of words. A body sleeps only while no corner is higher above the floor than its shape's `restRise`
 * (body.ts: one that goes quiet higher is nudged and falls over), so the highest drawn point of any rest is that of a corner `restRise`
 * above the floor at the deepest z a corner of a low body can have. That z is the very back of the glass's give (-(DEPTH + GIVE)) with
 * the shape's longest half extent (the chair's 45 px, HALF[1]) lying back along z from it, which is also the most the oblique view lifts
 * a point: K per px of depth, so K (Z_FRONT + DEPTH + GIVE + half). With the INSET the border lies below the world's floor the arithmetic is
 *
 *   INSET + restRise + K (Z_FRONT + DEPTH + GIVE + half)
 *
 * rounded up, for the tallest of the objects the post's plays rolled (no objects: the chair's, 77). It is a bound and not a fit: a corner at
 * `restRise` (a chair across a stack) and a corner at the far back (a chair lying flat) are not the same corner, so the tallest rest the sample
 * draws is lower; chair.test.ts proves that none is higher, for each object. The effect sets it on the marked content area as
 * `--dw-chair-room`, and the CSS (steel-chair.css: the `::after` and the strip in the host) keeps the chair's, `roomHeightOf([])`, as its fallback.
 */
export function roomHeightOf(objects: readonly ThrownObject[]): number {
  let room = 0;
  for (const object of objects.length > 0 ? objects : (['chair'] as const)) {
    const shape = SHAPES[object];
    const half = Math.max(shape.support([1, 0, 0]), shape.support([0, 1, 0]), shape.support([0, 0, 1]));
    room = Math.max(room, Math.ceil(INSET + shape.restRise + K * (Z_FRONT + DEPTH + GIVE + half)));
  }
  return room;
}

/**
 * Where a corner of a chair is drawn, the whole picture: `corner` is a point of the world on the chair whose middle is `center`. The
 * middle is drawn at its projection; the chair's offset from it is sheared by the oblique view and foreshortened by the chair's own
 * perspective (about its middle). `transformOf` is this as a CSS transform.
 */
export function drawn(corner: readonly [number, number, number], center: { x: number; y: number; z: number }): { x: number; y: number } {
  const [a, b, c] = [corner[0] - center.x, corner[1] - center.y, corner[2] - center.z];
  const w = 1 - c / PERSPECTIVE;
  const mid = project(center);
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
