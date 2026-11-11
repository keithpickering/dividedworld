/**
 * The headless search combobox (docs/plans/2026-11-07-search-design.md, sections 7 and 8): the querying, the debounce,
 * dropping a reply that comes after a newer keystroke, the keyboard and the ARIA. It draws nothing; a skin
 * (BoardCombobox, GlassCombobox) spreads `inputProps`, `listProps` and each row's `props` on its own elements.
 *
 * The source is the caller's: `(query, signal) => Promise<groups>`, so the banner's suggest (threads, characters,
 * boards), the Reveal overlay's thread field (threads only, `allowEmpty` for the newest) and a later characters-only
 * "Quote someone" picker all use this one hook. The engine names no data layer here.
 *
 * `trailing` is the row after every group that is not a suggestion: the banner's "Search posts for '...'". It is a
 * function of the query, so the caller words it, and it is chosen with a null group. Enter on nothing active chooses
 * it, even before the first reply, so a fast typist is never held for the list. It is not counted in the live line.
 *
 * Focus stays in the input throughout; the active row is named by `aria-activedescendant`. The query is the text
 * only; the hook holds no state a response is computed from beyond what the player typed.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

export interface ComboOption { readonly id: string; readonly label: string; readonly detail?: string }
export interface ComboGroup<O extends ComboOption = ComboOption> { readonly key: string; readonly label: string; readonly options: readonly O[]; /** Drawn under the head when there are no options; without it an empty group is dropped. */ readonly empty?: string }
export type ComboSource<O extends ComboOption = ComboOption> = (query: string, signal: AbortSignal) => Promise<readonly ComboGroup<O>[]>;

export interface UseSearchComboboxOptions<O extends ComboOption = ComboOption> {
  readonly source: ComboSource<O>;
  /** `groupKey` is null for the trailing row; `query` is the words typed (trimmed) when it was chosen. A chosen suggestion's label fills the box; the trailing row leaves it. */
  readonly onChoose: (option: O, groupKey: string | null, query: string) => void;
  readonly trailing?: (query: string) => O | null;
  /** The source answers an empty query (the Reveal field's newest threads): asked on focus, and on a cleared box. */
  readonly allowEmpty?: boolean;
  /** Characters before the source is asked, unless `allowEmpty` and the box is empty. Default 2. */
  readonly minChars?: number;
  readonly debounceMs?: number;
  readonly initialQuery?: string;
  /** The box's text after every change, a typed one or a chosen suggestion's label (a form that reads the box keeps its own copy from this). */
  readonly onQueryChange?: (query: string) => void;
}

export interface ComboRow<O extends ComboOption> {
  readonly option: O;
  readonly id: string;
  readonly active: boolean;
  readonly props: { readonly id: string; readonly role: 'option'; readonly 'aria-selected': boolean; readonly onClick: () => void; readonly onMouseMove: () => void };
}
export interface ComboViewGroup<O extends ComboOption> { readonly key: string; readonly label: string; readonly headingId: string; readonly empty: string | null; readonly rows: readonly ComboRow<O>[] }
export interface ComboView<O extends ComboOption = ComboOption> {
  readonly query: string;
  readonly open: boolean;
  /** The polite line: "5 suggestions", "1 suggestion", "No suggestions", or empty before an answer. */
  readonly liveText: string;
  /** True from a source's rejection until the next reply lands: a skin draws `SUGGESTIONS_FAILED` in its list where it would draw an empty one. */
  readonly failed: boolean;
  readonly inputProps: {
    readonly role: 'combobox';
    readonly value: string;
    readonly autoComplete: 'off';
    readonly 'aria-autocomplete': 'list';
    readonly 'aria-expanded': boolean;
    readonly 'aria-controls': string;
    readonly 'aria-activedescendant': string | undefined;
    readonly onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    readonly onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    readonly onFocus: () => void;
    readonly onBlur: () => void;
  };
  readonly listProps: { readonly id: string; readonly role: 'listbox'; readonly onMouseDown: (e: { preventDefault: () => void }) => void };
  readonly groups: readonly ComboViewGroup<O>[];
  readonly trailing: ComboRow<O> | null;
}

