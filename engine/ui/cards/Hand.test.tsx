import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Hand, drawn } from './Hand.tsx';
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

describe('the faces a hand draws', () => {
  test('one for each copy held, two at most of a kind, the last of a larger kind saying how many are held', () => {
    expect(drawn([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }], [stick, whoops]).map((d) => [d.face.key, d.copy, d.total])).toEqual([['stick', 0, null], ['whoops', 0, null], ['whoops', 1, null]]);
    expect(drawn([{ card: 'whoops', held: 5 }], [stick, whoops]).map((d) => [d.face.key, d.copy, d.total])).toEqual([['whoops', 0, null], ['whoops', 1, 5]]);
    expect(drawn([], [stick, whoops])).toEqual([]);
  });
});

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

  test('each card\'s button stays in the tab order', () => {
    arcHand();
    for (const b of document.querySelectorAll('li.kb-hand-card > button')) expect(b).not.toHaveAttribute('tabindex', '-1');
  });
});

describe('the hand', () => {
  test('each kind is a button by the card\'s name and alignment, with its rules in plain words as its description', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }]);
    expect(screen.getByRole('button', { name: 'Stick Around, Sweet, Cast, common postcard' })).toHaveAccessibleDescription('Stick Around, in plain words.');
    expect(screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, 2 in hand' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hand · 3' })).toBeInTheDocument();
  });

  test('on the Phone board a kind held twice is still two faces', () => {
    phone();
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }]);
    expect(screen.getAllByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' })).toHaveLength(2);
  });

  test('on the Phone board a kind held more than twice says how many in the name of its last face', () => {
    phone();
    hand([{ card: 'whoops', held: 5 }]);
    expect(screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Whoops!, Salty, Cast, common postcard, 5 in hand' })).toBeInTheDocument();
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
