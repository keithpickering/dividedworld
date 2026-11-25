/**
 * The cost ladder and the rest timer every fog on the page shares (moved out of `Effect.tsx` unchanged when Steel Chair's puff came to draw fog with Hot Box's field,
 * docs/plans/2026-11-23-steel-chair-objects-design.md, section 4): the painter's own time is kept for the last 30 frames it ran in, for every fog in view together (a smoked post
 * and a puff alike), against `FOG_BUDGET_MS`, and over it one painting post steps down a rung. A puff takes its rungs from here and gives its time to the same count, so
 * several smoked posts in view never step down a rung they would not have taken alone because a puff is among them.
 */
import { FOG } from './fog.ts';

/** How often fog at rest is drawn again, ms: 20 times a second, which its fastest sheet (7 px a second) needs and no more. */
const REST_MS = 50;

/**
 * The script time a frame all the fog in view may take together, ms (measured at a phone's speed by e2e/hot-box.spec.ts). Raised from the design's 4 ms on the
 * owner's word, 2026-11-16, after the measured figures (a phone's viewport at a 4x CPU throttle: 7.6 to 9.4 ms at rung 0) and the owner's own check on a Pixel 8;
 * 8 ms is the tiled layer's own budget figure.
 */
export const FOG_BUDGET_MS = 8;
/** How many of the painter's last frames the mean is taken over, at most. */
const LADDER_FRAMES = 30;
/** The rungs, by level: the cell's side (px), the rounds of the pressure solve, and whether the fog is drawn from the model with no field. */
export const RUNGS: readonly { readonly cell: number; readonly rounds: number; readonly direct: boolean }[] = [
  { cell: FOG.cell, rounds: FOG.rounds, direct: false },
  { cell: 7, rounds: FOG.rounds, direct: false },
  { cell: 10, rounds: FOG.rounds, direct: false },
  { cell: 10, rounds: 4, direct: false },
  { cell: 10, rounds: 0, direct: true },
];
export const FOG_LEVEL_MOST = RUNGS.length - 1;
/**
 * What a frame costs at each rung, as a share of rung 0's: how far down a mean over the budget has to go to fit it. Measured by e2e/hot-box.spec.ts's cost
 * cases in Chromium at a 4x CPU throttle (a phone's speed), each rung forced alone, a pointer or a finger sweeping 3 s over the short post and over LongPost
 * at a desktop's width and a phone's: the mean of the four ratios to rung 0 (2026-11-16, with `coverageOf` in the painter: 0.59 0.48 0.67 0.64 at rung 1,
 * 0.41 0.28 0.61 0.47 at rung 2, 0.41 0.29 0.56 0.42 at rung 3, 0.23 0.17 0.31 0.27 at rung 4). Rung 3's rounds buy nothing a pressure solve of 8 did not already cost less than the cell, so it
 * is no cheaper than rung 2 and the ladder never lands on it from a mean that rung 2 did not fit.
 */
export const FOG_SHARE: readonly number[] = [1, 0.59, 0.44, 0.42, 0.25];
/** How many painter frames the mean has before it is judged: a slow device paints few frames a second, and waits on no more than this. */
export const LADDER_FIRST = 8;

/** A smoked post, or a puff (`transient`), on the ladder: its rung, whether a pointer is on it, the last frame it painted in (the ladder's count), and the step down. */
export interface Rung { level(): number; pointed(): boolean; paintedIn(): number; lower(to: number): void; readonly transient?: boolean }
/* One budget for the page: every smoked post's painter adds its time to the frame it ran in, and the mean of the last frames decides. */
export const ladder = { rungs: new Set<Rung>(), stamp: null as number | null, seen: new Set<string>(), spent: 0, painted: false, kept: [] as number[], frames: 0, skipping: false };
/* Each smoked post's own name in the ladder's frames: the same play can be shown twice on a page (in its thread and in an ORIGIN box), so the play's id is not one. */
let painters = 0;
/** A new painter's name in the ladder's frames. */
export const nextPainterId = (): number => ++painters;

