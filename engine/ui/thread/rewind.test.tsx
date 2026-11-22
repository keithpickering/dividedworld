/**
 * A post under a live rewind, in a thread and in the ORIGIN box of a thread spun from it (Time Machine design, 4.2 and 4.4): it draws the old words, hides the cards played after the
 * point and keeps the ones before it, its marks say what is drawn, a quote takes the words it shows, and a rewind that lands while the reader is here draws rewound once, never the present
 * after its view is in. The cards are the engine's own test cards, never an instance's.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import type { Rewind } from '../data/api.ts';
import { createFake } from '../data/fake.ts';
import { replyBox } from '../composer/support.tsx';
import { LoadedThread } from '../loaded.tsx';
import { renderIn, testInstance } from '../test-world.tsx';
import type { CardUi } from '../cards/types.ts';

const MINUTE = 60_000;
const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const plain = (key: string, name: string): CardRules => ({ ...base, key, name, alignment: 'salty', rarity: 'common', reaches: ['post'], canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now) });
const clock: CardRules = { ...plain('clock', 'Clock'), alignment: 'sweet', rarity: 'rare', lasts: { unit: 'day', count: 1 }, rewind: { upTo: 'rare' }, drawsEffect: {} } as CardRules;
const instance: Instance = { ...testInstance, cards: [plain('early', 'Early'), plain('late', 'Late'), clock] };
const art = { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = ['early', 'late', 'clock'].map((key) => ({ key, art, describe: () => `${key}.`, Effect: ({ children }) => <div data-kb-wrap={key}>{children}</div> }));

/* A play heard on a channel crosses the fake's realtime and a re-render of the whole frame; on a loaded runner that can take past waitFor's 1 s default. */
const landed = { timeout: 5_000 };
class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/**
 * Ana's post, edited after the edit grace so its first version is a point (the point is the post's time plus the grace). `early` is played before the point, `late` after it, and a second
 * `early` after it too. Bo then plays the Clock at the first words, unless `rewound` is false.
 */
async function world(rewound = true) {
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
  fake.seed.card(boFace, opener, 'late', { message: '' });
  fake.seed.card(boFace, opener, 'early', { message: '' });
  fake.clock.advance(MINUTE);
  fake.signInAs(bo);
  const rewind = rewound ? await fake.playCard('clock', boFace, opener, { to: opener }, '') : null;
  return { fake, thread, opener, ana, anaFace, boFace, bo, rewind };
}
type World = Awaited<ReturnType<typeof world>>;
const open = (w: Pick<World, 'fake'>, thread: string) => renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance, cards });
const post1 = () => screen.findByRole('article', { name: /^Post 1 /u });
const wraps = (el: HTMLElement) => [...el.querySelectorAll('[data-kb-wrap]')].map((w) => w.getAttribute('data-kb-wrap')).sort();
const markNames = (el: HTMLElement) => within(el).queryAllByRole('button', { name: /cards on this post\.$/u }).map((m) => m.getAttribute('aria-label')!.replace(/,.*$/u, '') + (m.textContent?.includes('×') ? ` ${m.textContent.match(/×\d+/u)![0]}` : ''));

describe('a post under a live rewind, in its thread', () => {
  test('draws the old words and not the new, at its first paint', async () => {
    const w = await world();
    open(w, w.thread);
    const post = await post1();
    expect(post).toHaveTextContent('The first words.');
    expect(post).not.toHaveTextContent('The second words.');
  });

  test('hides the card played after the point and keeps the one before it, in the effects and the marks', async () => {
    const w = await world();
    open(w, w.thread);
    const post = await post1();
    await waitFor(() => expect(wraps(post)).toEqual(['clock', 'early']));
    await waitFor(() => expect(markNames(post).sort()).toEqual(['Clock', 'Early']));
  });

  test('a mark counts the plays of its kind that are drawn: two plays of a card, one hidden, is one', async () => {
    const w = await world();
    open(w, w.thread);
    const post = await post1();
    await waitFor(() => expect(markNames(post)).toContain('Early'));
    expect(markNames(post)).not.toContain('Early ×2');
  });

  test('without the rewind the post draws as it is, every card and its count', async () => {
    const w = await world(false);
    open(w, w.thread);
    const post = await post1();
    expect(post).toHaveTextContent('The second words.');
    await waitFor(() => expect(wraps(post)).toEqual(['early', 'late']));
    await waitFor(() => expect(markNames(post).sort()).toEqual(['Early ×2', 'Late']));
  });

  test('the Quote link takes the rewound words', async () => {
    const w = await world();
    open(w, w.thread);
    const post = await post1();
    await userEvent.click(within(post).getByRole('button', { name: 'Quote' }));
    expect(await replyBox()).toHaveValue(`[quote=${w.opener}]The first words.[/quote]\n`);
  });

  test('the toolbar\'s quote of the last post takes the rewound words', async () => {
    const w = await world();
    open(w, w.thread);
    await post1();
    await userEvent.click(await screen.findByRole('button', { name: 'Quote the last post shown' }));
    expect(await replyBox()).toHaveValue(`[quote=${w.opener}]The first words.[/quote]\n`);
  });
});

