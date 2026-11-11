/**
 * 4D Chess's settings in the play form (card notes Part 6, Task 9): "The Move it waits for", Card Collector's faces for every card cast on a
 * post at or below uncommon, then "The reactions it pays on", the four kinds of reaction. Its output is what `fourDChess.validateConfig`
 * takes: `{ card, quadrant }`, given only when both are chosen, in either order.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { castOnPost } from '../../../../engine/rules/cards.ts';
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import { faceOf } from '../../../../engine/ui/cards/faces.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { cards } from '../index.ts';
import { cardsUi } from '../../ui/cards.ts';
import { instanceUi } from '../../ui/index.ts';
import { instance } from '../../index.ts';
import { fourDChess } from '../4d-chess.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;
const kinds = { cast: 'Move', set: 'Reversal', use: 'Gimmick' };
const castable = cards.filter(castOnPost).map((r) => faceOf(r, cardsUi.find((u) => u.key === r.key), instance.settings, kinds));
const kayfa = { ui: { quadrantLabels: instanceUi.quadrantLabels } } as unknown as Kayfa;

function Held({ onChange, faces = castable }: { readonly onChange: (c: Record<string, unknown>) => void; readonly faces?: typeof castable }) {
  const [config, setConfig] = useState<ConfigFormProps['config']>(undefined);
  return <KayfaProvider value={kayfa}><ConfigForm config={config} onChange={(c) => { setConfig(c); onChange(c); }} post={POST} id="play" castable={faces} /></KayfaProvider>;
}

describe('the Move it waits for', () => {
  test('is Card Collector\'s faces: every card cast on a post at or below uncommon, none rarer, and no Gimmick or Reversal', () => {
    render(<Held onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'The Move it waits for' });
    const offered = within(group).getAllByRole('radio').map((r) => r.closest('label')!.textContent);
    const allowed = castable.filter((f) => ['common', 'uncommon'].includes(f.rarity)).map((f) => f.name);
    expect(offered).toEqual(allowed.map((n) => expect.stringContaining(n)));
    expect(allowed).toEqual(expect.arrayContaining(['Whoops!', 'Mooch']));
    expect(allowed).not.toContain('Off Day');
    for (const not of ['Toll', '4D Chess', 'Card Collector', 'Force Field']) expect(allowed).not.toContain(not);
  });

  test('a card rarer than 4D Chess itself is not offered, read from its rules', () => {
    const rare = { ...castable[0]!, key: 'rare-move', name: 'Rare Move', rarity: 'rare' as const };
    render(<Held onChange={() => {}} faces={[...castable, rare]} />);
    expect(screen.queryByRole('radio', { name: /^Rare Move/u })).toBeNull();
    expect(fourDChess.rarity).toBe('uncommon');
  });
});

describe('the reactions it pays on', () => {
  test('is a group of the instance\'s four labels, under the faces', () => {
    render(<Held onChange={() => {}} />);
    const groups = screen.getAllByRole('group').map((g) => g.querySelector('legend')!.textContent);
    expect(groups).toEqual(['The Move it waits for', 'The reactions it pays on']);
    for (const label of Object.values(instanceUi.quadrantLabels)) expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
  });
});

describe('what the form gives', () => {
  test('nothing is said until a choice is made; each choice keeps the other, whichever is first', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    render(<Held onChange={first} />);
    expect(first).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: /^Whoops!/u }));
    expect(first).toHaveBeenLastCalledWith({ card: 'whoops' });
    expect(fourDChess.validateConfig(first.mock.calls.at(-1)![0]).ok).toBe(false);
    await user.click(screen.getByRole('radio', { name: instanceUi.quadrantLabels.calmPositive }));
    expect(first).toHaveBeenLastCalledWith({ card: 'whoops', quadrant: 'calmPositive' });
    expect(fourDChess.validateConfig(first.mock.calls.at(-1)![0]).ok).toBe(true);
    /* Another card keeps the quadrant; the quadrant first keeps no card to lose. */
    await user.click(screen.getByRole('radio', { name: /^Mooch/u }));
    expect(first).toHaveBeenLastCalledWith({ card: 'mooch', quadrant: 'calmPositive' });
    const second = vi.fn();
    render(<Held onChange={second} />);
    await user.click(screen.getAllByRole('radio', { name: instanceUi.quadrantLabels.excitedNegative }).at(-1)!);
    expect(second).toHaveBeenLastCalledWith({ quadrant: 'excitedNegative' });
  });

  test('the arrow keys move between the faces, and between the reactions, as native radios do', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: /^Whoops!/u }));
    await user.keyboard('{ArrowDown}');
    expect((onChange.mock.calls.at(-1)![0] as { card: string }).card).not.toBe('whoops');
    await user.click(screen.getByRole('radio', { name: instanceUi.quadrantLabels.excitedNegative }));
    await user.keyboard('{ArrowDown}');
    expect((onChange.mock.calls.at(-1)![0] as { quadrant: string }).quadrant).not.toBe('excitedNegative');
  });
});
