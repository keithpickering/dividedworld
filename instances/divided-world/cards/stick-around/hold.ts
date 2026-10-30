/**
 * Stick Around's pure half (screens design, section 10 as amended 2026-10-30; cards plan, Task 4): which hold takes the
 * reader, when it takes over, and the bar a reader fills by scrolling to be released. No DOM here: the effect reads
 * rectangles and scroll deltas off the page and feeds them in, so every rule below is tested on plain numbers.
 *
 * Every number the feel depends on is in TUNING. They are starting points; a dedicated session tunes them with the
 * owner on phones, a mouse and a wheel, and changes this one object.
 */

export const TUNING = {
  /** How much of the post (or of the screen, for a post taller than it) must be on screen, 0 to 1. */
  mostlyInView: 0.6,
  /** How much of the bar one screen of scroll pushed past an end of the post fills, 0 to 1. */
  fillPerScreen: 0.2,
  /** How much of the bar drains away each second, whatever the reader does. */
  drainPerSecond: 0.3,
  /** How much of the bar one press of BREAK FREE fills, 0 to 1. */
  fillPerPress: 0.12,
  /** The pull waits this long after the reader's last scroll event before it counts the scroll as settled. */
  settleMs: 160,
  /** The pull's duration: this much, plus pullMsPerPx for each pixel pulled, at most pullMaxMs. */
  pullBaseMs: 650,
  pullMsPerPx: 0.2,
  pullMaxMs: 1300,
  /** The pull eases in as t to this power, over this share of its time, then lands with a bounce. */
  pullEaseExponent: 2.4,
  pullEaseShare: 0.74,
  /** The rubber band passes the target by at most this many pixels, however long the pull, so long and short land alike. */
  pullOvershootPx: 48,
} as const;

/** The bar's level, 0 empty to FULL: a full bar frees the reader. */
export const FULL = 1;

/** A vertical span in viewport coordinates, as getBoundingClientRect gives it. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * The post is mostly on screen and the reader's own scroll has settled. A reader flicking past is caught when they
 * stop, never in motion. A post taller than the screen cannot be mostly in view, so it counts when it mostly fills
 * the screen.
 */
export function stickAroundTakesOver(post: Span, viewport: Span, scrollSettled: boolean): boolean {
  if (!scrollSettled) return false;
  const height = post.bottom - post.top;
  const room = viewport.bottom - viewport.top;
  if (height <= 0 || room <= 0) return false;
  const seen = Math.min(post.bottom, viewport.bottom) - Math.max(post.top, viewport.top);
  if (seen <= 0) return false;
  return seen / Math.min(height, room) >= TUNING.mostlyInView;
}

export interface Hold {
  id: string;
  span: Span;
  /** The reader has had the post on screen. */
  seen: boolean;
  /** The reader broke free of it this visit. */
  escaped: boolean;
}

/**
 * Of several holds, the one that pulls: the nearest the reader has seen and not escaped, by distance from the
 * viewport's middle (design, section 10, point 3, which the amendment leaves standing). Null when none pulls.
 */
export function pullingHold(holds: readonly Hold[], viewport: Span): string | null {
  const middle = (viewport.top + viewport.bottom) / 2;
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const hold of holds) {
    if (!hold.seen || hold.escaped) continue;
    const distance = Math.abs((hold.span.top + hold.span.bottom) / 2 - middle);
    if (distance < bestDistance) {
      best = hold.id;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether a reader is held at all: never the author or a caster, and not after certifying or breaking free. */
export function isHeld(reader: { isAuthor: boolean; isCaster: boolean; certified: boolean; brokeFree: boolean }): boolean {
  return !reader.isAuthor && !reader.isCaster && !reader.certified && !reader.brokeFree;
}

/** Where the reader is inside the full-screen view's scrolling post, in pixels. */
export interface PostScroll {
  offset: number;
  /** The most the post can scroll: its height less the view's. Zero for a post that fits, which is at both ends. */
  max: number;
}

/**
 * Splits a scroll the reader asked for (pixels, positive down) into what the post scrolls and what is pushed past an
 * end of it. Reading never frees anyone: only the push counts, so a long post is read whole before the bar moves.
 * `push` is signed the same way, so which end was pushed past is kept for releaseSide.
 */
export function pushPastEnd(scroll: PostScroll, delta: number): { offset: number; push: number } {
  const wanted = scroll.offset + delta;
  const offset = Math.min(Math.max(wanted, 0), Math.max(scroll.max, 0));
  return { offset, push: wanted - offset };
}

export interface BarInput {
  /** Signed pixels pushed past an end of the post since the last step (positive down); zero while reading. */
  push: number;
  /** The view's height in pixels, so a push is counted in screens and a phone and a monitor cost alike. */
  screen: number;
  /** Presses of BREAK FREE since the last step. */
  presses: number;
}

/**
 * One step of the bar: it fills by what was pushed or pressed and drains at a constant rate, and stays within 0 and
 * FULL. A push slower than drainPerSecond / fillPerScreen screens a second never gets anywhere, and the button is
 * costed against the same drain, so its accessible path takes about as long as scrolling does.
 */
export function barStep(level: number, input: BarInput, dt: number): number {
  const pushed = input.screen > 0 ? (Math.abs(input.push) / input.screen) * TUNING.fillPerScreen : 0;
  const pressed = input.presses * TUNING.fillPerPress;
  const next = level + pushed + pressed - TUNING.drainPerSecond * Math.max(dt, 0);
  return Math.min(Math.max(next, 0), FULL);
}

/** Which side of the post a full bar puts the reader on: the one they were last pushing toward. */
export function releaseSide(lastPush: number): 'after' | 'before' {
  return lastPush < 0 ? 'before' : 'after';
}

/** How long a pull over `distance` pixels takes. Reduced motion makes it instant: the pull still happens. */
export function pullDuration(distance: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  return Math.min(TUNING.pullBaseMs + TUNING.pullMsPerPx * Math.abs(distance), TUNING.pullMaxMs);
}

/**
 * How far along a pull of `distance` pixels (signed) the page is `elapsedMs` after it began, in pixels from where it
 * started. It gathers speed as t^2.4 and reaches the target in its first 74%, then the rubber band carries it past by
 * at most pullOvershootPx and a damped bounce settles it exactly on the target.
 */
export function pullOffset(elapsedMs: number, distance: number, reducedMotion: boolean): number {
  const total = pullDuration(distance, reducedMotion);
  if (total <= 0 || elapsedMs >= total) return distance;
  if (elapsedMs <= 0) return 0;
  const t = elapsedMs / total;
  if (t < TUNING.pullEaseShare) return distance * Math.pow(t / TUNING.pullEaseShare, TUNING.pullEaseExponent);
  const k = (t - TUNING.pullEaseShare) / (1 - TUNING.pullEaseShare);
  const bounce = TUNING.pullOvershootPx * (1 - k) * (1 - k) * Math.sin(3 * Math.PI * k);
  return distance + Math.sign(distance) * bounce;
}
