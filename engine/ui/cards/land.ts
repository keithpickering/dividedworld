/**
 * Whether a card can land on a post, as the screens ask it: to offer a card only the posts it can
 * land on (every post the ghost mark "Play Whoops! on post N" is shown on) and the form what the post can still take. It is the card's own rules (`canApply`), given the post as
 * its rules see it, so a card that stacks three deep stops being offered on a post with three, and
 * the screen and the server agree because they ask the same function. The server decides again at
 * the play (`decidePlay`), whatever this said.
 */
import { ALIGNMENTS, QUADRANTS } from '../../rules/types.ts';
import { decidePlay, decideSet, faceUpOnly, postTarget, decideUse, cuttable, effectsOnTarget, atOrBelow, matchWords, playOf as playOfRules, RARITIES, reachesOf, type BeyondPost, type CardEffect, type CardRules, type CardTarget, type EffectsAbove, type PostTarget, type Rarity, type Verdict } from '../../rules/cards.ts';
import type { Span } from '../../rules/types.ts';
import { forgedList } from '../../bbcode/quoted.ts';
import { shareWords, upperFirst } from '../copy-words.ts';
import type { Act, EffectState, Id } from '../data/api.ts';
import type { CardPlay } from './types.ts';
import { stackPlays } from './plays.ts';

/** A post's length in characters, as its rules count it: of its current words (an edit counts), and nothing for a body that is not text. */
export function lengthOf(post: Act): number {
  const body = post.currentPayload.body;
  return typeof body === 'string' ? [...body].length : 0;
}

/** The post as a card's rules see it; `under` is the post it is drawn under, where it is a reply a play carries. */
export function targetOf(post: Act, under?: string): PostTarget {
  return postTarget(post.id, post.kind as PostTarget['kind'], post.currentPayload.body, undefined, under, undefined, forgedList(post.currentPayload));
}

/** What the post carries as its rules see it (card_target, 0054): a play not caught, not ended by an admin and not over because it did not take (`untaken`, 0149), with a use card's gimmick and end; a card back naming no card, ended where it sprang, was taken back or its time passed.
 * `room` is the saved states and the post's version, which say which drawing plays are cleared. Without it every play is uncleared and none is judged by version: a caller that only reads what a play stops (Post.tsx's `quoteStop`) may omit it; every caller that asks whether a card lands passes it. */
export function effectsOf(plays: readonly CardPlay[], cards: readonly Pick<CardRules, 'key' | 'gimmick' | 'rarity' | 'drawsEffect'>[], room?: { readonly states: Readonly<Record<Id, EffectState>>; readonly version: Id | null }): CardEffect[] {
  return plays.filter((p) => !p.caught && !p.reversed && !p.cut && !p.untaken).map((p): CardEffect => {
    if (p.faceDown) { const ends = p.revealed?.at ?? p.takenBack?.at ?? p.endsAt; return { card: null, act: p.id, faceDown: true, ...(ends ? { ends } : {}) }; }
    const ward = cards.find((c) => c.key === p.card);
    /* What card_target gives: a play of a card that draws counts toward the post's limit unless the card says its saved state clears it (true, or `{ version }` where that is the post's version now). */
    /* `BeyondPost` has no 'post', but a play on the post itself may carry reach 'post' (effectsUp counts it), so it is compared as a string. */
    const drawing = ward?.drawsEffect !== undefined && (p.reach === undefined || (p.reach as string | undefined) === 'post');
    const saved = room?.states[p.id];
    const answer = drawing && saved !== undefined ? ward.drawsEffect?.cleared?.(saved.state) : undefined;
    const cleared = answer === true || (typeof answer === 'object' && room?.version != null && answer.version === room.version);
    return { card: p.card, act: p.id, ...(ward?.gimmick ? { gimmick: ward.gimmick } : {}), ...(p.ends ? { ends: p.ends } : {}), ...(drawing ? { drawing: true as const } : {}), ...(cleared ? { cleared: true as const } : {}) };
  });
}

/**
 * What `landing` reads beyond the card: the instance's cards (a ward's rarity and name, a strike's card) and
 * the live effects above the target (its board's, thread's and author's, from `effectsAbove`), which a card's rules see too.
 */
export interface LandingContext {
  readonly cards: readonly CardRules[];
  readonly above?: EffectsAbove;
  /** Ask whether a Move can be set face down on the post, which is `decideSet`, instead of whether it can be cast. */
  readonly faceDown?: true;
  /** The post the one asked about is drawn under, where it is a reply a play carries: a card that replies takes none under it. */
  readonly under?: string;
  /** The caster's live pierce (a Cheap Shot's `upTo`): a ward whose card is at or below it does not turn the cast away (`decidePlay`). */
  readonly pierce?: Rarity;
  /** The page's clock (`api.now()`), against which a play's end is read: a card that cuts is offered only where a Gimmick is still up. */
  readonly now?: number;
  /** The instance's limit on the effects one post shows (`Settings.postEffects`), which every caller gives: what a card that draws is refused by once the post is full (`roomOnPost`). */
  readonly postEffects: number;
  /** What each play's effect has saved (`PostPlays.states`) and the version the post is at now: what says a play is cleared, so it takes no slot. */
  readonly states?: Readonly<Record<Id, EffectState>>;
  readonly version?: Id | null;
}

