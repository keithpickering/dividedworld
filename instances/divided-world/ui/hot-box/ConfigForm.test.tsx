/**
 * Hot Box's settings in the play form (hot box plan, Task 5; design 2.2): the smoke's color, Whoops!'s six
 * swatches as a labeled radiogroup with the first chosen, and a way to pick any color. Its output is `{ color }`.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;

function form(config?: Record<string, unknown>) {
  const onChange = vi.fn();
  const view = render(<ConfigForm config={config} onChange={onChange} post={POST} id="play" />);
  return { onChange, ...view };
}

describe('the smoke color', () => {
  test('left untouched it is the first swatch, and the play form is told so', () => {
    const { onChange } = form();
    expect(onChange).toHaveBeenCalledWith({ color: '#ff2bd6' });
    expect(screen.getByRole('radio', { name: 'Magenta' })).toBeChecked();
  });

  test('is a radiogroup labeled "Smoke color" of the six swatches', () => {
    form({ color: '#ff2bd6' });
    expect(screen.getByRole('group', { name: 'Smoke color' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Smoke color' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Magenta', 'Cyan', 'Yellow', 'Green', 'Orange', 'Violet']);
  });

  test('a swatch picked gives { color }', () => {
    const { onChange } = form({ color: '#ff2bd6' });
    fireEvent.click(screen.getByRole('radio', { name: 'Cyan' }));
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ color: '#19e3ff' });
  });

  test('any color picked gives { color }', () => {
    const { onChange } = form({ color: '#ff2bd6' });
    fireEvent.change(screen.getByLabelText('Any color'), { target: { value: '#123abc' } });
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ color: '#123abc' });
  });

  test('a color already in config is shown as picked', () => {
    const { unmount } = form({ color: '#B46CFF' });
    expect(screen.getByRole('radio', { name: 'Violet' })).toBeChecked();
    expect(screen.getByLabelText('Any color')).toHaveValue('#b46cff');
    unmount();
    form({ color: '#123ABC' });
    expect(screen.getByLabelText('Any color')).toHaveValue('#123abc');
    expect(screen.queryAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0);
  });
});
