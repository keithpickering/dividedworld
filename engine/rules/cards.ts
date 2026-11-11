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
import type { ActKind, Alignment, EconomyRead, Hundredths, Settings, Span } from './types.ts';
import { parse, safeColor } from '../bbcode/parse.ts';
import { visibleText } from '../bbcode/visible.ts';
import { phraseIn } from '../bbcode/phrase.ts';

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
    /**
     * The post's current visible text (engine/bbcode/visible.ts): its own words, with a separator where a quote, code, a link or
     * an image stands. A card that works on a post's words reads these, at the offsets the renderer's text layers use.
     */
    readonly text: string;
    /**
     * Which version of the post this is (card_target, 0070): its latest edit's id, or the post's own before any edit. The server
     * reads it with the post and hands it back to play_card, which refuses a play decided against an older one. A screen's
     * preview has none.
     */
    readonly version?: string;
  }
  | { readonly reach: 'character'; readonly character: string }
  | { readonly reach: 'thread'; readonly thread: string }
  | { readonly reach: 'board'; readonly board: string };
export type PostTarget = Extract<CardTarget, { reach: 'post' }>;

/** A post as a card's rules see it, from its current body: its length in characters and its visible text, and its version where the server read one. */
export function postTarget(act: string, kind: PostTarget['kind'], body: unknown, version?: string): PostTarget {
  const words = typeof body === 'string' ? body : '';
  return { reach: 'post', act, kind, length: [...words].length, text: visibleText(parse(words)), ...(version ? { version } : {}) };
}

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
 * What springs a Gimmick (a card whose play is `set`; the face-down Moves design, section 4): a card cast on its post (Trap Card's, which
 * catches the one card it names), or a Mod Bot's visit starting (Hall Pass's). A Move set face down springs on a quote, which is the
 * engine's and never a card's, so no card names it.
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
}

/**
 * A card whose effect holds generated text: `tokens` is how many the play bought (from its checked configuration and the settings), and
 * `frame` is a pure function from the thread to a completion's prompt and the stops that end it. The engine owns the queue, the call, the
 * scrubber and the refund; the card owns only these two, and names nothing the engine knows. A card that writes reaches a post alone, and an
 * instance with no completion endpoint (`Settings.oldVoice` false) does not sell, offer or play it.
 */
export interface Writes<Config = unknown> {
  tokens(config: Config, settings: Settings): number;
  frame(input: WriteFrameInput): { readonly prompt: string; readonly stop: readonly string[] };
}

export const OLD_VOICE_OFF = "The old voice isn't running on this forum, so this card can't be played.";

export interface CardRules<Config = unknown> {
  readonly key: string;
  readonly name: string;
  readonly alignment: Alignment;
  readonly rarity: Rarity;
  /** How it is played; a Cast unless it says. */
  readonly play?: Play;
  /**
   * A Gimmick's trap: what springs it. What a spring does is the engine's per trigger: a cast Gimmick catches the card its configuration
   * names (`catches`) and takes it, a visit Gimmick ends the visit. A Gimmick with none is a bluff, and never springs. A Move has none:
   * set face down, it springs on a quote, and the quote lands it.
   */
  readonly trap?: { readonly trigger: Trigger };
  /** A cast Gimmick's catch (Trap Card's): the key of the card it waits for, from its checked configuration. Every cast Gimmick has it, and nothing else. */
  catches?(config: Config): string;
  /** A Move's set phrase (Autocorrect's): the phrase its landing needs, found in the quoting post's own words, from its checked configuration. Only a Move has it. */
  setPhrase?(config: Config): string;
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
  /** Generated text its effect holds (a card that writes); it reaches a post alone, and is withheld where `Settings.oldVoice` is false. */
  readonly writes?: Writes<Config>;
  /** The economy numbers its rules read. */
  readonly reads?: readonly EconomyRead[];
  /** The numbers in `Settings.cardSettings` its screens read, so an instance missing one, or holding one out of its bounds, is refused. */
  readonly screenReads?: readonly EconomyRead[];
  /** How many of this card one post may carry, each its own play and layer; 1 unless said. */
  readonly stack?: number;
  /** Whether each play is drawn from a seed the server chooses (a splat different every time), stored on its Act. */
  readonly seeded?: boolean;
  /** What casting it on this target costs from the wallet, on top of the base price already paid. A set or a sprung card pays none of it. */
  playPrice(settings: Settings, target: CardTarget, config: Config): Hundredths;
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
  /** For a card whose effect holds state (Whoops!'s strokes): checks a state to be saved. */
  validateState?(state: unknown): Verdict<unknown>;
}

