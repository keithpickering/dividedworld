/**
 * The player's own reactions on the Acts on screen, across all their characters, kept apart from the
 * page like the tallies are. A kind is held once per Act (the server allows each kind once), a change
 * wakes only the post it belongs to, and it is only ever computed on the player's own screen: the
 * reactions of anyone else are never in it.
 */
import { useSyncExternalStore } from 'react';
import type { Id, MyReaction } from '../data/api.ts';

const NONE: readonly MyReaction[] = Object.freeze([]);

export interface Mine {
  get(act: Id): readonly MyReaction[];
  /** True when the reaction was new. */
  add(reaction: MyReaction): boolean;
  /** True when any of them was new. */
  merge(act: Id, reactions: readonly MyReaction[]): boolean;
  subscribe(act: Id, listener: () => void): () => void;
}

export function createMine(): Mine {
  const held = new Map<Id, readonly MyReaction[]>();
  const listeners = new Map<Id, Set<() => void>>();
  const merge = (act: Id, reactions: readonly MyReaction[]): boolean => {
    const now = held.get(act) ?? NONE;
    const fresh = reactions.filter((r, i) => !now.some((h) => h.kind === r.kind) && reactions.findIndex((x) => x.kind === r.kind) === i);
    if (fresh.length === 0) return false;
    held.set(act, [...now, ...fresh]);
    for (const l of [...(listeners.get(act) ?? [])]) l();
    return true;
  };
  return {
    get: (act) => held.get(act) ?? NONE,
    add: (r) => merge(r.act, [r]),
    merge,
    subscribe(act, listener) {
      const set = listeners.get(act) ?? new Set();
      listeners.set(act, set.add(listener));
      return () => { set.delete(listener); };
    },
  };
}

export function useMine(mine: Mine, act: Id): readonly MyReaction[] {
  return useSyncExternalStore((l) => mine.subscribe(act, l), () => mine.get(act));
}