/**
 * Whether `rules`' card lands on `post`, which already carries `plays` (every card's, in any order); the refusal says why in the rules'
 * words. Given the instance's cards, it is the rules' own decision for the card's play (decidePlay, decideUse, decideSet) on its default
 * settings, so a cast a live ward turns away and a Set on a post holding a live back are not offered; that the post is the reader's own
 * is the caller's to ask. With no context, it is the card's `canApply` alone.
 */
export function landing(rules: Pick<CardRules, 'canApply'> & Partial<CardRules>, post: Act, plays: readonly CardPlay[], context?: LandingContext): Verdict {
  if (!context || !rules.key || !rules.rarity) return rules.canApply(targetOf(post, context?.under), plays.filter((p) => !p.caught && !p.reversed && !p.cut && !p.untaken).map((p) => ({ card: p.card, act: p.id })));
  return landingOn(rules as CardRules, targetOf(post, context.under), plays, context);
}

/**
 * Which ways a card can land on a post: cast now, and set face down. The postbit's mark (GhostMark) and the play form's "How to play it"
 * pair both read this one answer, so they cannot disagree. It keeps only the plays that hold a place in the stack (`stackPlays`: the live ones and a fall a filing spent, as the server counts them), and filtering is idempotent, so a caller that
 * has already filtered (the play form) and one that has not (the mark) end with the same set. It is asked without the form's settings (landing's own lenient reading), so the answer
 * never changes as the player types.
 * A set is only ever the post author's own, so `own` says whether the reader's characters wrote the post. A Move is set face down only
 * where its play is a cast, since a set card is set by its own play. A faceUpOnly card is never set: landing's lenient reading sets a
 * needed message aside, so decideSet would not refuse it here.
 */
export function waysOn(rules: CardRules, post: Act, plays: readonly CardPlay[], context: { readonly cards: readonly CardRules[]; readonly own: boolean; readonly now: number; readonly under?: string; readonly pierce?: Rarity; readonly postEffects: number; readonly states?: Readonly<Record<Id, EffectState>>; readonly version?: Id | null }): { readonly cast: boolean; readonly set: boolean } {
  const live = stackPlays(plays, context.now);
  const room = { postEffects: context.postEffects, ...(context.states ? { states: context.states } : {}), ...(context.version !== undefined ? { version: context.version } : {}) };
  const cast = landing(rules, post, live, context).ok;
  const set = playOfRules(rules) === 'cast' && context.own && !faceUpOnly(rules) && landing(rules, post, live, { cards: context.cards, faceDown: true, now: context.now, ...room, ...(context.under === undefined ? {} : { under: context.under }) }).ok;
  return { cast, set };
}

/**
 * Whether `rules`' card lands on `target` (a post, a character, a thread or a board), which already carries `plays`, by the rules' own
 * decision for the card's play, as `landing` asks it for a post: what the ghost marks on a postbit, a thread's head and a board's
 * banner are drawn from.
 */
export function landingOn(rules: CardRules, target: CardTarget, plays: readonly CardPlay[], context: LandingContext): Verdict {
  const effects = effectsOnTarget(target, effectsOf(plays, context.cards, { states: context.states ?? {}, version: context.version ?? null }), context.above ?? {});
  const settings = { postEffects: context.postEffects } as never;
  const nameOf = (key: string) => context.cards.find((c) => c.key === key)?.name ?? key;
  /*
   * Only where the card lands is asked here: its settings and its message are the form's, so the card's own refusal of none is set aside. A
   * card that names a quadrant or a class when it is played (a skim card, a ride back, a scored-as card) is checked by the rules to have its
   * configuration name one, so the settings held here do name one, a placeholder no rule reads, and the card's own landing is asked with no
   * settings at all. So nothing the lenient card is asked may read the settings: its price is none, and a card that writes buys a placeholder
   * length (what it buys is the form's, from the live economy). It still writes, so the rules' refusals of a card that writes still hold here:
   * a Set refuses one face down.
   */
  /* A card that cuts names the Gimmick it ends, which is the form's choice: here it names one it may end if the target holds any (decidePlay refuses a target holding none first, in words of its own). */
  const rulesOf = (key: string) => context.cards.find((c) => c.key === key);
  const at = context.now === undefined ? undefined : new Date(context.now);
  const names = rules.cuts === undefined ? undefined : cuttable(rules, effects, target, at, rulesOf)[0]?.act;
  const lenient: CardRules = {
    /* A surface card's first draw is the composer's, made after the mark is pressed: the decision here is only where the card lands, so it is asked as a card with no surface (its own `canApply` still holds the wall it is). */
    ...rules, surface: undefined, validateConfig: (c) => ({ ok: true, value: { ...(c as object), quadrant: QUADRANTS[0], class: 'any', ...(names === undefined ? {} : { play: names }) } }), playPrice: () => 0,
    ...(rules.writes ? { writes: { ...rules.writes, tokens: () => 1 } } : {}),
    canApply: (t, e, _config, now) => rules.canApply(t, e, undefined, now), needsMessage: undefined,
  };
  const play = context.faceDown ? 'set' : playOfRules(rules);
  const decided = play === 'set' ? decideSet({ ...lenient, catches: undefined, setPhrase: undefined }, settings, target, effects, {}, context.cards)
    : play === 'use' ? decideUse(lenient, settings, target, effects, {}, '')
    : decidePlay(lenient, settings, target, effects, {}, '', { nameOf, rulesOf, ...(at === undefined ? {} : { now: at }), ...(context.pierce === undefined ? {} : { pierce: context.pierce, rarityOf: (key: string) => context.cards.find((c) => c.key === key)?.rarity }) });
  return decided.ok ? { ok: true, value: undefined } : decided;
}

