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
const copy = () => screen.getByLabelText('The post\'s words, to select from');
const select = (text: string, inside: Node = copy().firstChild ?? copy()) => {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    toString: () => text, isCollapsed: text === '', rangeCount: 1, getRangeAt: () => ({ commonAncestorContainer: inside, toString: () => text }),
  } as unknown as Selection);
  fireEvent(document, new Event('selectionchange'));
};
const phrase = (n: number) => screen.getByLabelText(`Phrase for cue ${n}`) as HTMLInputElement;
const sound = (n: number) => screen.getByLabelText(`Sound for cue ${n}`);
afterEach(() => vi.restoreAllMocks());

describe('Laugh Track\'s play form', () => {
  test('a fieldset of one row to begin with, with labeled fields and no remove button for a lone row', () => {
    form(undefined);
    expect(screen.getByRole('group', { name: 'Your audience\'s cues' })).toBeInTheDocument();
    expect(phrase(1)).toHaveAttribute('maxlength', '100');
    expect(sound(1)).toHaveValue('laugh');
    expect(within(sound(1)).getAllByRole('option').map((o) => o.textContent)).toEqual(['Laugh', 'Cheer', 'Boo']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByText('A face-down Laugh Track waits for this phrase')).toBeInTheDocument();
  });

  test('rows add up to five and then the button goes; each but a lone one can be removed', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'laugh' }] });
    for (let i = 2; i <= 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Add a cue' }));
      expect(screen.getAllByLabelText(/^Phrase/)).toHaveLength(i);
    }
    expect(screen.queryByRole('button', { name: 'Add a cue' })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'laugh' }, ...Array(4).fill({ phrase: '', sound: 'laugh' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 5' }));
    expect(screen.getAllByLabelText(/^Phrase/)).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Add a cue' })).toBeInTheDocument();
    for (let i = 4; i >= 2; i--) fireEvent.click(screen.getByRole('button', { name: `Remove cue ${i}` }));
    expect(screen.getAllByLabelText(/^Phrase/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  test('each row counts its own places, or says it is not in the post\'s words, and the total is against the cap', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'cheer' }, { phrase: 'wario', sound: 'boo' }] });
    const lines = [1, 2, 3].map((n) => document.getElementById(phrase(n).getAttribute('aria-describedby')!)!.textContent);
    expect(lines).toEqual(['Cues 3 places in this post', 'Cues 2 places in this post', 'Not in this post\'s own words']);
    expect(screen.getByText('5 places in all (at most 30)')).toBeInTheDocument();
  });

  test('one place says place', () => {
    form({ cues: [{ phrase: 'again', sound: 'laugh' }] });
    expect(screen.getByText('Cues 1 place in this post')).toBeInTheDocument();
    expect(screen.getByText('1 place in all (at most 30)')).toBeInTheDocument();
  });

  test('typing and choosing a sound tell the form the cues as they stand, in the rules\' shape', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }] });
    fireEvent.change(phrase(1), { target: { value: 'luigi' } });
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'luigi', sound: 'laugh' }] });
    fireEvent.change(sound(1), { target: { value: 'boo' } });
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'luigi', sound: 'boo' }] });
  });

  test('selecting words in the copy fills the row that last had focus, trimmed to whole words', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }, { phrase: '', sound: 'boo' }] });
    expect(screen.getByLabelText('The post\'s words, to select from').tagName).toBe('BLOCKQUOTE');
    select('Luigi waved');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'Luigi waved', sound: 'laugh' }, { phrase: '', sound: 'boo' }] });
    fireEvent.focus(phrase(2));
    select('ario and mari');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'Luigi waved', sound: 'laugh' }, { phrase: 'and', sound: 'boo' }] });
  });

  test('the labels read Phrase and Sound and each field is named for its row', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'boo' }] });
    expect(screen.getAllByText('Phrase')).toHaveLength(2);
    expect(screen.getAllByText('Sound')).toHaveLength(2);
    expect(phrase(2)).toHaveValue('luigi');
    expect(sound(2)).toHaveValue('boo');
  });

  test('one polite live region, the total; the rows\' lines are plain text described by their input', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'boo' }] });
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.textContent).toBe('5 places in all (at most 30)');
    expect(phrase(1)).toHaveAccessibleDescription('Cues 3 places in this post');
  });

  test('a phrase outside the rules\' bounds shows the bound in the rules\' words, and an empty one only a hint', () => {
    form({ cues: [{ phrase: 'and', sound: 'laugh' }, { phrase: '', sound: 'laugh' }, { phrase: `${'mario '.repeat(20)}`, sound: 'laugh' }] });
    expect(phrase(1)).toHaveAccessibleDescription('The phrase has at least 4 letters or digits');
    expect(phrase(2)).toHaveAccessibleDescription('At least 4 letters or digits, matched as whole words in any case');
    expect(phrase(3)).toHaveAccessibleDescription('The phrase is at most 100 characters');
  });

  test('opening the form again with a config shows its rows', () => {
    form({ cues: [{ phrase: 'mario', sound: 'cheer' }, { phrase: 'luigi', sound: 'boo' }, { phrase: 'again', sound: 'laugh' }] });
    expect([1, 2, 3].map((n) => phrase(n).value)).toEqual(['mario', 'luigi', 'again']);
    expect([1, 2, 3].map((n) => (sound(n) as HTMLSelectElement).value)).toEqual(['cheer', 'boo', 'laugh']);
  });

  test('removing the middle row keeps the others and moves focus to the Phrase now at that place', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'cheer' }, { phrase: 'luigi', sound: 'boo' }, { phrase: 'again', sound: 'laugh' }] });
    const button = screen.getByRole('button', { name: 'Remove cue 2' });
    button.focus();
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'cheer' }, { phrase: 'again', sound: 'laugh' }] });
    expect([1, 2].map((n) => phrase(n).value)).toEqual(['mario', 'again']);
    expect(phrase(2)).toHaveFocus();
  });

  test('removing the last row focuses the new last row\'s Phrase', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'laugh' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 2' }));
    expect(phrase(1)).toHaveFocus();
  });

  test('after a removal a selection fills the row focus moved to, never a row that is gone', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'laugh' }, { phrase: 'again', sound: 'laugh' }] });
    fireEvent.focus(phrase(3));
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 3' }));
    select('Luigi waved');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'Luigi waved', sound: 'laugh' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 1' }));
    select('waved at');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'waved at', sound: 'laugh' }] });
  });

  test('a selection outside the copy fills nothing; one inside fills the focused row', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }] });
    onChange.mockClear();
    select('Luigi waved', document.body);
    expect(onChange).not.toHaveBeenCalled();
    select('Luigi waved');
    expect(onChange).toHaveBeenCalledWith({ cues: [{ phrase: 'Luigi waved', sound: 'laugh' }] });
  });
});
