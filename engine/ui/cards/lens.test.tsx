/**
 * The Lens (docs/plans/2026-10-31-marks-and-the-lens-design.md, section 2): one floating, non-modal glass panel opened by a
 * mark. Its tabs are the post's card kinds, in the marks' order; its three rows are State (the card's view), Act (the
 * kit) and Who (a play's row: the #97 panel's content, reached for every play of the kind). It never dims or blocks the
 * page, and closes by Esc, its ×, its mark, another post's Lens or leaving the page, giving focus back to the mark.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { fadeOf, LensProvider, moreBelow, useLensFor, useLensStore } from './Lens.tsx';
import lensCss from './lens.css?raw';
import type { CardUi, EffectProps } from './types.ts';
import { LoadedThread } from '../loaded.tsx';

/* These tests close a Lens and open another in the same step and look at the one page that results, as under Off: at full motion the closed one stays, inert, until its exit ends (glass/layer.test.tsx). */
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
});
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A phone (40em or less) is also a sheet's width; a tablet (up to 64em) is a sheet's width with a desktop's marks. */
function width(phone: boolean, tablet = false) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (phone && q.includes('max-width: 40em')) || ((phone || tablet) && q.includes('max-width: 64em')), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }) as unknown as MediaQueryList);
}

/* Six kinds, so a post can carry more marks than a strip draws; k1 stacks (three layers), the rest do not. */
const KEYS = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'] as const;
const instance = {
  ...testInstance,
  cards: KEYS.map((key, i) => ({ ...testInstance.cards[0]!, key, name: `Card ${i + 1}`, ...(key === 'k1' ? { stack: 3 } : {}) })),
};
const art = { color: 'red', ink: 'white', mark: '/mark.svg' };
const cardUi = (key: string, extra: Partial<CardUi> = {}): CardUi => ({ key, describe: () => 'Does a thing. And more.', summary: 'Does a thing.', art, ...extra });

const run = vi.fn();
/** An effect that says everything a view can: its State lines, a report, an Act control and a note for its first play. */
function Said({ plays, show, children }: EffectProps) {
  const first = plays[0]!.id;
  useEffect(() => {
    show({
      progress: 0.5, state: '3 layers · top: yellow', ends: 'Ends when you scrub it off.', yours: false, report: 'The last save did not get through.',
      controls: [{ kind: 'press', label: 'Wash it', run }], notes: { [first]: 'Layer 1 of 3, on top' },
    });
  }, [first, show]);
  return <>{children}</>;
}
const cards: CardUi[] = KEYS.map((k) => cardUi(k, k === 'k1' ? { Effect: Said } : {}));

function world() {
  const fake = buildWorld(undefined, instance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const third = fake.seed.account('third');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const gloomba = fake.seed.character(third, 'Gloomba', 'heel');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const third_ = fake.seed.post(thread, spritey, 'post 3');
  fake.signInAs(me);
  const play = (kind: string, by: Id = spritey, on: Id = second, layer?: number) => {
    fake.clock.advance(60_000);
    return fake.seed.card(by, on, kind, { message: `${kind} by ${by}`, ...(layer ? { layer } : {}) });
  };
  return { fake, me, other, thirdAccount: third, pipe, spritey, gloomba, thread, second, third: third_, play };
}
type World = ReturnType<typeof world>;
const open = (w: { fake: Fake; thread: Id }, ui: readonly CardUi[] = cards) =>
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: ui });
const article = (seq: number) => screen.findByRole('article', { name: new RegExp(`^Post ${seq} `, 'u') });
const markOf = async (seq: number, card: string) => within(await article(seq)).findByRole('button', { name: new RegExp(`^${card}, \\d plays?`, 'u') });
const lens = () => screen.getByRole('dialog', { name: 'Cards on this post' });
const tab = (name: string) => within(lens()).getByRole('tab', { name });
const whoButton = () => within(lens()).getByRole('button', { name: /^\d+ plays? · / });
const rows = () => [...lens().querySelectorAll<HTMLElement>('[data-kb-play]')].map((r) => r.getAttribute('data-kb-play')!);

