/**
 * Cards: the interface every instance's cards implement.
 *
 * A card is bought from the Vending Machine at its base price and played on a post, which is
 * an Act of its own, posted in the thread and open to reactions. Its rules decide what it
 * costs to play on a given target, whether it can land there given the effects already on it
 * (so cards can combine later), and whether the caster's configuration is one the card
 * accepts. The browser runs these to preview; the server runs them to decide; the SQL
 * function re-checks what it can.
 */
import type { ActKind, Alignment, EconomyRead, Hundredths, Quadrant, Settings, Span } from './types.ts';
import { QUADRANTS, isPost } from './types.ts';
import { parse, safeColor } from '../bbcode/parse.ts';
import { visibleWalk, type Stretch } from '../bbcode/visible.ts';
import { phraseIn } from '../bbcode/phrase.ts';
import { GRID, cellsOf, toBits, type SurfaceStroke } from './surface.ts';

/**
 * Where a card can land (the card mechanic's design, section 7): a post, a character, a thread or a
 * board. Each card lists the reaches it takes (`CardRules.reaches`), a post unless it says.
 */
export type Reach = 'post' | 'character' | 'thread' | 'board';
export const REACHES: readonly Reach[] = Object.freeze(['post', 'character', 'thread', 'board']);
/** The reaches beyond a post, each with a least rarity and a longest time in the settings (`reachRarity`, `reachLasts`). */
export type BeyondPost = Exclude<Reach, 'post'>;
export const BEYOND_POST: readonly BeyondPost[] = Object.freeze(['character', 'thread', 'board']);

/** What a card is played on, as its rules see it: a post with its length, or a character, a thread or a board by its id. */
export type CardTarget =
  | {
    readonly reach: 'post';
    readonly act: string;
    /** The Act's kind; a card lands on it only where `isPost(kind)` holds (a post, or a spun thread's opening Act). */
    readonly kind: ActKind;
    /** The length of the post's current text, in characters. */
    readonly length: number;
    /**
     * The post's current visible text (engine/bbcode/visible.ts): its own words, with a separator where a quote, code, a link or
     * an image stands. A card that works on a post's words reads these, at the offsets the renderer's text layers use.
     */
    readonly text: string;
    /** The stretches of `text` that are a bare address, in its offsets (engine/bbcode/visible.ts): a card that must not touch a link leaves them alone. */
    readonly links: readonly Stretch[];
    /** The character that wrote the post, by id: a public fact the server reads with it (a card played on another character's post compares it with the caster); a screen's preview has none. */
    readonly author?: string;
    /**
     * Which version of the post this is (card_target, 0070): its latest edit's id, or the post's own before any edit. The server
     * reads it with the post and hands it back to play_card, which refuses a play decided against an older one. A screen's
     * preview has none.
     */
    readonly version?: string;
    /** The post this one is drawn under, where it is a reply carried by a play in force (a card that replies); a screen's preview and an ordinary post have none. */
    readonly under?: string;
  }
  | {
    readonly reach: 'character';
    readonly character: string;
    /** The character's live warn points, and when its running ban ends (null when it is not banned): public facts, both on every postbit, that the server reads with the target; a screen's preview has none. */
    readonly warnPoints?: number;
    readonly bannedUntil?: string | null;
  }
  | { readonly reach: 'thread'; readonly thread: string }
  | { readonly reach: 'board'; readonly board: string };
export type PostTarget = Extract<CardTarget, { reach: 'post' }>;

/**
 * A post as a card's rules see it, from its current body: its length in characters and its visible text, and its version where the server read one. `forged` is the version's verdict (its payload's `forged`):
 * a forged quote is a counterfeit, so its words are the poster's own and are in the text the rules see.
 */
export function postTarget(act: string, kind: PostTarget['kind'], body: unknown, version?: string, under?: string, author?: string, forged?: readonly string[]): PostTarget {
  const words = typeof body === 'string' ? body : '';
  const { text, links } = visibleWalk(parse(words, undefined, forged && forged.length > 0 ? new Set(forged) : undefined));
  return { reach: 'post', act, kind, length: [...words].length, text, links, ...(version ? { version } : {}), ...(under ? { under } : {}), ...(author ? { author } : {}) };
}

/**
 * An effect already on a target: a card played there before. A live use card carries its gimmick (what it does while it is
 * up) and when it ends; a card set face down names no card (`card: null`), only that it is face down and when it ends,
 * since which card it is is its setter's alone (card_target, supabase/migrations/0054_card_plays.sql). `ends` is an ISO
 * time; an effect with none does not end.
 */
export interface CardEffect {
  readonly card: string | null;
  readonly act: string;
  readonly gimmick?: GimmickEffect;
  readonly ends?: string;
  readonly faceDown?: true;
  /** Which reach the effect is on: the target's own, or one above it (effectsOnTarget). A post's unless it says. */
  readonly reach?: Reach;
  /** The drive a play belongs to (`CardRules.drive`): its opening play's act id, so the drive's own id. Only a play of a drive card has one. */
  readonly drive?: string;
  /** When that drive closes, an ISO time: its latest play's time plus the card's `drive.lasts`, computed by card_target and never stored. */
  readonly closes?: string;
  /** The quadrant a live skim play names (its checked configuration's `quadrant`), carried so a second play of the card on the post can be refused for the same one (quadrantFree). */
  readonly quadrant?: Quadrant;
  /** The play draws an effect (`CardRules.drawsEffect`) and counts toward the post's limit unless `cleared`. */
  readonly drawing?: true;
  /** A drawing play whose card says it is cleared, for the post as it is now; it counts none, and where the card's `drawsEffect.final` is true it holds no stack place either. */
  readonly cleared?: true;
  /** A play of a rewind card (`CardRules.rewind`): while it is up, no card up to `upTo` lands on the post. Carried by card_target for a live play, so a refusal is the same for every caster. */
  readonly rewind?: { readonly upTo: Rarity };
  /** When the play was played, an ISO time. Where it is given, the latest live rewind is the one a refusal names; without it the list's order stands for time (card_target lists oldest first). */
  readonly at?: string;
}

/**
 * What a use card does while it is up: one of a fixed list the engine holds, each card picking one and setting its numbers.
 * A ward turns away casts on its own target (by rarity, printed flavor or card key); an earn is a percentage of what reactions earn the
 * character or post it is on (`by`, never deepening a loss) or a flat share of a vote for each vote (`flat`), on posts unless it names `acts`;
 * of the flat earns on one vote the largest applies; a cushion gives back a share of each loss a reaction causes;
 * a price adds a flat amount to a cast of the named flavors on its target or anything under it;
 * a ride pays the author of the post it is on `share` of a vote for each vote on a card another player casts on that post while it is up;
 * a no-quote stops a post that quotes the post it is on, before that post is written.
 * A cast card that reaches one character or one post alone may carry an earn too, ending at its `lasts`.
 * A pierce, used on the player's own character, gets that character's next cast past every live ward, and every set card that
 * would catch it, whose card is no rarer than `upTo`; that cast spends it.
 */
export type GimmickEffect =
  | { readonly kind: 'ward'; readonly upTo?: Rarity; readonly flavors?: readonly Alignment[]; readonly cards?: readonly string[] }
  | { readonly kind: 'earn'; readonly quadrants?: readonly Quadrant[]; readonly reactions?: readonly string[]; readonly by: number }
  | { readonly kind: 'earn'; readonly quadrants?: readonly Quadrant[]; readonly reactions?: readonly string[]; readonly flat: number; readonly acts?: readonly ActKind[] }
  | { readonly kind: 'price'; readonly flavors: readonly Alignment[]; readonly add: Hundredths }
  | { readonly kind: 'ride'; readonly share: number }
  | { readonly kind: 'noQuote' }
  | { readonly kind: 'cushion'; readonly share: number }
  | { readonly kind: 'pierce'; readonly upTo: Rarity };
export type WardEffect = Extract<GimmickEffect, { kind: 'ward' }>;
export const GIMMICK_KINDS: readonly GimmickEffect['kind'][] = Object.freeze(['ward', 'earn', 'price', 'ride', 'noQuote', 'cushion', 'pierce']);

/** What a cast does to the staff's discipline of its target, one of a fixed list; each card picks one and sets its numbers. */
export type DisciplineEffect =
  | { readonly kind: 'relief'; readonly points: 'lightestBand' | 'all' }  // on a character: takes the oldest live points off its warn bar
  | { readonly kind: 'unban' }                                             // on a character: ends its running bans
  | { readonly kind: 'fall' }                                              // on another character's post: the next filing lands on the caster
  | { readonly kind: 'watch'; readonly weight: number };                   // on a character: multiplies its weight in a patrol's draw while up
export const DISCIPLINE_KINDS: readonly DisciplineEffect['kind'][] = Object.freeze(['relief', 'unban', 'fall', 'watch']);
/** A play that is over when it lands: it leaves no effect, takes no place in a stack and has no time up. */
export const instant = (rules: Pick<CardRules, 'discipline' | 'cuts'>): boolean => rules.discipline?.kind === 'relief' || rules.discipline?.kind === 'unban' || rules.cuts !== undefined;

