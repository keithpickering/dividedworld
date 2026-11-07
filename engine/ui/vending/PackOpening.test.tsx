/**
 * The reveal (docs/plans/2026-11-04-booster-packs-plan.md, Task 5; boards 02, 03 and 04 in docs/research/2026-11-07-booster-packs/): the cards of a
 * bought pack, face down in pull order, turned one at a time. What it shows is the cards it is given (the purchase's answer), never a roll of its
 * own. Every card is already in the hand, so closing early loses nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { CardRules } from '../../rules/cards.ts';
import { facesOf } from '../cards/faces.ts';
import type { CardUi } from '../cards/types.ts';
import { Layers } from '../glass/layer.tsx';
import { buildWorld, renderIn, testInstance } from '../test-world.tsx';
import { PackOpening } from './PackOpening.tsx';

const ok = { ok: true as const, value: undefined };
const rule = (key: string, name: string, rarity: CardRules['rarity'], alignment: CardRules['alignment'] = 'sweet'): CardRules => ({
  key, name, alignment, rarity, playPrice: () => 0, canApply: () => ok, validateConfig: (c) => ({ ok: true, value: c }),
});
const rules = [rule('stick', 'Stick Around', 'common'), rule('whoops', 'Whoops!', 'common', 'salty'), rule('bluff', 'Bluff', 'common', 'pepperoni'), rule('trap', 'Trap Card', 'uncommon'), rule('main', 'Main Event', 'rare')];
const art = { color: '#2ee6ff', ink: '#03141a', canvas: '', mark: '', credit: 'Test' };
const uis: CardUi[] = rules.map((r) => ({ key: r.key, art, describe: () => `${r.name} does a thing.` }));
const faces = facesOf(rules, uis, testInstance.settings);
const face = (key: string) => faces.find((f) => f.key === key)!;
/* Four commons, then the hit: in the order the answer gave them. */
const pulled = ['whoops', 'stick', 'bluff', 'stick', 'main'].map(face);
const packArt = { color: '#ffd93d', ink: '#1a1403', canvas: '', mark: '', credit: 'Test' };

function open(o: { onClose?: () => void; note?: string | null; opener?: HTMLElement } = {}) {
  const onClose = o.onClose ?? vi.fn();
  const view = renderIn(buildWorld(), (
    <Layers><PackOpening name="Booster" art={packArt} cards={pulled} note={o.note ?? null} onClose={onClose} {...(o.opener ? { returnFocusTo: () => o.opener! } : {})} /></Layers>
  ));
  cleanupOpen = () => view.unmount();
  return { onClose, ...view };
}

let cleanupOpen = () => {};
const counter = () => screen.getByRole('dialog').querySelector('.kb-opening-count')!;
const row = () => within(screen.getByRole('list', { name: 'The pack, in the order it was pulled' }));
const next = () => screen.getByRole('button', { name: /^Turn the next card$|^Done$/u });

beforeEach(() => { document.documentElement.setAttribute('data-kb-motion', 'reduce'); });
afterEach(() => { document.documentElement.removeAttribute('data-kb-motion'); });

describe('the reveal before any card is turned', () => {
  test('is a dialog named for the pack, with its name, the count of cards turned, and five backs in a row', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Opening a Booster' });
    expect(within(dialog).getByRole('heading', { name: 'Booster' })).toBeInTheDocument();
    expect(counter()).toHaveTextContent('0 of 5 turned over');
    expect(row().getAllByRole('listitem')).toHaveLength(5);
    /* Nothing of the cards is on the screen yet: no name of any of them. */
    for (const f of pulled) expect(screen.queryByText(f.name)).toBeNull();
    expect(screen.getByText('Click the next card or press Space to turn it. All five are already in your hand.')).toBeInTheDocument();
  });

  test('the hit is last, and its back is marked as the hit: gold', () => {
    open();
    const backs = [...document.querySelectorAll('.kb-opening-row .kb-postcard-back')];
    expect(backs).toHaveLength(5);
    expect(backs.map((b) => b.hasAttribute('data-hit'))).toEqual([false, false, false, false, true]);
    expect(row().getAllByRole('listitem')[4]).toHaveAccessibleName('Card 5, face down, the hit');
  });

  test('before the first turn the spotlight holds the first card\'s back, and only the next card is a button', () => {
    open();
    expect(document.querySelector('.kb-opening-spot .kb-postcard-back')).not.toBeNull();
    expect(document.querySelector('.kb-opening-spot .kb-postcard:not(.kb-postcard-back)')).toBeNull();
    expect(row().getAllByRole('button')).toHaveLength(1);
    expect(row().getByRole('button', { name: 'Turn card 1' })).toBeInTheDocument();
  });
});

