/**
 * Hot Box's effect on a post (docs/plans/2026-11-15-hot-box-plan.md, Task 4, reworked by docs/plans/2026-11-15-hot-box-fog-plan.md, Task 5; design
 * docs/plans/2026-11-15-hot-box-fog-design.md): smoke over the words, in the caster's color, for three days, thinning as it goes. It is an obstacle read
 * through by clearing it: a mouse or pen moves the fog aside where it points, a finger where it touches or drags, and a held control in the Lens ("Wave the
 * smoke") sweeps the post line by line at the pace of a hand. It is the same for every reader, the post's author and the caster included, and it is the
 * reader's own and on this screen only: nothing is saved, sent, counted or broadcast, so the effect reads neither who wrote the post nor who played the
 * card, and calls neither `save` nor `release`.
 *
 * Which play. The engine goes on handing an ended play to an effect, so this decides for itself whether its play is still up, against the page's clock, or `moment.at` in a moment
 * (`useAt` redraws when the soonest end passes, as Whodunnit?'s does). The first play whose end is ahead is the one drawn, so a second Hot Box cast after
 * the first ended is the one that shows. With none, the words are drawn alone.
 *
 * The container (the owner, 2026-11-15). The smoke fills the post's whole content area, border to border, as Feelin' Fab's foil and Whoops!'s ink do: the
 * post body (`.kb-act-main`) in the thread and the ORIGIN box's area (`.kb-origin-area`) in the box, found and measured with the engine's `bodyOf` and
 * `bodyBox` (engine/ui/cards/body.ts), and this effect's own element where there is none (Stick Around's view). Everything below that says "the box" means
 * that area: the fog's field, a clearing's radius, where a pointer clears. Only the words' own lines are the words': the held sweep travels them (offset
 * into the area), and under forced colors the mask is the words' (so its coordinates are theirs).
 *
 * The model is `smoke.ts`'s (numbers, strength, clearings, the trail, the sweep): it alone says what a reader can read, where and for how long. This file
 * draws it in one of four ways that cost a reader the same, since each reads that model and none has a radius or a timing of its own:
 *  - the full effect: the fog of `fog.ts`, a shaded body the pointer drags, that flows around it and closes in from its rim. It is painted through the
 *    engine's tiles (engine/ui/cards/tiles.ts): canvases 512 px tall over the content area, held only near the window, at a density of 1 (the fog is drawn a
 *    cell to a pixel and scaled up smooth, so a dense canvas buys nothing). The field is stepped once a frame, on the first tile painted in it, and only
 *    where it is disturbed. Nothing loops: a tile under moving fog (a clearing or trail that is moving, or fog still changing as one opens or closes) is marked stale each frame it is
 *    painted, so it is painted again in the next; fog at rest, and a clearing the reader holds still once it has settled, is marked stale 20 times a second by one timer for the page, which is how fast its drift needs; a tile out of view is not
 *    held, so nothing is painted for it. Where a tile is not yet painted its place shows a stand-in, the fog's flat color (`dw-hotbox-far`), so the words
 *    are never bare;
 *  - the ladder: the painter's own time is kept for the last 30 frames it ran in, for every smoked post on the page together, against `FOG_BUDGET_MS`.
 *    Over it, one post that is painting steps down a rung (one nobody is pointing at first): bigger cells, then fewer rounds of the pressure solve, then the fog drawn
 *    from the model with no field at all. A rung is given back only when the post leaves the view, so the fog never flickers between rungs. Every rung
 *    reads the same model, so no reader's device makes the post easier or harder to read. The rung is on the host as `data-dw-fog-level`, for tests;
 *  - reduced motion: the same shaded fog, still, drawn from the model directly (a clearing and each point of its trail is open or shut, with the fog's
 *    wispy edge), and drawn again only when something changes;
 *  - forced colors, where the fog cannot be drawn in system colors: the words themselves are masked, a flat layer at `maskAlpha` over the words, a
 *    hard-edged disc for each of the model's `hardDiscs` (a clearing more open than not, a trail point in the first half of its wake), a rectangle for each
 *    line the sweep has finished. No layer is made, so no tile and no stand-in is drawn and no frame is requested; the mask is moved on a 50 ms timer, or on
 *    the times things change under reduced motion. A ring (system colors) shows where each disc is, a sign says what the Lens says, and the content area is
 *    outlined in `CanvasText`, because a smoked post would otherwise look blank. The outline and the rings are drawn by a frame laid over the content area
 *    (`dw-hotbox-frame`), never by the words' own box, which its mask would take away with the rest.
 *
 * The control is the Lens's alone (the owner, 2026-11-16): the post holds no button. A card's control on the post could be covered and inert under another
 * card's obstacle; its Lens control is always reachable (issue #721).
 *
 * Screen readers and the keyboard. While the play is up the words are `inert` (as Whoops! makes an inked body), so a link in a smoked post is followed
 * after a finished sweep. A line in the body, hidden from sight and never inert, stands where the words are and says the way: the post's Hot Box mark opens
 * the cards on the post, and Wave the smoke is there. Each line the sweep finishes is put in a hidden live region, one at a time. A held sweep that reaches
 * the end makes the post waved: for `SMOKE.waved` no fog is drawn and the words are not inert, and then the smoke rolls back over `roll`. Focus is never
 * thrown: when the window ends, only focus that was inside the words (which the browser would drop) goes to the post's Hot Box mark. While the words are
 * inert nothing inside them is lifted above the fog (hot-box.css): a fold's bar under smoke is under it like the words, and neither looks nor is pressable.
 *
 * Nothing here is stopped or prevented: the pointer is read passively on the content area, and a press reaches every listener above it. A finger's
 * vertical swipe scrolls the page as ever (`touch-action: pan-y` on the host); its drag across a line moves its clearing and leaves a wake.
 *
 * In a play's moment (`moment`, docs/plans/2026-11-16-playable-moments-design.md) the effect is the live one in every way but the clock of the smoke: the
 * standing play is the one up at `moment.at` and its strength is the strength then, fixed, so the fog does not thin as the page's time passes. The reader's
 * own pointer, hold, wave and the rest are as live (the engine gives a moment's reader no save, release or give, and a `met` that does nothing). The
 * reader's clearings and the held sweep run on the page's clock, `api.now()`, never the page's own `Date`; the painter's own cost is a duration on the
 * page's timer (`performance.now`), compared with no time the data holds.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { bodyBox, bodyOf, liftedOver, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import { endsWords, markOf } from '../../../../engine/ui/cards/marks.ts';
import { TIMER_MOST, useAt } from '../../../../engine/ui/cards/plays.ts';
import { makeTileLayer, type TileDraw, type TileLayer } from '../../../../engine/ui/cards/tiles.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { readLines } from '../../cards/whoops/lines.ts';
import { SWEEP_PX_S } from '../../cards/whoops/scrub.ts';
import { rgbOf } from '../../cards/whoops/splat.ts';
import { FOG, cellOrigin, coverageOf, makeField, pageCloud, paintFog, rowsOf, stepField, type FogClearing, type FogField } from './fog.ts';
import { SMOKE, extendTrail, fogAlpha, hardDiscs, holeRadius, maskAlpha, openness, strength, sweepAt, type Clearing, type SweepLine, type TrailPoint } from './smoke.ts';
import './hot-box.css';

/** The control's label and its hidden description, which the Lens is given. */
export const WAVE_LABEL = 'Wave the smoke';
export const WAVE_DESCRIBE = `Hold Space or Enter on this button to wave the smoke off line by line, at the pace of a hand. Let go and it rolls back in. Hold to the end and the post stays clear for ${SMOKE.waved / 1000} seconds.`;
/** The line that stands where the words are for a screen reader while they are under smoke: the glass's voice, plain and true. */
export const SMOKED_WAY = `This post is under smoke. To read it, open Hot Box in the cards on this post and hold ${WAVE_LABEL}.`;

