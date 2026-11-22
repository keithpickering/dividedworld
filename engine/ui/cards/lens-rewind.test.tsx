/**
 * The Lens of a rewind play, and the point picker of its play form (Time Machine design, 4.5 and 4.1): a "Return to present" tile beside "As it landed" that swaps the post's body between
 * the rewound words and the present, the line that counts the cards hidden until it ends, and a radio group of the points the engine offers. The cards are the engine's own test cards.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { dayAndTime } from '../characters/format.ts';
import { createFake } from '../data/fake.ts';
import { LoadedThread } from '../loaded.tsx';
import { renderIn, testInstance } from '../test-world.tsx';
import { spanMs } from '../../rules/cards.ts';
import { rewindConfig } from '../../rules/rewind.ts';
import { RewindPoints } from './RewindPoints.tsx';
import { createPlays } from './plays.ts';
import type { Act } from '../data/api.ts';
import { Frame } from '../frame/Frame.tsx';
import { hudKey } from '../player.tsx';
import type { CardUi } from './types.ts';

const MINUTE = 60_000;
const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const plain = (key: string, name: string): CardRules => ({ ...base, key, name, alignment: 'salty', rarity: 'common', reaches: ['post'], canApply: (t, e, _config, now) => landsOn({ key, reaches: ['post'] }, t, e, now) });
const clock: CardRules = { ...plain('clock', 'Clock'), alignment: 'sweet', rarity: 'rare', lasts: { unit: 'day', count: 1 }, rewind: { upTo: 'rare' }, validateConfig: rewindConfig } as CardRules;
const wide: CardRules = { ...plain('wide', 'Wide'), reaches: ['thread'], lasts: { unit: 'day', count: 1 }, canApply: (t, e, _config, now) => landsOn({ key: 'wide', reaches: ['thread'] }, t, e, now) } as CardRules;
const instance: Instance = { ...testInstance, cards: [plain('early', 'Early'), plain('late', 'Late'), clock, wide] };
const art = { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' };
const cards: CardUi[] = ['early', 'late', 'clock', 'wide'].map((key) => ({ key, art, describe: () => `${key}.`, summary: `${key}.`, Effect: ({ children }) => <div data-kb-wrap={key}>{children}</div> }));

class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
});
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Ana's post, edited after the grace, with `early` before the point, `late` and a second `early` after it; Bo plays the Clock at the first words when `rewound`. */
async function world(rewound = true, edited = true, after: readonly string[] = ['late', 'early'], wideMs: number | null = null) {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
  const boFace = fake.seed.character(bo, 'Bo Face', 'face');
  const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'The first words.');
  fake.seed.cards(bo, { clock: 3 });
  fake.seed.wallet(bo, 500);
  localStorage.setItem(hudKey(bo), boFace);
  fake.clock.advance(MINUTE);
  fake.seed.card(boFace, opener, 'early', { message: '' });
  fake.clock.advance(2 * MINUTE);
  fake.signInAs(ana);
  if (edited) await fake.edit(opener, anaFace, 'The second words.');
  fake.clock.advance(MINUTE);
  for (const key of after) fake.seed.card(boFace, opener, key, { message: '' });
  if (wideMs !== null) fake.seed.reach(boFace, 'thread', thread, 'wide', { ends: fake.clock.now() + wideMs, message: '' });
  fake.clock.advance(MINUTE);
  fake.signInAs(bo);
  const rewind = rewound ? await fake.playCard('clock', boFace, opener, { to: opener }, '') : null;
  return { fake, thread, opener, boFace, rewind, ana, anaFace, bo };
}
type World = Awaited<ReturnType<typeof world>>;
const open = (w: Pick<World, 'fake'>, thread: string) => renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance, cards });
const post1 = () => screen.findByRole('article', { name: /^Post 1 /u });
const lens = () => screen.getByRole('dialog', { name: 'Cards on this post' });
const clockLens = async () => {
  await userEvent.click(await within(await post1()).findByRole('button', { name: /^Clock, 1 play/u }));
  await userEvent.click(within(lens()).getByRole('button', { name: /^1 play · / }));
};

