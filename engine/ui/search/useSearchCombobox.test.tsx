import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useSearchCombobox, type ComboGroup, type ComboOption, type UseSearchComboboxOptions } from './useSearchCombobox.ts';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const GROUPS: readonly ComboGroup[] = [
  { key: 'threads', label: 'Threads', options: [{ id: 't1', label: 'Wario Ware tier list', detail: 'General' }, { id: 't2', label: "who is wario's alt" }] },
  { key: 'characters', label: 'Characters', options: [{ id: 'c1', label: 'Waribob' }] },
];
const TRAILING = (q: string): ComboOption => ({ id: 'all', label: `Search posts for “${q}”` });

/** A bare skin: the hook's own props on plain elements, so the test reads the hook and nothing else. */
function Harness(props: Partial<UseSearchComboboxOptions> & { readonly source: UseSearchComboboxOptions['source'] }) {
  const view = useSearchCombobox({ onChoose: () => {}, ...props });
  return (
    <div>
      <label htmlFor="q">Find</label>
      <input id="q" {...view.inputProps} />
      {view.open && (
        <div aria-label="Suggestions" {...view.listProps}>
          {view.groups.map((g) => (
            <div key={g.key} role="group" aria-labelledby={g.headingId}>
              <div id={g.headingId}>{g.label}</div>
              {g.rows.map((r) => <div key={r.id} {...r.props}>{r.option.label}</div>)}
            </div>
          ))}
          {view.trailing && <div {...view.trailing.props}>{view.trailing.option.label}</div>}
        </div>
      )}
      <div role="status" aria-live="polite">{view.liveText}</div>
    </div>
  );
}

const box = () => screen.getByRole('combobox');
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(150); });
function setup(extra: Partial<UseSearchComboboxOptions> = {}, source: UseSearchComboboxOptions['source'] = vi.fn(async () => GROUPS), exact = false) {
  // `exact`: the clock moves only when the test moves it (no typing, which needs real time to pass).
  vi.useFakeTimers({ shouldAdvanceTime: !exact });
  const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
  const onChoose = vi.fn();
  render(<Harness source={source} onChoose={onChoose} trailing={TRAILING} {...extra} />);
  return { user, source, onChoose };
}

