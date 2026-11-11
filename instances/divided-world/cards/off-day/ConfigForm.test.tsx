/**
 * Off Day's setting in the play form (card notes Part 6, Task 9): "The class it scores as", a radio group of the instance's classes by name, in
 * the classes' order, giving `{ class }`, which is what `offDay.validateConfig` takes.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { KayfaProvider, type Kayfa } from '../../../../engine/ui/context.tsx';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { instance } from '../../index.ts';
import { classes } from '../../classes/index.ts';
import { offDay } from '../off-day.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;
const kayfa = { instance } as unknown as Kayfa;

function Held({ onChange }: { readonly onChange: (c: Record<string, unknown>) => void }) {
  const [config, setConfig] = useState<ConfigFormProps['config']>(undefined);
  return <KayfaProvider value={kayfa}><ConfigForm config={config} onChange={(c) => { setConfig(c); onChange(c); }} post={POST} id="play" /></KayfaProvider>;
}

describe('the class it scores as', () => {
  test('is a group of the instance\'s classes by name, in the classes\' order, nothing chosen until the player chooses', () => {
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'The class it scores as' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(classes.map((c) => c.name));
    for (const r of radios) expect(r).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('a choice gives `{ class }`, which the card\'s rules take, every class among them; the arrow keys move it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Held onChange={onChange} />);
    for (const c of classes) {
      await user.click(screen.getByRole('radio', { name: c.name }));
      expect(onChange).toHaveBeenLastCalledWith({ class: c.key });
      expect(offDay.validateConfig(onChange.mock.calls.at(-1)![0]).ok, c.key).toBe(true);
    }
    await user.click(screen.getByRole('radio', { name: classes[0]!.name }));
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith({ class: classes[1]!.key });
  });
});