describe('the Lens of a rewind play', () => {
  test('Return to present is a tile beside As it landed, on the rewind play alone', async () => {
    const w = await world();
    open(w, w.thread);
    await clockLens();
    expect(within(lens()).getByRole('button', { name: 'As it landed' })).toBeInTheDocument();
    expect(await within(lens()).findByRole('button', { name: 'Return to present' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(await post1()).getByRole('button', { name: /^Early, /u }));
    await waitFor(() => expect(within(lens()).getByRole('tab', { name: 'Early', selected: true })).toBeInTheDocument());
    await waitFor(() => expect(within(lens()).getAllByRole('button', { name: 'As it landed' }).length).toBeGreaterThan(0));
    expect(within(lens()).queryByRole('button', { name: 'Return to present' })).toBeNull();
  });

  test('toggles the body between the rewound words and the present, framed "The present" without the rewind\'s own effect', async () => {
    const w = await world();
    open(w, w.thread);
    const post = await post1();
    await waitFor(() => expect(post).toHaveTextContent('The first words.'));
    await clockLens();
    const tile = within(lens()).getByRole('button', { name: 'Return to present' });
    await userEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    const frame = await within(post).findByRole('group', { name: 'The present' });
    expect(within(frame).getByText('The second words.')).toBeInTheDocument();
    expect(post).not.toHaveTextContent('The first words.');
    const wraps = [...post.querySelectorAll('[data-kb-wrap]')].map((e) => e.getAttribute('data-kb-wrap')).sort();
    expect(wraps).toEqual(['early', 'late']);
    /* Pressed again, the rewind is back. */
    await userEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    expect(within(post).queryByRole('group', { name: 'The present' })).toBeNull();
    expect(post).toHaveTextContent('The first words.');
    /* The frame's own press goes back too. */
    await userEvent.click(tile);
    await userEvent.click(within(await within(post).findByRole('group', { name: 'The present' })).getByRole('button', { name: 'Back to the rewind' }));
    expect(post).toHaveTextContent('The first words.');
  });

  test('As it landed takes the one shown view from the present', async () => {
    const w = await world();
    open(w, w.thread);
    await clockLens();
    const row = lens().querySelector<HTMLElement>('[data-kb-play]')!;
    const tile = within(row).getByRole('button', { name: 'Return to present' });
    await userEvent.click(tile);
    await userEvent.click(within(row).getByRole('button', { name: 'As it landed' }));
    await waitFor(() => expect(within(row).getByRole('button', { name: 'As it landed' })).toHaveAttribute('aria-pressed', 'true'));
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    expect(within(await post1()).queryByRole('group', { name: 'The present' })).toBeNull();
  });

  test('says how many later cards are hidden until it ends, in both forms', async () => {
    const w = await world();
    open(w, w.thread);
    await clockLens();
    expect(await within(lens()).findByText('2 later cards hidden until it ends')).toBeInTheDocument();
  });

  test('says "1 later card" for one', async () => {
    const w = await world(true, true, ['late']);
    open(w, w.thread);
    await clockLens();
    expect(await within(lens()).findByText('1 later card hidden until it ends')).toBeInTheDocument();
  });

  test('counts a thread play the rewind hides too: one on the post and one on the thread are two', async () => {
    const w = await world(true, true, ['late'], 86_400_000);
    open(w, w.thread);
    await clockLens();
    expect(await within(lens()).findByText('2 later cards hidden until it ends')).toBeInTheDocument();
  });

  test('drops a hidden play from the count when its time ends, with no reopening', async () => {
    const w = await world(true, true, ['late'], 10 * MINUTE);
    vi.useFakeTimers({ shouldAdvanceTime: true, now: w.fake.clock.now() });
    onTestFinished(() => { vi.useRealTimers(); });
    open(w, w.thread);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(await within(await post1()).findByRole('button', { name: /^Clock, 1 play/u }));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(within(lens()).getByRole('button', { name: /^1 play · / }));
    expect(await within(lens()).findByText('2 later cards hidden until it ends')).toBeInTheDocument();
    await act(async () => { w.fake.clock.advance(11 * MINUTE); vi.advanceTimersByTime(11 * MINUTE); });
    expect(await within(lens()).findByText('1 later card hidden until it ends')).toBeInTheDocument();
  });

  test('no line where nothing is hidden', async () => {
    const w = await world(true, true, []);
    open(w, w.thread);
    await clockLens();
    expect(within(lens()).queryByText(/later cards? hidden/u)).toBeNull();
  });
});

describe('the point picker of a rewind card', () => {
  /** The Clock armed from Bo's hand and pressed on post 1 (Ana's), the form open. */
  async function form(w: World) {
    renderIn(w.fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards, settings: { cardEconomy: (await w.fake.settings()).cardEconomy } });
    await post1();
    await userEvent.click(await screen.findByRole('button', { name: /^Hand, \d postcards?/u }));
    await userEvent.click(await within(screen.getByRole('dialog', { name: 'Your hand' })).findByRole('button', { name: /^Clock, /u }));
    await userEvent.click(await screen.findByRole('button', { name: 'Play Clock on post 1' }));
    return screen.findByRole('dialog', { name: 'Clock' });
  }
  const fresh = (edited: boolean) => world(false, edited, edited ? undefined : []);

  test('offers the first version and the edit as radios under "Rewind to", with the words beneath, and plays with the one picked', async () => {
    const w = await fresh(true);
    const dialog = await form(w);
    const group = within(dialog).getByRole('radiogroup', { name: 'Rewind to' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).labels![0]!.textContent)).toEqual([expect.stringMatching(/^As first posted, /u), expect.stringMatching(/^Edit of /u)]);
    expect(group).toHaveTextContent('The first words.');
    const play = within(dialog).getByRole('button', { name: /^Play as / });
    expect(play).toBeDisabled();
    await userEvent.click(radios[0]!);
    await waitFor(() => expect(play).toBeEnabled());
    const spy = vi.spyOn(w.fake, 'playCard');
    await userEvent.click(play);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![3]).toEqual({ to: w.opener });
  });

  test('with no point to offer it says so, and the play button stays off', async () => {
    const w = await fresh(false);
    const dialog = await form(w);
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    expect(within(dialog).getByText('Nothing to rewind on this post')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Play as / })).toBeDisabled();
  });

  test('names a later version as an edit of its date, after the first', async () => {
    const w = await world(false, true);
    w.fake.clock.advance(MINUTE);
    w.fake.signInAs(w.ana);
    await w.fake.edit(w.opener, w.anaFace, 'The third words.');
    w.fake.signInAs(w.bo);
    const dialog = await form(w);
    const labels = within(dialog).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels![0]!.textContent!);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/^As first posted, /u);
    expect(labels[1]).toMatch(/^Edit of /u);
  });

  test('each radio is named by its label alone, with the version\'s words as its description, still visible', async () => {
    const w = await fresh(true);
    const dialog = await form(w);
    const first = within(dialog).getAllByRole('radio')[0]!;
    expect(first).toHaveAccessibleName(/^As first posted, [^]*[AP]M$/u);
    expect(first).toHaveAccessibleDescription('The first words.');
    expect(within(dialog).getByText('The first words.')).toBeVisible();
  });

  test('focus is inside the form when it opens, and an arrow key moves the pick, which plays with exactly { to }', async () => {
    const w = await fresh(true);
    const dialog = await form(w);
    expect(dialog.contains(document.activeElement)).toBe(true);
    const [one, two] = within(dialog).getAllByRole('radio') as HTMLInputElement[];
    one!.focus();
    await userEvent.click(one!);
    await userEvent.keyboard('{ArrowDown}');
    expect(two).toBeChecked();
    expect(one).not.toBeChecked();
    const edit = (await w.fake.history(w.opener))[1]!;
    const spy = vi.spyOn(w.fake, 'playCard');
    await userEvent.click(within(dialog).getByRole('button', { name: /^Play as / }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![3]).toStrictEqual({ to: edit.id });
  });

  test('names the points with their exact dates in the reader\'s zone', async () => {
    const w = await fresh(true);
    const dialog = await form(w);
    const [post, edit] = await w.fake.history(w.opener);
    const grace = spanMs((await w.fake.settings()).editGrace);
    const labels = within(dialog).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels![0]!.textContent);
    expect(labels).toEqual([`As first posted, ${dayAndTime(new Date(Date.parse(post!.createdAt) + grace).toISOString())}`, `Edit of ${dayAndTime(edit!.createdAt)}`]);
  });
});