/** What a cast set card matches, besides a named card (`catches`): the printed flavors, and the rarity it takes up to. Pepperoni is its own flavor. */
export interface Match {
  readonly flavors?: readonly Alignment[];
  readonly upTo?: Rarity;
}

/** How rare a card is, commonest first. It bounds what a set card names or matches and what a ward turns away. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';
export const RARITIES: readonly Rarity[] = Object.freeze(['common', 'uncommon', 'rare', 'legendary']);
/** Whether rarity `a` is at or below rarity `b`; never, where either is not one of the four. */
export const atOrBelow = (a: Rarity, b: Rarity): boolean => {
  const [i, j] = [RARITIES.indexOf(a), RARITIES.indexOf(b)];
  return i >= 0 && j >= 0 && i <= j;
};

/**
 * The one way a card is played (the card mechanic's design, section 1): cast on a target, used on
 * the player's own post, set face down on the player's own post, or kept in the hand. Keep is named
 * and not built, so no instance holds a Keep card yet (instanceProblems).
 */
export type Play = 'cast' | 'use' | 'set' | 'keep';
export const PLAYS: readonly Play[] = Object.freeze(['cast', 'use', 'set', 'keep']);
export const playOf = (rules: Pick<CardRules, 'play'>): Play => rules.play ?? 'cast';

/**
 * What springs a set card (a card whose play is `set`): a card cast on its post (which catches the one card it names, or the cards its
 * match covers), or a Mod Bot's visit starting. A cast card set face down springs on a quote, which is the engine's and never a card's,
 * so no card names it.
 */
export type Trigger = { readonly on: 'cast' } | { readonly on: 'visit' };
export const TRIGGERS: readonly Trigger['on'][] = Object.freeze(['cast', 'visit']);

/**
 * Whether an effect is still up: it has no end, or its end is after `now`. An end that is no time is
 * read as still up, so a ward or a card back that came in malformed holds rather than lapsing; the
 * server, which wrote the end, decides again.
 */
export const isLive = (effect: Pick<CardEffect, 'ends'>, now: Date = new Date()): boolean => {
  if (effect.ends === undefined) return true;
  const ends = Date.parse(effect.ends);
  return Number.isNaN(ends) || ends > now.getTime();
};

/** Whether a ward turns a card away: its rarity is at or below `upTo`, its printed alignment is one of `flavors`, or its key is one of `cards`. */
export const wardTurnsAway = (effect: WardEffect, rules: Pick<CardRules, 'key' | 'rarity' | 'alignment'>): boolean =>
  (effect.upTo !== undefined && atOrBelow(rules.rarity, effect.upTo)) || (effect.flavors?.includes(rules.alignment) ?? false) || (effect.cards?.includes(rules.key) ?? false);

/**
 * How many of a post's slots are taken (`Settings.postEffects`): on a post target, its own effects (`reach` unset or `'post'`) that are
 * live and either a card face down or a drawing play that is not cleared. A mark-only effect, an effect from above and an ended play
 * count none, and any other target is 0.
 */
export const effectsUp = (target: CardTarget, effects: readonly CardEffect[], now: Date): number =>
  target.reach !== 'post' ? 0 : effects.filter((e) => (e.reach === undefined || e.reach === 'post') && isLive(e, now) && (e.faceDown === true || (e.drawing === true && e.cleared !== true))).length;

/** The refusal of a play on a full post, said by the rules and by the database alike; the words take no capital and no closing period, as `landsOn`'s do. */
export const postFullWords = (n: number): string => `this post already shows ${n} effects, the most it takes. A slot opens when one ends, is ended by an admin, or its author clears it`;

/**
 * Refuses a play that would take a slot on a full post: the target is a post, the play counts (the card declares `drawsEffect`, or it is
 * set face down) and the post's effects up are at `settings.postEffects`. Called after the card's own landing, so its refusal is said first.
 */
export function roomOnPost(rules: Pick<CardRules, 'drawsEffect'>, settings: Pick<Settings, 'postEffects'>, target: CardTarget, effects: readonly CardEffect[], now: Date, set = false): Verdict {
  if (target.reach !== 'post' || !isPost(target.kind)) return ok(undefined);
  if (!set && rules.drawsEffect === undefined) return ok(undefined);
  return effectsUp(target, effects, now) >= settings.postEffects ? refuse(postFullWords(settings.postEffects)) : ok(undefined);
}

/**
 * A rewind's refusal, the same for every caster, since the rewind is face up: the post turns away every card up to `upTo` until its play ends.
 * play_card says it in the same words.
 */
export function rewindWords(name: string, upTo: Rarity, ends: string | undefined): string {
  return `this post's ${name} turns away cards up to ${upTo} until ${ends ? refusalTime(ends) : 'it ends'}`;
}

/**
 * The refusal of a live rewind on a post target that turns a card of `rarity` away, as long as one is up; null on any other target.
 * `nameOf` says a rewind card's name from its key.
 */