/**
 * The most tokens a play of a card that writes may buy: the bound require_write_tokens enforces (supabase/migrations/0148_card_writes.sql), since a
 * stored text is at most 4000 characters. A card that writes reads its most from the economy with this as its `max`, so a setting above it is
 * refused by the settings' validation and never by the database in a play.
 */
export const WRITE_TOKENS_MOST = 2000;

/** The largest whole number Postgres's integer holds, which a price is read as there (0006_cards.sql). */
export const INT4_MAX = 2_147_483_647;

/** One of the instance's economy numbers, which an instance must hold (instanceProblems). */
export function economyOf(settings: Settings, key: string): number {
  const n = settings.economy[key];
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`economy "${key}" is not set`);
  return n;
}

export const ok = <T>(value: T): Verdict<T> => ({ ok: true, value });
export const refuse = (why: string): Verdict<never> => ({ ok: false, why });

/**
 * Whether a card is withheld from this instance: it writes, and the instance says it runs no completion endpoint (`Settings.oldVoice` is
 * false). Only an explicit false withholds: an instance's settings always hold the key (settings validation requires a boolean), and the
 * screens' landing check holds no settings at all, where a missing key must not refuse every writing card.
 */
export const withheld = (rules: Pick<CardRules, 'writes'>, settings: Partial<Pick<Settings, 'oldVoice'>>): boolean => rules.writes !== undefined && settings.oldVoice === false;

/** What every play of a card decides: whether it lands, its configuration, the caster's message, its price. */
/**
 * What a decided play is: its price, its checked configuration and message, and, for a card that writes, the tokens the play bought (`writes.tokens`
 * of the checked configuration, against the settings of this moment). The tokens are the play's own fact: the server writes them with the play
 * (supabase/migrations/0148_card_writes.sql), and a regeneration and the log read them there, never the settings of a later day.
 */
export interface Decided { readonly price: Hundredths; readonly config: unknown; readonly message: string; readonly tokens?: number }

