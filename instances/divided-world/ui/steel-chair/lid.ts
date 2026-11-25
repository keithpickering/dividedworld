/**
 * The can's lid (docs/plans/2026-11-23-steel-chair-objects-design.md, section 3, Task 6). At the can's hit the lid comes off and is thrown out of the
 * content area on an arc, spinning about two axes, and is gone. This file is the arc and nothing else (pure: no DOM, no clock): `lidArcOf` draws it
 * whole from a generator, `lidAt` says where the lid is `t` seconds after the hit.
 *
 * The rule is the owner's bench's (2026-11-25): the lid is launched LID_ANGLE_DEG (30) off straight up, give or take LID_SPREAD_DEG (8), toward the
 * side border nearer to where it started, at LID_SPEED (550 px/s) give or take a tenth, under the world's gravity (body.ts `GRAVITY`), with no
 * boost. It is `done` once GONE_PX (80) past a border, or at LID_SECONDS (1.2 s). So it leaves through the nearer side, or, on a wide post, falls out
 * through the bottom, or on a very tall one is still inside at 1.2 s, where it has faded out over its last fifth (a fade, never a pop). It never
 * goes out through the top: a hit so near the top that 550 px/s would carry the lid past it is launched only as fast as keeps its peak inside.
 *
 * The arc's numbers come from a generator of the lid's own, `rng(seedOfIds([seed, play, 'lid']))` (Effect.tsx makes one per can at its hit, from
 * the run's seed and the play's id), and never from the run's shared generator: that one is drawn by every throw in turn, so a lid drawing from it
 * would move the draws of every later throw (a chair's, a ladder's, an extinguisher's, another can's). With its own, no throw's draws move. The lid
 * is thrown from where it stood on the can at the hit, in the content area's px (y down).
 */
import { GRAVITY } from './body.ts';

/** The lid's launch speed, px/s, which a draw of a tenth either way varies (the owner's bench, 2026-11-25). */
export const LID_SPEED = 550;
/** The launch angle off straight up, degrees, and the most it varies by either way (the bench's). */
export const LID_ANGLE_DEG = 30;
export const LID_SPREAD_DEG = 8;
/** The most the lid is flown for, in seconds; it fades over the last fifth of it. */
export const LID_SECONDS = 1.2;
/** How far past the content area's border the lid is when it is done, px. */
export const GONE_PX = 80;

export interface Point { x: number; y: number }
export interface LidArc {
  /** Where the lid starts, and the box's size (the content area's px): `done` is judged against it. */
  readonly from: Point;
  readonly box: { readonly width: number; readonly height: number };
  /** Launch velocity, px/s, y down. */
  readonly vx: number;
  readonly vy: number;
  /** The spin about the x and y axes, radians a second. */
  readonly spinX: number;
  readonly spinY: number;
}
export interface LidState {
  /** The lid's middle, in the content area's px. */
  readonly position: Point;
  /** The turn since the hit, as the 16 numbers of a column-major matrix3d (a rotation about x then y). */
  readonly matrix: number[];
  readonly opacity: number;
  readonly done: boolean;
}

/**
 * The arc of a lid thrown from `hitAt` in a box `box` px wide and tall, from `rand`. Six draws, always: the angle, the speed, and the two spins
 * (a sign and a rate each), in that order.
 */
export function lidArcOf(rand: () => number, hitAt: Point, box: { width: number; height: number }): LidArc {
  const angle = (LID_ANGLE_DEG + (rand() * 2 - 1) * LID_SPREAD_DEG) * Math.PI / 180;
  let speed = LID_SPEED * (0.9 + 0.2 * rand());
  const spinX = (rand() < 0.5 ? -1 : 1) * (5 + 9 * rand());
  const spinY = (rand() < 0.5 ? -1 : 1) * (5 + 9 * rand());
  /* Never out through the top: a hit too near it for the full speed is launched only as fast as keeps the peak inside. */
  speed = Math.min(speed, Math.sqrt(2 * GRAVITY * Math.max(0, hitAt.y)) / Math.cos(angle));
  const dir = hitAt.x < box.width / 2 ? -1 : 1;
  return { from: { x: hitAt.x, y: hitAt.y }, box: { width: box.width, height: box.height }, vx: dir * Math.sin(angle) * speed, vy: -Math.cos(angle) * speed, spinX, spinY };
}

/** The lid `t` seconds after the hit (gravity is the body's). `done` once it is GONE_PX past the box's border, or LID_SECONDS have passed; it fades by time only, over the last fifth of that. */
export function lidAt(arc: LidArc, t: number): LidState {
  const x = arc.from.x + arc.vx * t;
  const y = arc.from.y + arc.vy * t + 0.5 * GRAVITY * t * t;
  const past = Math.max(-x, x - arc.box.width, -y, y - arc.box.height);
  const done = past >= GONE_PX || t >= LID_SECONDS;
  const opacity = Math.min(1, Math.max(0, (LID_SECONDS - t) / (LID_SECONDS * 0.2)));
  const ax = arc.spinX * t, ay = arc.spinY * t;
  const [cx, sx, cy, sy] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay)];
  /* Ry(ay) * Rx(ax), column-major. */
  const matrix = [
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    0, 0, 0, 1,
  ];
  return { position: { x, y }, matrix, opacity, done };
}
