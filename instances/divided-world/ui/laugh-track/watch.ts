/**
 * The page's one watcher for Laugh Track (docs/plans/2026-11-11-laugh-track-design.md, sections 6 and 8, changed by
 * docs/plans/2026-11-12-laugh-track-band-design.md, sections 1 to 3). Every cued place on the page, of every post, registers here, and the
 * page holds ONE `IntersectionObserver` (which places are near the viewport), ONE passive scroll listener, ONE pointermove listener (a mouse
 * only) and ONE resize listener, however many posts and places there are. Forty posts of thirty places cost exactly that, and a still page
 * costs no frame.
 *
 * Frames (`requestAnimationFrame`) are one loop for the page, never on an interval. They run while the page scrolls or a mouse moves, and
 * while something is waiting on time: a place adding up its dwell in the band, a place earned and waiting its turn, or the murmur held
 * while an unfired place is near. A page with none of those asks for no frame, and the first frame after it adds no dwell. A frame measures
 * only the places the observer says are near, reads the band from the line and `--kb-hud-measured` (the HUD's measured height,
 * frame/Hud.tsx), adds the frame's time (at most 100ms, so a tab that slept earns nothing) to each place in the band, and fires the queue.
 *
 * A place earns its cue once the middle of any of its boxes has been in the band for the dwell, added up across pauses; leaving the reach
 * (the observer no longer sees it) loses what it had added. Earned places fire one at a time in the page's order (an earlier post before a
 * later one, and within a post the order of its first pieces, read with `compareDocumentPosition` only when one is about to fire), the next
 * `airMs` after the one before. An earned place that leaves the band, or the reach, keeps its turn for `holdMs` from leaving, and after that
 * is unearned, as if never read; one that is unregistered, or whose pieces were drawn again, leaves the queue at once, so nothing fires
 * after its registration is gone and nothing waits on it.
 *
 * The page has one audience: ONE build-up loop for the page, as the engine's mixer holds one voice in the group `audience-build` (a loop made
 * there ends the group's prior one). The nearest unfired, unearned place on the page, of any kind and on whichever post, decides which murmur
 * it is, at that place's gain. The watcher owns that one loop: a place says how to make its kind's loop (`voice`), the first frame that wants
 * one makes it (so a page nobody scrolls to a cue fetches nothing), a nearer place of another kind stops it with the fade and then makes the
 * new kind's, and a fire stops it with the fade (the take crosses over it). After a fire the murmur is held at nothing, and no loop is made,
 * until the take's tail begins (the take's length from `fire()`'s answer less the fade), or for the airtime when the play did not sound or
 * answers late (an answer counts until a frame has run past the airtime, so one that comes at once still counts when the airtime is 0). A fire that throws or rejects is no take. An `airMs`, `holdMs` or `lengthMs` that is not a finite number, or is negative, reads as its default (1200, 18000) or, for a length, as no answer. It is stopped when no unfired place is left, and with the last place, so no held caption outlives the last post (#496).
 * `reachRem` and the screen numbers are read from the first place to register: every place of an instance reads the same card settings.
 *
 * Nothing here reads who owns, wrote or cast anything, and nothing leaves the screen. Each listener is added when the first place
 * registers and removed with the last, and the module touches no global before then, so a test can fake the page.
 */
import { bandOf, distance, inBand, murmurGain, type Point, type Rect } from './line.ts';

/** A loop the page's audience murmurs with (the engine's `LoopHandle`). */
export interface Voice { setGain(g: number): void; stop(fadeMs: number): void }

/** The card's screen settings (`screenReads` in cards/laugh-track.ts), as the effect reads them. */
export interface Screen {
  readonly line: number;
  /** The band's height, in percent of the reading space. */
  readonly band: number;
  readonly dwellMs: number;
  readonly reachRem: number;
  readonly murmurMost: number;
  readonly fadeMs: number;
  /** The wait between one earned place's fire and the next's, and the murmur's hold when a play did not sound. */
  readonly airMs: number;
  /** How long an earned place that left the band keeps its turn. */
  readonly holdMs: number;
}