function frozenRefusal(rules: Pick<CardRules, 'rarity'>, target: CardTarget, effects: readonly CardEffect[], now: Date, nameOf: (key: string) => string | undefined): Verdict<never> | null {
  if (target.reach !== 'post' || !isPost(target.kind)) return null;
  /* Two live rewinds can cover the card (a rarer over a lesser): the refusal names the latest played, as live_rewind orders them: by its time where the effects carry one, else the later in the list (oldest first). */
  const covering = effects.filter((e) => e.rewind !== undefined && (e.reach ?? 'post') === 'post' && isLive(e, now) && atOrBelow(rules.rarity, e.rewind.upTo));
  const time = (e: CardEffect): number => (e.at === undefined ? Number.NaN : Date.parse(e.at));
  const by = covering.reduce<CardEffect | undefined>((best, e) => (best === undefined || !(time(e) < time(best)) ? e : best), undefined);
  if (by?.rewind === undefined) return null;
  return refuse(rewindWords(by.card === null ? 'rewind' : (nameOf(by.card) ?? by.card), by.rewind.upTo, by.ends));
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A ward's refusal, the same for every caster, since the ward is face up; play_card says it in the same words. It says whichever of the
 * ward's three ways matched the card, in that order: rarity, flavor, name.
 */
export function wardWords(wardName: string, effect: WardEffect, rules: Pick<CardRules, 'key' | 'name' | 'rarity' | 'alignment'>, reach: Reach = 'post'): string {
  const head = `this ${reach}'s ${wardName} turns away`;
  if (effect.upTo !== undefined && atOrBelow(rules.rarity, effect.upTo)) return `${head} cards up to ${effect.upTo}`;
  if (effect.flavors?.includes(rules.alignment)) return `${head} ${capital(rules.alignment)} cards`;
  return `${head} ${rules.name}`;
}

/**
 * What a cast set card's `match` takes, as a noun phrase: "a Salty or Pepperoni card, up to uncommon". The rarity said is the lower of the match's
 * `upTo` and the set card's own (`own`), since a back never takes a card rarer than itself (`spring_facts`); it is left out when that is the rarest, which
 * takes every card. A match with no flavors takes a card of any flavor.
 */
export function matchWords(match: Match, own: Rarity): string {
  const rarity = match.upTo !== undefined && atOrBelow(match.upTo, own) ? match.upTo : own;
  const flavors = (match.flavors ?? []).map(capital);
  const kinds = flavors.length < 2 ? flavors[0] ?? '' :`${flavors.slice(0, -1).join(', ')} or ${flavors[flavors.length - 1]}`;
  const card = kinds === '' ? 'a card' : `a ${kinds} card`;
  if (rarity === RARITIES[RARITIES.length - 1]) return card;
  return kinds === '' ? `${card} up to ${rarity}` : `${card}, up to ${rarity}`;
}

/** The live no-quote effect on a post, if it has one: the play that stops quotes of it. */
export const quoteStop = (effects: readonly CardEffect[], now: Date = new Date()): CardEffect | undefined =>
  effects.find((e) => e.gimmick?.kind === 'noQuote' && (e.reach ?? 'post') === 'post' && isLive(e, now));

/** A stopped quote's refusal, the same for every writer; the guard on acts says it in the same words. `seq` is the quoted post's number where it is in the thread written to. */
export function noQuoteWords(cardName: string, ends: string | undefined, seq: number | null): string {
  const post = seq === null ? 'a post in another thread' : `post ${seq}`;
  return `${post} carries ${cardName}, so it cannot be quoted until ${ends ? refusalTime(ends) : 'it ends'}; take that quote out and send again`;
}

/** How each play is said in a refusal of the wrong one. */
const PLAYED: Record<Play, string> = {
  cast: 'cast',
  use: 'used on your own post',
  set: 'set face down on your own post',
  keep: 'kept in the hand',
};
const wrongPlay = (rules: CardRules): Verdict<never> => refuse(`${rules.name} is ${PLAYED[playOf(rules)]}`);

export type Verdict<T = undefined> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

/**
 * What a card that writes hands the old voice (`docs/plans/2026-11-07-you-were-saying-design.md`, sections 3 and 11): the post the play is on, a few posts before it
 * and the thread's title, as the frame's words need them. `text` is a post's visible text (`visibleText`), never its markup; `tails` are the
 * tails already chained on this post, in play order, which this one continues from the end of; `settings` are the instance's.
 */
export interface WriteFrameInput {
  readonly post: { readonly name: string; readonly text: string };
  readonly before: readonly { readonly name: string; readonly text: string }[];
  readonly title: string;
  readonly tails: readonly string[];
  readonly settings: Settings;
  /** The prompt's most tokens: the old voice's window less the tokens the answer may take. A frame drops its oldest material to fit it. */
  readonly budget: number;
  /** How many tokens a text is, by the instance's tokenizer. */
  readonly count: (text: string) => number;
  /**
   * The text this play has written so far (`docs/plans/2026-11-13-you-were-saying-voice-design.md`, section 3): `''` on a play's first call. A frame
   * continues after it, and where it is not empty, after a paragraph break the frame writes.
   */
  readonly sofar: string;
}

/**
 * How a card's voice is sampled (`docs/plans/2026-11-13-you-were-saying-voice-design.md`, sections 1 and 3). The card owns these numbers, the engine
 * only carries them to the completion. `temperature` and `topP` are always sent; the rest are sent where the card gives them.
 */
export interface WriteSampling {
  readonly temperature: number;
  readonly topP: number;
  readonly topK?: number;
  readonly minP?: number;
  readonly repeatPenalty?: number;
  readonly repeatLastN?: number;
  /** Texts the voice may never produce, each one token of the instance's tokenizer (section 3); the engine maps them to token ids. */
  readonly ban?: readonly string[];
}

/**
 * A card whose effect holds generated text: `tokens` is how many the play bought (from its checked configuration and the settings), and
 * `frame` is a pure function from the thread to a completion's prompt and the stops that end it. The engine owns the queue, the call, the
 * scrubber and the refund; the card owns only these two, and names nothing the engine knows. A card that writes is a cast card that reaches a
 * post alone, and is only cast face up: it is never set face down, so it never springs later on a post its caster did not choose, with no length
 * bought (decideSet refuses it, and so does the server, 0149_card_writes.sql). An instance with no completion endpoint (`Settings.oldVoice`
 * false) does not sell, offer or play it.
 */
export interface Writes<Config = unknown> {
  tokens(config: Config, settings: Settings): number;
  /** How the voice is sampled (design sections 1 and 3). */
  readonly sampling: WriteSampling;
  /** `stopPattern` ends a completion where it matches, beside `stop` (design section 3). */
  frame(input: WriteFrameInput): { readonly prompt: string; readonly stop: readonly string[]; readonly stopPattern?: RegExp };
}

export const OLD_VOICE_OFF = "The old voice isn't running on this forum, so this card can't be played.";

/** A trap's ride: the setter is paid `share` of a vote for each vote the cast draws, in the set's quadrant or, with `every`, in all four. */
export type RideOutcome = { readonly kind: 'ride'; readonly share: number; readonly every?: true };

/** A trap's lockout: the Move that springs the trap lands as usual, and its character is locked out of that post's thread for `hours` (a whole number from 1 to 168). */
export type LockoutOutcome = { readonly kind: 'lockout'; readonly hours: number };

/**
 * What a reader of the board can see of one play, handed to `CardRules.seen`: the play's configuration as the board shows it, its public effect state, its caster's name as the board names it
 * (null where it names none), how long ago it was played ("2 days ago"), and the engine's `amountWords`, which says a share from 0 to 1 as none, a bit, some, about half, most, almost all or all.
 */
export interface SeenPlay {
  readonly config: unknown;
  readonly state: unknown;
  /** The play's public words as the board shows them (a tail, a caption), null where the card has none. */
  readonly text: string | null;
  /** The share of the play's surface that is covered, from 0 to 1, as the board shows it; null where the card has none. */
  readonly covered: number | null;
  readonly by: string | null;
  readonly ago: string;
  readonly amountWords: (share: number) => string;
}

/** What a card's `covers` reads: one play's public configuration and state, and the post's visible text. */
export interface CoverPlay { readonly config: unknown; readonly state: unknown; readonly text: string }

/** A stretch of a post's visible text, [from, to), and the words a reader sees over it. `words` is plain text, written as the text it is and never read as markup; `from` and `to` never split a surrogate pair. */
export interface Cover { readonly from: number; readonly to: number; readonly words: string }

export interface CardRules<Config = unknown> {
  readonly key: string;
  readonly name: string;
  readonly alignment: Alignment;
  /**
   * What a reader of the board sees of one play of this card on a post, in one or two sentences in the fiction's voice, read by a model (never shown to a player; the post's own words stay the post's).
   * Never a number a player cannot see: an amount is said through `amountWords`. `by` may be null, and the sentence must read without it.
   */
  readonly seen?: (p: SeenPlay) => string;
  /**
   * The stretches of the post's visible text this play covers with other words, as every reader of the board sees them before touching the play, read by a model in place of the words under them
   * (the post's own words stay the post's, and its `seen` line still says what lies over them); null or empty for none. Pure, never a private fact.
   */
  readonly covers?: (p: CoverPlay) => readonly Cover[] | null;
  readonly rarity: Rarity;
  /**
   * Out of print: nothing gives out a new copy (a pack, the machine, a Random Event), while every copy already out stays fully playable.
   * It is reversible: take the flag off and the card is in print like any other. A card that has left for good is renamed (`formerly`) or
   * withdrawn (`Instance.withdrawn`), never retired.
   */
  readonly retired?: true;
  /**
   * Found only through the Random Events that name it: never drawn by a pack's pull or an event that names no item, never sold by the machine, never in a fixed pack.
   * An admin may still give it.
   */
  readonly eventOnly?: true;
  /**
   * The keys and names this card went by before, when it is a renamed card: the old key is gone, and every copy of it is this card's.
   * It is one-way (a key that has been renamed away is never a card again), and a name here is how old log lines and cards still say it.
   */
  readonly formerly?: readonly { readonly key: string; readonly name: string }[];
  /** How it is played; a Cast unless it says. */
  readonly play?: Play;
  /**
   * A set card's trap: what springs it. What a spring does is the engine's per trigger: a cast trap catches the card it names (`catches`) or
   * the cards its `match` covers, and takes it; a visit trap ends the visit. Every set card has one. A cast card has none: set face down,
   * it springs on a quote, and the quote lands it. A cast trap names its card (`catches`) or has a `match`, never both.
   *
   * With an `outcome` the spring is not a catch: the cast that springs the trap lands as usual. A ride pays the setter `share` of a vote for each
   * vote that cast draws; where it says `every` it pays in all four quadrants and reads no quadrant from the configuration, otherwise it pays in
   * the quadrant the set named (its checked configuration's `quadrant`). A refund hands the cast's card back to its caster's hand, and a staff
   * cast passes over it. A lockout lets the cast land and locks its character out of the post's thread for `hours`. Any may sit beside a `match` or a `catches`.
   */
  readonly trap?: { readonly trigger: Trigger; readonly match?: Match; readonly outcome?: RideOutcome | { readonly kind: 'refund' } | LockoutOutcome };
  /**
   * A cast card on a post alone, with a `lasts`, face up only, whose checked configuration is `{ to }`, a version of the post (rewind.ts). While it is
   * up the post shows as of that point, and no play of a card no rarer than `upTo` lands on the post (`rewindWords`). It draws an effect
   * (`drawsEffect`), but has no Gimmick, veil, reaction, writes, replies, draws, drive or surface (`instanceProblems`), and is never offered to a staff persona
   * (`staffOffers`), which has no point to pick.
   */
  readonly rewind?: { readonly upTo: Rarity };
  /**
   * A card wrapped in another (season two design, section 1.4): the card is cast face up on a post with a second card from the caster's hand, the gift, and the
   * caster's configuration of it. The gift is a Move that reaches a post and is not itself a wrapper (`giftProblem`); its landing is tried when the post's author
   * opens the box, never before. It stacks at most 1 and reaches a post alone (`instanceProblems`), is face up only (`faceUpOnly`) and is never offered to a staff
   * persona (`staffOffers`), which has no second card to give.
   */
  readonly wraps?: true;
  /** A use card on a post alone with a time up: while it is up, the first `count` casts on its post whose printed flavor is one of `flavors`, landing and not handed back by a card set face down, each go back to their caster's hand. A staff cast passes over it. */
  readonly refunds?: { readonly flavors: readonly Alignment[]; readonly count: number };
  /** A cast trap's catch: the card it waits for, by key, from its checked configuration (a ride trap may name its card here too). Only a set card that springs on a cast and has no `match` has it. */
  catches?(config: Config): string;
  /** A cast card's set phrase: the phrase its landing needs, found in the quoting post's own words, from its checked configuration. Only a cast card has it. */
  setPhrase?(config: Config): string;
  /**
   * A cast card that reaches a post alone and has a `lasts`: its play pays its caster `share` of a vote for each vote its target post draws in the
   * quadrant the play names (its checked configuration's `quadrant`, one of the four). The settlement pays it; nothing here reads who reacted.
   */
  readonly skim?: { readonly share: number };
  /**
   * A cast card that reaches a character alone: its play names a class (its checked configuration's `class`, a string) the character is scored as
   * for one settlement window. Whether the window can be named is the server's, which reads the settlements.
   */
  readonly scoresAs?: true;
  /**
   * A use card's effect while it is up; every use card has one. A cast card that reaches a character alone or a post alone may carry an earn, which the character or post it
   * lands on has while the play is up (a post's earn has a `lasts`). Nothing else has one.
   */
  readonly gimmick?: GimmickEffect;
  /** Where it can land; a post unless it says (`['post']`). A reach beyond a post takes at least its `reachRarity`. */
  readonly reaches?: readonly Reach[];
  /**
   * How long a Use card is up once played, and how long a play beyond a post lasts, at most its reach's `reachLasts`;
   * with none, a Use stays. A cast earn on a post must have one. A cast on a post with a `lasts` ends at its time too, and landsOn then leaves it out of the stack; a cast on a
   * post with none does not end.
   */
  readonly lasts?: Span;
  /** A thread play of it pins the thread to the top of its board's list until it ends (Main Event's kind); only a card that reaches a thread pins. */
  readonly pins?: true;
  /** Generated text its effect holds (a card that writes); a cast card, cast face up on a post alone and never set face down, withheld where `Settings.oldVoice` is false. */
  readonly writes?: Writes<Config>;
  /**
   * Its cast carries a post of the caster's, written with the play and drawn under the target while the play is in force; a cast card that reaches a post
   * alone, stack 1, cast face up and never set face down, never offered to a staff persona.
   */
  readonly replies?: true;
  /**
   * A thread or character play of it stays on every post written in its target while it was up, after its time (`fallsOn`); only a cast card whose one
   * reach is a thread or a character, with a time up.
   */
  readonly keeps?: true;
  /**
   * What its cast does to the staff's discipline of its target (`DisciplineEffect`); a cast card, cast face up and never set face down, with no other effect (no writes, replies,
   * keeps, skim, scoresAs, gimmick, draws, drive or needsMessage). A relief and an unban are over when they land; a fall waits on a post until a filing; a watch is up for its `lasts`.
   */
  readonly discipline?: DisciplineEffect;
  /**
   * A cast card's play ends one live Gimmick (a Use card's play) on its target, the one its checked configuration names (`play`), whose card is no rarer than `upTo`.
   * It is over when it lands: no time up, no layer, no place in a stack. Cast face up, never set face down, never offered to a staff persona.
   */
  readonly cuts?: { readonly upTo: Rarity };
  /** The economy numbers its rules read. */
  readonly reads?: readonly EconomyRead[];
  /** The numbers in `Settings.cardSettings` its screens read, so an instance missing one, or holding one out of its bounds, is refused. */
  readonly screenReads?: readonly EconomyRead[];
  /** How many of this card one post may carry, each its own play and layer; 1 unless said. */
  readonly stack?: number;
  /**
   * Keys the server draws one of at each play (with `random()`, never the caster's choice), stored on the play's payload as `drawn`.
   * What a key means is the card's own; the engine only holds that the list is real: not empty, no duplicate, each key `[a-z0-9-]{1,40}`.
   */
  readonly draws?: readonly string[];
  /**
   * The card draws an effect on the post it lands on, and counts toward `Settings.postEffects` while its play is in force and not cleared.
   * `cleared` reads the play's saved state: true is cleared, `{ version }` is cleared for that version of the post only. It is not `draws`,
   * which is what the server draws one of at each play. Only a card that reaches a post and is not a set card declares it (instanceProblems).
   * `final`: once the play's saved state is cleared for every version of the post (`cleared` answers `true`), the clear is final. No later save on the
   * play is taken, and the play holds no place in its card's stack (`landsOn`). It names no card, and a card that says it gives `cleared` (instanceProblems).
   */
  readonly drawsEffect?: { readonly cleared?: (state: unknown) => boolean | { readonly version: string }; readonly final?: true };
  /**
   * The plays of this card on one post share a drive, which closes `lasts` after its latest play. `gifts` are the economy keys of the
   * amounts a gift to the drive may be, and `overhead` the economy key of the percentage The System keeps of every gift. Only a Cast
   * reaching a post alone has one.
   */
  readonly drive?: { readonly lasts: Span; readonly gifts: readonly string[]; readonly overhead: string };
  /**
   * A card whose every play must carry words: the refusal a blank message (none, or only spaces) meets, in the card's own words, so the
   * engine names no card. Said after the landing and the configuration, as the caster's message is checked. A cast or a use only: a Set has
   * no message. The database holds it again (card_kinds.needs_message, place_cast).
   */
  readonly needsMessage?: string;
  /**
   * A cast card on a post alone that, while it is up (so it has a `lasts`), withholds the post's author (`'author'`: every read shows the instance's
   * anonymous poster instead) or its reaction totals (`'totals'`) from every read. SQL knows only the flag (`card_kinds.veil`).
   */
  readonly veil?: 'author' | 'totals';
  /**
   * A cast card on a post alone whose checked configuration is a post-local reaction, `{ emoji, quadrant }` (`localReaction`, engine/rules/emoji.ts):
   * its play adds that reaction to the post's picker alone. SQL knows only the flag (`card_kinds.adds_reaction`) and reads the two keys. It does not
   * write and is not seeded.
   */
  readonly reaction?: true;
  /** Whether each play is drawn from a seed the server chooses (a splat different every time), stored on its Act. */
  readonly seeded?: boolean;
  /**
   * What casting it on this target costs from the wallet, on top of the base price already paid. A set or a sprung card pays none of it.
   * `effects` are the target's own and above it, as `canApply` is given them, all public: a card may price a play from what is already there.
   */
  playPrice(settings: Settings, target: CardTarget, config: Config, effects: readonly CardEffect[]): Hundredths;
  /**
   * Whether it lands on this target, given the effects already there. A Cast or a Use is also given its configuration as
   * `validateConfig` returned it, where that accepted it, so a card that works on the post's words can refuse a phrase that is
   * not there; the screens' offer of a card on a post (before any configuration) and a Set give none. `now` is the time the play is
   * decided at, which a card hands to `landsOn` so an effect is read as live or ended on the decider's clock; the real time when not given.
   */
  canApply(target: CardTarget, effectsOnTarget: readonly CardEffect[], config?: Config, now?: Date): Verdict;
  /** Checks a caster's configuration and returns it in the card's own shape. */
  validateConfig(config: unknown): Verdict<Config>;
  /**
   * The configurations code falls back on for a staff persona's play, where `validateConfig({})` refuses (Whoops! needs an ink): used when the
   * persona's own options (`staffOptions`) fail the card's validator or the persona gave none. Plain code picks one, seeded from the day
   * (`staffConfigOf`). A card with neither a default, this list nor `staffOptions` is not offered to the pool.
   */
  readonly staffConfigs?: readonly Config[];
  /**
   * What a staff persona may set when it plays the card. `prompt` tells the persona about the options, in the instance's words; `schema` is the
   * options object's JSON schema for the provider: strings and enums only, since structured output cannot hold a length or a pattern, so
   * `validateConfig` holds the bounds. Every property the schema names is one `validateConfig` keeps. A card with this is offered to the pool
   * even with no default configuration and no `staffConfigs`.
   */
  readonly staffOptions?: { readonly prompt: string; readonly schema: Record<string, unknown> };
  /**
   * A persona's options repaired against the post before they are decided (CLAUDE.md, "A validator tighter than the schema"): a card whose
   * options a model can overshoot (a list longer than its most, an entry that is not in the post) trims what it can and names each trim.
   * It never invents an option. A player's play is never repaired. If it throws, the persona's options are decided as given (no repair) and the call's record names the throw. Given the options unchecked, the post as the card's rules see it and how the card is being played: a set's options need not be in the post it is set on, since its quote may come in another post.
   */
  repairStaff?(config: unknown, target: PostTarget, play: 'cast' | 'set'): { readonly config: unknown; readonly trims: readonly { readonly path: string; readonly predicate: string; readonly before: number; readonly after: number }[] };
  /**
   * A play whose layer any character may add to (a draw) and its own character may take ink off (a wash). `limitKey` is the `screenReads` key
   * holding the most the layer may cover, in whole percent of the grid's cells; `mostLive` the most live draws one play holds. The card's
   * validators keep a draw or a wash in its own shape and return the strokes the engine counts. A surface card is a cast card with a stack of 1.
   */
  readonly surface?: {
    readonly limitKey: string;
    readonly mostLive: number;
    validateDraw(input: unknown): Verdict<{ readonly strokes: readonly SurfaceStroke[]; readonly payload: Record<string, unknown> }>;
    validateWash(input: unknown): Verdict<{ readonly strokes: readonly SurfaceStroke[]; readonly payload: Record<string, unknown> }>;
  };
  /** For a card whose effect holds state (Whoops!'s strokes): checks a state to be saved. */
  validateState?(state: unknown): Verdict<unknown>;
  /**
   * Before the time this returns, the author of the post a play is on has their saves of its state refused; `landed` is when the play
   * landed, and undefined is no hold. It names no card: the act function asks any card that has it.
   */
  stateHeldUntil?(settings: Settings, landed: Date): Date | undefined;
  /** The refusal's plain words for a hold, given the time as `refusalTime` writes it; a neutral sentence when absent. */
  stateHeldWords?(until: string): string;
}

/**
 * The most tokens a play of a card that writes may buy: the bound require_write_tokens enforces (supabase/migrations/0149_card_writes.sql), since a
 * stored text is at most 4000 characters. A card that writes reads its most from the economy with this as its `max`, so a setting above it is
 * refused by the settings' validation and never by the database in a play.
 */
export const WRITE_TOKENS_MOST = 2000;

/**
 * How long a thread's title is clipped to, in characters, when a frame for the old voice is over its budget and has dropped every earlier post it can
 * (design section 3, docs/plans/2026-11-12-old-voice-window-design.md); past it the title is emptied. Every such frame clips to this one length, so none can drift.
 */
export const FIT_TITLE_CHARS = 40;

/**
 * The most tokens a play of a card that writes may buy in this instance: the smaller of `WRITE_TOKENS_MOST` and the old voice's window less the least
 * prompt a play leaves room for (design section 4, docs/plans/2026-11-12-old-voice-window-design.md), and never below 1. It is computed wherever the most is
 * read, so no pair of settings can be wrong: a window at or below the floor makes plays one token long, and no row can stop the instance, which a refusal
 * of the pair would (the owner's answer on #582). A card's recorded tokens are capped by it too (you-were-saying.ts).
 */
export function writeTokensMost(settings: Settings): number {
  return Math.max(1, Math.min(WRITE_TOKENS_MOST, settings.oldVoiceWindow - settings.oldVoicePromptFloor));
}

/** The largest whole number Postgres's integer holds, which a price is read as there (0006_cards.sql). */
export const INT4_MAX = 2_147_483_647;

/** One of the instance's economy numbers, which an instance must hold (instanceProblems). */
export function economyOf(settings: Settings, key: string): number {
  const n = settings.economy[key];
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`economy "${key}" is not set`);
  return n;
}

