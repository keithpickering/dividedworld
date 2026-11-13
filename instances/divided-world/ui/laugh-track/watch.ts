/**
 * The page's one watcher for Laugh Track (docs/plans/2026-11-12-laugh-track-point-design.md, sections 2, 3 and 6). The watcher fires nothing: a reaction plays only by a gesture on a
 * place, which is the effect's. What the watcher does is tell each place how near the reader is to it, and keep the page's one murmur.
 *
 * Every cued place on the page, of every post, registers here, and the page holds ONE `IntersectionObserver` (which places are within the
 * reach of the viewport), ONE passive scroll listener, ONE pointermove listener (a mouse only) and ONE resize listener, however many posts and
 * places there are. Forty posts of thirty places cost exactly that.
 *
 * Frames (`requestAnimationFrame`) are one loop for the page, never on an interval. They run while the page scrolls or a mouse moves, while a
 * place's nearness has not yet been told (a pin, a redraw, a place the observer dropped), and while the murmur is held with a place near to
 * come back to. A still page with nothing near asks for no frame. A frame measures only the places the observer says are near, reads the
 * reading line from the window and `--kb-hud-measured` (the HUD's measured height, frame/Hud.tsx), and works out each one's nearness, 0 to 1:
 * 1 on the line, falling in a straight line to 0 at the reach, the mouse pointer counting double (line.ts). A place is told its nearness
 * (`near`) only when the number moved by 0.02 or more since the last one told, and always at exactly 0 or 1, so a still reader writes nothing.
 *
 * A pinned place (the effect pins the place that has focus) has nearness 1 wherever it is, measured or not.
 *
 * The page has one audience: ONE murmur loop for the page, as the engine's mixer holds one voice in the group `audience-build` (a loop made
 * there ends the group's prior one). The place with the highest murmur gain, of any kind and on whichever post, decides which loop it is, at
 * that gain. The watcher owns that one loop: a place says how to make its kind's loop (`voice`), the first frame that wants one makes it (so
 * a page nobody scrolls to a cue fetches nothing), and a nearer place of another kind stops it with the fade and then makes the new kind's.
 * While a reaction sounds the effect calls `quiet`, which holds the murmur at nothing (and makes no loop) for `QUIET_MS`, or, once the
 * reaction's answer gives its length, until that reaction's tail begins. Places are still told their nearness while it is held. The loop
 * is let go with the last place. `reachRem` and the screen numbers are read from the first place to register: every place of an
 * instance reads the same card settings.
 *
 * Nothing here reads who owns, wrote or cast anything, and nothing leaves the screen. Each listener is added when the first place
 * registers and removed with the last, and the module touches no global before then, so a test can fake the page.
 */
import { distance, murmurGain, nearness, readingLine, type Point, type Rect } from './line.ts';

/** A loop the page's audience murmurs with (the engine's `LoopHandle`). */
export interface Voice { setGain(g: number): void; stop(fadeMs: number): void }

/** The card's screen settings (`screenReads` in cards/laugh-track.ts), as the effect reads them. */
export interface Screen {
  /** The reading line's place, in percent of the space above the HUD. */
  readonly line: number;
  readonly reachRem: number;
  /** The murmur's level at the line, in percent of a reaction. */
  readonly murmurMost: number;
  readonly fadeMs: number;
}

export interface PlaceSpec {
  /** The place's pieces on the page, read when it registers and again when it is `refresh`ed or measured. */
  els(): ArrayLike<Element>;
  /** The sound's kind: `laugh`, `cheer` or `boo`. */
  readonly kind: string;
  readonly screen: Screen;
  /** Makes the page's loop of `kind`: called when the best place's kind needs one and none lives. */
  voice(kind: string): Voice;
  /** The place's nearness, 0 to 1, told when it changes (by 0.02 or more, or to exactly 0 or 1). */
  near(n: number): void;
}

/** What a registration hands back. */
export type Unregister = (() => void) & {
  /** The place's pieces were drawn again: observe the ones it has now, and tell their nearness on the next frame. */
  refresh(): void;
  /** A pinned place has nearness 1 wherever it is. */
  pin(on: boolean): void;
};

interface Place {
  readonly spec: PlaceSpec;
  /** Its pieces the observer last saw intersecting the viewport (plus the reach). */
  readonly seen: Set<Element>;
  /** The pieces being observed. */
  watched: Set<Element>;
  /** The nearness last told, or null while none has been (or the pieces were drawn again, and the new ones are owed one). */
  told: number | null;
  pinned: boolean;
}

/** How long the murmur is held at nothing for a reaction, until the reaction's own length is known. */
export const QUIET_MS = 1200;
/** A nearness is told again only when it moved this much, or reached exactly 0 or 1. */
const TELL_STEP = 0.02;

