/**
 * A play beyond a post, live (issue 140's live item): a card on a character is played from one of its posts in some other thread,
 * so it is announced on that thread's topic, which this page is not on. The `reach` topic is heard by every signed-in page, and a
 * page keeps the plays whose target it shows: a character with a post in view, or the thread itself. A play on anyone else is
 * dropped, so the page's memory is its own screen's. The cards are the engine's own test cards.
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { createFake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { renderIn, testInstance } from '../test-world.tsx';
import type { CardUi } from '../cards/types.ts';
import { ThreadScreen } from './Thread.tsx';
import { LoadedThread } from '../loaded.tsx';

const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c) };
const reaching = (key: string, name: string, rarity: CardRules['rarity'], reaches: CardRules['reaches']): CardRules => ({
  ...base, key, name, alignment: 'pepperoni', rarity, reaches, lasts: { unit: 'day', count: 1 }, canApply: (t, e, _config, now) => landsOn({ key, reaches }, t, e, now),
});
const instance: Instance = { ...testInstance, cards: [reaching('sparkle', 'Sparkle', 'uncommon', ['character']), reaching('beacon', 'Beacon', 'rare', ['thread'])], settings: { ...testInstance.settings, economy: { 'test.price': 100 } } };

vi.setConfig({ testTimeout: 20_000 });
/* A play heard on reach crosses the fake's realtime and a re-render of the whole frame; on a loaded runner that can take past waitFor's 1 s default,
   so each wait here gets the time the test allows for (it still fails, naming the mark, if the play never lands or never leaves). */
const landed = { timeout: 5_000 };
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const cards: CardUi[] = [{ key: 'sparkle', art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => 'Sparkle.', Effect: ({ children }) => <div>{children}</div> }];

async function open(withCards = false) {
  const fake = createFake({ instance, now: () => Date.now() });
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const here = fake.seed.thread('general', spritey, 'Glitter everywhere', 'the first post');
  const elsewhere = fake.seed.thread('general', spritey, 'Somewhere else', 'a post over there');
  const gloombaThere = fake.seed.post(elsewhere.thread, gloomba, 'gloomba over there');
  fake.signInAs(me);
  /* The page hears reach once its effect has subscribed, a moment after its first article is drawn: a broadcast seeded before then is heard by no one. */
  const heard = vi.spyOn(fake, 'subscribeReach');
  renderIn(fake, <Frame><LoadedThread thread={here.thread} /></Frame>, { path: `/t/${here.thread}`, instance, ...(withCards ? { cards } : {}) });
  await screen.findByRole('article', { name: /^Post 1 /u });
  await waitFor(() => expect(heard).toHaveBeenCalled());
  /* Reach is heard by the frame too, so the thread's own listener is the second. */
  await waitFor(() => expect(heard).toHaveBeenCalled());
  await waitFor(() => expect(fake.broadcast.reachListeners()).toBeGreaterThanOrEqual(2), landed);
  return { fake, me, spritey, gloomba, here, elsewhere, gloombaThere };
}
const postbit = (seq: number) => document.getElementById(`post-${seq}`)!.querySelector('.kb-postbit') as HTMLElement;
const sparkleMark = (el: HTMLElement) => within(el).queryByRole('button', { name: /^Sparkle, 1 play\b/u });

describe('a play beyond a post, heard on reach', () => {
  test('a play on a character shown here, played from a post in another thread, is drawn on its postbit', async () => {
    const w = await open();
    expect(sparkleMark(postbit(1))).toBeNull();
    w.fake.seed.reach(w.spritey, 'character', w.spritey, 'sparkle', { post: w.elsewhere.act, live: true, ends: Date.now() + 60_000 });
    await waitFor(() => expect(sparkleMark(postbit(1))).not.toBeNull(), landed);
  });

  test('a play on a character this page does not show is dropped', async () => {
    const w = await open();
    w.fake.seed.reach(w.gloomba, 'character', w.gloomba, 'sparkle', { post: w.gloombaThere, live: true, ends: Date.now() + 60_000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(sparkleMark(postbit(1))).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sparkle, 1 play\b/u })).toBeNull();
  });

  test('a play heard twice is one play', async () => {
    const w = await open();
    w.fake.broadcast.hold();
    w.fake.seed.reach(w.spritey, 'character', w.spritey, 'sparkle', { post: w.elsewhere.act, live: true, ends: Date.now() + 60_000 });
    w.fake.broadcast.flush({ twice: true });
    await waitFor(() => expect(sparkleMark(postbit(1))).not.toBeNull(), landed);
  });

  test('a play whose read goes wrong is dropped quietly, never an unhandled rejection', async () => {
    const w = await open(true);
    const loose: unknown[] = [];
    const heard = (e: unknown) => { loose.push(e); };
    process.on('unhandledRejection', heard);
    try {
      /* A reply that is not the map of saved states: the page's own handling of it throws. */
      w.fake.effectStates = (async () => null) as never;
      w.fake.seed.reach(w.spritey, 'character', w.spritey, 'sparkle', { post: w.elsewhere.act, live: true, ends: Date.now() + 60_000 });
      await new Promise((r) => setTimeout(r, 100));
    } finally { process.off('unhandledRejection', heard); }
    expect(loose).toEqual([]);
  });
});

/* An admin's end of a play beyond a post (supabase/migrations/0092_card_end.sql): it is announced on `reach` alone when the play was played
   from a post in another thread, so only this listener can take the play off a page that shows it. */
describe('the end of a play beyond a post, heard on reach', () => {
  test('a play on a character shown here leaves its postbit when an admin ends it', async () => {
    const w = await open();
    w.fake.seed.admin(w.me);
    const played = w.fake.seed.reach(w.spritey, 'character', w.spritey, 'sparkle', { post: w.elsewhere.act, live: true, ends: Date.now() + 3_600_000 });
    await waitFor(() => expect(sparkleMark(postbit(1))).not.toBeNull(), landed);
    expect((await w.fake.reverseCard(played)).ok).toBe(true);
    await waitFor(() => expect(sparkleMark(postbit(1))).toBeNull(), landed);
  });
});
