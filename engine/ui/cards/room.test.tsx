/**
 * The post's limit on drawn effects, as the screens hold it (post-plays design, section 4): a full post is offered no card that draws
 * and is still offered a card that only marks, and a play its card says is cleared frees its slot, as `card_target` gives it on the server.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Instance } from '../../rules/types.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import type { CardUi } from './types.ts';
import { landsOn, postFullWords, type CardRules } from '../../rules/cards.ts';
import type { Act, EffectState } from '../data/api.ts';
import { plainRefusal } from './faces.ts';
import { effectsOf, landing, targetOf, waysOn } from './land.ts';
import type { CardPlay } from './types.ts';

const base = (key: string, extra: Partial<CardRules> = {}): CardRules => {
  const own = { key, stack: 9 };
  return { key, name: key, alignment: 'salty', rarity: 'common', stack: 9, playPrice: () => 0, validateConfig: (c) => ({ ok: true, value: c }), canApply: (t, e, _c, now) => landsOn(own, t, e, now), ...extra };
};
const clean = (state: unknown) => typeof state === 'object' && state !== null && (state as { clean?: unknown }).clean === true;
const whoops = base('whoops', { drawsEffect: { cleared: clean } });
const saying = base('saying', { drawsEffect: { cleared: (s) => { const v = (s as { cleared?: unknown } | null)?.cleared; return typeof v === 'string' ? { version: v } : false; } } });
const filler = base('filler', { drawsEffect: {} });
const mark = base('mark');
const cards = [whoops, saying, filler, mark];

const post: Act = {
  id: 'p1', character: 'c1', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: '2026-10-29T21:00:00Z',
  payload: { body: 'hi' }, currentPayload: { body: 'hi' }, editedAt: null, shownEditedAt: null,
};
const play = (card: string, n: number): CardPlay => ({ id: `${card}-${n}`, card, layer: n, caster: 'c2', message: '', config: {}, playedAt: '2026-10-29T21:16:00Z', post: 'p1' });
const state = (state: unknown): EffectState => ({ state, savedAt: '2026-10-29T22:00:00Z' });
const now = Date.parse('2026-11-01T00:00:00Z');
const FULL = 3;
const ctx = (extra = {}) => ({ cards, now, postEffects: FULL, ...extra });
/** Three drawing plays: the post holds all it takes. */
const full = [play('filler', 1), play('filler', 2), play('whoops', 3)];

describe('a full post, as the form asks it', () => {
  test('refuses a card that draws, in the words, and takes a card that only marks', () => {
    const lands = landing(filler, post, full, ctx());
    expect(lands.ok).toBe(false);
    expect(!lands.ok && plainRefusal(lands.why)).toBe(`T${postFullWords(FULL).slice(1)}.`);
    expect(landing(mark, post, full, ctx()).ok).toBe(true);
  });
  test('refuses the set of a card as well: a face-down card takes a slot', () => {
    expect(landing(mark, post, full, ctx({ faceDown: true })).ok).toBe(false);
  });
  test('a post with room takes the card that draws, and the ghost mark reads the same answer', () => {
    expect(landing(filler, post, full.slice(1), ctx()).ok).toBe(true);
    expect(waysOn(filler, post, full, { cards, own: false, now, postEffects: FULL })).toEqual({ cast: false, set: false });
    expect(waysOn(mark, post, full, { cards, own: false, now, postEffects: FULL }).cast).toBe(true);
  });
});

describe('a cleared play, as the server gives it', () => {
  test('a Whoops! whose saved state is clean frees its slot', () => {
    expect(landing(filler, post, full, ctx({ states: { 'whoops-3': state({ strokes: [], clean: true }) } })).ok).toBe(true);
    expect(landing(filler, post, full, ctx({ states: { 'whoops-3': state({ strokes: [1], clean: false }) } })).ok).toBe(false);
  });
  test('a You Were Saying cleared for the post\'s version frees it, and one cleared for an earlier version does not', () => {
    const held = [play('filler', 1), play('filler', 2), play('saying', 3)];
    const states = { 'saying-3': state({ cleared: 'v2' }) };
    expect(landing(filler, post, held, ctx({ states, version: 'v2' })).ok).toBe(true);
    expect(landing(filler, post, held, ctx({ states, version: 'v3' })).ok).toBe(false);
    expect(landing(filler, post, held, ctx({ states, version: null })).ok).toBe(false);
  });
  test('effectsOf gives drawing from the card and cleared from its answer', () => {
    const effects = effectsOf([play('mark', 1), play('whoops', 2), play('saying', 3)], cards, { states: { 'whoops-2': state({ clean: true }), 'saying-3': state({ cleared: 'v1' }) }, version: 'v2' });
    expect(effects.map((e) => [e.drawing === true, e.cleared === true])).toEqual([[false, false], [true, true], [true, false]]);
    const own = { ...play('filler', 4), reach: 'post' } as unknown as CardPlay;
    expect(effectsOf([own], cards)[0]!.drawing).toBe(true);
    expect(targetOf(post).reach).toBe('post');
  });
});

