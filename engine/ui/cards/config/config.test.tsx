/**
 * The play form's pieces for a card's settings (docs/plans/2026-11-12-laugh-track-band-plan.md, Task 7; the design's section 5): a labeled
 * text field with its hint and refusal, a choice among a few options, a range, a hint line, and the post's words to select from. Each draws
 * the classes the play form already styles, so these tests read the markup and the behavior a card's form depends on, and the one
 * stylesheet line the range's reach depends on. None of them names a card.
 */
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useRef, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ConfigChoice } from './ConfigChoice.tsx';
import { ConfigField } from './ConfigField.tsx';
import { ConfigHint } from './ConfigHint.tsx';
import { ConfigRange } from './ConfigRange.tsx';
import { PostWords } from './PostWords.tsx';

afterEach(() => { window.getSelection()?.removeAllRanges(); });

describe('ConfigField', () => {
  test('a label for its input, whose hint and refusal describe it', () => {
    render(<ConfigField id="f" label="Phrase" value="" onChange={() => {}} hint="At least four letters." />);
    const input = screen.getByLabelText('Phrase');
    expect(input).toHaveClass('kb-play-input');
    const hint = screen.getByText('At least four letters.');
    expect(hint.tagName).toBe('P');
    expect(hint).toHaveClass('kb-play-fine');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(hint.id);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  test('describedBy names a line outside the field that also describes the input, beside its own hint and refusal', () => {
    render(<ConfigField id="f" label="Phrase" value="" onChange={() => {}} hint="At least four letters." describedBy="x y" />);
    const ids = screen.getByLabelText('Phrase').getAttribute('aria-describedby')?.split(' ');
    expect(ids).toEqual(expect.arrayContaining(['f-hint', 'f-why', 'x', 'y']));
  });

  test('a refusal is a status line that marks the input invalid and describes it', () => {
    render(<ConfigField id="f" label="Phrase" value="x" onChange={() => {}} why="That phrase is too short." />);
    const why = screen.getByText('That phrase is too short.');
    expect(why).toHaveClass('kb-play-why');
    expect(why).toHaveAttribute('role', 'status');
    const input = screen.getByLabelText('Phrase');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(why.id);
  });

  test('no refusal: the status line is still drawn, empty, and the stylesheet keeps it in the tree', () => {
    render(<ConfigField id="f" label="Phrase" value="" onChange={() => {}} />);
    const why = screen.getByRole('status');
    expect(why).toBeEmptyDOMElement();
    expect(screen.getByLabelText('Phrase').getAttribute('aria-describedby')?.split(' ')).toContain(why.id);
    const css = readFileSync('engine/ui/cards/config/config.css', 'utf8');
    const rule = /(?:^|[}/])\s*\.kb-play \.kb-play-config-field \.kb-play-why:empty\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/display:\s*none/u);
    expect(rule).toMatch(/clip-path:\s*inset\(50%\)/u);
  });

  test.each([[false], [null], ['']])('a hint of %j draws no hint and names none', (hint) => {
    const { container } = render(<ConfigField id="f" label="Phrase" value="" onChange={() => {}} hint={hint as never} />);
    expect(container.querySelector('#f-hint')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByLabelText('Phrase').getAttribute('aria-describedby')).toBe('f-why');
  });

  test('an action is drawn on the label\'s line', () => {
    render(<ConfigField id="f" label="Cue 1" value="" onChange={() => {}} action={<button type="button">Remove</button>} />);
    const label = screen.getByText('Cue 1');
    expect(label.parentElement).toBe(screen.getByRole('button', { name: 'Remove' }).parentElement);
  });

  test('the input takes a length bound, its value, change and focus, and a ref', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onFocus = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(<ConfigField id="f" label="Phrase" value="ab" maxLength={5} onChange={onChange} onFocus={onFocus} ref={ref} />);
    const input = screen.getByLabelText('Phrase');
    expect(input).toHaveValue('ab');
    expect(input).toHaveAttribute('maxlength', '5');
    expect(ref.current).toBe(input);
    await user.click(input);
    expect(onFocus).toHaveBeenCalled();
    await user.type(input, 'c');
    expect(onChange).toHaveBeenCalledWith('abc');
  });
});