describe('opening and closing', () => {
  test('a mark opens the Lens on its tab, and the mark says it is open', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    expect(mark).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(mark);
    expect(mark).toHaveAttribute('aria-expanded', 'true');
    expect(within(lens()).getAllByRole('tab').map((t) => t.textContent)).toEqual(expect.arrayContaining(['Card 1', 'Card 2']));
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Card 1')).toHaveAttribute('aria-selected', 'false');
    /* Focus moved to the open tab. */
    expect(tab('Card 2')).toHaveFocus();
  });

  test('"+N" opens the Lens on the first kind the strip hides', async () => {
    width(false);
    const w = world();
    for (const k of KEYS) w.play(k);
    open(w);
    const post = await article(2);
    await userEvent.click(await within(post).findByRole('button', { name: /^\+2 more cards/u }));
    /* Newest is billed first: k6 k5 k4 k3 are shown, k2 and k1 are hidden. */
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
  });

  test('pressing the same mark closes it', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    expect(lens()).toBeInTheDocument();
    await userEvent.click(mark);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mark).toHaveAttribute('aria-expanded', 'false');
  });

  test('Esc and its × close it, and focus returns to the mark', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(mark).toHaveFocus());

    await userEvent.click(mark);
    await userEvent.click(within(lens()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(mark).toHaveFocus());
  });

  test('a press on the post\'s body leaves it open', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(within(await article(2)).getByText('post 2'));
    await userEvent.pointer({ keys: '[MouseLeft]', target: document.body });
    expect(lens()).toBeInTheDocument();
  });

  test('opening another post\'s Lens closes the first', async () => {
    width(false);
    const w = world();
    w.play('k2'); w.play('k3', w.spritey, w.third);
    open(w);
    const first = await markOf(2, 'Card 2');
    await userEvent.click(first);
    await userEvent.click(await markOf(3, 'Card 3'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(tab('Card 3')).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  test('the arrow keys move between tabs, one stop in the Tab order', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2'); w.play('k3');
    open(w);
    await userEvent.click(await markOf(2, 'Card 3'));
    const stops = within(lens()).getAllByRole('tab').filter((t) => t.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(tab('Card 3')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Card 2')).toHaveFocus();
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    /* Wraps at the start. */
    expect(tab('Card 1')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tab('Card 3')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('what the Lens says and offers', () => {
  test('State shows the view\'s lines and its report; a card with no effect says its summary', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    const panel = within(lens()).getByRole('tabpanel');
    expect(panel).toHaveTextContent('3 layers · top: yellow');
    expect(panel).toHaveTextContent('Ends when you scrub it off.');
    expect(panel).toHaveTextContent('The last save did not get through.');
    await userEvent.click(tab('Card 2'));
    expect(within(lens()).getByRole('tabpanel')).toHaveTextContent('Does a thing.');
  });

  test('Act draws the view\'s controls from the kit, and a card with none has no Act row', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    run.mockClear();
    await userEvent.click(within(lens()).getByRole('button', { name: 'Wash it' }));
    expect(run).toHaveBeenCalledTimes(1);
    await userEvent.click(tab('Card 2'));
    expect(within(lens()).queryByRole('button', { name: 'Wash it' })).toBeNull();
  });

  test('Who is folded, and unfolds to its rows in billing order for a card that does not stack', async () => {
    width(false);
    const w = world();
    const early = w.play('k2', w.spritey);
    const late = w.play('k2', w.gloomba);
    /* The early play has drawn a reaction, so it is billed first. */
    w.fake.seed.react(w.me, w.pipe, early, 'fire');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(rows()).toEqual([]);
    const who = whoButton();
    expect(who).toHaveAccessibleName('2 plays · Spritey, Gloomba');
    expect(who).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(who);
    expect(who).toHaveAttribute('aria-expanded', 'true');
    expect(rows()).toEqual([early, late]);
    await userEvent.click(who);
    expect(rows()).toEqual([]);
  });

  test('a card whose rules stack lists its rows by layer, top first, whatever was billed first', async () => {
    width(false);
    const w = world();
    const one = w.play('k1', w.spritey, w.second, 1);
    const two = w.play('k1', w.gloomba, w.second, 2);
    const three = w.play('k1', w.pipe, w.second, 3);
    w.fake.seed.react(w.thirdAccount, w.gloomba, one, 'fire');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    expect(rows()).toEqual([three, two, one]);
  });

  test('a row says who played it in capitals, when, the message, the card\'s note and the threads spun', async () => {
    width(false);
    const w = world();
    const first = w.play('k1', w.spritey, w.second, 1);
    await w.fake.spin(first, w.pipe, 'All about the ink', '');
    open(w);
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    const row = lens().querySelector<HTMLElement>(`[data-kb-play="${first}"]`)!;
    expect(row).toHaveTextContent(/Spritey · played Oct 29, 2026/u);
    expect(row.querySelector('.kb-lens-who')).toHaveTextContent('Spritey');
    expect(row.querySelector('blockquote')).toHaveTextContent(`“k1 by ${w.spritey}”`);
    expect(row).toHaveTextContent('Layer 1 of 3, on top');
    expect(row.querySelector('.kb-lens-note')).toHaveTextContent('Layer 1 of 3, on top');
    expect(await within(row).findByText('1 thread spun from this play')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'All about the ink' })).toHaveAttribute('href', expect.stringMatching(/^\/t\//u));
    expect(within(row).getByRole('link', { name: 'Go to post' })).toHaveAttribute('href', `/t/${w.thread}?page=1#post-2`);
  });

  test('a row carries its play\'s ink as a bar, and its note stands above its caster', async () => {
    width(false);
    const w = world();
    const first = w.play('k1', w.spritey, w.second, 1);
    open(w, cards.map((c) => (c.key === 'k1' ? { ...c, tag: () => '#ff9f43' } : c)));
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    const row = lens().querySelector<HTMLElement>(`[data-kb-play="${first}"]`)!;
    expect(row.style.getPropertyValue('--kb-play-ink')).toBe('#ff9f43');
    const note = row.querySelector('.kb-lens-note')!;
    const by = row.querySelector('.kb-lens-by')!;
    expect(note.compareDocumentPosition(by) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('a play with more public reactions than its post says so, in words that are not the settlement\'s', async () => {
    width(false);
    const w = world();
    const drawn = w.play('k2', w.spritey);
    const quiet = w.play('k2', w.gloomba);
    w.fake.seed.react(w.me, w.pipe, drawn, 'fire');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const row = (id: Id) => lens().querySelector<HTMLElement>(`[data-kb-play="${id}"]`)!;
    expect(row(drawn)).toHaveTextContent('More reactions than the post');
    expect(row(quiet)).not.toHaveTextContent('More reactions than the post');
    /* A card whose view says nothing of a play draws no note line for it: the view's notes are the only source. */
    expect(row(quiet).querySelector('.kb-lens-note')).toBeNull();
    expect(lens()).not.toHaveTextContent(/outdraw/iu);
  });

  test('a row\'s React calls the API with the play\'s Act, and the row counts it in place', async () => {
    width(false);
    const w = world();
    const theirs = w.play('k2', w.spritey);
    const react = vi.spyOn(w.fake, 'react');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'React' }));
    const picker = screen.getByRole('dialog', { name: 'React to Spritey\'s Card 2' });
    await userEvent.click(within(picker).getByRole('button', { name: 'Tea, Calm' }));
    await waitFor(() => expect(react).toHaveBeenCalledWith(theirs, w.pipe, 'tea'));
    await waitFor(() => expect(within(lens()).getByRole('button', { name: /^Tea, 1/u })).toBeInTheDocument());
    expect(lens().querySelector('.kb-reactions')).toHaveAttribute('data-kb-over-ink');
    expect(lens().querySelector('[data-kb-look]')).toBeNull();
  });

  test('Esc closes a picker opened from the Lens first, and the Lens only the next time', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'React' }));
    expect(screen.getByRole('dialog', { name: 'React to Spritey\'s Card 2' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'React to Spritey\'s Card 2' })).toBeNull();
    expect(lens()).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('the reader\'s own play says "Your play" and has no React', async () => {
    width(false);
    const w = world();
    const mine = w.play('k2', w.pipe);
    const theirs = w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const own = lens().querySelector<HTMLElement>(`[data-kb-play="${mine}"]`)!;
    const other = lens().querySelector<HTMLElement>(`[data-kb-play="${theirs}"]`)!;
    expect(within(own).getByText('Your play')).toBeInTheDocument();
    expect(within(own).queryByRole('button', { name: 'React' })).toBeNull();
    expect(within(other).queryByText('Your play')).toBeNull();
    expect(within(other).getByRole('button', { name: 'React' })).toBeInTheDocument();
  });

  test('every play of a kind is reachable by Spin thread and Go to post from its row', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey); w.play('k2', w.gloomba); w.play('k2', w.pipe);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    expect(rows()).toHaveLength(3);
    expect(within(lens()).getAllByRole('button', { name: 'Spin thread' })).toHaveLength(3);
    expect(within(lens()).getAllByRole('link', { name: 'Go to post' })).toHaveLength(3);
  });

  test('every control in a row is the kit\'s skewed tile, as Hold to scrub is: React, Spin thread and Go to post speak one shape', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey); w.play('k2', w.gloomba);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const controls = [...lens().querySelectorAll<HTMLElement>('.kb-lens-row :is(button, a)')];
    expect(controls.map((c) => c.textContent)).toEqual(expect.arrayContaining(['+ React', 'Spin thread', 'Go to post']));
    for (const c of controls) {
      /* React is the meta tile (glass/meta-tile.css), the others the kit's: both skew, both stand their words upright. */
      const meta = c.classList.contains('kb-meta-tile');
      expect(c, c.textContent ?? '').toHaveClass(meta ? 'kb-meta-tile' : 'kb-kit-tile');
      expect(c.querySelector(meta ? ':scope > .kb-meta-tile-in' : ':scope > .kb-kit-tile-label'), `${c.textContent}'s words stand upright on the skew`).not.toBeNull();
    }
  });
});