/** Where a sprung Move lands, by the reach it lists first, as the form says it. */
const LANDS_ON: Readonly<Record<'post' | BeyondPost, string>> = {
  post: 'the quoting post',
  character: "the quoting post's writer",
  thread: "the quoting post's thread",
  board: "the quoting post's board",
};

/** Where a sprung Move lands, in words ("the quoting post"). */
export const landsWords = (rules: Pick<CardRules, 'reaches'>): string => LANDS_ON[reachesOf(rules)[0] ?? 'post'];

/**
 * What a lockout back's match says of the Move it springs on, from the match and never a card's key: "that isn't Sweet, up to rare" where it leaves one flavor
 * out of the instance's flavors, "that is Sweet" where it takes some, and nothing of flavor where it takes all. A rarity below the card's own is named; the top one is not.
 */
function lockoutMatchWords(match: NonNullable<CardRules['trap']>['match'], own: Rarity): string {
  if (!match) return ' that it names';
  const rarity = match.upTo !== undefined && atOrBelow(match.upTo, own) ? match.upTo : own;
  const flavors = ALIGNMENTS.filter((a) => match.flavors?.includes(a));
  const left = ALIGNMENTS.filter((a) => !flavors.includes(a));
  const kind = flavors.length === 0 || left.length === 0 ? null : left.length === 1 ? `isn't ${upperFirst(left[0]!)}` : `is ${flavors.map(upperFirst).join(' or ')}`;
  const upTo = rarity === RARITIES[RARITIES.length - 1] ? '' : `up to ${rarity}`;
  return kind === null ? (upTo ? ` that is ${upTo}` : '') : ` that ${kind}${upTo ? `, ${upTo}` : ''}`;
}

/**
 * What a card set face down does, in one plain sentence, from the card's rules and never its name: a Move springs on a quote and lands on
 * what its first reach says; a set card waits for the card it names, or the cards its match covers, to be cast on the post (and takes it, or lets it land and pays on its votes), or for a
 * Mod Bot's visit to the post to start (and ends it), or does nothing.
 */
export function springWords(rules: Pick<CardRules, 'play' | 'reaches' | 'trap' | 'rarity'>): string {
  if (playOfRules(rules) === 'cast') return `Springs when someone quotes this post, and lands on ${landsWords(rules)}.`;
  const on = rules.trap?.trigger.on;
  if (on === 'cast') {
    /* A match said with a rarity ("a Salty card, up to common") closes its comma before the verb, as an aside does. */
    const waits = rules.trap?.match ? matchWords(rules.trap.match, rules.rarity) : 'the card it names';
    const comma = waits.includes(', up to ') ? ',' : '';
    const outcome = rules.trap?.outcome;
    if (outcome?.kind === 'lockout') return `It springs on the first Move played on your post${lockoutMatchWords(rules.trap?.match, rules.rarity)}: the Move lands, and whoever played it is locked out of the thread for ${outcome.hours} hours.`;
    if (outcome?.kind === 'ride') return `Waits for ${waits}${comma} to be cast on this post, lets it land, and pays you ${shareWords(outcome.share)} for each vote it draws${outcome.every ? '' : ' of the kind you name'}.`;
    if (outcome?.kind === 'refund') return `Waits for ${waits}${comma} to be cast on this post, lets it land, and gives the card back to its caster.`;
    return `Waits for ${waits}${comma} to be cast on this post, and takes it.`;
  }
  if (on === 'visit') return 'Ends the next Mod Bot visit to this post when the visit starts.';
  return 'Does nothing.';
}

/** How long a Set lasts, as the form says it: "Ends by itself in 7 days." */
export const endsWords = (lasts: Span): string => `Ends by itself in ${lasts.count} ${lasts.unit}${lasts.count === 1 ? '' : 's'}.`;
