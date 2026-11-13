/** What a post reads of the thread it is in. */
import { createContext, useContext } from 'react';
import type { PronounSet } from '../../rules/pronouns.ts';
import type { Act, Id, ThreadSummary, Visit } from '../data/api.ts';
import type { Plays } from '../cards/plays.ts';
import type { Mine } from '../reactions/mine.ts';
import type { Tallies } from './tallies.ts';

/** A reply a play in force draws under a post: the play and the reply as an Act. */
export interface Under { readonly play: Id; readonly act: Act }

export interface ThreadContext {
  readonly thread: Id;
  readonly perPage: number;
  readonly summary: ThreadSummary;
  readonly tallies: Tallies;
  /** The player's own reactions on the Acts on screen. */
  readonly mine: Mine;
  /** The card plays on the posts on screen, with what their effects keep (engine/ui/cards/plays.ts). */
  readonly plays: Plays;
  /** The post a reply is drawn under, by the reply's id, or undefined for a post of the thread's own: what a card that replies reads to leave itself off a reply. Stable; a reply is drawn only after it is known. A thread drawn with none has no replies. */
  readonly underOf?: (act: Id) => Id | undefined;
  /** Each post's latest visit, by the post's id, as the pages read carried it. */
  readonly visits?: ReadonlyMap<Id, Visit>;
  /** A character's name as the thread knows it, for a card tag's caster: "A character" where it could not be read, The System's for none. */
  readonly nameOf: (character: Id | null) => string;
  /** A character's square picture URL as the thread knows it (read with the same people as `nameOf`), null for none or an unknown character. */
  readonly faceOf: (character: Id | null) => string | null;
  /** A character's pronouns as the thread knows them (its profile, read with the page): copy about a visit's Mod takes the set of the character holding the office now. The engine's it/its where the character could not be read. */
  readonly pronounsOf: (character: Id | null) => PronounSet;
  /**
   * Read these characters so the thread can name them (a card tag's caster is named before it is drawn). A play the player
   * makes on a post is added after its caster is known, since a tag is not redrawn when a name arrives; a thread drawn
   * without it (a story) knows its names already.
   */
  readonly know?: (characters: readonly (Id | null)[]) => Promise<void>;
  /** Read the page that holds this post again and take what it says (the replies a play drew under its posts too): what a play form asks after a play it found landed on a lost answer, so a reply the answer should have carried is drawn. */
  readonly reread?: (post: Id) => Promise<void>;
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
