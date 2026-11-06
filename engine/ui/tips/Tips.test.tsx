/**
 * The tips' frame (docs/plans/2026-11-02-onboarding-plan.md, Task 4): the page shows one tip, never while the player types or a game
 * effect holds the screen, only while the account's tips are on and the key is unseen; Got it and Skip all tips write the account;
 * the spotlight is a dialog that holds focus and answers Escape; and the card callouts share the page's budget and obey Skip.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { CardUi } from '../cards/types.ts';
import type { Fake } from '../data/fake.ts';
import { Modal } from '../modal.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import type { TipKey } from './keys.ts';
import { TipsProvider, useHoldScreen, useTip, type TipOptions } from './Tips.tsx';
import { LoadedThread } from '../loaded.tsx';

beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

/** A control that wants a tip, pointing at itself. */
function Wants({ tip, options, label = tip }: { readonly tip: TipKey; readonly options?: TipOptions; readonly label?: string }) {
  const el = useRef<HTMLButtonElement>(null);
  useTip(tip, el, options);
  return <button type="button" ref={el}>{`target ${label}`}</button>;
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });
const dialog = () => screen.queryByRole('dialog');

function signedIn(): Fake {
  const fake = buildWorld();
  fake.signInAs(fake.seed.account('me'));
  return fake;
}
const open = (fake: Fake, ui: ReactElement, options: Parameters<typeof renderIn>[2] = {}) => renderIn(fake, <TipsProvider>{ui}</TipsProvider>, options);

