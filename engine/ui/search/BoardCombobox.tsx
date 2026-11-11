/**
 * The board skin of the search combobox (docs/plans/2026-11-07-search-design.md, section 7): the banner's box and the
 * `/search` keyword field. All behavior is useSearchCombobox; this draws it as the board draws things, group heads
 * as a bar, a row's detail muted at its right, the active row ringed (the ring is an outline, never color alone).
 */
import type { ReactNode } from 'react';
import { SUGGESTIONS_FAILED, useSearchCombobox, type ComboOption, type ComboRow, type UseSearchComboboxOptions } from './useSearchCombobox.ts';
import './board-search.css';

export interface BoardComboboxProps<O extends ComboOption = ComboOption> extends UseSearchComboboxOptions<O> {
  /** The box's accessible name; drawn visually hidden, as the banner has no room for it, unless `showLabel` (a form's own field). */
  readonly label: string;
  readonly showLabel?: boolean;
  readonly placeholder?: string;
  readonly inputId?: string;
  /** What a row holds. Default: the label and, muted at the right, the detail. */
  readonly renderOption?: (option: O) => ReactNode;
}

function Row<O extends ComboOption>({ row, render, extra }: { readonly row: ComboRow<O>; readonly render: (o: O) => ReactNode; readonly extra?: string }) {
  return (
    <div {...row.props} className={`kb-search-row${extra ? ` ${extra}` : ''}`}>
      {render(row.option)}
    </div>
  );
}

export function BoardCombobox<O extends ComboOption = ComboOption>({ label, showLabel = false, placeholder, inputId, renderOption, ...hook }: BoardComboboxProps<O>) {
  const view = useSearchCombobox<O>(hook);
  const render = renderOption ?? ((o: O) => (<><span>{o.label}</span>{o.detail && <span className="kb-search-detail">{o.detail}</span>}</>));
  return (
    <div className="kb-search-combo">
      <label className={showLabel ? 'kb-search-label' : 'kb-visually-hidden'} htmlFor={inputId ?? `${view.listProps.id}-input`}>{label}</label>
      <input id={inputId ?? `${view.listProps.id}-input`} type="text" className="kb-input kb-search-input" placeholder={placeholder} {...view.inputProps} />
      {view.open && (
        <div className="kb-search-list" {...(view.groups.some((g) => g.rows.length > 0) || view.trailing ? { ...view.listProps, 'aria-label': label } : { id: view.listProps.id })}>
          {view.groups.map((g) => (
            <div key={g.key} role="group" aria-labelledby={g.headingId}>
              <div id={g.headingId} className="kb-search-head">{g.label}</div>
              {g.empty && <div className="kb-search-empty">{g.empty}</div>}
              {g.rows.map((r) => <Row key={r.id} row={r} render={render} />)}
            </div>
          ))}
          {view.failed && <div className="kb-search-empty">{SUGGESTIONS_FAILED}</div>}
          {view.trailing && <Row row={view.trailing} render={render} extra="kb-search-all" />}
        </div>
      )}
      <div className="kb-visually-hidden" role="status" aria-live="polite">{view.liveText}</div>
    </div>
  );
}
