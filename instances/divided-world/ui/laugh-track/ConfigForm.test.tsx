/**
 * Laugh Track's settings in the play form (docs/plans/2026-11-11-laugh-track-plan.md, Task 12): up to five cue rows, each counted
 * through the card's own matcher, the play's total against its cap, and a read-only copy of the post to select words from.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { ConfigForm } from './ConfigForm.tsx';

const post = (body: string) => ({ id: 'p', currentPayload: { body } }) as unknown as Act;
const BODY = 'Mario and mario met Luigi. Luigi waved at Mario again.';
const form = (config: Record<string, unknown> | undefined, body = BODY) => {
  const onChange = vi.fn();
  return { onChange, ...render(<ConfigForm config={config} onChange={onChange} post={post(body)} id="play" />) };
};
const select = (text: string) => {
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text, isCollapsed: text === '', rangeCount: 1 } as unknown as Selection);
  fireEvent.mouseUp(screen.getByLabelText('The post\'s words, to select from'));
};
afterEach(() => vi.restoreAllMocks());

describe('Laugh Track\'s play form', () => {
  test('a fieldset of one row to begin with, with labeled fields and no remove button for a lone row', () => {
    form(undefined);
    expect(screen.getByRole('group', { name: 'Your audience\'s cues' })).toBeInTheDocument();
    expect(screen.getByLabelText('Phrase')).toHaveAttribute('maxlength', '100');
    expect(screen.getByLabelText('Sound')).toHaveValue('laugh');
    expect(within(screen.getByLabelText('Sound')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Laugh', 'Cheer', 'Boo']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByText('A face-down Laugh Track waits for this phrase')).toBeInTheDocument();
  });

  test('rows add up to five and then the button goes; each but a lone one can be removed', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'laugh' }] });
    for (let i = 2; i <= 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Add a cue' }));
      expect(screen.getAllByLabelText('Phrase')).toHaveLength(i);
    }
    expect(screen.queryByRole('button', { name: 'Add a cue' })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'laugh' }, ...Array(4).fill({ phrase: '', sound: 'laugh' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 5' }));
    expect(screen.getAllByLabelText('Phrase')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Add a cue' })).toBeInTheDocument();
    for (let i = 4; i >= 2; i--) fireEvent.click(screen.getByRole('button', { name: `Remove cue ${i}` }));
    expect(screen.getAllByLabelText('Phrase')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  test('each row counts its own places, or says it is not in the post\'s words, and the total is against the cap', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'cheer' }, { phrase: 'wario', sound: 'boo' }] });
    const lines = screen.getAllByRole('status').map((s) => s.textContent);
    expect(lines).toContain('Cues 3 places in this post');
    expect(lines).toContain('Cues 2 places in this post');
    expect(lines).toContain('Not in this post\'s own words');
    expect(screen.getByText('5 places in all (at most 30)')).toBeInTheDocument();
  });

  test('one place says place', () => {
    form({ cues: [{ phrase: 'again', sound: 'laugh' }] });
    expect(screen.getByText('Cues 1 place in this post')).toBeInTheDocument();
    expect(screen.getByText('1 place in all (at most 30)')).toBeInTheDocument();
  });

  test('typing and choosing a sound tell the form the cues as they stand, in the rules\' shape', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }] });
    fireEvent.change(screen.getByLabelText('Phrase'), { target: { value: 'luigi' } });
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'luigi', sound: 'laugh' }] });
    fireEvent.change(screen.getByLabelText('Sound'), { target: { value: 'boo' } });
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'luigi', sound: 'boo' }] });
  });

  test('selecting words in the copy fills the row that last had focus, trimmed to whole words', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }, { phrase: '', sound: 'boo' }] });
    expect(screen.getByLabelText('The post\'s words, to select from').tagName).toBe('BLOCKQUOTE');
    select('Luigi waved');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'Luigi waved', sound: 'laugh' }, { phrase: '', sound: 'boo' }] });
    fireEvent.focus(screen.getAllByLabelText('Phrase')[1]!);
    select('ario and mari');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'Luigi waved', sound: 'laugh' }, { phrase: 'and', sound: 'boo' }] });
  });
});
