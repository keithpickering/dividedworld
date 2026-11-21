/**
 * The list of Gimmicks the play form gives a card that cuts (docs/plans/2026-11-21-buzzkill-plan.md, Task 5): the live Use-card Gimmicks on the
 * target up to the card's `cuts.upTo`, oldest first, as the engine's `cuttable` picks them; a cut, expired or too rare one is left out, and any
 * other card is given none. The cards are the engine's own test cards, never an instance's.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { createFake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import { renderIn, testInstance } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import type { CardUi, ConfigFormProps } from './types.ts';

const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const card = (key: string, name: string, rarity: CardRules['rarity'], reaches: CardRules['reaches'], extra: Partial<CardRules> = {}): CardRules => ({
  ...base, key, name, alignment: 'salty', rarity, reaches, ...extra, canApply: (t, e, _config, now) => landsOn({ key, reaches }, t, e, now),
});
const gimmick = { kind: 'price', flavors: ['sweet'], add: 25 } as const;
const buzz = card('buzz', 'Buzz', 'rare', ['post', 'character'], { cuts: { upTo: 'rare' }, validateConfig: (c) => ok(c) });
const jimmy = card('jimmy', 'Jimmy', 'uncommon', ['post'], { play: 'use', gimmick });
const rarer = card('rarer', 'Rarer', 'legendary', ['post', 'character'], { play: 'use', gimmick });
const glow = card('glow', 'Glow', 'common', ['character'], { play: 'use', gimmick, lasts: { unit: 'day', count: 1 } });
const dab = card('dab', 'Dab', 'common', ['post']);
const instance: Instance = { ...testInstance, cards: [buzz, jimmy, rarer, glow, dab], settings: { ...testInstance.settings, economy: { 'test.price': 100 } } };

/** A test form that prints the Gimmicks it was given: "none" where it was given none. */
function Print({ gimmicks }: ConfigFormProps) {
  return <output aria-label="gimmicks">{gimmicks === undefined ? 'none' : JSON.stringify(gimmicks.map((g) => [g.card, g.caster, g.ends ?? null]))}</output>;
}
const art = { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = ['buzz', 'jimmy', 'rarer', 'glow', 'dab'].map((key) => ({ key, art, describe: () => `${key}.`, ConfigForm: Print }));

vi.setConfig({ testTimeout: 20_000 });
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world() {
  const fake = createFake({ instance, now: () => Date.now() });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face', { pronouns: PRONOUN_PRESETS.she });
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const { thread, act: p1 } = fake.seed.thread('general', spritey, 'Glitter everywhere', 'the first post');
  const p2 = fake.seed.post(thread, gloomba, 'second');
  fake.seed.cards(me, { buzz: 3, dab: 1 });
  fake.seed.wallet(me, 500);
  fake.signInAs(me);
  localStorage.setItem(hudKey(me), pipe);
  return { fake, thread, p1, p2, me, pipe, spritey, gloomba };
}
async function open(w: ReturnType<typeof world>) {
  renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards });
  await screen.findByRole('article', { name: /^Post 2 /u });
  return userEvent.setup();
}
const post = (seq: number) => document.getElementById(`post-${seq}`)!;
const postbit = (seq: number) => post(seq).querySelector('.kb-postbit') as HTMLElement;
async function arm(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('button', { name: /^Hand, \d postcards?/u }));
  await user.click(within(screen.getByRole('dialog', { name: 'Your hand' })).getAllByRole('button', { name })[0]!);
}
const given = async () => (await screen.findByRole('dialog', { name: /Buzz|Dab/u })).querySelector('output')!;

describe('the Gimmicks the form gives a card that cuts', () => {
  test('on a post: the live Use-card Gimmicks up to its rarity, oldest first, leaving out a cut one, a rarer one and a card that is no Gimmick', async () => {
    const w = world();
    w.fake.seed.card(w.gloomba, w.p2, 'jimmy', { at: Date.now() - 3000 });
    const cut = w.fake.seed.card(w.spritey, w.p2, 'jimmy', { at: Date.now() - 2000 });
    w.fake.seed.card(w.gloomba, w.p2, 'rarer', { at: Date.now() - 1000 });
    w.fake.seed.card(w.gloomba, w.p2, 'dab', { at: Date.now() - 500 });
    w.fake.seed.card(w.spritey, w.p2, 'jimmy', { at: Date.now() - 100 });
    expect((await w.fake.playCard('buzz', w.pipe, w.p2, { play: cut }, '')).ok).toBe(true);
    const user = await open(w);
    await arm(user, /^Buzz, Salty, Cast, rare postcard/u);
    await user.click(await within(post(2)).findByRole('button', { name: 'Play Buzz on post 2' }));
    const out = await given();
    await waitFor(() => expect(JSON.parse(out.textContent!)).toEqual([['jimmy', w.gloomba, null], ['jimmy', w.spritey, null]]));
  });

  test('on a character: the live ones its reach holds, an expired one left out', async () => {
    const w = world();
    w.fake.seed.reach(w.gloomba, 'character', w.spritey, 'glow', { post: w.p1, ends: Date.now() + 86_400_000 });
    w.fake.seed.reach(w.gloomba, 'character', w.spritey, 'glow', { post: w.p1, ends: Date.now() - 60_000 });
    const user = await open(w);
    await arm(user, /^Buzz, Salty, Cast, rare postcard/u);
    await user.click(await within(postbit(1)).findByRole('button', { name: 'Play Buzz on Spritey' }));
    const out = await given();
    await waitFor(() => expect(JSON.parse(out.textContent!)).toHaveLength(1));
    expect(JSON.parse(out.textContent!)[0]).toEqual(['glow', w.gloomba, expect.any(String)]);
  });

  test('a card that does not cut is given none', async () => {
    const w = world();
    w.fake.seed.card(w.gloomba, w.p2, 'jimmy');
    const user = await open(w);
    await arm(user, /^Dab, Salty, Cast, common postcard/u);
    await user.click(await within(post(2)).findByRole('button', { name: 'Play Dab on post 2' }));
    expect((await given()).textContent).toBe('none');
  });
});
