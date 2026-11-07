/**
 * The page's shine loop (docs/plans/2026-11-06-shine-design.md section 6): one animation frame loop serves every post's
 * shine canvas, in the shape of the Whoops! suds loop (instances/divided-world/cards/whoops/suds.ts) so that loop can move
 * here later. A host registers its canvas and a `draw`; the loop eases that host's light each frame and calls `draw`
 * when the light moved, when the host has something in flight, or on the idle cadence while shimmer runs.
 *
 * The loop is started on demand, when a registered host is in view and needs a frame, and stops itself when none does,
 * so an idle page costs nothing. A frame that throws never stops the loop: the next frame is asked for before this one
 * runs, and each host's draw is wrapped on its own, so one post's canvas costs only that post its frame. A host out of
 * view is not drawn; it is told once (`hidden`) so it can drop its buffers. A host that unregisters is never drawn again,
 * even later in the same frame. The module draws nothing and never sizes a canvas: that is the host's.
 *
 * A host may be drawn at a share of the rate (`Options.share`, issue #304): a post that paints its whole body, bigger than its words,
 * changes that much more of the screen in each draw, and on a software-composited page (CI's headless Chromium) the screen area a
 * frame changes is what costs the frame. So a host at a share of one half has half the moved and idle draws a full host has, and the
 * area its draws change in a second stays what its words' box changed at the full rate (engine/ui/cards/body.ts `paintShare`). Each
 * host keeps a credit that its share fills every frame it is in view (at most `CREDIT_CAP`): a moved draw spends 1 and an idle draw 2,
 * so a full host draws a moving light every frame and shimmers every second frame, as before, and the hosts' credits start spread
 * out, so hosts at a share do not all draw on the same frames. A full host keeps no credit: it draws as it always did. A fresh draw, and a draw while the host has something in flight (a
 * burst), are never held back and spend nothing.
 *
 * A moved or idle draw also says which rows of the canvas are on screen (`ShineFrame.span`: the viewport and `SPAN_MARGIN` above and
 * below it), so a host whose canvas reaches past the viewport redraws only those; its other rows keep what its last whole draw put
 * there, which is never blank: a fresh draw (the host's first, or its first back in view) and a busy one are whole.
 *
 * Units: `t` is the frame's timestamp in milliseconds, `dt` is seconds (at most 0.05), `light` is {x, y} in -1.5..1.5
 * (light.ts), `box` is the host's CSS px size, `density` is canvas px per CSS px, capped at `MAX_DENSITY`, a share is in (0, 1],
 * and a span is CSS px from the canvas's top.
 *
 * Engine code: it names no card and no instance.
 */
import { motionReduced, subscribeMotion } from '../appearance.ts';
import { watchInView } from './inView.ts';
import { watchTilt } from './tilt.ts';
import { ease, light, lightAt, type Light } from './light.ts';

export interface ShineFrame {
  readonly t: number;
  readonly dt: number;
  readonly light: Light;
  /** The light moved more than `MOVED` since the host last drew, a frame while shimmer runs (or this is its first draw). */
  readonly moved: boolean;
  /** This draw is the idle cadence's: shimmer is running and nothing else asked for it. */
  readonly idle: boolean;
  /**
   * The rows to redraw, in CSS px from the canvas's top (`top` < `bottom`), when the canvas reaches past the viewport and its margin;
   * null to redraw all of it (a fresh or busy draw, or a canvas wholly on screen). What lies outside the span keeps what was drawn.
   */
  readonly span: Span | null;
}

/** Rows of a canvas, in CSS px from its top. */
export interface Span { readonly top: number; readonly bottom: number }

/**
 * Summed |dx| + |dy| of the light since the last draw that earns a new one. While shimmer runs it is this much a frame since the last
 * draw, so a host waiting on its credit (a share under 1) does not count the idle drift that piled up meanwhile as a moving light (the
 * drift moves it under half of this a frame), and a slower move is drawn by the idle cadence. Under reduced motion there is no idle
 * cadence, so any move of this much since the last draw is drawn, and an easing light is drawn to where it settles.
 */
const MOVED = 0.004;
/** Eased light closer than this to its target is settled. */
const SETTLED = 0.0005;
const MAX_DENSITY = 2;
/** Shimmer redraws every second frame, about 30 a second. */
const IDLE_EVERY = 2;
/** Golden-angle step, so unseeded posts do not drift in lockstep. */
const PHASE_STEP = 2.399963;
/** A moved draw spends 1 of a host's credit and an idle draw `IDLE_COST`. */
const IDLE_COST = IDLE_EVERY;
/**
 * The most credit a host holds. An idle draw waits for an idle frame (every `IDLE_EVERY`th), so the credit can pass `IDLE_COST` before
 * one comes, by up to a frame's share for every frame waited: a cap of twice the cost keeps that excess, and a host at a share
 * shimmers at exactly that share of the full rate (a cap at the cost would round a share of two thirds down to a half). A full host
 * draws as it always did: a moving light every frame, the shimmer every second frame. After a rest, a host at a share draws a moving
 * light at the full rate for its first few frames, until the credit it saved is spent.
 */
