import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { buildWorld, renderIn } from '../test-world.tsx';
import { Hand, drawn, fanSlot } from './Hand.tsx';
import type { CardFace } from './faces.ts';

const face = (key: string, name: string, alignment: 'sweet' | 'salty'): CardFace => ({
  key, name, alignment, tag: alignment === 'sweet' ? 'Sweet' : 'Salty', price: 100, extra: 0, stack: 1,
  art: { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)' }, tagline: '', summary: `${name} in a sentence.`, describe: `${name}, in plain words.`,
});
const stick = face('stick', 'Stick Around', 'sweet');
const whoops = face('whoops', 'Whoops!', 'salty');

const hand = (held: readonly { card: string; held: number }[], props: Partial<Parameters<typeof Hand>[0]> = {}) =>
  renderIn(buildWorld(), <div role="region" aria-label="Your hand"><Hand held={held} faces={[stick, whoops]} vendingHref="/vending" onClose={() => {}} {...props} /></div>);

describe('the faces a hand draws', () => {
  test('one for each copy held, two at most of a kind, the last of a larger kind saying how many are held', () => {
    expect(drawn([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }], [stick, whoops]).map((d) => [d.face.key, d.copy, d.total])).toEqual([['stick', 0, null], ['whoops', 0, null], ['whoops', 1, null]]);
    expect(drawn([{ card: 'whoops', held: 5 }], [stick, whoops]).map((d) => [d.face.key, d.copy, d.total])).toEqual([['whoops', 0, null], ['whoops', 1, 5]]);
    expect(drawn([], [stick, whoops])).toEqual([]);
  });

  test('three fan at -11, -1 and 10 degrees where the Main board draws them, and other counts spread between the first and the last', () => {
    expect([0, 1, 2].map((i) => fanSlot(i, 3))).toEqual([{ x: -60, y: -260, deg: -11 }, { x: 10, y: -260, deg: -1 }, { x: 72, y: -250, deg: 10 }]);
    expect(fanSlot(0, 2)).toEqual({ x: -60, y: -260, deg: -11 });
    expect(fanSlot(1, 2)).toEqual({ x: 72, y: -250, deg: 10 });
    expect(fanSlot(0, 1).deg).toBe(-1);
    expect(fanSlot(2, 5).deg).toBeCloseTo(-0.5, 5);
  });
});

describe('the hand', () => {
  test('each copy is a button by the card\'s name and alignment, with its rules in plain words as its description', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }]);
    expect(screen.getByRole('button', { name: 'Stick Around, Sweet postcard' })).toHaveAccessibleDescription('Stick Around, in plain words.');
    expect(screen.getAllByRole('button', { name: 'Whoops!, Salty postcard' })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Hand · 3' })).toBeInTheDocument();
  });

  test('a kind held more than twice says how many in the name of its last face', () => {
    hand([{ card: 'whoops', held: 5 }]);
    expect(screen.getByRole('button', { name: 'Whoops!, Salty postcard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Whoops!, Salty postcard, 5 in hand' })).toBeInTheDocument();
  });

  test('pressing a card shows what it does in the sheet\'s line, and the Vending Machine is a link', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 1 }]);
    expect(screen.getByText('Stick Around.', { selector: 'b' }).closest('p')).toHaveTextContent('Stick Around in a sentence.');
    fireEvent.click(screen.getByRole('button', { name: 'Whoops!, Salty postcard' }));
    expect(screen.getByText('Whoops!.', { selector: 'b' }).closest('p')).toHaveTextContent('Whoops! in a sentence.');
    expect(screen.getByRole('link', { name: 'Vending Machine' })).toHaveAttribute('href', '/vending');
  });

  test('an armed card says so in its name and in the line, and pressing a card is the caller\'s to answer', () => {
    const onPick = vi.fn();
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }], { armed: 'whoops', onPick });
    const armed = screen.getByRole('button', { name: 'Whoops!, Salty postcard, armed: pick a post' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Stick Around, Sweet postcard' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('+ mark').closest('p')).toHaveTextContent('Whoops! is armed. Every post it can land on now shows a dashed + mark beside its date. Press it to play Whoops! there.');
    fireEvent.click(armed);
    expect(onPick).toHaveBeenCalledWith(whoops);
  });

  test('the armed card carries its floating tag, and no other card does', () => {
    hand([{ card: 'stick', held: 1 }, { card: 'whoops', held: 2 }], { armed: 'whoops', onPick: () => {} });
    expect(screen.getAllByText('Armed · pick a post')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Whoops!, Salty postcard, armed: pick a post' }).closest('li')).toHaveTextContent('Armed · pick a post');
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
    expect(shown).toBe('Stick Around Sweet Hold a reader on a post.');
    expect(button.getAttribute('aria-label')!.replace(/[^\w ]/g, ' ').replace(/\s+/g, ' ')).toContain(shown.replace(/[^\w ]/g, ' ').replace(/\s+/g, ' '));
  });
});