/* The screens in a world: the ghost mark and the play form hold the limit as the rules do (post-plays Task 11). */
describe('the limit on the screen', () => {
  const economy = { 'whoops.price': 100, 'whoops.perLength': 25, 'whoops.lengthStep': 500, 'stick.price': 100 };
  const drawing: CardRules = { ...whoops, name: 'Whoops!', stack: 9, canApply: (t, e, _c, now) => landsOn({ key: 'whoops', stack: 9 }, t, e, now) };
  const marking: CardRules = { ...mark, key: 'stick-around', name: 'Stick Around', alignment: 'sweet', canApply: (t, e, _c, now) => landsOn({ key: 'stick-around' }, t, e, now) };
  const instance: Instance = { ...testInstance, cards: [drawing, marking], settings: { ...testInstance.settings, economy, postEffects: FULL } };
  const ui: CardUi[] = [
    { key: 'whoops', art: { color: '#ff3d7f', ink: '#14030a', canvas: '', mark: '', credit: 'Test' }, describe: () => 'Splats a post.' },
    { key: 'stick-around', art: { color: '#2ee6ff', ink: '#03141a', canvas: '', mark: '', credit: 'Test' }, describe: () => 'Holds a reader.' },
  ];
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  function world() {
    const fake = buildWorld({ postMaxLength: 1000 }, instance);
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
    const { thread, act: p1 } = fake.seed.thread('general', gloomba, 'who keeps splatting', 'the first post');
    const p2 = fake.seed.post(thread, gloomba, 'short');
    const p3 = fake.seed.post(thread, gloomba, 'full of effects');
    fake.seed.cards(me, { whoops: 2, 'stick-around': 1 });
    fake.seed.wallet(me, 462);
    fake.signInAs(me);
    localStorage.setItem(hudKey(me), pipe);
    const w = { fake, thread, ids: [p1, p2, p3], gloomba };
    fill(w, 3, false);
    return w;
  }
  const fill = (w: { fake: ReturnType<typeof buildWorld>; ids: string[]; gloomba: string }, seq: number, live: boolean) => {
    for (const layer of [1, 2, 3]) w.fake.seed.card(w.gloomba, w.ids[seq - 1]!, 'whoops', { message: `layer ${layer}`, layer, config: {}, live });
  };
  const open = async (w: ReturnType<typeof world>) => {
    renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards: ui, settings: { postMaxLength: 1000, cardEconomy: (await w.fake.settings()).cardEconomy } });
    await screen.findByRole('article', { name: /^Post 3 /u });
    await screen.findByRole('button', { name: /^Hand, 3 postcards/u });
  };
  const arm = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole('button', { name: /^Hand, \d postcards?/u }));
    await user.click(within(screen.getByRole('dialog', { name: 'Your hand' })).getByRole('button', { name }));
  };
  const post = (seq: number) => document.getElementById(`post-${seq}`)!;
  beforeEach(() => { vi.stubGlobal('IntersectionObserver', Observer); Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); window.history.replaceState(null, '', '/'); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  test('a post holding all it takes shows no ghost mark for a card that draws, and still one for a card that only marks', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user, 'Whoops!, Salty, Cast, common postcard, 2 in hand');
    expect(await within(post(2)).findByRole('button', { name: 'Play Whoops! on post 2' })).toBeInTheDocument();
    expect(within(post(3)).queryByRole('button', { name: 'Play Whoops! on post 3' })).toBeNull();
    await user.keyboard('{Escape}');
    await arm(user, 'Stick Around, Sweet, Cast, common postcard');
    expect(await within(post(3)).findByRole('button', { name: 'Play Stick Around on post 3' })).toBeInTheDocument();
  });

  test('a form open on a card that draws says the post is full when it fills', async () => {
    const user = userEvent.setup();
    const w = world();
    await open(w);
    await arm(user, 'Whoops!, Salty, Cast, common postcard, 2 in hand');
    await user.click(await within(post(2)).findByRole('button', { name: 'Play Whoops! on post 2' }));
    const form = await screen.findByRole('dialog', { name: 'Whoops!' });
    await act(async () => { fill(w, 2, true); });
    await waitFor(() => expect(within(form).getByRole('status', { name: 'Cost' })).toHaveTextContent(plainRefusal(postFullWords(FULL))));
  });
});
