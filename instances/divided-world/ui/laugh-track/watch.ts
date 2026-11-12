/**
 * The page's one watcher for Laugh Track (docs/plans/2026-11-11-laugh-track-design.md, sections 6 and 8; plan Task 13). Every cued place
 * on the page, of every post, registers here, and the page holds ONE `IntersectionObserver` (which places are near the viewport), ONE
 * passive scroll listener, ONE pointermove listener (a mouse only) and ONE resize listener, however many posts and places there are. Forty posts of thirty
 * places cost exactly that, and a still page costs no frame.
 *
 * Frames (`requestAnimationFrame`) run only while the page scrolls, a mouse moves, or a place rests on the line waiting out its dwell, and
 * never on an interval. A frame measures only the places the observer says are near, reads the line from `--kb-hud-measured` (the HUD's
 * measured height, frame/Hud.tsx), fires a place that has rested on the line for its dwell, and sets the murmurs.
 *
 * The page has one audience: ONE build-up loop for the page, as the engine's mixer holds one voice in the group `audience-build` (a loop made
 * there ends the group's prior one). The nearest unfired place on the page, of any kind and on whichever post, decides which murmur it is,
 * at that place's gain. The watcher owns that one loop: a place says how to make its kind's loop (`voice`), the first frame that wants one
 * makes it (so a page nobody scrolls to a cue fetches nothing), a nearer place of another kind stops it with the fade and then makes the
 * new kind's, and a fire stops it with the fade (the take crosses over it) and makes none in that frame. It is stopped when no unfired place
 * is left, and with the last place, so no held caption outlives the last post (#496). `reachRem` and the screen numbers are read from the
 * first place to register: every place of an instance reads the same card settings.
 *
 * Nothing here reads who owns, wrote or cast anything, and nothing leaves the screen. Each listener is added when the first place
 * registers and removed with the last, and the module touches no global before then, so a test can fake the page.
 */
import { distance, murmurGain, readingLine, type Point, type Rect } from './line.ts';

/** A loop the page's audience murmurs with (the engine's `LoopHandle`). */
export interface Voice { setGain(g: number): void; stop(fadeMs: number): void }

/** The card's screen settings (`screenReads` in cards/laugh-track.ts), as the effect reads them. */
export interface Screen { readonly line: number; readonly dwellMs: number; readonly reachRem: number; readonly murmurMost: number; readonly fadeMs: number }

export interface PlaceSpec {
  /** The place's pieces on the page, read when it registers and again when it is `refresh`ed or measured. */
  els(): ArrayLike<Element>;
  /** The sound's kind: `laugh`, `cheer` or `boo`. */
  readonly kind: string;
  readonly screen: Screen;
  /** Makes the page's loop of `kind`: called when the nearest place's kind needs one and none lives. */
  voice(kind: string): Voice;
  /** The place has rested on the line for the dwell. Called once. */
  fire(): void;
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
  /** When it first rested on the line this stretch, or null. */
  since: number | null;
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

/** What the watcher holds, for a test to look inside. */
export const __inspect = () => ({ places: places.size, elements: byElement.size, near: near.size, unfired, murmuring: murmuring !== null, listening: observer !== null });

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
      if (place.seen.size > 0 && !place.fired) near.add(place); else near.delete(place);
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

function tick(now: number): void {
  frame = null;
  if (!screen) return;
  const lineY = readingLine(window.innerHeight, hudHeight(), screen.line);
  const measured = new Map<Place, Rect[]>();
  const due: Place[] = [];
  let waiting = false;
  for (const place of near) {
    const rects = boxes(place);
    measured.set(place, rects);
    if (rects.some((r) => r.top <= lineY && r.bottom >= lineY)) {
      place.since ??= now;
      if (now - place.since >= place.spec.screen.dwellMs) due.push(place); else waiting = true;
    } else place.since = null;
  }
  let fadeMs: number | null = null;
  for (const place of due) {
    place.fired = true;
    unfired--;
    place.since = null;
    near.delete(place);
    measured.delete(place);
    for (const e of place.watched) { observer?.unobserve(e); byElement.delete(e); }
    place.watched = new Set();
    place.seen.clear();
    fadeMs = place.spec.screen.fadeMs;
    place.spec.fire();
  }
  /* A fire fades the murmur over the fade, under the take, and makes no loop in its frame; the next frame with a place near makes a fresh one. */
  if (fadeMs !== null) { hush(fadeMs); if (unfired === 0) return; }
  else {
    let best: { gain: number; place: Place } | null = null;
    for (const [place, rects] of measured) {
      const s = place.spec.screen;
      const gain = murmurGain(distance(rects, lineY, pointer ?? undefined), s.reachRem * rem, s.murmurMost);
      if (!best || gain > best.gain) best = { gain, place };
    }
    murmur(best);
  }
  /* The next frame is asked for by the next scroll or move, or by a place still waiting out its dwell: a settled page asks for none. */
  if (waiting) wake();
}

function observe(place: Place): void {
  if (place.fired) return;
  const now = new Set(Array.from(place.spec.els()));
  for (const e of place.watched) if (!now.has(e)) { observer?.unobserve(e); byElement.delete(e); place.seen.delete(e); }
  for (const e of now) if (!place.watched.has(e)) { byElement.set(e, place); observer?.observe(e); }
  place.watched = now;
  if (place.seen.size === 0) near.delete(place);
}

/** Registers a place; the function it returns unregisters it (its post is gone or its words changed). */
export function register(spec: PlaceSpec): Unregister {
  /* A page with no observer (a test's, or a browser too old to have one) has no way to know which places are near: it hears nothing, and reads fine. */
  if (typeof IntersectionObserver !== 'function') return Object.assign(() => {}, { refresh: () => {} });
  if (places.size === 0) start(spec.screen);
  const place: Place = { spec, seen: new Set(), watched: new Set(), fired: false, since: null };
  places.add(place);
  unfired++;
  observe(place);
  const off = (() => {
    if (!places.delete(place)) return;
    if (!place.fired) unfired--;
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
