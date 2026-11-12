/**
 * The page's one watcher for Laugh Track (docs/plans/2026-11-11-laugh-track-design.md, sections 6 and 8; plan Task 13). Every cued place
 * on the page, of every post, registers here, and the page holds ONE `IntersectionObserver` (which places are near the viewport), ONE
 * passive scroll listener and ONE pointermove listener (a mouse only), however many posts and places there are. Forty posts of thirty
 * places cost exactly that, and a still page costs no frame.
 *
 * Frames (`requestAnimationFrame`) run only while the page scrolls, a mouse moves, or a place rests on the line waiting out its dwell, and
 * never on an interval. A frame measures only the places the observer says are near, reads the line from `--kb-hud-measured` (the HUD's
 * measured height, frame/Hud.tsx), fires a place that has rested on the line for its dwell, and sets the murmurs.
 *
 * The page has one audience: the murmur is one loop for each kind, for the page and not for a post. The watcher owns those loops. A place
 * says how to make its kind's loop (`voice`), the first that needs one makes it (and only when a murmur is first wanted, so a page nobody
 * scrolls to a cue fetches nothing), and the nearest unfired place of a kind, on whichever post, sets its gain. A loop lives while any
 * unfired place of its kind is registered: the last place of a kind to fire or unregister (its post gone) stops it with the fade, so a
 * post going never silences a murmur another still drives, and no held caption outlives the last post (#496).
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
  /** Makes the loop of `kind` for the page: called at most once while a kind has places. */
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
const voices = new Map<string, { readonly voice: Voice; gain: number; readonly fadeMs: number }>();
let observer: IntersectionObserver | null = null;
let frame: number | null = null;
let pointer: Point | null = null;
let rem = 16;
let screen: Screen | null = null;

const kindOf = (kind: string) => [...places].filter((p) => p.spec.kind === kind && !p.fired);

function onScroll(): void { wake(); }
function onPointer(e: unknown): void {
  const p = e as { pointerType?: string; clientX: number; clientY: number };
  if (p.pointerType !== 'mouse') return;
  pointer = { x: p.clientX, y: p.clientY };
  wake();
}

function start(first: Screen): void {
  screen = first;
  rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const place = byElement.get(e.target);
      if (!place) continue;
      if (e.isIntersecting) place.seen.add(e.target); else place.seen.delete(e.target);
      if (place.seen.size > 0 && !place.fired) near.add(place); else near.delete(place);
    }
    wake();
  }, { rootMargin: `${first.reachRem * rem}px 0px` });
  /* The scroll of any scroller on the page, not the window's alone: it does not bubble, so it is captured. */
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  document.addEventListener('pointermove', onPointer, { passive: true });
}

function stop(): void {
  document.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
  document.removeEventListener('pointermove', onPointer);
  observer?.disconnect();
  observer = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null; pointer = null; screen = null;
  near.clear();
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

/** Make, set or let go of each kind's loop from the unfired places' distances; the nearest place of a kind has the gain. */
function murmur(gains: Map<string, { gain: number; place: Place }>, kinds: Iterable<string>): void {
  for (const kind of kinds) {
    const unfired = kindOf(kind);
    const have = voices.get(kind);
    if (unfired.length === 0) {
      if (have) { have.voice.setGain(0); have.voice.stop(have.fadeMs); voices.delete(kind); }
      continue;
    }
    const best = gains.get(kind);
    const gain = best?.gain ?? 0;
    if (!have) {
      if (gain <= 0 || !best) continue;
      const made = { voice: best.place.spec.voice(kind), gain: 0, fadeMs: best.place.spec.screen.fadeMs };
      voices.set(kind, made);
      made.voice.setGain(gain);
      made.gain = gain;
    } else if (have.gain !== gain) {
      have.voice.setGain(gain);
      have.gain = gain;
    }
  }
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
  const kinds = new Set<string>(voices.keys());
  for (const place of due) {
    place.fired = true;
    place.since = null;
    near.delete(place);
    measured.delete(place);
    if (observer) for (const e of place.watched) observer.unobserve(e);
    place.watched = new Set();
    kinds.add(place.spec.kind);
    place.spec.fire();
  }
  /* A place that fired no longer builds: the next nearest of its kind does, or its kind's loop is let go. */
  const gains = new Map<string, { gain: number; place: Place }>();
  for (const [place, rects] of measured) {
    const s = place.spec.screen;
    const gain = murmurGain(distance(rects, lineY, pointer ?? undefined), s.reachRem * rem, s.murmurMost);
    const best = gains.get(place.spec.kind);
    if (!best || gain > best.gain) gains.set(place.spec.kind, { gain, place });
    kinds.add(place.spec.kind);
  }
  murmur(gains, kinds);
  /* The next frame is asked for by the next scroll or move, or by a place still waiting out its dwell: a settled page asks for none. */
  if (waiting) wake();
}

function observe(place: Place): void {
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
  observe(place);
  const off = (() => {
    if (!places.delete(place)) return;
    for (const e of place.watched) { observer?.unobserve(e); byElement.delete(e); }
    near.delete(place);
    if (places.size === 0) { for (const [kind, v] of voices) { v.voice.setGain(0); v.voice.stop(v.fadeMs); voices.delete(kind); } stop(); return; }
    murmur(new Map(), [spec.kind]);
    wake();
  }) as Unregister;
  off.refresh = () => { if (places.has(place)) observe(place); };
  return off;
}
