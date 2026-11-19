/**
 * The player's own reactions on the Acts on screen, across all their characters, kept apart from the
 * page like the tallies are. A kind is held once per Act (the server allows each kind once), a change
 * wakes only the post it belongs to, and it is only ever computed on the player's own screen: the
 * reactions of anyone else are never in it. A pressed reaction is first pending: held on this screen
 * alone and never sent until it is due; a kind is pending or sent on an Act, never both.
 */
import { useSyncExternalStore } from 'react';
import type { Id, MyReaction } from '../data/api.ts';

const NONE: readonly MyReaction[] = Object.freeze([]);
const NO_PENDING: readonly Pending[] = Object.freeze([]);

/**
 * A press holds a reaction on the presser's screen this long before it is sent. An engine constant, not
 * an instance setting. See docs/plans/2026-11-19-reaction-grace-design.md, section 2.
 */
export const REACTION_GRACE_MS = 5000;

/** A reaction held on this screen; `due` is the epoch milliseconds at which it sends. */
export interface Pending { readonly act: Id; readonly kind: string; readonly character: Id; readonly due: number }

export interface Mine {
  pending(act: Id): readonly Pending[];
  hold(p: Pending): boolean;
  release(act: Id, kind: string): Pending | null;
  get(act: Id): readonly MyReaction[];
  /** True when the reaction was new. */
  add(reaction: MyReaction): boolean;
  /** True when any of them was new. */
  merge(act: Id, reactions: readonly MyReaction[]): boolean;
  subscribe(act: Id, listener: () => void): () => void;
}

export function createMine(): Mine {
  const held = new Map<Id, readonly MyReaction[]>();
  const waiting = new Map<Id, readonly Pending[]>();
  const listeners = new Map<Id, Set<() => void>>();
  const wake = (act: Id): void => { for (const l of [...(listeners.get(act) ?? [])]) l(); };
  const merge = (act: Id, reactions: readonly MyReaction[]): boolean => {
    const now = held.get(act) ?? NONE;
    const fresh = reactions.filter((r, i) => !now.some((h) => h.kind === r.kind) && reactions.findIndex((x) => x.kind === r.kind) === i);
    if (fresh.length === 0) return false;
    held.set(act, [...now, ...fresh]);
    const wait = waiting.get(act) ?? NO_PENDING;
    if (wait.some((p) => fresh.some((r) => r.kind === p.kind))) {
      const rest = wait.filter((p) => !fresh.some((r) => r.kind === p.kind));
      if (rest.length === 0) waiting.delete(act); else waiting.set(act, rest);
    }
    wake(act);
    return true;
  };
  return {
    pending: (act) => waiting.get(act) ?? NO_PENDING,
    hold(p) {
      const wait = waiting.get(p.act) ?? NO_PENDING;
      if (wait.some((w) => w.kind === p.kind) || (held.get(p.act) ?? NONE).some((r) => r.kind === p.kind)) return false;
      waiting.set(p.act, [...wait, p]);
      wake(p.act);
      return true;
    },
    release(act, kind) {
      const wait = waiting.get(act) ?? NO_PENDING;
      const found = wait.find((w) => w.kind === kind);
      if (!found) return null;
      const rest = wait.filter((w) => w !== found);
      if (rest.length === 0) waiting.delete(act); else waiting.set(act, rest);
      wake(act);
      return found;
    },
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

export function usePending(mine: Mine, act: Id): readonly Pending[] {
  return useSyncExternalStore((l) => mine.subscribe(act, l), () => mine.pending(act));
}