/** Whether a card is in print: only its `retired` flag takes it out. Out of print, nothing gives out a new copy, and every copy already out stays playable. */
export const inPrint = (rules: Pick<CardRules, 'retired'>): boolean => rules.retired !== true;

export const ok = <T>(value: T): Verdict<T> => ({ ok: true, value });
export const refuse = (why: string): Verdict<never> => ({ ok: false, why });

/**
 * Whether a card is withheld from this instance: it writes, and the instance says it runs no completion endpoint (`Settings.oldVoice` is
 * false). Only an explicit false withholds: an instance's settings always hold the key (settings validation requires a boolean), and the
 * screens' landing check holds no settings at all, where a missing key must not refuse every writing card.
 */
export const withheld = (rules: Pick<CardRules, 'writes'>, settings: Partial<Pick<Settings, 'oldVoice'>>): boolean => rules.writes !== undefined && settings.oldVoice === false;

/**
 * What a decided play is: its price, its checked configuration and message, and, for a card that writes, the tokens the play bought (`writes.tokens`
 * of the checked configuration, against the settings of this moment). The tokens are the play's own fact: the server writes them with the play
 * (supabase/migrations/0149_card_writes.sql), and a regeneration and the log read them there, never the settings of a later day.
 */
export interface Decided { readonly price: Hundredths; readonly config: unknown; readonly message: string; readonly tokens?: number; readonly draw?: DecidedDraw }