describe('spinning from a play', () => {
  test('Spin thread closes the Lens and opens the spin form named for the play, which spins from the play', async () => {
    width(false);
    const w = world();
    const play = w.play('k2', w.spritey);
    const spin = vi.spyOn(w.fake, 'spin');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'Spin thread' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const form = within(await article(2)).getByRole('form', { name: 'Spin a thread from Spritey\'s Card 2' });
    expect(within(form).getByLabelText('Thread title')).toHaveFocus();
    await userEvent.type(within(form).getByLabelText('Thread title'), 'About the ink');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(spin).toHaveBeenCalledWith(play, w.pipe, 'About the ink', ''));
  });

  test('a draft typed for the post survives a switch to a play and back, and each origin keeps its own', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    const post = await article(2);
    await userEvent.click(within(post).getByRole('button', { name: 'Spin thread' }));
    const forPost = within(post).getByRole('form', { name: 'Spin a thread from post 2' });
    await userEvent.type(within(forPost).getByLabelText('Thread title'), 'About the post');
    await userEvent.type(within(forPost).getByLabelText('Your opening post (optional)'), 'Words');

    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'Spin thread' }));
    const forPlay = within(post).getByRole('form', { name: 'Spin a thread from Spritey\'s Card 2' });
    expect(within(forPlay).getByLabelText('Thread title')).toHaveValue('');
    await userEvent.type(within(forPlay).getByLabelText('Thread title'), 'About the play');

    await userEvent.click(within(post).getByRole('button', { name: 'Spin thread', expanded: false }));
    const back = within(post).getByRole('form', { name: 'Spin a thread from post 2' });
    expect(within(back).getByLabelText('Thread title')).toHaveValue('About the post');
    expect(within(back).getByLabelText('Your opening post (optional)')).toHaveValue('Words');

    /* And the play's is there when it is opened again. */
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    await userEvent.click(within(lens()).getByRole('button', { name: 'Spin thread' }));
    expect(within(within(post).getByRole('form', { name: 'Spin a thread from Spritey\'s Card 2' })).getByLabelText('Thread title')).toHaveValue('About the play');
  });
});

describe('a Lens that does not block the page', () => {
  test('it is aria-modal="false" and nothing on the page is inert while it is open', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(lens()).toHaveAttribute('aria-modal', 'false');
    /* Asserted on a post that stays on screen, never by counting across a document whose posts have gone. */
    const post = await article(2);
    expect(post).toBeInTheDocument();
    expect(post.closest('[inert]')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(within(post).getByRole('button', { name: 'Spin thread' })).toBeEnabled();
    await userEvent.click(within(post).getByRole('button', { name: 'Spin thread' }));
    expect(within(post).getByRole('form', { name: /^Spin a thread/u })).toBeInTheDocument();
    expect(lens()).toBeInTheDocument();
  });

  test('it is a sheet under 40em and a dock at the right on a desktop', async () => {
    width(false);
    const w = world();
    w.play('k2');
    const view = open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await act(async () => {});
    expect(lens()).toHaveAttribute('data-kb-lens', 'dock');
    view.unmount();
    width(true);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await act(async () => {});
    expect(lens()).toHaveAttribute('data-kb-lens', 'sheet');
  });

  test('it is a sheet at a tablet\'s width too (up to 64em), where the dock would leave the post too narrow', async () => {
    width(false, true);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await act(async () => {});
    expect(lens()).toHaveAttribute('data-kb-lens', 'sheet');
  });
});