describe('RewindPoints on its own', () => {
  /** The post and its plays are read before a test stubs the History, so only the picker's own reads are stubbed. */
  async function prior(w: World) {
    const [post] = await w.fake.history(w.opener);
    return { post, read: await w.fake.postPlays([w.opener]) };
  }
  async function host(w: World, { post, read }: Awaited<ReturnType<typeof prior>>) {
    const store = createPlays();
    store.add(read.plays);
    function Host() {
      const [config, setConfig] = useState<Readonly<Record<string, unknown>> | undefined>(undefined);
      const [shown, setShown] = useState<Act>(post!);
      return (
        <>
          <RewindPoints post={shown} plays={store} id="t" config={config} onChange={setConfig} />
          <output data-config>{JSON.stringify(config ?? null)}</output>
          <button type="button" onClick={() => setShown({ ...shown, editedAt: '2026-01-01T00:00:00.000Z' })}>bump</button>
        </>
      );
    }
    renderIn(w.fake, <Host />, { path: '/', instance, cards });
    return { store, read };
  }

  test('says the History is loading while the read has not answered', async () => {
    const w = await world(false, true);
    const held = await prior(w);
    vi.spyOn(w.fake, 'history').mockReturnValue(new Promise(() => {}));
    await host(w, held);
    expect(await screen.findByText('Loading the History…')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  test('says the History could not be loaded, in words, when the read fails', async () => {
    const w = await world(false, true);
    const held = await prior(w);
    const real = w.fake.history.bind(w.fake);
    let first = true;
    vi.spyOn(w.fake, 'history').mockImplementation((id) => { if (first) { first = false; return real(id); } return Promise.reject(new Error('down')); });
    await host(w, held);
    await userEvent.click(await screen.findByRole('button', { name: 'bump' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The History could not be loaded, so no point can be offered. Close this and try again.');
  });

  test('when the post changes the old points go at once, and none is offered until the new read lands', async () => {
    const w = await world(false, true);
    const held = await prior(w);
    const real = w.fake.history.bind(w.fake);
    let first = true;
    vi.spyOn(w.fake, 'history').mockImplementation((id) => { if (first) { first = false; return real(id); } return new Promise(() => {}); });
    await host(w, held);
    expect(await screen.findAllByRole('radio')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'bump' }));
    expect(await screen.findByText('Loading the History…')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  test('a point is let go when it stops being offered: the pick is cleared and nothing is sent', async () => {
    const w = await world(false, false, ['late']);
    const held = await prior(w);
    const { store } = await host(w, held);
    const { read } = held;
    const radio = await screen.findByRole('radio');
    await userEvent.click(radio);
    expect(document.querySelector('[data-config]')!.textContent).toBe(JSON.stringify({ to: w.opener }));
    const late = read.plays.find((a) => a.payload.card === 'late')!;
    act(() => { store.setEnded([late.id]); });
    await waitFor(() => expect(document.querySelector('[data-config]')!.textContent).toBe('{}'));
    expect(screen.getByText('Nothing to rewind on this post')).toBeInTheDocument();
  });
});