const namedQuadrant = (v: unknown): boolean => QUADRANTS.includes((v as { quadrant?: never } | null)?.quadrant as never);

/** Throws where a card's checked configuration lacks what its kind names: a skim card's quadrant, a scored-as card's class. */
function namedProblem(rules: CardRules, value: unknown): void {
  if (rules.skim !== undefined && !namedQuadrant(value)) throw new Error(`card ${rules.key} has a skim and its checked configuration names no quadrant`);
  const named = (value as { class?: unknown } | null)?.class;
  if (rules.scoresAs !== undefined && (typeof named !== 'string' || named === '')) throw new Error(`card ${rules.key} scores as a class and its checked configuration names none`);
}

/** What every play of a card decides: whether it lands, its configuration, the caster's message, its price. */
function decided(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown, now: Date, surcharge = false, context: PlayContext = {}): Verdict<Decided> {
  if (withheld(rules, settings)) return refuse(OLD_VOICE_OFF);
  // The old voice's refusal is said first, then the landing's, then the configuration's; the configuration is checked first only so the landing can read it.
  const checked = rules.validateConfig(config);
  // What a play names is the card's to check: a validator that lets a skim card's quadrant or a scored-as card's class through unset is a fault in the card, never the caster's.
  if (checked.ok) namedProblem(rules, checked.value);
  const lands = rules.canApply(target, effects, checked.ok ? checked.value : undefined, now);
  if (!lands.ok) return lands;
  const room = roomOnPost(rules, settings, target, effects, now);
  if (!room.ok) return room;
  if (!checked.ok) return checked;
  // A card that cuts names the Gimmick it ends (`play`); with a `rulesOf` the engine reads that it is up on this target and not rarer than the card's `upTo`.
  if (rules.cuts !== undefined && context.rulesOf !== undefined) {
    const named = (checked.value as { play?: unknown } | null)?.play;
    const found = cuttable({ cuts: { upTo: RARITIES[RARITIES.length - 1]! } }, effects, target, now, context.rulesOf).find((e) => e.act === named);
    if (found === undefined) return refuse(`that Gimmick isn't up on this ${target.reach}`);
    const card = found.card as string;
    const rarity = context.rulesOf(card)!.rarity;
    if (!atOrBelow(rarity, rules.cuts.upTo)) return refuse(`${rules.name} ends a Gimmick up to ${rules.cuts.upTo}, and ${context.nameOf?.(card) ?? card} is ${rarity}`);
  }
  const said = casterMessage(message);
  if (!said.ok) return said;
  if (rules.needsMessage !== undefined && said.value === '') return refuse(rules.needsMessage);
  // A cast pays every live price effect on its target, or above it, whose flavors hold its printed alignment; a use or a set pays none.
  const added = surcharge ? effects.reduce((sum, e) => (e.gimmick?.kind === 'price' && isLive(e, now) && e.gimmick.flavors.includes(rules.alignment) ? sum + e.gimmick.add : sum), 0) : 0;
  const price = Math.max(0, rules.playPrice(settings, target, checked.value, effects) + added);
  if (!Number.isSafeInteger(price) || price < 0) throw new Error(`card ${rules.key} priced a play at ${price}`);
  if (!rules.writes) return ok({ price, config: checked.value, message: said.value });
  const tokens = rules.writes.tokens(checked.value, settings);
  if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error(`card ${rules.key} bought ${tokens} tokens`);
  return ok({ price, config: checked.value, message: said.value, tokens });
}

/** A draw as decided: the card's payload, the cells its strokes cover as Postgres `bit(10000)` text, and the most cells the layer may cover. */
export interface DecidedDraw { readonly payload: Record<string, unknown>; readonly cells: string; readonly most: number }

const noSurface = (rules: Pick<CardRules, 'name'>) => refuse(`${rules.name} has no surface to draw on`);

/** The most cells a surface card's layer may cover: its limit, whole percent of the grid, from the card settings. A limit the settings do not hold is a fault of the instance, which instanceProblems refuses first. */
export function surfaceMost(key: string, limitKey: string, settings: Settings): number {
  const limit = settings.cardSettings[limitKey];
  if (typeof limit !== 'number' || !Number.isFinite(limit)) throw new Error(`card ${key} reads the limit "${limitKey}", which the settings do not hold`);
  return Math.round((limit / 100) * GRID * GRID);
}

/** A draw on a surface card, kept as the card keeps it, with the cells the engine counts and the limit read from the settings (`surface.limitKey`). */
export function decideDraw(rules: CardRules, settings: Settings, input: unknown): Verdict<DecidedDraw> {
  if (rules.surface === undefined) return noSurface(rules);
  const checked = rules.surface.validateDraw(input);
  if (!checked.ok) return checked;
  return ok({ payload: checked.value.payload, cells: toBits(cellsOf(checked.value.strokes)), most: surfaceMost(rules.key, rules.surface.limitKey, settings) });
}

/** A wash on a surface card: the card's payload and the cells its strokes cover, which the server takes off the layer. */
/** `settings` is unused: a wash has no limit to read. It is kept so a draw and a wash are decided the same way. */
export function decideWash(rules: CardRules, _settings: Settings, input: unknown): Verdict<{ readonly payload: Record<string, unknown>; readonly cells: string }> {
  if (rules.surface === undefined) return noSurface(rules);
  const checked = rules.surface.validateWash(input);
  if (!checked.ok) return checked;
  return ok({ payload: checked.value.payload, cells: toBits(cellsOf(checked.value.strokes)) });
}

/** A surface card's first draw, decided with its play: refused when it names none, so a play always starts with a tag on the surface. */
function firstDraw(rules: CardRules, settings: Settings, first: unknown): Verdict<DecidedDraw | undefined> {
  if (rules.surface === undefined) return ok(undefined);
  if (first === undefined) return refuse('draw your tag first');
  return decideDraw(rules, settings, first);
}