/** The frame before this one is over: its cost joins the mean, and a mean over the budget sends one post a rung down, a post nobody points at first. */
function closeFrame(): void {
  /* The frame that straddled a step began at the old rung: it is not counted, so the new rung is judged on frames drawn at it. */
  if (ladder.skipping) { ladder.skipping = false; ladder.spent = 0; ladder.painted = false; ladder.frames += 1; return; }
  if (!ladder.painted) return;
  ladder.kept.push(ladder.spent);
  if (ladder.kept.length > LADDER_FRAMES) ladder.kept.shift();
  ladder.spent = 0;
  ladder.painted = false;
  ladder.frames += 1;
  if (ladder.kept.length < LADDER_FIRST) return;
  let sum = 0;
  for (const ms of ladder.kept) sum += ms;
  const mean = sum / ladder.kept.length;
  if (mean <= FOG_BUDGET_MS) return;
  /* Only a post that painted in the frames the mean is over can take its cost off it: one that holds no tile near the window is never stepped down. */
  const open = [...ladder.rungs].filter((r) => r.level() < FOG_LEVEL_MOST && ladder.frames - r.paintedIn() <= LADDER_FRAMES);
  /* A transient fog (a puff, which is gone in 5 s) steps down first: it is the cheaper to degrade, and a smoked post that lasts three days never goes down a rung for it. */
  const next = open.find((r) => r.transient === true) ?? open.find((r) => !r.pointed()) ?? open[0];
  if (!next) return;
  /* It goes to the first rung whose expected cost fits (the mean as the rungs' shares scale it), at least one down, and to the last where none does. */
  const from = next.level();
  let to = from + 1;
  while (to < FOG_LEVEL_MOST && (mean * FOG_SHARE[to]!) / FOG_SHARE[from]! > FOG_BUDGET_MS) to += 1;
  next.lower(to);
  /* The mean starts again, so the rung just taken is judged on its own frames. */
  ladder.kept = [];
  ladder.skipping = true;
}

/** A painter's time for one tile, in the frame `stamp` (a tile is painted once a frame, so a tile seen twice is a new frame even where the stamp is the same). */
export function spend(key: string, stamp: number | null, ms: number): void {
  if (stamp === null) return;
  if (stamp !== ladder.stamp || ladder.seen.has(key)) { closeFrame(); ladder.stamp = stamp; ladder.seen.clear(); }
  ladder.seen.add(key);
  if (ladder.skipping) return;
  ladder.spent += ms;
  ladder.painted = true;
}

let forcedLevel: number | null = null;
/** The rung every smoked post is forced to, or null when each has its own. */
export const forcedFogLevel = (): number | null => forcedLevel;
/** For a story and a test: every smoked post is drawn at this rung (null gives each its own back). */
export function forceFogLevel(level: number | null): void {
  forcedLevel = level === null ? null : Math.max(0, Math.min(FOG_LEVEL_MOST, Math.floor(level)));
}
/** For tests: the ladder as a fresh page has it. */
export function resetFogLadder(): void {
  ladder.rungs.clear(); ladder.stamp = null; ladder.seen.clear(); ladder.spent = 0; ladder.painted = false; ladder.kept = []; ladder.frames = 0; ladder.skipping = false;
  forcedLevel = null;
}

/* -------------------------------------------------------------------------------- fog at rest ---- */

/* One timer for every smoked post on the page: made with the first, dropped with the last. Each tick, a post marks its held tiles stale (one that holds none does nothing). */
const resting = new Set<() => void>();
let restTimer: ReturnType<typeof setTimeout> | undefined;
function restTick(): void {
  restTimer = undefined;
  for (const tick of [...resting]) tick();
  if (resting.size > 0) restTimer = setTimeout(restTick, REST_MS);
}
export function joinRest(tick: () => void): () => void {
  resting.add(tick);
  restTimer ??= setTimeout(restTick, REST_MS);
  return () => {
    resting.delete(tick);
    if (resting.size === 0 && restTimer !== undefined) { clearTimeout(restTimer); restTimer = undefined; }
  };
}

