/**
 * Card Collector's settings in the play form (the face-down Moves plan, Task 8): "The card it waits for", a radio group of small card faces,
 * one for every card of the instance cast on a post at or below Card Collector's rarity (not only the setter's hand, and never a Gimmick or a Reversal), named, reached by the
 * arrow keys, the first chosen when untouched. Its output is what `cardCollector.validateConfig` takes.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { atOrBelow, castOnPost } from '../../../../engine/rules/cards.ts';
import { faceOf } from '../../../../engine/ui/cards/faces.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { cards } from '../index.ts';
import { cardsUi } from '../../ui/cards.ts';
import { instance } from '../../index.ts';
import { cardCollector } from '../card-collector.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;
/* The cards it may wait for: cast on a post, and no rarer than Card Collector itself (uncommon). */
const castable = cards.filter((c) => castOnPost(c) && atOrBelow(c.rarity, cardCollector.rarity)).map((r) => faceOf(r, cardsUi.find((u) => u.key === r.key), instance.settings, { cast: 'Move', set: 'Gimmick', use: 'Ward' }));

/** Held in state as the play form holds it, so a choice shows. */
function Held({ onChange, faces = castable }: { readonly onChange: (c: Record<string, unknown>) => void; readonly faces?: typeof castable }) {
  const [config, setConfig] = useState<ConfigFormProps['config']>(undefined);
  return <ConfigForm config={config} onChange={(c) => { setConfig(c); onChange(c as Record<string, unknown>); }} post={POST} id="play" castable={faces} />;
}

describe('the card it waits for', () => {
  test('offers every card cast on a post at or below uncommon, by name, and no Gimmick, Reversal or card beyond a post', () => {
    render(<Held onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'The card it waits for' });
    /* The wrapping label names each radio: the card's name, its kind tag and its rarity, in that order. */
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(radios.map(() => null));
    expect(screen.getByRole('radio', { name: 'Whoops! Move Common' })).toBeInTheDocument();
    const names = castable.map((f) => f.name);
    expect(radios.map((r, i) => r.closest('label')!.textContent)).toEqual(castable.map((f) => expect.stringContaining(f.name)));
    expect(names).toEqual(cards.filter((c) => castOnPost(c) && atOrBelow(c.rarity, cardCollector.rarity)).map((c) => c.name));
    expect(names).toEqual(expect.arrayContaining(['Whoops!', 'Stick Around', 'Autocorrect', "Feelin' Fab"]));
    for (const not of ['Force Field', 'Card Collector', 'Hall Pass', 'Publicity Tour', 'Glitter Bomb', 'Main Event', 'Graffiti', 'Whodunnit?']) expect(names).not.toContain(not);
  });

  test('leaves out a card rarer than Card Collector itself, read from its rules', () => {
    const rare = { ...castable[0]!, key: 'rare-move', name: 'Rare Move', rarity: 'rare' as const };
    render(<Held onChange={() => {}} faces={[...castable, rare]} />);
    expect(screen.queryByRole('radio', { name: /^Rare Move/u })).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(castable.length);
  });

  test('shows each face\'s kind tag and rarity as words', () => {
    render(<Held onChange={() => {}} />);
    const whoops = screen.getByRole('radio', { name: 'Whoops! Move Common' }).closest('label')!;
    expect(whoops).toHaveTextContent('Move');
    expect(whoops).toHaveTextContent('Common');
  });

  test('left untouched it chooses nothing and says nothing to the play form; a choice is given, and the arrow keys move it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: new RegExp(`^${castable[0]!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u') }));
    expect(onChange).toHaveBeenLastCalledWith({ card: castable[0]!.key });
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: new RegExp(`^${castable[1]!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u') })).toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith({ card: castable[1]!.key });
  });

  test('gives what the card\'s rules take', async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    expect(cardCollector.validateConfig(undefined).ok).toBe(false);
    await userEvent.click(screen.getByRole('radio', { name: new RegExp(`^${castable[0]!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u') }));
    const given = onChange.mock.calls.at(-1)![0];
    expect(cardCollector.validateConfig(given).ok).toBe(true);
  });
});
