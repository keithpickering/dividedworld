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
import { axeViolations, describeViolations } from '../a11y.ts';
import { LensProvider, useLensFor, useLensStore } from './Lens.tsx';
import type { CardUi, EffectProps } from './types.ts';
import { LoadedThread } from '../loaded.tsx';

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

  test('it is a sheet under 40em and a side panel or an under panel on a desktop', async () => {
    width(false);
    const w = world();
    w.play('k2');
    const view = open(w);
    await userEvent.click(await markOf(2, 'Card 2'));
    await act(async () => {});
    expect(['side', 'under']).toContain(lens().getAttribute('data-kb-lens'));
    view.unmount();
    width(true);
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
 * A visit's tab (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/01-on-a-visit.png and 02-filed-author.png): the Lens opens on the
 * visit, ahead of the card kinds. Its words are the glass's plain voice; the Mod's lines are quoted as its own.
 */
describe('a visit\'s tab', () => {
  const HOUR = 3_600_000;
  const QUIZ = { kind: 'quiz', question: 'Which form is used to request another form?', choices: ['Form 1-A', 'Form 0', 'Form 27-B/6'], answer: 'Form 0' } as const;

  /** A visit on Spritey's post 2, and on Pipewrench's post 4 where `mine` is set: the reader plays Pipewrench. */
  function visited(o: { challenge?: Parameters<Fake['seed']['visit']>[2] extends infer T ? T extends { challenge?: infer C } ? C : never : never; mine?: boolean; endsInMs?: number } = {}) {
    const w = world();
    const clerk = w.fake.seed.staff('clerk', 'The Clerk', 'mod');
    const post = o.mine ? w.fake.seed.post(w.thread, w.pipe, 'post 4') : w.second;
    const visit = w.fake.seed.visit(clerk, post, { at: Date.now(), endsInMs: o.endsInMs ?? 161 * 60_000, line: 'Routine inspection.', ...(o.challenge ? { challenge: o.challenge } : {}) });
    return { ...w, clerk, post, visit, seq: o.mine ? 4 : 2 };
  }
  const openVisit = (w: ReturnType<typeof visited>) =>
    renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards, copy: { modRole: 'A Moderator' } });
  const visitMark = async (seq: number) => within(await article(seq)).findByRole('button', { name: /Opens the visit\.$/u });
  const visitLens = () => screen.getByRole('dialog', { name: /^Visit/u });
  /** Tab until the control has the focus, as a keyboard reader reaches it (the Lens's tab, its close cross, then its controls). */
  const tabTo = async (el: HTMLElement) => { for (let i = 0; i < 8 && document.activeElement !== el; i++) await userEvent.tab(); expect(el).toHaveFocus(); };
  /** Opens the visit's Lens and waits for its story to be read: the challenge is drawn from it. */
  const press = async (w: ReturnType<typeof visited>) => {
    await userEvent.click(await visitMark(w.seq));
    const l = visitLens();
    await waitFor(() => expect(l.querySelector('.kb-visit')).not.toHaveAttribute('aria-busy'));
    return l;
  };
  /** The filing of the visit and what it put on its author, as the tick writes them. */
  const file = (w: ReturnType<typeof visited>, by: Id = w.spritey) => {
    w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Stamped, initialed, and filed under D.' });
    return w.fake.seed.infraction(w.visit, { points: 2 });
  };

  test('is first of the Lens\'s tabs, ahead of the card kinds, and is the one open', async () => {
    width(false);
    const w = visited();
    w.play('k1');
    openVisit(w);
    const l = await press(w);
    expect(l).toHaveAccessibleName('Visit and cards on this post');
    expect(within(l).getAllByRole('tab').map((t) => t.textContent)).toEqual(['On a visit', 'Card 1']);
    expect(within(l).getByRole('tab', { name: 'On a visit' })).toHaveAttribute('aria-selected', 'true');
    expect(within(l).getByRole('tab', { name: 'On a visit' })).toHaveFocus();
    /* The arrow key moves to the cards' tab, which draws its own State, and back. */
    await userEvent.keyboard('{ArrowRight}');
    expect(within(visitLens()).getByRole('tab', { name: 'Card 1' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(within(visitLens()).getByRole('tab', { name: 'On a visit' })).toHaveAttribute('aria-selected', 'true');
  });

  describe('while it is open', () => {
    test('says who is visiting, the charge and what lands on whom and when, in the glass\'s plain words', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('heading', { name: 'The Clerk is on a visit' })).toBeInTheDocument();
      expect(l).toHaveTextContent('Charge: Rule 2: No double posting (minor, 2 warn points).');
      expect(l).toHaveTextContent(/If nobody talks it down by .*, Spritey's warn bar gains 2 warn points and this post is marked as breaking Rule 2\./u);
    });

    test('says plainly that the time is up while it waits for its filing', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, endsInMs: -60_000 });
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent(/The time is up, so it files at the next check unless it is talked down first\./u);
    });

    test('a quiz is the Mod\'s question, quoted, and its answers as full-width block buttons, one to a row', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('heading', { name: 'Talk it down' })).toBeInTheDocument();
      expect(l).toHaveTextContent('The Clerk asks: “Which form is used to request another form?”');
      const group = within(l).getByRole('group', { name: /Answers to The Clerk's question/u });
      const choices = within(group).getAllByRole('button');
      expect(choices.map((c) => c.textContent)).toEqual(['Form 1-A', 'Form 0', 'Form 27-B/6']);
      for (const c of choices) expect(c).toHaveClass('kb-visit-choice');
      expect(l).toHaveTextContent('One try for Pipewrench. A wrong answer, and The Clerk visits Pipewrench\'s next post within 24 hours, charging Obstruction (minor, 2 warn points). There is no timer.');
      expect(within(l).getByRole('status')).toBeEmptyDOMElement();
    });

    test('a right answer reached and pressed by keyboard talks it down: the result is said in the status region, and the tab and the mark follow', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 0' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('Pipewrench got past The Clerk. The visit is over, and nothing landed on Spritey.'));
      expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toBeInTheDocument();
      expect(within(await article(2)).getByRole('button', { name: /^The Clerk's visit to this post was talked down/u })).toHaveTextContent('Talked down');
      /* The try ended the visit and took the challenge with the button that was pressed: focus is on the open tab, not lost to the page. */
      expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toHaveFocus();
    });

    test('a wrong answer says so and the tail; the answers stay, spent, and one try is all it takes', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 1-A' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('That was not the answer. The Clerk will visit Pipewrench\'s next post within 24 hours.'));
      const first = within(l).getByRole('button', { name: 'Form 1-A' });
      expect(first).toHaveAttribute('aria-disabled', 'true');
      expect(first).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(within(l).getByRole('button', { name: 'Form 0' }));
      expect((await w.fake.visitStory(w.thread, w.visit, w.second)).attempts).toHaveLength(1);
      expect(within(visitLens()).getByRole('tab', { name: 'On a visit' })).toBeInTheDocument();
    });

    test('a try the server took is spent here even when the story cannot be read again, and a right one ends the visit', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      const real = w.fake.visitStory.bind(w.fake);
      let reads = 0;
      w.fake.visitStory = async (...a) => { if (++reads > 1) throw new Error('offline'); return real(...a); };
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 0' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('Pipewrench got past The Clerk.'));
      await waitFor(() => expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toBeInTheDocument());
      expect((await real(w.thread, w.visit, w.second)).attempts).toHaveLength(1);
    });

    test('a wrong try the server took leaves the answers spent when the story cannot be read again', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      const real = w.fake.visitStory.bind(w.fake);
      let reads = 0;
      w.fake.visitStory = async (...a) => { if (++reads > 1) throw new Error('offline'); return real(...a); };
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 1-A' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('That was not the answer'));
      await waitFor(() => expect(within(l).getByRole('button', { name: 'Form 0' })).toHaveAttribute('aria-disabled', 'true'));
    });

    test('a refusal is said in the server\'s words, in the same region', async () => {
      width(false);
      const w = visited({ challenge: { kind: 'bribe', price: 50 } });
      openVisit(w);
      const l = await press(w);
      await userEvent.click(within(l).getByRole('button', { name: 'Pay 0.50 Aura' }));
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('that costs 50, and your wallet holds 0'));
    });

    test('draws no try before its story is read, and none for a visit the story says has ended', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      /* The page was read while the visit was open; it filed before the Lens read its story. */
      let release!: () => void;
      const held = new Promise<void>((r) => { release = r; });
      const real = w.fake.visitStory.bind(w.fake);
      w.fake.visitStory = async (...a) => { await held; return real(...a); };
      openVisit(w);
      const mark = await visitMark(w.seq);
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(w.visit, { points: 2 });
      await userEvent.click(mark);
      const l = visitLens();
      expect(within(l).queryByRole('group')).toBeNull();
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
      release();
      await within(l).findByRole('tab', { name: 'Filed' });
      expect(within(l).queryByRole('group')).toBeNull();
      expect(within(l).queryByRole('button', { name: /^Form/u })).toBeNull();
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
    });

    test('a bribe is one button with its price, which ends the visit', async () => {
      width(false);
      const w = visited({ challenge: { kind: 'bribe', price: 50 } });
      w.fake.seed.wallet(w.me, 200);
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('The Clerk will go for a price, and the price goes nowhere. One try for Pipewrench.');
      await userEvent.click(within(l).getByRole('button', { name: 'Pay 0.50 Aura' }));
      await waitFor(() => expect(within(visitLens()).getByRole('tab', { name: 'Talked down' })).toBeInTheDocument());
      expect(within(visitLens()).getByRole('status')).toHaveTextContent('Pipewrench got past The Clerk.');
    });

    test('a distraction asks for no answer and no price: any card cast on the thread talks it down', async () => {
      width(false);
      const w = visited({ challenge: { kind: 'distraction' } });
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('The Clerk is not moved by an answer or a price. Any card cast on this thread talks it down.');
      expect(within(l).queryByRole('group')).toBeNull();
      expect(within(l).queryByRole('button', { name: /^Pay/u })).toBeNull();
    });

    test('a reader with no mask to try as is told where to pick one', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.signInAs(w.fake.seed.account('lurker'));
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('Pick a mask in the HUD to try.');
    });

    test('offers no Appeal: there is nothing to appeal yet', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      openVisit(w);
      const l = await press(w);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });
  });

  describe('once filed', () => {
    test('says what landed on whom and when it drops off, and "Filed" names the tab and the mark', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      file(w);
      openVisit(w);
      const mark = await visitMark(w.seq);
      expect(mark).toHaveTextContent('Filed');
      await userEvent.click(mark);
      const l = visitLens();
      expect(within(l).getByRole('tab', { name: 'Filed' })).toHaveAttribute('aria-selected', 'true');
      expect(within(l).getByRole('heading', { name: 'The Clerk filed its report' })).toBeInTheDocument();
      await waitFor(() => expect(l).toHaveTextContent(/Rule 2: No double posting: a minor breach\. Spritey's warn bar gained 2 points; they drop off on [A-Z][a-z]{2} \d{1,2}\. The bar now stands at 2 of 10\. The post keeps its words under the notice\./u));
      /* Nothing to talk down any more. */
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
    });

    test('the bar now is read with the story: a stale page value never appears, and an expired infraction shows none', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      file(w);
      openVisit(w);
      const mark = await visitMark(w.seq);
      /* The page was read with the bar at 2; another visit filed before the Lens opened, so the bar stands at 6. */
      const other = w.fake.seed.visit(w.clerk, w.third, { at: Date.now() });
      w.fake.seed.visitEnd(other, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(other, { points: 4, band: 'moderate' });
      await userEvent.click(mark);
      const l = visitLens();
      await within(l).findByText(/The bar now stands at 6 of 10\./u);
      expect(l).not.toHaveTextContent(/2 of 10/u);
    });

    test('an expired infraction says what it did and shows no bar', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(w.visit, { points: 2, at: Date.now() - 30 * 24 * HOUR, expiresAt: Date.now() - 16 * 24 * HOUR });
      openVisit(w);
      const l = await press(w);
      await within(l).findByText(/they dropped off on/u);
      expect(l).not.toHaveTextContent(/of 10/u);
    });

    test('a filing whose infraction cannot be read says only that the visit filed, with no number', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      openVisit(w);
      const l = await press(w);
      expect(l).toHaveTextContent('The Clerk filed its report');
      expect(l).toHaveTextContent('The visit filed.');
      expect(l).not.toHaveTextContent(/\d+ (warn )?points?/u);
      expect(l).not.toHaveTextContent(/of 10/u);
    });

    test('Appeal, with its price and terms, is the author\'s current mask\'s alone, and opens the form', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      const inf = file(w);
      openVisit(w);
      const l = await press(w);
      const appeal = await within(l).findByRole('button', { name: 'Appeal · 0.50 Aura' });
      expect(l).toHaveTextContent('The Clerk hears it, or whoever has taken its place. It is refunded if overturned. It may be upheld, reduced, or increased by up to 2 warn points. One appeal per filing, and your plea is public.');
      appeal.focus();
      await userEvent.keyboard('{Enter}');
      /* The post provides AppealCtx (Task 13): the same panel moves to the Appeal form, whose tab takes the focus. */
      const form = await screen.findByRole('dialog', { name: 'Appeal on this post' });
      expect(within(form).getByRole('tab', { name: 'Appeal' })).toHaveFocus();
      expect(within(form).getByRole('form', { name: 'Appeal' })).toBeInTheDocument();
      void inf;
    });

    test('another player\'s reader sees the state and no Appeal', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      file(w);
      openVisit(w);
      const l = await press(w);
      await within(l).findByText(/gained 2 points/u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });

    test('the author\'s own other mask sees no Appeal either: it is the current mask\'s', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      file(w);
      const other = w.fake.seed.character(w.me, 'Second Mask', 'face');
      /* The HUD's character is changed on this device, as the picker does. */
      localStorage.setItem(`kb-hud:${w.me}`, other);
      openVisit(w);
      await userEvent.click(await visitMark(w.seq));
      const l = visitLens();
      await within(l).findByText(/gained 2 points/u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });

    test('an appeal waiting says so and offers no second one; a ruling is said', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      const inf = file(w);
      const appeal = w.fake.seed.appeal(w.pipe, inf, 'I was posting a changelog.');
      openVisit(w);
      let l = await press(w);
      await within(l).findByText(/An appeal of it is waiting to be heard\. If it cannot be heard, the fee is refunded\./u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
      await userEvent.click(await visitMark(w.seq));
      w.fake.seed.ruling(appeal, w.clerk, 'overturned', { line: 'Fine. Fine!' });
      await userEvent.click(await visitMark(w.seq));
      l = visitLens();
      await within(l).findByText(/The Clerk heard an appeal of it and overturned it, so the points are gone\./u);
    });

    test('points that have dropped off are not appealed', async () => {
      width(false);
      const w = visited({ challenge: QUIZ, mine: true });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Filed.' });
      w.fake.seed.infraction(w.visit, { points: 2, at: Date.now() - 30 * 24 * HOUR, expiresAt: Date.now() - 16 * 24 * HOUR });
      openVisit(w);
      const l = await press(w);
      await within(l).findByText(/they dropped off on/u);
      expect(within(l).queryByRole('button', { name: /^Appeal/u })).toBeNull();
    });
  });

  describe('when it ended another way', () => {
    test('talked down, it says who and that nothing landed', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      const attempt = w.fake.seed.report(w.gloomba, w.second, 'unused');
      w.fake.seed.visitEnd(w.visit, { outcome: 'intercepted', by: attempt, line: 'Gloomba got past The Clerk\'s quiz.' });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('tab', { name: 'Talked down' })).toHaveAttribute('aria-selected', 'true');
      expect(within(l).getByRole('heading', { name: 'The Clerk was talked down' })).toBeInTheDocument();
      expect(l).toHaveTextContent(/Nothing landed on Spritey\./u);
      expect(within(l).queryByRole('heading', { name: 'Talk it down' })).toBeNull();
    });

    test('trapped, it says a trap on the post ended it', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      w.fake.seed.visitEnd(w.visit, { outcome: 'trapped', line: 'A trap set on this post sprang as the visit began, and the visit ended.' });
      openVisit(w);
      const l = await press(w);
      expect(within(l).getByRole('tab', { name: 'Trapped' })).toBeInTheDocument();
      expect(l).toHaveTextContent(/A trap set on this post sprang when the visit began/u);
      expect(l).toHaveTextContent(/Nothing landed on Spritey\./u);
    });
  });

  describe('how it went', () => {
    test('is a fold of Lens rows, each the Act with React and Spin thread, the Mod\'s words quoted and its role named', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      /* Dated by the real clock, as the visit is: the rows are in the order the Acts happened. */
      const report = w.fake.seed.report(w.gloomba, w.second, 'Third time this week.', { at: Date.now() - 2 * 60_000 });
      w.fake.seed.verdict(report, w.clerk, 'visit', { line: 'Noted. Inspecting.', visit: w.visit, at: Date.now() - 60_000 });
      w.fake.seed.visitEnd(w.visit, { outcome: 'filed', line: 'Stamped, initialed, and filed under D.', at: Date.now() + 60_000 });
      w.fake.seed.infraction(w.visit, { points: 2 });
      openVisit(w);
      const l = await press(w);
      const fold = await within(l).findByRole('button', { name: /^How it went · 4 acts$/u });
      expect(fold).toHaveAttribute('aria-expanded', 'false');
      fold.focus();
      await userEvent.keyboard('{Enter}');
      expect(fold).toHaveAttribute('aria-expanded', 'true');
      const rows = [...l.querySelectorAll<HTMLElement>('.kb-lens-row')];
      expect(rows).toHaveLength(4);
      expect(rows[0]).toHaveTextContent('Gloomba · reported this post');
      expect(rows[0]).toHaveTextContent('“Third time this week.”');
      expect(rows[1]).toHaveTextContent('The Clerk · A Moderator · judged the report: it sent a visit');
      expect(rows[1]).toHaveTextContent('“Noted. Inspecting.”');
      expect(rows[2]).toHaveTextContent('began the visit');
      expect(rows[2]).toHaveTextContent('“Routine inspection.”');
      expect(rows[3]).toHaveTextContent('The Clerk · A Moderator · filed');
      expect(rows[3]).toHaveTextContent('“Stamped, initialed, and filed under D.”');
      for (const r of rows) {
        expect(within(r).getByRole('button', { name: 'Spin thread' })).toBeInTheDocument();
        expect(within(r).getByRole('button', { name: /React/u })).toBeInTheDocument();
      }
    });

    test('a quiz attempt is a row naming the answer, and Spin thread closes the Lens and opens the post\'s spin form for it', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await tabTo(within(l).getByRole('button', { name: 'Form 1-A' }));
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(within(l).getByRole('status')).toHaveTextContent('That was not the answer'));
      const fold = await within(l).findByRole('button', { name: /^How it went · 2 acts$/u });
      await userEvent.click(fold);
      const row = [...l.querySelectorAll<HTMLElement>('.kb-lens-row')].find((r) => r.textContent!.includes('tried the quiz'))!;
      expect(row).toHaveTextContent('Pipewrench · tried the quiz and was wrong');
      expect(row).toHaveTextContent('“Form 1-A”');
      await userEvent.click(within(row).getByRole('button', { name: 'Spin thread' }));
      expect(screen.queryByRole('dialog', { name: /^Visit/u })).toBeNull();
      expect(document.getElementById(`spin-${w.second}`)!.children.length).toBeGreaterThan(0);
    });
  });

  describe('accessibility', () => {
    test.each(['open quiz', 'open bribe', 'open distraction', 'filed'] as const)('axe passes on the Lens with the %s tab open', async (which) => {
      width(false);
      const w = visited({ mine: which === 'filed', challenge: which === 'open bribe' ? { kind: 'bribe', price: 50 } : which === 'open distraction' ? { kind: 'distraction' } : QUIZ });
      if (which === 'filed') file(w);
      openVisit(w);
      const l = await press(w);
      if (which === 'filed') await within(l).findByRole('button', { name: /^Appeal/u });
      await userEvent.click(await within(l).findByRole('button', { name: /^How it went/u }));
      const v = await axeViolations(l);
      expect(v, describeViolations(v)).toEqual([]);
    });

    test('every control in the tab is a button, a link or a tab: the challenge has no timer and no pointer-only control', async () => {
      width(false);
      const w = visited({ challenge: QUIZ });
      openVisit(w);
      const l = await press(w);
      await within(l).findByRole('button', { name: /^How it went/u });
      for (const el of l.querySelectorAll<HTMLElement>('[onclick], [role="button"]')) expect(el.tagName, el.outerHTML).toBe('BUTTON');
      expect(l.querySelector('progress, [role="timer"], [role="progressbar"]')).toBeNull();
    });
  });
});
