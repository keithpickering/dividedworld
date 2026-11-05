/**
 * Whether a card can land on a post, as the screens ask it: to offer a card only the posts it can
 * land on (every post the ghost mark "Play Whoops! on post N" is shown on) and the form what the post can still take. It is the card's own rules (`canApply`), given the post as
 * its rules see it, so a card that stacks three deep stops being offered on a post with three, and
 * the screen and the server agree because they ask the same function. The server decides again at
 * the play (`decidePlay`), whatever this said.
 */
import { decidePlay, decideSet, postTarget, decideUse, effectsOnTarget, playOf as playOfRules, type CardEffect, type CardRules, type CardTarget, type EffectsAbove, type PostTarget, type Verdict } from '../../rules/cards.ts';
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

/** What the post carries as its rules see it (card_target, 0054): a play not caught, with a ward's rarity and a Use's end; a card back naming no card, ended where it sprang or its time passed. */
export function effectsOf(plays: readonly CardPlay[], cards: readonly Pick<CardRules, 'key' | 'ward' | 'rarity'>[], setLasts: Span): CardEffect[] {
  const span = setLasts.count * (setLasts.unit === 'minute' ? 60_000 : setLasts.unit === 'day' ? 86_400_000 : setLasts.unit === 'week' ? 7 * 86_400_000 : 30 * 86_400_000);
  return plays.filter((p) => !p.caught && !p.reversed).map((p): CardEffect => {
    if (p.faceDown) return { card: null, act: p.id, faceDown: true, ends: p.revealed?.at ?? new Date(Date.parse(p.playedAt) + span).toISOString() };
    const ward = cards.find((c) => c.key === p.card);
    return { card: p.card, act: p.id, ...(ward?.ward ? { ward: ward.rarity } : {}), ...(p.ends ? { ends: p.ends } : {}) };
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
}

/**
 * Whether `rules`' card lands on `post`, which already carries `plays` (every card's, in any order); the refusal says why in the rules'
 * words. Given the instance's cards, it is the rules' own decision for the card's play (decidePlay, decideUse, decideSet) on its default
 * settings, so a cast a live ward turns away and a Set on a post holding a live back are not offered; that the post is the reader's own
 * is the caller's to ask. With no context, it is the card's `canApply` alone.
 */
export function landing(rules: Pick<CardRules, 'canApply'> & Partial<CardRules>, post: Act, plays: readonly CardPlay[], context?: LandingContext): Verdict {
  if (!context || !rules.key || !rules.rarity) return rules.canApply(targetOf(post), plays.filter((p) => !p.caught && !p.reversed).map((p) => ({ card: p.card, act: p.id })));
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
  /* Only where the card lands is asked here: its settings are the form's, so the card's own refusal of none is set aside. */
  const lenient: CardRules = { ...rules, validateConfig: (c) => ({ ok: true, value: c }), playPrice: () => 0 };
  const play = playOfRules(rules);
  const decided = play === 'set' ? decideSet({ ...lenient, trap: undefined }, {} as never, target, effects, {}, context.cards)
    : play === 'use' ? decideUse(lenient, {} as never, target, effects, {}, '')
    : decidePlay(lenient, {} as never, target, effects, {}, '', { nameOf });
  return decided.ok ? { ok: true, value: undefined } : decided;
}