const CREDIT_CAP = 2 * IDLE_COST;
/** The golden ratio's fraction, so the hosts' starting credits spread from 0 to an idle draw's cost. */
const SPREAD = 0.618034;
/**
 * The rows past the viewport, above and below, that a span keeps redrawing (CSS px): about what a fast scroll moves in the four frames a
 * host at the least share waits between draws, so the rows scrolling in were drawn at a light close to the one they show.
 */
export const SPAN_MARGIN = 120;

export interface Options {
  /** The host's own seed for its idle drift; by default one is derived from the order of registration. */
  readonly phase?: number;
  /** Called once when the host leaves view, so it can drop its buffers. It is drawn again, fresh, when it returns. */
  readonly hidden?: () => void;
  /** The share of the rate its moved and idle draws come at, in (0, 1] (default 1); anything else is 1. */
  readonly share?: number;
}

interface Reg {
  canvas: HTMLCanvasElement; box: { w: number; h: number }; density: number;
  draw: (frame: ShineFrame) => boolean; hidden: (() => void) | undefined; phase: number; share: number; credit: number; since: number;
  inView: boolean; fresh: boolean; busy: boolean; settling: boolean;
  cur: Light | null; drawn: Light | null; draws: number; stop: () => void;
}

const hosts = new Map<object, Reg>();
let handle: number | null = null;
let last = 0;
let frameCount = 0;
/* The loop's own time in each frame (ms, around `step`), for the last WORK_KEEP frames: a ring, two clock reads a frame, read only by `probe.work`. */
const WORK_KEEP = 600;
const worked = new Float64Array(WORK_KEEP);
let made = 0;
let spread = 0;
let unsubscribeMotion: (() => void) | null = null;
/* Held while any host is registered: the device's tilt probe runs for a page that shines (tilt.ts). */
let releaseTilt: (() => void) | null = null;

/* Who wants to know which shiny post is in view (the shine tip, engine/ui/tips/Tips.tsx). */
const shinyWatchers = new Set<(canvas: HTMLCanvasElement | null) => void>();
let announced: HTMLCanvasElement | null = null;
/** The first registered host among those in view: the design's "first time a shiny post is in view" is any shiny post, not the page's first. */
const shinyInView = (): HTMLCanvasElement | null => {
  for (const r of hosts.values()) if (r.inView) return r.canvas;
  return null;
};
/** Tells the watchers when the canvas of the first registered host in view changes. */
function announce(): void {
  const now = shinyInView();
  if (now === announced) return;
  announced = now;
  for (const w of [...shinyWatchers]) w(now);
}

/**
 * Calls `onChange` with the canvas of the first registered host that is in view (null when none is), now and whenever that
 * changes. The loop reaches no React and no tip; whoever draws a tip subscribes here. Returns the stop.
 */
export function watchShinyInView(onChange: (canvas: HTMLCanvasElement | null) => void): () => void {
  shinyWatchers.add(onChange);
  onChange(shinyInView());
  return () => { shinyWatchers.delete(onChange); };
}

const sum = (a: Light, b: Light) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Whether this host wants the next frame. */
const wants = (r: Reg, shimmer: boolean) => r.inView && (r.fresh || r.busy || r.settling || shimmer);
const anyWants = () => { const s = !motionReduced(); return [...hosts.values()].some((r) => wants(r, s)); };

function step(t: number): void {
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
  last = t;
  frameCount++;
  const shimmer = !motionReduced();
  /* A snapshot, and a check against the map, so a draw that unregisters any host is safe. */
  for (const [host, r] of [...hosts]) {
    if (hosts.get(host) !== r || !r.inView) continue;
    try {
      const rect = r.canvas.getBoundingClientRect();
      const target = lightAt(light.input(), rect, { height: window.innerHeight }, t, r.phase);
      /* A host's first light is its target; after that it eases. */
      r.cur = r.cur ? { x: ease(r.cur.x, target.x, dt), y: ease(r.cur.y, target.y, dt) } : target;
      r.settling = sum(r.cur, target) > SETTLED;
      r.credit = Math.min(CREDIT_CAP, r.credit + r.share);
      r.since++;
      const moved = r.drawn === null || sum(r.cur, r.drawn) > MOVED * (shimmer ? r.since : 1);
      const urgent = r.fresh || r.busy;
      /* A draw that is only the light moving, or the shimmer, waits for the host's credit; a fresh or busy one never does, and a
         full host keeps no credit at all, so it draws exactly as it did before shares. */
      const held = r.share < 1 && !urgent;
      const movedNow = moved && (!held || r.credit >= 1);
      const idle = shimmer && !moved && !urgent && frameCount % IDLE_EVERY === 0 && (!held || r.credit >= IDLE_COST);
      if (!(movedNow || urgent || idle)) continue;
      if (held) r.credit -= idle ? IDLE_COST : 1;
      r.fresh = false;
      r.since = 0;
      r.drawn = r.cur;
      r.draws++;
      r.busy = r.draw({ t, dt, light: r.cur, moved, idle, span: urgent ? null : spanOf(rect, window.innerHeight) });
    } catch (err) {
      console.error(err);
      r.busy = false;
    }
  }
}

