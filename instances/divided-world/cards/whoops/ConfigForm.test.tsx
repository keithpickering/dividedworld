/**
 * Whoops!'s settings in the play form (cards plan Task 5; the Cards board's "Ink color"): the card's
 * swatches as a radiogroup with Magenta chosen, a way to pick any color, and a preview of the ink with
 * the shading it will have. Its output is what the card's `validateConfig` takes.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { whoops } from '../whoops.ts';
import { ConfigForm } from './ConfigForm.tsx';

const POST = { id: 'p' } as Act;

function form(config?: Record<string, unknown>) {
  const onChange = vi.fn();
  const view = render(<ConfigForm config={config} onChange={onChange} post={POST} id="play" />);
  return { onChange, ...view };
}

describe('the ink color', () => {
  test('is a radiogroup of the card\'s swatches, Magenta chosen, each named by its color', () => {
    form({ color: '#ff2bd6' });
    const group = screen.getByRole('radiogroup', { name: 'Ink color' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Magenta', 'Cyan', 'Yellow', 'Green', 'Orange', 'Violet']);
    expect(screen.getByRole('radio', { name: 'Magenta' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Cyan' })).not.toBeChecked();
  });

  test('left untouched it is Magenta, and the play form is told so', () => {
    const { onChange } = form();
    expect(onChange).toHaveBeenCalledWith({ color: '#ff2bd6' });
    expect(screen.getByRole('radio', { name: 'Magenta' })).toBeChecked();
  });

  test('a swatch chosen gives its color, and the card takes it', () => {
    const { onChange } = form({ color: '#ff2bd6' });
    fireEvent.click(screen.getByRole('radio', { name: 'Cyan' }));
    const given = onChange.mock.calls.at(-1)![0];
    expect(given).toEqual({ color: '#19e3ff' });
    expect(whoops.validateConfig!(given).ok).toBe(true);
  });

  test('any color can be picked, the swatches then none chosen, and the card takes it', () => {
    const { onChange } = form({ color: '#ff2bd6' });
    fireEvent.change(screen.getByLabelText('Any color'), { target: { value: '#123abc' } });
    const given = onChange.mock.calls.at(-1)![0];
    expect(given).toEqual({ color: '#123abc' });
    expect(whoops.validateConfig!(given).ok).toBe(true);
  });

  test('a color the player picked shows in the picker, and a swatch\'s color in capitals is that swatch', () => {
    const { unmount } = form({ color: '#123ABC' });
    expect(screen.getByLabelText('Any color')).toHaveValue('#123abc');
    expect(screen.queryAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toHaveLength(0);
    unmount();
    form({ color: '#B46CFF' });
    expect(screen.getByRole('radio', { name: 'Violet' })).toBeChecked();
  });

  test('is previewed with its shading: a wet highlight on a dark ink, an edge shadow on a pale one', () => {
    const dark = form({ color: '#101010' });
    const hi = (c: HTMLElement) => Number(c.querySelector('[data-kb-highlight]')!.getAttribute('data-kb-highlight'));
    const edge = (c: HTMLElement) => Number(c.querySelector('[data-kb-edge-shadow]')!.getAttribute('data-kb-edge-shadow'));
    const darkHi = hi(dark.container);
    const darkEdge = edge(dark.container);
    dark.unmount();
    const pale = form({ color: '#f4f4c8' });
    expect(darkHi).toBeGreaterThan(hi(pale.container));
    expect(edge(pale.container)).toBeGreaterThan(darkEdge);
    expect(pale.container.querySelector('[role="img"]')).toHaveAccessibleName('Preview of the ink');
  });
});
