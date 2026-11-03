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
import { safeColor } from '../bbcode/parse.ts';

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
    readonly kind: ActKind;
    /** The length of the post's current text, in characters. */
    readonly length: number;
  }
  | { readonly reach: 'character'; readonly character: string }
  | { readonly reach: 'thread'; readonly thread: string }
  | { readonly reach: 'board'; readonly board: string };
export type PostTarget = Extract<CardTarget, { reach: 'post' }>;

/**
 * An effect already on a target: a card played there before. A ward carries the rarity it turns
 * away up to and when it ends; a card set face down names no card (`card: null`), only that it is
 * face down and when it ends, since which card it is is its setter's alone (card_target,
 * supabase/migrations/0054_card_plays.sql). `ends` is an ISO time; an effect with none does not end.
 */
export interface CardEffect {
  readonly card: string | null;
  readonly act: string;
  readonly ward?: Rarity;
  readonly ends?: string;
  readonly faceDown?: true;
  /** Which reach the effect is on: the target's own, or one above it (effectsOnTarget). A post's unless it says. */
  readonly reach?: Reach;
}

/** How rare a card is, commonest first. It bounds what a trap catches and what a ward turns away. */
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
 * What springs a trap: a card cast on the post, a reaction of a named quadrant, the first reply in
 * the thread by another character, a post quoting it, or a Mod Bot's visit (named now, wired by the
 * staff build, so no card names it yet).
 */
export type Trigger =
  | { readonly on: 'cast' }
  | { readonly on: 'reaction'; readonly quadrant: Quadrant }
  | { readonly on: 'reply' }
  | { readonly on: 'quote' }
  | { readonly on: 'visit' };
export const TRIGGERS: readonly Trigger['on'][] = Object.freeze(['cast', 'reaction', 'reply', 'quote', 'visit']);
/**
 * What a sprung trap does: catches the cast (nullify), catches it and pays the setter exactly what
 * the caster's wallet paid for the play (payout), or lays a card it carries on what sprang it
 * (strike).
 */
export type Outcome = { readonly do: 'nullify' } | { readonly do: 'payout' } | { readonly do: 'strike'; readonly card: string };
export const OUTCOMES: readonly Outcome['do'][] = Object.freeze(['nullify', 'payout', 'strike']);

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

/** A ward's refusal, the same for every caster, since the ward is face up; play_card says it in the same words. */
export const wardWords = (wardName: string, rarity: Rarity, reach: Reach = 'post'): string => `this ${reach}'s ${wardName} turns away cards up to ${rarity}`;

/** How each play is said in a refusal of the wrong one. */
const PLAYED: Record<Play, string> = {
  cast: 'cast',
  use: 'used on your own post',
  set: 'set face down on your own post',
  keep: 'kept in the hand',
};
const wrongPlay = (rules: CardRules): Verdict<never> => refuse(`${rules.name} is ${PLAYED[playOf(rules)]}`);

export type Verdict<T = undefined> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };

export interface CardRules<Config = unknown> {
  readonly key: string;
  readonly name: string;
  readonly alignment: Alignment;
  readonly rarity: Rarity;
  /** How it is played; a Cast unless it says. */
  readonly play?: Play;
  /** A Set card's trap: what springs it and what it does. A Set card with none is a bluff. */
  readonly trap?: { readonly trigger: Trigger; readonly outcome: Outcome };
  /** A Use card that turns away casts on its target at or below its rarity while it is up. */
  readonly ward?: true;
  /** Where it can land; a post unless it says (`['post']`). A reach beyond a post takes at least its `reachRarity`. */
  readonly reaches?: readonly Reach[];
  /**
   * How long a Use card is up once played, and how long a play beyond a post lasts, at most its reach's `reachLasts`;
   * with none, a Use stays. A play on a post that is not a Use does not end.
   */
  readonly lasts?: Span;
  /** A thread play of it pins the thread to the top of its board's list until it ends (Main Event's kind); only a card that reaches a thread pins. */
  readonly pins?: true;
  /** The economy setting that holds what the Vending Machine sells it for. */
  readonly priceKey: string;
  /** The economy numbers its rules read beside its price. */
  readonly reads?: readonly EconomyRead[];
  /** The numbers in `Settings.cardSettings` its screens read, so an instance missing one, or holding one out of its bounds, is refused. */
  readonly screenReads?: readonly EconomyRead[];
  /** How many of this card one post may carry, each its own play and layer; 1 unless said. */
  readonly stack?: number;
  /** Whether each play is drawn from a seed the server chooses (a splat different every time), stored on its Act. */
  readonly seeded?: boolean;
  /**
   * What playing it on this target costs from the wallet, on top of the base price already paid. A
   * trap that strikes is given the struck card's configuration, which is what it carries.
   */
  playPrice(settings: Settings, target: CardTarget, config: Config): Hundredths;
  canApply(target: CardTarget, effectsOnTarget: readonly CardEffect[]): Verdict;
  /** Checks a caster's configuration and returns it in the card's own shape. */
  validateConfig(config: unknown): Verdict<Config>;
  /** For a card whose effect holds state (Whoops!'s strokes): checks a state to be saved. */
  validateState?(state: unknown): Verdict<unknown>;
}

