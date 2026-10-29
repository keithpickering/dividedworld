import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openThread, threadWorld } from '../composer/support.tsx';
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
  test('is on every kind of Act, The System\'s board included', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.pipe, w.ids[1]!, 'whoops', { message: 'oops' });
    w.fake.seed.reveal(w.pipe, w.thread);
    openThread(w);
    for (const name of [/^Post 1 /u, /^Post 2 /u, /^Post 4 /u, /^Post 5 /u]) {
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
    expect(within(form).getByText('Spinning a thread from')).toBeInTheDocument();
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
    expect(box).toHaveTextContent('Pipewrench');
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

  test('lists the card plays on the Act as lines, and one that is played later joins them', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, w.ids[1]!);
    const listeners: ThreadListener[] = [];
    const real = w.fake.subscribeThread.bind(w.fake);
    w.fake.subscribeThread = (t, l) => { if (t === w.thread) listeners.push(l); return real(t, l); };
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('Spritey played Whoops! on post #2: “oops”'));
    const [original] = await w.fake.acts(w.thread, 2, 2);
    const played: Act = { ...original!, id: '99999999-0000-4000-8000-000000000001', kind: 'card', character: w.spritey, targetActId: w.ids[1]!, seq: 4, payload: { card: 'whoops', message: 'again' }, currentPayload: { card: 'whoops', message: 'again' } };
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    await act(async () => { for (const l of listeners) l.onAct?.(played); });
    await waitFor(() => expect(box).toHaveTextContent('Spritey played Whoops! on post #2: “again”'));
    /* A card played on some other Act is no effect of this one. */
    await act(async () => { for (const l of listeners) l.onAct?.({ ...played, id: '99999999-0000-4000-8000-000000000002', targetActId: w.ids[0]!, payload: { card: 'whoops', message: 'elsewhere' } }); });
    expect(box).not.toHaveTextContent('elsewhere');
  });

  test('a spin of a card Act or of The System\'s tally shows that Act in the box', async () => {
    const w = threadWorld(3);
    const card = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const said = w.fake.seed.thread('the-system', null, 'The tally', 'Settled in your favor.');
    const fromCard = await spinFrom(w, card, 'About that card');
    const fromSystem = await spinFrom(w, said.act, 'About the tally');
    openSpun(w, fromCard);
    expect(await within(await origin()).findByText(/Spritey played Whoops! on post #2/u)).toBeInTheDocument();
    document.body.innerHTML = '';
    openSpun(w, fromSystem);
    expect(await within(await origin()).findByText('Settled in your favor.')).toBeInTheDocument();
  });

  test('is a live view that a thread subscription keeps, and lets go when the thread is left', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const off = vi.fn();
    const real = w.fake.subscribeThread.bind(w.fake);
    const topics: string[] = [];
    w.fake.subscribeThread = (t, l) => { topics.push(t); const un = real(t, l); return () => { off(); un(); }; };
    const view = openSpun(w, spun);
    await origin();
    expect(topics).toContain(w.thread);
    view.unmount();
    expect(off).toHaveBeenCalledTimes(topics.length);
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
});