describe('turning the cards', () => {
  test('a click on the next card, the button, and Space each turn one card, in pull order', () => {
    open();
    fireEvent.click(row().getByRole('button', { name: 'Turn card 1' }));
    expect(counter()).toHaveTextContent('1 of 5 turned over');
    expect(row().getByRole('listitem', { name: /^Card 1: Whoops!/u })).toBeInTheDocument();
    fireEvent.click(next());
    expect(counter()).toHaveTextContent('2 of 5 turned over');
    expect(row().getByRole('listitem', { name: /^Card 2: Stick Around/u })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: ' ' });
    expect(counter()).toHaveTextContent('3 of 5 turned over');
    expect(row().getByRole('listitem', { name: /^Card 3: Bluff/u })).toBeInTheDocument();
    /* The card in the spotlight is the one last turned, at the sheet's size. */
    expect(document.querySelector('.kb-opening-spot .kb-postcard:not(.kb-postcard-back)[data-size="sheet"]')).toHaveAccessibleName(/Bluff/u);
    /* The cards not turned yet are still backs, in order. */
    expect(row().getByRole('button', { name: 'Turn card 4' })).toBeInTheDocument();
    expect(row().getAllByRole('listitem')[4]).toHaveAccessibleName('Card 5, face down, the hit');
  });

  test('Space on a focused button does what the button does, once', () => {
    open();
    const button = next();
    button.focus();
    fireEvent.keyDown(button, { key: ' ' });
    /* The browser's own click follows a Space on a button; the keydown the dialog hears does not turn a second card. */
    expect(counter()).toHaveTextContent('0 of 5 turned over');
  });

  test('Turn all turns every card that is left, the hit last in the spotlight', () => {
    open();
    fireEvent.click(next());
    fireEvent.click(screen.getByRole('button', { name: 'Turn all' }));
    expect(counter()).toHaveTextContent('5 of 5');
    expect(row().getAllByRole('listitem').map((li) => li.getAttribute('aria-label')?.split(':')[1]?.split(',')[0]?.trim())).toEqual(['Whoops!', 'Stick Around', 'Bluff', 'Stick Around', 'Main Event']);
    expect(document.querySelector('.kb-opening-spot .kb-postcard')).toHaveAccessibleName(/Main Event/u);
    expect(screen.queryByRole('button', { name: 'Turn all' })).toBeNull();
  });

  test('once the hit is turned its tag names its rarity and card, and the page offers Done and Back to the machine', () => {
    open({ note: 'Main Event isn\'t sold on its own; this is one of the ways to get it.' });
    expect(screen.queryByText(/Rare · Main Event/iu)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn all' }));
    expect(screen.getByText(/^Rare · Main Event$/iu)).toBeInTheDocument();
    expect(counter()).toHaveTextContent('5 of 5 · all in your hand');
    expect(next()).toHaveAccessibleName('Done');
    expect(screen.getByRole('button', { name: 'Back to the machine' })).toBeInTheDocument();
    expect(screen.getByText(/^These five are already in your hand\./u)).toHaveTextContent('Main Event isn\'t sold on its own; this is one of the ways to get it.');
  });

  test('the Esc key cap is drawn and not read: the button is named for what it does', () => {
    open();
    const close = screen.getByRole('button', { name: 'Close' });
    const key = close.querySelector('.kb-opening-key')!;
    expect(key).toHaveAttribute('aria-hidden', 'true');
    expect(key).toHaveTextContent('');
    expect(key).toHaveAttribute('data-kb-key', 'ESC');
  });
});