/** The rows of a canvas at `rect` within the viewport and its margin, or null when that is all of them (or none can be read). */
function spanOf(rect: { readonly top: number; readonly height: number }, viewport: number): Span | null {
  if (!(rect.height > 0) || !(viewport > 0)) return null;
  const top = Math.max(0, -rect.top - SPAN_MARGIN), bottom = Math.min(rect.height, viewport - rect.top + SPAN_MARGIN);
  if (top <= 0 && bottom >= rect.height) return null;
  /* Off screen past the margin: an empty span would redraw nothing, so it is a row at the nearer edge (the loop draws only hosts in view). */
  return bottom > top ? { top, bottom } : null;
}

/** A frame that throws never stops the loop: the next one is asked for first. The loop stops itself when no host needs one. */
function frame(t: number): void {
  handle = requestAnimationFrame(frame);
  const began = performance.now();
  try { step(t); } catch (err) { console.error(err); }
  worked[frameCount % WORK_KEEP] = performance.now() - began;
  if (!anyWants()) { cancelAnimationFrame(handle); handle = null; }
}

/**
 * Reduced motion changed while the page was open (a setting, or the device's). Every host redraws once from a fresh light,
 * which under reduced motion is REST, and the loop then stops by itself; turned off, shimmer wakes a loop that had stopped.
 */
function onMotionChange(): void {
  for (const r of hosts.values()) { r.fresh = true; r.cur = null; }
  start();
}
const watchMotion = (): void => { unsubscribeMotion ??= subscribeMotion(onMotionChange); };
const unwatchMotion = (): void => { unsubscribeMotion?.(); unsubscribeMotion = null; };

function start(): void {
  if (handle !== null || !anyWants()) return;
  last = performance.now();
  handle = requestAnimationFrame(frame);
}

/**
 * Registers (or re-registers) a host's shine canvas, watches it with `watchInView`, and returns the density to size it
 * by (capped at 2). `draw` returns whether the host still has something in flight. The host draws once when first in view.
 */
export function register(
  host: object, canvas: HTMLCanvasElement, box: { w: number; h: number }, density: number,
  draw: (frame: ShineFrame) => boolean, options: Options = {},
): number {
  const old = hosts.get(host);
  old?.stop();
  const capped = Math.min(MAX_DENSITY, Math.max(0, density));
  const share = options.share !== undefined && options.share > 0 && options.share <= 1 ? options.share : 1;
  const reg: Reg = {
    canvas, box, density: capped, draw, hidden: options.hidden, phase: options.phase ?? old?.phase ?? made++ * PHASE_STEP,
    share, credit: old?.credit ?? ((spread++ * SPREAD) % 1) * IDLE_COST, since: 0,
    inView: false, fresh: true, busy: false, settling: false, cur: old?.cur ?? null, drawn: null, draws: old?.draws ?? 0, stop: () => {},
  };
  hosts.set(host, reg);
  watchMotion();
  releaseTilt ??= watchTilt();
  light.attach(host);
  reg.stop = watchInView(canvas, (inView) => {
    if (hosts.get(host) !== reg || reg.inView === inView) return;
    reg.inView = inView;
    announce();
    if (inView) { reg.fresh = true; reg.drawn = null; reg.cur = null; start(); return; }
    reg.busy = false;
    try { reg.hidden?.(); } catch (err) { console.error(err); }
  });
  announce();
  return capped;
}

/** Stops watching the host and never draws it again. */
export function unregister(host: object): void {
  const r = hosts.get(host);
  if (!r) return;
  hosts.delete(host);
  r.stop();
  light.detach(host);
  announce();
  if (hosts.size === 0) { unwatchMotion(); releaseTilt?.(); releaseTilt = null; }
}

/** The host has something new in flight (a burst): make sure a frame is coming. A host out of view waits until it is seen. */
export function wake(host: object): void {
  const r = hosts.get(host);
  if (!r) return;
  r.busy = true;
  start();
}

/** For tests only: what the loop has done and whether it runs, and a way back to a fresh page. */
export const probe = {
  draws: (host: object) => hosts.get(host)?.draws ?? 0,
  /** The share of the rate the host is drawn at (1 for a host not registered). */
  share: (host: object) => hosts.get(host)?.share ?? 1,
  frames: () => frameCount,
  /** The loop's own time in each of its last `n` frames (at most 600), oldest first, in milliseconds. */
  work(n: number = WORK_KEEP): number[] {
    const count = Math.min(n, WORK_KEEP, frameCount);
    return Array.from({ length: count }, (_, i) => worked[(frameCount - count + i + 1) % WORK_KEEP]!);
  },
  running: () => handle !== null,
  reset(): void {
    if (handle !== null) cancelAnimationFrame(handle);
    handle = null;
    for (const [host, r] of hosts) { r.stop(); light.detach(host); }
    hosts.clear();
    announce();
    unwatchMotion();
    releaseTilt?.();
    releaseTilt = null;
    frameCount = 0; made = 0; spread = 0; last = 0; worked.fill(0);
  },
};
