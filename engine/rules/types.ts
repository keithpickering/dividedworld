/**
 * The types every instance implements, and the shapes the settlement reads.
 *
 * The engine is written against `Instance` and never names one: an instance's classes,
 * cards, reactions, settings and board seed arrive through this interface, handed to the
 * engine by the composition root (supabase/functions/). See CLAUDE.md, "KayfaBB never knows
 * which instance it runs".
 *
 * Aura is an integer count of hundredths of an orb wherever it is stored or returned. Times
 * are epoch milliseconds.
 */
import type { CardRules } from './cards.ts';

/** Where a reaction sits on the two axes the classes read: how excited, how positive. */
export type Quadrant = 'excitedPositive' | 'excitedNegative' | 'calmPositive' | 'boredNegative';

export const QUADRANTS: readonly Quadrant[] = ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'];

/** One reaction a player can leave: its stable key, the emoji shown, its quadrant. */
export interface ReactionKind {
  readonly key: string;
  readonly emoji: string;
  readonly quadrant: Quadrant;
}

/** A card's alignment: Sweet enhances, Salty defuses, Pepperoni depends on context. */
export type Alignment = 'sweet' | 'salty' | 'pepperoni';

export const ALIGNMENTS: readonly Alignment[] = ['sweet', 'salty', 'pepperoni'];

/** Aura, in hundredths of an orb. */
export type Hundredths = number;

/** A length of time in calendar units, so "3 months" stays three months in SQL too. */
export interface Span {
  readonly unit: 'day' | 'week' | 'month';
  readonly count: number;
}

/** The settings the engine itself reads. A class's own numbers live with the class. */
export interface Settings {
  /** The most a wallet holds; Aura past it leaves the wallet and stays in the standing. */
  readonly walletCap: Hundredths;
  /** What one whole vote on a class's favored or hostile reactions is worth. */
  readonly vote: Hundredths;
  /** Each further Act by one character a player votes on in a window weighs this times the one before. */
  readonly halving: number;
  /** The most distinct reactions one player leaves on one Act, across all their characters. */
  readonly reactionCap: number;
  /** The most characters one player runs. */
  readonly charactersPerPlayer: number;
  /** When The System settles, as a five-field cron expression in UTC. */
  readonly settlementCron: string;
  readonly seasonLength: Span;
  readonly turnCooldown: Span;
  readonly registrationMode: 'invite' | 'open';
}

/** The kinds of Act the settlement reads. */
export type ActKind = 'post' | 'spin' | 'card' | 'edit' | 'turn';

/** A board the instance starts with. */
export interface BoardSeed {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}

/* ------------------------------------------------------------ the settlement's input ---- */

/**
 * An Act as the settlement reads it. `thread` is the thread it is in; for a `spin` it is the
 * thread the spin opened, and `target` the Act it was spun from. For a `card`, `target` is the
 * post it landed on.
 */
export interface InputAct {
  readonly id: string;
  readonly character: string;
  readonly kind: ActKind;
  readonly at: number;
  readonly thread: string;
  readonly target?: string;
  readonly card?: string;
}

/**
 * One reaction. Who left it (player and character) is private and never leaves the server;
 * the settlement reads it only to keep one player's reactions to one vote and to drop a
 * player's reactions to their own characters.
 */
export interface InputReaction {
  readonly act: string;
  readonly kind: string;
  readonly at: number;
  readonly player: string;
  readonly character: string;
}

/** A character, its player (private), and the classes it has held, oldest first. */
export interface InputCharacter {
  readonly id: string;
  readonly player: string;
  readonly classes: readonly { readonly class: string; readonly from: number }[];
}

/**
 * Everything one settlement window reads. `acts` holds the window's Acts and every earlier Act
 * the window touches (a post reacted to, a card's target, a spun thread's origin and earlier
 * replies); `reactions` holds the window's reactions and every earlier reaction on an Act
 * reacted to in the window. Nothing at or after `to` is read.
 */
export interface SettlementInput {
  readonly window: { readonly id: string; readonly from: number; readonly to: number };
  readonly characters: readonly InputCharacter[];
  readonly acts: readonly InputAct[];
  readonly reactions: readonly InputReaction[];
}

/* ------------------------------------------------------ what a class's rules are given ---- */

/** A reaction one of the character's Acts received, as a weight in votes; never who left it. */
export interface ReceivedReaction {
  readonly act: string;
  readonly actKind: ActKind;
  readonly quadrant: Quadrant;
  readonly at: number;
  /** The reaction's share of its player's one vote on the Act, times the halving. */
  readonly votes: number;
}

/** A reaction the character gave. */
export interface GivenReaction {
  readonly act: string;
  readonly quadrant: Quadrant;
  readonly at: number;
  /** This reaction's share of its player's one vote on the Act. */
  readonly share: number;
  /** Where its player came among the players who reacted to the Act, by first reaction: 1 is first. */
  readonly rank: number;
  /** The Act's dominant quadrant by vote weight at this settlement; null on a tie or none. */
  readonly endsUp: Quadrant | null;
}

/** A card the character played, and how it drew against the post it landed on, in the window. */
export interface PlayedCard {
  readonly act: string;
  readonly card: string;
  readonly alignment: Alignment;
  readonly at: number;
  readonly target: string;
  /** The target's author is another player's character. */
  readonly onOthers: boolean;
  /** Votes on the card in the window. */
  readonly votes: number;
  /** Votes on the target post in the window. */
  readonly targetVotes: number;
  /** Votes on the target post after the card was played, by quadrant, from other players. */
  readonly targetAfter: Readonly<Record<Quadrant, number>>;
}

/** A card another player played on one of the character's posts. */
export interface LandedCard {
  readonly act: string;
  readonly card: string;
  readonly alignment: Alignment;
  readonly at: number;
  readonly on: string;
}

/** A thread the character spun, and how many other players had replied before the window and by its end. */
export interface SpunThread {
  readonly act: string;
  readonly thread: string;
  readonly at: number;
  /** It was spun from another player's Act. */
  readonly fromOthers: boolean;
  readonly repliersBefore: number;
  readonly repliersNow: number;
}

/**
 * What a class's rules read: only Acts, things anyone could see happen. A character that
 * Turned inside the window is given one input per class it held, each covering its stretch.
 */
export interface ClassInput {
  readonly character: string;
  readonly from: number;
  readonly to: number;
  readonly posts: readonly { readonly act: string; readonly at: number }[];
  readonly received: readonly ReceivedReaction[];
  readonly given: readonly GivenReaction[];
  readonly cardsPlayed: readonly PlayedCard[];
  readonly cardsLanded: readonly LandedCard[];
  readonly threadsSpun: readonly SpunThread[];
}

/**
 * One thing a class's rules paid or charged. `amount` is in hundredths and may be fractional;
 * the settlement sums and rounds. `reason` is the class's own key for the rule: dot-separated
 * words, each starting lowercase (`face.cheered`), as the ledger stores it.
 */
export interface Earning {
  readonly reason: string;
  readonly amount: number;
  readonly act?: string;
  readonly quadrant?: Quadrant;
}

/** A class: a playstyle, and the rules that turn what a character did and received into Aura. */
export interface ClassRules {
  readonly key: string;
  readonly name: string;
  earn(input: ClassInput, settings: Settings): readonly Earning[];
}

/* ------------------------------------------------------------------- the instance ---- */

export interface Instance {
  readonly key: string;
  readonly name: string;
  readonly classes: readonly ClassRules[];
  readonly cards: readonly CardRules[];
  readonly reactions: readonly ReactionKind[];
  readonly settings: Settings;
  readonly boards: readonly BoardSeed[];
}