describe('a rewind that lands while the reader is on the page', () => {
  test('the post shows as it was until the view is in, then rewound once, and never the present after', async () => {
    const w = await world(false);
    let deliver!: (view: Rewind | null) => void;
    const real = w.fake.rewindView.bind(w.fake);
    const spy = vi.spyOn(w.fake, 'rewindView').mockImplementation((play) => new Promise<Rewind | null>((resolve) => { deliver = (v) => resolve(v ?? null); void real(play); }));
    open(w, w.thread);
    const post = await post1();
    expect(post).toHaveTextContent('The second words.');
    const played = await w.fake.playCard('clock', w.boFace, w.opener, { to: w.opener }, '');
    expect(played.ok).toBe(true);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    /* The play is in; its view is not: the post is as it was, not the old words and not a blank. */
    await waitFor(() => expect(wraps(post)).toContain('clock'));
    expect(post).toHaveTextContent('The second words.');
    expect(post).not.toHaveTextContent('The first words.');
    const seen: string[] = [];
    const watch = new MutationObserver(() => seen.push(post.textContent ?? ''));
    watch.observe(post, { childList: true, subtree: true, characterData: true });
    deliver((await real((played as { value: { id: string } }).value.id)));
    await waitFor(() => expect(post).toHaveTextContent('The first words.'));
    watch.disconnect();
    expect(post).not.toHaveTextContent('The second words.');
    expect(seen.filter((t) => t.includes('The second words.'))).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('the ORIGIN box of a thread spun from a rewound post', () => {
  const boxOf = () => screen.findByRole('group', { name: 'Origin' });
  async function spun(rewound: boolean) {
    const w = await world(rewound);
    w.fake.signInAs(w.ana);
    const made = await w.fake.spin(w.opener, w.anaFace, 'About it', 'b');
    if (!made.ok) throw new Error('the spin was refused');
    return { w, spunThread: made.value.thread.id };
  }

  test('the live box draws the old words and the cards the rewind lets show', async () => {
    const { w, spunThread } = await spun(true);
    open(w, spunThread);
    const box = await boxOf();
    await waitFor(() => expect(box).toHaveTextContent('The first words.'));
    expect(box).not.toHaveTextContent('The second words.');
    await waitFor(() => expect(wraps(box)).toEqual(['clock', 'early']));
  });

  test('draws everything as it is without a rewind', async () => {
    const { w, spunThread } = await spun(false);
    open(w, spunThread);
    const box = await boxOf();
    await waitFor(() => expect(box).toHaveTextContent('The second words.'));
    expect(wraps(box)).toEqual(['early', 'late']);
  });

  test('a rewind that lands while the box is shown rewinds it once its view is in', async () => {
    const { w, spunThread } = await spun(false);
    open(w, spunThread);
    const box = await boxOf();
    await waitFor(() => expect(box).toHaveTextContent('The second words.'));
    w.fake.signInAs(w.bo);
    const played = await w.fake.playCard('clock', w.boFace, w.opener, { to: w.opener }, '');
    expect(played.ok).toBe(true);
    /* The box may be drawn again as a play lands: it is asked for again. */
    await waitFor(() => expect(screen.getByRole('group', { name: 'Origin' })).toHaveTextContent('The first words.'), landed);
    expect(screen.getByRole('group', { name: 'Origin' })).not.toHaveTextContent('The second words.');
  });
});
