/**
 * What a card that draws the reactions (`CardUi.drawsReactions`) is given of a post's row: types only, so the card contract (cards/types.ts) can name them. `useReactionRow` (Reactions.tsx) makes them.
 */
import type { RefObject } from 'react';
import type { MyReaction } from '../data/api.ts';
import type { Quadrant } from '../../rules/types.ts';
import type { Pending } from './mine.ts';

/** One chip of the row: the kind's key, its words, its emoji, its quadrant, its count (none where the totals are hidden from the reader), and whether a press can still count. */
export interface Chip { readonly key: string; readonly name: string; readonly emoji: string; readonly quadrant: Quadrant | null; readonly count: number | null; readonly open: boolean; readonly pending: Pending | null;
  /** The kind is one a card added to this post (a local kind), not one of the instance's own. */
  readonly local: boolean }

/** The kind that just landed on this screen, and whether it waits for the picker to leave first. */
export interface Landed { readonly key: string; readonly after: boolean }

/** What a card that draws the reactions (`CardUi.drawsReactions`) is given of the row (`EffectProps.reactions`): the chips, the reader's own and pending kinds, and the presses, without the row's own drawing. */
export interface ReactionDeck {
  /** One chip for each kind the row would draw, with its count (none where a card hides the totals from the reader) and whether it is pending. */
  readonly chips: readonly Chip[];
  /** What this screen has sent on the post, as the player's own. */
  readonly own: readonly MyReaction[];
  /** The kinds waiting out their grace on this screen. */
  readonly pending: readonly Pending[];
  /** The reader can react here: false on the screen of the post's own author, where a press does nothing and the picker does not open. */
  readonly canReact: boolean;
  /**
   * The row's press: a free kind starts its grace ('held', or 'busy' at the cap), a pending kind is undone ('undone', which sends nothing, ever), and a kind already sent says
   * 'kept' (it can't be taken back). Where the reader cannot react it is 'busy'.
   */
  readonly press: (kind: string) => 'held' | 'busy' | 'undone' | 'kept';
  /** The row's undo of a pending kind. */
  readonly undo: (kind: string) => void;
  /** The server's words for a reaction refused at its send, until the next press. */
  readonly refusal: string | null;
  /** The kind that just landed on this screen (the stamp), and whether it waits for the picker to leave first. */
  readonly landed: Landed | null;
  /** The picker: `open` by an element (or a ref to one), with only the kinds not yet on the post where `onlyNew` is true. The post draws it. */
  readonly picker: { readonly isOpen: boolean; readonly open: (anchor: HTMLElement | RefObject<HTMLElement | null>, onlyNew?: true) => void; readonly close: () => void };
}