/** The largest whole number Postgres's integer holds, which a price is read as there (0006_cards.sql). */
export const INT4_MAX = 2_147_483_647;

/** What the Vending Machine sells a card for, under these settings. */
export function basePrice(rules: CardRules, settings: Settings): Hundredths {
  const price = settings.economy[rules.priceKey];
  if (!Number.isSafeInteger(price) || price! <= 0 || price! > INT4_MAX) throw new Error(`card ${rules.key}'s price, economy "${rules.priceKey}", is ${price}`);
  return price!;
}

/** One of the instance's economy numbers, which an instance must hold (instanceProblems). */
export function economyOf(settings: Settings, key: string): number {
  const n = settings.economy[key];
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`economy "${key}" is not set`);
  return n;
}

export const ok = <T>(value: T): Verdict<T> => ({ ok: true, value });
export const refuse = (why: string): Verdict<never> => ({ ok: false, why });

/** What every play of a card decides: whether it lands, its configuration, the caster's message, its price. */
function decided(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown): Verdict<{ price: Hundredths; config: unknown; message: string }> {
  const lands = rules.canApply(target, effects);
  if (!lands.ok) return lands;
  const checked = rules.validateConfig(config);
  if (!checked.ok) return checked;
  const said = casterMessage(message);
  if (!said.ok) return said;
  const price = rules.playPrice(settings, target, checked.value);
  if (!Number.isSafeInteger(price) || price < 0) throw new Error(`card ${rules.key} priced a play at ${price}`);
  return ok({ price, config: checked.value, message: said.value });
}

/** What a decision reads beyond the play: the time, and each card's name by key, for a ward's refusal. */
export interface PlayContext {
  readonly now?: Date;
  readonly nameOf?: (key: string) => string;
}

/**
 * A card cast on a target, decided by its own rules: whether it lands there given the effects
 * already on it, whether the caster's configuration is one it accepts, and what it costs from the
 * wallet. A live ward on the target that covers the card's rarity refuses it first, before the
 * card's own rules. The SQL function that writes the play holds what it can again.
 *
 * The price is read from the post as it stands when the play is decided. A post edited longer
 * or shorter in the moment before the play lands costs the caster what it would have a moment
 * earlier: the caster pays what they were shown, and nobody else is touched.
 */
export function decidePlay(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown, context: PlayContext = {}): Verdict<{ price: Hundredths; config: unknown; message: string }> {
  if (playOf(rules) !== 'cast') return wrongPlay(rules);
  const now = context.now ?? new Date();
  const ward = effects.find((e) => e.ward !== undefined && (e.reach ?? 'post') === target.reach && isLive(e, now) && atOrBelow(rules.rarity, e.ward));
  if (ward) return refuse(wardWords(ward.card === null ? 'ward' : (context.nameOf?.(ward.card) ?? ward.card), ward.ward!, target.reach));
  return decided(rules, settings, target, effects, config, message);
}

/**
 * A Use card played on a target. That the target is the player's own post is SQL's to hold, since
 * only SQL reads who wrote it; a ward does not refuse a Use.
 */
export function decideUse(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown): Verdict<{ price: Hundredths; config: unknown; message: string }> {
  if (playOf(rules) !== 'use') return wrongPlay(rules);
  return decided(rules, settings, target, effects, config, message);
}

