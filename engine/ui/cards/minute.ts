/**
 * The one minute clock a visit's marks and panels share (Visit.tsx): a store that starts its interval when the first of them subscribes and
 * clears it when the last leaves, so a thread of many open visits runs one timer, and a page with none runs none. A visit asks for it only while
 * it is open and before its end (`useMinute`): once the time is up the number reads 0:00 and nothing moves, so a finished visit costs nothing.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useKayfa } from '../context.tsx';

const MINUTE = 60_000;
/* The clock is the backend's (`api.now()`, the one clock of every time the screens compare), given by the first subscriber; the store holds the time as of its last tick. */
let clock: (() => number) | null = null;
let value = 0;
/* Whose clock `value` was read from: a time another backend's clock gave is no time here. */
let source: object | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function unsubscribe(listener: () => void): void {
  listeners.delete(listener);
  if (listeners.size === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
    clock = null;
  }
}

const idle = (): (() => void) => () => {};

/** The time, as of mount and each minute after while `endsAt` is ahead of it; `null` (a visit that is not open) asks for no clock. */
export function useMinute(endsAt: string | null): number {
  const { api } = useKayfa();
  const [mounted] = useState(() => api.now());
  const subscribe = useCallback((listener: () => void): (() => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      clock = () => api.now();
      source = api;
      value = clock();
      timer = setInterval(() => {
        value = clock!();
        for (const l of [...listeners]) l();
      }, MINUTE);
    }
    return () => unsubscribe(listener);
  }, [api]);
  const read = () => (source === api ? Math.max(value, mounted) : mounted);
  const active = endsAt !== null && Date.parse(endsAt) > read();
  return useSyncExternalStore(active ? subscribe : idle, read, read);
}
