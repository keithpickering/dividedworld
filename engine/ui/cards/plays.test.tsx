/**
 * The store of the card plays on the posts on screen: a play read from its card Act, laid over its
 * post in play order, with the post author's newest saved state and the reader's releases, and each
 * change heard by the post it belongs to alone.
 */
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../data/api.ts';
import type { ActKind } from '../data/api.ts';
import { createPlays, defaultView, effectCards, holdsEffects, inPlayOrder, playOf } from './plays.ts';
import type { CardView } from './types.ts';

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

  test('setting a billing wakes only its post, and each is a new read of it, the same order again included', () => {
    const plays = createPlays();
    const a = card();
    const b = card();
    plays.add([a, b]);
    const here = vi.fn();
    const there = vi.fn();
    plays.subscribe(POST, here);
    plays.subscribe(OTHER, there);
    expect(plays.get(POST).read).toBe(0);
    plays.setBilling(POST, [b.id, a.id]);
    expect(here).toHaveBeenCalledTimes(1);
    expect(plays.get(POST).read).toBe(1);
    plays.setBilling(POST, [b.id, a.id]);
    expect(here).toHaveBeenCalledTimes(2);
    expect(plays.get(POST).read).toBe(2);
    expect(there).not.toHaveBeenCalled();
  });
});

const view = (over: Partial<CardView> = {}): CardView => ({ progress: null, state: '18% washed', yours: false, controls: [], notes: {}, ...over });

describe('views, in the store', () => {
  test('a card\'s view on a post is kept by the post and card, and cleared with null', () => {
    const plays = createPlays();
    expect(plays.view(POST, 'whoops')).toBeNull();
    plays.setView(POST, 'whoops', view());
    expect(plays.view(POST, 'whoops')).toEqual(view());
    expect(plays.view(POST, 'stick-around')).toBeNull();
    plays.setView(POST, 'whoops', null);
    expect(plays.view(POST, 'whoops')).toBeNull();
  });

  test('a view set for one card wakes that post\'s listener and no other post\'s, and leaves the post\'s snapshot as it was', () => {
    const plays = createPlays();
    plays.add([card(), card({ targetActId: OTHER })]);
    const here = vi.fn();
    const there = vi.fn();
    plays.subscribe(POST, here);
    plays.subscribe(OTHER, there);
    const before = plays.get(POST);
    plays.setView(POST, 'whoops', view());
    expect(here).toHaveBeenCalledTimes(1);
    expect(there).not.toHaveBeenCalled();
    expect(plays.get(POST)).toBe(before);
  });

  test('an equal view wakes nothing: its notes by entry, its controls control by control', () => {
    const plays = createPlays();
    const run = () => {};
    plays.setView(POST, 'whoops', view({ notes: { a: 'x' }, controls: [{ kind: 'press', label: 'Go', run }] }));
    const here = vi.fn();
    plays.subscribe(POST, here);
    plays.setView(POST, 'whoops', view({ notes: { a: 'x' }, controls: [{ kind: 'press', label: 'Go', run }] }));
    plays.setView(POST, 'whoops', null);
    expect(here).toHaveBeenCalledTimes(1);
    plays.setView(POST, 'whoops', null);
    expect(here).toHaveBeenCalledTimes(1);
    plays.setView(POST, 'whoops', view({ notes: { a: 'x' } }));
    plays.setView(POST, 'whoops', view({ notes: { a: 'y' } }));
    expect(here).toHaveBeenCalledTimes(3);
  });

  test('a view that differs in any field wakes and replaces the one held, a control by its function as well as its words', () => {
    const plays = createPlays();
    const run = () => {};
    const base = view({ progress: 0.2, ends: 'Ends', yours: false, report: undefined, controls: [{ kind: 'choose', label: 'Tool', value: 'wash', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Ink' }], choose: run }] });
    plays.setView(POST, 'whoops', base);
    const here = vi.fn();
    plays.subscribe(POST, here);
    /* The same options by content, in a fresh array, is the same view. */
    plays.setView(POST, 'whoops', { ...base, controls: [{ kind: 'choose', label: 'Tool', value: 'wash', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Ink' }], choose: run }] });
    expect(here).toHaveBeenCalledTimes(0);
    const changes: Partial<CardView>[] = [
      { progress: 0.3 }, { progress: null }, { ends: 'Never' }, { yours: true }, { report: 'Not saved' }, { state: 'Washed' },
      { controls: [{ kind: 'choose', label: 'Tool', value: 'ink', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Ink' }], choose: run }] },
      { controls: [{ kind: 'choose', label: 'Tool', value: 'wash', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'In ink' }], choose: run }] },
      { controls: [{ kind: 'choose', label: 'Tool', value: 'wash', options: [{ value: 'wash', label: 'Wash' }, { value: 'ink', label: 'Ink' }], choose: () => {} }] },
    ];
    for (const [i, change] of changes.entries()) {
      here.mockClear();
      const next = { ...base, ...change };
      plays.setView(POST, 'whoops', next);
      expect(here, `change ${i}`).toHaveBeenCalledTimes(1);
      expect(plays.view(POST, 'whoops')).toBe(next);
      plays.setView(POST, 'whoops', base);
      here.mockClear();
    }
  });

  test('a progress the card could not compute does not wake on every frame', () => {
    const plays = createPlays();
    plays.setView(POST, 'whoops', view({ progress: Number.NaN }));
    const here = vi.fn();
    plays.subscribe(POST, here);
    plays.setView(POST, 'whoops', view({ progress: Number.NaN }));
    expect(here).not.toHaveBeenCalled();
  });

  test('changing one card\'s view leaves another card\'s view, and its notes, on the same post untouched, with no frame in which it is absent', () => {
    const plays = createPlays();
    const stick = view({ state: 'Held', notes: { p1: 'Layer 1 of 1' } });
    plays.setView(POST, 'stick-around', stick);
    plays.setView(POST, 'whoops', view());
    const seen: (CardView | null)[] = [];
    plays.subscribe(POST, () => seen.push(plays.view(POST, 'stick-around')));
    plays.setView(POST, 'whoops', view({ state: '40% washed' }));
    plays.setView(POST, 'whoops', null);
    expect(seen).toHaveLength(2);
    expect(seen.every((v) => v === stick)).toBe(true);
    expect(plays.view(POST, 'stick-around')).toBe(stick);
  });
});

describe('the default view', () => {
  const rules = { name: 'Whoops!' };
  const settings = {} as never;
  test('says the card\'s summary, with no edge, notch or controls', () => {
    expect(defaultView(rules, { summary: 'Splats ink on a post.', describe: () => 'Splats ink. Costs 2.' }, settings)).toEqual({ progress: null, state: 'Splats ink on a post.', yours: false, controls: [], notes: {} });
  });
  test('says the first sentence of what the card describes when it gives no summary', () => {
    expect(defaultView(rules, { describe: () => 'Splats ink on a post. It costs 2 and washes off.' }, settings).state).toBe('Splats ink on a post.');
    expect(defaultView(rules, { describe: () => 'No full stop here' }, settings).state).toBe('No full stop here');
  });
  test('falls back to the card\'s name where there is nothing to say it with', () => {
    expect(defaultView(rules, undefined).state).toBe('Whoops!');
  });
});
