/**
 * Hot Box's effect on a post (docs/plans/2026-11-15-hot-box-plan.md, Task 4; design, section 2.2): smoke over the words, in the caster's color, for
 * three days, thinning as it goes. It is an obstacle read through by clearing it: a mouse or pen clears a patch where it points, a finger where it
 * touches, and a held control ("Wave the smoke") sweeps the post line by line at the pace of a hand. It is the same for every reader, the post's author
 * and the caster included, and it is the reader's own and on this screen only: nothing is saved, sent, counted or broadcast, so the effect reads neither
 * who wrote the post nor who played the card, and calls neither `save` nor `release`.
 *
 * Which play. The engine goes on handing an ended play to an effect, so this decides for itself whether its play is still up, against the page's clock
 * (`useAt` redraws when the soonest end passes, as Whodunnit?'s does). The first play whose end is ahead is the one drawn, so a second Hot Box cast after the first
 * ended is the one that shows. With none, the words are drawn alone.
 *
 * The container (the owner, 2026-11-15). The smoke fills the post's whole content area, border to border, as Feelin' Fab's foil and Whoops!'s ink do: the
 * post body (`.kb-act-main`) in the thread, found and measured with the engine's `bodyOf` and `bodyBox` (engine/ui/cards/body.ts), and this effect's own
 * element elsewhere (the ORIGIN box). The area's borders are the container, and no smaller un-bordered box in it is. Everything below that says "the box"
 * means that area: the canvas, the puffs, a clearing's radius, the density, where a pointer clears. Only the words' own lines are the words': the held
 * sweep travels them (offset into the area), and under forced colors the mask is the words' (so its coordinates are theirs).
 *
 * The model is `smoke.ts`'s (numbers, strength, clearings, the sweep) and this file draws it, in one of two ways that cost a reader the same:
 *  - the full effect: a canvas laid over the content area, filled with the play's color at the fog's opacity, drifting puffs over it, and each open clearing cut out
 *    of it with a soft edge (`destination-out`). It runs a frame loop only while the post is in view, and none under reduced motion, where it draws again
 *    only when something changes (a clearing opens or closes, the box resizes, the strength has moved a hundredth, a line of the sweep finishes);
 *  - under forced colors, where the fog cannot be drawn in system colors (the amendment at the top of the plan): the words themselves are masked, a flat layer
 *    at `maskAlpha` over the words, a hard-edged circle for each open clearing (same radius, same `roll`, same `touchHold`), a rectangle for each line the sweep
 *    has finished. The canvas is not drawn and no frame is requested; the mask is moved on a 50 ms timer, or on the times things change under reduced motion.
 *    A ring (system colors) shows where each clearing is, a sign says what the Lens says, and the content area is outlined in `CanvasText`, because a smoked post
 *    would otherwise look blank. The outline and the ring are drawn by a frame laid over the content area (`dw-hotbox-frame`), never by the words' own box, which its
 *    mask would take away with the rest; a ring may be anywhere in the area. With forced colors off none of this exists, and the canvas, its fog and its soft edge are exactly as above.
 *
 * Screen readers and the keyboard. While the play is up the words are `inert` (as Whoops! makes an inked body), so a link in a smoked post is followed after
 * a finished sweep: the control is the way through for every reader, a mouse's included, and it is never inert, never covered and drawn wherever the post is.
 * Each line the sweep finishes is put in a hidden live region, one at a time. A held sweep that reaches the end makes the post waved: for `SMOKE.waved` no fog
 * is drawn and the words are not inert, and then the smoke rolls back over `roll`. Letting go early lets it back over `roll`, and the words stay inert.
 *
 * The control carries `data-kb-over-ink`, as Below the Fold's bar does: it is drawn over another card's ink and stays usable there, and Whoops! starts no
 * scrub from a press on it. Nothing here is stopped or prevented: the pointer is read passively on the host, and a press reaches every listener above it.
 *
 * In a play's moment (`still`) the fog and puffs (or the flat mask layer alone, under forced colors) are drawn once as they stood, at full strength: no
 * handler, no control, nothing inert, no loop and no timer, and nothing met. The page's clock is `api.now()` throughout, never the page's own `Date`.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { bodyBox, bodyOf } from '../../../../engine/ui/cards/body.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { TIMER_MOST, useAt } from '../../../../engine/ui/cards/plays.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { readLines } from '../../cards/whoops/lines.ts';
import { SWEEP_PX_S } from '../../cards/whoops/scrub.ts';
import { rgbOf } from '../../cards/whoops/splat.ts';
import { SMOKE, covered, fogAlpha, holeRadius, maskAlpha, openness, puffAt, puffs, strength, sweepAt, type Clearing, type SweepLine } from './smoke.ts';
import './hot-box.css';

/** The control's label and its hidden description, which the Lens is given as well. */
export const WAVE_LABEL = 'Wave the smoke';
export const WAVE_DESCRIBE = `Hold Space or Enter on this button to wave the smoke off line by line, at the pace of a hand. Let go and it rolls back in. Hold to the end and the post stays clear for ${SMOKE.waved / 1000} seconds.`;

