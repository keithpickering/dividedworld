/**
 * The one minute clock a visit's marks and panels share (Visit.tsx): a store that starts its interval when the first of them subscribes and
 * clears it when the last leaves, so a thread of many open visits runs one timer, and a page with none runs none. A visit asks for it only while
 * it is open and before its end (`useMinute`): once the time is up the number reads 0:00 and nothing moves, so a finished visit costs nothing.
 */
import { useState, useSyncExternalStore } from 'react';

const MINUTE = 60_000;
let value = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    value = Date.now();
    timer = setInterval(() => {
      value = Date.now();
      for (const l of [...listeners]) l();
    }, MINUTE);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const idle = (): (() => void) => () => {};

/** The time, as of mount and each minute after while `endsAt` is ahead of it; `null` (a visit that is not open) asks for no clock. */
export function useMinute(endsAt: string | null): number {
  const [mounted] = useState(() => Date.now());
  const read = () => Math.max(value, mounted);
  const active = endsAt !== null && Date.parse(endsAt) > read();
  const now = useSyncExternalStore(active ? subscribe : idle, read, read);
  return now;
}