describe('on a phone', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-kb-layout'); });
  const stage = () => document.querySelector('.kb-opening-stage')!;
  const drag = (from: number, to: number) => { fireEvent.pointerDown(stage(), { clientX: from }); fireEvent.pointerUp(stage(), { clientX: to }); };

  test('a tap on the pile, or a swipe across it, turns the next card; a slight drag does neither', () => {
    document.documentElement.setAttribute('data-kb-layout', 'phone');
    open();
    drag(100, 102);
    expect(counter()).toHaveTextContent('1 of 5 turned over');
    drag(200, 100);
    expect(counter()).toHaveTextContent('2 of 5 turned over');
    drag(200, 220);
    expect(counter()).toHaveTextContent('2 of 5 turned over');
  });

  test('a drag commits when it passes a third of the card\'s width, and springs back short of it', () => {
    document.documentElement.setAttribute('data-kb-layout', 'phone');
    open();
    const spot = document.querySelector('.kb-opening-spot')!;
    vi.spyOn(spot, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 450, width: 300, height: 450, toJSON: () => ({}) });
    drag(300, 202);
    expect(counter()).toHaveTextContent('0 of 5 turned over');
    drag(300, 198);
    expect(counter()).toHaveTextContent('1 of 5 turned over');
  });

  test('on the other layout a press on the spotlight turns nothing: only the next card does', () => {
    open();
    drag(100, 102);
    expect(counter()).toHaveTextContent('0 of 5 turned over');
  });

  test('five outlines count down, the last one gold, and the line says to tap or swipe', () => {
    document.documentElement.setAttribute('data-kb-layout', 'phone');
    open();
    fireEvent.click(next());
    const outlines = [...document.querySelectorAll('.kb-opening-outlines li')];
    expect(outlines.map((li) => li.hasAttribute('data-kb-turned'))).toEqual([true, false, false, false, false]);
    expect(outlines[4]).toHaveAttribute('data-kb-hit');
    expect(screen.getByText(/^Tap the card, or swipe it away, to turn the next one\./u)).toBeInTheDocument();
  });
});

