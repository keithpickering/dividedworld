/**
 * The tallies of the Acts on screen, kept apart from the page. A tally only grows, so each kind's
 * largest count wins whatever order the counts arrive in (a broadcast may come twice or late), and
 * a change wakes only the post it belongs to: a storm of reactions on a busy thread re-renders the
 * posts it lands on and never the page. A post reads its own through `useTally`.
 */
import { useSyncExternalStore } from 'react';
import type { Id, Tally } from '../data/api.ts';

const NONE: Tally = Object.freeze({});

export interface Tallies {
  get(act: Id): Tally;
  /** Keep each kind's largest; true when anything grew. */
  merge(act: Id, tally: Tally): boolean;
  subscribe(act: Id, listener: () => void): () => void;
}

export function createTallies(): Tallies {
  const counts = new Map<Id, Tally>();
  const listeners = new Map<Id, Set<() => void>>();
  return {
    get: (act) => counts.get(act) ?? NONE,
    merge(act, tally) {
      const now = counts.get(act) ?? NONE;
      let next: Record<string, number> | null = null;
      for (const [kind, count] of Object.entries(tally)) {
        if (count > (now[kind] ?? 0)) (next ??= { ...now })[kind] = count;
      }
      if (!next) return false;
      counts.set(act, next);
      for (const l of [...(listeners.get(act) ?? [])]) l();
      return true;
    },
    subscribe(act, listener) {
      const set = listeners.get(act) ?? new Set();
      listeners.set(act, set.add(listener));
      return () => { set.delete(listener); };
    },
  };
}

export function useTally(tallies: Tallies, act: Id): Tally {
  return useSyncExternalStore((l) => tallies.subscribe(act, l), () => tallies.get(act));
}
