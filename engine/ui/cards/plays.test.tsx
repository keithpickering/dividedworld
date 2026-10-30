/**
 * The store of the card plays on the posts on screen: a play read from its card Act, laid over its
 * post in play order, with the post author's newest saved state and the reader's releases, and each
 * change heard by the post it belongs to alone.
 */
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../data/api.ts';
import { createPlays, effectCards, inPlayOrder, playOf } from './plays.ts';

const POST = '11111111-0000-4000-8000-000000000001';
const OTHER = '11111111-0000-4000-8000-000000000002';
let n = 0;
const card = (over: Partial<Act> & { payload?: Record<string, unknown> } = {}): Act => ({
  id: `22222222-0000-4000-8000-${String(++n).padStart(12, '0')}`, character: '33333333-0000-4000-8000-000000000001', kind: 'card', thread: '44444444-0000-4000-8000-000000000001',
  targetActId: POST, seq: null, createdAt: '2026-10-29T21:16:00.000Z', payload: { card: 'whoops', layer: 1, message: 'oops', config: { color: '#ff3d7f', seed: 7 } },
  currentPayload: {}, editedAt: null, shownEditedAt: null, ...over,
});

describe('a play, read from its card Act', () => {
  test('holds the card, its layer (1 where a play written before layers has none), the caster\'s words and the server\'s config', () => {
    const act = card();
    expect(playOf(act)).toEqual({ id: act.id, card: 'whoops', layer: 1, caster: act.character, message: 'oops', config: { color: '#ff3d7f', seed: 7 }, playedAt: act.createdAt, post: POST });
    expect(playOf(card({ payload: { card: 'stick-around' } }))).toMatchObject({ layer: 1, message: '', config: {} });
    expect(playOf(card({ payload: { card: 'whoops', layer: 0 } }))?.layer).toBe(1);
    expect(playOf(card({ payload: { card: 'whoops', config: [1] } }))?.config).toEqual({});
  });
  test('is nothing for an Act that is no card, a card with no card in it, or one with no post', () => {
    expect(playOf(card({ kind: 'post' }))).toBeNull();
    expect(playOf(card({ payload: {} }))).toBeNull();
    expect(playOf(card({ targetActId: null }))).toBeNull();
  });
  test('is ordered by layer, then when it was played, then its id', () => {
    const a = playOf(card({ payload: { card: 'whoops', layer: 2 }, createdAt: '2026-10-29T21:00:00.000Z' }))!;
    const b = playOf(card({ payload: { card: 'whoops', layer: 1 }, createdAt: '2026-10-29T22:00:00.000Z' }))!;
    const c = playOf(card({ payload: { card: 'stick-around', layer: 1 }, createdAt: '2026-10-29T21:00:00.000Z' }))!;
    expect([a, b, c].sort(inPlayOrder).map((p) => p.id)).toEqual([c.id, b.id, a.id]);
  });
});

describe('the store', () => {
  test('keeps each post\'s plays in play order, once each however many times they arrive, and ignores what is no play', () => {
    const plays = createPlays();
    const late = card({ createdAt: '2026-10-29T22:00:00.000Z' });
    const early = card({ payload: { card: 'stick-around' }, createdAt: '2026-10-29T21:00:00.000Z' });
    expect(plays.add([late, early, late, card({ kind: 'post' })])).toBe(true);
    expect(plays.add([late])).toBe(false);
    expect(plays.get(POST).plays.map((p) => p.id)).toEqual([early.id, late.id]);
    expect(plays.get(OTHER).plays).toEqual([]);
  });

  test('wakes only the post a change belongs to, and hands the same snapshot until something changes', () => {
    const plays = createPlays();
    const here = vi.fn();
    const there = vi.fn();
    plays.subscribe(POST, here);
    plays.subscribe(OTHER, there);
    const first = card();
    plays.add([first]);
    expect(here).toHaveBeenCalledTimes(1);
    expect(there).not.toHaveBeenCalled();
    expect(plays.get(POST)).toBe(plays.get(POST));
    const before = plays.get(POST);
    plays.setReleased([first.id]);
    expect(plays.get(POST)).not.toBe(before);
    expect(here).toHaveBeenCalledTimes(2);
    plays.setReleased([first.id]);
    expect(here).toHaveBeenCalledTimes(2);
  });

  test('keeps each play\'s newest saved state, whatever order they arrive in, and one for a play it has not met yet until it does', () => {
    const plays = createPlays();
    const first = card();
    const ahead = '55555555-0000-4000-8000-000000000001';
    plays.add([first]);
    expect(plays.setStates({ [first.id]: { state: { v: 2 }, savedAt: '2026-10-29T21:20:00.000Z' } })).toBe(true);
    expect(plays.setStates({ [first.id]: { state: { v: 1 }, savedAt: '2026-10-29T21:10:00.000Z' } })).toBe(false);
    expect(plays.get(POST).states[first.id]).toEqual({ state: { v: 2 }, savedAt: '2026-10-29T21:20:00.000Z' });
    plays.setStates({ [ahead]: { state: { v: 9 }, savedAt: '2026-10-29T21:20:00.000Z' } });
    plays.add([card({ id: ahead })]);
    expect(plays.get(POST).states[ahead]?.state).toEqual({ v: 9 });
    expect(plays.get(POST).released.size).toBe(0);
  });
});

test('only the cards the instance draws an effect for have a state to read', () => {
  const ui = { cards: [{ key: 'a', Effect: () => null }, { key: 'b' }] } as unknown as Parameters<typeof effectCards>[0];
  expect([...effectCards(ui)]).toEqual(['a']);
});