describe('the debounce and the minimum', () => {
  test('asks 150 ms after the last keystroke, once, with the whole query', async () => {
    const { source } = setup({}, vi.fn(async () => GROUPS), true);
    // fireEvent, not typing: no real time passes between the keystroke and the first assertion.
    fireEvent.change(box(), { target: { value: 'wa' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    fireEvent.change(box(), { target: { value: 'wari' } });
    expect(source).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(149); });
    expect(source).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(source).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledWith('wari', expect.anything());
  });

  test('asks nothing under two characters, and says nothing', async () => {
    const { user, source } = setup();
    await user.type(box(), 'w');
    await settle();
    expect(source).not.toHaveBeenCalled();
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  test('a source that allows an empty query is asked on focus, and lists its newest', async () => {
    const { user, source } = setup({ allowEmpty: true, trailing: undefined });
    await user.click(box());
    await settle();
    expect(source).toHaveBeenCalledWith('', expect.anything());
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  test('a reply that comes after a newer keystroke is dropped', async () => {
    const replies: Array<(g: readonly ComboGroup[]) => void> = [];
    const source = vi.fn(() => new Promise<readonly ComboGroup[]>((res) => { replies.push(res); }));
    const { user } = setup({}, source);
    await user.type(box(), 'wa');
    await settle();
    await user.type(box(), 'r');
    await settle();
    expect(replies).toHaveLength(2);
    await act(async () => { replies[1]?.([{ key: 'b', label: 'Boards', options: [{ id: 'new', label: 'newer answer' }] }]); });
    await act(async () => { replies[0]?.([{ key: 'a', label: 'Boards', options: [{ id: 'old', label: 'older answer' }] }]); });
    expect(screen.getByText('newer answer')).toBeInTheDocument();
    expect(screen.queryByText('older answer')).toBeNull();
  });

  test('a source that throws leaves no suggestions and no crash', async () => {
    const { user } = setup({}, vi.fn(async () => { throw new Error('down'); }));
    await user.type(box(), 'wari');
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('No suggestions');
  });
});

describe('the ARIA', () => {
  test('a combobox that names its list, expands, and groups the options under labeled groups', async () => {
    const { user } = setup();
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(box()).toHaveAttribute('aria-autocomplete', 'list');
    await user.type(box(), 'wari');
    await settle();
    const list = screen.getByRole('listbox', { name: 'Suggestions' });
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(box()).toHaveAttribute('aria-controls', list.id);
    expect(screen.getByRole('group', { name: 'Threads' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Characters' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(box()).not.toHaveAttribute('aria-activedescendant');
  });

  test('the live line counts the suggestions, not the trailing row', async () => {
    const { user } = setup();
    await user.type(box(), 'wari');
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('3 suggestions');
  });

  test('one suggestion is singular, none is said', async () => {
    const { user } = setup({}, vi.fn(async () => [{ key: 'x', label: 'X', options: [{ id: '1', label: 'only' }] }]));
    await user.type(box(), 'on');
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent(/^1 suggestion$/);
    cleanup();
    const again = setup({}, vi.fn(async () => []));
    await again.user.type(box(), 'zz');
    await settle();
    expect(screen.getByRole('status')).toHaveTextContent('No suggestions');
  });
});

describe('the keys', () => {
  async function opened(extra: Partial<UseSearchComboboxOptions> = {}) {
    const s = setup(extra);
    await s.user.type(box(), 'wari');
    await settle();
    return s;
  }
  const activeText = () => {
    const id = box().getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.textContent : null;
  };

  test('ArrowDown walks the options in order, across groups, to the trailing row, and wraps', async () => {
    const { user } = await opened();
    const seen: Array<string | null | undefined> = [];
    for (let i = 0; i < 5; i++) { await user.keyboard('{ArrowDown}'); seen.push(activeText()); }
    expect(seen).toEqual(['Wario Ware tier list', "who is wario's alt", 'Waribob', 'Search posts for “wari”', 'Wario Ware tier list']);
    expect(document.activeElement).toBe(box());
  });

  test('ArrowUp from nothing lands on the last row, and walks back', async () => {
    const { user } = await opened();
    await user.keyboard('{ArrowUp}');
    expect(activeText()).toBe('Search posts for “wari”');
    await user.keyboard('{ArrowUp}');
    expect(activeText()).toBe('Waribob');
  });

  test('Home and End go to the first and the last row', async () => {
    const { user } = await opened();
    await user.keyboard('{End}');
    expect(activeText()).toBe('Search posts for “wari”');
    await user.keyboard('{Home}');
    expect(activeText()).toBe('Wario Ware tier list');
  });

  test('the active option says aria-selected, and only it', async () => {
    const { user } = await opened();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const selected = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected.map((o) => o.textContent)).toEqual(["who is wario's alt"]);
  });

  test('Enter on an active option chooses it with its group, fills the box and closes', async () => {
    const { user, onChoose } = await opened();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 'characters');
    expect(box()).toHaveValue('Waribob');
    expect(box()).toHaveAttribute('aria-expanded', 'false');
  });

  test('Enter on nothing active chooses the trailing row, with no group, and leaves the query alone', async () => {
    const { user, onChoose } = await opened();
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'all' }), null);
    expect(box()).toHaveValue('wari');
  });

  test('Enter before the first reply still goes to the trailing row', async () => {
    const { user, onChoose } = setup();
    await user.type(box(), 'wa{Enter}');
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'all', label: 'Search posts for “wa”' }), null);
  });

  test('Enter with no trailing row and nothing active chooses nothing', async () => {
    const { user, onChoose } = await opened({ trailing: undefined });
    await user.keyboard('{Enter}');
    expect(onChoose).not.toHaveBeenCalled();
  });

  test('Escape closes the list, keeps the text, and the next ArrowDown opens it again', async () => {
    const { user } = await opened();
    await user.keyboard('{ArrowDown}{Escape}');
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
    expect(box()).toHaveValue('wari');
    await user.keyboard('{ArrowDown}');
    expect(box()).toHaveAttribute('aria-expanded', 'true');
  });

  test('a click on an option chooses it', async () => {
    const { user, onChoose } = await opened();
    await user.click(screen.getByRole('option', { name: 'Waribob' }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 'characters');
  });

  test('typing again clears the active option', async () => {
    const { user } = await opened();
    await user.keyboard('{ArrowDown}b');
    await settle();
    expect(box()).not.toHaveAttribute('aria-activedescendant');
  });
});

beforeEach(() => { /* each test sets up its own timers */ });
