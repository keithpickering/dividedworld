/**
 * Autocorrect's settings in the play form (docs/plans/2026-11-03-autocorrect-plan.md, Task 6): the phrase and its replacement as two
 * labeled fields, and a live line saying how many places in this post the phrase covers, read from the post's own words.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { ConfigForm } from './ConfigForm.tsx';

const post = (body: string) => ({ id: 'p', currentPayload: { body } }) as unknown as Act;
const form = (config: Record<string, unknown> | undefined, body = 'Mario and mario [quote=0f8fad5b-d9cb-469f-a165-70867728950e]Mario[/quote]') => {
  const onChange = vi.fn();
  return { onChange, ...render(<ConfigForm config={config} onChange={onChange} post={post(body)} id="play" />) };
};

describe('Autocorrect\'s play form', () => {
  test('the phrase and the replacement are labeled fields, bounded as the card bounds them', () => {
    form(undefined);
    expect(screen.getByLabelText('Phrase to cover')).toHaveAttribute('maxlength', '100');
    expect(screen.getByLabelText('Cover it with')).toHaveAttribute('maxlength', '100');
  });

  test('typing tells the form both words as they stand', () => {
    const { onChange } = form({ phrase: '', replacement: 'Luigi' });
    fireEvent.change(screen.getByLabelText('Phrase to cover'), { target: { value: 'mario' } });
    expect(onChange).toHaveBeenLastCalledWith({ phrase: 'mario', replacement: 'Luigi' });
    fireEvent.change(screen.getByLabelText('Cover it with'), { target: { value: 'Wario' } });
    expect(onChange).toHaveBeenLastCalledWith({ phrase: '', replacement: 'Wario' });
  });

  test('a live line says how many places the phrase covers in this post\'s own words, or that it is not there', () => {
    form({ phrase: 'mario', replacement: 'x' });
    expect(screen.getByRole('status')).toHaveTextContent('Covers 2 places in this post');
    form({ phrase: 'luigi', replacement: 'x' });
    expect(screen.getAllByRole('status').at(-1)).toHaveTextContent('Not in this post\'s own words');
  });
});
