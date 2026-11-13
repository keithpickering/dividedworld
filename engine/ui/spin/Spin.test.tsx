import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
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
    await waitFor(() => expect(head).toHaveTextContent(/^ORIGIN · Spun from Whoops! on #2 in A short thread$/u));
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

  test('with no place, the head reads "an Act" and so does the sentence about the rest of the cards', async () => {
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
    await waitFor(() => expect(box).toHaveTextContent('the rest are in an Act.'));
  });

  test('a reversed play\'s end rides in the read but is no play: it neither makes "more" nor is read for tallies', async () => {
    const w = threadWorld(3);
    const plays = Array.from({ length: 20 }, (_, i) => w.fake.seed.card(w.zed, w.ids[1]!, 'whoops', { message: `play ${i}` }));
    const boss = w.fake.seed.account('boss', { admin: true });
    w.fake.signInAs(boss);
    const ended = await w.fake.reverseCard(plays[0]!);
    w.fake.signInAs(w.me);
    expect(ended.ok).toBe(true);
    expect((await w.fake.cardsOn(w.ids[1]!, 21)).map((a) => a.kind).filter((k) => k === 'card_end')).toHaveLength(1);
    const spun = await spinFrom(w, w.ids[1]!);
    const tallies = vi.spyOn(w.fake, 'tallies');
    openSpun(w, spun);
    const box = await origin();
    await waitFor(() => expect(box.querySelectorAll('.kb-mark').length).toBeGreaterThan(0));
    expect(box).not.toHaveTextContent('More than 20 cards');
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
    await waitFor(() => expect(head).toHaveTextContent(/^ORIGIN · Spun from Whoops!$/u));
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
    /* The rest are in the origin's place, linked as the head links it. */
    const rest = [...box.querySelectorAll('p')].find((p) => p.textContent?.startsWith('More than 20 cards'))!;
    expect(rest).toHaveTextContent(/the rest are in #2 in A short thread\.$/u);
    expect(within(rest as HTMLElement).getByRole('link', { name: '#2 in A short thread' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
  });
});

/*
 * A thread spun from a card play on a post draws that play's moment in its ORIGIN box (docs/plans/2026-11-03-effect-history-plan.md,
 * Task 6): the post as it read when the play landed, each play under it as it stood, drawn still, under the mark the box shows. The
 * test instance's Whoops! here stacks three (so a moment draws it), and its Stick Around lifts the post (so a moment names it).
 */
describe('the ORIGIN box of a play-spun thread', () => {
  const momentInstance = {
    ...testInstance,
    cards: [{ ...testInstance.cards[0]!, stack: 3 }, { ...testInstance.cards[0]!, key: 'stick-around', name: 'Stick Around' }],
  };
  function Washy({ plays, states, still, show, children }: EffectProps) {
    const washed = plays.map((p) => (states[p.id]?.state as { washed?: number } | undefined)?.washed ?? 0).join();
    useEffect(() => { show({ progress: null, state: `washed ${washed}`, yours: false, controls: [], notes: {} }); }, [show, washed]);
    return <div data-kb-washy={still ? 'still' : 'live'} data-kb-washed={washed}>{children}</div>;
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
    expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washy', 'still');
    expect(within(frame).getByText('post 2')).toBeInTheDocument();
    /* The play is the box's mark and its head's; the head says "as it landed", so the frame draws no ring or tag of its own. */
    expect(within(frame).queryByText(/Also on the post then/u)).toBeNull();
    expect(box.querySelector('.kb-origin-head-text')!.textContent).toMatch(/ · as it landed$/u);
    expect(frame.querySelector('.kb-moment-ring, .kb-moment-tag')).toBeNull();
    expect(within(frame).queryByRole('button', { name: 'Back to now' })).toBeNull();
    /* The mark is the box's one, and its Go to post still leads to the post as it is now. */
    expect(marks(box)).toEqual(['stick-around:1']);
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
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('a moment that does not load says so in the box, with Try again, and no way out is needed: the mark still leads to the post', async () => {
    const { w, spun } = await spunFromHold();
    const read = vi.spyOn(w.fake, 'playMoment').mockRejectedValueOnce(new Error('offline'));
    openWith(w, spun);
    const box = await origin();
    const frame = await within(box).findByRole('group', { name: /^As it landed/u });
    expect(await within(frame).findByText('The moment did not load.')).toBeInTheDocument();
    await userEvent.click(within(frame).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(frame.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4'));
    expect(read).toHaveBeenCalledTimes(2);
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
    /* Lifted over a card's ink, and marked so that an effect starts no stroke on it (the Whoops! refinements design's section 5). */
    expect(line.closest('p')).toHaveAttribute('data-kb-over-ink');
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
  const Glitter = ({ children, still }: EffectProps) => <div data-kb-glint={still ? 'still' : 'live'}>{children}</div>;
  const glitterCards: CardUi[] = [{ key: 'glint', art: { color: '#ffd23f', ink: '#1a1300', canvas: '', mark: '', credit: 'Test' }, describe: () => 'Glitter.', Effect: Glitter }];

  /* Zed's first post (in "Kart tier list") is where Spritey's Glint was cast from; the post a reader presses it on is Zed's second in "Why are my posts shiny". */
  function world() {
    const fake = createFake({ instance: glitterInstance, now: () => Date.now() });
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
    await waitFor(() => expect(frame.querySelector('[data-kb-glint]')).toHaveAttribute('data-kb-glint', 'still'));
    expect(headText(box)).toMatch(/^ORIGIN · Spun from Glint on Zed, at #2 in Why are my posts shiny · as it was spunCast from #1 in Kart tier list/u);
    expect(within(box).getAllByRole('link', { name: 'Zed' }).map((a) => a.getAttribute('href'))).toEqual([`/c/${w.zed}`, `/c/${w.zed}`]);
    expect(within(box).getByRole('link', { name: '#2 in Why are my posts shiny' })).toHaveAttribute('href', href(w.shiny.thread, 2));
    expect(within(box).getByRole('link', { name: '#1 in Kart tier list' })).toHaveAttribute('href', href(w.cast.thread, 1));
    /* The byline: the author's avatar and name, linked to the profile, and the version's date. */
    await waitFor(() => expect(box.querySelector('p time')).toBeInTheDocument());
    expect(box.querySelectorAll('a.kb-who-link .kb-mini')).toHaveLength(2);
    expect(within(box).queryByText(/As it landed/u)).toBeNull();
    /* The card's mark is drawn, with its Go to post. */
    expect(marks(box)).toEqual(['glint:1']);
  });

  test('an edit made to the pressed post afterwards leaves the box as it was', async () => {
    const w = world();
    const thread = await spun(w, w.pressed);
    /* The fake is on the wall clock: an edit in the spin's own millisecond is no later than the spin. */
    await new Promise((r) => setTimeout(r, 15));
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
    await waitFor(() => expect(frame.querySelector('[data-kb-glint]')).toHaveAttribute('data-kb-glint', 'still'));
    expect(headText(box)).toMatch(/^ORIGIN · Spun from Glint on Zed, cast from #1 in Kart tier list · as it landed$/u);
    expect(within(box).queryByText(/Cast from/u)).toBeNull();
    expect(within(box).queryByText(/as it was spun/u)).toBeNull();
  });

  test('a play from before the snapshot reads as the cast-from post as it landed, and says what was not recorded; never an empty box', async () => {
    const w = world();
    const old = w.fake.seed.reach(w.spritey, 'character', w.zed, 'glint', { post: w.cast.act, ends: Date.now() + 86_400_000, unrecorded: true });
    const made = await w.fake.spin(old, w.pipe, 'Spun from an old one', 'about it');
    if (!made.ok) throw new Error(made.error);
    open(w, made.value.thread.id);
    const frame = await within(await origin()).findByRole('group', { name: /^As it landed/u });
    expect(await within(frame).findByText('cast-from words')).toBeInTheDocument();
    await waitFor(() => expect(frame).toHaveTextContent(/wasn.t recorded/u));
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
    expect(headText(box)).toMatch(/cast from #1 in Kart tier list · as it landed$/u);
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
    open(w, thread);
    const box = await origin();
    await within(box).findByRole('group', { name: /^As it landed/u });
    expect(headText(box)).toMatch(/ · as it landed$/u);
    expect(within(box).queryByText(/Cast from/u)).toBeNull();
    expect(within(box).queryByRole('group', { name: /^As it was spun/u })).toBeNull();
  });
});