/** What a source's rejection says, in the live line and in the list, so a failed read is never told as "No suggestions". */
export const SUGGESTIONS_FAILED = "Suggestions couldn't be loaded.";

export function suggestionCount(n: number): string {
  return n === 0 ? 'No suggestions' : n === 1 ? '1 suggestion' : `${n} suggestions`;
}

export function useSearchCombobox<O extends ComboOption = ComboOption>(options: UseSearchComboboxOptions<O>): ComboView<O> {
  const { source, onChoose, trailing: trailingFor, allowEmpty = false, minChars = 2, debounceMs = 150, initialQuery = '', onQueryChange } = options;
  const base = useId();
  const [query, setQuery] = useState(initialQuery);
  const [groups, setGroups] = useState<readonly ComboGroup<O>[] | null>(null);
  const [active, setActive] = useState(-1);
  // True from a keystroke until that query's reply: the shown groups are the previous query's and cannot be chosen.
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flight = useRef<{ seq: number; abort: AbortController | null }>({ seq: 0, abort: null });
  // The caller's source and trailing change identity on every render; the latest is read at the moment it is used.
  const latest = useRef({ source, trailingFor, onChoose, onQueryChange });
  latest.current = { source, trailingFor, onChoose, onQueryChange };
  useEffect(() => { latest.current.onQueryChange?.(query); }, [query]);

  const eligible = useCallback((q: string) => q.trim().length >= minChars || (allowEmpty && q.trim() === ''), [minChars, allowEmpty]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    flight.current.seq += 1;
    flight.current.abort?.abort();
    flight.current.abort = null;
  }, []);

  const ask = useCallback((q: string) => {
    const mine = ++flight.current.seq;
    flight.current.abort?.abort();
    const abort = new AbortController();
    flight.current.abort = abort;
    let pending: Promise<readonly ComboGroup<O>[]>;
    try { pending = latest.current.source(q.trim(), abort.signal); } catch (err) { pending = Promise.reject(err); }
    pending.then(
      (reply) => {
        if (flight.current.seq !== mine) return;
        const kept = reply.filter((g) => g.options.length > 0 || g.empty);
        setGroups(kept);
        setFailed(false);
        setStale(false);
        setActive(-1);
        setLiveText(suggestionCount(kept.reduce((n, g) => n + g.options.length, 0)));
      },
      () => {
        if (flight.current.seq !== mine) return;
        setGroups([]);
        setFailed(true);
        setStale(false);
        setActive(-1);
        setLiveText(SUGGESTIONS_FAILED);
      },
    );
  }, []);

  const schedule = useCallback((q: string, wait: number) => {
    cancel();
    if (!eligible(q)) { setGroups(null); setFailed(false); setStale(false); setActive(-1); setLiveText(''); return; }
    if (wait <= 0) { ask(q); return; }
    timer.current = setTimeout(() => { timer.current = null; ask(q); }, wait);
  }, [cancel, eligible, ask]);

  useEffect(() => cancel, [cancel]);

  const trailingOption = useMemo(() => {
    if (!trailingFor || !eligible(query) || query.trim() === '') return null;
    return trailingFor(query.trim());
  }, [trailingFor, eligible, query]);

  const shown = useMemo(() => (groups ?? []), [groups]);
  const flat = useMemo(() => {
    const rows: Array<{ option: O; groupKey: string | null }> = [];
    if (!stale) for (const g of shown) for (const o of g.options) rows.push({ option: o, groupKey: g.key });
    if (trailingOption && groups !== null) rows.push({ option: trailingOption, groupKey: null });
    return rows;
  }, [shown, trailingOption, groups, stale]);

  const open = !dismissed && groups !== null && (flat.length > 0 || shown.length > 0 || failed);
  const listId = `${base}-list`;
  const rowId = (n: number) => `${base}-opt-${n}`;

  const choose = (n: number) => {
    const row = flat[n];
    if (!row) return;
    cancel();
    if (row.groupKey !== null) { setQuery(row.option.label); setGroups(null); setFailed(false); setStale(false); setLiveText(''); }
    setDismissed(true);
    setActive(-1);
    latest.current.onChoose(row.option, row.groupKey, query.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME composition owns its keys; the Enter that commits it is not a choice.
    if (e.nativeEvent.isComposing || e.key === 'Process' || e.keyCode === 229) return;
    const last = flat.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (flat.length === 0) return;
        if (!open) { setDismissed(false); setActive(0); return; }
        setActive(active >= last ? 0 : active + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (flat.length === 0) return;
        if (!open) { setDismissed(false); setActive(last); return; }
        setActive(active <= 0 ? last : active - 1);
        return;
      case 'Home':
        if (!open || active < 0) return;
        e.preventDefault();
        setActive(0);
        return;
      case 'End':
        if (!open || active < 0) return;
        e.preventDefault();
        setActive(last);
        return;
      case 'Enter': {
        if (open && active >= 0) { e.preventDefault(); choose(active); return; }
        // Nothing active: the trailing row, whether or not the list has answered yet.
        if (trailingOption) {
          e.preventDefault();
          cancel();
          setDismissed(true);
          latest.current.onChoose(trailingOption, null, query.trim());
        }
        return;
      }
      case 'Escape':
        /* A reply still on its way is dropped too, so it cannot open the list after Escape; with no list open, Escape goes on to the page (a dialog closes). */
        cancel();
        setDismissed(true);
        setActive(-1);
        if (open) e.preventDefault();
        return;
      default:
    }
  };

  const mkRow = (option: O, n: number): ComboRow<O> => ({
    option,
    id: rowId(n),
    active: open && n === active,
    props: {
      id: rowId(n),
      role: 'option',
      'aria-selected': open && n === active,
      onClick: () => choose(n),
      onMouseMove: () => { if (n !== active) setActive(n); },
    },
  });

  let n = 0;
  // Stale rows are drawn (no flicker) but inert: not in `flat`, so no index, no active, no choosing.
  const inertRow = (option: O, k: number): ComboRow<O> => ({
    option,
    id: `${base}-stale-${k}`,
    active: false,
    props: { id: `${base}-stale-${k}`, role: 'option', 'aria-selected': false, onClick: () => {}, onMouseMove: () => {} },
  });
  let k = 0;
  const viewGroups: ComboViewGroup<O>[] = shown.map((g, gi) => ({
    key: g.key,
    label: g.label,
    headingId: `${base}-group-${gi}`,
    empty: g.options.length === 0 ? (g.empty ?? null) : null,
    rows: g.options.map((o) => (stale ? inertRow(o, k++) : mkRow(o, n++))),
  }));
  const trailingRow = trailingOption && groups !== null ? mkRow(trailingOption, n) : null;

  return {
    query,
    open,
    liveText,
    failed,
    inputProps: {
      role: 'combobox',
      value: query,
      autoComplete: 'off',
      'aria-autocomplete': 'list',
      'aria-expanded': open,
      'aria-controls': listId,
      'aria-activedescendant': open && active >= 0 ? rowId(active) : undefined,
      onChange: (e) => {
        setQuery(e.target.value);
        setStale(true);
        setLiveText('');
        setDismissed(false);
        setActive(-1);
        schedule(e.target.value, debounceMs);
      },
      onKeyDown,
      onFocus: () => {
        if (allowEmpty && query.trim() === '' && groups === null) schedule('', 0);
        else setDismissed(false);
      },
      onBlur: () => { setDismissed(true); setActive(-1); },
    },
    listProps: { id: listId, role: 'listbox', onMouseDown: (e) => e.preventDefault() },
    groups: viewGroups,
    trailing: trailingRow,
  };
}