describe('the tablist', () => {
  test('has a label of its own, distinct from the dialog\'s', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(within(lens()).getByRole('tablist', { name: 'Card kinds' })).toBeInTheDocument();
    expect(lens()).toHaveAccessibleName('Cards on this post');
  });

  test('focus moves to the open tab without scrolling the page', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    const real = HTMLElement.prototype.focus;
    const calls: Array<[Element, unknown]> = [];
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) { calls.push([this, options]); return real.call(this, options); });
    await userEvent.click(mark);
    const onTab = calls.filter(([el]) => el === tab('Card 2'));
    expect(onTab.length).toBeGreaterThan(0);
    expect(onTab[0]![1]).toEqual({ preventScroll: true });
  });
});

describe('Who across tabs', () => {
  test('stays unfolded when the tab changes, and is folded again by the next Lens', async () => {
    width(false);
    const w = world();
    const a = w.play('k2');
    const b = w.play('k3');
    open(w);
    await userEvent.click(await markOf(2, 'Card 3'));
    await userEvent.click(whoButton());
    expect(rows()).toEqual([b]);
    await userEvent.click(tab('Card 2'));
    expect(whoButton()).toHaveAttribute('aria-expanded', 'true');
    expect(rows()).toEqual([a]);
    await userEvent.click(tab('Card 3'));
    expect(rows()).toEqual([b]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await markOf(2, 'Card 3'));
    expect(rows()).toEqual([]);
  });
});

describe('the Tab order around a Lens drawn at the end of the body', () => {
  test('Tab past its last control goes to the element after the mark, Shift+Tab before its first goes back to the mark, and it stays open', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    /* The first stop is the open tab and the last is Who's disclosure. */
    expect(tab('Card 2')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(mark).toHaveFocus();
    expect(lens()).toBeInTheDocument();
    whoButton().focus();
    await userEvent.tab();
    expect(within(await article(2)).getByRole('link', { name: 'Permalink to post #2' })).toHaveFocus();
    expect(lens()).toBeInTheDocument();
  });

  test('a control the page hides right after the mark is skipped: Tab lands on the next one that can be seen', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    const link = within(await article(2)).getByRole('link', { name: 'Permalink to post #2' });
    for (const hide of ['display: none', 'visibility: hidden']) {
      const hidden = document.createElement('button');
      hidden.setAttribute('style', hide);
      hidden.textContent = 'hidden';
      mark.closest('header')!.insertBefore(hidden, link);
    }
    await userEvent.click(mark);
    whoButton().focus();
    await userEvent.tab();
    expect(link).toHaveFocus();
  });
});

describe('the Lens follows its mark', () => {
  test('a mark that leaves the strip (it narrows) is replaced as the anchor by the "+N" that now hides its kind, and nothing is measured from a detached node', async () => {
    const listeners = new Set<() => void>();
    const query = { matches: false, media: '(max-width: 40em)', addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l), addListener: () => {}, removeListener: () => {} };
    vi.stubGlobal('matchMedia', () => query as unknown as MediaQueryList);
    const w = world();
    for (const k of KEYS) w.play(k);
    open(w);
    const post = await article(2);
    /* Billing is newest first: k6 k5 k4 k3 are drawn on a desktop, and k3 is the last. */
    const mark = await within(post).findByRole('button', { name: /^Card 3, 1 play/u });
    await userEvent.click(mark);
    const measured: Element[] = [];
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { measured.push(this); return real.call(this); });
    query.matches = true;
    await act(async () => { for (const l of [...listeners]) l(); });
    expect(mark.isConnected).toBe(false);
    expect(lens()).toBeInTheDocument();
    measured.length = 0;
    await act(async () => { window.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 40)); });
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.filter((el) => !el.isConnected)).toEqual([]);
    expect(measured.some((el) => el.classList.contains('kb-mark-more'))).toBe(true);
  });
});

describe('the first frame of a row', () => {
  test('has the count of threads spun from the play when the page has read it', async () => {
    width(false);
    const w = world();
    const play = w.play('k2', w.spritey);
    await w.fake.spin(play, w.pipe, 'All about the ink', '');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    /* A synchronous click: nothing but the first frame is drawn when it returns. */
    fireEvent.click(whoButton());
    const row = lens().querySelector<HTMLElement>(`[data-kb-play="${play}"]`)!;
    expect(within(row).getByText('1 thread spun from this play')).toBeInTheDocument();
  });
});

