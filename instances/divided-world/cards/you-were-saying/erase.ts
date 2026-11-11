/**
 * The hold's clock (docs/plans/2026-11-07-you-were-saying-design.md, section 8; plan Task 8): how many characters of a tail show at a
 * time, given the gestures on it. Pure, so the same two events (a hold, a release) from a pointer, a finger or the Backspace key leave
 * the same characters after the same time: the clock, never the device's repeat rate, sets the speed ("an accessible path costs what the
 * obstacle costs"). Reduced motion changes the look and never the cost: it erases at the same rate and waits the same `retypeMs`, and
 * only the typing back in is instant, where otherwise it types at `typeCps`.
 *
 * The phases: `full` (all of it shows), `erasing` (a hold is on it), `waiting` (let go before the end: it comes back after `retypeMs`),
 * `typing` (typing in, on the post's coming into view or coming back after a wait), and `cleared` (the last character went: nothing
 * brings it back from here, the way out being the author's save or a reader's refresh). A state is a snapshot (`phase`, the time it
 * began and the characters shown then); `look` reads it at a time, settling whatever phase ended since, and a press or release works
 * from that settled reading, so a gesture is never applied to a phase that was already over.
 *
 * Characters shown are whole: an erase shows the characters not yet fully gone (a part of one still shows), a typing shows those fully typed.
 */
export type Phase = 'full' | 'erasing' | 'waiting' | 'typing' | 'cleared';

export interface EraseSettings {
  /** Characters erased a second while held (`cardSettings['youWereSaying.eraseCps']`). */
  readonly eraseCps: number;
  /** How long after a release before the end it waits, then types itself back in (`youWereSaying.retypeMs`). */
  readonly retypeMs: number;
  /** Characters typed a second, in and back in (`youWereSaying.typeCps`). */
  readonly typeCps: number;
  /** Motion is reduced: typing in, and typing back in, show everything at once. */
  readonly reduced: boolean;
}

/** A phase's snapshot: `from` is the characters shown at `at` (ms, any clock the caller keeps). */
export interface Erase { readonly phase: Phase; readonly at: number; readonly from: number }
export interface Look { readonly shown: number; readonly cleared: boolean; readonly phase: Phase }
/** A gesture at a time: the hold starts or ends. */
export type Gesture = readonly [at: number, kind: 'hold' | 'release'];

export const FULL: Erase = Object.freeze({ phase: 'full', at: 0, from: 0 });
const CLEARED: Erase = Object.freeze({ phase: 'cleared', at: 0, from: 0 });

/** Starts typing in from `from` characters at `at`; under reduced motion everything shows at once. */
export function typeIn(s: EraseSettings, from: number, at: number): Erase {
  return s.reduced ? FULL : { phase: 'typing', at, from };
}

/** The state as of `t`: a phase that ended since it began is replaced by the one that followed it, each beginning when the last ended. */
function settle(s: EraseSettings, total: number, e: Erase, t: number): Erase {
  switch (e.phase) {
    case 'erasing':
      return e.from - (s.eraseCps * (t - e.at)) / 1000 <= 0 ? CLEARED : e;
    case 'waiting': {
      if (t - e.at < s.retypeMs) return e;
      const back = e.at + s.retypeMs;
      return settle(s, total, s.reduced ? FULL : { phase: 'typing', at: back, from: e.from }, t);
    }
    case 'typing':
      return e.from + (s.typeCps * (t - e.at)) / 1000 >= total ? FULL : e;
    default:
      return e;
  }
}

/** What shows at `t`, and whether it is cleared. `total` is every chained tail's characters together; it may change between readings. */
export function look(s: EraseSettings, total: number, e: Erase, t: number): Look {
  const now = settle(s, total, e, t);
  switch (now.phase) {
    case 'cleared': return { shown: 0, cleared: true, phase: 'cleared' };
    case 'full': return { shown: total, cleared: false, phase: 'full' };
    case 'erasing': return { shown: Math.min(total, Math.ceil(now.from - (s.eraseCps * (t - now.at)) / 1000)), cleared: false, phase: 'erasing' };
    case 'waiting': return { shown: Math.min(total, now.from), cleared: false, phase: 'waiting' };
    case 'typing': return { shown: Math.min(total, Math.floor(now.from + (s.typeCps * (t - now.at)) / 1000)), cleared: false, phase: 'typing' };
  }
}

/**
 * A hold begins at `t`. A tail that is typing in (on first view, a replay, or coming back after a release) is taken as whole when the
 * hold starts and erased from its full length, so pressing early never shortens the cost: it is always the whole tail's characters over
 * `eraseCps` of continuous hold. A tail waiting to come back goes on from where it was left. With nothing in it there is nothing to hold.
 */
export function press(s: EraseSettings, total: number, e: Erase, t: number): Erase {
  const now = settle(s, total, e, t);
  if (now.phase === 'erasing' || now.phase === 'cleared') return now;
  const shown = now.phase === 'typing' ? total : look(s, total, now, t).shown;
  return shown <= 0 ? now : { phase: 'erasing', at: t, from: shown };
}

/** The hold ends at `t`: before the end the wait for the retype starts there; at the end it stays cleared. */
export function release(s: EraseSettings, total: number, e: Erase, t: number): Erase {
  const now = settle(s, total, e, t);
  if (now.phase !== 'erasing') return now;
  return { phase: 'waiting', at: t, from: look(s, total, now, t).shown };
}

/** Folds gestures (in time order) into `start`, then reads at `t`: the whole story of a hold as data, for the tests and for anyone replaying one. */
export function run(s: EraseSettings, total: number, start: Erase, gestures: readonly Gesture[], t: number): Look {
  let e = start;
  for (const [at, kind] of gestures) e = (kind === 'hold' ? press : release)(s, total, e, at);
  return look(s, total, e, t);
}

/** The longest gap between two readings of a running hold that is credited; a throttled or hidden page's timer cannot bank erase time past it. */
export const GAP_MS = 250;

/**
 * The clock is read at `t` after it was last read at `lastRead`. A hold across a gap longer than `GAP_MS` is credited only up to
 * `lastRead` and then ends there, as a release (the wait to come back starts at `t`, when it was found out).
 */
export function lapse(s: EraseSettings, total: number, e: Erase, lastRead: number, t: number): Erase {
  if (e.phase !== 'erasing' || t - lastRead <= GAP_MS) return e;
  const then = settle(s, total, e, lastRead);
  if (then.phase !== 'erasing') return then;
  return { phase: 'waiting', at: t, from: look(s, total, then, lastRead).shown };
}
