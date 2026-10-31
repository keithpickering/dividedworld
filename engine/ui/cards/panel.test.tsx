/**
 * A play's panel (docs/plans/2026-10-31-plays-on-a-post-design.md, section 3): opened from its card's mark (until the Lens, Task 4 of the marks-and-the-lens plan, replaces it: the mark opens the kind's first billed play), a dialog
 * holding the card, who played it and when, the message, the card's note, the play's reactions with React, Spin
 * thread, the threads spun from it, and Go to post; a popover on a desktop and a bottom sheet on a phone.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import type { CardUi } from './types.ts';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function width(phone: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: phone && q.includes('max-width: 40em'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }) as unknown as MediaQueryList);
}

/** `first` is the play that has drawn the most, so it is billed first and the one its mark opens. */
function world(first: 'theirs' | 'mine' = 'theirs') {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  fake.signInAs(me);
  fake.clock.advance(60_000);
  const theirs = fake.seed.card(spritey, second, 'whoops', { message: 'you dropped your ink' });
  fake.clock.advance(60_000);
  const mine = fake.seed.card(pipe, second, 'whoops', { layer: 2 });
  if (first === 'theirs') fake.seed.react(me, pipe, theirs, 'fire'); else fake.seed.react(other, spritey, mine, 'fire');
  return { fake, me, other, pipe, spritey, thread, second, theirs, mine };
}
const open = (w: { fake: Fake; thread: Id }, cards?: readonly CardUi[]) =>
  renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}`, ...(cards ? { cards } : {}) });
const post2 = () => screen.findByRole('article', { name: /^Post 2 /u });
/* Both plays are Whoops!, so the post has one mark; it opens the kind's first billed play. */
const mark = async () => within(await post2()).findByRole('button', { name: /^Whoops!, 2 plays.*Opens the cards on this post\./u });
const panel = (name = 'Whoops! by Spritey') => screen.getByRole('dialog', { name });

describe('a play\'s panel', () => {
  test('opens from its mark, with the card, who played it and when, the message quoted, and the play\'s reactions', async () => {
    width(false);
    const w = world();
    open(w);
    const opener = await mark();
    expect(opener).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(opener);
    const p = panel();
    expect(opener).toHaveAttribute('aria-expanded', 'true');
    expect(within(p).getByRole('heading', { name: 'Whoops!' })).toBeInTheDocument();
    expect(p).toHaveTextContent(/Spritey · played Oct 29, 2026/u);
    expect(p.querySelector('blockquote')).toHaveTextContent('“you dropped your ink”');
    expect(within(p).getByText('Fire, 1, including yours')).toBeInTheDocument();
    /* Focus is in the panel, on its first control. */
    expect(p.contains(document.activeElement)).toBe(true);
  });

  test('a play with no message has no quote', async () => {
    width(false);
    const w = world('mine');
    open(w);
    await userEvent.click(await mark());
    const p = panel('Whoops! by Pipewrench');
    expect(p.querySelector('blockquote')).toBeNull();
  });

  test('closes on Esc, on its close button, and on a pointer down outside it, and each time focus goes back to what opened it', async () => {
    width(false);
    const w = world();
    open(w);
    const opener = await mark();
    await userEvent.click(opener);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();

    await userEvent.click(opener);
    await userEvent.click(within(panel()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();

    await userEvent.click(opener);
    const backdrop = panel().closest('.kb-glass-overlay')!;
    await userEvent.pointer({ keys: '[MouseLeft]', target: backdrop });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  test('React opens the picker for the play, and a pick reacts to the play\'s Act', async () => {
    width(false);
    const w = world();
    const react = vi.spyOn(w.fake, 'react');
    open(w);
    await userEvent.click(await mark());
    await userEvent.click(within(panel()).getByRole('button', { name: 'React' }));
    const picker = screen.getByRole('dialog', { name: 'React to Spritey\'s Whoops!' });
    await userEvent.click(within(picker).getByRole('button', { name: 'Tea, Calm' }));
    await waitFor(() => expect(react).toHaveBeenCalledWith(w.theirs, w.pipe, 'tea'));
    /* The panel counts it in place. */
    await waitFor(() => expect(within(panel()).getByText(/^Tea, 1/u)).toBeInTheDocument());
  });

  test('a play by one of the reader\'s own characters shows its reactions and no React', async () => {
    width(false);
    const w = world('mine');
    open(w);
    await userEvent.click(await mark());
    const p = panel('Whoops! by Pipewrench');
    expect(within(p).getByText('Fire, 1')).toBeInTheDocument();
    expect(within(p).queryByRole('button', { name: 'React' })).toBeNull();
  });

  test('Spin thread closes the panel and opens the spin form under the post, named for the play, which spins from the play', async () => {
    width(false);
    const w = world();
    const spin = vi.spyOn(w.fake, 'spin');
    open(w);
    const opener = await mark();
    await userEvent.click(opener);
    await userEvent.click(within(panel()).getByRole('button', { name: 'Spin thread' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const form = within(await post2()).getByRole('form', { name: 'Spin a thread from Spritey\'s Whoops!' });
    expect(form).toHaveTextContent('Spinning a thread from Spritey\'s Whoops! as Pipewrench');
    expect(within(form).getByLabelText('Thread title')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(within(await post2()).queryByRole('form')).toBeNull();
    expect(opener).toHaveFocus();

    await userEvent.click(opener);
    await userEvent.click(within(panel()).getByRole('button', { name: 'Spin thread' }));
    const again = within(await post2()).getByRole('form', { name: 'Spin a thread from Spritey\'s Whoops!' });
    await userEvent.type(within(again).getByLabelText('Thread title'), 'About the ink');
    await userEvent.click(within(again).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spin).toHaveBeenCalledWith(w.theirs, w.pipe, 'About the ink', ''));
  });

  test('says how many threads were spun from the play, and links them', async () => {
    width(false);
    const w = world();
    await w.fake.spin(w.theirs, w.pipe, 'All about the ink', '');
    open(w);
    await userEvent.click(await mark());
    const p = panel();
    expect(await within(p).findByText('1 thread spun from this play')).toBeInTheDocument();
    expect(within(p).getByRole('link', { name: 'All about the ink' })).toHaveAttribute('href', expect.stringMatching(/^\/t\//u));
  });

  const noted: CardUi = {
    key: 'whoops', art: { color: '#000000', ink: '#ffffff' }, describe: () => 'whoops',
    Effect: function Noted({ plays, note, children }) {
      useEffect(() => { note(plays[0]!.id, 'Layer 1 of 2 · 0% washed'); }, [plays, note]);
      return <>{children}</>;
    },
  };

  test('shows the card\'s note about the play when it has one', async () => {
    width(false);
    const w = world();
    open(w, [noted]);
    /* The first by play order is Spritey's, layer 1: it has the note. */
    await userEvent.click(await mark());
    expect(within(panel()).getByText('Layer 1 of 2 · 0% washed')).toBeInTheDocument();
  });

  test('shows no note for a play the card said none about', async () => {
    width(false);
    const w = world('mine');
    open(w, [noted]);
    await userEvent.click(await mark());
    expect(within(panel('Whoops! by Pipewrench')).queryByText(/washed/u)).toBeNull();
  });

  test('Go to post leads to the post\'s own address', async () => {
    width(false);
    const w = world();
    open(w);
    await userEvent.click(await mark());
    expect(within(panel()).getByRole('link', { name: 'Go to post' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
  });

  test('is a popover on a desktop and a bottom sheet on a phone', async () => {
    width(false);
    const w = world();
    const view = open(w);
    await userEvent.click(await mark());
    expect(panel()).toHaveAttribute('data-kb-panel', 'popover');
    await userEvent.keyboard('{Escape}');
    view.unmount();
    width(true);
    open(w);
    await userEvent.click(await mark());
    await act(async () => {});
    expect(panel()).toHaveAttribute('data-kb-panel', 'sheet');
  });
});