/** What a decision reads beyond the play: the time, and each card's name by key, for a ward's refusal. */
export interface PlayContext {
  readonly now?: Date;
  readonly nameOf?: (key: string) => string;
  /** A surface card's first draw, as the caster made it (`CardRules.surface`); a surface card is refused without one. */
  readonly first?: unknown;
  /** The character the play is made through, by id; a discipline card compares it with a post's author (`disciplineRefusal`). */
  readonly caster?: string;
  /** The caster's live pierce, where one is up: a ward whose card is at or below it does not turn the cast away. */
  readonly pierce?: Rarity;
  /** A card's rarity by key, so a pierce can be weighed against the ward's own card. */
  readonly rarityOf?: (key: string) => Rarity | undefined;
  /** A card's play and rarity by key, so a card that cuts can tell a live Gimmick (a Use card's effect) it may end from the other effects on its target. */
  readonly rulesOf?: (key: string) => Pick<CardRules, 'play' | 'rarity'> | undefined;
}

/**
 * The live Gimmicks on `target` that a card that cuts may end: its effects, on the target's own reach, that are up, whose card is a Use card (`rulesOf`) no rarer than `rules.cuts.upTo`.
 * Empty for a card that does not cut.
 */
export function cuttable(rules: Pick<CardRules, 'cuts'>, effects: readonly CardEffect[], target: Pick<CardTarget, 'reach'>, now: Date | undefined, rulesOf: NonNullable<PlayContext['rulesOf']>): readonly CardEffect[] {
  const cuts = rules.cuts;
  if (cuts === undefined) return [];
  /* As decidePlay's own `now`: a caller that holds the page's clock passes it. */
  const at = now ?? new Date();
  return effects.filter((e) => {
    if ((e.reach ?? 'post') !== target.reach || !isLive(e, at) || e.card === null) return false;
    const card = rulesOf(e.card);
    return card !== undefined && playOf(card) === 'use' && atOrBelow(card.rarity, cuts.upTo);
  });
}

/**
 * A card cast on a target, decided by its own rules: whether it lands there given the effects
 * already on it, whether the caster's configuration is one it accepts, and what it costs from the
 * wallet, with any live price effect on the target or above it added. A live ward on the target that turns the card away refuses it first, before the
 * card's own rules. The SQL function that writes the play holds what it can again.
 *
 * The price is read from the post as it stands when the play is decided. A post edited longer
 * or shorter in the moment before the play lands costs the caster what it would have a moment
 * earlier: the caster pays what they were shown, and nobody else is touched.
 */
export function decidePlay(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown, context: PlayContext = {}): Verdict<Decided> {
  if (playOf(rules) !== 'cast') return wrongPlay(rules);
  const now = context.now ?? new Date();
  // A reply drawn under a post is a post of its own, and takes none under it: one reply under a post, never a chain.
  if (rules.replies === true && target.reach === 'post' && target.under !== undefined) return refuse('a reply drawn under a post takes no reply under it');
  const pierced = (e: CardEffect): boolean => {
    if (e.card === null || context.pierce === undefined) return false;
    const rarity = context.rarityOf?.(e.card);
    return rarity !== undefined && atOrBelow(rarity, context.pierce);
  };
  const ward = effects.find((e) => e.gimmick?.kind === 'ward' && (e.reach ?? 'post') === target.reach && isLive(e, now) && wardTurnsAway(e.gimmick, rules) && !pierced(e));
  if (ward) return refuse(wardWords(ward.card === null ? 'ward' : (context.nameOf?.(ward.card) ?? ward.card), ward.gimmick as WardEffect, rules, target.reach));
  // A rewind's freeze is a ward by rarity, passed by a pierce as a ward is, and said before anything the card's own rules say.
  const frozenBy = frozenRefusal(rules, target, effects.filter((e) => !pierced(e)), now, (k) => context.nameOf?.(k));
  if (frozenBy) return frozenBy;
  // A card that cuts is refused where its target holds no Gimmick it may end, so the ghost marks offer it only where it could land; the named play is checked in `decided`.
  // The old voice's refusal is said before it, as `decided` says it first.
  if (rules.cuts !== undefined && context.rulesOf !== undefined && !withheld(rules, settings) && cuttable(rules, effects, target, now, context.rulesOf).length === 0) return refuse(`there's no Gimmick up on this ${target.reach} for ${rules.name} to end`);
  const staffed = disciplineRefusal(rules, target, context, now);
  if (staffed) return staffed;
  const play = decided(rules, settings, target, effects, config, message, now, true, context);
  if (!play.ok || rules.surface === undefined) return play;
  const first = firstDraw(rules, settings, context.first);
  if (!first.ok) return first;
  return ok({ ...play.value, draw: first.value });
}

/**
 * What a discipline card refuses before anything is written, from facts that are public (a warn bar and a ban are on every postbit; a post's author is its character):
 * the same words for every caster, and never a question of who owns the caster or the target. A fact left undefined refuses nothing, and the server decides again.
 */
function disciplineRefusal(rules: CardRules, target: CardTarget, context: PlayContext, now: Date): Verdict<never> | null {
  const d = rules.discipline;
  if (d === undefined) return null;
  if (d.kind === 'relief' && target.reach === 'character' && target.warnPoints === 0) return refuse("this character's warn bar is empty");
  if (d.kind === 'unban' && target.reach === 'character' && target.bannedUntil !== undefined && (target.bannedUntil === null || !(Date.parse(target.bannedUntil) > now.getTime()))) return refuse('this character is not banned');
  if (d.kind === 'fall' && target.reach === 'post' && target.author !== undefined && context.caster !== undefined && target.author === context.caster) return refuse(`${rules.name} is played on another character's post`);
  return null;
}

/**
 * A Use card played on a target. That the target is the player's own post is SQL's to hold, since
 * only SQL reads who wrote it; a ward does not refuse a Use, and a price effect adds nothing to one.
 */
export function decideUse(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown, context: Pick<PlayContext, 'now' | 'nameOf'> = {}): Verdict<Decided> {
  if (playOf(rules) !== 'use') return wrongPlay(rules);
  const now = context.now ?? new Date();
  const frozenBy = frozenRefusal(rules, target, effects, now, (k) => context.nameOf?.(k));
  if (frozenBy) return frozenBy;
  // A back springs on a quote and a no-quote stops one, so the two never share a post; each says how it is undone.
  if (rules.gimmick?.kind === 'noQuote' && effects.some((e) => e.faceDown && isLive(e, now))) return refuse(`${rules.name} stops quotes, and this post holds a card face down; take that card back first`);
  return decided(rules, settings, target, effects, config, message, now);
}

/**
 * A card set face down on a post, a cast card or a set card; a use card is refused. Refused on a post that already holds a live
 * face-down card. The configuration is the card's own (`validateConfig`). A set card that springs on a cast names the card it catches
 * (`catches`), which must be one of `cards` that is cast on a post and no rarer than the set card, or has a `match` no rarer than it. A set card with no trap is refused. A cast card's
 * `setPhrase` is returned too, for the landing to find in the quoting post's words, and an empty one is refused, since it is in no
 * post and the back could never land. A set costs nothing beyond the card, and a sprung card lands free. A ward never blocks a set and a price adds nothing to one, and a set carries no message, since its Act says nothing about its card.
 */
/** The longest phrase a Move may be set to wait for, in characters; the server holds the same bound (supabase/migrations/0142_face_down_moves.sql, place_set), so every back's pattern there is one length. */
export const SET_PHRASE_MOST = 100;

/** The most characters a Who may name (quote-conditions design, section 4); the server holds the same bound. */
export const SET_WHO_MOST = 5;

/**
 * The conditions a Move may be set with, each optional (quote-conditions design, section 1): `says` is a phrase in the quoting post's own
 * words, `passage` one in the quoted excerpt, and `who` the characters (ids) the quote must, or must not, come from.
 */
export interface SetConditions {
  readonly says?: string;
  readonly passage?: string;
  readonly who?: { readonly except: boolean; readonly characters: readonly string[] };
}

const hasWord = (s: string): boolean => /[\p{L}\p{N}]/u.test(s);

/**
 * Whether a card can only be cast now and face up, never set face down (the owner's answer to issue #446): it writes, replies, acts on the staff's discipline, needs a message, draws or runs a
 * drive. Each of those is done at the cast, on the post the caster chose (the tail is bought, the message is said, the draw is made, the drive opens), and a
 * back that sprang later on a quote would land with none of it. A surface card is one too (docs/plans/2026-11-12-graffiti-face-up-design.md, section 1):
 * its first tag is drawn on the post the caster chose, and a back would carry it blind to a quoting post's box nobody drew for. decideSet refuses such a card, the play form leaves out its Set face down switch, and the
 * server holds the same on face_down (supabase/migrations/0153_drives.sql, face_down_never_writes).
 */
export const faceUpOnly = (rules: Pick<CardRules, 'writes' | 'needsMessage' | 'draws' | 'drive' | 'surface' | 'replies' | 'discipline' | 'cuts' | 'rewind' | 'wraps'>): boolean =>
  rules.wraps === true || rules.rewind !== undefined || rules.discipline !== undefined || rules.cuts !== undefined || rules.writes !== undefined || rules.needsMessage !== undefined || rules.draws !== undefined || rules.drive !== undefined || rules.surface !== undefined || rules.replies !== undefined;

