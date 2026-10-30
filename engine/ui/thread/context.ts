/** What a post reads of the thread it is in. */
import { createContext, useContext } from 'react';
import type { Act, Id, ThreadSummary } from '../data/api.ts';
import type { Plays } from '../cards/plays.ts';
import type { Mine } from '../reactions/mine.ts';
import type { Tallies } from './tallies.ts';

export interface ThreadContext {
  readonly thread: Id;
  readonly perPage: number;
  readonly summary: ThreadSummary;
  readonly tallies: Tallies;
  /** The player's own reactions on the Acts on screen. */
  readonly mine: Mine;
  /** The card plays on the posts on screen, with what their effects keep (engine/ui/cards/plays.ts). */
  readonly plays: Plays;
  /** A character's name as the thread knows it, for a card tag's caster: "A character" where it could not be read, The System's for none. */
  readonly nameOf: (character: Id | null) => string;
  /** Reports which posts are in view, for mark_read. */
  readonly observer: IntersectionObserver | null;
  /** Put a quote of this Act in the reply box; null where the thread has no reply box (The System's board). */
  readonly quote: ((act: Act) => void) | null;
  /** An Act of this thread changed under the player's own hand (an edit): show it now. */
  readonly changed: (act: Act) => void;
}

export const ThreadCtx = createContext<ThreadContext | null>(null);
export function useThread(): ThreadContext {
  const c = useContext(ThreadCtx);
  if (!c) throw new Error('a post is rendered inside a thread');
  return c;
}
