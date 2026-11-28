/**
 * Hot Box's pure half (docs/plans/2026-11-15-hot-box-plan.md, Task 3; design, section 2.2): the smoke over a post,
 * as numbers. No DOM, no clock and no Math.random: `Effect.tsx` hands it the time and draws what it returns, as the
 * fog of `fog.ts` (which it drives) or, under forced colors, as a hard-edged mask.
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
 * A pointer also leaves a trail: the points it passed, each kept for `wake` and closing in a straight line over it, so
 * the path just behind it stays partly open. `extendTrail` adds a point only after the pointer has moved a third of a
 * radius and keeps the list to what a frame a point for one wake needs, so a trail's cost does not grow with a long
 * visit. Under reduced motion a trail point is open for `trailHard` of the wake and then shut, as a clearing is. The
 * forced-colors mask draws hard circles (`hardOpen`): a clearing at least `trailHard` open and a trail point still in
 * the first `trailHard` of its wake.
 */
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
  /** How long a trail point stays partly open behind the pointer, ms. */
  wake: 1500,
  /** How far the pointer travels before the trail takes another point, as a share of a radius. */
  trailStep: 1 / 3,
  /** The share of the wake a trail point shows the words in forced colors and under reduced motion, and the least openness a clearing has to show them there. */
  trailHard: 0.5,
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

/** A point the pointer passed, in the box's px, and when it left it. */
export interface TrailPoint { readonly x: number; readonly y: number; readonly leftAt: number }

/** The most points a trail holds: a frame's worth (16 ms) for one wake, and one over. */
const TRAIL_MAX = Math.ceil(SMOKE.wake / 16) + 1;

/**
 * The trail with the pointer's place at `now` added when it is a `trailStep` of `radius` from the last point (an empty
 * trail takes it), and with points a wake old or more dropped. The distance is from the last point the trail held, so a
 * still pointer adds nothing however long it stays. Never more than `TRAIL_MAX` points: the oldest go first. It returns a new list.
 */
export function extendTrail(trail: readonly TrailPoint[], x: number, y: number, now: number, radius: number): TrailPoint[] {
  const last = trail[trail.length - 1];
  const kept = trail.filter((p) => now - p.leftAt < SMOKE.wake);
  if (!last || Math.hypot(x - last.x, y - last.y) >= SMOKE.trailStep * radius) kept.push({ x, y, leftAt: now });
  return kept.length > TRAIL_MAX ? kept.slice(kept.length - TRAIL_MAX) : kept;
}

/** How open a trail point is: 1 as it is left, down to 0 over `wake`. Under reduced motion, 1 for the first `trailHard` of the wake, then 0. */
export function trailOpenness(point: TrailPoint, now: number, reduced: boolean): number {
  const age = now - point.leftAt;
  if (reduced) return age < SMOKE.trailHard * SMOKE.wake ? 1 : 0;
  return Math.min(1, Math.max(0, 1 - age / SMOKE.wake));
}

/** The fog's share left at a point: 0 inside an open clearing or trail point, 1 away from all of them, the `edge` between; the most open one there wins. */
export function covered(x: number, y: number, clearings: readonly Clearing[], radius: number, now: number, reduced: boolean, trail: readonly TrailPoint[] = []): number {
  let fog = 1;
  const core = radius * (1 - SMOKE.edge);
  const open = (cx: number, cy: number, o: number): void => {
    if (o <= 0) return;
    /* Beyond the radius it changes nothing; asked first, since the fog's field asks about every cell a clearing or a trail point might reach. */
    const dx = x - cx, dy = y - cy;
    if (dx >= radius || -dx >= radius || dy >= radius || -dy >= radius) return;
    const d = Math.sqrt(dx * dx + dy * dy);
    const local = d <= core ? 0 : d >= radius ? 1 : (d - core) / (radius - core);
    fog = Math.min(fog, 1 - (1 - local) * o);
  };
  for (const c of clearings) open(c.x, c.y, openness(c, now, reduced));
  for (const p of trail) open(p.x, p.y, trailOpenness(p, now, reduced));
  return fog;
}

/**
 * The hard discs forced colors shows the words through, each a full radius: every clearing at least `trailHard` open, and every trail point in the first
 * `trailHard` of its wake. A disc is there or it is not, under reduced motion too: nothing about it fades.
 */
export function hardDiscs(clearings: readonly Clearing[], trail: readonly TrailPoint[], now: number): { readonly x: number; readonly y: number }[] {
  return [...clearings.filter((c) => openness(c, now, false) >= SMOKE.trailHard), ...trail.filter((p) => trailOpenness(p, now, true) === 1)];
}

/** Whether forced colors shows the words at a point: inside one of `hardDiscs`. */
export function hardOpen(x: number, y: number, clearings: readonly Clearing[], trail: readonly TrailPoint[], radius: number, now: number): boolean {
  return hardDiscs(clearings, trail, now).some((d) => Math.hypot(x - d.x, y - d.y) < radius);
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
  const line = lines[index];
  if (!line) {
    const last = lines[lines.length - 1];
    return { x: boxWidth, y: last ? (last.top + last.bottom) / 2 : 0, finished: lines.length - 1, done: true };
  }
  return { x: ((t - index * per) / per) * boxWidth, y: (line.top + line.bottom) / 2, finished: index - 1, done: false };
}

/** Whether a saved state says the post is aired out for good (`{ clean: true }`). */
export function airedOut(state: unknown): boolean {
  return typeof state === 'object' && state !== null && !Array.isArray(state) && (state as { clean?: unknown }).clean === true;
}

/**
 * How tall the band the author has aired out is, in px of a box `boxHeight` tall (the row, or the content area where there is no row), measured from its top border: the saved share (`{ aired }`,
 * more than 0 and less than 1) of the height, the whole box for a play aired out clean, and 0 for none or for a state the card would not keep. The band is
 * the area's full width, and no smoke is drawn, cleared into, or masked over in it.
 */
export function airedTop(state: unknown, boxHeight: number): number {
  if (!(Number.isFinite(boxHeight) && boxHeight > 0)) return 0;
  if (airedOut(state)) return boxHeight;
  const aired = typeof state === 'object' && state !== null ? (state as { aired?: unknown }).aired : undefined;
  return typeof aired === 'number' && aired > 0 && aired < 1 ? aired * boxHeight : 0;
}
