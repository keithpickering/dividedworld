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
import { LensProvider, useLensFor, useLensStore } from './Lens.tsx';
import type { CardUi, EffectProps } from './types.ts';

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
  renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: ui });
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
    await waitFor(() => expect(within(lens()).getByText(/^Tea, 1/u)).toBeInTheDocument());
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
