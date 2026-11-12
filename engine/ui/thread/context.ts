/** What a post reads of the thread it is in. */
import { createContext, useContext } from 'react';
import type { PronounSet } from '../../rules/pronouns.ts';
import type { Act, Id, ThreadSummary, Visit } from '../data/api.ts';
import type { Plays } from '../cards/plays.ts';
import type { Mine } from '../reactions/mine.ts';
import type { Tallies } from './tallies.ts';

/** A post of the reader's own that a card's author veil shows under the stand-in: which of their characters wrote it, the veil's play and when it ends (`ThreadPage.veiled`). */
export interface Veiled { readonly character: Id; readonly play: Id; readonly endsAt: string }

export interface ThreadContext {
  readonly thread: Id;
  readonly perPage: number;
  readonly summary: ThreadSummary;
  readonly tallies: Tallies;
  /** The player's own reactions on the Acts on screen. */
  readonly mine: Mine;
  /** The card plays on the posts on screen, with what their effects keep (engine/ui/cards/plays.ts). */
  readonly plays: Plays;
  /** Each post's latest visit, by the post's id, as the pages read carried it. */
  readonly visits?: ReadonlyMap<Id, Visit>;
  /**
   * The reader's own veiled posts on the pages shown, by the post's id. A veiled post is drawn under the stand-in for everyone, its author's player included,
   * so only this says it is theirs: read it through `ownerOf`, never by comparing `act.character`. Absent where a post is drawn outside the thread screen (a story's lone post).
   */
  readonly veiled?: ReadonlyMap<Id, Veiled>;
  /** A character's name as the thread knows it, for a card tag's caster: "A character" where it could not be read, The System's for none. */
  readonly nameOf: (character: Id | null) => string;
  /** Whether a character is the stand-in a card's veil shows for a withheld author (office `anonymous`), as the thread knows it: false for none or one it could not read. An instance's effect reads it to tell a post still drawn under the stand-in from one that has its true character back. */
  readonly standIn?: (character: Id | null) => boolean;
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

/**
 * The character of the reader's that wrote a post, where the post is a veiled one of theirs (the page is drawn under the stand-in), else the post's own character.
 * The three places that ask whether a post is the reader's read it: the Edit button, the reaction row's `theirs` and `EffectReader.author`.
 */
export const ownerOf = (veiled: ReadonlyMap<Id, Veiled> | undefined, act: Pick<Act, 'id' | 'character'>): Id | null => veiled?.get(act.id)?.character ?? act.character;

/** `ownerOf` for the thread the post is drawn in; the post's own character where it is drawn outside a thread (the ORIGIN box, a story's lone post). */
export function useOwnerOf(): (act: Pick<Act, 'id' | 'character'>) => Id | null {
  const veiled = useContext(ThreadCtx)?.veiled;
  return (act) => ownerOf(veiled, act);
}