const STATE_SMOKE = 'Smoke over the words';
const STATE_WAVING = 'Waving it away';
const STATE_WAVED = 'Waved clear for you';

/** How far the words' offset or size may change mid-hold before the hold is let go, px. */
const SHIFT_PX = 0.5;
/** How often the forced-colors mask is moved while something in it is changing, ms. */
const TICK_MS = 50;
/** How often fog at rest is drawn again, ms: 20 times a second, which its fastest sheet (7 px a second) needs and no more. */
const REST_MS = 50;
/** A frame's worth: the gap between one tile's rest repaint and the next in the same post. */
const REST_STEP_MS = 16;
/** A pointer that has not moved for this long drags nothing, and its clearing is fog at rest to the painter, ms. */
const IDLE_MS = 60;
/** The color a smoke that names none the card can read is drawn in: `lightgray` (Whoops!'s table has no such name, so it is written out). */
const LIGHT_GRAY: readonly [number, number, number] = [211, 211, 211];

/* -------------------------------------------------------------------------------- forced colors ---- */

const FORCED = '(forced-colors: active)';
/* One media query and one listener for every smoked post on the page: made with the first reader of it, dropped with the last. */
const forcedReaders = new Set<() => void>();
let forcedQuery: MediaQueryList | undefined;
const forcedChanged = () => { for (const read of [...forcedReaders]) read(); };
function subscribeForced(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  if (forcedReaders.size === 0) {
    forcedQuery = window.matchMedia?.(FORCED);
    forcedQuery?.addEventListener?.('change', forcedChanged);
  }
  forcedReaders.add(onChange);
  return () => {
    forcedReaders.delete(onChange);
    if (forcedReaders.size === 0) {
      forcedQuery?.removeEventListener?.('change', forcedChanged);
      forcedQuery = undefined;
    }
  };
}
/** The shared query once anyone subscribes; before that (a first render) one is asked for, and not kept. */
const forcedNow = (): boolean => typeof window !== 'undefined' && ((forcedQuery ?? window.matchMedia?.(FORCED))?.matches ?? false);

/** Whether the reader's system is in forced colors, kept current as it changes. (`engine/ui` has no hook for it.) */
export function useForcedColors(): boolean {
  return useSyncExternalStore(subscribeForced, forcedNow, () => false);
}

/* -------------------------------------------------------------------------------- the ladder ---- */

/**
 * The script time a frame all the fog in view may take together, ms (measured at a phone's speed by e2e/hot-box.spec.ts). Raised from the design's 4 ms on the
 * owner's word, 2026-11-16, after the measured figures (a phone's viewport at a 4x CPU throttle: 7.6 to 9.4 ms at rung 0) and the owner's own check on a Pixel 8;
 * 8 ms is the tiled layer's own budget figure.
 */
