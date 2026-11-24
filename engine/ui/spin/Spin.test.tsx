import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CARD_NOT_ON_POST } from './SpinForm.tsx';
import { Swapper, openThread, threadWorld } from '../composer/support.tsx';
import { landsOn, ok, type CardRules } from '../../rules/cards.ts';
import type { Instance } from '../../rules/types.ts';
import { createFake } from '../data/fake.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { useLocation } from '../router.tsx';
import type { Act, ThreadListener } from '../data/api.ts';
import { renderIn, testInstance } from '../test-world.tsx';
import type { CardUi, EffectProps } from '../cards/types.ts';
import { ThreadScreen } from '../thread/Thread.tsx';
import { LoadedThread } from '../loaded.tsx';
import { bodyOf, liftedOver } from '../cards/body.ts';
import { testGroups } from '../../rules/test-system.ts';

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
    const said = w.fake.seed.thread('announcements', null, 'The tally', 'Settled.');
    document.body.innerHTML = '';
    openThread({ ...w, thread: said.thread });
    expect(spinLink(await screen.findByRole('article', { name: /^Post 1 by the staff/u }))).toBeInTheDocument();
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

  test('sends the characters its opening post\'s counterfeit quotes name as framing', async () => {
    const w = threadWorld(3);
    const spun = vi.spyOn(w.fake, 'spin');
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Framed spin');
    await userEvent.click(within(form).getByLabelText('Your opening post (optional)'));
    await userEvent.paste(`[quote=Spritey user=${w.spritey}]Nope.[/quote]`);
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spun).toHaveBeenCalledWith(w.ids[1], w.pipe, 'Framed spin', expect.stringContaining('Nope.'), [w.spritey]));
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

describe('the spin form words a refusal that names a field', () => {
  const open = async (w: ReturnType<typeof threadWorld>) => {
    openThread(w);
    const article = await screen.findByRole('article', { name: /^Post 2 /u });
    await userEvent.click(spinLink(article));
    const form = within(article).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Keep me');
    return form;
  };

  test('a spin keeps its optional opening post, and words a title refusal and a body refusal with the field\'s label', async () => {
    const w = threadWorld(3);
    const spin = vi.spyOn(w.fake, 'spin').mockResolvedValueOnce({ ok: false, error: 'is longer than 40 characters', field: 'title' }).mockResolvedValueOnce({ ok: false, error: 'is longer than 9 characters', field: 'body' });
    const form = await open(w);
    expect(within(form).getByLabelText('Your opening post (optional)')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Spin thread' })).toBeEnabled();
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('The thread title is longer than 40 characters');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(within(form).getByRole('alert')).toHaveTextContent('Your opening post is longer than 9 characters'));
    expect(spin).toHaveBeenCalledTimes(2);
  });

  test('a refusal with no field, or another field, reads as the server said it', async () => {
    const w = threadWorld(3);
    vi.spyOn(w.fake, 'spin').mockResolvedValueOnce({ ok: false, error: 'sign in to act' }).mockResolvedValueOnce({ ok: false, error: 'is not an id', field: 'origin' });
    const form = await open(w);
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe('sign in to act'));
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe('is not an id'));
  });

  test('a field named like something every object has reads as the server said it too', async () => {
    const w = threadWorld(3);
    vi.spyOn(w.fake, 'spin').mockResolvedValueOnce({ ok: false, error: 'is not a field', field: 'constructor' });
    const form = await open(w);
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe('is not a field'));
  });
});