function decided(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown, now: Date): Verdict<Decided> {
  if (withheld(rules, settings)) return refuse(OLD_VOICE_OFF);
  // The old voice's refusal is said first, then the landing's, then the configuration's; the configuration is checked first only so the landing can read it.
  const checked = rules.validateConfig(config);
  const lands = rules.canApply(target, effects, checked.ok ? checked.value : undefined, now);
  if (!lands.ok) return lands;
  if (!checked.ok) return checked;
  const said = casterMessage(message);
  if (!said.ok) return said;
  const price = rules.playPrice(settings, target, checked.value);
  if (!Number.isSafeInteger(price) || price < 0) throw new Error(`card ${rules.key} priced a play at ${price}`);
  if (!rules.writes) return ok({ price, config: checked.value, message: said.value });
  const tokens = rules.writes.tokens(checked.value, settings);
  if (!Number.isSafeInteger(tokens) || tokens < 1) throw new Error(`card ${rules.key} bought ${tokens} tokens`);
  return ok({ price, config: checked.value, message: said.value, tokens });
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
export function decidePlay(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown, context: PlayContext = {}): Verdict<Decided> {
  if (playOf(rules) !== 'cast') return wrongPlay(rules);
  const now = context.now ?? new Date();
  const ward = effects.find((e) => e.ward !== undefined && (e.reach ?? 'post') === target.reach && isLive(e, now) && atOrBelow(rules.rarity, e.ward));
  if (ward) return refuse(wardWords(ward.card === null ? 'ward' : (context.nameOf?.(ward.card) ?? ward.card), ward.ward!, target.reach));
  return decided(rules, settings, target, effects, config, message, now);
}

/**
 * A Use card played on a target. That the target is the player's own post is SQL's to hold, since
 * only SQL reads who wrote it; a ward does not refuse a Use.
 */
export function decideUse(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, message: unknown, context: Pick<PlayContext, 'now'> = {}): Verdict<Decided> {
  if (playOf(rules) !== 'use') return wrongPlay(rules);
  return decided(rules, settings, target, effects, config, message, context.now ?? new Date());
}

/**
 * A card set face down on a post, a Move (cast) or a Gimmick (set); a Use is refused. Refused on a post that already holds a live
 * face-down card. The configuration is the card's own (`validateConfig`). A cast Gimmick names the card it catches
 * (`catches`), which must be one of `cards` that is cast on a post, since a caught card is one a caster played there. A Move's
 * `setPhrase` is returned too, for the landing to find in the quoting post's words, and an empty one is refused, since it is in no
 * post and the back could never land. A set costs nothing beyond the card, and a sprung card lands free. A ward never blocks a set, and a set carries no message, since its Act says nothing about its card.
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

export function decideSet(rules: CardRules, settings: Settings, target: CardTarget, effects: readonly CardEffect[], config: unknown, cards: readonly CardRules[], conditions: SetConditions = {}, now: Date = new Date()): Verdict<{ price: Hundredths; config: unknown; catches?: string; phrase?: string; passage?: string; who?: { except: boolean; characters: readonly string[] } }> {
  const play = playOf(rules);
  if (play !== 'cast' && play !== 'set') return wrongPlay(rules);
  if (withheld(rules, settings)) return refuse(OLD_VOICE_OFF);
  if (target.reach !== 'post' || target.kind !== 'post') return refuse('a card is set face down on a post');
  if (effects.some((e) => e.faceDown && isLive(e, now))) return refuse('this post already holds a card face down');
  // A Move that lands beyond a post (Glitter Bomb on a character) is set on a post all the same and lands on what the quote reaches (design section 3); whether it can land there is the spring's to decide.
  const lands = reachesOf(rules).includes('post') ? rules.canApply(target, effects, undefined, now) : ok(undefined);
  if (!lands.ok) return lands;
  const checked = rules.validateConfig(config);
  if (!checked.ok) return checked;
  let catches: string | undefined;
  if (rules.catches) {
    catches = rules.catches(checked.value);
    const named = cards.find((c) => c.key === catches);
    if (!named || !castOnPost(named)) return refuse(`${rules.name} names a card that is cast on a post`);
  }
  let phrase = rules.setPhrase?.(checked.value);
  if (phrase !== undefined && phrase.trim() === '') return refuse(`${rules.name} needs a phrase to wait for`);
  if (phrase !== undefined && [...phrase].length > SET_PHRASE_MOST) return refuse(`${rules.name} waits for a phrase of at most ${SET_PHRASE_MOST} characters`);
  const { says, passage, who } = conditions;
  if (says !== undefined || passage !== undefined || who !== undefined) {
    // A Gimmick takes none: Trap Card already names its card, and Hall Pass waits for a visit.
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
export const spanMs = (s: Span): number => s.count * (s.unit === 'minute' ? 60_000 : s.unit === 'day' ? 86_400_000 : s.unit === 'week' ? 7 * 86_400_000 : 30 * 86_400_000);

/** The reaches a card lists, a post unless it says. */
export const reachesOf = (rules: Pick<CardRules, 'reaches'>): readonly Reach[] => rules.reaches ?? ['post'];

/** Whether a card is cast on a post: the cards a cast Gimmick may name, since a caught card is one a caster played there. */
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

/** A color as a post's [color] tag reads one (engine/bbcode/parse.ts), surrounding spaces aside. */
export function color(value: unknown): string | null {
  return typeof value === 'string' ? safeColor(value.trim()) : null;
}

/**
 * Whether the pool may offer a card to a staff persona: code can build a configuration for it, or the persona chooses its options. A Gimmick that
 * springs on a visit is never offered: a Mod Bot visits only players' posts, so a persona's Hall Pass could never spring.
 */
export function staffOffers(card: CardRules): boolean {
  if (card.trap?.trigger.on === 'visit') return false;
  return staffConfigOf(card, () => 0) !== null || card.staffOptions !== undefined;
}
