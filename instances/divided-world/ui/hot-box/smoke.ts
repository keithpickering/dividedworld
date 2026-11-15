/**
 * Hot Box's pure half (docs/plans/2026-11-15-hot-box-plan.md, Task 3; design, section 2.2): the smoke over a post,
 * as numbers. No DOM, no clock and no Math.random: `Effect.tsx` hands it the time and a seed and draws what it
 * returns, on a canvas (fog, puffs, clearings cut out) or, under forced colors, as a hard-edged mask.
 *
 * The smoke is an obstacle read through by clearing it, and it is the same for every reader: nothing here knows who
 * wrote the post or who cast the card. It thins in a straight line over the play's life (`strength`), from `full` as
 * the play lands to `least` as it ends; the forced-colors mask is the same thinning seen the other way
 * (`maskAlpha` is exactly `1 - fogAlpha`), so the two paths cost a reader the same.
 *
 * A clearing is where a pointer has been. A mouse or pen holds it open while it is there (`leftAt` null) and lets it
 * close over `roll` once it leaves; a touch holds it open for `hold` first, since a finger cannot stay in place and
 * scroll the page too. Under reduced motion a clearing is open or shut with nothing between, and it shuts at the
 * moment the animated one would begin to close, so the choice of motion changes the look and not the schedule.
 *
 * A held sweep (the control that stands in for a pointer) moves one clearing along the post's lines at a pace in
 * px a second, a full box width a line, so a line takes `width / pace` seconds whatever the line's own length:
 * a short line costs what a long one does, as Whoops!'s sweep does. Its time depends on nothing but the elapsed
 * time, so reduced motion does not shorten it.
 *
 * The puffs are the drifting texture: placed by a seeded generator, drifting at a steady velocity and wrapping at
 * the box's edges, so where one is at any `t` is a pure function of the puff.
 */
import { mulberry32 } from '../../cards/whoops/splat.ts';

export const SMOKE = {
  /** The fog's opacity when the play lands. */
  full: 0.94,
  /** The fog's opacity as the play ends. */
  least: 0.45,
  /** A clearing's radius, px, before the box's limits. */
  hole: 90,
  /** The least a clearing's radius is, px. It wins over `holeShare` in a box too narrow for both. */
  holeMin: 56,
  /** The most a clearing's radius is, as a share of the box's width. */
  holeShare: 0.22,
  /** The share of a clearing's radius over which it fades back to fog. */
  edge: 0.35,
  /** How long a clearing takes to close once left, ms. */
  roll: 2500,
  /** How long a touched clearing stays open before it starts to close, ms. */
  touchHold: 4000,
  /** How long the post stays clear after a finished sweep, ms. */
  waved: 20000,
  /** The area a puff stands for, px squared. */
  puffArea: 1800,
  /** The fewest and most puffs a box holds. */
  puffsMin: 24,
  puffsMax: 160,
} as const;

/** 1 as the play lands at `playedAt`, falling in a straight line to 0 at `ends` (ms), clamped. A time that is no time gives 1. */
export function strength(now: number, playedAt: number, ends: number): number {
  if (![now, playedAt, ends].every(Number.isFinite)) return 1;
  if (ends <= playedAt) return now >= ends ? 0 : 1;
  return Math.min(1, Math.max(0, (ends - now) / (ends - playedAt)));
}

/** The fog's opacity at this strength. */
export function fogAlpha(strength: number): number {
  return SMOKE.least + (SMOKE.full - SMOKE.least) * strength;
}

/** How much of the words shows away from every clearing on the forced-colors path: the fog's complement. */
export function maskAlpha(strength: number): number {
  return 1 - fogAlpha(strength);
}

/** A clearing's radius, px: `hole`, never over a share of the box's width and never under `holeMin`. */
export function holeRadius(boxWidth: number): number {
  const cap = Number.isFinite(boxWidth) ? boxWidth * SMOKE.holeShare : 0;
  return Math.max(SMOKE.holeMin, Math.min(SMOKE.hole, cap));
}

/** A clearing in the box's px. `leftAt` is null while the pointer is there; `hold` is how long it stays open after it left. */
export interface Clearing { readonly x: number; readonly y: number; readonly openedAt: number; readonly leftAt: number | null; readonly hold: number }

