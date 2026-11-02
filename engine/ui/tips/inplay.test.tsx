/**
 * The two tips in play and the first card's line (docs/plans/2026-11-02-onboarding-plan.md, Task 6): the grid tip over the open reaction
 * picker with the grid in the cut-out, the first time only; the ghost tip the first time the orbs show an estimate; the first card
 * callout carrying the `first-card` line, the second not; and none of them with the tips off.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import type { CardUi } from '../cards/types.ts';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { TipsProvider } from './Tips.tsx';

vi.setConfig({ testTimeout: 20_000 });
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 25)); });
const tipDialog = (key: string) => screen.queryByRole('dialog', { name: `Title of ${key}` });
const gotIt = (d: HTMLElement) => userEvent.click(within(d).getByRole('button', { name: 'Got it' }));

function thread() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread: id } = fake.seed.thread('general', spritey, 'A thread', 'their post');
  fake.signInAs(me);
  return { fake, id };
}
const board = (w: ReturnType<typeof thread>) => renderIn(w.fake, <TipsProvider><ThreadScreen thread={w.id} /></TipsProvider>, { path: `/t/${w.id}` });
const picker = () => screen.getByRole('dialog', { name: /^React to / });
const openPicker = async () => { await userEvent.click(await screen.findByRole('button', { name: 'React' })); return picker(); };

describe('the grid tip', () => {
  test('shows over the open picker the first time, with the grid in the cut-out, and Got it gives focus back to the picker', async () => {
    const w = thread();
    board(w);
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.classList.contains('kb-picker-grid') ? rect(100, 200, 300, 150) : real.call(this);
    });
    const p = await openPicker();
    const tip = await screen.findByRole('dialog', { name: 'Title of grid' });
    expect(picker(), 'the picker stays open under the tip').toBe(p);
    expect(document.querySelector<HTMLElement>('.kb-tips-ring')).toHaveStyle({ left: '94px', top: '194px', width: '312px', height: '162px' });
    expect(tip.closest('.kb-tips')!.compareDocumentPosition(p.closest('.kb-glass-overlay')!) & Node.DOCUMENT_POSITION_PRECEDING, 'the tip is drawn after the picker, over it').toBeTruthy();
    expect(tip).toContainElement(document.activeElement as HTMLElement);
    expect(await axeViolations(tip.closest('.kb-tips') as HTMLElement), describeViolations([])).toEqual([]);
    await gotIt(tip);
    await settle();
    expect(tipDialog('grid')).toBeNull();
    expect(p).toContainElement(document.activeElement as HTMLElement);
    expect(p.closest('[inert]'), 'the picker answers again').toBeNull();
    expect((await w.fake.preferences()).tipsSeen).toEqual(['grid']);
  });

  test('does not show the second time: not on a second open this load, nor on a later load', async () => {
    const w = thread();
    const first = board(w);
    await gotIt(await (async () => { await openPicker(); return screen.findByRole('dialog', { name: 'Title of grid' }); })());
    await settle();
    fireEvent.keyDown(picker(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^React to / })).toBeNull());
    await openPicker();
    await settle();
    expect(tipDialog('grid')).toBeNull();
    first.unmount();
    board(w);
    await openPicker();
    await settle();
    expect(tipDialog('grid')).toBeNull();
  });

  test('Escape over the tip skips all tips: they are off, the picker stays open and answers again, with focus back in it', async () => {
    const w = thread();
    board(w);
    const p = await openPicker();
    await screen.findByRole('dialog', { name: 'Title of grid' });
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(tipDialog('grid')).toBeNull();
    expect((await w.fake.preferences()).tips).toBe('off');
    expect(picker(), 'the picker is still open').toBe(p);
    expect(p.closest('[inert]'), 'the picker answers again').toBeNull();
    expect(p).toContainElement(document.activeElement as HTMLElement);
  });

  test('is not shown with the tips off', async () => {
    const w = thread();
    await w.fake.skipTips();
    board(w);
    await openPicker();
    await settle();
    expect(tipDialog('grid')).toBeNull();
  });
});

describe('the ghost tip', () => {
  function frame(options: { estimate?: boolean } = {}): Fake {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    const pipe = fake.seed.character(me, 'Pipewrench', 'face');
    if (options.estimate !== false) fake.seed.estimate(me, { entries: [{ character: pipe, reason: 'face.cheered', amount: 85 }] });
    fake.signInAs(me);
    return fake;
  }
  const show = (fake: Fake) => renderIn(fake, <Frame><p>A board page.</p></Frame>);

  test('shows the first time an estimate is on the orbs, pointing at them', async () => {
    const fake = frame();
    show(fake);
    const tip = await screen.findByRole('dialog', { name: 'Title of ghost' });
    await gotIt(tip);
    await settle();
    expect((await fake.preferences()).tipsSeen).toEqual(['ghost']);
  });

  test('does not show with no estimate on the orbs', async () => {
    show(frame({ estimate: false }));
    await settle();
    expect(tipDialog('ghost')).toBeNull();
  });

  test('does not show once seen, or with the tips off', async () => {
    const seen = frame();
    await seen.seeTip('ghost');
    show(seen);
    await settle();
    expect(tipDialog('ghost')).toBeNull();
    cleanup();
    const off = frame();
    await off.skipTips();
    show(off);
    await settle();
    expect(tipDialog('ghost')).toBeNull();
  });
});

const KEYS = ['k1', 'k2'] as const;
const instance = { ...testInstance, cards: KEYS.map((key, i) => ({ ...testInstance.cards[0]!, key, name: `Card ${i + 1}` })) };
const art = { color: 'red', ink: 'white', mark: '/mark.svg' };
const cardUi = (key: string): CardUi => ({ key, describe: () => 'Does a thing.', summary: 'Does a thing.', art, hint: `Hint of ${key}.` });
const FIRST = 'The line of first-card.';

describe('the first card\'s line', () => {
  function cards() {
    const fake = buildWorld(undefined, instance);
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const spritey = fake.seed.character(other, 'Spritey', 'face');
    const { thread: id } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
    const second = fake.seed.post(id, spritey, 'post 2');
    fake.signInAs(me);
    const third = fake.seed.post(id, spritey, 'post 3');
    fake.clock.advance(60_000);
    fake.seed.card(spritey, second, 'k1', { message: '' });
    fake.clock.advance(60_000);
    fake.seed.card(spritey, third, 'k2', { message: '' });
    return { fake, id };
  }
  const page = (w: ReturnType<typeof cards>) => renderIn(w.fake, <TipsProvider><ThreadScreen thread={w.id} /></TipsProvider>, { path: `/t/${w.id}`, instance, cards: KEYS.map(cardUi) });

  test('the first callout a player sees carries it and marks it seen; the second does not', async () => {
    const w = cards();
    page(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Hint of k1.');
    expect(note).toHaveTextContent(FIRST);
    await waitFor(async () => expect((await w.fake.preferences()).tipsSeen).toEqual(['first-card']));
    await userEvent.click(within(note).getByRole('button', { name: 'Got it' }));
    const next = await screen.findByRole('note', {}, { timeout: 2000 });
    expect(next).toHaveTextContent('Hint of k2.');
    expect(next).not.toHaveTextContent(FIRST);
  });

  test('is not added with the tips off, where no callout shows at all', async () => {
    const w = cards();
    await w.fake.skipTips();
    page(w);
    await screen.findAllByRole('button', { name: /^Card 1, 1 play/u });
    await settle();
    expect(screen.queryByRole('note')).toBeNull();
    expect((await w.fake.preferences()).tipsSeen).toEqual([]);
  });

  test('is not added once seen on the account', async () => {
    const w = cards();
    await w.fake.seeTip('first-card');
    page(w);
    await screen.findByRole('article', { name: /^Post 3 /u });
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Hint of k1.');
    expect(note).not.toHaveTextContent(FIRST);
  });
});
