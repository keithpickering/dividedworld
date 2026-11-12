/**
 * Laugh Track's settings in the play form (docs/plans/2026-11-12-laugh-track-band-plan.md, Task 8): up to five cues in the glass's own pieces,
 * each counted through the card's own matcher, the play's total against its cap, and the post's words to select from, a selection filling
 * the first empty cue.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { RouterProvider } from '../../../../engine/ui/router.tsx';
import { ConfigForm } from './ConfigForm.tsx';

const post = (body: string) => ({ id: 'p', currentPayload: { body } }) as unknown as Act;
const BODY = 'Mario and mario met Luigi. Luigi waved at Mario again.';
const form = (config: Record<string, unknown> | undefined, body = BODY) => {
  const onChange = vi.fn();
  return { onChange, ...render(<RouterProvider><ConfigForm config={config} onChange={onChange} post={post(body)} id="play" /></RouterProvider>) };
};
const copy = () => screen.getByRole('group', { name: 'The post\'s words' });
const select = (text: string, inside: Node = copy().firstChild ?? copy()) => {
  vi.spyOn(document, 'getSelection').mockReturnValue({
    toString: () => text, isCollapsed: text === '', rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: inside, toString: () => text, intersectsNode: () => false }),
  } as unknown as Selection);
  fireEvent(document, new Event('selectionchange'));
};
const phrase = (n: number) => screen.getByLabelText(`Cue ${n}`) as HTMLInputElement;
const sound = (n: number) => screen.getByRole('group', { name: `Sound for cue ${n}` });
const soundOf = (n: number) => (within(sound(n)).getAllByRole('radio') as HTMLInputElement[]).find((r) => r.checked)?.value;
const pick = (n: number, label: string) => fireEvent.click(within(sound(n)).getByRole('radio', { name: label }));
const total = () => screen.getByText(/places? in all/).closest('[role="status"]')!;
afterEach(() => vi.restoreAllMocks());

describe('Laugh Track\'s play form', () => {
  test('a fieldset of one cue to begin with, with labeled fields and no remove button for a lone cue', () => {
    form(undefined);
    expect(screen.getByRole('group', { name: 'Your audience\'s cues' })).toBeInTheDocument();
    expect(phrase(1)).toHaveAttribute('maxlength', '100');
    expect(soundOf(1)).toBe('laugh');
    expect(within(sound(1)).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Laugh', 'Cheer', 'Boo']);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByText('Select words in the post below with a pointer or by touch, or type them. A selection fills the first empty cue.')).toBeInTheDocument();
    expect(phrase(1)).toHaveAccessibleDescription(/A face-down Laugh Track waits for this phrase\.\s*$/);
  });

  test('cues add up to five and then the button goes; each but a lone one can be removed', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'laugh' }] });
    for (let i = 2; i <= 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Add a cue' }));
      expect(screen.getAllByLabelText(/^Cue \d$/)).toHaveLength(i);
    }
    expect(screen.queryByRole('button', { name: 'Add a cue' })).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'laugh' }, ...Array(4).fill({ phrase: '', sound: 'laugh' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 5' }));
    expect(screen.getAllByLabelText(/^Cue \d$/)).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Add a cue' })).toBeInTheDocument();
    for (let i = 4; i >= 2; i--) fireEvent.click(screen.getByRole('button', { name: `Remove cue ${i}` }));
    expect(screen.getAllByLabelText(/^Cue \d$/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  test('each cue counts its own places, or says it is not in the post\'s words, and the total is against the cap', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'cheer' }, { phrase: 'wario', sound: 'boo' }] });
    expect(phrase(2)).toHaveAccessibleDescription(/^Cues 2 places in this post\s*$/);
    expect(phrase(3)).toHaveAccessibleDescription(/^Not in this post's own words\s*$/);
    expect(phrase(1)).toHaveAccessibleDescription(/^Cues 3 places in this post\. A face-down Laugh Track waits for this phrase\.\s*$/);
    expect(screen.getByText('5 places in all (at most 30)')).toBeInTheDocument();
  });

  test('one place says place', () => {
    form({ cues: [{ phrase: 'again', sound: 'laugh' }] });
    expect(screen.getByText(/^Cues 1 place in this post/)).toBeInTheDocument();
    expect(screen.getByText('1 place in all (at most 30)')).toBeInTheDocument();
  });

  test('typing and choosing a sound tell the form the cues as they stand, in the rules\' shape', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }] });
    fireEvent.change(phrase(1), { target: { value: 'luigi' } });
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'luigi', sound: 'laugh' }] });
    pick(1, 'Boo');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'luigi', sound: 'boo' }] });
  });

  test('1. a selection fills the first cue whose phrase is empty, whichever field last had focus, trimmed to whole words', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: '', sound: 'boo' }, { phrase: '', sound: 'cheer' }] });
    expect(copy().tagName).toBe('DIV');
    fireEvent.focus(phrase(3));
    select('ario and mari');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'and', sound: 'boo' }, { phrase: '', sound: 'cheer' }] });
    select('Luigi waved');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'and', sound: 'boo' }, { phrase: 'Luigi waved', sound: 'cheer' }] });
  });

  test('2. with cue 1 typed and no other cue, a selection adds cue 2 and fills it; cue 1 keeps its words', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'laugh' }] });
    select('Luigi waved');
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'Luigi waved', sound: 'laugh' }] });
    expect(phrase(1)).toHaveValue('mario');
    expect(phrase(2)).toHaveValue('Luigi waved');
  });

  test('3. with five cues filled a selection changes nothing and the total\'s live region says so, until a cue is cleared or removed', () => {
    const five = ['mario', 'luigi', 'again', 'waved', 'met'].map((p) => ({ phrase: p, sound: 'laugh' }));
    const { onChange } = form({ cues: five });
    onChange.mockClear();
    select('Luigi waved');
    expect(onChange).not.toHaveBeenCalled();
    expect([1, 2, 3, 4, 5].map((n) => phrase(n).value)).toEqual(['mario', 'luigi', 'again', 'waved', 'met']);
    expect(total()).toHaveTextContent('All five cues are filled. Clear one to pick another phrase.');
    fireEvent.change(phrase(5), { target: { value: '' } });
    expect(total().textContent).not.toContain('All five');
    select('Luigi waved');
    expect(phrase(5)).toHaveValue('Luigi waved');
    select('waved at');
    expect(total()).toHaveTextContent('All five cues are filled.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 5' }));
    expect(total().textContent).not.toContain('All five');
  });

  test('4. "Add a cue" moves focus to the new cue\'s phrase', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Add a cue' }));
    expect(phrase(2)).toHaveFocus();
  });

  test('5. the markup: legend, hint, the post\'s words, a labeled field and quiet Remove and a sound choice for each cue, Add a cue beside the total', () => {
    form({ cues: [{ phrase: 'mario', sound: 'cheer' }, { phrase: 'luigi', sound: 'boo' }] });
    const fieldset = screen.getByRole('group', { name: 'Your audience\'s cues' });
    expect(fieldset.tagName).toBe('FIELDSET');
    expect(fieldset.querySelector('legend')).toHaveTextContent('Your audience\'s cues');
    expect(copy()).toHaveTextContent(BODY);
    expect(copy().closest('.kb-glass-cut-panel')).not.toBeNull();
    const remove = screen.getByRole('button', { name: 'Remove cue 2' });
    expect(remove).toHaveTextContent('Remove');
    expect(remove).toHaveAttribute('data-kb-kind', 'quiet');
    expect(remove).toHaveAttribute('data-kb-size', 's');
    expect(remove.closest('.kb-play-config-line')).toContainElement(screen.getByText('Cue 2'));
    expect(soundOf(1)).toBe('cheer');
    expect(soundOf(2)).toBe('boo');
    const add = screen.getByRole('button', { name: 'Add a cue' });
    expect(add).toHaveAttribute('data-kb-kind', 'secondary');
    expect(add).toHaveAttribute('data-kb-size', 's');
    expect(add.parentElement).toContainElement(total() as HTMLElement);
  });

  test('6. no element of the form has a class starting dw-lt-form and the form sets no font-family', () => {
    const { container } = form({ cues: [{ phrase: 'and', sound: 'laugh' }, { phrase: 'luigi', sound: 'boo' }] });
    for (const el of container.querySelectorAll('*')) {
      expect([...el.classList].filter((c) => c.startsWith('dw-lt-form'))).toEqual([]);
      expect((el as HTMLElement).style.fontFamily).toBe('');
    }
  });

  test('one polite live region for the total; the cues\' lines are plain text described by their input', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'boo' }] });
    expect(total().textContent).toBe('5 places in all (at most 30)');
    expect(phrase(2)).toHaveAccessibleDescription(/^Cues 2 places in this post\s*$/);
  });

  test('a phrase outside the rules\' bounds shows the bound in the rules\' words, and an empty one only a hint', () => {
    form({ cues: [{ phrase: '', sound: 'laugh' }, { phrase: 'and', sound: 'laugh' }, { phrase: `${'mario '.repeat(20)}`, sound: 'laugh' }] });
    expect(phrase(1)).toHaveAccessibleDescription(/^At least 4 letters or digits, matched as whole words in any case/);
    expect(phrase(2)).toHaveAccessibleDescription('The phrase has at least 4 letters or digits');
    expect(phrase(3)).toHaveAccessibleDescription('The phrase is at most 100 characters');
    expect(phrase(2)).toHaveAttribute('aria-invalid', 'true');
  });

  test('opening the form again with a config shows its cues', () => {
    form({ cues: [{ phrase: 'mario', sound: 'cheer' }, { phrase: 'luigi', sound: 'boo' }, { phrase: 'again', sound: 'laugh' }] });
    expect([1, 2, 3].map((n) => phrase(n).value)).toEqual(['mario', 'luigi', 'again']);
    expect([1, 2, 3].map(soundOf)).toEqual(['cheer', 'boo', 'laugh']);
  });

  test('removing the middle cue keeps the others and moves focus to the cue now at that place', () => {
    const { onChange } = form({ cues: [{ phrase: 'mario', sound: 'cheer' }, { phrase: 'luigi', sound: 'boo' }, { phrase: 'again', sound: 'laugh' }] });
    const button = screen.getByRole('button', { name: 'Remove cue 2' });
    button.focus();
    fireEvent.click(button);
    expect(onChange).toHaveBeenLastCalledWith({ cues: [{ phrase: 'mario', sound: 'cheer' }, { phrase: 'again', sound: 'laugh' }] });
    expect([1, 2].map((n) => phrase(n).value)).toEqual(['mario', 'again']);
    expect(phrase(2)).toHaveFocus();
  });

  test('removing the last cue focuses the new last cue\'s phrase', () => {
    form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: 'luigi', sound: 'laugh' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove cue 2' }));
    expect(phrase(1)).toHaveFocus();
  });

  test('a stale selection in the words never refills a cue the player is typing in', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }] });
    phrase(1).focus();
    fireEvent.change(phrase(1), { target: { value: 'typed' } });
    onChange.mockClear();
    select('Luigi waved');
    expect(onChange).not.toHaveBeenCalled();
    expect(phrase(1)).toHaveValue('typed');
  });

  test('a selection outside the words fills nothing; one inside fills the first empty cue', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }] });
    onChange.mockClear();
    select('Luigi waved', document.body);
    expect(onChange).not.toHaveBeenCalled();
    select('Luigi waved');
    expect(onChange).toHaveBeenCalledWith({ cues: [{ phrase: 'Luigi waved', sound: 'laugh' }] });
  });

  describe('one drag reports many selections', () => {
    const cuesOf = (n: number) => Array.from({ length: n }, (_, i) => phrase(i + 1).value);

    test('1. a drag reported as "Luigi" then "Luigi waved" fills one cue and adds none', () => {
      form({ cues: [{ phrase: '', sound: 'laugh' }] });
      select('Luigi');
      select('Luigi waved');
      expect(cuesOf(1)).toEqual(['Luigi waved']);
      expect(screen.getAllByLabelText(/^Cue \d$/)).toHaveLength(1);
    });

    test('2. a drag that shrinks leaves one cue with the shorter phrase', () => {
      form({ cues: [{ phrase: '', sound: 'laugh' }] });
      select('Luigi waved');
      select('Luigi');
      expect(cuesOf(1)).toEqual(['Luigi']);
      expect(screen.getAllByLabelText(/^Cue \d$/)).toHaveLength(1);
    });

    test('3. two distinct selections still fill two cues, the first kept', () => {
      form({ cues: [{ phrase: '', sound: 'laugh' }] });
      select('Mario');
      select('forums');
      select('Luigi');
      expect(cuesOf(2)).toEqual(['Mario', 'Luigi']);
    });

    test('4. after typing in the filled cue, a selection holding the old phrase fills the next cue, never that one', () => {
      form({ cues: [{ phrase: 'mario', sound: 'laugh' }, { phrase: '', sound: 'laugh' }, { phrase: '', sound: 'laugh' }] });
      select('Luigi');
      expect(cuesOf(3)).toEqual(['mario', 'Luigi', '']);
      fireEvent.change(phrase(2), { target: { value: 'Luigi!' } });
      select('Luigi waved');
      expect(cuesOf(3)).toEqual(['mario', 'Luigi!', 'Luigi waved']);
    });

    test('4b. after typing in the only filled cue with none empty, the selection adds a cue', () => {
      form({ cues: [{ phrase: '', sound: 'laugh' }] });
      select('Luigi');
      fireEvent.change(phrase(1), { target: { value: 'Luigi!' } });
      select('Luigi waved');
      expect(cuesOf(2)).toEqual(['Luigi!', 'Luigi waved']);
    });

    test('5. with five filled, growing the fifth\'s selection updates it quietly; a distinct sixth changes nothing and says so', () => {
      const four = ['mario', 'again', 'waved', 'met'].map((p) => ({ phrase: p, sound: 'laugh' }));
      const { onChange } = form({ cues: [...four, { phrase: '', sound: 'laugh' }] });
      select('Luigi');
      expect(phrase(5)).toHaveValue('Luigi');
      select('Luigi waved');
      expect(phrase(5)).toHaveValue('Luigi waved');
      expect(total().textContent).not.toContain('All five');
      onChange.mockClear();
      select('Mario');
      expect(onChange).not.toHaveBeenCalled();
      expect(cuesOf(5)).toEqual(['mario', 'again', 'waved', 'met', 'Luigi waved']);
      expect(total()).toHaveTextContent('All five cues are filled.');
    });
  });

  test('a selection of no whole word of the post fills nothing', () => {
    const { onChange } = form({ cues: [{ phrase: '', sound: 'laugh' }] });
    onChange.mockClear();
    select('zzz qqq');
    expect(onChange).not.toHaveBeenCalled();
  });
});
