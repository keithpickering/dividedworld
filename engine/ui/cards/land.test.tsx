/**
 * Whether a card can land on a post as the screen sees it: the card's own rules (`canApply`), given
 * the post's length and the plays already on it. The server decides again; this only says which
 * posts to offer a card on and which cards to offer a post.
 */
import { describe, expect, test } from 'vitest';
import { landsOnPost, type CardRules } from '../../rules/cards.ts';
import type { Act } from '../data/api.ts';
import { landing, lengthOf } from './land.ts';
import type { CardPlay } from './types.ts';

const rules = (key: string, stack?: number): Pick<CardRules, 'key' | 'stack' | 'canApply'> => {
  const own = { key, ...(stack === undefined ? {} : { stack }) };
  return { ...own, canApply: (target, effects) => landsOnPost(own, target, effects) };
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
