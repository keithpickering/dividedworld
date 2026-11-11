/**
 * The four kinds of reaction, as a radio group in a play form (card notes Part 6, Task 9): Mooch and 4D Chess each name one. The
 * labels are the instance's (`quadrantLabels`, read from the engine's context), the choice is `{ quadrant }`, and it is native
 * radios, so the arrow keys move between them and Space chooses, as Card Collector's faces do.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import { QUADRANTS, type Quadrant } from '../../../../engine/rules/types.ts';
import { QuadrantPick } from './QuadrantPick.tsx';

const labels = { excitedNegative: 'Sizzle', excitedPositive: 'Cheer', boredNegative: 'Yawn', calmPositive: 'Purr' };
const kayfa = { ui: { quadrantLabels: labels } } as unknown as Kayfa;

/** Held in state as a play form holds it, so a choice shows. */
function Held({ onChange, start, id = 'play' }: { readonly onChange: (c: { readonly quadrant: Quadrant }) => void; readonly start?: Quadrant; readonly id?: string }) {
  const [quadrant, setQuadrant] = useState<Quadrant | undefined>(start);
  return (
    <KayfaProvider value={kayfa}>
      <QuadrantPick legend="The reactions to mooch" id={id} value={quadrant} onChange={(c) => { setQuadrant(c.quadrant); onChange(c); }} />
    </KayfaProvider>
  );
}

describe('the reactions a card names', () => {
  test('is a group under its legend with a radio for each of the four, named by the instance\'s own labels, in the engine\'s order', () => {
    render(<Held onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'The reactions to mooch' });
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(QUADRANTS.map((q) => labels[q]));
    for (const q of QUADRANTS) expect(screen.getByRole('radio', { name: labels[q] })).toBeInTheDocument();
  });

  test('left untouched chooses nothing and says nothing; a choice gives `{ quadrant }`, and the chosen one is checked', async () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    for (const r of screen.getAllByRole('radio')) expect(r).not.toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: labels.calmPositive }));
    expect(onChange).toHaveBeenLastCalledWith({ quadrant: 'calmPositive' });
    expect(screen.getByRole('radio', { name: labels.calmPositive })).toBeChecked();
  });

  test('the arrow keys move the choice and Space chooses, as a native radio group does', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} start={QUADRANTS[0]} />);
    expect(screen.getByRole('radio', { name: labels[QUADRANTS[0]!] })).toBeChecked();
    screen.getByRole('radio', { name: labels[QUADRANTS[0]!] }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: labels[QUADRANTS[1]!] })).toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith({ quadrant: QUADRANTS[1] });
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith({ quadrant: QUADRANTS[QUADRANTS.length - 1] });
  });

  test('the ids hung on its radios are its own, so two groups on a page keep their choices apart', () => {
    render(<><Held onChange={() => {}} id="one" /><Held onChange={() => {}} id="two" start="boredNegative" /></>);
    const radios = screen.getAllByRole('radio', { name: labels.boredNegative });
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, true]);
  });
});