const STATE_SMOKE = 'Smoke over the words';
const STATE_WAVING = 'Waving it away';
const STATE_WAVED = 'Waved clear for you';

/** The most the canvas is scaled past the screen's px, and the most px it holds (a long post's canvas is scaled down to fit, not refused). */
const MAX_DPR = 2;
const MAX_CANVAS_PX = 16_000_000;
/** How far the words' offset or size may change mid-hold before the hold is let go, px. */
const SHIFT_PX = 0.5;
/** How often the forced-colors mask is moved while something in it is changing, ms. */
const TICK_MS = 50;
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

/* -------------------------------------------------------------------------------- puff sprites ---- */

/**
 * A puff is a soft disc fading to nothing at its rim. Every puff of a color is the same disc at another size and strength, so each color's disc is drawn once
 * into a small canvas of its own and shared by every smoked post on the page, and a frame draws a puff with `drawImage` (scaled to its radius) at the puff's
 * alpha, rather than building a radial gradient for each of up to 160 puffs a frame. A browser that gives no 2D context to an offscreen canvas has none, and a
 * puff is drawn from a gradient instead.
 */
const SPRITE_PX = 128;
const LIGHT = '255, 255, 255';
const DARK = '0, 0, 0';
const sprites = new Map<string, HTMLCanvasElement | null>();
/** Forgets every sprite, null ones included (for tests: the cache is shared by the page, and a test must start from none). */
export function forgetSprites(): void { sprites.clear(); }
function spriteOf(base: string): HTMLCanvasElement | null {
  if (sprites.has(base)) return sprites.get(base) ?? null;
  if (typeof document === 'undefined') return null;
  const sprite = document.createElement('canvas');
  sprite.width = SPRITE_PX;
  sprite.height = SPRITE_PX;
  const ctx = sprite.getContext?.('2d');
  /* A browser with no context for it is remembered as having none, so a frame does not make two canvases to find that out again. */
  if (!ctx) { sprites.set(base, null); return null; }
  const half = SPRITE_PX / 2;
  const soft = ctx.createRadialGradient(half, half, 0, half, half, half);
  soft.addColorStop(0, `rgba(${base}, 1)`);
  soft.addColorStop(1, `rgba(${base}, 0)`);
  ctx.fillStyle = soft;
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  sprites.set(base, sprite);
  return sprite;
}

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
/** What this screen's reader has done to the smoke, in memory only: the mouse's clearing, the last touch's, the clearings left behind, the sweep, and when the post was waved. */
interface Model {
  mouse: Clearing | null;
  touch: Clearing | null;
  rest: Clearing[];
  sweep: Sweep | null;
  /** How many lines of the sweep have been read out. */
  said: number;
  wavedAt: number | null;
}
const emptyModel = (): Model => ({ mouse: null, touch: null, rest: [], sweep: null, said: 0, wavedAt: null });

interface Cuts { readonly clearings: readonly Clearing[]; readonly rects: readonly { readonly left: number; readonly width: number; readonly top: number; readonly bottom: number; readonly o: number }[] }

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
  if (m.sweep && m.sweep.releasedAt !== null && now >= m.sweep.releasedAt + SMOKE.roll) m.sweep = null;
}

