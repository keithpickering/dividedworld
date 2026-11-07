import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { axeViolations, describeViolations } from '../a11y.ts';
import { BoardCombobox } from './BoardCombobox.tsx';
import { GlassCombobox } from './GlassCombobox.tsx';
import type { ComboGroup, ComboOption } from './useSearchCombobox.ts';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const GROUPS: readonly ComboGroup[] = [
  { key: 'threads', label: 'Threads', options: [{ id: 't1', label: 'Wario Ware tier list', detail: 'General' }] },
  { key: 'characters', label: 'Characters', options: [{ id: 'c1', label: 'Waribob', detail: 'their posts' }] },
];
const source = async () => GROUPS;
const trailing = (q: string): ComboOption => ({ id: 'all', label: `Search posts for “${q}”`, detail: 'Enter' });

const skins = [
  ['board', (p: { onChoose: () => void }) => <BoardCombobox label="Search the boards" source={source} trailing={trailing} onChoose={p.onChoose} />],
  ['glass', (p: { onChoose: () => void }) => <div className="kb-glass"><GlassCombobox label="Thread" source={source} onChoose={p.onChoose} allowEmpty /></div>],
] as const;

describe.each(skins)('the %s skin', (name, draw) => {
  async function open() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChoose = vi.fn();
    const view = render(draw({ onChoose }));
    const box = screen.getByRole('combobox');
    await user.type(box, 'wari');
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    return { user, onChoose, view, box };
  }

  test('is named by its label, and lists grouped options with the group heads', async () => {
    const { box } = await open();
    expect(box).toHaveAccessibleName(name === 'board' ? 'Search the boards' : 'Thread');
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Threads' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Wario Ware tier list/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 suggestions');
  });

  test('keeps focus in the box while the arrows move', async () => {
    const { user, box } = await open();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('aria-activedescendant')).toBeTruthy();
  });

  test('is axe clean, open', async () => {
    const { view, user } = await open();
    await user.keyboard('{ArrowDown}');
    const found = await axeViolations(view.container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  test('is axe clean, closed', async () => {
    const view = render(draw({ onChoose: () => {} }));
    const found = await axeViolations(view.container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});

describe('the board skin', () => {
  test('shows the trailing row last and Enter chooses it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const onChoose = vi.fn();
    render(<BoardCombobox label="Search the boards" source={source} trailing={trailing} onChoose={onChoose} />);
    await user.type(screen.getByRole('combobox'), 'wari');
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    const options = screen.getAllByRole('option');
    expect(options.at(-1)).toHaveTextContent('Search posts for “wari”');
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'all' }), null);
  });
});

describe('the glass skin', () => {
  function Controlled() {
    const [chosen, setChosen] = useState('none');
    return (<div className="kb-glass"><GlassCombobox label="Thread" source={source} allowEmpty onChoose={(o) => setChosen(o.id)} /><p data-testid="chosen">{chosen}</p></div>);
  }

  test('with an empty query allowed, focus lists the newest and a click chooses', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    render(<Controlled />);
    await user.click(screen.getByRole('combobox'));
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    await user.click(screen.getByRole('option', { name: /Wario Ware tier list/ }));
    expect(screen.getByTestId('chosen')).toHaveTextContent('t1');
    expect(screen.getByRole('combobox')).toHaveValue('Wario Ware tier list');
  });

  test('sits in a kb-glass-field with a kb-glass-input', () => {
    const { container } = render(<div className="kb-glass"><GlassCombobox label="Thread" source={source} onChoose={() => {}} /></div>);
    expect(container.querySelector('label.kb-glass-field input.kb-glass-input')).not.toBeNull();
  });
});