describe('leaving', () => {
  test('Esc before every card is turned closes the reveal', () => {
    const { onClose } = open();
    fireEvent.click(next());
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { screen.getByRole('dialog').dispatchEvent(esc); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Close and Done each close it', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Turn all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test('focus is held inside while it is open and goes back to the slot when it closes', async () => {
    const slot = document.createElement('button');
    slot.textContent = 'slot';
    document.body.append(slot);
    slot.focus();
    let close: () => void = () => {};
    const { rerender } = renderIn(buildWorld(), (
      <Layers><PackOpening name="Booster" art={packArt} cards={pulled} note={null} onClose={() => close()} returnFocusTo={() => slot} /></Layers>
    ));
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    /* Tab does not leave the dialog: from the last control it comes round to the first. */
    const stops = [...screen.getByRole('dialog').querySelectorAll<HTMLElement>('button')];
    stops[stops.length - 1]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    close = () => rerender(<Layers />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(slot).toHaveFocus());
    slot.remove();
  });

  test('focus stays in the dialog as the control that had it is replaced by the turn', () => {
    open();
    fireEvent.click(row().getByRole('button', { name: 'Turn card 1' }));
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('what a screen reader hears', () => {
  /** Every live region in the dialog: an explicit aria-live, or a role that is one implicitly. */
  const regions = () => [...screen.getByRole('dialog').querySelectorAll('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]')];

  test('exactly one live region, carrying the count and the card, so a turn is announced once', () => {
    open();
    expect(regions()).toHaveLength(1);
    const live = regions()[0]!;
    expect(live).toHaveTextContent('0 of 5 turned over');
    fireEvent.click(next());
    expect(regions()).toHaveLength(1);
    expect(live).toHaveTextContent('1 of 5 turned over');
    expect(live).toHaveTextContent('Card 1 of 5: Whoops!, Salty Cast, common.');
  });

  test('each card as it is turned, and the whole pack once all are', () => {
    open();
    const live = () => regions()[0]!;
    fireEvent.click(next());
    expect(live()).toHaveTextContent('Card 1 of 5: Whoops!, Salty Cast, common.');
    fireEvent.click(next());
    expect(live()).toHaveTextContent('Card 2 of 5: Stick Around');
    fireEvent.click(screen.getByRole('button', { name: 'Turn all' }));
    expect(live()).toHaveTextContent('All five are turned: Whoops!, Stick Around, Bluff, Stick Around, Main Event. All five are in your hand.');
  });

  test('a face-down card is named with no word of what it is', () => {
    open();
    const names = row().getAllByRole('listitem').map((li) => li.getAttribute('aria-label') ?? '');
    for (const n of names) for (const f of pulled) expect(n).not.toContain(f.name);
  });
});

describe('Space', () => {
  test('a held Space turns one card, not one for every repeat', () => {
    open();
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: ' ' });
    fireEvent.keyDown(dialog, { key: ' ', repeat: true });
    fireEvent.keyDown(dialog, { key: ' ', repeat: true });
    expect(counter()).toHaveTextContent('1 of 5 turned over');
  });
});

describe('motion', () => {
  test('under reduced motion a turned card is shown turned, with no rotation', () => {
    open();
    fireEvent.click(next());
    expect(document.querySelector('.kb-opening-flip')).toBeNull();
    expect(document.querySelector('[style*="rotateY"]')).toBeNull();
    expect(row().getByRole('listitem', { name: /^Card 1: Whoops!/u })).toBeInTheDocument();
  });

  test('under a feel the card in the spotlight turns on its vertical axis: a flip with its back on one side and its face on the other', () => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    open();
    fireEvent.click(next());
    const flip = document.querySelector('.kb-opening-spot .kb-opening-flip')!;
    expect(flip).not.toBeNull();
    expect(flip.querySelector('.kb-postcard-back')).not.toBeNull();
    expect(flip.querySelector('.kb-postcard:not(.kb-postcard-back)')).not.toBeNull();
    expect(flip).toHaveAttribute('data-kb-turned', '');
    /* The next card comes in as a fresh back, which turns in its turn. */
    fireEvent.click(next());
    const second = document.querySelector('.kb-opening-spot .kb-opening-flip')!;
    expect(second).toHaveAttribute('data-kb-turned', '');
    expect(second.querySelector('.kb-postcard:not(.kb-postcard-back)')).toHaveAccessibleName(/Stick Around/u);
  });
});


/*
 * The reveal's motion (booster packs plan, Task 10; the design's amendment "The reveal's motion"). Under a feel the cards are one element each, moved between their
 * row slot and the spotlight, and every input finishes the beats that run and goes on.
 */
describe('the reveal\'s motion', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    document.documentElement.setAttribute('data-kb-motion-feel', 'smooth');
  });
  afterEach(() => { document.documentElement.removeAttribute('data-kb-motion-feel'); });
  const dialog = () => screen.getByRole('dialog');
  const card = (i: number) => document.querySelector(`[data-kb-pull="${i}"]`);

  test('the pack is two pieces from the instance\'s pack art, the body below the tear and the crimped top above, and only the body under Off', () => {
    open();
    expect(document.querySelectorAll('.kb-opening-pack .kb-pack')).toHaveLength(2);
    expect(document.querySelector('.kb-opening-pack .kb-pack[data-part="opened"]')).not.toBeNull();
    expect(document.querySelector('.kb-opening-pack .kb-pack[data-part="top"]')).not.toBeNull();
    cleanupOpen();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    open();
    expect(document.querySelectorAll('.kb-pack')).toHaveLength(1);
  });

  test('each pull is one element, which stands in its row slot and, once it is the card shown, in the spotlight', () => {
    open();
    /* Space: the entrance finishes and the first card turns. */
    fireEvent.keyDown(dialog(), { key: ' ' });
    expect(document.querySelectorAll('[data-kb-pull]')).toHaveLength(5);
    expect(document.querySelector('.kb-opening-spot')).toContainElement(card(0) as HTMLElement);
    expect(row().getAllByRole('listitem')[0]).not.toContainElement(card(0) as HTMLElement);
    expect(row().getAllByRole('listitem')[1]).toContainElement(card(1) as HTMLElement);
    fireEvent.keyDown(dialog(), { key: ' ' });
    expect(document.querySelectorAll('[data-kb-pull]')).toHaveLength(5);
    expect(document.querySelector('.kb-opening-spot')).toContainElement(card(1) as HTMLElement);
    expect(row().getAllByRole('listitem')[0]).toContainElement(card(0) as HTMLElement);
  });

  test('the hit\'s ring goes gold over `screen`: the feel sets the duration as a custom property, the stylesheet transitions the card\'s shadow by it, and Off sets none (it switches at once)', () => {
    open();
    expect(dialog().style.getPropertyValue('--kb-opening-screen')).toBe('420ms');
    expect(dialog().style.getPropertyValue('--kb-opening-ease')).not.toBe('');
    const css = readFileSync(resolve(process.cwd(), 'engine/ui/vending/opening.css'), 'utf8');
    expect(css).toMatch(/\.kb-opening-spot \.kb-postcard\[data-size='sheet'\]\s*\{[^}]*transition:\s*box-shadow var\(--kb-opening-screen, 0ms\) var\(--kb-opening-ease/u);
    cleanupOpen();
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    open();
    expect(dialog().style.getPropertyValue('--kb-opening-screen')).toBe('');
  });

  test('a Space during the entrance finishes it and turns the first card at once', () => {
    open();
    expect(dialog()).toHaveAttribute('data-kb-stage', 'entering');
    fireEvent.keyDown(dialog(), { key: ' ' });
    expect(dialog()).toHaveAttribute('data-kb-stage', 'ready');
    expect(counter()).toHaveTextContent('1 of 5 turned over');
    expect(document.querySelector('.kb-opening-spot')).toContainElement(card(0) as HTMLElement);
    expect(card(0)!.querySelector('.kb-postcard:not(.kb-postcard-back)')).toHaveAccessibleName(/Whoops!/u);
  });

  test('Done during a turn closes at once, and the reveal is inert from that render', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    const onClose = vi.fn();
    function Host() {
      const [on, setOn] = useState(true);
      return <Layers>{on && <PackOpening name="Booster" art={packArt} cards={pulled} note={null} onClose={() => { onClose(); setOn(false); }} returnFocusTo={() => opener} />}</Layers>;
    }
    renderIn(buildWorld(), <Host />);
    /* Turn all: the hit's turn is still running when Done is pressed. */
    fireEvent.click(screen.getByRole('button', { name: 'Turn all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const layer = document.querySelector('.kb-opening-layer')!;
    expect(layer).toHaveAttribute('inert');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer).toHaveAttribute('data-kb-exiting');
    /* Focus is back on the slot as the close starts, not when its picture ends. */
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  test('Esc during the entrance closes at once too', () => {
    const { onClose } = open();
    act(() => { dialog().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a turn pressed while another runs finishes it and turns the next card', () => {
    open();
    fireEvent.keyDown(dialog(), { key: ' ' });
    fireEvent.keyDown(dialog(), { key: ' ' });
    fireEvent.keyDown(dialog(), { key: ' ' });
    expect(counter()).toHaveTextContent('3 of 5 turned over');
    expect(document.querySelector('.kb-opening-spot')).toContainElement(card(2) as HTMLElement);
  });
});