/**
 * A Set card set face down on a post: refused on a post that already holds a live face-down card.
 * A trap that strikes carries the struck card's configuration, which that card's own rules check,
 * so `cards` holds the instance's cards to find it; the configuration returned is the struck card's
 * in its own shape, or the Set card's own for any other, and is what the Set card's playPrice is given. A ward never blocks a Set, and a Set
 * carries no message, since its Act says nothing about its card.
 */
export function decideSet(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, cards: readonly CardRules[], now: Date = new Date()): Verdict<{ price: Hundredths; config: unknown }> {
  if (playOf(rules) !== 'set') return wrongPlay(rules);
  if (target.reach !== 'post' || target.kind !== 'post') return refuse('a card is set face down on a post');
  if (effects.some((e) => e.faceDown && isLive(e, now))) return refuse('this post already holds a card face down');
  const lands = rules.canApply(target, effects);
  if (!lands.ok) return lands;
  const outcome = rules.trap?.outcome;
  let checked: Verdict<unknown>;
  if (outcome?.do === 'strike') {
    const struck = cards.find((c) => c.key === outcome.card);
    if (!struck) return refuse(`the instance has no card "${outcome.card}" for this trap to lay`);
    checked = struck.validateConfig(config);
  } else checked = rules.validateConfig(config);
  if (!checked.ok) return checked;
  const price = rules.playPrice(settings, target, checked.value);
  if (!Number.isSafeInteger(price) || price < 0) throw new Error(`card ${rules.key} priced a play at ${price}`);
  return ok({ price, config: checked.value });
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
export const spanMs = (s: Span): number => s.count * (s.unit === 'minute' ? 60_000 : s.unit === 'day' ? 86_400_000 : s.unit === 'week' ? 7 * 86_400_000 : 30 * 86_400_000);

/** The reaches a card lists, a post unless it says. */
export const reachesOf = (rules: Pick<CardRules, 'reaches'>): readonly Reach[] => rules.reaches ?? ['post'];

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
 * Whether a card is drawn in a play's moment (docs/plans/2026-11-03-effect-history-design.md, section 3): when its effect can change
 * after it lands, because it saves state (`validateState`), stacks (`stack` above 1), or ends by time (`lasts`). Such a card is drawn
 * still, as it stood then; any other is named in words. Read from the card's rules, so a card sets nothing.
 */
export function drawnInMoment(rules: Pick<CardRules, 'validateState' | 'stack' | 'lasts'>): boolean {
  return rules.validateState !== undefined || (rules.stack ?? 1) > 1 || rules.lasts !== undefined;
}

/**
 * What every card holds to unless it says otherwise: it lands on a reach it lists (a post unless it says), and its target
 * carries at most its stack of it (one unless the card says more) that are still up, each its own play, counting only the
 * effects on that same target, never those above it. A board carries one board card at a time, of any card, until it ends.
 */
export function landsOn(rules: Pick<CardRules, 'key' | 'stack' | 'reaches'>, target: CardTarget, effects: readonly CardEffect[], now: Date = new Date()): Verdict {
  const reaches = reachesOf(rules);
  if (!reaches.includes(target.reach)) return refuse(`this card lands on ${listed(reaches)}`);
  if (target.reach === 'post' && target.kind !== 'post') return refuse('a card lands on a post');
  // An ended effect holds no place (play_card counts the same way).
  const here = effects.filter((e) => (e.reach ?? 'post') === target.reach && isLive(e, now));
  if (target.reach === 'board') {
    const held = here[0];
    if (held) return refuse(`this board already carries a board card until ${held.ends ? refusalTime(held.ends) : 'it ends'}`);
  }
  const stack = rules.stack ?? 1;
  if (here.filter((e) => e.card === rules.key).length >= stack) {
    const where = target.reach === 'post' ? 'this post' : `this ${target.reach}`;
    return refuse(stack === 1 ? `${where} already carries that card` : `${where} already carries ${stack} of that card, the most it takes`);
  }
  return ok(undefined);
}

/** A color as a post's [color] tag reads one (engine/bbcode/parse.ts), surrounding spaces aside. */
export function color(value: unknown): string | null {
  return typeof value === 'string' ? safeColor(value.trim()) : null;
}
