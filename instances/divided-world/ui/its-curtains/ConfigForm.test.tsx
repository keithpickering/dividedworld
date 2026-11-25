/**
 * It's Curtains' settings in the play form (docs/plans/2026-11-23-its-curtains-plan.md, Task 6; design 2.7): the fabric, a labeled radiogroup of the six on the list,
 * Red chosen when nothing is, and no free picker. Its output is `{ fabric }`.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { FABRICS } from '../../cards/its-curtains.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;

function form(config?: Record<string, unknown>) {
  const onChange = vi.fn();
  const view = render(<ConfigForm config={config} onChange={onChange} post={POST} id="play" />);
  return { onChange, ...view };
}

describe('the fabric', () => {
  test('left untouched it is Red, and the play form is told so', () => {
    const { onChange } = form();
    expect(onChange).toHaveBeenCalledWith({ fabric: 'red' });
    expect(screen.getByRole('radio', { name: 'Red' })).toBeChecked();
  });

  test('is a radiogroup labeled "Curtain fabric" of the six on the list, in order', () => {
    form({ fabric: 'red' });
    expect(screen.getByRole('group', { name: 'Curtain fabric' })).toBeInTheDocument();
    const radios = within(screen.getByRole('radiogroup', { name: 'Curtain fabric' })).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(Object.values(FABRICS).map((f) => f.name));
  });

  test.each(Object.entries(FABRICS))('picking %s gives { fabric }', (key, fabric) => {
    const { onChange } = form({ fabric: key === 'red' ? 'gold' : 'red' });
    fireEvent.click(screen.getByRole('radio', { name: fabric.name }));
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ fabric: key });
  });

  test('each swatch is its fabric\'s mid shade, and the chosen one is checked', () => {
    form({ fabric: 'emerald' });
    expect(screen.getByRole('radio', { name: 'Emerald' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Red' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Royal Blue' }).closest('label')!.style.getPropertyValue('--kb-ink')).toBe(FABRICS['royal-blue'].mid);
  });

  test('a fabric that is not on the list reads as Red, and there is no free picker', () => {
    const { container } = form({ fabric: '#123456' });
    expect(screen.getByRole('radio', { name: 'Red' })).toBeChecked();
    expect(container.querySelector('input[type="color"]')).toBeNull();
  });
});
