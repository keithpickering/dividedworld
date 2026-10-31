import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Swapper, openThread, threadWorld } from '../composer/support.tsx';
import { useLocation } from '../router.tsx';
import type { Act, ThreadListener } from '../data/api.ts';
import { renderIn } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

const spinLink = (within_: HTMLElement) => within(within_).getByRole('button', { name: 'Spin thread' });

describe('the Spin thread link', () => {
  test('toggled off, a form keeps what was typed for the next time it is opened; Cancel throws it away', async () => {
    const w = threadWorld(3);
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    const link = () => within(article).getAllByRole('button', { name: 'Spin thread' }).find((b) => b.hasAttribute('aria-expanded'))!;
    await userEvent.click(link());
    await userEvent.type(within(article).getByLabelText('Thread title'), 'Keep me');
    await userEvent.click(link());
    expect(within(article).queryByRole('form')).toBeNull();
    await userEvent.click(link());
    expect(within(article).getByLabelText('Thread title')).toHaveValue('Keep me');
    await userEvent.click(within(article).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(link());
    expect(within(article).getByLabelText('Thread title')).toHaveValue('');
  });

  test('is on every kind of Act, The System\'s board included', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.pipe, w.ids[1]!, 'whoops', { message: 'oops' });
    w.fake.seed.reveal(w.pipe, w.thread);
    openThread(w);
    /* A card play is no Act of the thread's (it is a tag on its post), so the Acts are the posts and the reveal. */
    for (const name of [/^Post 1 /u, /^Post 2 /u, /^Post 3 /u, /^Post 4 /u]) {
      expect(spinLink(await screen.findByRole('article', { name }))).toBeInTheDocument();
    }
    const said = w.fake.seed.thread('the-system', null, 'The tally', 'Settled.');
    document.body.innerHTML = '';
    openThread({ ...w, thread: said.thread });
    expect(spinLink(await screen.findByRole('article', { name: /^Post 1 by The System/u }))).toBeInTheDocument();
  });

  test('opens a small form that names the origin and the HUD\'s character, and is off with the next press', async () => {
    const w = threadWorld(3);
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    const link = spinLink(article);
    expect(link).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(link);
    expect(link).toHaveAttribute('aria-expanded', 'true');
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    expect(within(form).getByText(/Spinning a thread from/u)).toBeInTheDocument();
    expect(within(form).getByText('Pipewrench').tagName).toBe('STRONG');
    expect(within(form).getByLabelText('Thread title')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(within(article).queryByRole('form')).toBeNull();
    expect(link).toHaveFocus();
  });

  test('starts the thread as the HUD\'s character with an optional opening post, and goes to it', async () => {
    const w = threadWorld(3);
    const spun = vi.spyOn(w.fake, 'spin');
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'About post two');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spun).toHaveBeenCalledWith(w.ids[1], w.pipe, 'About post two', ''));
    const made = await waitFor(async () => {
      const found = (await w.fake.spunFrom(w.ids[1]!))[0];
      expect(found).toBeDefined();
      return found!;
    });
    await waitFor(() => expect(window.location.pathname).toBe(`/t/${made.id}`));
    expect(made.title).toBe('About post two');
  });

  test('a swap of the HUD\'s character mid-form needs the press again, like the reply box', async () => {
    const w = threadWorld(3);
    const spun = vi.spyOn(w.fake, 'spin');
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Mask check');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    expect(await within(form).findByText(/now posting as/u)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: /Confirm posting as Zed/u }));
    expect(spun).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spun).toHaveBeenCalledWith(w.ids[1], w.zed, 'Mask check', ''));
  });

  test('a refusal is shown in the server\'s words and the form keeps what was written', async () => {
    const w = threadWorld(3);
    vi.spyOn(w.fake, 'spin').mockResolvedValue({ ok: false, error: 'a title is at most 40 characters' });
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Keep me');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('a title is at most 40 characters');
    expect(within(form).getByLabelText('Thread title')).toHaveValue('Keep me');
    expect(window.location.pathname).toBe(`/t/${w.thread}`);
  });
});

