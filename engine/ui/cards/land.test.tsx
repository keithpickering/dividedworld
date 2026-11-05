/**
 * Whether a card can land on a post as the screen sees it: the card's own rules (`canApply`), given
 * the post's length and the plays already on it. The server decides again; this only says which
 * posts to offer a card on and which cards to offer a post.
 */
import { describe, expect, test } from 'vitest';
import { landsOn, type CardRules } from '../../rules/cards.ts';
import type { Act } from '../data/api.ts';
import { effectsOf, landing, landingOn, lengthOf } from './land.ts';
import type { CardPlay } from './types.ts';

const rules = (key: string, stack?: number): Pick<CardRules, 'key' | 'stack' | 'canApply'> => {
  const own = { key, ...(stack === undefined ? {} : { stack }) };
  return { ...own, canApply: (target, effects) => landsOn(own, target, effects) };
};
const post = (body: unknown, kind: Act['kind'] = 'post'): Act => ({
  id: 'p1', character: 'c1', kind, thread: 't1', targetActId: null, seq: 1, createdAt: '2026-10-29T21:00:00Z',
  payload: { body }, currentPayload: { body }, editedAt: null, shownEditedAt: null,
});
const play = (card: string, n: number): CardPlay => ({ id: `play-${card}-${n}`, card, layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-10-29T21:16:00Z', post: 'p1' });

describe('which posts a card lands on', () => {
  test('a post with room for it, and not an Act that is no post', () => {
    expect(landing(rules('whoops', 3), post('hi'), []).ok).toBe(true);
    expect(landing(rules('whoops', 3), post('hi', 'unmask'), []).ok).toBe(false);
  });

  test('a post already carrying three Whoops! takes no fourth, and says why', () => {
    const three = [play('whoops', 1), play('whoops', 2), play('whoops', 3)];
    const verdict = landing(rules('whoops', 3), post('hi'), three);
    expect(verdict).toEqual({ ok: false, why: 'this post already carries 3 of that card, the most it takes' });
    expect(landing(rules('whoops', 3), post('hi'), three.slice(0, 2)).ok).toBe(true);
  });

  test('another card\'s plays do not count against it', () => {
    expect(landing(rules('whoops', 3), post('hi'), [play('stick-around', 1), play('stick-around', 2), play('stick-around', 3)]).ok).toBe(true);
    expect(landing(rules('stick-around'), post('hi'), [play('stick-around', 1)]).ok).toBe(false);
  });
});

describe('how long a post is', () => {
  test('in characters of its current words, as the rules count it, and nothing for a body that is no text', () => {
    expect(lengthOf(post('a😀b'))).toBe(3);
    expect(lengthOf(post(undefined))).toBe(0);
  });
});

/* The card mechanic (docs/plans/2026-11-01-card-plays-plan.md, Task 7): a Set lands where no back is live, a cast where no live ward
   covers it, and a caught play holds no place. */
describe('wards, backs and catches, as a screen offers a card', () => {
  const setLasts = { unit: 'day' as const, count: 7 };
  const at = new Date().toISOString();
  const back = (over: Partial<CardPlay> = {}): CardPlay => ({ ...play('kb:card-back', 1), id: 'back', faceDown: true, playedAt: at, ...over });
  const shield: CardRules = { key: 'shield', name: 'Shield', alignment: 'sweet', rarity: 'uncommon', play: 'use', ward: true, lasts: setLasts, priceKey: 'x', playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e) => landsOn({ key: 'shield' }, t, e) };
  const snare: CardRules = { ...shield, key: 'snare', name: 'Snare', play: 'set', ward: undefined, lasts: undefined, trap: { trigger: { on: 'cast' }, outcome: { do: 'nullify' } }, canApply: () => ({ ok: true, value: undefined }) };
  const blot: CardRules = { ...shield, key: 'blot', name: 'Blot', rarity: 'common', play: undefined, ward: undefined, lasts: undefined, canApply: (t, e) => landsOn({ key: 'blot' }, t, e) };
  const cards = [shield, snare, blot];
  const ward = (ends: string): CardPlay => ({ ...play('shield', 1), ends });

  test('a Set is offered where no card back is live, and a sprung or ended back is none', () => {
    expect(landing(snare, post('hi'), [], { cards, setLasts }).ok).toBe(true);
    expect(landing(snare, post('hi'), [back()], { cards, setLasts })).toEqual({ ok: false, why: 'this post already holds a card face down' });
    expect(landing(snare, post('hi'), [back({ revealed: { card: 'snare', spring: 's', at } })], { cards, setLasts }).ok).toBe(true);
    expect(landing(snare, post('hi'), [back({ playedAt: '2020-01-01T00:00:00Z' })], { cards, setLasts }).ok).toBe(true);
  });

  test('a cast is not offered where a live ward turns it away, and is where the ward has ended', () => {
    expect(landing(blot, post('hi'), [ward('2999-01-01T00:00:00Z')], { cards, setLasts })).toEqual({ ok: false, why: 'this post\'s Shield turns away cards up to uncommon' });
    expect(landing(blot, post('hi'), [ward('2020-01-01T00:00:00Z')], { cards, setLasts }).ok).toBe(true);
  });

  test('a caught play holds no place in its card\'s stack', () => {
    expect(landing(blot, post('hi'), [{ ...play('blot', 1), caught: 'back' }], { cards, setLasts }).ok).toBe(true);
  });
});

/* Reach (docs/plans/2026-11-01-card-reach-plan.md, Task 1): a card beyond a post is offered on the targets its reaches list, its
   stack counts that target's plays alone, and a board takes one board card at a time. */
describe('where a card beyond a post is offered', () => {
  const setLasts = { unit: 'day' as const, count: 7 };
  const lasts = { unit: 'day' as const, count: 1 };
  const reaching = (key: string, reaches: CardRules['reaches']): CardRules => ({
    key, name: key, alignment: 'pepperoni', rarity: 'legendary', reaches, lasts, priceKey: 'x', playPrice: () => 0,
    validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e) => landsOn({ key, reaches }, t, e),
  });
  const sparkle = reaching('sparkle', ['character']);
  const quake = reaching('quake', ['board']);
  const cards = [sparkle, quake];
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const on = (card: string, ends: string): CardPlay => ({ ...play(card, 1), ends });

  test('a character card on a character, never on a post', () => {
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [], { cards, setLasts }).ok).toBe(true);
    expect(landing(sparkle, post('hi'), [], { cards, setLasts })).toEqual({ ok: false, why: 'this card lands on a character' });
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [on('sparkle', soon)], { cards, setLasts })).toEqual({ ok: false, why: 'this character already carries that card' });
    expect(landingOn(sparkle, { reach: 'character', character: 'c1' }, [on('sparkle', '2020-01-01T00:00:00Z')], { cards, setLasts }).ok).toBe(true);
  });

  test('a board card where no board card is live', () => {
    expect(landingOn(quake, { reach: 'board', board: 'b1' }, [on('other', '2099-03-04T05:06:07Z')], { cards, setLasts })).toEqual({ ok: false, why: 'this board already carries a board card until 2099-03-04 05:06 UTC' });
    expect(landingOn(quake, { reach: 'board', board: 'b1' }, [], { cards, setLasts }).ok).toBe(true);
  });
});

/* An admin's end (supabase/migrations/0092_card_end.sql): a play an admin ended is no effect the rules see, as a caught one is none. */
describe('a play an admin ended, as the rules see the post', () => {
  const setLasts = { unit: 'day' as const, count: 7 };
  const cards = [{ key: 'whoops', rarity: 'common' as const }];
  const ended = (n: number): CardPlay => ({ ...play('whoops', n), reversed: true });

  test('effectsOf leaves it out, and keeps the live one beside it', () => {
    expect(effectsOf([play('whoops', 1), ended(2)], cards, setLasts).map((e) => e.act)).toEqual(['play-whoops-1']);
    expect(effectsOf([ended(1)], cards, setLasts)).toEqual([]);
  });

  test('it holds no place against a card\'s stack limit', () => {
    const three = [play('whoops', 1), play('whoops', 2), ended(3)];
    expect(landing(rules('whoops', 3), post('hi'), three).ok).toBe(true);
    expect(landing(rules('whoops', 3), post('hi'), [...three.slice(0, 2), play('whoops', 3)]).ok).toBe(false);
  });
});