describe('the page\'s one Lens', () => {
  test('leaving the page closes it', () => {
    let grab!: ReturnType<typeof useLensStore>;
    function Probe() { grab = useLensStore(); return null; }
    const view = render(<LensProvider><Probe /></LensProvider>);
    grab.toggle({ owner: 'a', card: 'k1', opener: document.body });
    expect(grab.get()?.card).toBe('k1');
    view.unmount();
    expect(grab.get()).toBeNull();
  });

  test('opening a Lens wakes the strip that owns it and no other', () => {
    const renders = { a: 0, b: 0 };
    let grab!: ReturnType<typeof useLensStore>;
    function Strip({ owner }: { readonly owner: 'a' | 'b' }) {
      const store = useLensStore();
      grab = store;
      useLensFor(store, owner);
      renders[owner]++;
      return null;
    }
    render(<LensProvider><Strip owner="a" /><Strip owner="b" /></LensProvider>);
    const [a0, b0] = [renders.a, renders.b];
    act(() => grab.toggle({ owner: 'a', card: 'k1', opener: document.body }));
    expect([renders.a - a0, renders.b - b0]).toEqual([1, 0]);
    act(() => grab.toggle({ owner: 'b', card: 'k1', opener: document.body }));
    expect([renders.a - a0, renders.b - b0]).toEqual([2, 1]);
    act(() => grab.select('k2'));
    expect([renders.a - a0, renders.b - b0]).toEqual([2, 2]);
  });
});

export type { World };

/*
 * As it landed (docs/plans/2026-11-03-effect-history-plan.md, Task 5): a play's moment drawn in the post's body, in a glass frame,
 * one on the page at a time and gone with its Lens. Card 1 stacks, so a moment draws it still from what it had saved then; Card 2 is
 * a takeover that lifts the post, which a moment never replaces.
 */
