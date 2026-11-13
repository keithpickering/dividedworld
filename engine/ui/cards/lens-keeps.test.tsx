/**
 * The Lens on a play of a card that keeps (`CardRules.keeps`) once its week is over: an open Lens says it ended, by itself, on the one clock; an admin can still end the play
 * (which takes the level off every post), for a card that keeps and no other; and the thread head's mark stays while a post on the page holds its level.
 * The cards are the engine's own test cards, never an instance's.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, renderIn, testInstance, testKeeper } from '../test-world.tsx';
import { LoadedThread } from '../loaded.tsx';
import type { CardUi } from './types.ts';

const DAY = 24 * 60 * 60 * 1000;
const plain: CardRules = { key: 'plain', name: 'Plain', alignment: 'sweet', rarity: 'rare', reaches: ['thread'], lasts: { unit: 'day', count: 7 }, playPrice: () => 0, validateConfig: (c: unknown) => ok(c), canApply: (t, e, _c, now) => landsOn({ key: 'plain', reaches: ['thread'] }, t, e, now) };
const instance: Instance = { ...testInstance, cards: [testKeeper, plain] };
const art = { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = ['keeper', 'plain'].map((key) => ({ key, art, describe: () => `${key}.`, summary: `${key}.` }));

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
});
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** A thread whose head carries a week-long thread play of each card, by Spritey; the reader is `admin` or not. */
function world(admin: boolean) {
  const fake = buildWorld({}, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  fake.seed.post(thread, spritey, 'post 2');
  const keeper = fake.seed.reach(spritey, 'thread', thread, 'keeper', { ends: fake.clock.now() + 7 * DAY, message: 'Kept.' });
  const flat = fake.seed.reach(spritey, 'thread', thread, 'plain', { ends: fake.clock.now() + 7 * DAY, message: 'Flat.' });
  fake.signInAs(me);
  if (admin) fake.seed.admin(me);
  return { fake, thread, keeper, flat };
}
const open = (w: ReturnType<typeof world>) => renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards });
const lens = () => screen.getByRole('dialog', { name: 'Cards on this thread' });
const headMark = (card: string) => screen.findByRole('button', { name: new RegExp(`^${card}, 1 play`, 'u') });
const whoButton = () => within(lens()).getByRole('button', { name: /^1 play · / });
const endButton = () => within(lens()).queryByRole('button', { name: 'End this card' });
const pass = (w: ReturnType<typeof world>, ms: number) => act(async () => { w.fake.clock.advance(ms); vi.advanceTimersByTime(ms); });

describe('an open Lens on a play of a card that keeps', () => {
  test('says "Ends" while the play is up, and says it ended, with the words of the kept level, when its week passes under it', async () => {
    const w = world(false);
    vi.useFakeTimers({ shouldAdvanceTime: true, now: w.fake.clock.now() });
    open(w);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(await headMark('Keeper'));
    expect(within(lens()).getByText(/^Ends /u)).toBeInTheDocument();
    await pass(w, 7 * DAY + 1000);
    await waitFor(() => expect(within(lens()).queryByText(/^Ends /u)).toBeNull());
    expect(within(lens()).getByText(/^Ended .*\. Posts written while it was up keep it\.$/u)).toBeInTheDocument();
  });
});

describe('the thread head\'s mark of a play whose week is over', () => {
  test('stays for a card that keeps, on a page holding a post written inside its window, and is not drawn for a card that does not', async () => {
    const w = world(false);
    w.fake.clock.advance(8 * DAY);
    open(w);
    expect(await headMark('Keeper')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Plain, 1 play/u })).toBeNull();
  });
});

describe('End this card on a play whose week is over', () => {
  const asAdmin = () => {
    const w = world(true);
    w.fake.clock.advance(8 * DAY);
    return { w };
  };

  test('an admin is offered it on a worn-off play of a card that keeps', async () => {
    const { w } = await asAdmin();
    open(w);
    await userEvent.click(await headMark('Keeper'));
    await userEvent.click(whoButton());
    expect(endButton()).toBeInTheDocument();
  });

  test('not on a worn-off play of a card that does not keep', async () => {
    const w = world(true);
    w.fake.clock.advance(8 * DAY);
    open(w);
    /* A plain play past its end draws no mark at all: the thread head offers the keeping card's alone. */
    await headMark('Keeper');
    expect(screen.queryByRole('button', { name: /^Plain, 1 play/u })).toBeNull();
  });

  test('not to a reader who is no admin', async () => {
    const w = world(false);
    w.fake.clock.advance(8 * DAY);
    open(w);
    await userEvent.click(await headMark('Keeper'));
    await userEvent.click(whoButton());
    expect(endButton()).toBeNull();
  });

  test('ending it is the server\'s end of the play: the play is marked ended, and the card is asked once', async () => {
    const { w } = await asAdmin();
    const reverse = vi.spyOn(w.fake, 'reverseCard');
    open(w);
    await userEvent.click(await headMark('Keeper'));
    await userEvent.click(whoButton());
    await userEvent.click(endButton()!);
    await userEvent.click(screen.getByRole('button', { name: 'End it' }));
    await waitFor(() => expect(reverse).toHaveBeenCalledWith(w.keeper));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End this card?' })).toBeNull());
    /* The play is over for everyone: its mark leaves the thread head. */
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Keeper, 1 play/u })).toBeNull());
  });
});
