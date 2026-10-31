/**
 * The store of the card plays on the posts on screen: a play read from its card Act, laid over its
 * post in play order, with the post author's newest saved state and the reader's releases, and each
 * change heard by the post it belongs to alone.
 */
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../data/api.ts';
import type { ActKind } from '../data/api.ts';
import { createPlays, effectCards, holdsEffects, inPlayOrder, playOf } from './plays.ts';

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

describe('the kinds of Act that hold a card\'s effect', () => {
  test('are the ones drawn as words: not a card, an unmask, a tally or a reveal', () => {
    const kinds: Record<ActKind, boolean> = { post: true, spin: true, edit: true, card: false, unmask: false, tally: false, reveal: false };
    for (const [kind, held] of Object.entries(kinds)) expect(holdsEffects(kind as ActKind), kind).toBe(held);
  });
});

describe('billing, in the store', () => {
  test('a post\'s billing is the order set, kept as it is set, and its plays are given in that order as `billed` while `plays` stays in play order', () => {
    const plays = createPlays();
    const a = card({ createdAt: '2026-10-29T21:00:00.000Z' });
    const b = card({ createdAt: '2026-10-29T21:05:00.000Z' });
    const c = card({ createdAt: '2026-10-29T21:10:00.000Z' });
    plays.add([a, b, c]);
    plays.setBilling(POST, [b.id, c.id, a.id]);
    expect(plays.billing(POST)).toEqual([b.id, c.id, a.id]);
    expect(plays.get(POST).billed.map((p) => p.id)).toEqual([b.id, c.id, a.id]);
    expect(plays.get(POST).plays.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
  });

  test('a play added later is billed last, and a new billing sets the order again', () => {
    const plays = createPlays();
    const a = card({ createdAt: '2026-10-29T21:00:00.000Z' });
    const b = card({ createdAt: '2026-10-29T21:05:00.000Z' });
    plays.add([a, b]);
    plays.setBilling(POST, [b.id, a.id]);
    const early = card({ createdAt: '2026-10-29T20:00:00.000Z' });
    plays.add([early]);
    expect(plays.get(POST).billed.map((p) => p.id)).toEqual([b.id, a.id, early.id]);
    plays.setBilling(POST, [early.id, a.id, b.id]);
    expect(plays.get(POST).billed.map((p) => p.id)).toEqual([early.id, a.id, b.id]);
  });

  test('a billing that leaves a play out keeps it after the ones it names, and one naming no play of the post\'s is ignored', () => {
    const plays = createPlays();
    const a = card({ createdAt: '2026-10-29T21:00:00.000Z' });
    const b = card({ createdAt: '2026-10-29T21:05:00.000Z' });
    plays.add([a, b]);
    plays.setBilling(POST, [b.id, '55555555-0000-4000-8000-000000000009']);
    expect(plays.get(POST).billed.map((p) => p.id)).toEqual([b.id, a.id]);
  });

  test('setting a billing wakes only its post, and the same billing again wakes nothing', () => {
    const plays = createPlays();
    const a = card();
    const b = card();
    plays.add([a, b]);
    const here = vi.fn();
    const there = vi.fn();
    plays.subscribe(POST, here);
    plays.subscribe(OTHER, there);
    plays.setBilling(POST, [b.id, a.id]);
    expect(here).toHaveBeenCalledTimes(1);
    plays.setBilling(POST, [b.id, a.id]);
    expect(here).toHaveBeenCalledTimes(1);
    expect(there).not.toHaveBeenCalled();
  });
});

describe('notes, in the store', () => {
  test('a card\'s line about a play is kept by the play, and cleared with null', () => {
    const plays = createPlays();
    const a = card();
    plays.add([a]);
    expect(plays.note(a.id)).toBeNull();
    plays.setNote(a.id, 'Layer 1 of 1, on top · 40% washed');
    expect(plays.note(a.id)).toBe('Layer 1 of 1, on top · 40% washed');
    plays.setNote(a.id, null);
    expect(plays.note(a.id)).toBeNull();
  });

  test('setting one wakes that post\'s listener and no other\'s, leaves the post\'s snapshot as it was, and the same line again wakes nothing', () => {
    const plays = createPlays();
    const a = card();
    const b = card({ targetActId: OTHER });
    plays.add([a, b]);
    const here = vi.fn();
    const there = vi.fn();
    plays.subscribe(POST, here);
    plays.subscribe(OTHER, there);
    const before = plays.get(POST);
    plays.setNote(a.id, 'Washed clean');
    expect(here).toHaveBeenCalledTimes(1);
    expect(there).not.toHaveBeenCalled();
    /* The effects read the snapshot: a note is the panel's, so a wash that writes one draws no effect again. */
    expect(plays.get(POST)).toBe(before);
    plays.setNote(a.id, 'Washed clean');
    expect(here).toHaveBeenCalledTimes(1);
  });
});
