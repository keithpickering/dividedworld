import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Hand } from './Hand.tsx';
import { handOrder } from './arc.ts';
import type { CardFace } from './faces.ts';

const face = (key: string, name: string, alignment: 'sweet' | 'salty'): CardFace => ({
  key, name, alignment, tag: alignment === 'sweet' ? 'Sweet' : 'Salty', extra: 0, stack: 1,
  art: { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)' }, tagline: '', summary: `${name} in a sentence.`, describe: `${name}, in plain words.`, rarity: 'common', play: 'cast', kind: 'Cast',
});
const stick = face('stick', 'Stick Around', 'sweet');
const whoops = face('whoops', 'Whoops!', 'salty');

const hand = (held: readonly { card: string; held: number }[], props: Partial<Parameters<typeof Hand>[0]> = {}) =>
  renderIn(buildWorld(), <div role="region" aria-label="Your hand"><Hand held={held} faces={[stick, whoops]} vendingHref="/vending" onClose={() => {}} {...props} /></div>);

/** The Phone board's layout, as a player's text size of 150% makes it (useBoard.ts). */
const phone = () => document.documentElement.setAttribute('data-kb-text-size', '150');
afterEach(() => document.documentElement.removeAttribute('data-kb-text-size'));

/** Stand the row's layout in jsdom (it has none): cards 66px apart and 104px wide in a row `rowWidth` wide. Returns the restore. */
const stubLayout = (rowWidth: number): (() => void) => {
  const proto = HTMLElement.prototype;
  const saved = ['offsetLeft', 'offsetWidth', 'clientWidth'].map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const);
  Object.defineProperty(proto, 'offsetLeft', { configurable: true, get(this: HTMLElement) { return this.matches('li.kb-hand-card') ? [...this.parentElement!.children].indexOf(this) * 66 : 0; } });
  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get() { return 104; } });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.matches('ul.kb-hand-cards') ? rowWidth : 0; } });
  return () => { for (const [k, d] of saved) { if (d) Object.defineProperty(proto, k, d); else delete (proto as unknown as Record<string, unknown>)[k]; } };
};

describe('the hand on the Main board', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((k) => face(k, `Card ${k}`, 'sweet'));
  const holding = [{ card: 'a', held: 1 }, { card: 'b', held: 1 }, { card: 'c', held: 3 }, { card: 'd', held: 1 }, { card: 'e', held: 1 }];
  const arcHand = () => hand(holding, { faces: five });
  const focused = () => document.activeElement?.closest('li')?.getAttribute('data-kb-card');

  test('one card for each kind held, the kind held three times named for how many and showing x3', () => {
    arcHand();
    expect(screen.getAllByRole('button').filter((b) => b.closest('.kb-hand-card'))).toHaveLength(5);
    const three = screen.getByRole('button', { name: 'Card c, Sweet, Cast, common postcard, 3 in hand' });
    expect(three.closest('li')).toHaveTextContent('×3');
    expect(three.closest('li')).toHaveAttribute('data-kb-row');
    /* The side of the middle is the phone's row's: no card says one here. */
    expect(document.querySelectorAll('li.kb-hand-card[data-kb-side]')).toHaveLength(0);
  });

  test('the buttons stand in the order handOrder gives', () => {
    arcHand();
    const order = [...document.querySelectorAll('li.kb-hand-card')].map((li) => li.getAttribute('data-kb-card'));
    expect(order).toEqual(handOrder(holding, five).map((c) => c.face.key));
  });

  test('Right moves to the next card, End to the last, Tab from the last wraps to the first and Shift+Tab from the first to the last', () => {
    arcHand();
    const at = (key: string) => document.querySelector<HTMLElement>(`li[data-kb-card="${key}"] > button`)!;
    at('a').focus();
    fireEvent.keyDown(at('a'), { key: 'ArrowRight' });
    expect(focused()).toBe('b');
    fireEvent.keyDown(at('b'), { key: 'End' });
    expect(focused()).toBe('e');
    fireEvent.keyDown(at('e'), { key: 'ArrowRight' });
    expect(focused()).toBe('e');
    fireEvent.keyDown(at('e'), { key: 'Tab' });
    expect(focused()).toBe('a');
    fireEvent.keyDown(at('a'), { key: 'Tab', shiftKey: true });
    expect(focused()).toBe('e');
    fireEvent.keyDown(at('e'), { key: 'Home' });
    expect(focused()).toBe('a');
    fireEvent.keyDown(at('a'), { key: 'ArrowLeft' });
    expect(focused()).toBe('a');
  });

  test('an arrow key moves focus without preventScroll, so the browser scrolls a far card into view', () => {
    arcHand();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      const a = document.querySelector<HTMLElement>('li[data-kb-card="a"] > button')!;
      a.focus();
      focus.mockClear();
      fireEvent.keyDown(a, { key: 'ArrowRight' });
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus.mock.calls[0]![0]?.preventScroll).toBeFalsy();
    } finally { focus.mockRestore(); }
  });

  test('each card\'s button is reachable by Tab, in order', async () => {
    arcHand();
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('li.kb-hand-card > button')];
    expect(buttons.length).toBeGreaterThan(1);
    buttons[0]!.focus();
    for (const b of buttons.slice(1)) {
      await userEvent.tab();
      expect(b).toHaveFocus();
    }
  });
});