describe('As it landed', () => {
  const strokes = vi.fn();
  function Washy({ plays, states, still, show, children }: EffectProps) {
    const washed = plays.map((p) => (states[p.id]?.state as { washed?: number } | undefined)?.washed ?? 0);
    useEffect(() => { show({ progress: null, state: `washed ${washed.join(', ')}`, yours: false, controls: [], notes: {} }); }, [show, washed.join()]);
    return <div data-kb-washy={still ? 'still' : 'live'} data-kb-washed={washed.join()} onPointerDown={still ? undefined : strokes}>{children}</div>;
  }
  const Lift = ({ children }: EffectProps) => <div data-kb-lift>{children}</div>;
  const lifted = cards.map((c) => (c.key === 'k1' ? { ...c, Effect: Washy } : c.key === 'k2' ? { ...c, Effect: Lift, takeover: true } : c));

  /* Card 1 lands on post 2 over nothing, is saved at 40%, then the post is edited, Card 2 lifts it, and the wash is finished. */
  async function landed(before?: (w: World) => void) {
    width(false);
    const w = world();
    before?.(w);
    const k1 = w.play('k1');
    w.fake.signInAs(w.other);
    const saved = await w.fake.saveEffect(k1, w.spritey, { washed: 0.4 });
    w.fake.clock.advance(60_000);
    const k1b = w.play('k1', w.gloomba, w.second, 2);
    await w.fake.edit(w.second, w.spritey, 'post 2, edited');
    w.play('k2');
    await w.fake.saveEffect(k1, w.spritey, { washed: 1 });
    w.fake.signInAs(w.me);
    expect(saved.ok).toBe(true);
    open(w, lifted);
    await userEvent.click(await markOf(2, 'Card 1'));
    await userEvent.click(whoButton());
    return { w, k1, k1b };
  }
  const landedButton = (play: Id) => within(lens().querySelector<HTMLElement>(`[data-kb-play="${play}"]`)!).getByRole('button', { name: 'As it landed' });
  const frame = async () => within(await article(2)).findByRole('group', { name: /^As it landed/u });

  test('draws the moment\'s version in place of the live body, still, inside the takeover\'s lift', async () => {
    const { k1b } = await landed();
    const button = landedButton(k1b);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    const post = await article(2);
    const box = await frame();
    expect(box.closest('[data-kb-lift]')).not.toBeNull();
    /* The words as they read then, and the wash as it was saved then: the first layer at 40%, the second as it landed. */
    expect(within(box).getByText('post 2')).toBeInTheDocument();
    expect(within(post).queryByText('post 2, edited')).toBeNull();
    await waitFor(() => expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0.4,0'));
    expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washy', 'still');
    expect(post.querySelector('[data-kb-washy="live"]')).toBeNull();
    /* The tag, and the frame's words: the still card's own, and what is named. */
    expect(within(box).getByText(/^As it landed/u)).toBeInTheDocument();
    expect(await within(box).findByText(/washed 0\.4, 0/u)).toBeInTheDocument();
    /* Pressed again, it is gone. */
    await userEvent.click(button);
    expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
    expect(within(await article(2)).getByText('post 2, edited')).toBeInTheDocument();
  });

  test('a moment taken before Card 2 names nothing of it, and one taken over Card 1 lists what else was there', async () => {
    const { k1 } = await landed();
    await userEvent.click(landedButton(k1));
    const box = await frame();
    expect(within(box).queryByText(/Also on the post then/u)).toBeNull();
    await waitFor(() => expect(box.querySelector('[data-kb-washy]')).toHaveAttribute('data-kb-washed', '0'));
  });

  test('Esc, the ×, another post\'s Lens and Back to now each bring the live body back', async () => {
    const { k1b } = await landed((w) => { w.play('k3', w.spritey, w.third); });
    const back = async () => {
      await userEvent.click(await markOf(2, 'Card 1'));
      if (!within(lens()).queryByRole('button', { name: 'As it landed' })) await userEvent.click(whoButton());
      await userEvent.click(landedButton(k1b));
      await frame();
    };
    const live = async () => waitFor(async () => {
      expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
      expect(within(await article(2)).getByText('post 2, edited')).toBeInTheDocument();
    });
    await userEvent.click(landedButton(k1b));
    await frame();
    await userEvent.keyboard('{Escape}');
    await live();
    await back();
    await userEvent.click(within(lens()).getByRole('button', { name: 'Close' }));
    await live();
    await back();
    await userEvent.click(await markOf(3, 'Card 3'));
    await live();
    await userEvent.click(within(lens()).getByRole('button', { name: 'Close' }));
    await back();
    await userEvent.click(within(await frame()).getByRole('button', { name: 'Back to now' }));
    await live();
    expect(lens()).toBeInTheDocument();
  });

  test('while a moment shows, the marks stay pressable and no stroke reaches the live effect', async () => {
    const { k1b } = await landed();
    await userEvent.click(landedButton(k1b));
    const box = await frame();
    fireEvent.pointerDown(box.querySelector('[data-kb-washy]')!);
    fireEvent.pointerDown(within(box).getByText('post 2'));
    expect(strokes).not.toHaveBeenCalled();
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
  });

  test('a moment that does not load says so plainly, with Try again, and Back to now still works', async () => {
    const { w, k1b } = await landed();
    const read = vi.spyOn(w.fake, 'playMoment').mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(landedButton(k1b));
    const box = await frame();
    expect(await within(box).findByText('The moment did not load.')).toBeInTheDocument();
    await userEvent.click(within(box).getByRole('button', { name: 'Try again' }));
    expect(await within(box).findByText('post 2')).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(2);
    read.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(within(box).getByRole('button', { name: 'Back to now' }));
    expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
  });

  test('Back to now gives focus back to the play\'s As it landed, and works while the moment has not loaded', async () => {
    const { w, k1b } = await landed();
    vi.spyOn(w.fake, 'playMoment').mockRejectedValue(new Error('offline'));
    await userEvent.click(landedButton(k1b));
    const box = await frame();
    expect(await within(box).findByText('The moment did not load.')).toBeInTheDocument();
    await userEvent.click(within(box).getByRole('button', { name: 'Back to now' }));
    expect(within(await article(2)).queryByRole('group', { name: /^As it landed/u })).toBeNull();
    await waitFor(() => expect(landedButton(k1b)).toHaveFocus());
    expect(landedButton(k1b)).toHaveAttribute('aria-pressed', 'false');
  });

  test('a read on its way is not sent again, and its answer is kept though the moment was hidden meanwhile', async () => {
    const { w, k1b } = await landed();
    let answer: (m: Awaited<ReturnType<typeof w.fake.playMoment>>) => void = () => {};
    const real = w.fake.playMoment.bind(w.fake);
    const read = vi.spyOn(w.fake, 'playMoment').mockImplementationOnce((id) => new Promise((resolve) => { answer = resolve; void real(id); }));
    await userEvent.click(landedButton(k1b));
    await userEvent.click(landedButton(k1b));
    await userEvent.click(landedButton(k1b));
    await act(async () => { answer(await real(k1b)); });
    expect(await within(await frame()).findByText('post 2')).toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('a moment is read once for the page, however often it is shown', async () => {
    const { w, k1b } = await landed();
    const read = vi.spyOn(w.fake, 'playMoment');
    await userEvent.click(landedButton(k1b));
    await frame();
    await userEvent.click(landedButton(k1b));
    await userEvent.click(landedButton(k1b));
    await frame();
    expect(read).toHaveBeenCalledTimes(1);
  });
});


/* An admin's End this card (docs/plans/2026-11-05-bot-card-options-plan.md, Task 6): on a face-up play still in force, to an admin alone. */
describe('End this card', () => {
  const endButton = () => within(lens()).queryByRole('button', { name: 'End this card' });
  const unfold = async () => { await userEvent.click(whoButton()); };
  const openKind = async (n: number, card: string) => { await userEvent.click(await markOf(n, card)); await unfold(); };

  test('is offered to an admin on a live face-up play', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.play('k2');
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeInTheDocument();
  });

  test('is never offered to a player who is not an admin', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeNull();
  });

  test('is not offered on a caught play', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.second, 'k2', { caught: w.third });
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeNull();
  });

  test('is not offered on an ended play, which reads Ended by an admin', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    const played = w.play('k2');
    expect((await w.fake.reverseCard(played)).ok).toBe(true);
    open(w);
    const mark = await markOf(2, 'Card 2');
    await userEvent.click(mark);
    expect(within(lens()).getByText('Ended by an admin', { selector: '.kb-lens-line' })).toBeInTheDocument();
    await unfold();
    expect(endButton()).toBeNull();
  });

  test('is not offered on a card back, even to an admin', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.set(w.spritey, w.second, 'k2', { at: Date.now() });
    open(w);
    await userEvent.click(await within(await article(2)).findByRole('button', { name: /^A card set face down/u }));
    await unfold();
    expect(endButton()).toBeNull();
  });

  test('asks first in plain words naming the card and its caster, then ends the play for everyone', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    const played = w.play('k2');
    const reverse = vi.spyOn(w.fake, 'reverseCard');
    open(w);
    await openKind(2, 'Card 2');
    await userEvent.click(endButton()!);
    const ask = screen.getByRole('dialog', { name: 'End this card?' });
    expect(within(ask).getByText('End this Card 2 by Spritey? Its layer comes off for everyone, and nothing is refunded.')).toBeInTheDocument();
    expect(reverse).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole('button', { name: 'End it' }));
    expect(reverse).toHaveBeenCalledWith(played);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End this card?' })).toBeNull());
    expect(within(lens()).getByText('Ended by an admin', { selector: '.kb-lens-line' })).toBeInTheDocument();
    expect(endButton()).toBeNull();
  });

  test('is not offered on a Use that has worn off', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.second, 'k2', { ends: new Date(Date.now() - 3_600_000).toISOString() });
    open(w);
    await openKind(2, 'Card 2');
    expect(endButton()).toBeNull();
  });

  test('is offered on a Use still ahead of its end, which the worn-off one beside it is not', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.fake.clock.advance(60_000);
    w.fake.seed.card(w.spritey, w.second, 'k2', { ends: new Date(Date.now() - 3_600_000).toISOString() });
    w.fake.seed.card(w.spritey, w.second, 'k2', { ends: new Date(Date.now() + 3_600_000).toISOString() });
    open(w);
    await openKind(2, 'Card 2');
    expect(within(lens()).getAllByRole('button', { name: 'End this card' })).toHaveLength(1);
  });

  test('says Ended by an admin on the ended play of a kind alone, and offers End on the live one beside it', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    const live = w.play('k2');
    const ended = w.play('k2');
    expect((await w.fake.reverseCard(ended)).ok).toBe(true);
    open(w);
    await openKind(2, 'Card 2');
    const row = (id: Id) => lens().querySelector<HTMLElement>(`[data-kb-play="${id}"]`)!;
    expect(within(row(ended)).getByText('Ended by an admin')).toBeInTheDocument();
    expect(within(row(live)).queryByText('Ended by an admin')).toBeNull();
    expect(within(row(ended)).queryByRole('button', { name: 'End this card' })).toBeNull();
    expect(within(row(live)).getByRole('button', { name: 'End this card' })).toBeInTheDocument();
  });

  test('takes the layer off at once when no broadcast arrives, the Lens adding the end itself', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.play('k2');
    open(w);
    await openKind(2, 'Card 2');
    /* Every event the server would send is held and never delivered: only the Lens's own add can show the end. */
    w.fake.broadcast.hold();
    await userEvent.click(endButton()!);
    await userEvent.click(within(screen.getByRole('dialog', { name: 'End this card?' })).getByRole('button', { name: 'End it' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End this card?' })).toBeNull());
    expect(within(lens()).getByText('Ended by an admin', { selector: '.kb-lens-line' })).toBeInTheDocument();
    expect(endButton()).toBeNull();
    expect(w.fake.broadcast.log.some((e) => e.event === 'act')).toBe(true);
  });

  test('cancel leaves the play as it was, and a refusal\'s words are shown in the dialog', async () => {
    width(false);
    const w = world();
    w.fake.seed.admin(w.me);
    w.play('k2');
    const reverse = vi.spyOn(w.fake, 'reverseCard').mockResolvedValueOnce({ ok: false, error: 'an admin has already ended that card' });
    open(w);
    await openKind(2, 'Card 2');
    await userEvent.click(endButton()!);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(reverse).not.toHaveBeenCalled();
    await userEvent.click(endButton()!);
    await userEvent.click(screen.getByRole('button', { name: 'End it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('an admin has already ended that card');
    expect(screen.getByRole('dialog', { name: 'End this card?' })).toBeInTheDocument();
  });
});

/*
 * The Lens's frame, tabs and buttons (backfill-boards plan, Task 10; boards 28 and 29): the open tab filled in the card's ink and the others
 * outlined, one row of tabs that scrolls with the open one kept in view and a fade where more wait, a foot that fades only while more lies
 * below, and a play's actions as one grid. What a browser measures (the dock, the sheet, the last control above the HUD) is
 * e2e/lens-frame.spec.ts's.
 */
/** The rule a selector opens in lens.css, its body, with comments gone. */
const ruleOf = (selector: string): string => {
  const css = lensCss.replace(/\/\*[\s\S]*?\*\//gu, '');
  const at = css.split('\n').findIndex((l) => l.trim() === `${selector} {`);
  if (at < 0) throw new Error(`lens.css has no rule ${selector}`);
  const rest = css.split('\n').slice(at + 1);
  return rest.slice(0, rest.findIndex((l) => l.trim() === '}')).join('\n');
};

describe('the tabs', () => {
  test('the open tab is filled in the card\'s ink and the others are outlined, never the other way round', () => {
    const filled = ruleOf('.kb-lens-tab[aria-selected="true"]');
    expect(filled).toMatch(/background:\s*var\(--kb-lens-ink\)/u);
    expect(filled).toMatch(/color:\s*var\(--kb-glass-ink-neon\)/u);
    const rest = ruleOf('.kb-lens-tab');
    expect(rest).toMatch(/background:\s*transparent/u);
    expect(rest).toMatch(/border:\s*1px solid/u);
  });

  test('the open tab says it is open, the other does not, and it moves with the choice', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Card 1')).toHaveAttribute('aria-selected', 'false');
    await userEvent.click(tab('Card 1'));
    expect(tab('Card 1')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Card 2')).toHaveAttribute('aria-selected', 'false');
  });

  test('the open tab is scrolled into view when the Lens opens and when another tab is chosen', async () => {
    width(false);
    const w = world();
    w.play('k1'); w.play('k2');
    open(w);
    const into = vi.mocked(Element.prototype.scrollIntoView);
    await userEvent.click(await markOf(2, 'Card 2'));
    expect(into.mock.instances).toContain(tab('Card 2'));
    expect(into).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'center' });
    into.mockClear();
    await userEvent.click(tab('Card 1'));
    expect(into.mock.instances).toEqual([tab('Card 1')]);
  });

  test('the strip says where more wait: none while they all fit, then at the end, at both ends, at the start', async () => {
    expect(fadeOf({ scrollLeft: 0, clientWidth: 400, scrollWidth: 400 })).toBe('none');
    expect(fadeOf({ scrollLeft: 0, clientWidth: 330, scrollWidth: 700 })).toBe('end');
    expect(fadeOf({ scrollLeft: 120, clientWidth: 330, scrollWidth: 700 })).toBe('both');
    expect(fadeOf({ scrollLeft: 370, clientWidth: 330, scrollWidth: 700 })).toBe('start');
    width(false);
    const w = world();
    w.play('k1'); w.play('k2'); w.play('k3');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    const row = within(lens()).getByRole('tablist');
    const strip = row.parentElement!;
    /* A scroller jsdom does not lay out: its measures are given, and a scroll event reads them. */
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 330 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 700 });
    row.scrollLeft = 0;
    fireEvent.scroll(row);
    expect(strip).toHaveAttribute('data-kb-fade', 'end');
    row.scrollLeft = 150;
    fireEvent.scroll(row);
    expect(strip).toHaveAttribute('data-kb-fade', 'both');
  });
});