const places = new Set<Place>();
const byElement = new Map<Element, Place>();
const near = new Set<Place>();
const pins = new Set<Place>();
/** Places that are not near but owe a frame's visit: one just unpinned, one the observer dropped, one drawn again. */
const owing = new Set<Place>();
let murmuring: { readonly kind: string; readonly voice: Voice; gain: number; readonly fadeMs: number } | null = null;
let observer: IntersectionObserver | null = null;
let frame: number | null = null;
let pointer: Point | null = null;
let rem = 16;
let screen: Screen | null = null;
/** The murmur is held at nothing, and no loop is made, before this (the clock of `performance.now()`, which is the frames' own). */
let quietUntil = 0;
/** The last `quiet` call's mark: only its answer moves the hold. */
let quietMark: object | null = null;

/** A failing reaction is "no answer" to the hold, but it is still a failure: report it where an uncaught throw would land (`window.onerror`,
    the console) and never rethrow it into a frame. */
const reportFailure = (e: unknown): void => {
  const report = (globalThis as { reportError?: (e: unknown) => void }).reportError;
  if (typeof report === 'function') report.call(globalThis, e); else console.error(e);
};

/** What the watcher holds, for a test to look inside. */
export const __inspect = () => ({ places: places.size, elements: byElement.size, near: near.size, pinned: pins.size, murmuring: murmuring !== null, listening: observer !== null, quietUntil });

/** Lets the page's loop go with the fade; nothing is left to leak. */
function hush(fadeMs?: number): void {
  const m = murmuring;
  if (!m) return;
  murmuring = null;
  m.voice.setGain(0);
  m.voice.stop(fadeMs ?? m.fadeMs);
}

/** The loop's gain to nothing, if it is up. */
function silence(): void {
  if (murmuring && murmuring.gain !== 0) { murmuring.voice.setGain(0); murmuring.gain = 0; }
}

/**
 * A reaction sounds (or fails to): the murmur is held at nothing at once, for `QUIET_MS`, and when `answer` resolves a length, until that
 * moment plus the length less the fade, so the murmur returns over the reaction's tail. A file still being fetched does not bring it back under
 * the reaction: the hold counts from when the sound answers. Only the last call's answer counts; a rejection is reported once and changes nothing.
 */
export function quiet(answer: void | Promise<{ lengthMs: number } | null>, fadeMs: number): void {
  const mine = {};
  if (places.size > 0) {
    quietMark = mine;
    quietUntil = performance.now() + QUIET_MS;
    silence();
    wake();
  }
  if (answer && typeof answer.then === 'function') {
    answer.then((take) => {
      const length = take?.lengthMs;
      if (quietMark !== mine || typeof length !== 'number' || !Number.isFinite(length) || length <= 0) return;
      quietUntil = performance.now() + Math.max(length - fadeMs, 0);
      wake();
    }, reportFailure);
  }
}

function onScroll(): void { wake(); }
/** The root font size, and so the reach in px, can change with the window (zoom, a text-size setting): read again, the observer's margin rebuilt if it moved. */
function onResize(): void {
  if (!screen) return;
  const next = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  if (next !== rem) {
    rem = next;
    const old = observer;
    observer = makeObserver(screen);
    for (const place of places) for (const e of place.watched) observer.observe(e);
    old?.disconnect();
  }
  wake();
}
function onPointer(e: unknown): void {
  const p = e as { pointerType?: string; clientX: number; clientY: number };
  if (p.pointerType !== 'mouse') return;
  pointer = { x: p.clientX, y: p.clientY };
  wake();
}

function makeObserver(first: Screen): IntersectionObserver {
  return new IntersectionObserver((entries) => {
    for (const e of entries) {
      const place = byElement.get(e.target);
      if (!place) continue;
      if (e.isIntersecting) place.seen.add(e.target); else place.seen.delete(e.target);
      if (place.seen.size > 0) near.add(place);
      else if (near.delete(place) && place.told !== null && place.told !== 0) owing.add(place);
    }
    wake();
  }, { rootMargin: `${first.reachRem * rem}px 0px` });
}

function start(first: Screen): void {
  screen = first;
  rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  observer = makeObserver(first);
  window.addEventListener('resize', onResize, { passive: true });
  /* The scroll of any scroller on the page, not the window's alone: it does not bubble, so it is captured. */
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  document.addEventListener('pointermove', onPointer, { passive: true });
}

function stop(): void {
  document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
  document.removeEventListener('pointermove', onPointer);
  window.removeEventListener('resize', onResize);
  observer?.disconnect();
  observer = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null; pointer = null; screen = null;
  near.clear(); pins.clear(); owing.clear();
  byElement.clear();
  quietUntil = 0; quietMark = null;
}

function wake(): void {
  if (frame === null && places.size > 0) frame = requestAnimationFrame(tick);
}

const hudHeight = (): number => Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;

