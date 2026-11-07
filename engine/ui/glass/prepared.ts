/**
 * An overlay that reads opens only once its data has landed (the glass-load design, section 4): its trigger spins meanwhile, the
 * pointer's rest or focus on the trigger starts the read early, and Escape cancels. `usePrepared` is that, once:
 *
 * - `early()` starts the read and keeps its answer 30 seconds; a second `early` or an `open` within that time shares it, so a rest
 *   followed by a press makes one read.
 * - `open()` uses that answer, or starts the read, and sets `data` when it lands. The caller mounts its overlay only with `data`,
 *   so the entrance plays over finished content. While the read is out `busy` is true (the trigger is a `GlassButton busy`).
 * - `cancel()` (Escape does it while busy) aborts the read's signal, and nothing opens. It also clears `data`, so a caller's
 *   close is `cancel()`.
 * - A read that fails sets `failed` until the next `open()`; the caller shows `PREPARED_FAILED` under the trigger.
 *
 * The answer of an `open` is not kept: the next open reads again, so an overlay reopened later never shows a stale one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** The plain line under a trigger whose read failed. */
export const PREPARED_FAILED = 'That didn’t load. Try again.';

/** How long a read started early is kept. */
export const KEEP_MS = 30_000;
/** How long the pointer or focus rests on a trigger before its read starts (the router's `Link`). */
export const REST_MS = 100;

export interface Prepared<T, A = void> {
  readonly data: T | null;
  readonly busy: boolean;
  readonly failed: boolean;
  /** Resolves with the answer, or null when it failed or was cancelled. */
  readonly open: (arg: A) => Promise<T | null>;
  readonly early: (arg: A) => void;
  readonly cancel: () => void;
}

interface Held<T> {
  readonly key: string;
  readonly controller: AbortController;
  readonly promise: Promise<T>;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * `read` gets the signal and, for a trigger that can open one of several things (a ghost mark on any post), the argument the trigger
 * passes to `early` and `open`; `keyOf` names what that argument reads, and a held answer for another key is not used.
 */
export function usePrepared<T, A = void>(read: (signal: AbortSignal, arg: A) => Promise<T>, keyOf: (arg: A) => string = () => ''): Prepared<T, A> {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const reader = useRef(read);
  reader.current = read;
  const keyer = useRef(keyOf);
  keyer.current = keyOf;
  const held = useRef<Held<T> | null>(null);
  /* Which `open` is current: a cancel, or a newer open, makes an older one's answer nothing. */
  const turn = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; turn.current += 1; if (held.current) { clearTimeout(held.current.timer); held.current.controller.abort(); held.current = null; } };
  }, []);

  const drop = useCallback((h: Held<T>, abort: boolean) => {
    clearTimeout(h.timer);
    if (abort) h.controller.abort();
    if (held.current === h) held.current = null;
  }, []);

  const start = useCallback((arg: A): Held<T> => {
    const k = keyer.current(arg);
    if (held.current && held.current.key === k) return held.current;
    if (held.current) drop(held.current, true);
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => reader.current(controller.signal, arg));
    const h: Held<T> = { key: k, controller, promise, timer: setTimeout(() => drop(h, true), KEEP_MS) };
    held.current = h;
    /* A read that fails is not kept: the next press reads again. */
    promise.catch(() => drop(h, false));
    return h;
  }, [drop]);

  const early = useCallback((arg: A) => { start(arg).promise.catch(() => undefined); }, [start]);

  const open = useCallback(async (arg: A): Promise<T | null> => {
    const mine = ++turn.current;
    setFailed(false);
    setBusy(true);
    const h = start(arg);
    try {
      const value = await h.promise;
      if (!alive.current || turn.current !== mine) return null;
      drop(h, false);
      setData(value);
      setBusy(false);
      return value;
    } catch {
      if (alive.current && turn.current === mine) { setFailed(true); setBusy(false); }
      return null;
    }
  }, [start, drop]);

  const cancel = useCallback(() => {
    turn.current += 1;
    if (held.current) drop(held.current, true);
    setBusy(false);
    setData(null);
  }, [drop]);

  useEffect(() => {
    if (!busy) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, cancel]);

  return { data, busy, failed, open, early, cancel };
}

/**
 * The pointer-rest and focus handlers of a trigger, which call `early` after REST_MS as `Link` does. Spread onto the trigger.
 * A press on the pointer starts the read at once.
 */
export function useRest(early: () => void) {
  /* The latest `early`, so a trigger may pass a closure over what it renders. */
  const latest = useRef(early);
  latest.current = early;
  const go = useCallback(() => latest.current(), []);
  const pointer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focus = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(pointer.current); clearTimeout(focus.current); }, []);
  return {
    onPointerEnter: () => { clearTimeout(pointer.current); pointer.current = setTimeout(go, REST_MS); },
    onPointerLeave: () => clearTimeout(pointer.current),
    onFocus: () => { clearTimeout(focus.current); focus.current = setTimeout(go, REST_MS); },
    onBlur: () => clearTimeout(focus.current),
  } as const;
}