/** How open a clearing is: 1 while the pointer is there and for `hold` after, then down to 0 over `roll`. Under reduced motion, 1 until it would begin to close, then 0. */
export function openness(clearing: Clearing, now: number, reduced: boolean): number {
  if (now < clearing.openedAt) return 0;
  if (clearing.leftAt === null) return 1;
  const closing = now - clearing.leftAt - clearing.hold;
  if (closing <= 0) return 1;
  if (reduced) return 0;
  return Math.max(0, 1 - closing / SMOKE.roll);
}

/** The fog's share left at a point: 0 inside an open clearing, 1 away from all of them, the `edge` between; the most open clearing there wins. */
export function covered(x: number, y: number, clearings: readonly Clearing[], radius: number, now: number, reduced: boolean): number {
  let fog = 1;
  const core = radius * (1 - SMOKE.edge);
  for (const c of clearings) {
    const o = openness(c, now, reduced);
    if (o <= 0) continue;
    const d = Math.hypot(x - c.x, y - c.y);
    const local = d <= core ? 0 : d >= radius ? 1 : (d - core) / (radius - core);
    fog = Math.min(fog, 1 - (1 - local) * o);
  }
  return fog;
}

/** One puff of the drifting texture: where it was made, its radius, its drift in px a second and a phase for its shade. */
export interface Puff { readonly x: number; readonly y: number; readonly r: number; readonly dx: number; readonly dy: number; readonly phase: number }

/** The box's puffs for a seed: one to each `puffArea` px squared, from `puffsMin` to `puffsMax`. */
export function puffs(seed: number, width: number, height: number): Puff[] {
  const area = Number.isFinite(width) && Number.isFinite(height) ? Math.max(0, width) * Math.max(0, height) : 0;
  const count = Math.min(SMOKE.puffsMax, Math.max(SMOKE.puffsMin, Math.round(area / SMOKE.puffArea)));
  const rnd = mulberry32(seed);
  const w = Math.max(0, width) || 0, h = Math.max(0, height) || 0;
  return Array.from({ length: count }, () => {
    const heading = rnd() * Math.PI * 2, speed = 4 + rnd() * 10;
    return { x: rnd() * w, y: rnd() * h, r: 18 + rnd() * 24, dx: Math.cos(heading) * speed, dy: Math.sin(heading) * speed, phase: rnd() * Math.PI * 2 };
  });
}

const wrap = (v: number, size: number): number => (size > 0 ? ((v % size) + size) % size : 0);

/** Where a puff is at `t` ms (0 under reduced motion), wrapped at the box's edges, and its shade in [-1, 1] (lighter above 0, darker below). */
export function puffAt(puff: Puff, t: number, width: number, height: number): { x: number; y: number; r: number; shade: number } {
  const s = t / 1000;
  return {
    x: wrap(puff.x + puff.dx * s, width),
    y: wrap(puff.y + puff.dy * s, height),
    r: puff.r,
    shade: Math.sin(puff.phase + s / 3),
  };
}

/** A post's line in the box's px (a line's own left and right are not needed: a sweep spans the box). `readLines` gives shares of the box's height: scale them first. */
export interface SweepLine { readonly top: number; readonly bottom: number }

/**
 * Where a held sweep's clearing is `elapsedMs` in: along each line from the box's left edge to its right at `pace`
 * px a second, then down to the next. `finished` is the index of the last line it has finished (-1 for none) and
 * `done` is true after the last. With no lines, or a box or pace that gives no time, it is done at once.
 */
export function sweepAt(lines: readonly SweepLine[], elapsedMs: number, boxWidth: number, pace: number): { x: number; y: number; finished: number; done: boolean } {
  const per = (boxWidth / pace) * 1000;
  if (lines.length === 0 || !(boxWidth > 0 && pace > 0) || !Number.isFinite(per) || per <= 0) {
    const last = lines[lines.length - 1];
    return { x: boxWidth > 0 ? boxWidth : 0, y: last ? (last.top + last.bottom) / 2 : 0, finished: lines.length - 1, done: true };
  }
  const t = Number.isNaN(elapsedMs) ? 0 : Math.max(0, elapsedMs);
  const index = Math.floor(t / per);
  if (index >= lines.length) {
    const last = lines[lines.length - 1];
    return { x: boxWidth, y: (last.top + last.bottom) / 2, finished: lines.length - 1, done: true };
  }
  const line = lines[index];
  return { x: ((t - index * per) / per) * boxWidth, y: (line.top + line.bottom) / 2, finished: index - 1, done: false };
}
