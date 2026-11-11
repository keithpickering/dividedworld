/**
 * Whether a card can land on a post, as the screens ask it: to offer a card only the posts it can
 * land on (every post the ghost mark "Play Whoops! on post N" is shown on) and the form what the post can still take. It is the card's own rules (`canApply`), given the post as
 * its rules see it, so a card that stacks three deep stops being offered on a post with three, and
 * the screen and the server agree because they ask the same function. The server decides again at
 * the play (`decidePlay`), whatever this said.
 */
import { QUADRANTS } from '../../rules/types.ts';
import { decidePlay, decideSet, postTarget, decideUse, effectsOnTarget, playOf as playOfRules, reachesOf, type BeyondPost, type CardEffect, type CardRules, type CardTarget, type EffectsAbove, type PostTarget, type Verdict } from '../../rules/cards.ts';
import type { Span } from '../../rules/types.ts';
import type { Act } from '../data/api.ts';
import type { CardPlay } from './types.ts';

/** A post's length in characters, as its rules count it: of its current words (an edit counts), and nothing for a body that is not text. */
export function lengthOf(post: Act): number {
  const body = post.currentPayload.body;
  return typeof body === 'string' ? [...body].length : 0;
}

/** The post as a card's rules see it. */
export function targetOf(post: Act): PostTarget {
  return postTarget(post.id, post.kind as PostTarget['kind'], post.currentPayload.body);
}

/** What the post carries as its rules see it (card_target, 0054): a play not caught, not ended by an admin and not over because it did not take (`untaken`, 0149), with a use card's gimmick and end; a card back naming no card, ended where it sprang, was taken back or its time passed. */
export function effectsOf(plays: readonly CardPlay[], cards: readonly Pick<CardRules, 'key' | 'gimmick' | 'rarity'>[], setLasts: Span): CardEffect[] {
  const span = setLasts.count * (setLasts.unit === 'minute' ? 60_000 : setLasts.unit === 'hour' ? 3_600_000 : setLasts.unit === 'day' ? 86_400_000 : setLasts.unit === 'week' ? 7 * 86_400_000 : 30 * 86_400_000);
  return plays.filter((p) => !p.caught && !p.reversed && !p.untaken).map((p): CardEffect => {
    if (p.faceDown) return { card: null, act: p.id, faceDown: true, ends: p.revealed?.at ?? p.takenBack?.at ?? new Date(Date.parse(p.playedAt) + span).toISOString() };
    const ward = cards.find((c) => c.key === p.card);
    return { card: p.card, act: p.id, ...(ward?.gimmick ? { gimmick: ward.gimmick } : {}), ...(p.ends ? { ends: p.ends } : {}) };
  });
}

/**
 * What `landing` reads beyond the card: the instance's cards (a ward's rarity and name, a strike's card), how long a Set lasts, and
 * the live effects above the target (its board's, thread's and author's, from `effectsAbove`), which a card's rules see too.
 */
export interface LandingContext {
  readonly cards: readonly CardRules[];
  readonly setLasts: Span;
  readonly above?: EffectsAbove;
  /** Ask whether a Move can be set face down on the post, which is `decideSet`, instead of whether it can be cast. */
  readonly faceDown?: true;
}

/**
 * Whether `rules`' card lands on `post`, which already carries `plays` (every card's, in any order); the refusal says why in the rules'
 * words. Given the instance's cards, it is the rules' own decision for the card's play (decidePlay, decideUse, decideSet) on its default
 * settings, so a cast a live ward turns away and a Set on a post holding a live back are not offered; that the post is the reader's own
 * is the caller's to ask. With no context, it is the card's `canApply` alone.
 */
export function landing(rules: Pick<CardRules, 'canApply'> & Partial<CardRules>, post: Act, plays: readonly CardPlay[], context?: LandingContext): Verdict {
  if (!context || !rules.key || !rules.rarity) return rules.canApply(targetOf(post), plays.filter((p) => !p.caught && !p.reversed && !p.untaken).map((p) => ({ card: p.card, act: p.id })));
  return landingOn(rules as CardRules, targetOf(post), plays, context);
}

/**
 * Whether `rules`' card lands on `target` (a post, a character, a thread or a board), which already carries `plays`, by the rules' own
 * decision for the card's play, as `landing` asks it for a post: what the ghost marks on a postbit, a thread's head and a board's
 * banner are drawn from.
 */
export function landingOn(rules: CardRules, target: CardTarget, plays: readonly CardPlay[], context: LandingContext): Verdict {
  const effects = effectsOnTarget(target, effectsOf(plays, context.cards, context.setLasts), context.above ?? {});
  const nameOf = (key: string) => context.cards.find((c) => c.key === key)?.name ?? key;
  /*
   * Only where the card lands is asked here: its settings are the form's, so the card's own refusal of none is set aside. A card that names a
   * quadrant or a class when it is played (a skim card, a ride back, a scored-as card) is checked by the rules to have its configuration name
   * one, so the settings held here do name one, a placeholder no rule reads, and the card's own landing is asked with no settings at all.
   */
  const lenient: CardRules = {
    ...rules, validateConfig: (c) => ({ ok: true, value: { ...(c as object), quadrant: QUADRANTS[0], class: 'any' } }), playPrice: () => 0,
    canApply: (t, e, _config, now) => rules.canApply(t, e, undefined, now),
  };
  const play = context.faceDown ? 'set' : playOfRules(rules);
  const decided = play === 'set' ? decideSet({ ...lenient, catches: undefined, setPhrase: undefined }, {} as never, target, effects, {}, context.cards)
    : play === 'use' ? decideUse(lenient, {} as never, target, effects, {}, '')
    : decidePlay(lenient, {} as never, target, effects, {}, '', { nameOf });
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
 * What a card set face down does, in one plain sentence, from the card's rules and never its name: a Move springs on a quote and lands on
 * what its first reach says; a set card waits for the card it names to be cast on the post (and takes it), or for a Mod Bot's visit to the
 * post to start (and ends it), or does nothing.
 */
export function springWords(rules: Pick<CardRules, 'play' | 'reaches' | 'trap'>): string {
  if (playOfRules(rules) === 'cast') return `Springs when someone quotes this post, and lands on ${landsWords(rules)}.`;
  const on = rules.trap?.trigger.on;
  if (on === 'cast') return 'Waits for the card it names to be cast on this post, and takes it.';
  if (on === 'visit') return 'Ends the next Mod Bot visit to this post when the visit starts.';
  return 'Does nothing.';
}

/** How long a Set lasts, as the form says it: "Ends by itself in 7 days." */
export const endsWords = (lasts: Span): string => `Ends by itself in ${lasts.count} ${lasts.unit}${lasts.count === 1 ? '' : 's'}.`;