export function decideSet(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, cards: readonly CardRules[], conditions: SetConditions = {}, now: Date = new Date()): Verdict<{ price: Hundredths; config: unknown; catches?: string; phrase?: string; passage?: string; who?: { except: boolean; characters: readonly string[] } }> {
  const play = playOf(rules);
  if (play !== 'cast' && play !== 'set') return wrongPlay(rules);
  if (withheld(rules, settings)) return refuse(OLD_VOICE_OFF);
  // A card that writes is cast face up and never set face down: its tail is bought at the cast, on the post the caster chose.
  if (rules.writes !== undefined) return refuse(`${rules.name} writes, so it is played face up and never set face down`);
  // So is a card that replies: its reply is written with the play, under the post the caster chose.
  if (rules.replies !== undefined) return refuse(`${rules.name} carries a reply, so it is played face up and never set face down`);
  // So is a card that acts on the staff's discipline: it is refused or takes hold the moment it lands, on the target its caster chose.
  if (rules.discipline !== undefined) return refuse(`${rules.name} acts the moment it lands, so it is played face up and never set face down`);
  // So is one that needs a message, draws, runs a drive or is drawn on (a surface card): faceUpOnly says which, and one sentence covers them.
  if (faceUpOnly(rules)) return refuse(`${rules.name} is played face up and never set face down`);
  if (target.reach !== 'post' || !isPost(target.kind)) return refuse('a card is set face down on a post');
  const frozenBy = frozenRefusal(rules, target, effects, now, (k) => cards.find((c) => c.key === k)?.name);
  if (frozenBy) return frozenBy;
  if (effects.some((e) => e.faceDown && isLive(e, now))) return refuse('this post already holds a card face down');
  const stop = quoteStop(effects, now);
  if (stop) return refuse(`this post's ${cards.find((c) => c.key === stop.card)?.name ?? stop.card} stops quotes until ${stop.ends ? refusalTime(stop.ends) : 'it ends'}, so no card is set face down here until then`);
  // A Move that lands beyond a post (Glitter Bomb on a character) is set on a post all the same and lands on what the quote reaches (design section 3); whether it can land there is the spring's to decide.
  if (play === 'set' && rules.trap === undefined) return refuse(`${rules.name} has no trap to spring`);
  const lands = reachesOf(rules).includes('post') ? rules.canApply(target, effects, undefined, now) : ok(undefined);
  if (!lands.ok) return lands;
  const room = roomOnPost(rules, settings, target, effects, now, true);
  if (!room.ok) return room;
  const checked = rules.validateConfig(config);
  if (!checked.ok) return checked;
  // A ride trap pays on the quadrant the set names unless it says every, so a card whose validator lets it through unset is at fault.
  if (rules.trap?.outcome?.kind === 'ride' && rules.trap.outcome.every !== true && !namedQuadrant(checked.value)) throw new Error(`card ${rules.key} has a ride and its checked configuration names no quadrant`);
  let catches: string | undefined;
  if (rules.catches) {
    catches = rules.catches(checked.value);
    const named = cards.find((c) => c.key === catches);
    if (!named || !castOnPost(named)) return refuse(`${rules.name} names a card that is cast on a post`);
    if (!atOrBelow(named.rarity, rules.rarity)) return refuse(`${rules.name} names cards up to ${rules.rarity}`);
  }
  const upTo = rules.trap?.match?.upTo;
  if (upTo !== undefined && !atOrBelow(upTo, rules.rarity)) return refuse(`${rules.name} names cards up to ${rules.rarity}`);
  let phrase = rules.setPhrase?.(checked.value);
  if (phrase !== undefined && phrase.trim() === '') return refuse(`${rules.name} needs a phrase to wait for`);
  if (phrase !== undefined && [...phrase].length > SET_PHRASE_MOST) return refuse(`${rules.name} waits for a phrase of at most ${SET_PHRASE_MOST} characters`);
  const { says, passage, who } = conditions;
  if (says !== undefined || passage !== undefined || who !== undefined) {
    // A set card takes none: it names or matches its cards, or waits for a visit.
    if (play === 'set') return refuse(`${rules.name} takes no conditions`);
    // A card with its own phrase has its Says fixed to it: one back holds one phrase.
    if (says !== undefined && phrase !== undefined) return refuse(`${rules.name} already waits for its own phrase`);
    if (says !== undefined) {
      if (!hasWord(says)) return refuse('what they say needs a letter or a digit');
      if ([...says].length > SET_PHRASE_MOST) return refuse(`what they say is at most ${SET_PHRASE_MOST} characters`);
      phrase = says;
    }
    if (passage !== undefined) {
      if (!hasWord(passage)) return refuse('the passage needs a letter or a digit');
      if ([...passage].length > SET_PHRASE_MOST) return refuse(`the passage is at most ${SET_PHRASE_MOST} characters`);
      if (!phraseIn(target.text, passage)) return refuse("that passage is not in this post's words");
    }
    // Only the list's shape is held here. Whether a named character is on the board is SQL's, and nothing here reads who owns one.
    if (who !== undefined) {
      if (who.characters.length === 0) return refuse('name at least one character, or choose anyone');
      if (who.characters.length > SET_WHO_MOST) return refuse(`name at most ${SET_WHO_MOST} characters`);
      if (new Set(who.characters.map((c) => c.toLowerCase())).size !== who.characters.length) return refuse('name each character once');
    }
  }
  return ok({ price: 0, config: checked.value, ...(catches === undefined ? {} : { catches }), ...(phrase === undefined ? {} : { phrase }), ...(passage === undefined ? {} : { passage }), ...(who === undefined ? {} : { who: { except: who.except, characters: [...who.characters] } }) });
}

/** The longest a caster's message may be, in characters; play_card (supabase/migrations/0016_cards_screens.sql) holds it again. */
export const MESSAGE_MOST = 200;

/**
 * The caster's message, shown on the card's Act: plain text, which the screens show as text and
 * never as markup, trimmed, at most MESSAGE_MOST characters, and empty when there is none ("a
 * riposte with no words falls flat", and that is the caster's to choose).
 */
export function casterMessage(message: unknown): Verdict<string> {
  if (message === undefined || message === null) return ok('');
  if (typeof message !== 'string') return refuse('the message is text');
  const said = message.trim();
  if ([...said].length > MESSAGE_MOST) return refuse(`the message is at most ${MESSAGE_MOST} characters`);
  return ok(said);
}

/** A span in milliseconds, a month as 30 days, as Postgres compares intervals. */
export const spanMs = (s: Span): number => s.count * (s.unit === 'minute' ? 60_000 : s.unit === 'hour' ? 3_600_000 : s.unit === 'day' ? 86_400_000 : s.unit === 'week' ? 7 * 86_400_000 : 30 * 86_400_000);

/**
 * The open drive of card `key` among `effects`: the drive whose `closes` is after `now`, with its plays, or none. A drive's plays are
 * the effects the caller passes, the post's plays still up as card_target gives them (supabase/migrations/0153_drives.sql, drive_plays;
 * whether an ended play leaves its drive is the owner's question #447), and this is the one place here that says which plays make a drive.
 * A post holds at most one open drive of a card, since place_cast (0153) joins a play to the open drive, so the first open play names it.
 */
export function openDrive(effects: readonly CardEffect[], key: string, now: Date): { readonly id: string; readonly closes: string; readonly plays: readonly CardEffect[] } | undefined {
  const plays = effects.filter((e) => e.card === key && e.drive !== undefined && e.closes !== undefined && Date.parse(e.closes) > now.getTime());
  if (!plays.length) return undefined;
  const first = plays[0]!;
  return { id: first.drive!, closes: first.closes!, plays: plays.filter((e) => e.drive === first.drive) };
}

/**
 * What a gift of `amount` hundredths is split into: the overhead The System keeps, rounded up so a gift never leaves it short, and what
 * arrives. Integer arithmetic throughout, so no float decides a cent. The screens' preview and the SQL's split are pinned to this.
 */
export function giftSplit(amount: Hundredths, overheadPercent: number): { readonly overhead: Hundredths; readonly arrives: Hundredths } {
  const overhead = Math.ceil((amount * overheadPercent) / 100);
  return { overhead, arrives: amount - overhead };
}

/** The reaches a card lists, a post unless it says. */
export const reachesOf = (rules: Pick<CardRules, 'reaches'>): readonly Reach[] => rules.reaches ?? ['post'];

/**
 * Whether a play beyond a post falls on a post: it is up now, or its card keeps and the post was written while it was up. Dates only: nothing is read from
 * the post but when it was written, and a date that is no time reads as not kept (an end that is no time is neither up nor kept).
 */
export function fallsOn(play: { readonly at: string; readonly ends?: string }, post: { readonly at: string }, keeps: boolean, now: Date = new Date()): boolean {
  if (play.ends === undefined) return true;
  const to = Date.parse(play.ends);
  if (to > now.getTime()) return true;
  if (!keeps) return false;
  const from = Date.parse(play.at);
  const written = Date.parse(post.at);
  return from <= written && written < to;
}

/**
 * What stops a card being wrapped in a wrapper, in plain words, or null (design 1.4): the gift is a Move cast on a post, is not itself a wrapper, and its own
 * `validateConfig` takes the configuration it is wrapped with. Its landing on the post is not asked here: that is tried when the box is opened.
 */