export const FOG_BUDGET_MS = 8;
/** How many of the painter's last frames the mean is taken over, at most. */
const LADDER_FRAMES = 30;
/** The rungs, by level: the cell's side (px), the rounds of the pressure solve, and whether the fog is drawn from the model with no field. */
const RUNGS: readonly { readonly cell: number; readonly rounds: number; readonly direct: boolean }[] = [
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
const LADDER_FIRST = 8;

/** A smoked post on the ladder: its rung, whether a pointer is on it, the last frame it painted in (the ladder's count), and the step down. */
interface Rung { level(): number; pointed(): boolean; paintedIn(): number; lower(to: number): void }
/* One budget for the page: every smoked post's painter adds its time to the frame it ran in, and the mean of the last frames decides. */
const ladder = { rungs: new Set<Rung>(), stamp: null as number | null, seen: new Set<string>(), spent: 0, painted: false, kept: [] as number[], frames: 0, skipping: false };
/* Each smoked post's own name in the ladder's frames: the same play can be shown twice on a page (in its thread and in an ORIGIN box), so the play's id is not one. */
let painters = 0;

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
  const next = open.find((r) => !r.pointed()) ?? open[0];
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
function spend(key: string, stamp: number | null, ms: number): void {
  if (stamp === null) return;
  if (stamp !== ladder.stamp || ladder.seen.has(key)) { closeFrame(); ladder.stamp = stamp; ladder.seen.clear(); }
  ladder.seen.add(key);
  if (ladder.skipping) return;
  ladder.spent += ms;
  ladder.painted = true;
}

let forcedLevel: number | null = null;
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
function joinRest(tick: () => void): () => void {
  resting.add(tick);
  restTimer ??= setTimeout(restTick, REST_MS);
  return () => {
    resting.delete(tick);
    if (resting.size === 0 && restTimer !== undefined) { clearTimeout(restTimer); restTimer = undefined; }
  };
}

/* -------------------------------------------------------------------------------- the scratch ---- */

/**
 * The fog is worked out as bytes, a cell to a pixel, and reaches a tile through one small canvas the whole page shares: the bytes are put on it and it is
 * drawn onto the tile, scaled up smooth. It is as wide as the widest field and as tall as a tile's rows (a few hundred px by about a hundred), never the
 * size of a post. A browser that gives it no 2D context has none, and the tile is filled flat instead.
 */
interface Scratch { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D; readonly images: Map<string, ImageData> }
let scratch: Scratch | null | undefined;
function scratchFor(w: number, h: number): { readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D; readonly img: ImageData } | null {
  if (scratch === undefined) {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    const ctx = canvas?.getContext?.('2d') ?? null;
    scratch = canvas && ctx ? { canvas, ctx, images: new Map() } : null;
  }
  if (!scratch || w <= 0 || h <= 0) return null;
  /* Grown, never shrunk: assigning a size clears a canvas, and the bytes put on it each time cover what is drawn from it. */
  if (scratch.canvas.width < w) scratch.canvas.width = w;
  if (scratch.canvas.height < h) scratch.canvas.height = h;
  const key = `${w}x${h}`;
  let img = scratch.images.get(key);
  if (!img) {
    /* A post's tiles are of two heights at most; a few sizes are kept so two posts in view do not make their bytes again every frame. */
    if (scratch.images.size >= 8) scratch.images.clear();
    img = scratch.ctx.createImageData(w, h);
    scratch.images.set(key, img);
  }
  return { canvas: scratch.canvas, ctx: scratch.ctx, img };
}
/** For tests: the scratch canvas is the page's, and a test must start with none. */
export function forgetScratch(): void { scratch = undefined; }

/* -------------------------------------------------------------------------------- the model's state ---- */

/**
 * A held sweep: where it began, the post's lines (in the content area's px: the words' lines, offset by where the words stand in the area) and their words,
 * and when the hold was let go (null while held). It travels the words' lines, so `x0` and `y0` are the words' corner in the area, `width` the words' width
 * and `height` their height, which a reflow is told by.
 */
interface Sweep {
  readonly startedAt: number;
  readonly lines: readonly SweepLine[];
  readonly texts: readonly string[];
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
  /** ms a line takes: the box's width at Whoops!'s pace. */
  readonly per: number;
  readonly releasedAt: number | null;
}
/**
 * What this screen's reader has done to the smoke, in memory only: the mouse's clearing, the last touch's, the clearings left behind, the trail, the sweep,
 * and when the post was waved. `moves` is where the pointer last was (three of them, for its speed) and `mover` whose clearing it is moving.
 */
interface Model {
  mouse: Clearing | null;
  touch: Clearing | null;
  rest: Clearing[];
  trail: TrailPoint[];
  moves: { readonly x: number; readonly y: number; readonly t: number }[];
  mover: 'mouse' | 'touch' | null;
  sweep: Sweep | null;
  /** How many lines of the sweep have been read out. */
  said: number;
  wavedAt: number | null;
}
const emptyModel = (): Model => ({ mouse: null, touch: null, rest: [], trail: [], moves: [], mover: null, sweep: null, said: 0, wavedAt: null });

/** What is open: the clearings (the sweep's travelling one among them, and named as `lead`) and a band for each line the sweep has finished. */
interface Cuts { readonly clearings: readonly Clearing[]; readonly lead: Clearing | null; readonly rects: readonly { readonly top: number; readonly bottom: number; readonly o: number }[] }

const isWaved = (wavedAt: number | null, now: number): boolean => wavedAt !== null && now - wavedAt < SMOKE.waved;

/** How clear the whole post is from a wave: 1 while waved, then down to 0 over `roll` (under reduced motion, at once). */
function waveFactor(wavedAt: number | null, now: number, reduced: boolean): number {
  if (wavedAt === null) return 0;
  const over = now - wavedAt - SMOKE.waved;
  if (over < 0) return 1;
  return reduced ? 0 : Math.max(0, 1 - over / SMOKE.roll);
}

/** A clearing that has closed and rolled out for good. */
const dead = (c: Clearing, now: number): boolean => c.leftAt !== null && now >= c.leftAt + c.hold + SMOKE.roll;

function prune(m: Model, now: number): void {
  m.rest = m.rest.filter((c) => !dead(c, now));
  if (m.touch && dead(m.touch, now)) m.touch = null;
  if (m.trail.length > 0 && now - m.trail[0]!.leftAt >= SMOKE.wake) m.trail = m.trail.filter((p) => now - p.leftAt < SMOKE.wake);
  if (m.sweep && m.sweep.releasedAt !== null && now >= m.sweep.releasedAt + SMOKE.roll) m.sweep = null;
}

/** Where the sweep's clearing is at `now`, with motion and while it travels; null otherwise. */
function leadOf(sw: Sweep | null, now: number, reduced: boolean): Clearing | null {
  if (!sw || reduced) return null;
  const s = sweepAt(sw.lines, (sw.releasedAt ?? now) - sw.startedAt, sw.width, SWEEP_PX_S);
  return s.done ? null : { x: sw.x0 + s.x, y: s.y, openedAt: sw.startedAt, leftAt: sw.releasedAt, hold: 0 };
}

/** The held sweep leaves a trail as a pointer does: where its clearing is now is added to it. */
function feedSweep(m: Model, now: number, reduced: boolean, radius: number): void {
  const sw = m.sweep;
  if (!sw || sw.releasedAt !== null) return;
  const lead = leadOf(sw, now, reduced);
  if (lead) m.trail = extendTrail(m.trail, lead.x, lead.y, now, radius);
}

/** What is open at `now`: each clearing and, from the sweep, a band for each finished line and (with motion) the clearing travelling along the line. */
function cutsAt(m: Model, now: number, reduced: boolean): Cuts {
  const clearings = [m.mouse, m.touch, ...m.rest].filter((c): c is Clearing => c !== null && openness(c, now, reduced) > 0);
  const rects: { top: number; bottom: number; o: number }[] = [];
  const sw = m.sweep;
  let lead: Clearing | null = null;
  if (sw) {
    const s = sweepAt(sw.lines, (sw.releasedAt ?? now) - sw.startedAt, sw.width, SWEEP_PX_S);
    const o = openness({ x: 0, y: 0, openedAt: sw.startedAt, leftAt: sw.releasedAt, hold: 0 }, now, reduced);
    if (o > 0) {
      for (let i = 0; i <= s.finished; i++) rects.push({ top: sw.lines[i]!.top, bottom: sw.lines[i]!.bottom, o });
      lead = leadOf(sw, now, reduced);
      if (lead) clearings.push(lead);
    }
  }
  return { clearings, lead, rects };
}

/** How fast the pointer is moving, px a second, over its last moves; nothing once it has been still for `IDLE_MS`. */
function velocityOf(m: Model, now: number): { x: number; y: number } {
  const a = m.moves[0], b = m.moves[m.moves.length - 1];
  if (!a || !b || a === b || now - b.t > IDLE_MS || b.t <= a.t) return { x: 0, y: 0 };
  const s = (b.t - a.t) / 1000;
  return { x: (b.x - a.x) / s, y: (b.y - a.y) / s };
}

/**
 * When the model next needs to be looked at (an epoch ms), or null: a line of the sweep finishing, a post's wave ending, a clearing closing, a trail point
 * shutting (where no frame draws the trail: `frames` is false), the strength moving a hundredth (none where `fixed`: the strength is taken at a fixed moment, so no wake is needed as it thins). `animate` is the forced-colors mask in view, which is moved by this timer and nothing else.
 */
export function nextWake(m: Model, now: number, o: { readonly reduced: boolean; readonly animate: boolean; readonly fixed: boolean; readonly frames: boolean; readonly playedAt: number; readonly ends: number }): number | null {
  const at: number[] = [];
  const ticks = o.animate && !o.reduced;
  const sw = m.sweep;
  if (sw && sw.releasedAt === null) {
    at.push(sw.startedAt + (Math.floor((now - sw.startedAt) / sw.per) + 1) * sw.per);
    if (ticks) at.push(now + TICK_MS);
  } else if (sw) {
    const end = sw.releasedAt! + SMOKE.roll;
    at.push(ticks && now < end ? now + TICK_MS : end);
  }
  for (const c of [m.mouse, m.touch, ...m.rest]) {
    if (!c || c.leftAt === null) continue;
    const closing = c.leftAt + c.hold;
    const end = closing + SMOKE.roll;
    /* A clearing is open through `closing` itself and gone after it, so under reduced motion the screen is drawn again one ms past it. */
    if (now <= closing) at.push(closing + 1);
    else if (now < end) at.push(ticks ? now + TICK_MS : end);
    /* The forced-colors disc is there through the moment the clearing is half closed, and gone after it. */
    const half = closing + SMOKE.roll * (1 - SMOKE.trailHard);
    if (o.animate && now <= half) at.push(half + 1);
  }
  /* Where frames repaint the trail (`frames`: the full effect), it needs no wake of its own: each point's end is drawn by the frame it passes in. */
  if (!o.frames) for (const p of m.trail) {
    /* A trail point is a hard disc, and open under reduced motion, until `trailHard` of its wake; then it is gone from both. */
    const shut = p.leftAt + SMOKE.wake * SMOKE.trailHard;
    if (now < shut) at.push(shut);
    else if (now < p.leftAt + SMOKE.wake) at.push(p.leftAt + SMOKE.wake);
  }
  if (m.wavedAt !== null) {
    const clear = m.wavedAt + SMOKE.waved;
    if (now < clear) at.push(clear);
    else if (now < clear + SMOKE.roll) at.push(ticks ? now + TICK_MS : clear + SMOKE.roll);
  }
  if (!o.fixed && Number.isFinite(o.ends) && o.ends > o.playedAt && now < o.ends) {
    const span = o.ends - o.playedAt;
    const s = strength(now, o.playedAt, o.ends);
    at.push(o.ends - (Math.floor(s * 100 - 1e-9) / 100) * span);
  }
  const ahead = at.filter((t) => t > now);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

/* -------------------------------------------------------------------------------- small helpers ---- */

const a4 = (n: number): number => Number(n.toFixed(4));
const px = (n: number): number => Number(n.toFixed(2));

/** The play's color as a triple: `rgbOf` reads a named color (its table), `#rgb` and `#rrggbb`; anything it cannot read is light gray. */
function readColor(ink: unknown): readonly [number, number, number] {
  try {
    return typeof ink === 'string' ? rgbOf(ink) : LIGHT_GRAY;
  } catch {
    return LIGHT_GRAY;
  }
}

/** A seed from the play's id: the same smoke on every redraw of a screen, with no `Math.random`. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * The boxes the effect reads, in CSS px. The content area (`w`, `h`, placed at `top` and `left` from the effect's element) is the container: the fog's field
 * and a clearing's radius are its, and a clearing's coordinates are in it. The words stand in it at (`wx`, `wy`) and are `ww` by `wh`: the sweep's lines,
 * and the forced-colors mask's coordinates, are theirs.
 */
interface Frame { readonly w: number; readonly h: number; readonly top: number; readonly left: number; readonly wx: number; readonly wy: number; readonly ww: number; readonly wh: number }
const NO_FRAME: Frame = { w: 0, h: 0, top: 0, left: 0, wx: 0, wy: 0, ww: 0, wh: 0 };

/**
 * The words' mask, forced colors only: the flat layer, a hard disc for each of the model's `hardDiscs`, a rectangle for each finished line; none while the
 * post is clear. The discs and bands are in the content area's coordinates and the mask is the words' own, so each is moved by where the words stand in the
 * area (`ox`, `oy`); the radius is the area's.
 */
function maskFor(discs: readonly { readonly x: number; readonly y: number }[], rects: Cuts['rects'], s: number, g: number, r: number, ox: number, oy: number): CSSProperties | undefined {
  if (g >= 1) return undefined;
  const flat = maskAlpha(s) + (1 - maskAlpha(s)) * g;
  const images = [`linear-gradient(rgba(0, 0, 0, ${a4(flat)}), rgba(0, 0, 0, ${a4(flat)}))`];
  const sizes = ['100% 100%'];
  const positions = ['0 0'];
  for (const c of discs) {
    images.push(`radial-gradient(circle ${r}px at ${px(c.x - ox)}px ${px(c.y - oy)}px, rgba(0, 0, 0, 1) ${r}px, rgba(0, 0, 0, 0) ${r}px)`);
    sizes.push('100% 100%');
    positions.push('0 0');
  }
  for (const rect of rects) {
    images.push(`linear-gradient(rgba(0, 0, 0, ${a4(rect.o)}), rgba(0, 0, 0, ${a4(rect.o)}))`);
    sizes.push(`100% ${px(rect.bottom - rect.top)}px`);
    positions.push(`0 ${px(rect.top - oy)}px`);
  }
  const image = images.join(', ');
  return {
    maskImage: image, WebkitMaskImage: image,
    maskSize: sizes.join(', '), WebkitMaskSize: sizes.join(', '),
    maskPosition: positions.join(', '), WebkitMaskPosition: positions.join(', '),
    maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat',
    maskComposite: 'add', WebkitMaskComposite: 'source-over',
  };
}

/* -------------------------------------------------------------------------------- the effect ---- */

export function HotBoxEffect(props: EffectProps) {
  const { plays, moment, show, children } = props;
  /* A play an admin ended, or that did not take, or a trap caught, is no smoke. */
  const standing = plays.filter((p) => !p.reversed && !p.untaken && !p.caught && !p.faceDown);
  const endOf = (p: CardPlay): number => { const t = p.ends === undefined ? Number.NaN : Date.parse(p.ends); return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t; };
  const live = useAt(moment ? [] : standing.map(endOf).filter(Number.isFinite));
  /* A moment's time is fixed: the play drawn is the first whose end is after it, as at that time. */
  const now = moment ? moment.at : live;
  const play = standing.find((p) => endOf(p) > now);
  useEffect(() => { if (!play) show(null); }, [show, play]);
  if (!play) return <>{children}</>;
  /* Keyed by the play: a second cast after the first ended starts with nothing cleared. */
  return <Smoke key={play.id} {...props} play={play} />;
}

/**
 * What the painter keeps between frames: the field, the rung, when it last stepped, which tiles it has painted in the frame it is in, and the rows of the
 * box something is still happening in this frame (`all` for every row, null for none), which each tile painted in the frame marks itself stale by, and the
 * ladder's count of frames as of the last one it painted in.
 */
interface Painter { field: FogField | null; level: number; steppedAt: number; stamp: number | null; seen: Set<number>; live: { readonly top: number; readonly bottom: number } | 'all' | null; paintedIn: number }

function Smoke({ place, play, moment, show, met, covered, children }: EffectProps & { readonly play: CardPlay }) {
  const { api } = useKayfa();
  const reduced = useMotionReduced();
  const forced = useForcedColors();
  const hostRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<TileLayer | null>(null);
  const model = useRef<Model>(emptyModel());
  const startedAt = useRef(api.now());
  const own = useMemo(() => ++painters, []);
  const painter = useRef<Painter>({ field: null, level: 0, steppedAt: api.now(), stamp: null, seen: new Set(), live: null, paintedIn: Number.NEGATIVE_INFINITY });
  /* What render shows is as of the last `refresh`: the page's clock then, and a count so a change always draws again. */
  const [at, setAt] = useState(() => api.now());
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const [spoken, setSpoken] = useState('');
  const [frame, setFrame] = useState<Frame>(NO_FRAME);
  /* The content area's element as the last measure found it (the post body, the ORIGIN box's area, or the host where there is none): the observers and listeners are bound to it, and move when it is replaced. */
  const [areaEl, setAreaEl] = useState<HTMLElement | null>(null);
  /* Whether the post's content area is on screen, as the observer last said: `met` waits for the first sight, the forced-colors mask's timer runs only while it is in view, and a post that leaves the view is given its rungs back. */
  const [areaSeen, setInView] = useState(false);
  /* A post under a curtain is out of view whatever the observer says: nothing is met, rested or animated until it opens, and then the post is seen as if it had just scrolled in. */
  const inView = areaSeen && !covered;

  const playedAt = Date.parse(play.playedAt);
  const ends = play.ends === undefined ? Number.NaN : Date.parse(play.ends);
  const rgb = useMemo(() => readColor(play.config['color']), [play.config]);
  const seed = useMemo(() => seedOf(play.id), [play.id]);

  /* The fog moves with motion, off the forced-colors path (which has no layer), and not while the post is waved (nothing is drawn then; the render at the end of the wave draws again). The layer holds tiles only near the window, so whether the post is in view is not this flag's question. */
  const waved = isWaved(model.current.wavedAt, at);
  const loop = !reduced && !forced && !waved;
  /* The time the smoke's strength is taken at: a moment's, fixed, or null for the page's clock. */
  const fixedAt = moment ? moment.at : null;
  const latest = useRef({ frame, reduced, forced, fixedAt, loop, rgb, seed, playedAt, ends, inView });
  useLayoutEffect(() => { latest.current = { frame, reduced, forced, fixedAt, loop, rgb, seed, playedAt, ends, inView }; });

  /*
   * Time. One timer, set for the soonest thing the model needs looked at after the last time it was (`seen`): a line of the sweep finishing, the wave's end,
   * a clearing closing or a trail point shutting (every `TICK_MS` while the forced-colors mask is moving), the strength moving a hundredth. It sets the next
   * as it fires, so it never waits on a render, and a late timer catches up on what it missed. Every `refresh` sets it again.
   */
  const seen = useRef(api.now());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stepRef = useRef<() => void>(() => {});
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const L = latest.current;
    const wake = nextWake(model.current, seen.current, { reduced: L.reduced, animate: L.forced && L.inView, fixed: L.fixedAt !== null, frames: L.loop, playedAt: L.playedAt, ends: L.ends });
    if (wake === null) return;
    timer.current = setTimeout(() => stepRef.current(), Math.min(TIMER_MOST, Math.max(1, Math.ceil(wake - api.now()))));
  }, [api]);
  /* The screen is rendered again as of now; with motion the tiles are painted in the next frame too, since no loop paints them. */
  const refresh = useCallback(() => {
    seen.current = api.now();
    setAt(seen.current);
    bump();
    schedule();
    if (latest.current.loop) layerRef.current?.stale();
  }, [api, schedule]);
  /* The reader changed something at `y` of the box (anywhere, when not given): draw it. With motion the tiles it reaches are painted in the next frame; the other ways need the screen rendered again. */
  const changed = useCallback((y?: number) => {
    prune(model.current, api.now());
    if (!latest.current.loop) { refresh(); return; }
    const reach = holeRadius(latest.current.frame.w) * FOG.reach;
    layerRef.current?.stale(y === undefined ? undefined : { top: y - reach, bottom: y + reach });
  }, [api, refresh]);

  /* ---- the box ---- */
  /*
   * The container is the box Feelin' Fab's foil and Whoops!'s ink fill: the content area (a post's body in the thread, `.kb-act-main`, border to border (the engine's
   * `bodyOf` and `bodyBox`, engine/ui/cards/body.ts), and the ORIGIN box's area in the box; this effect's own element where there is none (Stick Around's view). The tile layer
   * finds it and tells `take` whenever it changes (`onBox`), and this effect finds it again at each of its own measures, which is how the forced-colors path (no layer) has it. The
   * words' own offset and size are measured here against that box.
   */
  const take = useCallback((b: BodyBox, found: HTMLElement | null) => {
    const words = wordsRef.current, host = hostRef.current;
    if (!words || !host) return;
    setAreaEl(found ?? host);
    const w = words.getBoundingClientRect(), h = host.getBoundingClientRect();
    /* The words' corner from the area's corner: both from the page's. */
    const wx = w.left - (h.left + b.left), wy = w.top - (h.top + b.top);
    setFrame((f) => (f.w === b.w && f.h === b.h && f.top === b.top && f.left === b.left && f.wx === wx && f.wy === wy && f.ww === w.width && f.wh === w.height
      ? f : { w: b.w, h: b.h, top: b.top, left: b.left, wx, wy, ww: w.width, wh: w.height }));
  }, []);
  /* The layer is told too: a takeover can move the words with no change of size, and the layer re-places its tiles from what it measures. */
  const measure = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    const found = bodyOf(host);
    take(bodyBox(host, found), found);
    layerRef.current?.measure();
  }, [take]);
  useLayoutEffect(() => {
    measure();
    const words = wordsRef.current, host = hostRef.current;
    if (!words || !host || typeof ResizeObserver === 'undefined') return;
    /* The host and the area too: the words can move in them with no change of their own size, and the area can change with none of the words'. */
    const watch = new ResizeObserver(measure);
    watch.observe(words);
    watch.observe(host);
    if (areaEl && areaEl !== host) watch.observe(areaEl);
    return () => watch.disconnect();
  }, [measure, areaEl, forced]);

  /* ---- the tiles ---- */
  /**
   * A frame has turned: the model is caught up, the field is stepped once (never once a tile), and the tiles moving fog is under are marked stale, so the next
   * frame paints them again. Moving fog is where a clearing or trail is moving, or the field's last step changed something (`busy`); a clearing the reader holds
   * still has settled, and is as still as fog at rest. A tile nothing is moving under is left to the page's 20-a-second timer.
   */
  const turn = useCallback((t: number, field: FogField, radius: number, direct: boolean, rounds: number) => {
    const m = model.current, L = latest.current, p = painter.current, layer = layerRef.current;
    feedSweep(m, t, L.reduced, radius);
    prune(m, t);
    const dt = t - p.steppedAt;
    p.steppedAt = t;
    const cuts = cutsAt(m, t, false);
    if (!direct) {
      const v = velocityOf(m, t), mover = m.mover === 'mouse' ? m.mouse : m.mover === 'touch' ? m.touch : null;
      const clearings: FogClearing[] = cuts.clearings.map((c) => ({
        x: c.x, y: c.y,
        ...(c === mover ? { vx: v.x, vy: v.y } : c === cuts.lead && c.leftAt === null ? { vx: SWEEP_PX_S, vy: 0 } : {}),
        burst: c === m.touch && t - c.openedAt < FOG.burst.ms,
      }));
      /* Only what the layer holds is stepped: the rows of its tiles, which are the ones near the window. */
      let top = Number.POSITIVE_INFINITY, bottom = Number.NEGATIVE_INFINITY;
      for (const tile of layer?.held() ?? []) { top = Math.min(top, tile.top); bottom = Math.max(bottom, tile.top + tile.h); }
      /* A field at rest is not stepped: with no box disturbed and nothing open to disturb one, the step would do nothing. */
      if (field.box || clearings.length > 0 || m.trail.length > 0) stepField(field, dt, {
        clearings, trail: m.trail, radius, rounds, ...(bottom > top ? { view: { top, bottom } } : {}),
        target: coverageOf(cuts.clearings, radius, t, false, m.trail),
      });
    }
    /* What is still happening, as rows of the box. */
    let top = Number.POSITIVE_INFINITY, bottom = Number.NEGATIVE_INFINITY;
    const span = (a: number, b: number) => { if (a < top) top = a; if (b > bottom) bottom = b; };
    const reach = radius * FOG.reach, moved = m.moves.length > 0 && t - m.moves[m.moves.length - 1]!.t <= IDLE_MS;
    for (const point of m.trail) span(point.y - radius, point.y + radius);
    for (const c of cuts.clearings) {
      /* A clearing left behind is closing or (a tap) bursting; one a pointer holds is happening while the pointer moves; the sweep's travels. */
      const live = c.leftAt !== null ? t > c.leftAt + c.hold || t - c.openedAt < FOG.burst.ms : c === cuts.lead || moved;
      if (live) span(c.y - reach, c.y + reach);
    }
    for (const rect of cuts.rects) if (rect.o < 1) span(rect.top, rect.bottom);
    if (!direct && field.box && field.busy) span(cellOrigin(field, 0, field.box.y0).y, cellOrigin(field, 0, field.box.y1).y);
    const g = waveFactor(m.wavedAt, t, L.reduced);
    p.live = g > 0 && g < 1 ? 'all' : bottom > top ? { top, bottom } : null;
    if (p.live === 'all') layer?.stale();
    else if (p.live) layer?.stale(p.live);
  }, []);

  /* A tile's canvas has been cleared, transformed to the box's px and clipped to the tile's rows by the layer (engine/ui/cards/tiles.ts), so this draws the fog's rows for the tile and one more at each end, and only the tile's rows are kept. */
  const paintTile = useCallback((draw: TileDraw) => {
    const { ctx, box } = draw, L = latest.current, p = painter.current;
    const { w, h } = box;
    if (w <= 0 || h <= 0) return;
    const began = performance.now();
    const t = api.now();
    const m = model.current;
    /* A moment draws the smoke at the strength it had then. */
    const s = strength(L.fixedAt ?? t, L.playedAt, L.ends);
    const g = waveFactor(m.wavedAt, t, L.reduced);
    if (g >= 1) return;
    const rung = RUNGS[forcedLevel ?? p.level]!;
    /* Drawn from the model with no field: reduced motion (still), and the ladder's last rung (which drifts and fades as the full effect does). */
    const direct = L.reduced || rung.direct;
    if (!p.field || p.field.width !== w || p.field.height !== h || p.field.cell !== rung.cell) p.field = makeField(w, h, rung.cell);
    const field = p.field, radius = holeRadius(w);
    /* The first tile painted in a frame turns it. A paint outside a frame (a commit that must not show bare words) draws the fog as it stands. */
    if (draw.frame !== null && (draw.frame !== p.stamp || p.seen.has(draw.index))) {
      p.stamp = draw.frame;
      p.seen.clear();
      turn(t, field, radius, direct, rung.rounds);
    }
    p.seen.add(draw.index);
    const alpha = fogAlpha(s) * (1 - g);
    const [r, gr, b] = L.rgb;
    const cuts: Cuts = cutsAt(m, t, L.reduced);
    const trail = m.trail;
    const rows = rowsOf(field, draw.top, draw.top + draw.h), n = rows.y1 - rows.y0;
    const sc = scratchFor(field.gw, n);
    if (!sc) {
      /* No scratch canvas: the fog's flat color, with the model's hard discs and the finished lines cut out of it, so the post can still be read through. */
      ctx.fillStyle = `rgba(${r}, ${gr}, ${b}, ${a4(alpha)})`;
      ctx.fillRect(0, draw.top, w, draw.h);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      for (const d of hardDiscs(cuts.clearings, trail, t)) { ctx.beginPath(); ctx.arc(d.x, d.y, radius, 0, Math.PI * 2); ctx.fill(); }
      for (const rect of cuts.rects) { ctx.fillStyle = `rgba(0, 0, 0, ${a4(rect.o)})`; ctx.fillRect(0, rect.top, w, rect.bottom - rect.top); }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      let reach: { left: number; top: number; right: number; bottom: number } | null = null;
      if (direct) for (const c of [...cuts.clearings, ...trail]) {
        reach = reach
          ? { left: Math.min(reach.left, c.x - radius), top: Math.min(reach.top, c.y - radius), right: Math.max(reach.right, c.x + radius), bottom: Math.max(reach.bottom, c.y + radius) }
          : { left: c.x - radius, top: c.y - radius, right: c.x + radius, bottom: c.y + radius };
      }
      paintFog(field, pageCloud(), sc.img.data, rows, {
        color: L.rgb, alpha, t: L.reduced ? 0 : t - startedAt.current, phase: { x: L.seed % 4096, y: (L.seed >>> 12) % 4096 }, bands: cuts.rects,
        ...(direct ? { direct: { target: coverageOf(cuts.clearings, radius, t, L.reduced, trail), reach } } : {}),
      });
      sc.ctx.putImageData(sc.img, 0, 0);
      const o = cellOrigin(field, 0, rows.y0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sc.canvas, 0, 0, field.gw, n, o.x, o.y, field.gw * field.cell, n * field.cell);
    }
    /* A tile painted later in the frame than the one that turned it was marked stale before its paint, and painting clears that mark: it marks itself again, so it is painted in the next frame too. */
    const live = p.live, bottom = draw.top + draw.h;
    if (draw.frame !== null && live !== null && (live === 'all' || (live.top < bottom && live.bottom > draw.top))) layerRef.current?.stale({ top: draw.top, bottom });
    spend(`${own}:${draw.index}`, draw.frame, performance.now() - began);
    if (draw.frame !== null) p.paintedIn = ladder.frames;
  }, [api, turn, own]);

  /* The layer is made in the commit that mounts the effect, and paints its first tiles in it (from the box and the window), so the words are never bare while an observer is awaited. Not on the forced-colors path, which draws no canvas. The fog asks for a density of 1. */
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || forced) return;
    const layer = makeTileLayer(host, { place, density: 1, className: 'dw-hotbox-smoke', standIn: 'dw-hotbox-far', paint: paintTile, onBox: take });
    layerRef.current = layer;
    return () => { layer.stop(); layerRef.current = null; painter.current.field = null; };
  }, [forced, place, paintTile, take]);
  /* A commit that turns the fog's motion on paints once itself, so no frame shows the words bare while the frame it asked for waits; from then the page's timer marks the fog at rest stale. */
  useLayoutEffect(() => {
    if (loop) layerRef.current?.paintNow();
  }, [loop, forced, place, paintTile, take]);
  /* Only a post in view joins the page's rest timer: one out of view holds no tiles that need to be drawn again, and a page of smoked posts would otherwise wake every 50 ms for them all. */
  useLayoutEffect(() => {
    if (!loop || !inView) return;
    /* The rest repaint is spread over frames, a tile a frame: the tiled layer's own budget is measured a frame at a time, and marking every held tile stale at once paints three or four whole tiles in one frame, which is the frame that is measured. Each tile is still drawn again about 20 times a second; the drift does not need its tiles in step (at 7 px a second, 16 ms is a tenth of a pixel at a seam). A tile already waiting is not queued twice, so a post with more tiles than fit in a tick runs into the next tick's turn and the queue never outgrows the held set. Tiles something live is happening under are repainted every frame by `turn`, and a mark on them changes nothing. */
    const waiting: { index: number; top: number; bottom: number }[] = [];
    const queued = new Set<number>();
    const markedAt = new Map<number, number>();
    let chain: ReturnType<typeof setTimeout> | undefined;
    const step = (): void => {
      chain = undefined;
      const next = waiting.shift();
      if (!next) return;
      queued.delete(next.index);
      markedAt.set(next.index, Date.now());
      layerRef.current?.stale(next);
      if (waiting.length > 0) chain = setTimeout(step, REST_STEP_MS);
    };
    const leave = joinRest(() => {
      const layer = layerRef.current;
      if (!layer) return;
      for (const t of layer.held()) {
        if (queued.has(t.index)) continue;
        queued.add(t.index);
        waiting.push({ index: t.index, top: t.top, bottom: t.top + t.h });
      }
      /* The tile drawn longest ago goes first, so a post with more tiles than fit in a tick shares the frames fairly. */
      waiting.sort((a, b) => (markedAt.get(a.index) ?? -Infinity) - (markedAt.get(b.index) ?? -Infinity));
      /* A run begins a frame after its tick, so it never marks a tile for the frame the last run's final mark was made for. */
      if (chain === undefined && waiting.length > 0) chain = setTimeout(step, REST_STEP_MS);
    });
    return () => { leave(); if (chain !== undefined) clearTimeout(chain); chain = undefined; waiting.length = 0; queued.clear(); markedAt.clear(); };
  }, [loop, inView, forced, place, paintTile, take]);
  /* Without motion the tiles are drawn after every render: a render is how a change reaches them. */
  useLayoutEffect(() => { if (!loop) layerRef.current?.paintNow(); });

  /* ---- the ladder ---- */
  const setLevel = useCallback((level: number) => {
    painter.current.level = level;
    hostRef.current?.setAttribute('data-dw-fog-level', String(forcedLevel ?? level));
  }, []);
  useEffect(() => {
    if (!loop) return;
    const rung: Rung = {
      level: () => painter.current.level,
      pointed: () => model.current.mouse !== null || model.current.touch !== null,
      paintedIn: () => painter.current.paintedIn,
      lower: (to) => setLevel(Math.min(FOG_LEVEL_MOST, Math.max(painter.current.level + 1, to))),
    };
    ladder.rungs.add(rung);
    return () => { ladder.rungs.delete(rung); };
  }, [loop, setLevel]);
  /* A post that has left the view has its rungs back for the next time it is seen. */
  const wasInView = useRef(false);
  useEffect(() => {
    if (wasInView.current && !inView) setLevel(0);
    wasInView.current = inView;
  }, [inView, setLevel]);

  /* ---- in view, and met ---- */
  useEffect(() => {
    if (!areaEl) return;
    /* The content area is what the smoke covers, so it is what is watched, with a margin above and below. */
    return watchInView(areaEl, setInView, { rootMargin: '200px 0px' });
  }, [areaEl]);
  useEffect(() => { refresh(); }, [inView, fixedAt, refresh]);
  /* Met waits for the first sight of the post: the layer holds tiles near the window and says nothing of them, so the observer on the area is asked for this alone. */
  const met1 = useRef(false);
  useEffect(() => {
    if (moment !== null || !inView || met1.current) return;
    met1.current = true;
    met();
  }, [moment, inView, met]);

  /* ---- the pointer: on the content area, passive, never prevented, never captured ---- */
  useEffect(() => {
    if (!areaEl) return;
    /* The pointer is read on the content area, which the smoke fills (the host where there is none), and placed in its padding box. */
    const area = areaEl;
    const at = (e: PointerEvent) => { const r = area.getBoundingClientRect(); return { x: e.clientX - r.left - area.clientLeft, y: e.clientY - r.top - area.clientTop }; };
    /* Whatever the engine lifts over the ink inside this area (the reactions row, the ORIGIN box's History) is a way through of its own and not the words: a press on one clears nothing. The area is
       found again here, since a lifted thing that holds it (the ORIGIN box, lifted whole over the opening post's smoke) is no part of it. A thing lifted inside the words is not lifted while they are
       inert (a fold's bar under smoke, hot-box.css): it is under the smoke like the words, and a press on it clears as a press on them does. */
    const lifted = (e: Event) => {
      const words = wordsRef.current;
      if (words?.hasAttribute('inert') && e.target instanceof Node && words.contains(e.target)) return false;
      return liftedOver(e.target, hostRef.current ? bodyOf(hostRef.current) : null);
    };
    /* Where the pointer is now: its clearing moves there, its speed is kept from its last three moves, and the trail takes the point. */
    const track = (who: 'mouse' | 'touch', x: number, y: number, t: number) => {
      const m = model.current;
      if (m.mover !== who) m.moves = [];
      m.mover = who;
      m.moves = [...m.moves.slice(-2), { x, y, t }];
      m.trail = extendTrail(m.trail, x, y, t, holeRadius(latest.current.frame.w));
    };
    const follow = (e: PointerEvent) => {
      const m = model.current, { x, y } = at(e), t = api.now();
      m.mouse = { x, y, openedAt: m.mouse?.openedAt ?? t, leftAt: null, hold: 0 };
      track('mouse', x, y, t);
      return y;
    };
    /* The mouse's clearing closes where it is and rolls out, as when the pointer leaves the area. */
    const closeMouse = () => {
      const m = model.current;
      if (!m.mouse) return;
      const y = m.mouse.y;
      m.rest.push({ ...m.mouse, leftAt: api.now() });
      m.mouse = null;
      if (m.mover === 'mouse') { m.mover = null; m.moves = []; }
      changed(y);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        /* A finger moves only while it is down: its clearing goes with it and holds `touchHold` from where it was last, and its drag leaves a wake. A swipe the browser takes for a scroll sends no move. */
        const m = model.current;
        if (!m.touch || lifted(e)) return;
        const { x, y } = at(e), t = api.now();
        m.touch = { x, y, openedAt: m.touch.openedAt, leftAt: t, hold: SMOKE.touchHold };
        track('touch', x, y, t);
        changed(y);
        return;
      }
      /* Pointing at a lifted thing ends the clearing, or the words beside it are read for free. */
      if (lifted(e)) { closeMouse(); return; }
      changed(follow(e));
    };
    const onDown = (e: PointerEvent) => {
      if (lifted(e)) { if (e.pointerType !== 'touch') closeMouse(); return; }
      if (e.pointerType === 'touch') {
        /* A finger cannot stay in place and scroll too: its clearing is opened where it lands and holds `touchHold`, replacing the last. */
        const { x, y } = at(e), t = api.now(), m = model.current;
        m.touch = { x, y, openedAt: t, leftAt: t, hold: SMOKE.touchHold };
        m.mover = 'touch';
        m.moves = [{ x, y, t }];
        changed(y);
      } else changed(follow(e));
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') closeMouse();
    };
    const passive = { passive: true } as const;
    area.addEventListener('pointermove', onMove, passive);
    area.addEventListener('pointerdown', onDown, passive);
    area.addEventListener('pointerleave', onLeave, passive);
    return () => {
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerdown', onDown);
      area.removeEventListener('pointerleave', onLeave);
    };
  }, [api, changed, areaEl]);

  /* ---- the hold ---- */
  const start = useCallback(() => {
    const m = model.current, L = latest.current;
    if ((m.sweep && m.sweep.releasedAt === null) || isWaved(m.wavedAt, api.now())) return;
    const words = wordsRef.current;
    const { wx, wy, ww: w, wh: h } = L.frame;
    if (!words || w <= 0 || h <= 0) return;
    /* The words' lines, read once: shares of the words' height, scaled to px and moved to where the words stand in the content area. A browser that cannot measure a range gives none, and the post is one block. */
    const read = readLines(words, { w, h });
    const lines = read.length > 0 ? read : [{ top: 0, bottom: 1, text: words.textContent ?? '' }];
    m.sweep = {
      startedAt: api.now(), lines: lines.map((l) => ({ top: px(l.top * h + wy), bottom: px(l.bottom * h + wy) })), texts: lines.map((l) => l.text),
      x0: wx, y0: wy, width: w, height: h, per: (w / SWEEP_PX_S) * 1000, releasedAt: null,
    };
    m.said = 0;
    setSpoken('');
    refresh();
  }, [api, refresh]);

  /** Catches a held sweep up to `t`: the lines it finished are read out, and one that reached the end makes the post waved from the moment its last line finished. */
  const settle = useCallback((t: number) => {
    const m = model.current, sw = m.sweep;
    if (!sw || sw.releasedAt !== null) return;
    const s = sweepAt(sw.lines, t - sw.startedAt, sw.width, SWEEP_PX_S);
    if (s.finished + 1 > m.said) {
      setSpoken(sw.texts.slice(m.said, s.finished + 1).join(' '));
      m.said = s.finished + 1;
    }
    if (s.done) {
      m.wavedAt = sw.startedAt + sw.lines.length * sw.per;
      m.sweep = null;
    }
  }, []);

  const stop = useCallback(() => {
    const m = model.current;
    if (!m.sweep || m.sweep.releasedAt !== null) return;
    const t = api.now();
    /* A release handled before the timer for the last line fires (a late timer) still finds the hold at its end. */
    settle(t);
    const held = model.current.sweep;
    if (held && held.releasedAt === null) m.sweep = { ...held, releasedAt: t };
    refresh();
  }, [api, refresh, settle]);
  /* Words that reflow, or move in the area, mid-hold leave the sweep on the old layout, so the hold is let go. */
  useEffect(() => {
    const sw = model.current.sweep;
    /* Within half a px is the same layout (a float's rounding, a sign that re-wraps by a sliver), not a move. */
    const off = (a: number, b: number) => Math.abs(a - b) > SHIFT_PX;
    if (sw && sw.releasedAt === null && (off(sw.width, frame.ww) || off(sw.height, frame.wh) || off(sw.x0, frame.wx) || off(sw.y0, frame.wy))) stop();
  }, [frame.ww, frame.wh, frame.wx, frame.wy, stop]);
  /* A hold ends with the effect (nothing is drawn or timed after it). */
  useEffect(() => () => {
    const m = model.current;
    if (m.sweep && m.sweep.releasedAt === null) m.sweep = { ...m.sweep, releasedAt: api.now() };
  }, [api]);

  /* ---- time: what the timer does when it fires ---- */
  const step = useCallback(() => {
    const t = api.now(), L = latest.current;
    settle(t);
    /* Where no frame turns (the forced-colors mask), the sweep's trail is fed here. */
    if (L.forced) feedSweep(model.current, t, L.reduced, holeRadius(L.frame.w));
    prune(model.current, t);
    refresh();
  }, [api, refresh, settle]);
  useLayoutEffect(() => { stepRef.current = step; });
  useEffect(() => {
    schedule();
    return () => clearTimeout(timer.current);
  }, [schedule, reduced, forced, inView, fixedAt, playedAt, ends]);

  /* The words go inert as the waved window ends. Focus is not thrown: only focus that was inside the words, which the browser would drop, goes to the post's Hot Box mark, the nearest thing that names the state and opens the way back. */
  const wasWaved = useRef(false);
  useLayoutEffect(() => {
    const words = wordsRef.current, host = hostRef.current;
    if (wasWaved.current && !waved && words && host && document.activeElement && words.contains(document.activeElement)) markOf(host, play.card)?.focus();
    wasWaved.current = waved;
  }, [waved, play.card]);

  /* ---- what the reader is shown, and what the Lens is told ---- */
  const m = model.current;
  const held = m.sweep !== null && m.sweep.releasedAt === null;
  const s = strength(fixedAt ?? at, playedAt, ends);
  const g = waveFactor(m.wavedAt, at, reduced);
  const state = waved ? STATE_WAVED : held ? STATE_WAVING : STATE_SMOKE;
  const endsText = `Point at the words, or hold ${WAVE_LABEL}, to read.${play.ends === undefined ? '' : ` ${endsWords(play.ends, fixedAt ?? at)}.`}`;
  const progress = Math.round((1 - s) * 100) / 100;
  const view = useMemo<CardView>(() => ({
    progress, state, ends: endsText, yours: !waved,
    controls: [{ kind: 'hold', label: WAVE_LABEL, describe: WAVE_DESCRIBE, start, stop }],
    notes: {},
  }), [progress, state, endsText, waved, start, stop]);
  useEffect(() => { show(view); }, [show, view]);
  useEffect(() => () => show(null), [show]);

  void tick;
  const radius = holeRadius(frame.w);
  const cuts = forced ? cutsAt(m, at, reduced) : null;
  const discs = cuts ? hardDiscs(cuts.clearings, m.trail, at) : [];
  const mask = cuts ? maskFor(discs, cuts.rects, s, g, radius, frame.wx, frame.wy) : undefined;

  /* The fog's color and alpha, for the stand-in of a band whose tile is not yet painted (hot-box.css): the same alpha the painter uses. */
  const standIn = forced ? undefined : { '--dw-hotbox-rgb': rgb.join(' '), '--dw-hotbox-fog': a4(fogAlpha(s) * (1 - g)) } as CSSProperties;

  return (
    <div ref={hostRef} className="dw-hotbox" data-kb-hotbox data-dw-fog-level={forcedLevel ?? 0} style={standIn}>
      {forced && <p className="dw-hotbox-sign"><strong>{state}.</strong> {endsText}</p>}
      {!waved && <p className="kb-visually-hidden dw-hotbox-way">{SMOKED_WAY}</p>}
      <div ref={wordsRef} className="dw-hotbox-words" inert={!waved} style={mask}>{children}</div>
      {forced && (
        <div className="dw-hotbox-frame" data-kb-effect-ink aria-hidden="true" style={{ top: frame.top, left: frame.left, width: frame.w, height: frame.h }}>
          {discs.map((c, i) => (
            <div key={i} className="dw-hotbox-ring" aria-hidden="true" style={{ left: px(c.x - radius), top: px(c.y - radius), width: radius * 2, height: radius * 2 }} />
          ))}
        </div>
      )}
      <p className="kb-visually-hidden" aria-live="polite">{spoken}</p>
    </div>
  );
}