async function spinFrom(w: ReturnType<typeof threadWorld>, origin: string, title = 'Spun off', body = 'Taking this elsewhere.') {
  const made = await w.fake.spin(origin, w.zed, title, body);
  if (!made.ok) throw new Error(made.error);
  return made.value.thread.id;
}
const openSpun = (w: ReturnType<typeof threadWorld>, thread: string) =>
  renderIn(w.fake, <ThreadScreen thread={thread} />, { path: `/t/${thread}` });
/** The marks in the ORIGIN box, in the order they are drawn: each card and how many plays of it. */
const marks = (box: HTMLElement) => [...box.querySelectorAll('.kb-mark[data-kb-card]')].map((el) => `${el.getAttribute('data-kb-card')}:${el.getAttribute('data-kb-plays')}`);
const origin = () => screen.findByRole('group', { name: 'Origin' });

describe('the ORIGIN box', () => {
  test('shows the origin Act, links back to it, and says what it came from', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    expect(within(box).getByText('ORIGIN')).toBeInTheDocument();
    expect(within(box).getByRole('link', { name: /#2 in A short thread/u })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
    await waitFor(() => expect(box).toHaveTextContent('post 2'));
    await waitFor(() => expect(box).toHaveTextContent('Pipewrench'));
  });

  test('shows an edit made to its Act after the spin, in place, with Last edited and a History', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('post 2'));
    expect(box).not.toHaveTextContent('Last edited');
    await act(async () => {
      w.fake.clock.advance(10 * 60_000);
      await w.fake.edit(w.ids[1]!, w.pipe, 'post 2, rewritten');
    });
    await waitFor(() => expect(box).toHaveTextContent('post 2, rewritten'));
    expect(box).toHaveTextContent('Last edited');
    await userEvent.click(within(box).getByRole('button', { name: 'History' }));
    expect(within(await within(box).findByRole('list', { name: 'Versions of this post, oldest first' })).getAllByRole('listitem')).toHaveLength(2);
  });

  test('reads the Act as it is now when the thread opens after an edit', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    w.fake.clock.advance(10 * 60_000);
    await w.fake.edit(w.ids[1]!, w.pipe, 'already changed');
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('already changed'));
    expect(box).not.toHaveTextContent('post 2,');
  });

  test('shows the card plays on the Act as a mark, and one that is played later joins it', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, w.ids[1]!);
    const listeners: ThreadListener[] = [];
    const real = w.fake.subscribeThread.bind(w.fake);
    w.fake.subscribeThread = (t, l) => { if (t === w.thread) listeners.push(l); return real(t, l); };
    openSpun(w, spun);
    const box = await origin();
    expect(await within(box).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' })).toBeInTheDocument();
    const [original] = await w.fake.acts(w.thread, 2, 2);
    const played: Act = { ...original!, id: '99999999-0000-4000-8000-000000000001', kind: 'card', character: w.spritey, targetActId: w.ids[1]!, seq: null, payload: { card: 'whoops', layer: 2, message: 'again' }, currentPayload: { card: 'whoops', layer: 2, message: 'again' } };
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    await act(async () => { for (const l of listeners) l.onAct?.(played); });
    await waitFor(() => expect(box.querySelector('.kb-mark')).toHaveAttribute('data-kb-plays', '2'));
    /* A card played on some other Act is no effect of this one. */
    await act(async () => { for (const l of listeners) l.onAct?.({ ...played, id: '99999999-0000-4000-8000-000000000002', targetActId: w.ids[0]!, payload: { card: 'whoops', message: 'elsewhere' } }); });
    expect(box.querySelector('.kb-mark')).toHaveAttribute('data-kb-plays', '2');
  });

  test('draws the origin\'s card effects around its words, as the thread does', async () => {
    const w = threadWorld(3);
    const played = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, w.ids[1]!);
    renderIn(w.fake, <ThreadScreen thread={spun} />, {
      path: `/t/${spun}`,
      cards: [{
        key: 'whoops', art: { color: '#000000', ink: '#ffffff' }, describe: () => 'x',
        Effect: ({ plays, reader, place, children }) => <div data-testid="fx" data-plays={plays.map((p) => p.id).join(',')} data-author={String(reader.author)} data-place={place}>{children}</div>,
      }],
    });
    const wrapped = await within(await origin()).findByTestId('fx');
    expect(wrapped).toHaveTextContent('post 2');
    expect(wrapped.dataset.plays).toBe(played);
    /* The reader's own character wrote post 2, and the box says it is drawn as an origin. */
    expect([wrapped.dataset.author, wrapped.dataset.place]).toEqual(['true', 'origin']);
  });

  test('draws no slot for an effect, beside the ORIGIN box or on the spin\'s own post: an effect says its state with `show`', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, w.ids[1]!);
    renderIn(w.fake, <ThreadScreen thread={spun} />, {
      path: `/t/${spun}`,
      cards: [{
        key: 'whoops', art: { color: '#000000', ink: '#ffffff' }, describe: () => 'x',
        Effect: ({ children }) => <>{children}</>,
      }],
    });
    await origin();
    const first = await screen.findByRole('article', { name: /^Post 1 /u });
    expect(first).toHaveAttribute('data-kb-kind', 'spin');
    expect(first.querySelector('.kb-act-slot')).toBeNull();
    expect(document.querySelector('.kb-act-slot')).toBeNull();
  });

  test('a card with no CardUi draws the origin\'s words untouched, with its mark', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    expect(await within(box).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' })).toBeInTheDocument();
    expect(box).toHaveTextContent('post 2');
  });

  test('a spin of a card Act or of The System\'s tally shows that Act in the box', async () => {
    const w = threadWorld(3);
    const card = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const said = w.fake.seed.thread('the-system', null, 'The tally', 'Settled in your favor.');
    const fromCard = await spinFrom(w, card, 'About that card');
    const fromSystem = await spinFrom(w, said.act, 'About the tally');
    openSpun(w, fromCard);
    expect(await within(await origin()).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' })).toBeInTheDocument();
    document.body.innerHTML = '';
    openSpun(w, fromSystem);
    expect(await within(await origin()).findByText('Settled in your favor.')).toBeInTheDocument();
  });

  test('is a live view that a thread subscription keeps, and lets go when the thread is left', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const real = w.fake.subscribeThread.bind(w.fake);
    let open = 0;
    const topics: string[] = [];
    w.fake.subscribeThread = (t, l) => { topics.push(t); open += 1; const un = real(t, l); return () => { open -= 1; un(); }; };
    const view = openSpun(w, spun);
    const box = await origin();
    /* The box subscribes in an effect, which can run after its first paint; its Act's words come
       only from that effect's read, so once they show, the effect has run. */
    await waitFor(() => expect(box).toHaveTextContent('post 2'));
    /* One subscription to the origin's thread (the spun thread's own channel is the screen's, not the box's). */
    expect(topics.filter((t) => t === w.thread)).toHaveLength(1);
    view.unmount();
    expect(open).toBe(0);
  });

  test('an origin that is not there says so, with the way back, and does not stay on "Loading"', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const real = w.fake.act.bind(w.fake);
    vi.spyOn(w.fake, 'act').mockImplementation(async (id) => (id === w.ids[1] ? null : real(id)));
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('The Act this thread was spun from is not there.'));
    expect(box).not.toHaveTextContent('Loading the origin');
    expect(within(box).getByRole('link', { name: /#2 in A short thread/u })).toBeInTheDocument();
  });

  test('an origin that fails to load says so and offers Try again', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const real = w.fake.act.bind(w.fake);
    const failing = vi.spyOn(w.fake, 'act').mockImplementation(async (id) => { if (id === w.ids[1]) throw new Error('down'); return real(id); });
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('could not be read'));
    failing.mockImplementation(real);
    await userEvent.click(within(box).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(box).toHaveTextContent('post 2'));
    expect(box).not.toHaveTextContent('could not be read');
  });

  test('reads its plays\' tallies and the player\'s own reactions to them in one read each, and bills them the way the thread does', async () => {
    const w = threadWorld(3);
    const early = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'early' });
    w.fake.clock.advance(60_000);
    const middle = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'middle', layer: 2 });
    w.fake.clock.advance(60_000);
    const late = w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'late' });
    w.fake.seed.react(w.me, w.pipe, middle, 'fire');
    const spun = await spinFrom(w, w.ids[1]!);
    const tallies = vi.spyOn(w.fake, 'tallies');
    const own = vi.spyOn(w.fake, 'myReactions');
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelectorAll('.kb-mark')).toHaveLength(2));
    /* The middle play has drawn a reaction, so it is billed first, then the newest: the card of the middle play leads, with the early one behind it, and the newest card is second. */
    expect(marks(box)).toEqual(['whoops:2', 'stick-around:1']);
    const forPlays = (spy: typeof tallies | typeof own) => spy.mock.calls.filter(([ids]) => ids.includes(early));
    expect(forPlays(tallies)).toHaveLength(1);
    expect(forPlays(tallies)[0]![0]).toContain(late);
    expect(forPlays(own)).toHaveLength(1);
    expect(forPlays(own)[0]![0]).toContain(late);
  });

  test('a reaction to a play on the origin counts on its mark here, live, and moves no mark', async () => {
    const w = threadWorld(3);
    const early = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'early' });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'late' });
    const spun = await spinFrom(w, w.ids[1]!);
    const listeners: ThreadListener[] = [];
    const real = w.fake.subscribeThread.bind(w.fake);
    w.fake.subscribeThread = (t, l) => { if (t === w.thread) listeners.push(l); return real(t, l); };
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelectorAll('.kb-mark')).toHaveLength(2));
    expect(marks(box)).toEqual(['stick-around:1', 'whoops:1']);
    /* The play has drawn more than the Act it landed on, so its card's mark says so; no mark moves. */
    await act(async () => { for (const l of listeners) l.onTally?.(early, { fire: 3 }); });
    await waitFor(() => expect(box.querySelector('[data-kb-card="whoops"]')).toHaveAccessibleName(/One has more reactions than the post\.$/u));
    expect(marks(box)).toEqual(['stick-around:1', 'whoops:1']);
  });

  test('a mark in the box opens the Lens, whose tabs and Who rows are reached by keyboard and by pointer, and whose React reacts to the play (#105)', async () => {
    const w = threadWorld(3);
    const play = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'late' });
    const spun = await spinFrom(w, w.ids[1]!);
    const react = vi.spyOn(w.fake, 'react');
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelectorAll('.kb-mark')).toHaveLength(2));
    const mark = await within(box).findByRole('button', { name: /^Whoops!, 1 play\..*Opens the cards on this post\./u });
    await userEvent.click(mark);
    const lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    expect(lens).toHaveAttribute('aria-modal', 'false');
    /* Nothing is made inert: the box and the page stay live under it. */
    expect(document.querySelector('[inert]')).toBeNull();
    const tabs = within(lens).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    /* By keyboard: the arrow moves to the other tab and the Who disclosure opens with Enter. */
    expect(tabs.find((t) => t.getAttribute('aria-selected') === 'true')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowLeft}');
    const mine = within(lens).getByRole('tab', { selected: true });
    expect(mine).toHaveTextContent('Whoops!');
    const who = within(lens).getByRole('button', { name: /^1 play · Spritey/u });
    who.focus();
    await userEvent.keyboard('{Enter}');
    expect(who).toHaveAttribute('aria-expanded', 'true');
    const row = lens.querySelector<HTMLElement>(`[data-kb-play="${play}"]`)!;
    expect(row).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Go to post' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
    /* By pointer: the other tab, then back, and a row's React. */
    await userEvent.click(within(lens).getByRole('tab', { name: 'stick-around' }));
    expect(within(lens).getByRole('tab', { name: 'stick-around', selected: true })).toBeInTheDocument();
    await userEvent.click(within(lens).getByRole('tab', { name: 'Whoops!' }));
    /* Who stays unfolded across the tabs. */
    expect(within(lens).getByRole('button', { name: /^1 play · Spritey/u })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(within(lens).getByRole('button', { name: 'React' }));
    const picker = screen.getByRole('dialog', { name: 'React to Spritey\'s Whoops!' });
    await userEvent.click(within(picker).getByRole('button', { name: 'Tea, Calm' }));
    await waitFor(() => expect(react).toHaveBeenCalledWith(play, w.pipe, 'tea'));
  });

  test('the second tab\'s Who rows are reached by keyboard alone, down to their buttons', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    w.fake.clock.advance(60_000);
    const late = w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'late' });
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelectorAll('.kb-mark')).toHaveLength(2));
    await userEvent.click(await within(box).findByRole('button', { name: /^Whoops!, 1 play\./u }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    await userEvent.keyboard('{ArrowRight}');
    expect(within(lens).getByRole('tab', { name: 'stick-around', selected: true })).toHaveFocus();
    const who = within(lens).getByRole('button', { name: /^1 play · Spritey/u });
    for (let i = 0; i < 4 && document.activeElement !== who; i++) await userEvent.tab();
    expect(document.activeElement).toBe(who);
    await userEvent.keyboard('{Enter}');
    const row = lens.querySelector<HTMLElement>(`[data-kb-play="${late}"]`)!;
    expect(row).toBeInTheDocument();
    const reached = new Set<string>();
    for (let i = 0; i < 8 && !reached.has('Go to post'); i++) {
      await userEvent.tab();
      const el = document.activeElement as HTMLElement;
      if (row.contains(el)) reached.add(el.textContent ?? '');
    }
    expect([...reached]).toEqual(expect.arrayContaining(['Spin thread', 'Go to post']));
  });

  test('Spin thread from a row in the box opens a form of the box\'s own, under it, named for the play', async () => {
    const w = threadWorld(3);
    const play = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, w.ids[1]!);
    const spin = vi.spyOn(w.fake, 'spin');
    openSpun(w, spun);
    const box = await origin();
    await userEvent.click(await within(box).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    await userEvent.click(within(lens).getByRole('button', { name: /^1 play · Spritey/u }));
    await userEvent.click(within(lens).getByRole('button', { name: 'Spin thread' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const form = screen.getByRole('form', { name: 'Spin a thread from Spritey\'s Whoops!' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'About the oops');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spin).toHaveBeenCalledWith(play, w.pipe, 'About the oops', ''));
  });

  test('a spin of a card Act draws the play as the box\'s one mark, whose Lens goes to the post the play landed on', async () => {
    const w = threadWorld(3);
    const card = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const fromCard = await spinFrom(w, card, 'About that card');
    openSpun(w, fromCard);
    const box = await origin();
    await userEvent.click(await within(box).findByRole('button', { name: 'Whoops!, 1 play. Opens the cards on this post.' }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    await userEvent.click(within(lens).getByRole('button', { name: /^1 play · Spritey/u }));
    expect(lens.querySelector('blockquote')).toHaveTextContent('“oops”');
    await waitFor(() => expect(within(lens).getByRole('link', { name: 'Go to post' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`));
  });

  test('lists at most twenty card plays and says where the rest are', async () => {
    const w = threadWorld(3);
    for (let i = 0; i < 22; i++) w.fake.seed.card(w.zed, w.ids[1]!, 'whoops', { message: `play ${i}` });
    const spun = await spinFrom(w, w.ids[1]!);
    const asked = vi.spyOn(w.fake, 'cardsOn');
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('More than 20 cards were played'));
    expect(asked).toHaveBeenCalledWith(w.ids[1], 21);
    await waitFor(() => expect(box.querySelector('.kb-mark')).not.toBeNull());
    expect(Number(box.querySelector('.kb-mark')!.getAttribute('data-kb-plays'))).toBeLessThanOrEqual(20);
  });
});

describe('after a spin', () => {
  test('focus is on the new thread\'s ORIGIN box', async () => {
    const w = threadWorld(3);
    /* The address decides which thread is open, as the app's routes do. */
    function Routed() {
      const { path } = useLocation();
      return <><ThreadScreen thread={path.slice('/t/'.length)} /><Swapper /></>;
    }
    renderIn(w.fake, <Routed />, { path: `/t/${w.thread}` });
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Focus me');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    const box = await origin();
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box).toHaveAttribute('tabindex', '-1');
  });

  test('a spin whose answer was lost and did happen is found: the player goes to it, and nothing is spun twice', async () => {
    const w = threadWorld(3);
    const spun = vi.spyOn(w.fake, 'spin');
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Lost but made');
    w.fake.seed.loseNextAnswer(true);
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(window.location.pathname).not.toBe(`/t/${w.thread}`));
    expect(spun).toHaveBeenCalledTimes(1);
    expect((await w.fake.spunFrom(w.ids[1]!)).map((t) => t.title)).toEqual(['Lost but made']);
  });

  test('a spin that did not happen keeps the form and asks to spin again anyway', async () => {
    const w = threadWorld(3);
    const spun = vi.spyOn(w.fake, 'spin');
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Not made');
    w.fake.seed.loseNextAnswer(false);
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('look before you try again');
    expect(within(form).getByLabelText('Thread title')).toHaveValue('Not made');
    expect(window.location.pathname).toBe(`/t/${w.thread}`);
    await userEvent.click(within(form).getByRole('button', { name: 'Spin again anyway' }));
    await waitFor(() => expect(window.location.pathname).not.toBe(`/t/${w.thread}`));
    expect(spun).toHaveBeenCalledTimes(2);
    expect(await w.fake.spunFrom(w.ids[1]!)).toHaveLength(1);
  });

  test('the form keeps an empty status region mounted, filled when the character is swapped', async () => {
    const w = threadWorld(3);
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    const region = form.querySelector('[role="status"]')!;
    expect(region).toBeEmptyDOMElement();
    await userEvent.type(within(form).getByLabelText('Thread title'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Zed' }));
    await waitFor(() => expect(region).toHaveTextContent(/now posting as Zed/u));
  });
});

describe('Spun into', () => {
  test('lists under an origin the threads spun from it, with their reply counts, from one read for the page', async () => {
    const w = threadWorld(3);
    const first = await spinFrom(w, w.ids[1]!, 'Crimson Incident');
    await spinFrom(w, w.ids[1]!, 'Is Pipewrench a Heel?');
    await w.fake.post(first, w.zed, 'a reply', null);
    const many = vi.spyOn(w.fake, 'spunFromMany');
    const one = vi.spyOn(w.fake, 'spunFrom');
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    const line = await within(article).findByText(/Spun into:/u);
    expect(line.closest('p')).toHaveTextContent('↳ Spun into: Crimson Incident (1 reply) · Is Pipewrench a Heel? (0 replies)');
    expect(within(article).getByRole('link', { name: 'Crimson Incident' })).toHaveAttribute('href', `/t/${first}`);
    expect(many).toHaveBeenCalledTimes(1);
    expect(one).not.toHaveBeenCalled();
    expect(within(await screen.findByRole('article', { name: /^Post 3 /u })).queryByText(/Spun into/u)).toBeNull();
  });

  test('lists the first five and says "and N more"; the button reads that Act\'s whole list', async () => {
    const w = threadWorld(3);
    for (let i = 1; i <= 7; i++) await spinFrom(w, w.ids[1]!, `Spin number ${i}`);
    const one = vi.spyOn(w.fake, 'spunFrom');
    const many = vi.spyOn(w.fake, 'spunFromMany');
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    const line = (await within(article).findByText(/Spun into:/u)).closest('p')!;
    expect(within(line).getAllByRole('link').map((l) => l.textContent)).toEqual(['Spin number 1', 'Spin number 2', 'Spin number 3', 'Spin number 4', 'Spin number 5']);
    const more = within(line).getByRole('button', { name: 'Show the other 2 threads spun from this Act' });
    expect(more).toHaveTextContent('and 2 more');
    expect(one).not.toHaveBeenCalled();
    expect(many).toHaveBeenCalledWith(expect.any(Array), 400);
    await userEvent.click(more);
    await waitFor(() => expect(within(line).getAllByRole('link')).toHaveLength(7));
    expect(one).toHaveBeenCalledTimes(1);
    expect(within(line).queryByRole('button')).toBeNull();
  });
});
