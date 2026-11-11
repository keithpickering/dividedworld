/**
 * Mooch's setting in the play form (card notes Part 6, Task 9): "The reactions to mooch", one of the four kinds of reaction, named by the
 * instance's own labels, giving `{ quadrant }`, which is what `mooch.validateConfig` takes.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { instanceUi } from '../../ui/index.ts';
import { mooch } from '../mooch.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;
const kayfa = { ui: { quadrantLabels: instanceUi.quadrantLabels } } as unknown as Kayfa;

function Held({ onChange }: { readonly onChange: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState<ConfigFormProps['config']>(undefined);
  return <KayfaProvider value={kayfa}><ConfigForm config={config} onChange={(c) => { setConfig(c); onChange(c); }} post={POST} id="play" /></KayfaProvider>;
}

describe('the reactions to mooch', () => {
  test('is a group of the instance\'s four labels, nothing chosen until the player chooses', () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'The reactions to mooch' });
    expect(group).toBeInTheDocument();
    for (const label of Object.values(instanceUi.quadrantLabels)) expect(screen.getByRole('radio', { name: label })).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
    expect(mooch.validateConfig(undefined).ok).toBe(false);
  });

  test('a choice gives `{ quadrant }`, which the card\'s rules take, and the arrow keys move it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: instanceUi.quadrantLabels.excitedPositive }));
    expect(onChange).toHaveBeenLastCalledWith({ quadrant: 'excitedPositive' });
    expect(mooch.validateConfig(onChange.mock.calls.at(-1)![0]).ok).toBe(true);
    await user.keyboard('{ArrowDown}');
    const moved = (onChange.mock.calls.at(-1)![0] as { quadrant: string }).quadrant;
    expect(moved).not.toBe('excitedPositive');
    expect(screen.getByRole('radio', { name: instanceUi.quadrantLabels[moved as keyof typeof instanceUi.quadrantLabels] })).toBeChecked();
  });
});