describe('the page shows one tip', () => {
  test('two tips wanted on one load show one, and the other waits for the next load', async () => {
    const fake = signedIn();
    open(fake, <><Wants tip="grid" /><Wants tip="ghost" /></>);
    const first = await screen.findByRole('dialog', { name: 'Title of grid' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await userEvent.click(within(first).getByRole('button', { name: 'Got it' }));
    await settle();
    expect(dialog()).toBeNull();
    expect((await fake.preferences()).tipsSeen).toEqual(['grid']);
  });

  test('a tip already seen does not show, and the one after it does', async () => {
    const fake = signedIn();
    await fake.seeTip('grid');
    open(fake, <><Wants tip="grid" /><Wants tip="ghost" /></>);
    expect(await screen.findByRole('dialog', { name: 'Title of ghost' })).toBeInTheDocument();
  });

  test('the steps of one group take turns, each "N of 3", on the page\'s one budget', async () => {
    const fake = signedIn();
    const step = (n: number) => ({ group: 'tour', step: { n, of: 3 } });
    open(fake, <><Wants tip="tour-plate" options={step(1)} /><Wants tip="tour-orbs" options={step(2)} /><Wants tip="grid" /></>);
    const one = await screen.findByRole('dialog', { name: 'Title of tour-plate' });
    expect(within(one).getByText(/1 of 3/u)).toBeInTheDocument();
    await userEvent.click(within(one).getByRole('button', { name: 'Got it' }));
    const two = await screen.findByRole('dialog', { name: 'Title of tour-orbs' });
    expect(within(two).getByText(/2 of 3/u)).toBeInTheDocument();
    await userEvent.click(within(two).getByRole('button', { name: 'Got it' }));
    await settle();
    expect(dialog(), 'the grid tip is another group, so it waits for the next load').toBeNull();
  });

  test('a tip wanted while a textarea has focus waits for the next load', async () => {
    const fake = signedIn();
    open(fake, <><textarea aria-label="Reply" autoFocus /><Wants tip="grid" /></>);
    await settle();
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveFocus();
    expect(dialog()).toBeNull();
    expect((await fake.preferences()).tipsSeen, 'a tip that waits is not seen').toEqual([]);
  });

  test('nor while focus is in a contenteditable', async () => {
    const fake = signedIn();
    open(fake, <><div contentEditable suppressContentEditableWarning tabIndex={0} role="textbox" aria-label="Editor" data-testid="ce" /><Wants tip="grid" /></>);
    act(() => { screen.getByTestId('ce').focus(); });
    await settle();
    expect(dialog()).toBeNull();
  });

  test('a tip wanted while a game effect holds the screen waits for the next load', async () => {
    const fake = signedIn();
    function Takeover() {
      const hold = useHoldScreen();
      useEffect(() => { hold(true); }, [hold]);
      return null;
    }
    open(fake, <><Takeover /><Wants tip="grid" /></>);
    await settle();
    expect(dialog()).toBeNull();
  });

  test('a hold that begins while a tip is up hides it, and the tip comes back, unseen, when the hold lets go', async () => {
    const fake = signedIn();
    let setHeld: (held: boolean) => void = () => {};
    function Takeover() {
      const hold = useHoldScreen();
      setHeld = hold;
      return null;
    }
    open(fake, <><Takeover /><Wants tip="grid" /></>);
    expect(await screen.findByRole('dialog', { name: 'Title of grid' })).toBeInTheDocument();
    act(() => { setHeld(true); });
    await settle();
    expect(dialog(), 'no tip over a held screen').toBeNull();
    expect((await fake.preferences()).tipsSeen, 'hidden by the hold, not seen').toEqual([]);
    act(() => { setHeld(false); });
    expect(await screen.findByRole('dialog', { name: 'Title of grid' })).toBeInTheDocument();
  });

  test('a tip is not shown over an open modal', async () => {
    const fake = signedIn();
    open(fake, <><Modal title="Something else" onClose={() => {}}>Words.</Modal><Wants tip="grid" /></>);
    await settle();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Title of grid' })).toBeNull();
  });

  test('with tips off nothing shows, and nothing is written', async () => {
    const fake = signedIn();
    await fake.skipTips();
    const see = vi.spyOn(fake, 'seeTip');
    open(fake, <Wants tip="grid" />);
    await settle();
    expect(dialog()).toBeNull();
    expect(see).not.toHaveBeenCalled();
  });

  test('a visitor, with no account to remember a tip on, sees none', async () => {
    const fake = buildWorld();
    open(fake, <Wants tip="grid" />);
    await settle();
    expect(dialog()).toBeNull();
  });
});

describe('Got it and Skip all tips', () => {
  test('Got it sees the tip on the account', async () => {
    const fake = signedIn();
    open(fake, <Wants tip="ghost" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Got it' }));
    await waitFor(async () => expect((await fake.preferences()).tipsSeen).toEqual(['ghost']));
    expect(dialog()).toBeNull();
  });

  test('Skip all tips turns every tip off on the account, and nothing shows again until they are restored', async () => {
    const fake = signedIn();
    const view = open(fake, <Wants tip="grid" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip all tips' }));
    await waitFor(async () => expect((await fake.preferences()).tips).toBe('off'));
    expect(dialog()).toBeNull();
    view.unmount();
    open(fake, <Wants tip="ghost" />);
    await settle();
    expect(dialog(), 'the next load').toBeNull();
    await fake.restoreTips();
    view.unmount();
    open(fake, <Wants tip="ghost" />);
    expect(await screen.findByRole('dialog', { name: 'Title of ghost' })).toBeInTheDocument();
  });

  test('Escape is Skip all tips', async () => {
    const fake = signedIn();
    open(fake, <Wants tip="grid" />);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => expect((await fake.preferences()).tips).toBe('off'));
    expect(dialog()).toBeNull();
    expect((await fake.preferences()).tipsSeen, 'Skip is not Got it').toEqual([]);
  });
});

describe('the spotlight', () => {
  test('is a modal dialog named by its title and described by its line, and starts on Got it', async () => {
    const fake = signedIn();
    open(fake, <Wants tip="grid" />);
    const box = await screen.findByRole('dialog', { name: 'Title of grid' });
    expect(box).toHaveAttribute('aria-modal', 'true');
    expect(box).toHaveAccessibleDescription('The line of grid.');
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus();
  });

  test('holds focus inside on Tab and Shift+Tab, and gives it back to where it was', async () => {
    const fake = signedIn();
    open(fake, <><button type="button" autoFocus>Opener</button><Wants tip="grid" /></>);
    const got = await screen.findByRole('button', { name: 'Got it' });
    const skip = screen.getByRole('button', { name: 'Skip all tips' });
    expect(got).toHaveFocus();
    await userEvent.tab();
    expect(skip).toHaveFocus();
    await userEvent.tab();
    expect(got).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(skip).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(got).toHaveFocus();
    await userEvent.click(got);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus());
  });

  test('the page behind it cannot be reached', async () => {
    const fake = signedIn();
    const view = open(fake, <Wants tip="grid" />);
    await screen.findByRole('dialog');
    expect(view.container).toHaveAttribute('inert');
  });

  test('cuts the target out of the dim and rings it, and follows the target when the page scrolls', async () => {
    const fake = signedIn();
    let rect = { left: 100, top: 200, width: 50, height: 30 };
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = this.textContent === 'target grid' ? rect : { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
    });
    open(fake, <Wants tip="grid" />);
    await screen.findByRole('dialog');
    const ring = () => document.querySelector<HTMLElement>('.kb-tips-ring')!;
    expect([ring().style.left, ring().style.top, ring().style.width, ring().style.height]).toEqual(['94px', '194px', '62px', '42px']);
    const dim = document.querySelector<HTMLElement>('.kb-tips-dim')!;
    expect(dim.getAttribute('style') ?? dim.style.cssText).toMatch(/evenodd|clip-path/u);
    rect = { left: 100, top: 120, width: 50, height: 30 };
    act(() => { fireEvent.scroll(window); });
    await frames();
    expect(ring().style.top).toBe('114px');
    spy.mockRestore();
  });

  /** Sizes for the geometry tests: the target's rect, and a dialog of a given height; everything else is empty. */
  function sizes(target: { left: number; top: number; width: number; height: number }, panelHeight = 0) {
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const r = this.textContent === 'target grid' ? target : this.getAttribute('role') === 'dialog' ? { left: 0, top: 0, width: 580, height: panelHeight } : { left: 0, top: 0, width: 0, height: 0 };
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
    });
  }
  const frames = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

  test('a target partly off the left edge is cut out only as far as the screen shows', async () => {
    const fake = signedIn();
    sizes({ left: -20, top: 200, width: 50, height: 30 });
    open(fake, <Wants tip="grid" />);
    await screen.findByRole('dialog');
    const ring = document.querySelector<HTMLElement>('.kb-tips-ring')!;
    expect(ring.style.left).toBe('0px');
    expect(ring.style.width, 'from the screen edge to 6px past the target\'s right edge (30)').toBe('36px');
  });

  test('a target near the bottom of a short screen puts the whole panel, buttons and all, inside it', async () => {
    const fake = signedIn();
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    sizes({ left: 100, top: 250, width: 50, height: 30 }, 280);
    open(fake, <Wants tip="grid" />);
    const box = await screen.findByRole('dialog');
    const top = parseFloat(box.style.getPropertyValue('--kb-tip-top'));
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + 280, 'its bottom edge, where Got it and Skip all tips are').toBeLessThanOrEqual(300 - 8);
  });

  test('a scroll storm re-measures the target once a frame, not once an event', async () => {
    const fake = signedIn();
    const spy = sizes({ left: 100, top: 200, width: 50, height: 30 });
    open(fake, <Wants tip="grid" />);
    await screen.findByRole('dialog');
    await frames();
    const targetReads = () => spy.mock.contexts.filter((c) => (c as HTMLElement).textContent === 'target grid').length;
    const before = targetReads();
    act(() => { for (let i = 0; i < 5; i++) fireEvent.scroll(window); });
    expect(targetReads(), 'nothing is read until the frame').toBe(before);
    await frames();
    expect(targetReads()).toBe(before + 1);
  });

  test('the next step replaces the words and keeps focus on its Got it, so a screen reader reads it afresh', async () => {
    const fake = signedIn();
    const step = (n: number) => ({ group: 'tour', step: { n, of: 2 } });
    open(fake, <><Wants tip="tour-plate" options={step(1)} /><Wants tip="tour-orbs" options={step(2)} /></>);
    const one = await screen.findByRole('dialog', { name: 'Title of tour-plate' });
    const oldHeading = within(one).getByRole('heading');
    await userEvent.click(within(one).getByRole('button', { name: 'Got it' }));
    const two = await screen.findByRole('dialog', { name: 'Title of tour-orbs' });
    expect(within(two).getByRole('heading'), 'a new element, not the old one reworded').not.toBe(oldHeading);
    expect(within(two).getByRole('button', { name: 'Got it' })).toHaveFocus();
  });

  test('shows the step "2 of 3" with its pips', async () => {
    const fake = signedIn();
    open(fake, <Wants tip="tour-orbs" options={{ group: 'tour', step: { n: 2, of: 3 } }} />);
    const box = await screen.findByRole('dialog');
    expect(within(box).getByText(/2 of 3/u)).toBeInTheDocument();
  });

  test('draws the persona\'s picture pixelated, and its name', async () => {
    const instance = { ...testInstance, developer: { name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' } };
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('me'));
    open(fake, <Wants tip="grid" />, { instance, avatars: { gabe: '/gabe.png' } });
    const box = await screen.findByRole('dialog');
    expect(box.querySelector('img')).toHaveAttribute('src', '/gabe.png');
    expect(within(box).getByText(/Gabe/u)).toBeInTheDocument();
  });

  test('passes the accessibility check', async () => {
    const fake = signedIn();
    open(fake, <Wants tip="tour-hand" options={{ group: 'tour', step: { n: 3, of: 3 } }} />);
    await screen.findByRole('dialog');
    const layer = document.querySelector('.kb-tips')!;
    const found = await axeViolations(layer);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('the card callouts join the tips', () => {
  const art = { color: 'red', ink: 'white', mark: '/mark.svg' };
  const cards: CardUi[] = [{ key: 'k1', describe: () => 'Does a thing.', summary: 'Does a thing.', art, hint: 'Do the first thing.' }];
  const instance = { ...testInstance, cards: [{ ...testInstance.cards[0]!, key: 'k1', name: 'Card 1' }] };
  function world() {
    const fake = buildWorld(undefined, instance);
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(thread, spritey, 'post 2');
    fake.clock.advance(60_000);
    fake.seed.card(spritey, second, 'k1', { message: '' });
    fake.signInAs(me);
    return { fake, thread };
  }
  const page = (w: ReturnType<typeof world>, extra?: ReactElement) => open(w.fake, <>{extra}<LoadedThread thread={w.thread} /></>, { path: `/t/${w.thread}`, instance, cards });

  test('a callout shows when no spotlight is wanted, and spends the page\'s budget', async () => {
    const w = world();
    page(w);
    expect(await screen.findByRole('note')).toHaveTextContent('Do the first thing.');
  });

  test('a spotlight comes first: with one wanted, no callout shows on the page', async () => {
    const w = world();
    page(w, <Wants tip="grid" />);
    await screen.findByRole('dialog', { name: 'Title of grid' });
    await screen.findByRole('article', { name: /^Post 2 /u, hidden: true });
    await settle();
    expect(screen.queryAllByRole('note', { hidden: true })).toHaveLength(0);
  });

  test('a callout shown first leaves a later spotlight for the next load', async () => {
    const w = world();
    function Later() {
      const [on, setOn] = useState(false);
      return <>{on && <Wants tip="grid" />}<button type="button" onClick={() => setOn(true)}>Later</button></>;
    }
    page(w, <Later />);
    await screen.findByRole('note');
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    await settle();
    expect(dialog()).toBeNull();
  });

  test('with tips off the callouts show nothing', async () => {
    const w = world();
    await w.fake.skipTips();
    page(w);
    await screen.findByRole('article', { name: /^Post 2 /u });
    await settle();
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });

  test('Skip all tips stops the callouts as well', async () => {
    const w = world();
    page(w, <Wants tip="grid" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Skip all tips' }));
    await screen.findByRole('article', { name: /^Post 2 /u });
    await settle();
    expect(screen.queryAllByRole('note')).toHaveLength(0);
  });
});