export interface PlaceSpec {
  /** The place's pieces on the page, read when it registers and again when it is `refresh`ed or measured. */
  els(): ArrayLike<Element>;
  /** The sound's kind: `laugh`, `cheer` or `boo`. */
  readonly kind: string;
  readonly screen: Screen;
  /** Makes the page's loop of `kind`: called when the nearest place's kind needs one and none lives. */
  voice(kind: string): Voice;
  /**
   * The place's turn has come. Called once. It may answer, when the take is known, with the take's length; null or nothing means no take
   * sounded.
   */
  fire(): void | Promise<{ lengthMs: number } | null>;
}

/** What a registration hands back. */
export type Unregister = (() => void) & { /** The place's pieces were drawn again: observe the ones it has now. */ refresh(): void };

interface Place {
  readonly spec: PlaceSpec;
  /** Its pieces the observer last saw intersecting the viewport (plus the reach). */
  readonly seen: Set<Element>;
  /** The pieces being observed. */
  watched: Set<Element>;
  fired: boolean;
  /** How long it has been in the band, added up a frame at a time; kept across pauses, lost when it leaves the reach. */
  dwelt: number;
  /** It has dwelt the dwell and waits its turn to fire. */
  earned: boolean;
  /** When an earned place was first out of the band (or the reach) this stretch, or null while it is in. */
  leftAt: number | null;
}

const places = new Set<Place>();
const byElement = new Map<Element, Place>();
const near = new Set<Place>();
let murmuring: { readonly kind: string; readonly voice: Voice; gain: number; readonly fadeMs: number } | null = null;
let observer: IntersectionObserver | null = null;
let frame: number | null = null;
let pointer: Point | null = null;
let rem = 16;
let screen: Screen | null = null;
/** How many registered places have not fired: kept, so no frame and no unregister scans every place to ask. */
let unfired = 0;
/** The earned places, in a set of their own so one the observer drops from `near` keeps its turn. Sorted into page order only when one fires. */
const earnedPlaces = new Set<Place>();
/** The time of the frame before this one while frames are running, else null: the first frame after a still page adds no dwell. */
let last: number | null = null;
/** No place fires before this: the airtime after the last fire. */
let nextAt = 0;
/** No loop is made, and a live one is silent, before this. */
let quietUntil = 0;
/** The last fire's own mark, so only its answer moves the hold. */
let lastFire: object | null = null;
/** The hold has run out since the last fire (a frame after the fire's own ran past it): a take that answers after that no longer holds the murmur. */
let holdOver = true;

/** The card's defaults, for a setting that is missing, not a number or negative: such a value never stalls the queue or keeps a turn for ever. The hold is 18000 so that a cue the reader earned outlasts a dense post's queue: 14 cues at one fire per 1200ms is 16800ms, and a shorter hold lapsed cues that were still waiting their turn (the e2e reader fired 8 of 14 at 4000). */
export const DEFAULT_AIR_MS = 1200, DEFAULT_HOLD_MS = 18000;
const settled = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);

/** A failing fire is "no take" to the queue, but it is still a failure: report it where an uncaught throw would land (`window.onerror`, the console)
    and never rethrow it into the frame, which would stop the queue and every frame after it. */
const reportFailure = (e: unknown): void => {
  const report = (globalThis as { reportError?: (e: unknown) => void }).reportError;
  if (typeof report === 'function') report.call(globalThis, e); else console.error(e);
};

/** What the watcher holds, for a test to look inside. */
export const __inspect = () => ({ places: places.size, elements: byElement.size, near: near.size, earned: earnedPlaces.size, unfired, murmuring: murmuring !== null, listening: observer !== null });

