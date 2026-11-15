/**
 * THIS's settings in the play form (docs/plans/2026-11-13-this-plan.md, Task 6): the post's words to select from, the phrase and its hint by
 * its count in the post, the words after THIS with their count, and the note as it will read.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { axeViolations } from '../../../../engine/ui/a11y.ts';
import type { Act } from '../../../../engine/ui/data/api.ts';
import { RouterProvider } from '../../../../engine/ui/router.tsx';
import { ConfigForm } from './ConfigForm.tsx';

const post = (body: string) => ({ id: 'p', currentPayload: { body } }) as unknown as Act;
const BODY = 'The same old story, the same old song. Somebody said it again.';
const form = (config: Record<string, unknown> | undefined, body = BODY) => {
  const onChange = vi.fn();
  return { onChange, ...render(<RouterProvider><ConfigForm config={config} onChange={onChange} post={post(body)} id="play" faceDown="no" /></RouterProvider>) };
};
const copy = () => screen.getByRole('group', { name: 'The post\'s words' });
const select = (text: string) => {
  fireEvent.pointerDown(copy());
  vi.spyOn(document, 'getSelection').mockReturnValue({
    toString: () => text, isCollapsed: text === '', rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: copy().firstChild ?? copy(), toString: () => text, intersectsNode: () => false }),
  } as unknown as Selection);
  fireEvent(document, new Event('selectionchange'));
};
const phrase = () => screen.getByLabelText('Phrase to point at') as HTMLInputElement;
const words = () => screen.getByLabelText('After THIS (optional)') as HTMLInputElement;
/* The field's description joins its (empty) refusal and its hint with a space, so the line is read with white space around it. */
const described = (line: string) => new RegExp(`^\\s*${line.replace(/\./g, '\\.')}\\s*$`);
const type = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('THIS\'s play form', () => {
  test('a selection in the post fills the phrase as whole words, cutting a word the selection left short', () => {
    const { onChange } = form(undefined);
    select('story, the same old song.');
    expect(phrase().value).toBe('story, the same old song.');
    select('he same old sto');
    expect(phrase().value).toBe('same old');
    expect(onChange).toHaveBeenLastCalledWith({ phrase: 'same old', words: '' });
  });

  test('a phrase in the post once says THIS will point at it', () => {
    form({ phrase: 'somebody said', words: '' });
    const line = 'THIS will point at these words.';
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(phrase()).toHaveAccessibleDescription(described(line));
  });

  test('a phrase in the post more than once says how many times and which THIS points at', () => {
    form({ phrase: 'the same old', words: '' });
    const line = 'These words are in the post 2 times. THIS points at the first. Select more words to point at another.';
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(phrase()).toHaveAccessibleDescription(described(line));
  });

  test('a phrase not in the post says so', () => {
    form({ phrase: 'nowhere to be found', words: '' });
    const line = 'These words are not in this post\'s own words.';
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(phrase()).toHaveAccessibleDescription(described(line));
  });

  test('a phrase out of bounds shows the rules\' own words and marks the field invalid', () => {
    form({ phrase: 'abc', words: '' });
    expect(phrase()).toHaveAttribute('aria-invalid', 'true');
    expect(phrase()).toHaveAccessibleDescription(/least 4 letters or digits/i);
    expect(phrase()).toHaveAttribute('maxlength', '100');
    cleanup();
    form({ phrase: 'the same old', words: '' });
    expect(phrase()).not.toHaveAttribute('aria-invalid');
  });

  test('the count follows the words, and 60 emoji read 60 / 60', () => {
    form({ phrase: 'the same old', words: '' });
    /* The field bounds itself by characters, as the rules count them; an input's own maxlength counts UTF-16 units and would stop at 30 emoji. */
    expect(words()).not.toHaveAttribute('maxlength');
    expect(screen.getByText('0 / 60')).toBeInTheDocument();
    type(words(), 'again');
    expect(screen.getByText('5 / 60')).toBeInTheDocument();
    type(words(), '😀'.repeat(60));
    expect(screen.getByText('60 / 60')).toBeInTheDocument();
  });

  test('the words field stops at 60 characters, counted as the rules count them: what is typed or pasted past them is cut, and no emoji is split', () => {
    const { onChange } = form({ phrase: 'the same old', words: '' });
    type(words(), '😀'.repeat(61));
    expect(words().value).toBe('😀'.repeat(60));
    expect(screen.getByText('60 / 60')).toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ phrase: 'the same old', words: '😀'.repeat(60) });
    type(words(), `${'a'.repeat(59)}😀b`);
    expect(words().value).toBe(`${'a'.repeat(59)}😀`);
    type(words(), 'a'.repeat(75));
    expect(words().value).toBe('a'.repeat(60));
    expect(onChange).toHaveBeenLastCalledWith({ phrase: 'the same old', words: 'a'.repeat(60) });
  });

  test('the count is spoken politely and seldom: not on every key, but as the words near the limit and fill it', () => {
    form({ phrase: 'the same old', words: '' });
    const said = () => document.querySelector('[data-kb-count-said]')!;
    expect(said()).toHaveAttribute('aria-live', 'polite');
    type(words(), 'again');
    expect(said().textContent).toBe('');
    type(words(), 'a'.repeat(40));
    expect(said().textContent).toBe('20 characters left.');
    type(words(), 'a'.repeat(60));
    expect(said().textContent).toMatch(/^60 of 60 characters: the words are full\./);
    type(words(), 'a');
    expect(said().textContent).toBe('');
  });

  test('the same message said again is a change a screen reader hears: every other one ends in a no-break space', () => {
    form({ phrase: 'the same old', words: '' });
    const said = () => document.querySelector('[data-kb-count-said]')!;
    type(words(), 'a'.repeat(60));
    const first = said().textContent;
    type(words(), 'a'.repeat(55));
    type(words(), 'a'.repeat(60));
    const second = said().textContent;
    expect(second).not.toBe(first);
    expect(second!.endsWith('\u00a0')).toBe(true);
    type(words(), 'a'.repeat(55));
    type(words(), 'a'.repeat(60));
    expect(said().textContent).toBe(first);
  });

  test('a drop from full into the band under the limit takes back what was said, and typing on in the band says nothing new', () => {
    form({ phrase: 'the same old', words: '' });
    const said = () => document.querySelector('[data-kb-count-said]')!;
    type(words(), 'a'.repeat(60));
    expect(said().textContent).toMatch(/words are full/);
    type(words(), 'a'.repeat(55));
    expect(said().textContent).toBe('');
    type(words(), 'a'.repeat(30));
    /* As the play form does: inside the band the count stays as last said (a stale "20 characters left." while the player types on), and is not repeated. */
    type(words(), 'a'.repeat(40));
    expect(said().textContent!.replace(/\u00a0$/, '')).toBe('20 characters left.');
    type(words(), 'a'.repeat(41));
    type(words(), 'a'.repeat(59));
    expect(said().textContent!.replace(/\u00a0$/, '')).toBe('20 characters left.');
    type(words(), 'a'.repeat(39));
    expect(said().textContent).toBe('');
  });

  test('the form reports the trimmed pair on every change', () => {
    const { onChange } = form(undefined);
    type(phrase(), '  the same old ');
    expect(onChange).toHaveBeenLastCalledWith({ phrase: 'the same old', words: '' });
    type(words(), '  again  ');
    expect(onChange).toHaveBeenLastCalledWith({ phrase: 'the same old', words: 'again' });
    expect(phrase().value).toBe('  the same old ');
  });

  test('the preview line reads the note in plain type, THIS alone when there are no words', () => {
    form({ phrase: 'the same old', words: '' });
    expect(screen.getByText('THIS', { selector: '[data-this-note]' })).toBeInTheDocument();
    type(words(), ' finally somebody said it ');
    expect(screen.getByText('THIS finally somebody said it', { selector: '[data-this-note]' })).toBeInTheDocument();
  });

  test('it passes the accessibility check, with a refusal showing too', async () => {
    const { container } = form({ phrase: 'the same old', words: 'again' });
    expect(await axeViolations(container)).toEqual([]);
    cleanup();
    const bad = form({ phrase: 'abc', words: '' });
    expect(await axeViolations(bad.container)).toEqual([]);
  });
});