describe('the hand on the Phone board', () => {
  const move = (key: string, name: string): CardFace => ({ ...face(key, name, 'sweet'), play: 'cast' });
  const gimmick = (key: string, name: string): CardFace => ({ ...face(key, name, 'salty'), play: 'use' });
  const button = (key: string) => document.querySelector<HTMLButtonElement>(`li[data-kb-card="${key}"] > button`)!;
  const scrollTo = vi.fn();
  beforeEach(() => {
    scrollTo.mockClear();
    (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo = scrollTo;
    phone();
  });
  afterEach(() => { delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo; });

  test('a hand of Whoops! x5 and Stick Around draws two cards, Whoops! saying 5 in hand and showing x5', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 5 }]);
    expect(document.querySelectorAll('li.kb-hand-card')).toHaveLength(2);
    const five = screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, 5 in hand' });
    expect(five.closest('li')).toHaveTextContent('×5');
    expect(screen.getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' }).closest('li')).not.toHaveTextContent('×');
  });

  test('each card says which side of the middle it stands on, so its count can stand on the side no neighbor covers', async () => {
    const restore = stubLayout(104);
    try {
      const a = move('a', 'Move A');
      const b = move('b', 'Move B');
      const c = move('c', 'Move C');
      hand([{ card: 'a', held: 2 }, { card: 'b', held: 2 }, { card: 'c', held: 2 }], { faces: [a, b, c] });
      const sides = () => [...document.querySelectorAll('li.kb-hand-card')].map((li) => li.getAttribute('data-kb-side'));
      expect(sides()).toEqual([null, 'right', 'right']);
      const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
      ul.scrollLeft = 66;
      fireEvent.scroll(ul);
      await vi.waitFor(() => expect(document.querySelector('li[data-kb-middle]')).toHaveAttribute('data-kb-card', 'b'));
      expect(sides()).toEqual(['left', null, 'right']);
    } finally { restore(); }
  });

  test('a Gimmick listed first in the faces stands after a Move, and the first of its group is marked', () => {
    const g = gimmick('g', 'Gimmick G');
    const m = move('m', 'Move M');
    hand([{ card: 'g', held: 1 }, { card: 'm', held: 1 }], { faces: [g, m] });
    const lis = [...document.querySelectorAll('li.kb-hand-card')];
    expect(lis.map((li) => li.getAttribute('data-kb-card'))).toEqual(['m', 'g']);
    expect(lis.map((li) => li.hasAttribute('data-kb-group-start'))).toEqual([false, true]);
  });

  test('a click with no pointer (detail 0) on a card that is not the middle calls onPick', () => {
    const onPick = vi.fn();
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { onPick });
    expect(document.querySelector('li[data-kb-middle]')).toHaveAttribute('data-kb-card', 'stick');
    fireEvent.click(button('whoops'), { detail: 0 });
    expect(onPick).toHaveBeenCalledWith(whoops);
  });

  test('a pointer click on a card that is not the middle brings it to the middle and calls nothing else', () => {
    const onPick = vi.fn();
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { onPick });
    scrollTo.mockClear();
    fireEvent.click(button('whoops'), { detail: 1 });
    expect(onPick).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({ behavior: 'smooth' });
  });

  test('a pointer click on the middle card calls onPick', () => {
    const onPick = vi.fn();
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { onPick });
    fireEvent.click(button('stick'), { detail: 1 });
    expect(onPick).toHaveBeenCalledWith(stick);
  });

  test('a press that began on a side card does not arm it, though the press made it the middle before the click', async () => {
    const restore = stubLayout(104);
    try {
      const onPick = vi.fn();
      hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { onPick });
      const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
      fireEvent.pointerDown(button('whoops'));
      ul.scrollLeft = 66;
      fireEvent.scroll(ul);
      await vi.waitFor(() => expect(document.querySelector('li[data-kb-middle]')).toHaveAttribute('data-kb-card', 'whoops'));
      fireEvent.click(button('whoops'), { detail: 1 });
      expect(onPick).not.toHaveBeenCalled();
      /* A press that began on the middle card still acts. */
      fireEvent.pointerDown(button('whoops'));
      fireEvent.click(button('whoops'), { detail: 1 });
      expect(onPick).toHaveBeenCalledWith(whoops);
    } finally { restore(); }
  });

  test('a tap keeps its press through pointerleave: a touch pointer leaves the card when the finger lifts, before the click, and the side card is still not armed', async () => {
    const restore = stubLayout(104);
    try {
      const onPick = vi.fn();
      hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { onPick });
      const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
      fireEvent.pointerDown(button('whoops'));
      fireEvent.pointerUp(button('whoops'));
      fireEvent.pointerLeave(button('whoops'));
      ul.scrollLeft = 66;
      fireEvent.scroll(ul);
      await vi.waitFor(() => expect(document.querySelector('li[data-kb-middle]')).toHaveAttribute('data-kb-card', 'whoops'));
      fireEvent.click(button('whoops'), { detail: 1 });
      expect(onPick).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  test('a press that is canceled leaves nothing behind: a later click with detail 1 and no pointerdown is judged by the current middle', async () => {
    const restore = stubLayout(104);
    try {
      const onPick = vi.fn();
      hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { onPick });
      const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
      fireEvent.pointerDown(button('whoops'));
      fireEvent.pointerCancel(button('whoops'));
      ul.scrollLeft = 66;
      fireEvent.scroll(ul);
      await vi.waitFor(() => expect(document.querySelector('li[data-kb-middle]')).toHaveAttribute('data-kb-card', 'whoops'));
      fireEvent.click(button('whoops'), { detail: 1 });
      expect(onPick).toHaveBeenCalledWith(whoops);
    } finally { restore(); }
  });

  test('mounted closed nothing is centered; on open the opening card is centered at once and is the middle; a change of cards or of the opening while open centers nothing; a close and reopen centers the then-current opening', () => {
    const restore = stubLayout(104);
    scrollTo.mockImplementation(function (this: HTMLElement, o: { left: number }) { this.scrollLeft = o.left; });
    try {
      type S = { open: boolean; held: readonly { card: string; held: number }[]; opening: string | null };
      let set: (n: (s: S) => S) => void = () => {};
      const two = [{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }];
      const Harness = () => {
        const [s, setS] = useState<S>({ open: false, held: two, opening: null });
        set = setS;
        return <Hand held={s.held} faces={[stick, whoops, face('extra', 'Extra', 'sweet')]} vendingHref="/vending" onClose={() => {}} open={s.open} opening={s.opening} />;
      };
      renderIn(buildWorld(), <Harness />);
      const ul = () => document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
      const middleKey = () => document.querySelector('li[data-kb-middle]')?.getAttribute('data-kb-card');
      const instantCalls = () => scrollTo.mock.calls.filter(([a]) => a.behavior === 'instant');
      /* Closed: the sheet is hidden, so nothing can be measured or centered, and no pose is written. */
      act(() => set((s) => ({ ...s, opening: 'whoops' })));
      expect(scrollTo).not.toHaveBeenCalled();
      expect(ul().querySelector('[style*="--kb-swipe-y"]')).toBeNull();
      /* Open: the opening read now, centered instantly, and the middle is right. */
      act(() => set((s) => ({ ...s, open: true })));
      expect(instantCalls()).toHaveLength(1);
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo.mock.calls[0]![0].left).toBe(66);
      expect(middleKey()).toBe('whoops');
      expect(ul().querySelector('li[data-kb-card="stick"]')!.getAttribute('style')).toContain('--kb-swipe-y');
      /* Open: a change of cards, or of the opening, does not center again. */
      scrollTo.mockClear();
      act(() => set((s) => ({ ...s, held: [...two, { card: 'extra', held: 1 }] })));
      act(() => set((s) => ({ ...s, opening: null })));
      expect(scrollTo).not.toHaveBeenCalled();
      /* Closed and open again: the opening of that moment. */
      act(() => set((s) => ({ ...s, open: false })));
      act(() => set((s) => ({ ...s, opening: 'extra' })));
      expect(scrollTo).not.toHaveBeenCalled();
      act(() => set((s) => ({ ...s, open: true })));
      const at = [...ul().children].findIndex((li) => li.getAttribute('data-kb-card') === 'extra');
      expect(instantCalls()).toHaveLength(1);
      expect(scrollTo.mock.calls[0]![0].left).toBe(at * 66);
      expect(middleKey()).toBe('extra');
    } finally { scrollTo.mockReset(); restore(); }
  });

  test('under Off the card comes to the middle at once', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { instant: true });
    scrollTo.mockClear();
    fireEvent.click(button('whoops'), { detail: 1 });
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({ behavior: 'instant' });
  });

  test('the line names the middle card, and says the armed sentence when the middle card is armed', () => {
    const { unmount } = hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { armed: 'whoops', onPick: () => {} });
    // The armed card is not the middle: the line speaks of the middle card.
    expect(document.querySelector('.kb-hand-says')).toHaveTextContent('Stick Around. Stick Around in a sentence.');
    unmount();
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { armed: 'stick', onPick: () => {} });
    expect(document.querySelector('.kb-hand-says')).toHaveTextContent('Stick Around is armed. Every post it can land on now shows a dashed + mark');
  });

  test('a card that takes focus is brought to the middle', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }]);
    scrollTo.mockClear();
    button('whoops').focus();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  test('the pose is written for the cards in view and two steps beyond, and a card that leaves them gets the edge pose', async () => {
    const restore = stubLayout(390);
    try {
      const many = Array.from({ length: 100 }, (_, i) => face(`k${i}`, `Card ${i}`, 'sweet'));
      hand(many.map((f) => ({ card: f.key, held: 1 })), { faces: many });
      const ul = document.querySelector<HTMLElement>('ul.kb-hand-cards')!;
      const y = (i: number) => ul.children[i]!.getAttribute('style')?.match(/--kb-swipe-y: ([^;]+)/)?.[1];
      expect(y(60)).toBe('40px');
      expect(ul.children[2]).toHaveAttribute('data-kb-middle');
      expect(y(2)).not.toBe('40px');
      ul.scrollLeft = 66 * 50;
      fireEvent.scroll(ul);
      await vi.waitFor(() => expect(ul.children[52]).toHaveAttribute('data-kb-middle'));
      expect(y(2)).toBe('40px');
      expect(ul.children[2]!.getAttribute('style')).toContain('--kb-swipe-turn: -18deg');
      expect(y(52)).not.toBe('40px');
    } finally { restore(); }
  });

  test('an arrow key moves focus with preventScroll, since the row centers the card itself', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }]);
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      button('stick').focus();
      focus.mockClear();
      fireEvent.keyDown(button('stick'), { key: 'ArrowRight' });
      expect(focus.mock.calls[0]![0]).toMatchObject({ preventScroll: true });
    } finally { focus.mockRestore(); }
  });

  test('Right and Left move focus to the neighbor and stop at the ends; Tab is left to the dialog', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }]);
    button('stick').focus();
    fireEvent.keyDown(button('stick'), { key: 'ArrowRight' });
    expect(button('whoops')).toHaveFocus();
    fireEvent.keyDown(button('whoops'), { key: 'ArrowRight' });
    expect(button('whoops')).toHaveFocus();
    expect(fireEvent.keyDown(button('whoops'), { key: 'Tab' })).toBe(true);
    fireEvent.keyDown(button('whoops'), { key: 'Home' });
    expect(button('stick')).toHaveFocus();
  });
});