describe('the foot', () => {
  test('it fades only while scrollTop + clientHeight < scrollHeight', async () => {
    expect(moreBelow({ scrollTop: 0, clientHeight: 500, scrollHeight: 900 })).toBe(true);
    expect(moreBelow({ scrollTop: 399, clientHeight: 500, scrollHeight: 900 })).toBe(true);
    expect(moreBelow({ scrollTop: 400, clientHeight: 500, scrollHeight: 900 })).toBe(false);
    expect(moreBelow({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 })).toBe(false);
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    const body = within(lens()).getByRole('tabpanel');
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 900 });
    body.scrollTop = 0;
    fireEvent.scroll(body);
    expect(lens()).toHaveAttribute('data-kb-more', 'true');
    body.scrollTop = 400;
    fireEvent.scroll(body);
    expect(lens()).toHaveAttribute('data-kb-more', 'false');
    expect(lens().querySelector('.kb-lens-fade')).not.toBeNull();
  });

  test('the fade follows the body\'s content: a row added after the Lens opened makes it more, without a scroll', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    const body = within(lens()).getByRole('tabpanel');
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 500, writable: true });
    fireEvent.scroll(body);
    expect(lens()).toHaveAttribute('data-kb-more', 'false');
    /* A live play adds a row; the body is taller, and nothing scrolled. */
    (body as unknown as { scrollHeight: number }).scrollHeight = 900;
    await act(async () => { body.append(document.createElement('div')); });
    await waitFor(() => expect(lens()).toHaveAttribute('data-kb-more', 'true'));
  });

  test('the fade is shown by the panel\'s own state and takes no pointer', () => {
    expect(ruleOf('.kb-lens-fade')).toMatch(/display:\s*none/u);
    expect(ruleOf('.kb-lens-fade')).toMatch(/pointer-events:\s*none/u);
    expect(ruleOf(".kb-lens[data-kb-more='true'] > .kb-lens-fade")).toMatch(/display:\s*block/u);
  });
});