export function giftProblem(wrapper: Pick<CardRules, 'name' | 'wraps'>, gift: CardRules, config: unknown): string | null {
  if (wrapper.wraps !== true) return `${wrapper.name} holds no card`;
  if (gift.wraps === true) return "a present can't hold another present";
  if (!castOnPost(gift)) return 'a present holds a Move that is cast on a post';
  // An open is made with no message, no reply and no first draw to give, so a card that needs one could never land from it.
  if (gift.needsMessage !== undefined || gift.replies === true || gift.surface !== undefined) return "a present can't hold a card that needs words of its own";
  const checked = gift.validateConfig(config);
  return checked.ok ? null : checked.why;
}

/** Whether a card is cast on a post: the cards a cast trap may name, since a caught card is one a caster played there. */
export const castOnPost = (rules: Pick<CardRules, 'play' | 'reaches'>): boolean => playOf(rules) === 'cast' && reachesOf(rules).includes('post');

/** The live effects on each target above a post: its board's, its thread's and its author's (effects_above, 0055_card_reach.sql). */
export interface EffectsAbove {
  readonly board?: readonly CardEffect[];
  readonly thread?: readonly CardEffect[];
  readonly character?: readonly CardEffect[];
}
const ABOVE: Record<Reach, readonly BeyondPost[]> = { post: ['board', 'thread', 'character'], character: ['board', 'thread'], thread: ['board'], board: [] };

/**
 * What a card's `canApply` sees on a target: every live effect above it, board then thread then character, each marked with its
 * reach, then the target's own (its own ended ones too, which the rules read as ended). The screens wrap effects in the same order,
 * so cards combine across reaches. Above a character are the board and the thread it is played in.
 */
export function effectsOnTarget(target: CardTarget, own: readonly CardEffect[], above: EffectsAbove, now: Date = new Date()): CardEffect[] {
  const over = ABOVE[target.reach].flatMap((reach) => (above[reach] ?? []).filter((e) => isLive(e, now)).map((e) => ({ ...e, reach })));
  return [...over, ...own.map((e) => (target.reach === 'post' || e.reach ? e : { ...e, reach: target.reach }))];
}

/** A time as a refusal says it, to the minute in UTC, as play_card says it (0055_card_reach.sql). */
export const refusalTime = (iso: string): string => {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? 'it ends' : `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};
const ARTICLE: Record<Reach, string> = { post: 'a post', character: 'a character', thread: 'a thread', board: 'a board' };
/** A card's reaches as a refusal lists them: "a post", "a character or a thread". */
export const listed = (reaches: readonly Reach[]): string => {
  const said = reaches.map((r) => ARTICLE[r] ?? String(r));
  return said.length < 2 ? said.join('') : `${said.slice(0, -1).join(', ')} or ${said.at(-1)}`;
};

/**
 * What every card holds to unless it says otherwise: it lands on a reach it lists (a post unless it says; a post is any Act
 * for which `isPost` holds, so a spun thread's opening Act counts and an edit or a card Act does not), and its target
 * carries at most its stack of it (one unless the card says more) that are still up, each its own play, counting only the
 * effects on that same target, never those above it. A board carries one board card at a time, of any card, until it ends.
 */
export function landsOn(rules: Pick<CardRules, 'key' | 'stack' | 'reaches' | 'discipline' | 'cuts' | 'drawsEffect'> & { readonly surface?: unknown }, target: CardTarget, effects: readonly CardEffect[], now: Date = new Date()): Verdict {
  const reaches = reachesOf(rules);
  if (!reaches.includes(target.reach)) return refuse(`this card lands on ${listed(reaches)}`);
  if (target.reach === 'post' && !isPost(target.kind)) return refuse('a card lands on a post');
  // A play that is over when it lands leaves no effect to count: only the reach is checked.
  if (instant(rules)) return ok(undefined);
  // An ended effect holds no place (play_card counts the same way).
  const here = effects.filter((e) => (e.reach ?? 'post') === target.reach && isLive(e, now));
  if (target.reach === 'board') {
    const held = here[0];
    if (held) return refuse(`this board already carries a board card until ${held.ends ? refusalTime(held.ends) : 'it ends'}`);
  }
  const stack = rules.stack ?? 1;
  // A final card's cleared play holds no place in its stack (`drawsEffect.final`); any other cleared play still does.
  const final = rules.drawsEffect?.final === true;
  if (here.filter((e) => e.card === rules.key && !(final && e.cleared === true)).length >= stack) {
    // A surface card's play is the post's wall: a second says so, in the database's words (place_cast).
    if (rules.surface !== undefined && target.reach === 'post') return refuse('This post is already a wall. Draw on it instead.');
    const where = target.reach === 'post' ? 'this post' : `this ${target.reach}`;
    return refuse(stack === 1 ? `${where} already carries that card` : `${where} already carries ${stack} of that card, the most it takes`);
  }
  return ok(undefined);
}

/**
 * Whether a skim card may be played on this post for a quadrant: refused where a live effect of the same card on the post itself (not one above
 * it) names the same quadrant. A skim card's `canApply` calls this after `landsOn`, when it is given a configuration; the server holds the same.
 */
export function quadrantFree(rules: Pick<CardRules, 'key'>, target: CardTarget, effects: readonly CardEffect[], quadrant: Quadrant, now: Date = new Date()): Verdict {
  if (effects.some((e) => e.card === rules.key && (e.reach ?? 'post') === target.reach && isLive(e, now) && e.quadrant === quadrant)) return refuse('this post already carries that card for that quadrant');
  return ok(undefined);
}

/**
 * The fallback configuration the pool plays a card with when a persona's own options (`staffOptions`) fail or are not given,
 * chosen by code: the card's default where `validateConfig({})` accepts one (played as `{}`, so the database applies the same
 * default), else one of its `staffConfigs` picked by `rng` (in [0, 1)) and returned
 * as `validateConfig` shapes it; null where code can build none, and the card is then not offered.
 */
export function staffConfigOf(card: CardRules, rng: () => number): unknown | null {
  if (card.validateConfig({}).ok) return {};
  const choices = (card.staffConfigs ?? []).filter((c) => card.validateConfig(c).ok);
  if (choices.length === 0) return null;
  const chosen = card.validateConfig(choices[Math.floor(rng() * choices.length)]);
  return chosen.ok ? chosen.value : null;
}

/**
 * A Mod Bot's first draw on a surface card where its own pick fails or it gave none: one of the card's `staffConfigs` that the card's `surface.validateDraw`
 * accepts, picked by `rng` (in [0, 1)); null for a card with no surface or with no such entry. `staffConfigOf` cannot give it: a surface card's `validateConfig({})`
 * accepts, so the play's configuration is `{}` and its `staffConfigs` are never read there. They are draws, and are read here.
 */
export function staffDrawOf(card: CardRules, rng: () => number): unknown | null {
  if (card.surface === undefined) return null;
  const draws = (card.staffConfigs ?? []).filter((c) => card.surface!.validateDraw(c).ok);
  return draws.length === 0 ? null : draws[Math.floor(rng() * draws.length)];
}

/** A color as a post's [color] tag reads one (engine/bbcode/parse.ts), surrounding spaces aside. */
export function color(value: unknown): string | null {
  return typeof value === 'string' ? safeColor(value.trim()) : null;
}

/**
 * Whether the pool may offer a card to a staff persona: code can build a configuration for it, or the persona chooses its options. A set card that
 * springs on a visit is never offered: a Mod Bot visits only players' posts, so a persona's Hall Pass could never spring. Nor is a card that needs a
 * caster message, since a persona's play carries none.
 */
export function staffOffers(card: CardRules): boolean {
  if (card.trap?.trigger.on === 'visit') return false;
  // A staff character has no wallet and its Acts are not settled, so a ride a persona set would pay nobody.
  if (card.trap?.outcome?.kind === 'ride') return false;
  // A staff character's Acts are not settled, so an earn a persona cast would never be paid.
  if (card.gimmick !== undefined && (card.play ?? 'cast') === 'cast') return false;
  // A wrapper needs a second card from the caster's hand, which a persona has none to give.
  if (card.wraps === true) return false;
  // A rewind names a point of the post's history, which a persona's play has no way to pick.
  if (card.rewind !== undefined) return false;
  // A card that cuts names a Gimmick by its play, which a persona does not choose (the Buzzkill design, section 2.5).
  if (card.cuts !== undefined) return false;
  // A persona plays a card with no caster message, so a card that needs one could never land.
  if (card.needsMessage !== undefined) return false;
  // A card that replies carries a post a persona's play does not write.
  if (card.replies === true) return false;
  // A persona does not play on its own office's rulings, and `infract` refuses a staff character.
  if (card.discipline !== undefined) return false;
  // A surface card is played with a first draw, which a persona names (`staffOptions`) or code picks (`staffDrawOf`); a persona never sets one.
  if (card.surface !== undefined) return playOf(card) === 'cast' && (staffDrawOf(card, () => 0) !== null || card.staffOptions !== undefined);
  return staffConfigOf(card, () => 0) !== null || card.staffOptions !== undefined;
}