describe('the hand', () => {
  test('each kind is a button by the card\'s name and alignment, with its rules in plain words as its description', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }]);
    expect(screen.getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' })).toHaveAccessibleDescription('Stick Around, in plain words.');
    expect(screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, 2 in hand' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hand · 3' })).toBeInTheDocument();
  });

  test('pressing a card shows what it does in the sheet\'s line, and the Vending Machine is a link', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }]);
    expect(screen.getByText('Stick Around.', { selector: 'b' }).closest('p')).toHaveTextContent('Stick Around in a sentence.');
    fireEvent.click(screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' }));
    expect(screen.getByText('Whoops!.', { selector: 'b' }).closest('p')).toHaveTextContent('Whoops! in a sentence.');
    expect(screen.getByRole('link', { name: 'Vending Machine' })).toHaveAttribute('href', '/vending');
  });

  test('an armed card says so in its name and in the line, and pressing a card is the caller\'s to answer', () => {
    const onPick = vi.fn();
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { armed: 'whoops', onPick });
    const armed = screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, armed: pick a post' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('+ mark').closest('p')).toHaveTextContent('Whoops! is armed. Every post it can land on now shows a dashed + mark beside its date, named Play Whoops! on that post. Press it to play Whoops! there.');
    fireEvent.click(armed);
    expect(onPick).toHaveBeenCalledWith(whoops);
  });

  test('the armed card carries its floating tag, and no other card does', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }], { armed: 'whoops', onPick: () => {} });
    expect(screen.getAllByText('Armed · pick a post')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, armed: pick a post' }).closest('li')).toHaveTextContent('Armed · pick a post');
  });

  test('an empty hand says so and where cards are bought, and Close is named for what it does', () => {
    const onClose = vi.fn();
    hand([], { onClose });
    expect(screen.getByText('No postcards in your hand. The Vending Machine sells them.')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: 'Your hand' })).getByRole('button', { name: 'Close the hand' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('a postcard button\'s name (Label in Name)', () => {
  test('holds the words the card shows, in order, tagline included on the fan', () => {
    const line = { ...stick, tagline: 'Hold a reader on a post.' };
    hand([{ card: 'stick', held: 1 }], { faces: [line, whoops] });
    const button = screen.getByRole('button', { name: /^Stick Around/ });
    const shown = (button.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(shown).toBe('Stick Around Sweet Cast Hold a reader on a post.');
    expect(button.getAttribute('aria-label')!.replace(/[^\w ]/g, ' ').replace(/\s+/g, ' ')).toContain(shown.replace(/[^\w ]/g, ' ').replace(/\s+/g, ' '));
  });
});
