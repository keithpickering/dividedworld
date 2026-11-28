/**
 * A post under a live rewind draws the plays the rewind lets show; a card that draws the reactions that the rewind hides is not drawn, so the row is not loose (it would show its line with no card to draw the reactions).
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { CardUi } from '../cards/types.ts';
import { createFake } from '../data/fake.ts';
import { LoadedThread } from '../loaded.tsx';
import { renderIn, testInstance } from '../test-world.tsx';

const MINUTE = 60_000;
const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const plain = (key: string): CardRules => ({ ...base, key, name: key, alignment: 'salty', rarity: 'common', reaches: ['post'], lasts: { unit: 'day', count: 1 }, canApply: (t, e, _c, now) => landsOn({ key, reaches: ['post'] }, t, e, now) });
const clock: CardRules = { ...plain('clock'), alignment: 'sweet', rarity: 'rare', rewind: { upTo: 'rare' }, drawsEffect: {} } as CardRules;
const instance: Instance = { ...testInstance, cards: [plain('early'), plain('loose'), clock] };
const art = { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = [
  { key: 'early', art, describe: () => 'early', Effect: ({ children }) => <div>{children}</div> },
  { key: 'loose', art, describe: () => 'loose', drawsReactions: true, Effect: ({ reactions, children }) => <div data-testid="fx-loose" data-deck={reactions === undefined ? 'none' : 'live'}>{children}</div> },
  { key: 'clock', art, describe: () => 'clock', Effect: ({ children }) => <div>{children}</div> },
];
const LINE = "This post's reactions are loose inside it.";

async function world(rewound: boolean) {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
  const boFace = fake.seed.character(bo, 'Bo Face', 'face');
  const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'The first words.');
  fake.seed.cards(bo, { clock: 3 });
  fake.clock.advance(MINUTE);
  fake.seed.card(boFace, opener, 'early', { message: '' });
  fake.clock.advance(2 * MINUTE);
  fake.signInAs(ana);
  await fake.edit(opener, anaFace, 'The second words.');
  fake.clock.advance(MINUTE);
  fake.seed.card(boFace, opener, 'loose', { message: '' });
  fake.clock.advance(MINUTE);
  fake.signInAs(bo);
  if (rewound) { const r = await fake.playCard('clock', boFace, opener, { to: opener }, ''); if (!r.ok) throw new Error(r.error); }
  return { fake, thread };
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = (w: { fake: ReturnType<typeof createFake>; thread: string }) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards });

describe('a post under a live rewind', () => {
  test('without the rewind the card draws the reactions and the row is loose', async () => {
    const w = await world(false);
    open(w);
    const post = await screen.findByRole('article', { name: /^Post 1 /u });
    await waitFor(() => expect(within(post).getByTestId('fx-loose')).toHaveAttribute('data-deck', 'live'));
    expect(within(post).getByText(LINE)).toBeInTheDocument();
  });

  test('a play the rewind hides is not drawn, so the row keeps its tiles', async () => {
    const w = await world(true);
    open(w);
    const post = await screen.findByRole('article', { name: /^Post 1 /u });
    await waitFor(() => expect(post).toHaveTextContent('The first words.'));
    expect(within(post).queryByTestId('fx-loose')).toBeNull();
    expect(within(post).queryByText(LINE)).toBeNull();
    expect(within(post).getByRole('button', { name: 'React' })).toBeInTheDocument();
  });
});
