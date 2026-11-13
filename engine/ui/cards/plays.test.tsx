/**
 * The store of the card plays on the posts on screen: a play read from its card Act, laid over its
 * post in play order, with the post author's newest saved state and the reader's releases, and each
 * change heard by the post it belongs to alone.
 */
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../data/api.ts';
import type { ActKind } from '../data/api.ts';
import { localKey } from '../../rules/emoji.ts';
import { backoff, REPEAT_TRIES } from './tails.ts';
import { blindPlaysOf, CARD_BACK, createPlays, defaultView, effectCards, holdsEffects, hydrate, readSurface, rereadSurfaces, inPlayOrder, isBack, livePlays, localKindsOf, stackPlays, markedPlays, playOf, playsFallingOn, shownPlays } from './plays.ts';
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

  test('carries the plate the server drew, when the payload has one', () => {
    expect(playOf(card({ payload: { card: 'jimmy-wails', drawn: 'close-up' } }))?.drawn).toBe('close-up');
    expect(playOf(card({ payload: { card: 'jimmy-wails', drawn: 3 } }))).not.toHaveProperty('drawn');
    expect(playOf(card({ payload: { card: 'whoops' } }))).not.toHaveProperty('drawn');
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
  test('are the ones drawn as words: not a card, an unmask, an announcement, a tally, a reveal, a move, the end of one, a Boss keeping one, a card back, a take-back, a spring or an update', () => {
    const kinds: Record<ActKind, boolean> = { post: true, spin: true, edit: true, card: false, unmask: false, announce: false, tally: false, reveal: false, move: false, move_end: false, move_keep: false, set: false, take_back: false, spring: false, update: false, card_end: false, visit: false, visit_join: false, visit_end: false, report: false, report_verdict: false, intercept: false, infraction: false, ban: false, appeal: false, appeal_ruling: false, donation: false, draw: false, wash: false };
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
  test('says the card\'s status in place of its summary, from the plays it has when the status is a function of them', () => {
    expect(defaultView(rules, { status: 'Sparkling every post by that character', summary: 'Cast on a character.', describe: () => 'x' }, settings).state).toBe('Sparkling every post by that character');
    const stacked = { status: (plays: readonly unknown[]) => `${plays.length} of 3 stacked`, describe: () => 'x' };
    expect(defaultView(rules, stacked, settings, undefined, [{}, {}] as never).state).toBe('2 of 3 stacked');
    expect(defaultView(rules, stacked, settings).state).toBe('0 of 3 stacked');
  });
  test('gives a play that ends on a timer an ends, "Ends Nov 7, 9:14 PM", in the reader\'s zone', () => {
    expect(process.env.TZ).toBe('America/Los_Angeles');
    const view = defaultView(rules, { status: 'Pinned', describe: () => 'x' }, settings, '2026-11-08T05:14:00.000Z');
    expect(view.ends).toMatch(/^Ends Nov 7, 9:14\sPM$/u);
    expect(defaultView(rules, { status: 'Pinned', describe: () => 'x' }, settings).ends).toBeUndefined();
  });
  test('falls back to the card\'s name where there is nothing to say it with', () => {
    expect(defaultView(rules, undefined).state).toBe('Whoops!');
  });
});

/* The card mechanic's plays (docs/plans/2026-11-01-card-plays-plan.md, Task 7): a card back, a spring that reveals it in place, a
   caught play and a Use's end, as the store keeps them. */
describe('card backs, springs and catches', () => {
  const at = '2026-10-30T10:00:00.000Z';
  const base = (id: string, kind: Act['kind'], payload: Record<string, unknown>, target = 'p1'): Act =>
    ({ id, kind, character: 'c1', thread: 't', targetActId: target, seq: null, createdAt: at, payload, currentPayload: payload, editedAt: null, shownEditedAt: null });

  test('a set Act is a card back: the engine\'s own kind, naming no card', () => {
    const play = playOf(base('s1', 'set', {}))!;
    expect([play.card, play.faceDown, play.revealed]).toEqual([CARD_BACK, true, undefined]);
  });

  test('a spring reveals the back in place: the same play, the same billing, the card it was', () => {
    const plays = createPlays();
    plays.add([base('k1', 'card', { card: 'whoops', layer: 1 }), base('s1', 'set', {})]);
    plays.setBilling('p1', ['s1', 'k1']);
    plays.add([base('sp', 'spring', { card: 'snare', trigger: 'cast', outcome: { do: 'payout' }, set: 's1', by: 'k2', caught: 'k2' })]);
    const got = plays.get('p1');
    expect(got.billed.map((p) => [p.id, p.card, p.revealed?.card])).toEqual([['s1', `${CARD_BACK}:sp`, 'snare'], ['k1', 'whoops', undefined]]);
    expect(got.billed[0]!.revealed?.spring).toBe('sp');
  });

  test('a take-back ends the back in place, and one that arrives before its back keeps it', () => {
    const plays = createPlays();
    plays.add([base('s1', 'set', {})]);
    plays.add([base('tb', 'take_back', { set: 's1' })]);
    expect(plays.get('p1').plays[0]!.takenBack).toEqual({ at });
    expect(plays.get('p1').plays).toHaveLength(1);
    const early = createPlays();
    early.add([base('tb', 'take_back', { set: 's2' })]);
    early.add([base('s2', 'set', {})]);
    expect(early.get('p1').plays[0]!.takenBack).toEqual({ at });
  });

  test('a spring that arrives before its back keeps it, and a back that arrives after is revealed', () => {
    const plays = createPlays();
    plays.add([base('sp', 'spring', { card: 'snare', trigger: 'cast', outcome: { do: 'nullify' }, set: 's1' })]);
    plays.add([base('s1', 'set', {})]);
    expect(plays.get('p1').plays[0]!.revealed?.card).toBe('snare');
  });

  test('a caught play names the set that caught it, and a Use its end', () => {
    expect(playOf(base('k1', 'card', { card: 'whoops', caught: 's1' }))!.caught).toBe('s1');
    expect(playOf(base('u1', 'card', { card: 'shield', layer: 1, ends: '2026-11-06T10:00:00.000Z' }))!.ends).toBe('2026-11-06T10:00:00.000Z');
  });

  test('a cast that rode a ride back names the set, a scored-as play its start, and a ride spring shows its quadrant either side of its back', () => {
    expect(playOf(base('k1', 'card', { card: 'whoops', rode: 's1' }))!.rode).toBe('s1');
    expect(playOf(base('k1', 'card', { card: 'whoops', rode: 7 }))!.rode).toBeUndefined();
    expect(playOf(base('o1', 'card', { card: 'off-day', starts: '2026-11-12T00:00:00.000Z' }))!.starts).toBe('2026-11-12T00:00:00.000Z');
    expect(playOf(base('o1', 'card', { card: 'off-day', starts: 5 }))!.starts).toBeUndefined();
    const spring = { card: 'chess', trigger: 'cast', did: 'rode', quadrant: 'excitedPositive', set: 's1', by: 'k2' };
    const after = createPlays();
    after.add([base('s1', 'set', {}), base('sp', 'spring', spring)]);
    expect(after.get('p1').plays[0]!.revealed).toEqual({ card: 'chess', spring: 'sp', at, quadrant: 'excitedPositive' });
    const before = createPlays();
    before.add([base('sp', 'spring', spring)]);
    before.add([base('s1', 'set', {})]);
    expect(before.get('p1').plays[0]!.revealed?.quadrant).toBe('excitedPositive');
    const numeric = createPlays();
    numeric.add([base('s1', 'set', {}), base('sp', 'spring', { ...spring, quadrant: 7 })]);
    expect(numeric.get('p1').plays[0]!.revealed).toEqual({ card: 'chess', spring: 'sp', at });
    expect(numeric.get('p1').plays[0]!.revealed).not.toHaveProperty('quadrant');
    const caught = createPlays();
    caught.add([base('s1', 'set', {}), base('sp', 'spring', { card: 'snare', trigger: 'cast', did: 'caught', set: 's1', by: 'k2', caught: 'k2' })]);
    expect(caught.get('p1').plays[0]!.revealed).toEqual({ card: 'snare', spring: 'sp', at });
  });

  test('the setter\'s own card is kept for their screen alone, beside the back', () => {
    const plays = createPlays();
    plays.add([base('s1', 'set', {})]);
    plays.setFaces({ s1: 'dud' });
    expect(plays.get('p1').faces).toEqual({ s1: 'dud' });
  });
});

describe('a back that sprang, and a new back set on the same post', () => {
  const at = '2026-10-30T10:00:00.000Z';
  const base = (id: string, kind: Act['kind'], payload: Record<string, unknown>): Act =>
    ({ id, kind, character: 'c1', thread: 't', targetActId: 'p1', seq: null, createdAt: at, payload, currentPayload: payload, editedAt: null, shownEditedAt: null });
  test('are two kinds: the sprung back its own, so the live one is never drawn or named as the card that sprang', () => {
    const plays = createPlays();
    plays.add([base('s1', 'set', {}), base('sp', 'spring', { card: 'snare', trigger: 'cast', outcome: { do: 'nullify' }, set: 's1' }), base('s2', 'set', {})]);
    const kinds = [...new Set(plays.get('p1').billed.map((p) => p.card))];
    expect(kinds).toHaveLength(2);
    expect(kinds.every((k) => isBack(k))).toBe(true);
    expect(plays.get('p1').billed.find((p) => p.id === 's2')!.card).toBe(CARD_BACK);
  });
  test('a back whose time has passed with nothing springing it is no longer shown', () => {
    const backs = [{ ...playOf(base('s1', 'set', {}))!, playedAt: '2020-01-01T00:00:00.000Z', endsAt: '2020-01-08T00:00:00.000Z' }, { ...playOf(base('s2', 'set', {}))!, playedAt: new Date().toISOString(), endsAt: '2999-01-01T00:00:00.000Z' }];
    expect(shownPlays(backs, Date.now()).map((p) => p.id)).toEqual(['s2']);
  });
  test('a back is over at the end the server stored, whatever the setting says', () => {
    const day = 86_400_000;
    const backs = [
      { ...playOf(base('s1', 'set', {}))!, playedAt: new Date(Date.now() - 10 * day).toISOString(), endsAt: new Date(Date.now() + 20 * day).toISOString() },
      { ...playOf(base('s2', 'set', {}))!, playedAt: new Date(Date.now() - 1 * day).toISOString(), endsAt: new Date(Date.now() - day / 2).toISOString() },
    ];
    expect(shownPlays(backs, Date.now()).map((p) => p.id)).toEqual(['s1']);
  });
  test('a set Act carries its end onto its play, and a card Act has none', () => {
    expect(playOf({ ...base('s1', 'set', {}), endsAt: '2026-11-20T00:00:00.000Z' })!.endsAt).toBe('2026-11-20T00:00:00.000Z');
    expect(playOf(base('s1', 'set', {}))!.endsAt).toBeNull();
    expect(playOf(base('c1', 'card', { card: 'blot' }))!.endsAt).toBeUndefined();
  });
  test('a back its setter took back leaves the post: it is not shown', () => {
    const now = new Date().toISOString();
    const backs = [{ ...playOf(base('s1', 'set', {}))!, playedAt: now, takenBack: { at: now } }, { ...playOf(base('s2', 'set', {}))!, playedAt: now }];
    expect(shownPlays(backs, Date.now()).map((p) => p.id)).toEqual(['s2']);
  });
});

/* An admin's end of a play (supabase/migrations/0092_card_end.sql): a card_end Act names its play and marks it reversed, whichever arrives first. */
describe('a play an admin ended', () => {
  const at = '2026-10-30T10:00:00.000Z';
  const act = (id: string, kind: Act['kind'], payload: Record<string, unknown>, target: string | null = 'p1'): Act =>
    ({ id, kind, character: kind === 'card_end' ? null : 'c1', thread: 't', targetActId: target, seq: null, createdAt: at, payload, currentPayload: payload, editedAt: null, shownEditedAt: null });
  const end = (play: string) => act(`end-${play}`, 'card_end', { why: 'reversed', by: 'admin' }, play);

  test('a card_end after its play marks it reversed in place, and waking only its post', () => {
    const plays = createPlays();
    const heard = vi.fn();
    plays.add([act('k1', 'card', { card: 'whoops' }), act('k2', 'card', { card: 'whoops' })]);
    plays.setBilling('p1', ['k2', 'k1']);
    plays.subscribe('p1', heard);
    expect(plays.add([end('k1')])).toBe(true);
    const got = plays.get('p1');
    expect(got.billed.map((p) => [p.id, p.reversed])).toEqual([['k2', undefined], ['k1', true]]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(livePlays(got.plays, Date.now()).map((p) => p.id)).toEqual(['k2']);
  });

  test('a card_end that arrives before its play is held, and the play arrives reversed', () => {
    const plays = createPlays();
    plays.add([end('k1')]);
    expect(plays.get('p1').plays).toEqual([]);
    plays.add([act('k1', 'card', { card: 'whoops' })]);
    expect(plays.get('p1').plays.map((p) => p.reversed)).toEqual([true]);
    expect(livePlays(plays.get('p1').plays, Date.now())).toEqual([]);
  });

  test('the same end again changes nothing, and an end is no play of its own', () => {
    const plays = createPlays();
    plays.add([act('k1', 'card', { card: 'whoops' }), end('k1')]);
    const before = plays.get('p1');
    expect(plays.add([end('k1')])).toBe(false);
    expect(plays.get('p1')).toBe(before);
    expect(playOf(end('k1'))).toBeNull();
  });

  test('a play beyond a post that was ended is dropped from the marks too; one on a post stays for the Lens to say so', () => {
    const post = playOf(act('k1', 'card', { card: 'whoops' }))!;
    const beyond = playOf(act('k2', 'card', { card: 'sparkly', reach: 'thread', thread: 'th', ends: '2099-01-01T00:00:00.000Z' }, 'p1'))!;
    const ended = [{ ...post, reversed: true as const }, { ...beyond, reversed: true as const }];
    expect(livePlays(ended, Date.now())).toEqual([]);
    expect(markedPlays(ended, Date.now()).map((p) => p.id)).toEqual(['k1']);
  });
});

/* A play above the posts that a later read of its page no longer holds was ended with no `card_end` to say so: the screen ends it by absence. */
describe('a play ended by being absent from a page read again', () => {
  const at = '2026-10-30T10:00:00.000Z';
  const card = (id: string): Act =>
    ({ id, kind: 'card', character: 'c1', thread: 't', targetActId: 'p1', seq: null, createdAt: at, payload: { card: 'whoops' }, currentPayload: { card: 'whoops' }, editedAt: null, shownEditedAt: null });

  test('marks a held play reversed in place, waking only its post, and says so', () => {
    const plays = createPlays();
    const heard = vi.fn();
    plays.add([card('k1'), card('k2')]);
    plays.subscribe('p1', heard);
    expect(plays.setEnded(['k1'])).toBe(true);
    expect(plays.get('p1').billed.map((p) => [p.id, p.reversed])).toEqual([['k1', true], ['k2', undefined]]);
    expect(livePlays(plays.get('p1').plays, Date.now()).map((p) => p.id)).toEqual(['k2']);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('remembers a play not held yet, which arrives reversed, as an early card_end does', () => {
    const plays = createPlays();
    expect(plays.setEnded(['k1'])).toBe(true);
    expect(plays.get('p1').plays).toEqual([]);
    plays.add([card('k1')]);
    expect(plays.get('p1').plays.map((p) => p.reversed)).toEqual([true]);
  });

  test('says nothing changed for a play already ended, or for nothing', () => {
    const plays = createPlays();
    plays.add([card('k1')]);
    expect(plays.setEnded(['k1'])).toBe(true);
    const before = plays.get('p1');
    expect(plays.setEnded(['k1'])).toBe(false);
    expect(plays.setEnded([])).toBe(false);
    expect(plays.get('p1')).toBe(before);
  });
});

/* A play whose first generation failed is refunded and over (0149): the read says so (`untaken` on its Act), and the client reads the flag, never works it out. */
describe('a play that did not take', () => {
  const at = '2026-10-30T10:00:00.000Z';
  const act = (id: string, over: Partial<Act> = {}): Act =>
    ({ id, kind: 'card', character: 'c1', thread: 't', targetActId: 'p1', seq: null, createdAt: at, payload: { card: 'whoops' }, currentPayload: { card: 'whoops' }, editedAt: null, shownEditedAt: null, ...over });

  test('the flag on the Act is on the play, and a play without it has none', () => {
    expect(playOf(act('k1', { untaken: true }))?.untaken).toBe(true);
    expect(playOf(act('k2'))).not.toHaveProperty('untaken');
  });

  test('it is not live: left out of what a post carries, though it stays among the post\'s plays and its marks for the Lens to say so', () => {
    const plays = createPlays();
    plays.add([act('k1'), act('k2', { untaken: true }), act('k3')]);
    const got = plays.get('p1');
    expect(got.plays.map((p) => p.id)).toEqual(['k1', 'k2', 'k3']);
    expect(livePlays(got.plays, Date.now()).map((p) => p.id)).toEqual(['k1', 'k3']);
    expect(markedPlays(got.plays, Date.now()).map((p) => p.id)).toEqual(['k1', 'k2', 'k3']);
  });
});

describe('a cast on a post that has a time (card notes, Part 3)', () => {
  const ended = card({ payload: { card: 'whodunnit', layer: 1, message: '', config: {}, ends: '2026-10-30T00:00:00.000Z' } });
  const after = Date.parse('2026-10-31T00:00:00.000Z');

  test('is kept once its time has passed, in force and marked, so its effect is still drawn and reads `ends`', () => {
    const play = playOf(ended)!;
    expect(play.ends).toBe('2026-10-30T00:00:00.000Z');
    expect(livePlays([play], after)).toEqual([play]);
    expect(markedPlays([play], after)).toEqual([play]);
  });

  const cards = [{ key: 'overreaction', reaction: true as const }, { key: 'blind-study', veil: 'totals' as const }, { key: 'whodunnit', veil: 'author' as const }, { key: 'whoops' }];
  const skull = (over: Record<string, unknown> = {}) => playOf(card({ payload: { card: 'overreaction', layer: 1, message: '', config: { emoji: '\u{1F480}', quadrant: 'excitedPositive' }, ...over } }))!;

  test('a reaction card\'s play adds its kind: the key from the emoji, the quadrant, and whether an admin ended it', () => {
    expect(localKindsOf([skull()], cards)).toEqual([{ key: localKey('\u{1F480}'), emoji: '\u{1F480}', quadrant: 'excitedPositive', play: expect.any(String), ended: false }]);
    expect(localKindsOf([{ ...skull(), reversed: true }], cards)[0]!.ended).toBe(true);
  });

  test('a play that was caught, did not take, holds no one emoji or no quadrant, or is of another card adds none; the same emoji twice is one kind', () => {
    expect(localKindsOf([skull({ caught: 'set' }), { ...skull(), untaken: true }, skull({ config: { emoji: 'ab', quadrant: 'excitedPositive' } }), skull({ config: { emoji: '\u{1F480}', quadrant: 'sideways' } })], cards)).toEqual([]);
    expect(localKindsOf([playOf(card())!], cards)).toEqual([]);
    expect(localKindsOf([skull(), skull()], cards)).toHaveLength(1);
  });

  test('a totals veil hides the totals while its time is ahead and it stands; no other card does', () => {
    const blind = playOf(card({ payload: { card: 'blind-study', layer: 1, message: '', config: {}, ends: '2026-10-30T00:00:00.000Z' } }))!;
    const before = Date.parse('2026-10-29T22:00:00.000Z');
    expect(blindPlaysOf([blind], cards, before)).toEqual([{ play: blind.id, caster: blind.caster, ends: '2026-10-30T00:00:00.000Z' }]);
    expect(blindPlaysOf([blind], cards, after)).toEqual([]);
    expect(blindPlaysOf([{ ...blind, reversed: true }], cards, before)).toEqual([]);
    expect(blindPlaysOf([playOf(ended)!], cards, before)).toEqual([]);
  });
});

/* A surface (0317): what the page's read carries of it is its covered cells and its live Acts' ids; the live Acts' own words are read where a wall is near. */
describe('a surface, in the store', () => {
  const wall = 'k-wall';
  const drawn = (id: string): Act => ({ id, kind: 'draw', character: 'c1', thread: 't', targetActId: wall, seq: null, createdAt: '2026-10-30T10:00:00.000Z', payload: { strokes: [], cells: '0'.repeat(10000) }, currentPayload: {}, editedAt: null, shownEditedAt: null });
  const play = (): Act => card({ id: wall, payload: { card: 'slab', layer: 1, message: '', config: {} } });

  test('hydrate carries the page\'s surfaces: the cells covered and the live ids, with no Acts read yet', () => {
    const plays = createPlays();
    hydrate(plays, [play()], {}, [], {}, { [wall]: { covered: 120, live: ['d1', 'd2'] } });
    expect(plays.get(POST).surfaces).toEqual({ [wall]: { covered: 120, live: ['d1', 'd2'], acts: null } });
  });

  test('a surface for a play not here yet is kept for when it is, and a later page\'s numbers replace the earlier\'s', () => {
    const plays = createPlays();
    plays.setSurfaces({ [wall]: { covered: 5, live: ['d1'] } });
    expect(plays.get(POST).surfaces).toEqual({});
    plays.add([play()]);
    expect(plays.get(POST).surfaces[wall]).toMatchObject({ covered: 5, live: ['d1'] });
    plays.setSurfaces({ [wall]: { covered: 9, live: ['d1', 'd2'] } });
    expect(plays.get(POST).surfaces[wall]).toMatchObject({ covered: 9, live: ['d1', 'd2'] });
  });

  test('a change to a surface wakes its post alone, and the same again wakes none', () => {
    const plays = createPlays();
    plays.add([play()]);
    const here = vi.fn();
    const there = vi.fn();
    plays.subscribe(POST, here);
    plays.subscribe(OTHER, there);
    plays.setSurfaces({ [wall]: { covered: 5, live: [] } });
    expect(here).toHaveBeenCalledTimes(1);
    plays.setSurfaces({ [wall]: { covered: 5, live: [] } });
    expect(here).toHaveBeenCalledTimes(1);
    expect(there).not.toHaveBeenCalled();
  });

  test('a surface\'s Acts are read once when asked for, and again on a change; a play never asked for is never read', async () => {
    const plays = createPlays();
    plays.add([play()]);
    const surfaceActs = vi.fn(async () => ({ covered: 7, acts: [drawn('d1')], older: 0 }));
    const api = { surfaceActs } as never;
    expect(plays.wantSurface(wall)).toBe(true);
    expect(plays.wantSurface(wall)).toBe(false);
    await readSurface(api, plays, wall);
    expect(surfaceActs).toHaveBeenCalledWith(wall);
    expect(plays.get(POST).surfaces[wall]).toMatchObject({ covered: 7, acts: [expect.objectContaining({ id: 'd1' })] });
    expect(plays.wantsSurface(wall)).toBe(true);
    expect(plays.wantsSurface('other-wall')).toBe(false);
  });

  test('a read that fails leaves the surface as it was, keeps the want, and is tried again after the backoff until it lands', async () => {
    vi.useFakeTimers();
    try {
      const plays = createPlays();
      plays.add([play()]);
      expect(plays.wantSurface(wall)).toBe(true);
      const surfaceActs = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ covered: 3, acts: [drawn('d1')], older: 0 });
      await readSurface({ surfaceActs } as never, plays, wall);
      expect(plays.get(POST).surfaces[wall]?.acts ?? null).toBeNull();
      expect(plays.wantsSurface(wall)).toBe(true);
      await vi.advanceTimersByTimeAsync(backoff(0) - 1);
      expect(surfaceActs).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(surfaceActs).toHaveBeenCalledTimes(2);
      expect(plays.get(POST).surfaces[wall]).toMatchObject({ covered: 3, acts: [expect.objectContaining({ id: 'd1' })] });
    } finally { vi.useRealTimers(); }
  });

  test('a read that keeps failing is tried a bounded number of times, and the want stays so a broadcast reads again', async () => {
    vi.useFakeTimers();
    try {
      const plays = createPlays();
      plays.add([play()]);
      plays.wantSurface(wall);
      const surfaceActs = vi.fn().mockRejectedValue(new Error('offline'));
      await readSurface({ surfaceActs } as never, plays, wall);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(surfaceActs.mock.calls.length).toBe(REPEAT_TRIES);
      expect(plays.wantsSurface(wall)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  test('an answer that lands after a newer one is dropped', async () => {
    const plays = createPlays();
    plays.add([play()]);
    const later: ((v: unknown) => void)[] = [];
    const surfaceActs = vi.fn(() => new Promise((resolve) => { later.push(resolve); }));
    const first = readSurface({ surfaceActs } as never, plays, wall);
    const second = readSurface({ surfaceActs } as never, plays, wall);
    later[1]!({ covered: 9, acts: [drawn('new')], older: 0 });
    await second;
    later[0]!({ covered: 1, acts: [drawn('old')], older: 0 });
    await first;
    expect(plays.get(POST).surfaces[wall]).toMatchObject({ covered: 9, acts: [expect.objectContaining({ id: 'new' })] });
  });

  test('a read that finds no surface leaves the cells covered as they were', async () => {
    const plays = createPlays();
    plays.add([play()]);
    plays.setSurfaces({ [wall]: { covered: 40, live: ['d1'] } });
    await readSurface({ surfaceActs: async () => null } as never, plays, wall);
    expect(plays.get(POST).surfaces[wall]).toMatchObject({ covered: 40 });
  });

  test('a page read again reads the acts of a wanted wall whose live list changed, and no other', async () => {
    const plays = createPlays();
    const other = 'k-other';
    plays.add([play(), card({ id: other, payload: { card: 'slab', layer: 1, message: '', config: {} } }), card({ id: 'k-third', payload: { card: 'slab', layer: 1, message: '', config: {} } })]);
    plays.setSurfaceActs(wall, 1, [drawn('d1')]);
    plays.setSurfaceActs(other, 1, [drawn('e1')]);
    plays.wantSurface(wall); plays.wantSurface(other);
    const surfaceActs = vi.fn(async () => ({ covered: 2, acts: [drawn('d1'), drawn('d2')], older: 0 }));
    const surfaces = { [wall]: { covered: 2, live: ['d1', 'd2'] }, [other]: { covered: 1, live: ['e1'] }, 'k-third': { covered: 5, live: ['z'] } };
    plays.setSurfaces(surfaces);
    await rereadSurfaces({ surfaceActs } as never, plays, surfaces);
    expect(surfaceActs.mock.calls).toEqual([[wall]]);
  });

  test('a draw or a wash is no card effect and no line of a thread', () => {
    expect(holdsEffects('draw')).toBe(false);
    expect(holdsEffects('wash')).toBe(false);
  });
});

/* A card that keeps (Feelin' Glam): its ended thread play is kept by the marks, for the pages that hold a post it falls on. */
describe('a play of a card that keeps, once its time is up', () => {
  const ENDS = '2026-11-08T12:00:00.000Z';
  const AFTER = Date.parse('2026-11-09T12:00:00.000Z');
  const thread = (id: string, card: string, over: Record<string, unknown> = {}) => playOf(act(id, 'card', { card, reach: 'thread', thread: 'th', ends: ENDS, ...over }, 'p1'))!;
  const keeps = new Set(['keeper']);
  const act = (id: string, kind: Act['kind'], payload: Record<string, unknown>, target: string | null = 'p1'): Act =>
    ({ id, kind, character: 'c1', thread: 't', targetActId: target, seq: null, createdAt: '2026-11-01T12:00:00.000Z', payload, currentPayload: payload, editedAt: null, shownEditedAt: null });

  test('markedPlays keeps an ended keeping play and drops an ended plain one; a reversed keeping play goes, and a live play of either stays', () => {
    const kept = thread('k1', 'keeper');
    const plain = thread('k2', 'sparkly');
    expect(markedPlays([kept, plain], AFTER, keeps).map((p) => p.id)).toEqual(['k1']);
    expect(markedPlays([kept, plain], AFTER).map((p) => p.id), 'no keeping card named: both go, as before').toEqual([]);
    expect(markedPlays([{ ...kept, reversed: true as const }], AFTER, keeps)).toEqual([]);
    expect(markedPlays([kept, plain], Date.parse('2026-11-02T00:00:00.000Z'), keeps).map((p) => p.id)).toEqual(['k1', 'k2']);
  });

  test('playsFallingOn: a live play falls on every post, an ended keeping play only on a post written inside its window, a reversed or untaken play on none', () => {
    const kept = { ...thread('k1', 'keeper'), playedAt: '2026-11-01T12:00:00.000Z' };
    const plain = { ...thread('k2', 'sparkly'), playedAt: '2026-11-01T12:00:00.000Z' };
    const inside = { createdAt: '2026-11-03T00:00:00.000Z' };
    const before = { createdAt: '2026-10-31T00:00:00.000Z' };
    const late = { createdAt: '2026-11-08T12:00:01.000Z' };
    const ids = (post: { createdAt: string }, plays: typeof kept[], now: number) => playsFallingOn(plays, post, keeps, now).map((p) => p.id);
    const live = Date.parse('2026-11-05T00:00:00.000Z');
    expect(ids(before, [kept, plain], live)).toEqual(['k1', 'k2']);
    expect(ids(inside, [kept, plain], AFTER)).toEqual(['k1']);
    expect(ids(before, [kept], AFTER)).toEqual([]);
    expect(ids(late, [kept], AFTER)).toEqual([]);
    expect(ids(inside, [{ ...kept, reversed: true as const }, { ...plain, untaken: true as const }], live)).toEqual([]);
    /* An admin's end of a worn-off keeping play takes its level off the post written inside its window at once. */
    expect(ids(inside, [kept], AFTER)).toEqual(['k1']);
    expect(ids(inside, [{ ...kept, reversed: true as const }], AFTER)).toEqual([]);
  });

  test('markedPlays, given the post\'s date, marks an ended keeping character play only on a post written inside its window; a live one on every post', () => {
    const kept = { ...playOf(act('m1', 'card', { card: 'keeper', reach: 'character', character: 'c1', ends: ENDS }, null))!, playedAt: '2026-11-01T12:00:00.000Z' };
    const plain = { ...playOf(act('m2', 'card', { card: 'sparkly', reach: 'character', character: 'c1', ends: ENDS }, null))!, playedAt: '2026-11-01T12:00:00.000Z' };
    const inside = '2026-11-03T00:00:00.000Z';
    const outside = ['2026-10-31T00:00:00.000Z', '2026-11-08T12:00:01.000Z'];
    expect(markedPlays([kept, plain], AFTER, keeps, inside).map((p) => p.id)).toEqual(['m1']);
    for (const at of outside) expect(markedPlays([kept], AFTER, keeps, at)).toEqual([]);
    const live = Date.parse('2026-11-05T00:00:00.000Z');
    for (const at of [inside, ...outside]) expect(markedPlays([kept, plain], live, keeps, at).map((p) => p.id)).toEqual(['m1', 'm2']);
    expect(markedPlays([{ ...kept, reversed: true as const }], AFTER, keeps, inside)).toEqual([]);
    /* A thread play has no post to be asked of: its mark is the thread head's, whatever date is given. */
    expect(markedPlays([thread('k1', 'keeper')], AFTER, keeps, outside[0]).map((p) => p.id)).toEqual(['k1']);
  });

  test('markedPlays marks a post dated exactly at the play\'s date, and not one dated exactly at its end', () => {
    const kept = { ...playOf(act('m1', 'card', { card: 'keeper', reach: 'character', character: 'c1', ends: ENDS }, null))!, playedAt: '2026-11-01T12:00:00.000Z' };
    expect(markedPlays([kept], AFTER, keeps, kept.playedAt).map((p) => p.id)).toEqual(['m1']);
    expect(markedPlays([kept], AFTER, keeps, ENDS)).toEqual([]);
  });

  test('the Lens says how an ended keeping play ends, in the words of a live one\'s end', () => {
    const live = defaultView({ name: 'Keeper', keeps: true }, undefined, undefined, ENDS).ends!;
    expect(live).toMatch(/^Ends /u);
    expect(defaultView({ name: 'Keeper', keeps: true }, undefined, undefined, ENDS, [], AFTER).ends).toBe(`${live.replace(/^Ends /u, 'Ended ')}. Posts written while it was up keep it.`);
    expect(defaultView({ name: 'Keeper', keeps: true }, undefined, undefined, ENDS, [], Date.parse('2026-11-02T00:00:00.000Z')).ends, 'still up: the live words').toBe(live);
    expect(defaultView({ name: 'Plain' }, undefined, undefined, ENDS, [], AFTER).ends, 'a card that does not keep says no such thing').toBe(live);
  });
});

/* Card notes, part 5: a heart or an Unban is a play that is over when it lands, a fall is spent by a filing, a watch is an ordinary play on a character. */
describe('the discipline plays', () => {
  const NOW = Date.parse('2026-10-29T21:20:00.000Z');
  const TARGET = '55555555-0000-4000-8000-000000000001';
  const heart = (over: Record<string, unknown> = {}) => card({ payload: { card: 'heart', message: '', config: {}, reach: 'character', character: TARGET, targetName: 'Bo Face', instant: true, took: 2, ...over } });

  test('an instant play is a play on the post it was played from, with no reach and no place beyond the post, and it says what it took', () => {
    const act = heart();
    const play = playOf(act)!;
    expect(play).toMatchObject({ id: act.id, card: 'heart', post: POST, instant: true, took: 2, targetName: 'Bo Face' });
    expect(play).not.toHaveProperty('reach');
    expect(play).not.toHaveProperty('on');
    expect(play).not.toHaveProperty('ends');
  });

  test('an unban play says how many bans it lifted', () => {
    const play = playOf(heart({ took: undefined, lifted: [{ ban: 'b1', until: '2026-11-01T00:00:00.000Z' }, { ban: 'b2', until: '2026-11-02T00:00:00.000Z' }] }))!;
    expect(play).toMatchObject({ instant: true, lifted: 2 });
    expect(play).not.toHaveProperty('took');
  });

  test('an instant play with no post is no play, and a play that is not instant takes no took or lifted', () => {
    expect(playOf(card({ targetActId: null, payload: { card: 'heart', reach: 'character', character: TARGET, instant: true, took: 1 } }))).toBeNull();
    expect(playOf(card({ payload: { card: 'whoops', took: 3, lifted: [{}] } }))).not.toHaveProperty('took');
  });

  test('is marked and not live: the mark and the Lens row stay, and it draws no layer', () => {
    const plays = createPlays();
    const act = heart();
    plays.add([act]);
    const got = plays.get(POST).plays;
    expect(got.map((p) => p.id)).toEqual([act.id]);
    expect(livePlays(got, NOW)).toEqual([]);
    expect(markedPlays(got, NOW).map((p) => p.id)).toEqual([act.id]);
  });

  test('a spent fall stays a mark and is left out of the live plays; one that was not spent stays live', () => {
    const plays = createPlays();
    const fall = card({ payload: { card: 'fall', layer: 1, message: '', config: {} } });
    const waiting = card({ payload: { card: 'fall', layer: 2, message: '', config: {} } });
    plays.add([fall, waiting]);
    expect(plays.setSpent([fall.id])).toBe(true);
    expect(plays.setSpent([fall.id])).toBe(false);
    const got = plays.get(POST).plays;
    expect(got.find((p) => p.id === fall.id)).toMatchObject({ spent: true });
    expect(got.find((p) => p.id === waiting.id)).not.toHaveProperty('spent');
    expect(livePlays(got, NOW).map((p) => p.id)).toEqual([waiting.id]);
    expect(markedPlays(got, NOW).map((p) => p.id)).toEqual([fall.id, waiting.id]);
  });

  test('a spent fall holds its place in the stack, as the server counts it, and an ended fall or an instant play holds none', () => {
    const plays = createPlays();
    const fall = card({ payload: { card: 'fall', layer: 1, message: '', config: {} } });
    const ended = card({ payload: { card: 'fall', layer: 2, message: '', config: {} } });
    const instant = heart();
    plays.add([fall, ended, instant, card({ kind: 'card_end', targetActId: ended.id, payload: { why: 'reversed', by: 'admin' } })]);
    plays.setSpent([fall.id, ended.id]);
    const got = plays.get(POST).plays;
    expect(stackPlays(got, NOW).map((p) => p.id)).toEqual([fall.id]);
    expect(livePlays(got, NOW)).toEqual([]);
  });

  test('a spent mark that is learned before its play arrives is kept for when it does, and a page that carries it hydrates it', () => {
    const plays = createPlays();
    const fall = card({ payload: { card: 'fall', layer: 1, message: '', config: {} } });
    plays.setSpent([fall.id]);
    hydrate(plays, [fall], {}, [], {}, {}, [fall.id]);
    expect(plays.get(POST).plays[0]).toMatchObject({ spent: true });
  });

  test('an admin ending a fall is an ended play, not a spent one', () => {
    const plays = createPlays();
    const fall = card({ payload: { card: 'fall', layer: 1, message: '', config: {} } });
    plays.add([fall, card({ kind: 'card_end', targetActId: fall.id, payload: { why: 'reversed', by: 'admin' } })]);
    expect(plays.get(POST).plays[0]).toMatchObject({ reversed: true });
    expect(plays.get(POST).plays[0]).not.toHaveProperty('spent');
  });

  test('a watch is a character play with a time up, as any is: drawn on its character until it ends, and gone after', () => {
    const watch = card({ payload: { card: 'watch', message: '', config: {}, reach: 'character', character: TARGET, targetName: 'Bo Face', ends: '2026-10-30T21:16:00.000Z' } });
    const play = playOf(watch)!;
    expect(play).toMatchObject({ card: 'watch', reach: 'character', on: TARGET, ends: '2026-10-30T21:16:00.000Z', post: POST });
    expect(play).not.toHaveProperty('instant');
    expect(livePlays([play], NOW)).toHaveLength(1);
    expect(markedPlays([play], NOW)).toHaveLength(1);
    expect(livePlays([play], Date.parse('2026-10-31T00:00:00.000Z'))).toEqual([]);
    expect(markedPlays([play], Date.parse('2026-10-31T00:00:00.000Z'))).toEqual([]);
    const plays = createPlays();
    plays.add([watch]);
    expect(plays.get(TARGET).plays.map((p) => p.id)).toEqual([watch.id]);
  });
});