function boxes(place: Place): Rect[] {
  const out: Rect[] = [];
  for (const e of Array.from(place.spec.els())) for (const r of Array.from(e.getClientRects())) out.push(r);
  return out;
}

/** Tells a place its nearness when it is owed one, moved by TELL_STEP, or reached exactly 0 or 1. */
function tell(place: Place, n: number): void {
  const was = place.told;
  if (was !== null && !(n === 0 && was !== 0) && !(n === 1 && was !== 1) && Math.abs(n - was) < TELL_STEP) return;
  place.told = n;
  place.spec.near(n);
}

/** The page's one loop: the best place's kind, at its gain; none near sets the gain to 0. */
function murmur(best: { gain: number; place: Place } | null): void {
  if (!best || best.gain <= 0) { silence(); return; }
  const { gain, place } = best;
  const kind = place.spec.kind;
  /* The old loop is stopped before the new is made: the group has no prior loop to replace, so the old one fades out under its own stop. */
  if (murmuring && murmuring.kind !== kind) hush(place.spec.screen.fadeMs);
  if (!murmuring) murmuring = { kind, voice: place.spec.voice(kind), gain: 0, fadeMs: place.spec.screen.fadeMs };
  if (murmuring.gain !== gain) { murmuring.voice.setGain(gain); murmuring.gain = gain; }
}

function tick(now: number): void {
  frame = null;
  if (!screen) return;
  const line = readingLine(window.innerHeight, hudHeight(), screen.line);
  /* Pinned places first, so a pin wins a tie for the loop. */
  const visit = new Set<Place>([...pins, ...near, ...owing]);
  owing.clear();
  let best: { gain: number; place: Place } | null = null;
  for (const place of visit) {
    const s = place.spec.screen;
    const reachPx = s.reachRem * rem;
    let n = 0, gain = 0;
    if (place.pinned) { n = 1; gain = murmurGain(0, reachPx, s.murmurMost); }
    else if (near.has(place)) {
      const d = distance(boxes(place), line, pointer ?? undefined);
      n = nearness(d, reachPx); gain = murmurGain(d, reachPx, s.murmurMost);
    } else if (place.told === null) continue;
    tell(place, n);
    if (!best || gain > best.gain) best = { gain, place };
  }
  /* A place's mark does not wait for the sound; the murmur does wait for the reaction. */
  if (now < quietUntil) silence(); else murmur(best);
  /* A settled page asks for no frame: only a held murmur with a place to come back to does, until the hold ends. */
  if (now < quietUntil && (near.size > 0 || pins.size > 0)) wake();
}

function observe(place: Place, redrawn = false): void {
  const now = new Set(Array.from(place.spec.els()));
  const same = now.size === place.watched.size && Array.from(now).every((e) => place.watched.has(e));
  for (const e of place.watched) if (!now.has(e)) { observer?.unobserve(e); byElement.delete(e); place.seen.delete(e); }
  for (const e of now) if (!place.watched.has(e)) { byElement.set(e, place); observer?.observe(e); }
  place.watched = now;
  if (place.seen.size === 0) near.delete(place);
  /* Drawn again, the new pieces carry no mark: they are owed the nearness whether or not the number moved. */
  if (redrawn && !same) { place.told = null; owing.add(place); wake(); }
}

/** Registers a place; the function it returns unregisters it (its post is gone or its words changed). */
export function register(spec: PlaceSpec): Unregister {
  /* A page with no observer (a test's, or a browser too old to have one) has no way to know which places are near: it hears nothing, and reads fine. */
  if (typeof IntersectionObserver !== 'function') return Object.assign(() => {}, { refresh: () => {}, pin: () => {} });
  if (places.size === 0) start(spec.screen);
  const place: Place = { spec, seen: new Set(), watched: new Set(), told: null, pinned: false };
  places.add(place);
  observe(place);
  const off = (() => {
    if (!places.delete(place)) return;
    for (const e of place.watched) { observer?.unobserve(e); byElement.delete(e); }
    near.delete(place); pins.delete(place); owing.delete(place);
    if (places.size === 0) { hush(); stop(); return; }
    wake();
  }) as Unregister;
  off.refresh = () => { if (places.has(place)) observe(place, true); };
  off.pin = (on) => {
    if (!places.has(place) || place.pinned === on) return;
    place.pinned = on;
    if (on) pins.add(place); else { pins.delete(place); owing.add(place); }
    wake();
  };
  return off;
}

/**
 * Game sounds were switched off or on: the engine's mixer ends a loop when its bus goes off, and the handle does not say so, so the page's
 * loop is let go (its caption released) and the next frame with a place near makes a fresh one, which sounds if the bus is on and is
 * captioned by its gain alone if it is not.
 */
export function forgetVoice(): void {
  hush(0);
  wake();
}