async function spinFrom(w: ReturnType<typeof threadWorld>, origin: string, title = 'Spun off', body = 'Taking this elsewhere.') {
  const made = await w.fake.spin(origin, w.zed, title, body);
  if (!made.ok) throw new Error(made.error);
  return made.value.thread.id;
}
const openSpun = (w: ReturnType<typeof threadWorld>, thread: string) =>
  renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}` });
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

  test('the head of a play-spun box names the play and where it landed, linked, and never reads "an Act"', async () => {
    const w = threadWorld(3);
    const card = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const fromCard = await spinFrom(w, card, 'About that card');
    openSpun(w, fromCard);
    const box = await origin();
    const head = box.querySelector('.kb-origin-head-text') as HTMLElement;
    await waitFor(() => expect(head).toHaveTextContent(/^ORIGIN · Spun from Whoops! on #2 in A short thread · as it landed · Reset$/u));
    expect(head).not.toHaveTextContent('an Act');
    expect(within(head).getByRole('link', { name: 'Whoops! on #2 in A short thread' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
  });

  test('the head of an update-spun box reads "the update" with its headline, linked to the Updates page', async () => {
    const w = threadWorld(3);
    const update = w.fake.seed.update({ title: 'Traps bite', body: 'Hi.' });
    const spun = await spinFrom(w, update, 'About the update');
    openSpun(w, spun);
    const box = await origin();
    const head = box.querySelector('.kb-origin-head-text') as HTMLElement;
    await waitFor(() => expect(head).toHaveTextContent(/Spun from the update “Traps bite”$/u));
    expect(within(head).getByRole('link', { name: 'the update “Traps bite”' })).toHaveAttribute('href', `/updates?update=${encodeURIComponent(update)}`);
  });

  test('with no place, the head reads "an Act" and the box says nothing about the rest of the cards', async () => {
    const w = threadWorld(3);
    for (let i = 0; i < 22; i++) w.fake.seed.card(w.zed, w.ids[1]!, 'whoops', { message: `play ${i}` });
    const spun = await spinFrom(w, w.ids[1]!);
    /* The page's document carries the thread's summary: its origin has no place. */
    const real = w.fake.threadPage.bind(w.fake);
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (id, ...rest) => {
      const got = await real(id, ...rest);
      return id === spun && got ? { ...got, thread: { ...got.thread, origin: null } } : got;
    });
    openSpun(w, spun);
    const box = await origin();
    const head = box.querySelector('.kb-origin-head-text') as HTMLElement;
    await waitFor(() => expect(head).toHaveTextContent(/^ORIGIN · Spun from an Act$/u));
    expect(within(head).queryByRole('link')).toBeNull();
    await waitFor(() => expect(box.querySelector('.kb-mark')).not.toBeNull());
    expect(box).not.toHaveTextContent('the rest are in');
  });

  test('a reversed play\'s end rides in the read but is no play: it is not read for tallies, and the box holds every play', async () => {
    const w = threadWorld(3);
    const plays = Array.from({ length: 20 }, (_, i) => w.fake.seed.card(w.zed, w.ids[1]!, 'whoops', { message: `play ${i}` }));
    const boss = w.fake.seed.account('boss', { admin: true });
    w.fake.signInAs(boss);
    const ended = await w.fake.reverseCard(plays[19]!);
    w.fake.signInAs(w.me);
    expect(ended.ok).toBe(true);
    expect((await w.fake.postPlays([w.ids[1]!])).plays.map((a) => a.kind).filter((k) => k === 'card_end')).toHaveLength(1);
    const spun = await spinFrom(w, w.ids[1]!);
    const tallies = vi.spyOn(w.fake, 'tallies');
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelectorAll('.kb-mark').length).toBeGreaterThan(0));
    expect(box).not.toHaveTextContent('More than 20 cards');
    expect(box.querySelector('.kb-origin-note')).toBeNull();
    const end = ended.ok ? ended.value.act : '';
    expect(tallies.mock.calls.some(([ids]) => ids.includes(end))).toBe(false);
  });

  test('a play on a target that cannot be placed is the words alone, in the head', async () => {
    const w = threadWorld(3);
    const card = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, card, 'About that card');
    const real = w.fake.threadPage.bind(w.fake);
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (id, ...rest) => {
      const got = await real(id, ...rest);
      return id === spun && got ? { ...got, thread: { ...got.thread, origin: { kind: 'play', card: 'whoops', on: null, from: null, at: null } } } : got;
    });
    openSpun(w, spun);
    const box = await origin();
    const head = box.querySelector('.kb-origin-head-text') as HTMLElement;
    await waitFor(() => expect(head).toHaveTextContent(/^ORIGIN · Spun from Whoops! · as it landed · Reset$/u));
    expect(within(head).queryByRole('link')).toBeNull();
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
    renderIn(w.fake, <LoadedThread thread={spun} />, {
      path: `/t/${spun}`,
      cards: [{
        key: 'whoops', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x',
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
    renderIn(w.fake, <LoadedThread thread={spun} />, {
      path: `/t/${spun}`,
      cards: [{
        key: 'whoops', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x',
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
    const said = w.fake.seed.thread('announcements', null, 'The tally', 'Settled in your favor.');
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

  test('bills its plays the way the thread does, from the tallies and reactions the page carried, with no read of its own', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'early' });
    w.fake.clock.advance(60_000);
    const middle = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'middle', layer: 2 });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'late' });
    w.fake.seed.react(w.me, w.pipe, middle, 'fire');
    const spun = await spinFrom(w, w.ids[1]!);
    const tallies = vi.spyOn(w.fake, 'tallies');
    const own = vi.spyOn(w.fake, 'myReactions');
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelectorAll('.kb-mark')).toHaveLength(2));
    /* The middle play has drawn a reaction, so it is billed first, then the newest: the card of the middle play leads, with the early one behind it, and the newest card is second. */
    expect(marks(box)).toEqual(['whoops:2', 'stick-around:1']);
    /* The page held them: nothing was asked for. */
    expect(tallies).not.toHaveBeenCalled();
    expect(own).not.toHaveBeenCalled();
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

  test('takes every play the page sent, counts the box\'s mark from the origin\'s counts, and says nothing of the rest', async () => {
    const w = threadWorld(3);
    for (let i = 0; i < 30; i++) w.fake.seed.card(w.zed, w.ids[1]!, 'whoops', { message: `play ${i}` });
    const spun = await spinFrom(w, w.ids[1]!);
    const real = w.fake.threadPage.bind(w.fake);
    let sent: readonly { readonly card: string | null; readonly all: number }[] = [];
    let held = 0;
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (id, ...rest) => {
      const got = await real(id, ...rest);
      if (id === spun && got?.origin) { sent = got.origin.counts; held = got.origin.plays.filter((a) => a.kind === 'card').length; }
      return got;
    });
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelector('.kb-mark')).not.toBeNull());
    expect(held).toBe(30);
    expect(sent.find((c) => c.card === 'whoops')?.all).toBe(30);
    await waitFor(() => expect(Number(box.querySelector('.kb-mark')!.getAttribute('data-kb-plays'))).toBe(30));
    expect(box).not.toHaveTextContent('More than 20 cards');
    expect(box.querySelector('.kb-origin-note')).toBeNull();
  });
});

/*
 * The ORIGIN box's content area (docs/plans/2026-11-15-origin-box-effects-design.md, sections 2 to 5): everything under the band stands in one
 * element that says so itself, so an effect in the box fills it border to border and finds it as it finds a post's body.
 */
describe('the ORIGIN box\'s content area', () => {
  const area = (box: HTMLElement) => box.querySelector<HTMLElement>('.kb-origin-area[data-kb-content-area]');
  /* The thread draws the box inside the opening post's body; a box with none around it is wrapped in a marked one, as that body is. */
  const outerBody = (box: HTMLElement): HTMLElement => {
    const own = box.closest<HTMLElement>('[data-kb-content-area]');
    if (own) return own;
    const wrap = document.createElement('div');
    wrap.className = 'kb-act-main';
    wrap.setAttribute('data-kb-content-area', '');
    box.parentNode!.insertBefore(wrap, box);
    wrap.appendChild(box);
    return wrap;
  };

  test('a post origin: the band, the byline in a band of its own (the owner, 2026-11-21: it is "not part of the post itself"), then one area holding the words, Last edited and History', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('post 2'));
    expect([...box.children].map((c) => c.className)).toEqual(['kb-origin-head', 'kb-origin-byline', 'kb-origin-area']);
    const inside = area(box)!;
    expect(inside, 'the box draws a .kb-origin-area[data-kb-content-area]').not.toBeNull();
    expect(box.querySelectorAll('[data-kb-content-area]')).toHaveLength(1);
    expect(inside).toContainElement(within(box).getByText('post 2'));
    const byline = box.querySelector('.kb-origin-byline')!;
    expect(byline, 'the byline holds the date').toContainElement(box.querySelector('time')!);
    expect(inside.contains(byline), 'the byline is outside the content area').toBe(false);
    expect(inside, 'a post\'s words keep a post\'s room').toHaveAttribute('data-kb-room');
    expect(inside).toContainElement(within(box).getByRole('button', { name: 'History' }));
    expect(box.querySelector('.kb-origin-head')!.closest('.kb-origin-area')).toBeNull();
  });

  test('an edited post origin: Last edited is inside the area, under the effect, and the box itself is what lifts over ink above it', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    await act(async () => {
      w.fake.clock.advance(10 * 60_000);
      await w.fake.edit(w.ids[1]!, w.pipe, 'post 2, rewritten');
    });
    await waitFor(() => expect(box).toHaveTextContent('Last edited'));
    const line = within(box).getByText(/Last edited/u);
    expect(area(box)!, 'Last edited is inside the area').toContainElement(line);
    expect(line.closest('[data-kb-over-ink]'), 'Last edited lies under the effect, not lifted over it').toBe(box);
  });

  test('the box\'s own effect finds the area as its body, and never the opening post\'s', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, w.ids[1]!);
    renderIn(w.fake, <LoadedThread thread={spun} />, {
      path: `/t/${spun}`,
      cards: [{
        key: 'whoops', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x',
        Effect: ({ place, children }) => <div data-testid="fx" data-place={place}>{children}</div>,
      }],
    });
    const box = await origin();
    const fx = await within(box).findByTestId('fx');
    const outer = outerBody(box);
    expect(fx.dataset.place).toBe('origin');
    expect(bodyOf(fx), 'the effect\'s body is the box\'s area').toBe(area(box));
    expect(bodyOf(fx)).not.toBe(outer);
  });

  test('a play-spun box and a character-spun box hold their moment in the area', async () => {
    const w = threadWorld(3);
    const play = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const landed = await spinFrom(w, play, 'About that card');
    openSpun(w, landed);
    const frame = await within(await origin()).findByRole('group', { name: /^As it landed/u });
    expect(frame.closest('.kb-origin-area'), 'the play\'s moment is inside the area').not.toBeNull();
    cleanup();
    const zedPost = w.fake.seed.post(w.thread, w.zed, 'zed words');
    const shine = w.fake.seed.reach(w.spritey, 'character', w.zed, 'whoops', { post: zedPost, ends: Date.now() + 86_400_000, message: 'Shine.' });
    const cast = await spinFrom(w, shine, 'About the shine');
    openSpun(w, cast);
    const mine = await within(await origin()).findByRole('group', { name: /^As it (landed|was spun)/u });
    expect(mine.closest('.kb-origin-area'), 'the character\'s moment is inside the area').not.toBeNull();
  });

  test('draws no area where nothing stands under the band: an origin that is a wash, and a play on a thread', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    /* Control: the same spin's live box, before the wash, has its area. */
    openSpun(w, spun);
    await waitFor(() => expect(area(document.body), 'a post origin draws an area').not.toBeNull());
    cleanup();
    const real = w.fake.threadPage.bind(w.fake);
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (id, ...rest) => {
      const got = await real(id, ...rest);
      return id === spun && got?.origin?.act ? { ...got, origin: { ...got.origin, act: { ...got.origin.act, kind: 'wash' } } } : got;
    });
    openSpun(w, spun);
    const washed = await origin();
    await waitFor(() => expect(washed.querySelector('.kb-origin-head')).not.toBeNull());
    expect(area(washed), 'a wash draws no area').toBeNull();
    cleanup();
    const glint = w.fake.seed.reach(w.spritey, 'thread', w.thread, 'whoops', { ends: Date.now() + 86_400_000 });
    const onThread = await spinFrom(w, glint, 'About that glint');
    openSpun(w, onThread);
    const box = await origin();
    await waitFor(() => expect(box.querySelector('[aria-busy="true"]')).toBeNull());
    expect(area(box), 'a play on a thread draws no area').toBeNull();
  });

  test('the History button and its panel are lifted over the effect; the byline and the words are lifted only by the box itself', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('post 2'));
    const inside = area(box)!;
    expect(inside, 'the box draws an area').not.toBeNull();
    const button = within(box).getByRole('button', { name: 'History' });
    const words = within(box).getByText('post 2');
    const byline = box.querySelector('time')!;
    expect(box).toHaveAttribute('data-kb-over-ink');
    expect(inside.contains(button.closest('[data-kb-over-ink]')), 'the button\'s lifted element is inside the area').toBe(true);
    expect(byline.closest('[data-kb-over-ink]')).toBe(box);
    expect(words.closest('[data-kb-over-ink]')).toBe(box);
    expect(liftedOver(words, inside)).toBe(false);
    expect(liftedOver(button, inside)).toBe(true);
    expect(liftedOver(words, outerBody(box))).toBe(true);
    /* The panel's wrapper is in the area and lifted, and holds nothing (so draws and covers nothing, its ground being on its content) until History is opened. */
    const lift = inside.querySelector<HTMLElement>('.kb-origin-lift');
    expect(lift, 'the History panel is in a .kb-origin-lift').not.toBeNull();
    expect(lift).toHaveAttribute('data-kb-over-ink');
    expect(lift!.textContent).toBe('');
    await userEvent.click(button);
    await waitFor(() => expect(lift!.textContent).not.toBe(''));
    expect(liftedOver(lift!.firstElementChild, inside)).toBe(true);
  });
});

/*
 * A thread spun from a card play on a post draws that play's moment in its ORIGIN box (docs/plans/2026-11-03-effect-history-plan.md,
 * Task 6): the post as it read when the play landed, each play under it as it stood, run at the moment, under the mark the box shows. The
 * test instance's Whoops! here stacks three (so a moment draws it), and its Stick Around lifts the post (so a moment names it).
 */
describe('the ORIGIN box of a play-spun thread', () => {
  const momentInstance = {
    ...testInstance,
    cards: [{ ...testInstance.cards[0]!, stack: 3 }, { ...testInstance.cards[0]!, key: 'stick-around', name: 'Stick Around' }],
  };
  function Washy({ plays, states, still, moment, show, children }: EffectProps) {
    const washed = plays.map((p) => (states[p.id]?.state as { washed?: number } | undefined)?.washed ?? 0).join();
    useEffect(() => { show({ progress: null, state: `washed ${washed}`, yours: false, controls: [], notes: {} }); }, [show, washed]);
    return <div data-kb-washy={moment ? 'moment' : 'live'} data-kb-still={String(still)} data-kb-washed={washed}>{children}</div>;
  }
  const Lift = ({ children }: EffectProps) => <div data-kb-lift>{children}</div>;
  const momentCards: CardUi[] = [
    { key: 'whoops', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x', Effect: Washy },
    { key: 'stick-around', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x', Effect: Lift, takeover: true },
  ];
  /* Post 2 is the reader's own: its Whoops! washed 40% and saved, then Stick Around cast on it, and a thread spun from that. */
  async function spunFromHold() {
    const w = threadWorld(3);
    const wash = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const saved = await w.fake.saveEffect(wash, w.pipe, { washed: 0.4 });
    if (!saved.ok) throw new Error(saved.error);
    w.fake.clock.advance(60_000);
    const hold = w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'read it' });
    const spun = await spinFrom(w, hold, 'About that hold');
    return { w, wash, hold, spun };
  }
  const openWith = (w: ReturnType<typeof threadWorld>, thread: string) =>
    renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: momentInstance, cards: momentCards });

  test('draws the play\'s moment under its mark: the Whoops! still at its 40%, framed by the box alone, and Stick Around not named beside itself', async () => {
    const { w, spun } = await spunFromHold();
    openWith(w, spun);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it landed/u });
    await waitFor(() => expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4'));
    expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washy', 'moment');
    expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-still', 'false');
    expect(within(frame).getByText('post 2')).toBeInTheDocument();
    /* The play is the box's mark and its head's; the head says "as it landed", so the frame draws no ring or tag of its own. */
    expect(within(frame).queryByText(/Also on the post then/u)).toBeNull();
    expect(box.querySelector('.kb-origin-head-text')!.textContent).toMatch(/ · as it landed · Reset$/u);
    expect(frame.querySelector('.kb-moment-ring, .kb-moment-tag')).toBeNull();
    expect(within(frame).queryByRole('button', { name: 'Back to now' })).toBeNull();
    /* The box has a mark for each card drawn in the moment (Whoops!) and for the spun play's own (Stick Around), and Go to post still leads to the post as it is now. */
    expect(marks(box).sort()).toEqual(['stick-around:1', 'whoops:1']);
  });

  test('the head has Reset, and pressing it remounts the box\'s effect from the same moment, with focus kept and the moment read once', async () => {
    const { w, spun } = await spunFromHold();
    const read = vi.spyOn(w.fake, 'playMoment');
    openWith(w, spun);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it landed/u });
    await waitFor(() => expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4'));
    const before = frame.querySelector('[data-kb-washy]');
    const head = box.querySelector('.kb-origin-head-text')!;
    const reset = within(head as HTMLElement).getByRole('button', { name: 'Reset' });
    await userEvent.click(reset);
    await waitFor(() => expect(frame.querySelector('[data-kb-washy]')).not.toBe(before));
    expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4');
    expect(document.activeElement).toBe(within(head as HTMLElement).getByRole('button', { name: 'Reset' }));
    expect(within(box).getByRole('status').textContent).toBe('As it landed again.');
    /* A second press is said again, by a no-break space on the end. */
    await userEvent.click(within(head as HTMLElement).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(within(box).getByRole('status').textContent).toBe('As it landed again. '));
    expect(read).not.toHaveBeenCalled();
  });

  test('what the moment says under its post stands in a foot of the box, outside the content area, and ends "Nothing you do to this post is saved."', async () => {
    const { w, spun } = await spunFromHold();
    openWith(w, spun);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it landed/u });
    await waitFor(() => expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4'));
    const list = await within(box).findByText('Nothing you do to this post is saved.');
    expect(box.querySelector('.kb-origin-area')!.contains(list), 'the list is not inside the content area').toBe(false);
    expect(list.closest('.kb-origin-foot'), 'the list stands in the box\'s foot').not.toBeNull();
    expect(list.closest('.kb-origin')).toBe(box);
    expect([...box.children].map((c) => c.className)).toEqual(['kb-origin-head', 'kb-origin-area', 'kb-origin-foot']);
  });

  test('a box spun from a post has no Reset, and neither has a box with no moment to show', async () => {
    const { w } = await spunFromHold();
    const fromPost = await spinFrom(w, w.ids[1]!, 'About the post');
    const first = openWith(w, fromPost);
    const live = await origin();
    await waitFor(() => expect(live.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washy', 'live'));
    expect(within(live).queryByRole('button', { name: 'Reset' })).toBeNull();
    first.unmount();

    const none = await spunFromHold();
    /* The page carries the box's moment: the page that says none is the box with no moment to show. */
    const page = none.w.fake.threadPage.bind(none.w.fake);
    vi.spyOn(none.w.fake, 'threadPage').mockImplementation(async (...args) => {
      const got = await page(...args);
      return got && got.origin ? { ...got, origin: { ...got.origin, moment: null } } : got;
    });
    openWith(none.w, none.spun);
    const box = await origin();
    await within(box).findByText('This play has no moment to show.');
    expect(within(box).queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  /* A moment drawing two cards: Smear played first, then the Whoops! the thread is spun from. Each effect says a view with one control. */
  const presses = { smear: vi.fn(), whoops: vi.fn() };
  const Controlled = (key: 'smear' | 'whoops') => function Effect({ show, children }: EffectProps) {
    useEffect(() => { show({ progress: null, state: `${key} view`, yours: false, controls: [{ kind: 'press', label: `${key} press`, run: presses[key] }], notes: {} }); }, [show]);
    return <div data-kb-controlled={key}>{children}</div>;
  };
  const twoInstance = { ...testInstance, cards: [{ ...testInstance.cards[0]!, stack: 3 }, { ...testInstance.cards[0]!, key: 'smear', name: 'Smear', stack: 3 }] };
  const twoCards: CardUi[] = [
    { key: 'whoops', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x', Effect: Controlled('whoops') },
    { key: 'smear', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x', Effect: Controlled('smear') },
  ];
  async function spunFromTwo() {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'smear', { message: 'smeared' });
    w.fake.clock.advance(60_000);
    const spunPlay = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, spunPlay, 'About that wash');
    return { w, spun };
  }
  const openTwo = (w: ReturnType<typeof threadWorld>, thread: string) =>
    renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: twoInstance, cards: twoCards });

  test("a moment that draws two cards shows two marks; the spun play's row keeps React and Spin thread, the other's has neither and Go to post, with its effect's controls in the Act section", async () => {
    const { w, spun } = await spunFromTwo();
    /* An admin sees End this card on a live play's row, and on none of the moment's other rows. */
    w.fake.seed.admin(w.me);
    openTwo(w, spun);
    const box = await origin();
    await waitFor(() => expect(marks(box).sort()).toEqual(['smear:1', 'whoops:1']));
    await userEvent.click(within(box).getByRole('button', { name: /^Smear, 1 play/u }));
    let lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    expect(await within(lens).findByText('smear view')).toBeInTheDocument();
    await userEvent.click(within(lens).getByRole('button', { name: 'smear press' }));
    expect(presses.smear).toHaveBeenCalledTimes(1);
    const smearFold = within(lens).getByRole('button', { name: /^1 play · Spritey/u });
    expect(smearFold).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(smearFold);
    expect(smearFold).toHaveAttribute('aria-expanded', 'true');
    expect(within(lens).queryByRole('button', { name: 'React' })).toBeNull();
    expect(within(lens).queryByRole('button', { name: 'Spin thread' })).toBeNull();
    expect(within(lens).queryByRole('button', { name: 'As it landed' })).toBeNull();
    expect(within(lens).queryByRole('button', { name: 'End this card' })).toBeNull();
    expect(within(lens).getByRole('link', { name: 'Go to post' })).toHaveAttribute('href', threadHref(w.thread, pageOf(2, 20), 2));
    await userEvent.click(within(box).getByRole('button', { name: /^Smear, 1 play/u }));
    await userEvent.click(within(box).getByRole('button', { name: /^Whoops!?, 1 play/u }));
    lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    expect(await within(lens).findByText('whoops view')).toBeInTheDocument();
    const fold = within(lens).getByRole('button', { name: /^1 play · Spritey/u });
    /* The spun play's row is open on its own (the box's own play), the other's is folded until pressed. */
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    expect(within(lens).getByRole('button', { name: 'React' })).toBeEnabled();
    expect(within(lens).getByRole('button', { name: 'Spin thread' })).toBeInTheDocument();
    expect(within(lens).getByRole('button', { name: 'End this card' })).toBeInTheDocument();
  });

  test('a moment that draws only the spun play shows one mark, as before', async () => {
    const w = threadWorld(3);
    const only = w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'oops' });
    const spun = await spinFrom(w, only, 'About that wash');
    openTwo(w, spun);
    const box = await origin();
    await within(box).findByRole('group', { name: /^As it landed/u });
    await settle();
    expect(marks(box)).toEqual(['whoops:1']);
  });

  test("the adding effect running twice in one mount (StrictMode) adds the moment's plays once", async () => {
    const { w, spun } = await spunFromTwo();
    renderIn(w.fake, <StrictMode><LoadedThread thread={spun} /></StrictMode>, { path: `/t/${spun}`, instance: twoInstance, cards: twoCards });
    const box = await origin();
    await waitFor(() => expect(marks(box).sort()).toEqual(['smear:1', 'whoops:1']));
    await settle();
    /* A play added twice would be two plays on its mark. */
    expect(marks(box).sort()).toEqual(['smear:1', 'whoops:1']);
  });

  test('a later wash on the live post leaves the box as it was, read once', async () => {
    const { w, wash, spun } = await spunFromHold();
    const read = vi.spyOn(w.fake, 'playMoment');
    openWith(w, spun);
    const frame = await within(await origin()).findByRole('group', { name: /^As it landed/u });
    await waitFor(() => expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4'));
    await w.fake.saveEffect(wash, w.pipe, { washed: 1 });
    w.fake.seed.effect(w.thread, wash);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4');
    expect(read).not.toHaveBeenCalled();
  });

  test('a thread spun from a play on a thread keeps today\'s box: no mark, with no moment read or drawn and no second head line', async () => {
    const w = threadWorld(3);
    const glint = w.fake.seed.reach(w.spritey, 'thread', w.thread, 'whoops', { ends: Date.now() + 86_400_000 });
    const read = vi.spyOn(w.fake, 'playMoment');
    const spun = await spinFrom(w, glint, 'About that glint');
    openWith(w, spun);
    const box = await origin();
    /* Today's box: the play's Act read, and no moment drawn or read for it. */
    await waitFor(() => expect(box.querySelector('[aria-busy="true"]')).toBeNull());
    expect(within(box).queryByRole('group', { name: /^As it landed/u })).toBeNull();
    expect(within(box).queryByText(/Cast from/u)).toBeNull();
    /* As on main: a thread's play draws no mark of its own in the box. */
    expect(marks(box)).toEqual([]);
    expect(box.querySelector('.kb-origin-head-text')!.textContent).not.toMatch(/as it (landed|was spun)/u);
    expect(read).not.toHaveBeenCalled();
  });

  test('a thread spun from a post keeps its live box, with no moment', async () => {
    const { w } = await spunFromHold();
    const spun = await spinFrom(w, w.ids[1]!, 'About the post');
    openWith(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washy', 'live'));
    expect(within(box).queryByRole('group', { name: /^As it landed/u })).toBeNull();
  });

  test('in a post-spun box, As it landed in a play\'s Lens row draws that play\'s moment in the box, and Back to now the live post again', async () => {
    const { w, wash } = await spunFromHold();
    /* The wash is taken further after the hold landed: the live post is at 100%, the hold's moment at 40%. */
    await w.fake.saveEffect(wash, w.pipe, { washed: 1 });
    const spun = await spinFrom(w, w.ids[1]!, 'About the post');
    openWith(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '1'));
    await userEvent.click(await within(box).findByRole('button', { name: /^Stick Around, 1 play/u }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    await userEvent.click(within(lens).getByRole('button', { name: /^1 play · Spritey/u }));
    await userEvent.click(within(lens).getByRole('button', { name: 'As it landed' }));
    const frame = await within(box).findByRole('group', { name: /^As it landed/u });
    await waitFor(() => expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4'));
    expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washy', 'moment');
    /* The moment is drawn in the box's content area, and only one Whoops! is drawn there: the live one is replaced, not covered. */
    expect(frame.closest('[data-kb-content-area]')).toBe(box.querySelector('.kb-origin-area'));
    expect(box.querySelectorAll('[data-kb-washy]')).toHaveLength(1);
    /* Its tag stands at the top of the moment, in its flow: the box's area is no post's body, and the date bar of the post the box stands in is not its bar. */
    expect(frame.querySelector('.kb-moment-tag')).not.toHaveAttribute('data-kb-hung');
    await userEvent.click(within(frame).getByRole('button', { name: 'Back to now' }));
    await waitFor(() => expect(within(box).queryByRole('group', { name: /^As it landed/u })).toBeNull());
    expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '1');
  });

  test('the box\'s mark opens a Lens that makes nothing inert and offers no As it landed, since the box shows it (#105)', async () => {
    const { w, spun } = await spunFromHold();
    openWith(w, spun);
    const box = await origin();
    await within(box).findByRole('group', { name: /^As it landed/u });
    await userEvent.click(await within(box).findByRole('button', { name: /^Stick Around, 1 play/u }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this post' });
    await userEvent.click(within(lens).getByRole('button', { name: /^1 play · Spritey/u }));
    expect(document.querySelector('[inert]')).toBeNull();
    expect(within(lens).queryByRole('button', { name: 'As it landed' })).toBeNull();
    expect(within(lens).getByRole('button', { name: 'React' })).toBeEnabled();
  });
});

/*
 * The box arrives with the page (docs/plans/2026-11-14-origin-in-page-design.md, section 5): the page's document holds the origin Act, its
 * plays, their ends, the moment and the characters, so the box reads nothing after the page, is never "Loading the origin…", and takes in
 * a page read again.
 */
const BOX_READS = ['act', 'postPlays', 'tallies', 'myReactions', 'spunFromMany', 'spunFrom', 'effectStates', 'myReleases', 'characters', 'actsById', 'playMoment', 'spinMoment'] as const;
/** A spy on each read the box made before it arrived with the page, on the fake the screen is drawn from. */
function spyOnBoxReads(fake: object) {
  const table = fake as Record<string, (...args: unknown[]) => unknown>;
  return BOX_READS.map((name) => ({ name, spy: vi.spyOn(table, name) }));
}
const readsMade = (spies: ReturnType<typeof spyOnBoxReads>) => spies.filter(({ spy }) => spy.mock.calls.length > 0).map(({ name, spy }) => `${name}(${spy.mock.calls.length})`);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

describe('the ORIGIN box arrives with the page', () => {
  const momentInstance = { ...testInstance, cards: [{ ...testInstance.cards[0]!, stack: 3 }, { ...testInstance.cards[0]!, key: 'stick-around', name: 'Stick Around' }] };
  const Still = ({ children }: EffectProps) => <div>{children}</div>;
  const cards: CardUi[] = [
    { key: 'whoops', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x', Effect: Still },
    { key: 'stick-around', art: { color: '#000000', ink: '#ffffff', canvas: '', mark: '', credit: 'Test' }, describe: () => 'x', Effect: Still, takeover: true },
  ];
  const openWith = (w: ReturnType<typeof threadWorld>, thread: string) =>
    renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: momentInstance, cards });
  /** The listeners of the origin thread's channel: what the box hears. */
  function tap(w: ReturnType<typeof threadWorld>) {
    const listeners: ThreadListener[] = [];
    const real = w.fake.subscribeThread.bind(w.fake);
    w.fake.subscribeThread = (t, l) => { if (t === w.thread) listeners.push(l); return real(t, l); };
    return listeners;
  }
  const playAct = async (w: ReturnType<typeof threadWorld>, id: string, caster: string, card = 'whoops'): Promise<Act> => {
    const [original] = await w.fake.acts(w.thread, 2, 2);
    return { ...original!, id, kind: 'card', character: caster, targetActId: w.ids[1]!, seq: null, payload: { card, layer: 2, message: 'again' }, currentPayload: { card, layer: 2, message: 'again' } };
  };

  test('a thread spun from a post with plays draws its words, its tags and no read after the page', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'early' });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'late' });
    const spun = await spinFrom(w, w.ids[1]!);
    const spies = spyOnBoxReads(w.fake);
    openWith(w, spun);
    const box = await origin();
    await waitFor(() => expect(marks(box)).toEqual(['stick-around:1', 'whoops:1']));
    expect(box).toHaveTextContent('post 2');
    await settle();
    expect(readsMade(spies)).toEqual([]);
  });

  test('a thread spun from a play on a character draws its moment and no read after the page', async () => {
    const w = threadWorld(3);
    const zedPost = w.fake.seed.post(w.thread, w.zed, 'zed words');
    const play = w.fake.seed.reach(w.spritey, 'character', w.zed, 'whoops', { post: zedPost, ends: Date.now() + 86_400_000, message: 'Shine.' });
    const spun = await spinFrom(w, play, 'About the shine');
    const spies = spyOnBoxReads(w.fake);
    openWith(w, spun);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it (landed|was spun)/u });
    expect(await within(frame).findByText('zed words')).toBeInTheDocument();
    await settle();
    expect(readsMade(spies)).toEqual([]);
  });

  test('a thread spun from a play on a post draws its moment and no read after the page', async () => {
    const w = threadWorld(3);
    const play = w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'read it' });
    const spun = await spinFrom(w, play, 'About that hold');
    const spies = spyOnBoxReads(w.fake);
    openWith(w, spun);
    const frame = await within(await origin()).findByRole('group', { name: /^As it landed/u });
    expect(await within(frame).findByText('post 2')).toBeInTheDocument();
    await settle();
    expect(readsMade(spies)).toEqual([]);
  });

  test('is never "Loading the origin…", from the first frame the box exists in', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'early' });
    const spun = await spinFrom(w, w.ids[1]!);
    let loading = false;
    let words = false;
    const watch = new MutationObserver(() => {
      const box = document.querySelector('[role="group"][aria-label="Origin"]');
      if (!box) return;
      if (box.textContent?.includes('Loading the origin') || box.querySelector('[aria-busy="true"]')) loading = true;
      if (box.textContent?.includes('post 2')) words = true;
    });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    try {
      openWith(w, spun);
      await origin();
      await waitFor(() => expect(words).toBe(true));
    } finally { watch.disconnect(); }
    expect(loading).toBe(false);
  });

  test('a page whose origin has no Act says the Act is not there, with the way back', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const real = w.fake.threadPage.bind(w.fake);
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (id, ...rest) => {
      const got = await real(id, ...rest);
      return id === spun && got?.origin ? { ...got, origin: { ...got.origin, act: null, plays: [] } } : got;
    });
    openWith(w, spun);
    const box = await origin();
    expect(box).toHaveTextContent('The Act this thread was spun from is not there.');
    expect(box).not.toHaveTextContent('Loading the origin');
    expect(within(box).getByRole('link', { name: /#2 in A short thread/u })).toBeInTheDocument();
  });

  test('an edit of the origin, a play on it and a tally heard on its thread show in the box; the play reads its own state once, and a caster the page did not name is read once', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'early' });
    const spun = await spinFrom(w, w.ids[1]!);
    const listeners = tap(w);
    openWith(w, spun);
    const box = await origin();
    await waitFor(() => expect(marks(box)).toEqual(['whoops:1']));
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    const spies = spyOnBoxReads(w.fake);
    const [original] = await w.fake.acts(w.thread, 2, 2);
    await act(async () => { for (const l of listeners) l.onAct?.({ ...original!, currentPayload: { body: 'post 2, fixed' }, editedAt: '2026-10-29T13:00:00Z', shownEditedAt: '2026-10-29T13:00:00Z' }); });
    await waitFor(() => expect(box).toHaveTextContent('post 2, fixed'));
    const stranger = w.fake.seed.character(w.fake.seed.account('stranger'), 'Strangerhood', 'face');
    const played = await playAct(w, '99999999-0000-4000-8000-000000000001', stranger);
    await act(async () => { for (const l of listeners) l.onAct?.(played); });
    await waitFor(() => expect(box.querySelector('[data-kb-card="whoops"]')).toHaveAttribute('data-kb-plays', '2'));
    await act(async () => { for (const l of listeners) l.onTally?.(played.id, { fire: 3 }); });
    await settle();
    const calls = (name: (typeof BOX_READS)[number]) => spies.find((s) => s.name === name)!.spy.mock.calls;
    expect(calls('effectStates').map(([ids]) => ids)).toEqual([[played.id]]);
    expect(calls('myReleases').map(([ids]) => ids)).toEqual([[played.id]]);
    expect(calls('characters')).toHaveLength(1);
    expect(calls('characters')[0]![0]).toEqual([stranger]);
    expect(readsMade(spies)).toEqual(['effectStates(1)', 'myReleases(1)', 'characters(1)']);
    await userEvent.click(within(box).getByRole('button', { name: /^Whoops!, 2 plays/u }));
    expect(await screen.findByRole('dialog', { name: 'Cards on this post' })).toHaveTextContent('Strangerhood');
  });

  test('an edit heard live is not undone by a page read again that carries the older Act', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const listeners = tap(w);
    openWith(w, spun);
    const box = await origin();
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    const [original] = await w.fake.acts(w.thread, 2, 2);
    await act(async () => { for (const l of listeners) l.onAct?.({ ...original!, currentPayload: { body: 'post 2, fixed' }, editedAt: '2026-10-29T13:00:00Z', shownEditedAt: '2026-10-29T13:00:00Z' }); });
    await waitFor(() => expect(box).toHaveTextContent('post 2, fixed'));
    /* The fake still holds the unedited Act: the page read again carries it. */
    const page = vi.spyOn(w.fake, 'threadPage');
    await act(async () => { w.fake.broadcast.rejoin(); await new Promise((r) => setTimeout(r, 50)); });
    expect(page).toHaveBeenCalled();
    expect(box).toHaveTextContent('post 2, fixed');
  });

  test('a page read again with an edited origin and one more play shows both, and a tag already drawn has not moved', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'early' });
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'stick-around', { message: 'late' });
    const spun = await spinFrom(w, w.ids[1]!);
    openWith(w, spun);
    const box = await origin();
    await waitFor(() => expect(marks(box)).toEqual(['stick-around:1', 'whoops:1']));
    const real = w.fake.threadPage.bind(w.fake);
    const first = (await real(spun, { page: 1 }, 20, []))!;
    const more = await playAct(w, '99999999-0000-4000-8000-000000000002', w.spritey);
    vi.spyOn(w.fake, 'threadPage').mockImplementation(async (id, ...rest) => {
      const got = await real(id, ...rest);
      if (id !== spun || !got?.origin?.act) return got;
      return { ...got, origin: { ...got.origin, act: { ...got.origin.act, currentPayload: { body: 'post 2, rewritten' }, editedAt: '2026-10-29T13:00:00Z', shownEditedAt: '2026-10-29T13:00:00Z' }, plays: [...first.origin!.plays, more] } };
    });
    await act(async () => { w.fake.broadcast.rejoin(); });
    await waitFor(() => expect(box).toHaveTextContent('post 2, rewritten'));
    await waitFor(() => expect(marks(box)).toEqual(['stick-around:1', 'whoops:2']));
  });
});

describe('after a spin', () => {
  test('focus is on the new thread\'s ORIGIN box', async () => {
    const w = threadWorld(3);
    /* The address decides which thread is open, as the app's routes do. */
    function Routed() {
      const { path } = useLocation();
      return <><LoadedThread thread={path.slice('/t/'.length)} /><Swapper /></>;
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
  test('lists under an origin the threads spun from it, with their reply counts, from the page\'s document', async () => {
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
    /* In the post's foot, under its action buttons: out of the content area, so an effect drawn on the post neither covers it nor is sized around it. */
    const foot = line.closest('.kb-act-foot')!;
    expect(foot).not.toBeNull();
    expect(line.closest('[data-kb-content-area]')).toBeNull();
    expect(within(foot as HTMLElement).getByRole('button', { name: 'Spin thread' }).compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(article).getByRole('link', { name: 'Crimson Incident' })).toHaveAttribute('href', `/t/${first}`);
    expect(many).not.toHaveBeenCalled();
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
    expect(many).not.toHaveBeenCalled();
    await userEvent.click(more);
    await waitFor(() => expect(within(line).getAllByRole('link')).toHaveLength(7));
    expect(one).toHaveBeenCalledTimes(1);
    expect(within(line).queryByRole('button')).toBeNull();
  });
});

/*
 * A thread spun from a card on a character (docs/plans/2026-11-12-spin-at-post-design.md): the spin is pressed from the card's mark on a
 * postbit and records that post; the box shows it as it was when spun, with the card's effect still, under a head with two links.
 * The card is the test's own, which reaches a character; the engine names no instance's.
 */
describe('a thread spun from a card on a character', () => {
  const glint: CardRules = {
    playPrice: () => 0, validateConfig: (c: unknown) => ok(c), key: 'glint', name: 'Glint', alignment: 'pepperoni', rarity: 'uncommon', reaches: ['character'],
    lasts: { unit: 'day', count: 7 }, canApply: (t, e, _config, now) => landsOn({ key: 'glint', reaches: ['character'] }, t, e, now),
  };
  const glitterInstance: Instance = { ...testInstance, cards: [glint] };
  const Glitter = ({ children, moment }: EffectProps) => <div data-kb-glint={moment ? 'moment' : 'live'}>{children}</div>;
  const glitterCards: CardUi[] = [{ key: 'glint', art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => 'Glitter.', Effect: Glitter }];

  /* Zed's first post (in "Kart tier list") is where Spritey's Glint was cast from; the post a reader presses it on is Zed's second in "Why are my posts shiny". */
  function world(instance: Instance = glitterInstance) {
    const fake = createFake({ instance, now: () => Date.now() });
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
    const zed = fake.seed.character(me, 'Zed', 'face');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const cast = fake.seed.thread('general', zed, 'Kart tier list', 'cast-from words');
    const shiny = fake.seed.thread('general', spritey, 'Why are my posts shiny', 'hello');
    const pressed = fake.seed.post(shiny.thread, zed, 'pressed words');
    fake.seed.post(shiny.thread, zed, 'later words');
    const play = fake.seed.reach(spritey, 'character', zed, 'glint', { post: cast.act, ends: Date.now() + 86_400_000, message: 'Shine.' });
    fake.signInAs(me);
    return { fake, pipe, zed, spritey, cast, shiny, pressed, play };
  }
  type World = ReturnType<typeof world>;
  const open = (w: World, thread: string) => renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: glitterInstance, cards: glitterCards });
  async function spun(w: World, at: string | undefined, title = 'Spun at') {
    const made = await w.fake.spin(w.play, w.pipe, title, 'about it', undefined, at);
    if (!made.ok) throw new Error(made.error);
    return made.value.thread.id;
  }
  /* The head's words; an avatar with no picture draws its initial as text, which is no word of the head. */
  const headText = (box: HTMLElement) => {
    const head = box.querySelector('.kb-origin-head')!.cloneNode(true) as HTMLElement;
    head.querySelectorAll('.kb-mini').forEach((el) => el.remove());
    return head.textContent!;
  };
  const href = (thread: string, seq: number) => threadHref(thread, pageOf(seq, 20), seq);

  test('pressing Spin thread on the mark on a postbit sends the post it was pressed on', async () => {
    const w = world();
    const send = vi.spyOn(w.fake, 'spin');
    open(w, w.shiny.thread);
    const bit = (await screen.findByRole('article', { name: /^Post 2 /u })).querySelector('.kb-postbit') as HTMLElement;
    await userEvent.click(await within(bit).findByRole('button', { name: /^Glint, 1 play\b.*Opens the cards on this character\./u }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this character' });
    await userEvent.click(await within(lens).findByRole('button', { name: /^1 play · Spritey/u }));
    await userEvent.click(within(lens).getByRole('button', { name: 'Spin thread' }));
    const form = screen.getByRole('form', { name: 'Spin a thread from Spritey\'s Glint' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'About the shine');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(w.play, w.pipe, 'About the shine', '', undefined, w.pressed));
  });

  test('the box shows the pressed post as it was spun: its words, the glitter still, the two head links and the Cast from line', async () => {
    const w = world();
    const thread = await spun(w, w.pressed);
    open(w, thread);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it was spun/u });
    expect(await within(frame).findByText('pressed words')).toBeInTheDocument();
    await waitFor(() => expect(frame.querySelector('[data-kb-glint]')).toHaveAttribute('data-kb-glint', 'moment'));
    expect(headText(box)).toMatch(/^ORIGIN · Spun from Glint on Zed, at #2 in Why are my posts shiny · as it was spun · ResetCast from #1 in Kart tier list/u);
    expect(within(box).getAllByRole('link', { name: 'Zed' }).map((a) => a.getAttribute('href'))).toEqual([`/c/${w.zed}`, `/c/${w.zed}`]);
    expect(within(box).getByRole('link', { name: '#2 in Why are my posts shiny' })).toHaveAttribute('href', href(w.shiny.thread, 2));
    expect(within(box).getByRole('link', { name: '#1 in Kart tier list' })).toHaveAttribute('href', href(w.cast.thread, 1));
    /* The byline: the author's avatar and name, linked to the profile, and the version's date. */
    await waitFor(() => expect(box.querySelector('p time')).toBeInTheDocument());
    expect(box.querySelectorAll('a.kb-who-link .kb-mini')).toHaveLength(2);
    expect(within(box).queryByText(/As it landed/u)).toBeNull();
    /* The card's mark is drawn, with its Go to post. */
    expect(marks(box)).toEqual(['glint:1']);
    /* Reset in a box labelled as it was spun still says the one status the design fixes. */
    await userEvent.click(within(box).getByRole('button', { name: 'Reset' }));
    expect(within(box).getByRole('status')).toHaveTextContent('As it landed again.');
    expect(within(box).getByRole('status')).not.toHaveTextContent('As it was spun');
  });

  test('an edit made to the pressed post afterwards leaves the box as it was', async () => {
    const w = world();
    const thread = await spun(w, w.pressed);
    const edited = await w.fake.edit(w.pressed, w.zed, 'Changed words.');
    expect(edited.ok).toBe(true);
    open(w, thread);
    const frame = await within(await origin()).findByRole('group', { name: /^As it was spun/u });
    expect(await within(frame).findByText('pressed words')).toBeInTheDocument();
    expect(within(frame).queryByText('Changed words.')).toBeNull();
  });

  test('its mark\'s Go to post leads to the pressed post, and a spin with no pressed post leads to the cast-from post', async () => {
    const w = world();
    const first = await spun(w, w.pressed, 'Pressed');
    const second = await spun(w, undefined, 'Not pressed');
    const goes = async (thread: string) => {
      cleanup();
      open(w, thread);
      const box = await origin();
      await userEvent.click(await within(box).findByRole('button', { name: /^Glint, 1 play/u }));
      const lens = screen.getByRole('dialog');
      await userEvent.click(await within(lens).findByRole('button', { name: /^1 play · Spritey/u }));
      return within(lens).findByRole('link', { name: 'Go to post' });
    };
    expect(await goes(first)).toHaveAttribute('href', href(w.shiny.thread, 2));
    expect(await goes(second)).toHaveAttribute('href', href(w.cast.thread, 1));
  });

  test('a spin that named no post shows the cast-from post as it landed, on one line, with no Cast from line', async () => {
    const w = world();
    const thread = await spun(w, undefined);
    open(w, thread);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it landed/u });
    expect(await within(frame).findByText('cast-from words')).toBeInTheDocument();
    await waitFor(() => expect(frame.querySelector('[data-kb-glint]')).toHaveAttribute('data-kb-glint', 'moment'));
    expect(headText(box)).toMatch(/^ORIGIN · Spun from Glint on Zed, cast from #1 in Kart tier list · as it landed · Reset$/u);
    expect(within(box).queryByText(/Cast from/u)).toBeNull();
    expect(within(box).queryByText(/as it was spun/u)).toBeNull();
  });

  test('a play from before the snapshot reads as the cast-from post as it landed, and says what was not recorded; never an empty box', async () => {
    const w = world();
    const old = w.fake.seed.reach(w.spritey, 'character', w.zed, 'glint', { post: w.cast.act, ends: Date.now() + 86_400_000, unrecorded: true });
    const made = await w.fake.spin(old, w.pipe, 'Spun from an old one', 'about it');
    if (!made.ok) throw new Error(made.error);
    open(w, made.value.thread.id);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it landed/u });
    expect(await within(frame).findByText('cast-from words')).toBeInTheDocument();
    /* What the moment says under its post stands in the box's foot, outside the frame. */
    await waitFor(() => expect(box.querySelector('.kb-origin-foot')).toHaveTextContent(/wasn.t recorded/u));
  });

  test('a spin refused for its post says so and the next press spins from the card without the post, keeping what was typed', async () => {
    const w = world();
    const send = vi.spyOn(w.fake, 'spin').mockResolvedValueOnce({ ok: false, error: CARD_NOT_ON_POST });
    open(w, w.shiny.thread);
    const bit = (await screen.findByRole('article', { name: /^Post 2 /u })).querySelector('.kb-postbit') as HTMLElement;
    await userEvent.click(await within(bit).findByRole('button', { name: /^Glint, 1 play\b.*Opens the cards on this character\./u }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this character' });
    await userEvent.click(await within(lens).findByRole('button', { name: /^1 play · Spritey/u }));
    await userEvent.click(within(lens).getByRole('button', { name: 'Spin thread' }));
    const form = screen.getByRole('form', { name: 'Spin a thread from Spritey\'s Glint' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'About the shine');
    await userEvent.type(within(form).getByLabelText('Your opening post (optional)'), 'Some words.');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('That card is no longer on that post. Spin thread again to spin from the card without the post.');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![5]).toBe(w.pressed);
    expect(within(form).getByLabelText('Thread title')).toHaveValue('About the shine');
    expect(within(form).getByLabelText('Your opening post (optional)')).toHaveValue('Some words.');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith(w.play, w.pipe, 'About the shine', 'Some words.');
    await waitFor(() => expect(window.location.pathname).not.toBe(`/t/${w.shiny.thread}`));
    const made = await w.fake.spunFrom(w.play);
    expect(made.map((t) => t.title)).toEqual(['About the shine']);
    cleanup();
    open(w, made[0]!.id);
    const box = await origin();
    await within(box).findByRole('group', { name: /^As it landed/u });
    expect(headText(box)).toMatch(/cast from #1 in Kart tier list · as it landed · Reset$/u);
  });

  test('any other refusal of a spin pressed on a post is shown as it was, and the next press still sends the post', async () => {
    const w = world();
    const send = vi.spyOn(w.fake, 'spin').mockResolvedValue({ ok: false, error: 'a title is at most 40 characters' });
    open(w, w.shiny.thread);
    const bit = (await screen.findByRole('article', { name: /^Post 2 /u })).querySelector('.kb-postbit') as HTMLElement;
    await userEvent.click(await within(bit).findByRole('button', { name: /^Glint, 1 play\b/u }));
    const lens = screen.getByRole('dialog', { name: 'Cards on this character' });
    await userEvent.click(await within(lens).findByRole('button', { name: /^1 play · Spritey/u }));
    await userEvent.click(within(lens).getByRole('button', { name: 'Spin thread' }));
    const form = screen.getByRole('form', { name: 'Spin a thread from Spritey\'s Glint' });
    await userEvent.type(within(form).getByLabelText('Thread title'), 'x');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('a title is at most 40 characters');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![5]).toBe(w.pressed);
  });

  test('a place that has a pressed post but a row with no first Act reads as the cast-from post as it landed, in the head and in the frame alike', async () => {
    const w = world();
    const thread = await spun(w, w.pressed);
    const page = (await w.fake.threadPage(thread, { page: 1 }, 20, []))!;
    vi.spyOn(w.fake, 'threadPage').mockResolvedValue({ ...page, thread: { ...page.thread, firstAct: null } });
    const moment = vi.spyOn(w.fake, 'playMoment');
    open(w, thread);
    const box = await origin();
    await within(box).findByRole('group', { name: /^As it landed/u });
    expect(headText(box)).toMatch(/ · as it landed · Reset$/u);
    expect(within(box).queryByText(/Cast from/u)).toBeNull();
    expect(within(box).queryByRole('group', { name: /^As it was spun/u })).toBeNull();
    /* The moment the page carried is kept under the play's key: no read. */
    expect(moment).not.toHaveBeenCalled();
  });

  test('the box shows the pressed post as it was spun with no read after the page: the moment, the place and the cast came with it', async () => {
    const w = world();
    const thread = await spun(w, w.pressed);
    const spies = spyOnBoxReads(w.fake);
    open(w, thread);
    const frame = await within(await origin()).findByRole('group', { name: /^As it was spun/u });
    expect(await within(frame).findByText('pressed words')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(readsMade(spies)).toEqual([]);
  });

  /* The post the pressed spin shows carries an older card too (a Whoops!): the box draws it, so it has a mark of its own, keyed by the post, beside the character's. */
  describe('with older cards on the post', () => {
    const inked: Instance = { ...testInstance, cards: [glint, { ...testInstance.cards[0]!, stack: 3 }] };
    const said = { glint: vi.fn(), whoops: vi.fn() };
    const Voiced = (key: 'glint' | 'whoops') => function Effect({ show, children }: EffectProps) {
      useEffect(() => { show({ progress: null, state: `${key} view`, yours: false, controls: [{ kind: 'press', label: `${key} press`, run: said[key] }], notes: {} }); }, [show]);
      return <div data-kb-voiced={key}>{children}</div>;
    };
    const art = { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' };
    const inkedCards: CardUi[] = [
      { key: 'glint', art, describe: () => 'Glitter.', Effect: Voiced('glint') },
      { key: 'whoops', art, describe: () => 'x', Effect: Voiced('whoops') },
    ];
    const openInked = (w: World, thread: string) => renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: inked, cards: inkedCards });

    test("a mark for the post's own card stands beside the character's; its row is a then row with the effect's controls and Go to post, and the spun play's effect says nothing to either strip", async () => {
      const w = world(inked);
      w.fake.seed.card(w.spritey, w.pressed, 'whoops', { message: 'ink' });
      w.fake.clock.advance(60_000);
      const thread = await spun(w, w.pressed);
      openInked(w, thread);
      const box = await origin();
      await waitFor(() => expect(marks(box).sort()).toEqual(['glint:1', 'whoops:1']));
      expect(box.querySelectorAll('.kb-marks-anchor')).toHaveLength(2);
      await userEvent.click(within(box).getByRole('button', { name: /^Whoops!?, 1 play/u }));
      let lens = screen.getByRole('dialog', { name: 'Cards on this post' });
      expect(await within(lens).findByText('whoops view')).toBeInTheDocument();
      expect(within(lens).queryByText('glint view')).toBeNull();
      await userEvent.click(within(lens).getByRole('button', { name: 'whoops press' }));
      expect(said.whoops).toHaveBeenCalledTimes(1);
      const fold = within(lens).getByRole('button', { name: /^1 play · Spritey/u });
      expect(fold).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(fold);
      expect(within(lens).queryByRole('button', { name: 'React' })).toBeNull();
      expect(within(lens).queryByRole('button', { name: 'Spin thread' })).toBeNull();
      expect(within(lens).queryByRole('button', { name: 'As it landed' })).toBeNull();
      expect(within(lens).getByRole('link', { name: 'Go to post' })).toHaveAttribute('href', href(w.shiny.thread, 2));
      await userEvent.click(within(box).getByRole('button', { name: /^Whoops!?, 1 play/u }));
      await userEvent.click(within(box).getByRole('button', { name: /^Glint, 1 play/u }));
      lens = screen.getByRole('dialog', { name: 'Cards on this character' });
      await settle();
      expect(within(lens).queryByText('glint view')).toBeNull();
      expect(within(lens).queryByText('whoops view')).toBeNull();
      expect(said.glint).not.toHaveBeenCalled();
    });

    test("the same card on the character and on the post: the post card's view survives the spun play's effect mounting, Reset and unmounting", async () => {
      const Reach = ({ show, reach, children }: EffectProps) => {
        useEffect(() => { show({ progress: null, state: `${reach} view`, yours: false, controls: [], notes: {} }); }, [show, reach]);
        return <>{children}</>;
      };
      const w = world(inked);
      w.fake.seed.card(w.spritey, w.pressed, 'glint', { message: 'on the post' });
      w.fake.clock.advance(60_000);
      const thread = await spun(w, w.pressed);
      const view = renderIn(w.fake, <LoadedThread thread={thread} />, { path: `/t/${thread}`, instance: inked, cards: [{ ...inkedCards[0]!, Effect: Reach }, inkedCards[1]!] });
      const box = await origin();
      await waitFor(() => expect(box.querySelectorAll('.kb-marks-anchor')).toHaveLength(2));
      const second = () => within(box.querySelectorAll<HTMLElement>('.kb-marks-anchor')[1]!).getByRole('button', { name: /^Glint, 1 play/u });
      await userEvent.click(second());
      expect(await within(screen.getByRole('dialog', { name: 'Cards on this post' })).findByText('post view')).toBeInTheDocument();
      await userEvent.click(within(box).getByRole('button', { name: 'Reset' }));
      await settle();
      expect(within(screen.getByRole('dialog', { name: 'Cards on this post' })).getByText('post view')).toBeInTheDocument();
      expect(screen.queryByText('character view')).toBeNull();
      view.unmount();
    });

    test('a character-spun box whose post carries no card has no second strip', async () => {
      const w = world(inked);
      const thread = await spun(w, w.pressed);
      openInked(w, thread);
      const box = await origin();
      await within(box).findByRole('group', { name: /^As it was spun/u });
      await settle();
      expect(marks(box)).toEqual(['glint:1']);
      expect(box.querySelectorAll('.kb-marks-anchor')).toHaveLength(1);
    });
  });
});

/*
 * A play on a spun thread's opening post (docs/plans/2026-11-16-cards-on-a-spun-thread-design.md, section 4): the opening post has a strip of
 * marks of its own, in its header, and the ORIGIN band keeps the marks of the post it quotes. The two are in different frames and never share one.
 */
describe('the opening post\'s strip and the ORIGIN band\'s marks are separate', () => {
  /** The spun thread's opening Act: the page's first. */
  const firstOf = async (w: ReturnType<typeof threadWorld>, thread: string) => (await w.fake.threadPage(thread, { page: 1 }, 20, []))!.acts[0]!.id;
  const strip = () => document.getElementById('post-1')!.querySelector('.kb-act-meta .kb-marks') as HTMLElement | null;

  test('a play on the opening post is in its strip and never in the band; a play on the quoted post is the reverse', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const first = await firstOf(w, spun);
    w.fake.seed.card(w.spritey, first, 'whoops', { message: 'on the opening post' });
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('post 2'));
    await waitFor(() => expect(strip()?.querySelectorAll('.kb-mark[data-kb-card="whoops"]')).toHaveLength(1));
    expect(box.contains(strip())).toBe(false);
    expect(marks(box)).toEqual([]);
    expect(within(strip()!).getByRole('button', { name: /^Whoops!, 1 play\b/u })).toBeInTheDocument();
    cleanup();
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'on the quoted post' });
    openSpun(w, spun);
    const again = await origin();
    await waitFor(() => expect(marks(again)).toEqual(['whoops:1']));
    /* The opening post's own strip still holds its one mark, and the quoted post's is not in it. */
    await waitFor(() => expect(strip()?.querySelectorAll('.kb-mark[data-kb-card="whoops"]')).toHaveLength(1));
    expect(strip()!.querySelector('.kb-mark[data-kb-card="whoops"]')!.getAttribute('data-kb-plays')).toBe('1');
    expect(again.contains(strip())).toBe(false);
  });

  test('the quoted post\'s play alone leaves the opening post with no strip of marks', async () => {
    const w = threadWorld(3);
    w.fake.seed.card(w.spritey, w.ids[1]!, 'whoops', { message: 'on the quoted post' });
    const spun = await spinFrom(w, w.ids[1]!);
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(marks(box)).toEqual(['whoops:1']));
    expect(strip()?.querySelectorAll('.kb-mark[data-kb-card]') ?? []).toHaveLength(0);
  });

  test('Edit and History are still absent on the opening post: a spin is not edited', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const first = await firstOf(w, spun);
    w.fake.seed.card(w.spritey, first, 'whoops', { message: 'on the opening post' });
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(strip()).not.toBeNull());
    const opening = document.getElementById('post-1')!;
    const outside = (name: string) => within(opening).queryAllByRole('button', { name }).filter((b) => !box.contains(b));
    expect(outside('Edit')).toHaveLength(0);
    expect(outside('History')).toHaveLength(0);
  });

  test('a visit on the opening post shows its tab in the strip, which it had none to show it in before', async () => {
    const w = threadWorld(3);
    const spun = await spinFrom(w, w.ids[1]!);
    const first = await firstOf(w, spun);
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
    const visit = w.fake.seed.visit(clerk, first, { at: Date.now(), endsInMs: 60_000 });
    w.fake.seed.visitEnd(visit, { outcome: 'filed', line: 'Filed.' });
    openSpun(w, spun);
    const opening = await screen.findByRole('article', { name: /^Post 1 /u });
    const mark = await within(opening).findByRole('button', { name: /Opens the visit\.$/u });
    expect(mark.closest('.kb-act-meta')).not.toBeNull();
  });
});

/* A thread spun from a report, a Mod's verdict, an appeal or a ruling draws the exchange (spin-mod-answers plan, Task 5). */
describe('the ORIGIN box of a thread spun from an ask or an answer', () => {
  const DAY = 86_400_000;
  function desk() {
    const w = threadWorld(3);
    const mod = w.fake.seed.staff('s-mod', 'Mod Staff', 'mod');
    const post = w.ids[1]!;
    const visit = () => w.fake.seed.visit(mod, post, {});
    return { ...w, mod, post, visit };
  }
  type Desk = ReturnType<typeof desk>;
  /** Each case: the ask and its answer on the desk, the words the box must show. */
  const cases: readonly { readonly name: string; readonly make: (d: Desk) => { ask: string; answer: string }; readonly said: string; readonly line: string; readonly plain: RegExp }[] = [
    {
      name: 'a dismissed report', said: 'This was rude.', line: 'Nothing to see here.', plain: /Mod Staff dismissed it\. No visit opened\./u,
      make: (d) => { const ask = d.fake.seed.report(d.pipe, d.post, 'This was rude.'); return { ask, answer: d.fake.seed.verdict(ask, d.mod, 'dismissed', { line: 'Nothing to see here.' }) }; },
    },
    {
      name: 'a report heard as a visit', said: 'This was rude.', line: 'I will take a look.', plain: /Mod Staff sent a visit to the post\./u,
      make: (d) => { const ask = d.fake.seed.report(d.pipe, d.post, 'This was rude.'); return { ask, answer: d.fake.seed.verdict(ask, d.mod, 'visit', { line: 'I will take a look.', visit: d.visit() }) }; },
    },
    {
      name: 'a backfire', said: 'This was rude.', line: 'You, however, were.', plain: /Mod Staff judged it a backfire, but no visit opened\./u,
      make: (d) => { const ask = d.fake.seed.report(d.pipe, d.post, 'This was rude.'); return { ask, answer: d.fake.seed.verdict(ask, d.mod, 'backfire', { line: 'You, however, were.' }) }; },
    },
    {
      name: 'an appeal of an infraction', said: 'It was a joke.', line: 'It stays.', plain: /Mod Staff upheld it\. Nothing changed\./u,
      make: (d) => { const ask = d.fake.seed.appeal(d.pipe, d.fake.seed.infraction(d.visit()), 'It was a joke.'); return { ask, answer: d.fake.seed.ruling(ask, d.mod, 'upheld', { line: 'It stays.' }) }; },
    },
    {
      name: 'an appeal of a ban', said: 'It was a joke.', line: 'Shorter, then.', plain: /Mod Staff reduced it: it ends /u,
      make: (d) => {
        const ban = d.fake.seed.ban(d.pipe, d.fake.clock.now() + 5 * DAY, { infraction: d.fake.seed.infraction(d.visit()) });
        const ask = d.fake.seed.appeal(d.pipe, ban, 'It was a joke.');
        return { ask, answer: d.fake.seed.ruling(ask, d.mod, 'reduced', { line: 'Shorter, then.', until: d.fake.clock.now() + DAY }) };
      },
    },
    {
      name: 'an appeal of a move', said: 'It was a joke.', line: 'Undone.', plain: /Mod Staff overturned it: it ended /u,
      make: (d) => {
        const move = d.fake.seed.groupMove('s-mod', { character: d.pipe, group: testGroups.conferred[0]!.key });
        const ask = d.fake.seed.appeal(d.pipe, move, 'It was a joke.');
        return { ask, answer: d.fake.seed.ruling(ask, d.mod, 'overturned', { line: 'Undone.', until: d.fake.clock.now() + DAY }) };
      },
    },
  ];

  for (const c of cases) {
    for (const from of ['ask', 'answer'] as const) {
      test(`${c.name}, spun from its ${from}, shows the asker's words, the staff's, the plain line and the post link`, async () => {
        const d = desk();
        const made = c.make(d);
        const spun = await spinFrom(d, made[from]);
        openSpun(d, spun);
        const box = await origin();
        await waitFor(() => expect(box).toHaveTextContent(c.said));
        expect(box).toHaveTextContent(c.line);
        expect(within(box.querySelector('.kb-origin-area') as HTMLElement).getByText(c.plain)).toBeInTheDocument();
        for (const [name, id] of [['Pipewrench', d.pipe], ['Mod Staff', d.mod]] as const) {
          const links = within(box.querySelector('.kb-origin-area') as HTMLElement).getAllByRole('link', { name });
          for (const l of links) expect(l).toHaveAttribute('href', `/c/${encodeURIComponent(id)}`);
        }
        /* A verdict is a Mod's; the seeded ruling carries no office stamp, so it names no role. */
        if (c.name.includes('report') || c.name === 'a backfire') expect(box).toHaveTextContent('A Mod'); else expect(box).not.toHaveTextContent('A Mod');
        expect(box).not.toHaveTextContent('Not answered yet.');
        /* The exchange carries its own two bylines: the box draws none over the area. */
        expect(box.querySelector('.kb-origin-byline')).toBeNull();
        const link = within(box.querySelector('.kb-origin-area') as HTMLElement).getByRole('link', { name: /^Go to post #\d+$/u });
        expect(link.getAttribute('href')).toMatch(/^\/t\//u);
      });
    }
  }

  test('a spin of an unanswered report shows "Not answered yet." in place of the answer and the plain line', async () => {
    const d = desk();
    const ask = d.fake.seed.report(d.pipe, d.post, 'Still waiting.');
    openSpun(d, await spinFrom(d, ask));
    const box = await origin();
    await waitFor(() => expect(box).toHaveTextContent('Still waiting.'));
    expect(box).toHaveTextContent('Not answered yet.');
    expect(box).not.toHaveTextContent('Mod Staff');
    expect(within(box).getByRole('link', { name: 'Go to post #2' })).toBeInTheDocument();
  });

  test('a failed read shows Try again, and pressing it reads again', async () => {
    const d = desk();
    const ask = d.fake.seed.report(d.pipe, d.post, 'Try me.');
    const spun = await spinFrom(d, ask);
    const read = vi.spyOn(d.fake, 'exchange').mockRejectedValueOnce(new Error('offline'));
    openSpun(d, spun);
    const box = await origin();
    const retry = await within(box).findByRole('button', { name: 'Try again' });
    expect(box).toHaveTextContent('The exchange did not load.');
    expect(read).toHaveBeenCalledTimes(1);
    await userEvent.click(retry);
    await waitFor(() => expect(box).toHaveTextContent('Try me.'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(within(box).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  test('focus stays on the exchange\'s box after Try again is pressed and after the read settles', async () => {
    const d = desk();
    const spun = await spinFrom(d, d.fake.seed.report(d.pipe, d.post, 'Focus me.'));
    vi.spyOn(d.fake, 'exchange').mockRejectedValueOnce(new Error('offline'));
    openSpun(d, spun);
    const box = await origin();
    await userEvent.click(await within(box).findByRole('button', { name: 'Try again' }));
    const frame = box.querySelector('.kb-exchange') as HTMLElement;
    expect(frame).toHaveFocus();
    await waitFor(() => expect(box).toHaveTextContent('Focus me.'));
    expect(box.querySelector('.kb-exchange')).toBe(frame);
    expect(frame).toHaveFocus();
  });

  test('a Boss\'s ruling names the Boss\'s role, a Mod\'s a Mod, and one with no office stamp names none', async () => {
    const d = desk();
    const ask = d.fake.seed.appeal(d.pipe, d.fake.seed.infraction(d.visit()), 'Please.');
    const ruling = d.fake.seed.ruling(ask, d.mod, 'upheld', { line: 'No.' });
    let stamp: 'boss' | 'mod' | undefined;
    const real = d.fake.exchange.bind(d.fake);
    vi.spyOn(d.fake, 'exchange').mockImplementation(async (id) => {
      const got = await real(id);
      const { office: _drop, ...rest } = got.answer!.payload;
      return { ...got, answer: { ...got.answer!, payload: stamp === undefined ? rest : { ...rest, office: stamp } } };
    });
    const role = async (office: 'boss' | 'mod' | undefined) => {
      stamp = office;
      cleanup();
      openSpun(d, await spinFrom(d, ruling, `Spun ${String(office)}`));
      const box = await origin();
      await waitFor(() => expect(box).toHaveTextContent('No.'));
      return (box.querySelectorAll('.kb-exchange-by')[1] as HTMLElement).textContent;
    };
    expect(await role('boss')).toContain('The Boss');
    expect(await role('mod')).toContain('A Mod');
    const bare = await role(undefined);
    expect(bare).not.toContain('A Mod');
    expect(bare).not.toContain('The Boss');
  });
});