/** Lets the page's loop go with the fade; nothing is left to leak. */
function hush(fadeMs?: number): void {
  const m = murmuring;
  if (!m) return;
  murmuring = null;
  m.voice.setGain(0);
  m.voice.stop(fadeMs ?? m.fadeMs);
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
    for (const place of places) if (!place.fired) for (const e of place.watched) observer.observe(e);
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
      if (place.seen.size > 0 && !place.fired) near.add(place);
      else { near.delete(place); if (!place.earned) place.dwelt = 0; }
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
  near.clear();
  byElement.clear();
  unfired = 0;
  earnedPlaces.clear();
  nextAt = 0; quietUntil = 0; last = null; lastFire = null; holdOver = true;
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

/** The page's one loop: the nearest unfired place's kind, at its gain; none near sets the gain to 0, and none unfired lets it go. */
function murmur(best: { gain: number; place: Place } | null): void {
  if (unfired === 0) { hush(); return; }
  if (!best || best.gain <= 0) { if (murmuring && murmuring.gain !== 0) { murmuring.voice.setGain(0); murmuring.gain = 0; } return; }
  const { gain, place } = best;
  const kind = place.spec.kind;
  /* The old loop is stopped before the new is made: the group has no prior loop to replace, so the old one fades out under its own stop. */
  if (murmuring && murmuring.kind !== kind) hush(place.spec.screen.fadeMs);
  if (!murmuring) {
    murmuring = { kind, voice: place.spec.voice(kind), gain: 0, fadeMs: place.spec.screen.fadeMs };
  }
  if (murmuring.gain !== gain) { murmuring.voice.setGain(gain); murmuring.gain = gain; }
}

/** `Node.DOCUMENT_POSITION_PRECEDING` and `_FOLLOWING`, spelled out so nothing here reads a global before the page has one. */
const PRECEDING = 2, FOLLOWING = 4;
/** Page order: the order of the places' first pieces in the document. Places it cannot tell apart keep the order they earned in. */
function inPageOrder(a: Place, b: Place): number {
  const x = Array.from(a.spec.els())[0];
  const y = Array.from(b.spec.els())[0];
  if (!x || !y || x === y || typeof x.compareDocumentPosition !== 'function') return 0;
  const where = x.compareDocumentPosition(y);
  return where & FOLLOWING ? -1 : where & PRECEDING ? 1 : 0;
}

/** An earned place leaves the queue: unearned, with nothing added. */
function unearn(place: Place): void {
  place.earned = false; place.dwelt = 0; place.leftAt = null;
  earnedPlaces.delete(place);
}

function tick(now: number): void {
  frame = null;
  if (!screen) return;
  const band = bandOf(window.innerHeight, hudHeight(), screen.line, screen.band);
  const dt = last === null ? 0 : Math.min(Math.max(now - last, 0), 100);
  const measured = new Map<Place, Rect[]>();
  let adding = false;
  for (const place of near) {
    const rects = boxes(place);
    measured.set(place, rects);
    const inside = inBand(rects, band);
    if (place.earned) place.leftAt = inside ? null : place.leftAt ?? now;
    else if (inside) {
      place.dwelt += dt;
      if (place.dwelt >= place.spec.screen.dwellMs) { place.earned = true; place.leftAt = null; earnedPlaces.add(place); } else adding = true;
    }
  }
  /* An earned place the observer dropped is out of the band too, and each place out of it keeps its turn for `holdMs` only. */
  for (const place of [...earnedPlaces]) {
    if (!near.has(place)) place.leftAt ??= now;
    if (place.leftAt !== null && now - place.leftAt > settled(place.spec.screen.holdMs, DEFAULT_HOLD_MS)) unearn(place);
  }
  let fadeMs: number | null = null;
  if (earnedPlaces.size > 0 && now >= nextAt) {
    const place = [...earnedPlaces].sort(inPageOrder)[0]!;
    const airMs = settled(place.spec.screen.airMs, DEFAULT_AIR_MS);
    earnedPlaces.delete(place);
    place.fired = true; place.earned = false; place.leftAt = null;
    unfired--;
    near.delete(place);
    measured.delete(place);
    for (const e of place.watched) { observer?.unobserve(e); byElement.delete(e); }
    place.watched = new Set();
    place.seen.clear();
    const fade = place.spec.screen.fadeMs;
    fadeMs = fade;
    nextAt = now + airMs;
    quietUntil = now + airMs;
    holdOver = false;
    const mine = {};
    lastFire = mine;
    /* A play that throws, or whose promise rejects, did not sound: the place stays fired and the airtime is all it holds. */
    let answer: ReturnType<PlaceSpec['fire']> = undefined;
    try { answer = place.spec.fire(); } catch (e) { reportFailure(e); }
    /* A take that answers hands the murmur back over its tail, so long as the hold since the fire is not yet over (a frame has not run past
       it); one that answers null, nonsense, or after the hold, leaves the airtime as it was. With an airtime of 0 the hold is over only a frame
       after the fire's own, so the answer that comes in between is honored. */
    if (answer && typeof answer.then === 'function') {
      const firedAt = now;
      answer.then((take) => {
        const length = take?.lengthMs;
        if (lastFire !== mine || holdOver || typeof length !== 'number' || !Number.isFinite(length) || length < 0) return;
        quietUntil = firedAt + Math.max(length - fade, 0);
        wake();
      }, reportFailure);
    }
  }
  /* A fire fades the murmur over the fade, under the take; while the hold lasts no loop is made, and a live one is silent. */
  if (fadeMs !== null) hush(fadeMs);
  if (fadeMs === null && now >= quietUntil) holdOver = true;
  if (unfired === 0) hush();
  else if (fadeMs !== null || now < quietUntil) { if (murmuring && murmuring.gain !== 0) { murmuring.voice.setGain(0); murmuring.gain = 0; } }
  else {
    let best: { gain: number; place: Place } | null = null;
    for (const [place, rects] of measured) {
      if (place.earned) continue;
      const s = place.spec.screen;
      const gain = murmurGain(distance(rects, band, pointer ?? undefined), s.reachRem * rem, s.murmurMost);
      if (!best || gain > best.gain) best = { gain, place };
    }
    murmur(best);
  }
  /* The next frame is asked for by the next scroll or move, or by a place adding dwell, an earned place waiting its turn, or the held murmur
     with a place near to come back to: a settled page asks for none, and its next frame adds no dwell. */
  if (adding || earnedPlaces.size > 0 || (now < quietUntil && near.size > 0)) { last = now; wake(); } else last = null;
}

function observe(place: Place): void {
  if (place.fired) return;
  const now = new Set(Array.from(place.spec.els()));
  for (const e of place.watched) if (!now.has(e)) { observer?.unobserve(e); byElement.delete(e); place.seen.delete(e); }
  for (const e of now) if (!place.watched.has(e)) { byElement.set(e, place); observer?.observe(e); }
  /* An earned place whose pieces were drawn again is not the words that were read: it leaves the queue, and earns its cue again. */
  if (place.earned && (now.size === 0 || Array.from(place.watched).some((e) => !now.has(e)))) unearn(place);
  place.watched = now;
  if (place.seen.size === 0) { near.delete(place); if (!place.earned) place.dwelt = 0; }
}

/** Registers a place; the function it returns unregisters it (its post is gone or its words changed). */
export function register(spec: PlaceSpec): Unregister {
  /* A page with no observer (a test's, or a browser too old to have one) has no way to know which places are near: it hears nothing, and reads fine. */
  if (typeof IntersectionObserver !== 'function') return Object.assign(() => {}, { refresh: () => {} });
  if (places.size === 0) start(spec.screen);
  const place: Place = { spec, seen: new Set(), watched: new Set(), fired: false, dwelt: 0, earned: false, leftAt: null };
  places.add(place);
  unfired++;
  observe(place);
  const off = (() => {
    if (!places.delete(place)) return;
    if (!place.fired) unfired--;
    earnedPlaces.delete(place);
    for (const e of place.watched) { observer?.unobserve(e); byElement.delete(e); }
    near.delete(place);
    if (places.size === 0) { hush(); stop(); return; }
    if (unfired === 0) hush();
    wake();
  }) as Unregister;
  off.refresh = () => { if (places.has(place)) observe(place); };
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