describe('the post the Lens keeps whole', () => {
  test('a Lens opened from an Origin keeps the whole origin in view, as it does an article', async () => {
    width(false);
    const w = world();
    w.play('k2');
    open(w);
    const mark = await markOf(2, 'Card 2');
    /* The mark's nearest origin: the element that is measured to be kept beside the Lens. */
    const origin = mark.parentElement!;
    origin.classList.add('kb-origin');
    const measured = vi.spyOn(origin, 'getBoundingClientRect');
    await userEvent.click(mark);
    await act(async () => {});
    expect(measured, 'the origin is the post kept in view').toHaveBeenCalled();
  });
});

describe('the buttons, odd and even', () => {
  test('a foot with an odd number of tiles lets its last one span both columns, and an even one lets none', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const foot = lens().querySelector<HTMLElement>('.kb-lens-row-foot')!;
    const tiles = () => [...foot.querySelectorAll<HTMLElement>('.kb-react-button, .kb-kit-tile')];
    const spans = () => tiles().filter((t) => t.hasAttribute('data-kb-span'));
    expect(tiles()).toHaveLength(4);
    expect(spans()).toHaveLength(0);
    /* One tile gone (a card with no moment to look at): three are left, and the last stands across the row. */
    await act(async () => { foot.querySelector('.kb-lens-actions > .kb-kit-tile:nth-child(2)')!.remove(); });
    expect(tiles()).toHaveLength(3);
    await waitFor(() => expect(spans()).toEqual([tiles()[2]]));
    expect(ruleOf(".kb-lens-row-foot [data-kb-span]")).toMatch(/grid-column:\s*1\s*\/\s*-1/u);
  });
});

describe('the buttons', () => {
  test('a play\'s four actions are one grid of two by two, React, Spin thread, As it landed, Go to post, every one a tile', async () => {
    width(false);
    const w = world();
    w.play('k2', w.spritey);
    open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await userEvent.click(whoButton());
    const foot = lens().querySelector<HTMLElement>('.kb-lens-row-foot')!;
    const tiles = [...foot.querySelectorAll<HTMLElement>('.kb-react-button, .kb-kit-tile')];
    expect(tiles.map((t) => t.textContent?.trim())).toEqual(['+ React', 'Spin thread', 'As it landed', 'Go to post']);
    const grid = ruleOf('.kb-lens-row-foot');
    expect(grid).toMatch(/display:\s*grid/u);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/u);
    /* The wrappers around the tiles take no box, so each tile is a cell of the grid. */
    expect(ruleOf('.kb-lens-row-foot .kb-reactions')).toMatch(/display:\s*contents/u);
    expect(ruleOf('.kb-lens-actions')).toMatch(/display:\s*contents/u);
    /* The React meta tile (36px) stands as tall as the kit tiles (44px), and the reaction tiles keep a line of their own over the grid. */
    expect(ruleOf('.kb-lens-row-foot .kb-react-button')).toMatch(/min-height:\s*44px/u);
    expect(ruleOf('.kb-lens-row-foot .kb-reaction-list')).toMatch(/grid-column:\s*1\s*\/\s*-1/u);
  });
});
