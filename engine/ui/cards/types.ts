/**
 * What an instance gives the engine for each of its cards (`InstanceUi.cards`, one `CardUi` per
 * card key of the rules' `CardRules`): how a card draws on a post it was played on, its settings in
 * the play form, its rules in plain words, and its face. The engine's screens are written against
 * these and never name a card ("KayfaBB never knows which instance it runs"); a card the instance
 * gives no `CardUi` is played, paid for and shown as its tag on the post, and draws nothing more.
 *
 * A card's name, alignment, price and rules for where it lands are the rules' (engine/rules/cards.ts);
 * this is only what a screen draws.
 */
import type { ComponentType, ReactNode } from 'react';
import type { Settings } from '../../rules/types.ts';
import type { Act, Answer, EffectState, Id } from '../data/api.ts';

/**
 * A card played on a post, read from its card Act: the Act itself is the record, this is its payload
 * in the shape an effect wants (supabase/migrations/0016_cards_screens.sql writes it).
 */
export interface CardPlay {
  /** The play's Act: what a saved state, a release and a log line name it by. */
  readonly id: Id;
  /** The card's key. */
  readonly card: string;
  /** The stacking layer, from 1 (a play written before layers has none and is layer 1). Plays of one card on one post are ordered by it. */
  readonly layer: number;
  /** The character that played it. */
  readonly caster: Id | null;
  /** The caster's words, plain text, at most 200 characters; empty when they left none. */
  readonly message: string;
  /**
   * The card's own settings as the server kept them (Whoops!'s ink), with the server's seed in a
   * seeded card's: the same on every reader's screen, so every reader draws the same effect.
   */
  readonly config: Readonly<Record<string, unknown>>;
  readonly playedAt: string;
  /** The post it landed on. */
  readonly post: Id;
}

/** Who the reader is to a post an effect wraps, on their own screen only (it is computed from the player's own characters, never sent). */
export interface EffectReader {
  /** One of the reader's characters wrote the post: an author is never held, and is the only one whose saved state is kept. */
  readonly author: boolean;
  /** One of the reader's characters played one of these plays: a caster is never held either. */
  readonly caster: boolean;
}

/** Where the post an effect wraps is drawn: in its thread, or in the ORIGIN box of a thread spun from it. */
export type EffectPlace = 'thread' | 'origin';

/**
 * What an effect is given. It wraps `children`, the post's words as they would be drawn without it,
 * and draws whatever it likes around them or over them; with several cards played on a post each
 * card's `Effect` wraps the one played before it, the latest outermost, so a card's `children`
 * already carry the earlier cards' effects.
 */
export interface EffectProps {
  /** The post, as every reader sees it now (its current words included). */
  readonly post: Act;
  /** This card's plays on the post, ordered by layer, then by when they were played: one for most cards, up to the card's stack for the rest. */
  readonly plays: readonly CardPlay[];
  /** What each play's effect has saved, by play: the post author's version, which every reader loads. A play that has saved none is absent. */
  readonly states: Readonly<Record<Id, EffectState>>;
  /** The plays the reader has released themselves from, on every device (their certification). Nothing here is ever broadcast or counted. */
  readonly released: ReadonlySet<Id>;
  readonly reader: EffectReader;
  readonly place: EffectPlace;
  /**
   * Save a play's state, as the post's author (the server refuses anyone else, and so does this,
   * without asking); the screen shows what is saved at once and every other reader hears of it.
   * Bounded and checked by the card's rules (`CardRules.validateState`), whose refusal comes back in its words.
   */
  readonly save: (play: Id, state: Readonly<Record<string, unknown>>) => Promise<Answer<{ readonly play: Id; readonly savedAt: string }>>;
  /** Release the reader from a play's effect for good (Stick Around's certification), and show it at once. */
  readonly release: (play: Id) => Promise<Answer<{ readonly play: Id; readonly releasedAt: string }>>;
  readonly children: ReactNode;
}

/** What the play form gives a card's own settings: its current value, and where to put the next. */
export interface ConfigFormProps {
  /** The settings as they stand; undefined before the player has touched them (the card's rules give the default). */
  readonly config: Readonly<Record<string, unknown>> | undefined;
  readonly onChange: (config: Readonly<Record<string, unknown>>) => void;
  /** The post it will land on, for a setting that depends on it. */
  readonly post: Act;
  /** Unique on the page, to hang the form's labels on. */
  readonly id: string;
}

/**
 * A card's face, as data: a color and an image, which the Vending Machine's slot, the hand's card and
 * the play form draw. It is the instance's art, the one place a card's color is written, so a screen
 * never names one (tools/check-ui-tokens.mjs).
 */
export interface CardArt {
  /** The card's color, for its border, its glow and its fill: any CSS color. */
  readonly color: string;
  /** The ink set on `color`, readable on it. */
  readonly ink: string;
  /** The picture on the card's face, a URL the bundler resolved; none draws the color alone. It is decoration: the card's name and rules say the rest. */
  readonly image?: string;
  /** One short line for the face of a small card, such as the hand's ("Hold a reader on a post."); none draws the name alone. */
  readonly tagline?: string;
}

export interface CardUi {
  /** The rules' `CardRules.key`. */
  readonly key: string;
  /**
   * Draws the card's effect on the post it was played on, wherever the post is drawn. A card without
   * one draws nothing beside its tag on the post. It must draw its `children` (the post's words),
   * or the post is gone. Never given a quote, which holds a post's words and is no post.
   */
  readonly Effect?: ComponentType<EffectProps>;
  /**
   * The ink of a play's tag where the card chooses it (Whoops!'s top layer takes the ink it splatted),
   * given the play and all of this card's plays on its post in play order: any CSS color, drawn as the
   * tag's border and glow on the same glass, the text unchanged. A play it gives none keeps the tag its
   * alignment draws.
   */
  readonly tag?: (play: CardPlay, plays: readonly CardPlay[]) => string | undefined;
  /** The card's own settings in the play form, when it has any (Whoops!'s ink). A card with none gives none. */
  readonly ConfigForm?: ComponentType<ConfigFormProps>;
  /**
   * What the play form calls the part of a play's price that depends on the post it lands on
   * ("Long post, +0.25 per 500 characters"), true to the settings the instance runs; the form says
   * "This post" where a card gives none. The amount is the rules' (`playPrice`), never this line's.
   */
  readonly surcharge?: (settings: Settings) => string;
  /**
   * The card's rules in plain words, for the Vending Machine and the hand: what it does and what it
   * costs, true to the settings the instance runs (its numbers are read from them, never restated).
   * Out of character: plain and honest.
   */
  readonly describe: (settings: Settings) => string;
  /** What the card does in one sentence with no numbers in it, for the face of a large card (the hand's sheet); `describe`'s words when none is given. */
  readonly summary?: string;
  readonly art: CardArt;
}