describe('ConfigChoice', () => {
  const options = [{ value: 'laugh', label: 'Laugh' }, { value: 'cheer', label: 'Cheer' }, { value: 'boo', label: 'Boo' }] as const;

  test('a fieldset named by its legend, with native radios in the play form\'s options', () => {
    const { container } = render(<ConfigChoice name="s" label="Sound" options={options} value="cheer" onChoose={() => {}} />);
    const group = screen.getByRole('group', { name: 'Sound' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.querySelector('legend')).toHaveTextContent('Sound');
    expect(group.querySelector('legend')).not.toHaveClass('kb-visually-hidden');
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.closest('label'))).toSatisfy((l: (Element | null)[]) => l.every((e) => e?.classList.contains('kb-play-choice-opt')));
    expect(screen.getByRole('radio', { name: 'Cheer' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Laugh' })).not.toBeChecked();
    /* The checked one's span is the play form's filled half: it is the span the stylesheet's :has(input:checked) rule reaches. */
    expect(container.querySelector('label.kb-play-choice-opt:has(input:checked) span')).toHaveTextContent('Cheer');
  });

  test('hideLegend hides the legend from the eye and keeps it for a reader', () => {
    render(<ConfigChoice name="s" label="Sound for cue 1" hideLegend options={options} value="laugh" onChoose={() => {}} />);
    expect(screen.getByRole('group', { name: 'Sound for cue 1' }).querySelector('legend')).toHaveClass('kb-visually-hidden');
  });

  test('choosing calls onChoose with the value, and the arrow keys are the browser\'s own', async () => {
    const user = userEvent.setup();
    const chosen: string[] = [];
    function Host() {
      const [value, setValue] = useState('laugh');
      return <ConfigChoice name="s" label="Sound" options={options} value={value} onChoose={(v) => { chosen.push(v); setValue(v); }} />;
    }
    render(<Host />);
    await user.click(screen.getByText('Boo'));
    expect(chosen).toEqual(['boo']);
    expect(screen.getByRole('radio', { name: 'Boo' })).toBeChecked();
    screen.getByRole('radio', { name: 'Boo' }).focus();
    await user.keyboard('{ArrowUp}');
    expect(chosen).toEqual(['boo', 'cheer']);
  });
});

describe('ConfigRange', () => {
  test('a labeled range with its words as the value text', () => {
    const onChange = vi.fn();
    render(<ConfigRange id="r" label="How many" min={1} max={10} value={4} valueText="4 posts, 40 orbs" onChange={onChange} />);
    const range = screen.getByLabelText('How many');
    expect(range).toHaveAttribute('type', 'range');
    expect(range).toHaveAttribute('aria-valuetext', '4 posts, 40 orbs');
    expect(range).toHaveValue('4');
    fireEvent.change(range, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  test('at least 24px tall, in its stylesheet', () => {
    const css = readFileSync('engine/ui/cards/config/config.css', 'utf8');
    const rule = /\.kb-play-range\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    const height = Number(/(?:^|[\s;{])(?:min-)?height:\s*(\d+)px/u.exec(rule)?.[1] ?? 0);
    expect(height).toBeGreaterThanOrEqual(24);
  });

  test('the height guard does not count max-height or line-height', () => {
    const read = (rule: string) => Number(/(?:^|[\s;{])(?:min-)?height:\s*(\d+)px/u.exec(rule)?.[1] ?? 0);
    expect(read('max-height: 24px; line-height: 30px;')).toBe(0);
    expect(read('width: 100%; min-height: 24px;')).toBe(24);
  });
});

describe('ConfigHint', () => {
  test('a fine-print paragraph, a status only when live', () => {
    const { rerender } = render(<ConfigHint>Plain words.</ConfigHint>);
    const hint = screen.getByText('Plain words.');
    expect(hint.tagName).toBe('P');
    expect(hint).toHaveClass('kb-play-fine');
    expect(hint).not.toHaveAttribute('role');
    rerender(<ConfigHint live>Plain words.</ConfigHint>);
    expect(screen.getByRole('status')).toHaveTextContent('Plain words.');
  });
});

describe('PostWords', () => {
  const words = 'A fan game about forums and Mario.';

  /** Selects offsets of the post's words, as a pointer leaves them, and lets the page hear it. */
  function select(from: number, to: number) {
    const text = screen.getByRole('group', { name: "The post's words" }).firstChild!;
    const range = document.createRange();
    range.setStart(text, from);
    range.setEnd(text, to);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
  }

  test('draws the words in the cut panel, in the tab order, named', () => {
    const { container } = render(<PostWords words={words} onSelect={() => {}} />);
    const post = screen.getByRole('group', { name: "The post's words" });
    expect(post).toHaveClass('kb-play-post');
    expect(post.tagName).toBe('DIV');
    expect(post).toHaveTextContent(words);
    expect(post).toHaveAttribute('tabindex', '0');
    expect(post.parentElement).toHaveClass('kb-play-post-frame', 'kb-glass-cut-panel');
    expect(container.querySelector('[data-kb-post-words]')).toBe(post);
  });

  test('a selection wholly inside calls onSelect with its text', () => {
    const onSelect = vi.fn();
    const onSpill = vi.fn();
    render(<PostWords words={words} onSelect={onSelect} onSpill={onSpill} />);
    select(2, 10);
    expect(onSelect).toHaveBeenCalledWith('fan game');
    expect(onSpill).not.toHaveBeenCalledWith(true);
  });

  test('a selection that crosses its edge calls onSpill(true) and never onSelect', () => {
    const onSelect = vi.fn();
    const onSpill = vi.fn();
    render(<><p id="out">Outside words</p><PostWords words={words} onSelect={onSelect} onSpill={onSpill} /></>);
    const text = screen.getByRole('group', { name: "The post's words" }).firstChild!;
    const range = document.createRange();
    range.setStart(document.getElementById('out')!.firstChild!, 3);
    range.setEnd(text, 6);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(onSpill).toHaveBeenCalledWith(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('a selection elsewhere, or a collapsed one, calls neither', () => {
    const onSelect = vi.fn();
    const onSpill = vi.fn();
    render(<><p id="out">Outside words</p><PostWords words={words} onSelect={onSelect} onSpill={onSpill} /></>);
    const range = document.createRange();
    range.setStart(document.getElementById('out')!.firstChild!, 0);
    range.setEnd(document.getElementById('out')!.firstChild!, 7);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    select(4, 4);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSpill).not.toHaveBeenCalled();
  });

  test.each([
    ['a field', <input key="x" aria-label="Phrase" />],
    ['a radio', <input key="x" type="radio" aria-label="Boo" />],
    ['a button', <button key="x" type="button">Add</button>],
  ])('a selection left standing while focus is in %s of the form calls neither', (_name, control) => {
    const onSelect = vi.fn();
    const onSpill = vi.fn();
    function Host() {
      const form = useRef<HTMLFieldSetElement>(null);
      return <fieldset ref={form}>{control}<PostWords words={words} onSelect={onSelect} onSpill={onSpill} within={form} /></fieldset>;
    }
    render(<Host />);
    const focus = screen.getByRole(control.type === 'button' ? 'button' : control.props.type === 'radio' ? 'radio' : 'textbox');
    focus.focus();
    select(2, 10);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSpill).not.toHaveBeenCalled();
  });

  test('after unmount, a selection change calls nothing', () => {
    const onSelect = vi.fn();
    const onSpill = vi.fn();
    const { unmount } = render(<PostWords words={words} onSelect={onSelect} onSpill={onSpill} />);
    const text = screen.getByRole('group', { name: "The post's words" }).firstChild!;
    unmount();
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 10);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onSpill).not.toHaveBeenCalled();
  });

  test('after a rerender with a new onSelect, the new one is called and the old one is not', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<PostWords words={words} onSelect={first} />);
    rerender(<PostWords words={words} onSelect={second} />);
    select(2, 10);
    expect(second).toHaveBeenCalledWith('fan game');
    expect(first).not.toHaveBeenCalled();
  });

  test('two on one page: a selection wholly inside one reaches only that one', () => {
    const a = vi.fn();
    const b = vi.fn();
    const spillB = vi.fn();
    render(<><div aria-label="A words"><PostWords words="Alpha words here" onSelect={a} /></div><PostWords words="Beta words there" onSelect={b} onSpill={spillB} /></>);
    const [viewA] = screen.getAllByRole('group', { name: "The post's words" });
    const range = document.createRange();
    range.setStart(viewA!.firstChild!, 0);
    range.setEnd(viewA!.firstChild!, 5);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(a).toHaveBeenCalledWith('Alpha');
    expect(b).not.toHaveBeenCalled();
    expect(spillB).not.toHaveBeenCalled();
  });

  test('a selection that starts inside the words and ends outside spills', () => {
    const onSelect = vi.fn();
    const onSpill = vi.fn();
    render(<><PostWords words={words} onSelect={onSelect} onSpill={onSpill} /><p id="after">After words</p></>);
    const text = screen.getByRole('group', { name: "The post's words" }).firstChild!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(document.getElementById('after')!.firstChild!, 5);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
    expect(onSpill).toHaveBeenCalledWith(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('with focus on the words themselves, a selection is taken', () => {
    const onSelect = vi.fn();
    function Host() {
      const form = useRef<HTMLFieldSetElement>(null);
      return <fieldset ref={form}><PostWords words={words} onSelect={onSelect} within={form} /></fieldset>;
    }
    render(<Host />);
    screen.getByRole('group', { name: "The post's words" }).focus();
    select(2, 10);
    expect(onSelect).toHaveBeenCalledWith('fan game');
  });
});