/** What is open at `now`: each clearing and, from the sweep, a rectangle for each finished line and (with motion) the clearing travelling along the line. */
function cutsAt(m: Model, now: number, reduced: boolean): Cuts {
  const clearings = [m.mouse, m.touch, ...m.rest].filter((c): c is Clearing => c !== null && openness(c, now, reduced) > 0);
  const rects: { left: number; width: number; top: number; bottom: number; o: number }[] = [];
  const sw = m.sweep;
  if (sw) {
    const s = sweepAt(sw.lines, (sw.releasedAt ?? now) - sw.startedAt, sw.width, SWEEP_PX_S);
    const lead: Clearing = { x: sw.x0 + s.x, y: s.y, openedAt: sw.startedAt, leftAt: sw.releasedAt, hold: 0 };
    const o = openness(lead, now, reduced);
    if (o > 0) {
      for (let i = 0; i <= s.finished; i++) rects.push({ left: sw.x0, width: sw.width, top: sw.lines[i]!.top, bottom: sw.lines[i]!.bottom, o });
      if (!reduced && !s.done) clearings.push(lead);
    }
  }
  return { clearings, rects };
}

/** When the model next needs to be looked at (an epoch ms), or null: a line of the sweep finishing, a post's wave ending, a clearing closing, the strength moving a hundredth. */
function nextWake(m: Model, now: number, o: { readonly reduced: boolean; readonly animate: boolean; readonly still: boolean; readonly playedAt: number; readonly ends: number }): number | null {
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
  }
  if (m.wavedAt !== null) {
    const clear = m.wavedAt + SMOKE.waved;
    if (now < clear) at.push(clear);
    else if (now < clear + SMOKE.roll) at.push(ticks ? now + TICK_MS : clear + SMOKE.roll);
  }
  if (!o.still && Number.isFinite(o.ends) && o.ends > o.playedAt && now < o.ends) {
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

/** The screen's density, capped at twice, and scaled down further for a box too large for a canvas. */
function densityFor(w: number, h: number): number {
  const screen = Math.min(MAX_DPR, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
  return Math.min(screen, Math.sqrt(MAX_CANVAS_PX / Math.max(1, w * h)));
}

/**
 * The boxes the effect reads, in CSS px. The content area (`w`, `h`, placed at `top` and `left` from the effect's element) is the container: the canvas, the
 * puffs, a clearing's radius and the density are its, and a clearing's coordinates are in it. The words stand in it at (`wx`, `wy`) and are `ww` by `wh`: the
 * sweep's lines, and the forced-colors mask's coordinates, are theirs.
 */
interface Frame { readonly w: number; readonly h: number; readonly top: number; readonly left: number; readonly wx: number; readonly wy: number; readonly ww: number; readonly wh: number }
const NO_FRAME: Frame = { w: 0, h: 0, top: 0, left: 0, wx: 0, wy: 0, ww: 0, wh: 0 };

/**
 * The words' mask, forced colors only: the flat layer, a hard circle for each clearing, a rectangle for each finished line; none while the post is clear.
 * The cuts are in the content area's coordinates and the mask is the words' own, so each is moved by where the words stand in the area (`ox`, `oy`);
 * the radius is the area's (`w` is its width), as on the canvas.
 */
function maskFor(cuts: Cuts, s: number, g: number, now: number, reduced: boolean, w: number, ox: number, oy: number): CSSProperties | undefined {
  if (g >= 1) return undefined;
  const flat = maskAlpha(s) + (1 - maskAlpha(s)) * g;
  const r = holeRadius(w);
  const images = [`linear-gradient(rgba(0, 0, 0, ${a4(flat)}), rgba(0, 0, 0, ${a4(flat)}))`];
  const sizes = ['100% 100%'];
  const positions = ['0 0'];
  for (const c of cuts.clearings) {
    images.push(`radial-gradient(circle ${r}px at ${px(c.x - ox)}px ${px(c.y - oy)}px, rgba(0, 0, 0, ${a4(openness(c, now, reduced))}) ${r}px, rgba(0, 0, 0, 0) ${r}px)`);
    sizes.push('100% 100%');
    positions.push('0 0');
  }
  for (const rect of cuts.rects) {
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
  const { plays, still, show, children } = props;
  /* A play an admin ended, or that did not take, or a trap caught, is no smoke. */
  const standing = plays.filter((p) => !p.reversed && !p.untaken && !p.caught && !p.faceDown);
  const endOf = (p: CardPlay): number => { const t = p.ends === undefined ? Number.NaN : Date.parse(p.ends); return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t; };
  const now = useAt(still ? [] : standing.map(endOf).filter(Number.isFinite));
  /* A moment draws the play as it was up (the engine drops a play whose end is not after the moment's time), so it takes the first as given. */
  const play = still ? standing[0] : standing.find((p) => endOf(p) > now);
  useEffect(() => { if (!play) show(null); }, [show, play]);
  if (!play) return <>{children}</>;
  /* Keyed by the play: a second cast after the first ended starts with nothing cleared. */
  return <Smoke key={play.id} {...props} play={play} />;
}

function Smoke({ play, still, show, met, place, children }: EffectProps & { readonly play: CardPlay }) {
  const { api } = useKayfa();
  const reduced = useMotionReduced();
  const forced = useForcedColors();
  const descId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const wordsRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveRef = useRef<HTMLButtonElement>(null);
  const model = useRef<Model>(emptyModel());
  const startedAt = useRef(api.now());
  /* What render shows is as of the last `refresh`: the page's clock then, and a count so a change always draws again. */
  const [at, setAt] = useState(() => api.now());
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const [spoken, setSpoken] = useState('');
  const [frame, setFrame] = useState<Frame>(NO_FRAME);
  /* The content area's element as the last measure found it (the post body, or the host in an ORIGIN box): the observers and listeners are bound to it, and move when it is replaced. */
  const [areaEl, setAreaEl] = useState<HTMLElement | null>(null);
  /* Whether the post is on screen is unknown until the observer first reports: the canvas is kept (and painted) through that, so the words are never bare, and only a confirmed "out" releases it. */
  const [sight, setSight] = useState<'unknown' | 'in' | 'out'>('unknown');
  const inView = sight === 'in';
  const keep = sight !== 'out';

  const playedAt = Date.parse(play.playedAt);
  const ends = play.ends === undefined ? Number.NaN : Date.parse(play.ends);
  const rgb = useMemo(() => readColor(play.config['color']), [play.config]);
  const puffList = useMemo(() => puffs(seedOf(play.id), frame.w, frame.h), [play.id, frame.w, frame.h]);

  /* The frame loop runs for the canvas only: in view, with motion, not on the forced-colors path, and not while the post is waved (nothing is drawn then; the wake at the end of the wave renders again). */
  const waved = !still && isWaved(model.current.wavedAt, at);
  const loop = !still && !reduced && !forced && inView && !waved;
  const latest = useRef({ frame, reduced, forced, still, loop, rgb, puffList, playedAt, ends, inView, keep });
  useLayoutEffect(() => { latest.current = { frame, reduced, forced, still, loop, rgb, puffList, playedAt, ends, inView, keep }; });

  /*
   * Time. One timer, set for the soonest thing the model needs looked at after the last time it was (`seen`): a line of the sweep finishing, the wave's end,
   * a clearing closing (every `TICK_MS` while the forced-colors mask is moving), the strength moving a hundredth. It sets the next as it fires, so it never
   * waits on a render, and a late timer catches up on what it missed. Every `refresh` sets it again.
   */
  const seen = useRef(api.now());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stepRef = useRef<() => void>(() => {});
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const L = latest.current;
    const wake = nextWake(model.current, seen.current, { reduced: L.reduced, animate: L.forced && L.inView, still: L.still, playedAt: L.playedAt, ends: L.ends });
    if (wake === null) return;
    timer.current = setTimeout(() => stepRef.current(), Math.min(TIMER_MOST, Math.max(1, Math.ceil(wake - api.now()))));
  }, [api]);
  const refresh = useCallback(() => { seen.current = api.now(); setAt(seen.current); bump(); schedule(); }, [api, schedule]);
  /* The reader changed something: draw it. The loop draws by itself, so only the other ways need the screen rendered again. */
  const changed = useCallback(() => {
    prune(model.current, api.now());
    if (!latest.current.loop) refresh();
  }, [api, refresh]);

  /* ---- the box ---- */
  /*
   * The container is the box Feelin' Fab's foil and Whoops!'s ink fill: the post body (`.kb-act-main`) in the thread, border to border (the engine's
   * `bodyOf` and `bodyBox`, engine/ui/cards/body.ts), and this effect's own element anywhere else (the ORIGIN box). It is found again at each measure.
   */
  const measure = useCallback(() => {
    const words = wordsRef.current, host = hostRef.current;
    if (!words || !host) return;
    const found = bodyOf(host, place);
    setAreaEl(found ?? host);
    const b = bodyBox(host, found);
    const w = words.getBoundingClientRect(), h = host.getBoundingClientRect();
    /* The words' corner from the area's corner: both from the page's. */
    const wx = w.left - (h.left + b.left), wy = w.top - (h.top + b.top);
    setFrame((f) => (f.w === b.w && f.h === b.h && f.top === b.top && f.left === b.left && f.wx === wx && f.wy === wy && f.ww === w.width && f.wh === w.height
      ? f : { w: b.w, h: b.h, top: b.top, left: b.left, wx, wy, ww: w.width, wh: w.height }));
  }, [place]);
  useLayoutEffect(() => {
    measure();
    const words = wordsRef.current, host = hostRef.current;
    if (!words || !host || typeof ResizeObserver === 'undefined') return;
    /* The host and the area too: the words can move in them with no change of their own size (the control's font loads or wraps), and the area can change with none of the words'. */
    const watch = new ResizeObserver(measure);
    watch.observe(words);
    watch.observe(host);
    if (areaEl && areaEl !== host) watch.observe(areaEl);
    return () => watch.disconnect();
  }, [measure, areaEl, forced]);

  /* ---- the canvas ---- */
  const paint = useCallback(() => {
    const canvas = canvasRef.current, L = latest.current;
    if (!canvas || L.forced) return;
    /* Out of view (confirmed) a canvas holds no pixels (a page of smoked posts would otherwise keep every backing store); it is sized again on return. */
    if (!L.still && !L.keep) {
      if (canvas.width !== 0) canvas.width = 0;
      if (canvas.height !== 0) canvas.height = 0;
      return;
    }
    const { w, h } = L.frame;
    if (w <= 0 || h <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const light = spriteOf(LIGHT), dark = spriteOf(DARK);
    const dpr = densityFor(w, h);
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const t = api.now();
    const m = model.current;
    /* A moment draws the smoke as it stood at full strength. */
    const s = L.still ? 1 : strength(t, L.playedAt, L.ends);
    const g = L.still ? 0 : waveFactor(m.wavedAt, t, L.reduced);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    if (g >= 1) return;
    const [r, gr, b] = L.rgb;
    ctx.fillStyle = `rgba(${r}, ${gr}, ${b}, ${a4(fogAlpha(s) * (1 - g))})`;
    ctx.fillRect(0, 0, w, h);
    /* The puffs: soft discs a little lighter and a little darker than the fog, drifting; still under reduced motion and in a moment. */
    const drift = L.reduced || L.still ? 0 : t - startedAt.current;
    for (const puff of L.puffList) {
      const p = puffAt(puff, drift, w, h);
      const a = 0.22 * Math.abs(p.shade) * (1 - g);
      const sprite = p.shade >= 0 ? light : dark;
      if (sprite) {
        ctx.globalAlpha = a4(a);
        ctx.drawImage(sprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        continue;
      }
      const base = p.shade >= 0 ? LIGHT : DARK;
      const soft = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      soft.addColorStop(0, `rgba(${base}, ${a4(a)})`);
      soft.addColorStop(1, `rgba(${base}, 0)`);
      ctx.fillStyle = soft;
      ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
    /* The clearings are cut out of all of it: a radial fade whose stops are `covered`'s, so the canvas and the model agree. */
    const radius = holeRadius(w);
    const cuts = cutsAt(m, t, L.reduced);
    ctx.globalCompositeOperation = 'destination-out';
    for (const c of cuts.clearings) {
      const cut = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, radius);
      for (const stop of [0, 1 - SMOKE.edge, 1]) cut.addColorStop(stop, `rgba(0, 0, 0, ${a4(1 - covered(c.x + stop * radius, c.y, [c], radius, t, L.reduced))})`);
      ctx.fillStyle = cut;
      ctx.fillRect(c.x - radius, c.y - radius, radius * 2, radius * 2);
    }
    for (const rect of cuts.rects) {
      ctx.fillStyle = `rgba(0, 0, 0, ${a4(rect.o)})`;
      ctx.fillRect(rect.left, rect.top, rect.width, rect.bottom - rect.top);
    }
    ctx.globalCompositeOperation = 'source-over';
  }, [api]);

  /* Without a loop the canvas is drawn after every render: a render is how a change reaches it. With one, the commit that sized the canvas or brought it back
     into view paints it too, in the layout effect, so no frame shows the words bare while the loop's first frame waits for a passive effect. */
  const painted = useRef('');
  useLayoutEffect(() => {
    const key = `${frame.w}|${frame.h}|${keep}|${forced}`;
    const fresh = key !== painted.current;
    painted.current = key;
    if (!loop || fresh) paint();
  });
  useEffect(() => {
    if (!loop) return;
    let id = 0;
    const next = () => { paint(); id = requestAnimationFrame(next); };
    next();
    return () => cancelAnimationFrame(id);
  }, [loop, paint]);

  /* ---- in view, and met ---- */
  useEffect(() => {
    if (still || !areaEl) return;
    /* The content area is what the canvas covers, so it is what is watched: a tall post's host can be far out of view while the area is still on screen. A margin above and below, so the canvas is restored before the post scrolls into sight. */
    return watchInView(areaEl, (seen) => setSight(seen ? 'in' : 'out'), { rootMargin: '200px 0px' });
  }, [still, areaEl]);
  useEffect(() => { if (!still) refresh(); }, [inView, still, refresh]);
  const met1 = useRef(false);
  useEffect(() => {
    if (still || !inView || met1.current) return;
    met1.current = true;
    met();
  }, [still, inView, met]);

  /* ---- the pointer: on the content area, passive, never prevented, never captured ---- */
  useEffect(() => {
    if (still || !areaEl) return;
    /* The pointer is read on the content area, which the smoke fills (the host in an ORIGIN box), and placed in its padding box. */
    const area = areaEl;
    const at = (e: PointerEvent) => { const r = area.getBoundingClientRect(); return { x: e.clientX - r.left - area.clientLeft, y: e.clientY - r.top - area.clientTop }; };
    /* The control is the way through, not the words, and so is whatever the engine lifts over the ink (a fold's bar, the reactions row): a press on one clears nothing. */
    const onControl = (e: Event) => e.target instanceof Element && e.target.closest('.dw-hotbox-wave, [data-kb-over-ink]') !== null;
    const follow = (e: PointerEvent) => {
      const m = model.current, { x, y } = at(e);
      m.mouse = { x, y, openedAt: m.mouse?.openedAt ?? api.now(), leftAt: null, hold: 0 };
    };
    /* The mouse's clearing closes where it is and rolls out, as when the pointer leaves the host. */
    const closeMouse = () => {
      const m = model.current;
      if (!m.mouse) return;
      m.rest.push({ ...m.mouse, leftAt: api.now() });
      m.mouse = null;
      changed();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      /* The control is a child of the host, so the host's pointerleave never fires on the way to it: pointing at it ends the clearing, or the first line is read for free. */
      if (onControl(e)) { closeMouse(); return; }
      follow(e);
      changed();
    };
    const onDown = (e: PointerEvent) => {
      if (onControl(e)) { if (e.pointerType !== 'touch') closeMouse(); return; }
      if (e.pointerType === 'touch') {
        /* A finger cannot stay in place and scroll too: its clearing is opened where it lands and holds `touchHold`, replacing the last. */
        const { x, y } = at(e), t = api.now();
        model.current.touch = { x, y, openedAt: t, leftAt: t, hold: SMOKE.touchHold };
      } else follow(e);
      changed();
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
  }, [still, api, changed, areaEl]);

  /* ---- the hold ---- */
  const start = useCallback(() => {
    const m = model.current, L = latest.current;
    if (L.still || (m.sweep && m.sweep.releasedAt === null) || isWaved(m.wavedAt, api.now())) return;
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
    const t = api.now();
    settle(t);
    prune(model.current, t);
    refresh();
  }, [api, refresh, settle]);
  useLayoutEffect(() => { stepRef.current = step; });
  useEffect(() => {
    schedule();
    return () => clearTimeout(timer.current);
  }, [schedule, reduced, forced, inView, still, playedAt, ends]);

  /* The words go inert as the waved window ends: focus inside them would be dropped, so it moves to the control, which is never inert. */
  const wasWaved = useRef(false);
  useLayoutEffect(() => {
    const words = wordsRef.current;
    if (wasWaved.current && !waved && words && document.activeElement && words.contains(document.activeElement)) waveRef.current?.focus();
    wasWaved.current = waved;
  }, [waved]);

  /* ---- what the reader is shown, and what the Lens is told ---- */
  const m = model.current;
  const held = !still && m.sweep !== null && m.sweep.releasedAt === null;
  const s = still ? 1 : strength(at, playedAt, ends);
  const g = still ? 0 : waveFactor(m.wavedAt, at, reduced);
  const state = waved ? STATE_WAVED : held ? STATE_WAVING : STATE_SMOKE;
  /* A moment has no control to point at, so it gives the end alone. */
  const endsText = still
    ? (play.ends === undefined ? 'Ends when the smoke thins out.' : `${endsWords(play.ends)}.`)
    : `Point at the words, or hold ${WAVE_LABEL}, to read.${play.ends === undefined ? '' : ` ${endsWords(play.ends)}.`}`;
  const progress = still ? 0 : Math.round((1 - s) * 100) / 100;
  const view = useMemo<CardView>(() => ({
    progress, state, ends: endsText, yours: !waved && !still,
    controls: still ? [] : [{ kind: 'hold', label: WAVE_LABEL, describe: WAVE_DESCRIBE, start, stop }],
    notes: {},
  }), [progress, state, endsText, waved, still, start, stop]);
  useEffect(() => { show(view); }, [show, view]);
  useEffect(() => () => show(null), [show]);

  const cuts = forced ? cutsAt(m, at, reduced) : null;
  const mask = cuts ? maskFor(cuts, s, g, at, reduced, frame.w, frame.wx, frame.wy) : undefined;
  const radius = holeRadius(frame.w);
  const key = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';

  return (
    <div ref={hostRef} className="dw-hotbox" data-kb-hotbox>
      {!still && (
        <>
          <button
            ref={waveRef} type="button" className="dw-hotbox-wave" data-kb-over-ink="" aria-describedby={descId}
            onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onBlur={stop}
            /* As the engine's Kit hold does (engine/ui/cards/Kit.tsx): a long press on a touch screen opens the context menu and would cancel the hold, so it is swallowed. This is the one preventDefault here, and only on the control. */
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (key(e) && !e.repeat) start(); }} onKeyUp={(e) => { if (key(e)) stop(); }}
          >
            {WAVE_LABEL}
          </button>
          <span id={descId} className="kb-visually-hidden">{WAVE_DESCRIBE}</span>
        </>
      )}
      {forced && <p className="dw-hotbox-sign"><strong>{state}.</strong> {endsText}</p>}
      <div ref={wordsRef} className="dw-hotbox-words" inert={!still && !waved} style={mask}>{children}</div>
      <canvas ref={canvasRef} className="dw-hotbox-smoke" data-kb-effect-ink aria-hidden="true" style={{ top: frame.top, left: frame.left, width: frame.w, height: frame.h }} />
      {forced && (
        <div className="dw-hotbox-frame" data-kb-effect-ink aria-hidden="true" style={{ top: frame.top, left: frame.left, width: frame.w, height: frame.h }}>
          {!still && cuts!.clearings.map((c, i) => (
            <div key={i} className="dw-hotbox-ring" aria-hidden="true" style={{ left: px(c.x - radius), top: px(c.y - radius), width: radius * 2, height: radius * 2 }} />
          ))}
        </div>
      )}
      {!still && <p className="kb-visually-hidden" aria-live="polite">{spoken}</p>}
    </div>
  );
}
