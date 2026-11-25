/**
 * The can's lid (docs/plans/2026-11-23-steel-chair-objects-design.md, section 3, Task 6). At the can's hit the lid comes off and is thrown out of the
 * content area on an arc, through its top border or its nearer side border, spinning about two axes, and is gone. This file is the arc and nothing
 * else (pure: no DOM, no clock): `lidArcOf` draws it whole from a generator, `lidAt` says where the lid is `t` seconds after the hit.
 *
 * The arc's numbers come from a generator of the lid's own, `rng(seedOfIds([seed, play, 'lid']))` (Effect.tsx makes one per can at its hit, from
 * the run's seed and the play's id), and never from the run's shared generator: that one is drawn by every throw in turn, so a lid drawing from it
 * would move the draws of every later throw (a chair's, a ladder's, an extinguisher's, another can's). With its own, no throw's draws move. The lid
 * is thrown from where it stood on the can at the hit, in the content area's px (y down).
 *
 * What the arc keeps, so that the lid is a flourish and never a second object on the post:
 *  - it leaves the box within LID_SECONDS (1.2 s), by the top border or by the side border nearer to where it started, and is `done` by then;
 *  - it never comes back in: a top exit is launched fast enough to be GONE_PX past the border before it peaks, a side exit fast enough to cross
 *    the side before it could fall out of the bottom, and upward only so far as it cannot cross the top first;
 *  - it is opaque while it is anywhere near the box, and fades only over its last stretch (GONE_PX past a border, or the last third of a second).
 */
import { GRAVITY } from './body.ts';

/** The most the lid is flown for, in seconds. */
export const LID_SECONDS = 1.2;
/** How far past the content area's border the lid is when it is done, px. */
export const GONE_PX = 80;
/** From this far past a border the lid starts to fade, px. */
const FADE_PX = 40;
/** The last stretch of the arc's time over which it fades whatever its place, seconds. */
const FADE_S = 0.3;

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
 * The arc of a lid thrown from `hitAt` in a box `box` px wide and tall, from `rand`. Six draws, always: which border, the speed, the lean, and
 * the two spins (a sign and a rate each), in that order, whatever they decide.
 */
export function lidArcOf(rand: () => number, hitAt: Point, box: { width: number; height: number }): LidArc {
  const viaTop = rand() < 0.5;
  const speed = 900 + 700 * rand();
  const lean = rand();
  const spinX = (rand() < 0.5 ? -1 : 1) * (5 + 9 * rand());
  const spinY = (rand() < 0.5 ? -1 : 1) * (5 + 9 * rand());
  const dir = hitAt.x < box.width / 2 ? -1 : 1;
  let vx: number, vy: number;
  if (viaTop) {
    /* Up fast enough to peak GONE_PX past the top with a tenth to spare, and sideways toward the nearer side only. */
    const up = Math.max(speed, 1.05 * Math.sqrt(2 * GRAVITY * (hitAt.y + GONE_PX)));
    vy = -up;
    vx = dir * lean * 0.5 * up;
  } else {
    /* Across the nearer side before it could reach the bottom (a fall of at most 0.81 of the room under it), and in under a second. */
    const dist = dir < 0 ? hitAt.x : box.width - hitAt.x;
    const fall = Math.max(1, box.height - hitAt.y);
    const across = Math.max(speed, dist / (0.9 * Math.sqrt((2 * fall) / GRAVITY)), dist / 1);
    vx = dir * across;
    /* Up by the lean, but never so far that its peak crosses the top border. */
    vy = -Math.min(lean * 0.5 * across, Math.sqrt(GRAVITY * hitAt.y));
  }
  return { from: { x: hitAt.x, y: hitAt.y }, box: { width: box.width, height: box.height }, vx, vy, spinX, spinY };
}

/** The lid `t` seconds after the hit (gravity is the body's). `done` once it is GONE_PX past the box's border, or LID_SECONDS have passed. */
export function lidAt(arc: LidArc, t: number): LidState {
  const x = arc.from.x + arc.vx * t;
  const y = arc.from.y + arc.vy * t + 0.5 * GRAVITY * t * t;
  const past = Math.max(-x, x - arc.box.width, -y, y - arc.box.height);
  const done = past >= GONE_PX || t >= LID_SECONDS;
  const byPlace = 1 - Math.min(1, Math.max(0, (past - FADE_PX) / (GONE_PX - FADE_PX)));
  const byTime = Math.min(1, Math.max(0, (LID_SECONDS - t) / FADE_S));
  const ax = arc.spinX * t, ay = arc.spinY * t;
  const [cx, sx, cy, sy] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay)];
  /* Ry(ay) * Rx(ax), column-major. */
  const matrix = [
    cy, sx * sy, -cx * sy, 0,
    0, cx, sx, 0,
    sy, -sx * cy, cx * cy, 0,
    0, 0, 0, 1,
  ];
  return { position: { x, y }, matrix, opacity: Math.min(byPlace, byTime), done };
}
