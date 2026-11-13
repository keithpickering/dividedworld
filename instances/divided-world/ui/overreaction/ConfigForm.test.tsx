/**
 * Overreaction's setting in the play form (card notes Part 3, Task 11): an emoji field and the quadrant it scores as, giving
 * `{ emoji, quadrant }`, which `overreaction.validateConfig` takes; the choice said back once both are set; the rules' refusal under the field;
 * the labels the instance's own.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { QUADRANTS } from '../../../../engine/rules/types.ts';
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { overreaction } from '../../cards/overreaction.ts';
import { OverreactionForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;
const labels = { excitedNegative: 'Warm', excitedPositive: 'Up', boredNegative: 'Down', calmPositive: 'Cool' } as const;
const kayfa = { ui: { quadrantLabels: labels } } as unknown as Kayfa;

function Held({ onChange }: { readonly onChange: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState<ConfigFormProps['config']>(undefined);
  return <KayfaProvider value={kayfa}><OverreactionForm config={config} onChange={(c) => { setConfig(c); onChange(c); }} post={POST} id="play" /></KayfaProvider>;
}
afterEach(cleanup);
const field = () => screen.getByRole('textbox', { name: 'Emoji' });

describe('Overreaction\'s form', () => {
  test('has an Emoji text field with its help, and a Scores as group; nothing is chosen and nothing is said back', () => {
    render(<Held onChange={vi.fn()} />);
    expect(field()).toHaveAttribute('inputmode', 'text');
    expect(field()).toHaveAttribute('autocomplete', 'off');
    expect(field()).toHaveAccessibleDescription(expect.stringContaining('One emoji. Your keyboard\'s emoji picker works here.'));
    expect(screen.getByRole('group', { name: 'Scores as' })).toBeInTheDocument();
    for (const q of QUADRANTS) expect(screen.getByRole('radio', { name: labels[q] })).not.toBeChecked();
    expect(screen.queryByText(/will score as/u)).toBeNull();
  });

  test('typing an emoji and choosing a radio calls onChange with both, which the card\'s rules take', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    await user.type(field(), '💀');
    expect(onChange).toHaveBeenLastCalledWith({ emoji: '💀' });
    await user.click(screen.getByRole('radio', { name: labels.calmPositive }));
    expect(onChange).toHaveBeenLastCalledWith({ emoji: '💀', quadrant: 'calmPositive' });
    expect(overreaction.validateConfig(onChange.mock.calls.at(-1)![0]).ok).toBe(true);
    await user.clear(field());
    await user.type(field(), '🦆');
    expect(onChange).toHaveBeenLastCalledWith({ emoji: '🦆', quadrant: 'calmPositive' });
  });

  test('says the choice back once both are set, with the instance\'s label', async () => {
    const user = userEvent.setup();
    render(<Held onChange={vi.fn()} />);
    await user.type(field(), '💀');
    expect(screen.queryByText(/will score as/u)).toBeNull();
    await user.click(screen.getByRole('radio', { name: labels.boredNegative }));
    expect(screen.getByText('💀 will score as Down on this post.')).toBeInTheDocument();
  });

  test('the labels come from the instance, in the picker\'s order', () => {
    render(<Held onChange={vi.fn()} />);
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(QUADRANTS.map((q) => labels[q]));
  });

  test('says the rules\' refusal under the field, in their words, and not before the player types', async () => {
    const user = userEvent.setup();
    render(<Held onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(field(), 'ab');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose one emoji.');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    await user.clear(field());
    await user.type(field(), '👍');
    expect(screen.getByRole('alert')).toHaveTextContent('This forum already has that reaction.');
    await user.clear(field());
    await user.type(field(), '💀');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field()).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('the keyboard reaches the field and every radio, and the arrow keys move the choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    await user.tab();
    expect(field()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('radio', { name: labels[QUADRANTS[0]!] })).toHaveFocus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith({ quadrant: QUADRANTS[0] });
    for (const q of QUADRANTS.slice(1)) {
      await user.keyboard('{ArrowDown}');
      expect(screen.getByRole('radio', { name: labels[q] })).toHaveFocus();
      expect(screen.getByRole('radio', { name: labels[q] })).toBeChecked();
    }
  });
});
