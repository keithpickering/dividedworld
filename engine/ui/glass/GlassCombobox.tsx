/**
 * The glass skin of the search combobox (docs/plans/2026-11-07-search-design.md, section 8): the Reveal overlay's
 * Thread field and any later glass picker (a quote, a card aimed at a post). Behavior is useSearchCombobox; this is a
 * `kb-glass-field` with a `kb-glass-input`, and a list in the glass tokens.
 */
import type { ReactNode } from 'react';
import { useSearchCombobox, type ComboOption, type ComboRow, type UseSearchComboboxOptions } from '../search/useSearchCombobox.ts';
import './glass-search.css';

export interface GlassComboboxProps<O extends ComboOption = ComboOption> extends UseSearchComboboxOptions<O> {
  /** The field's visible label. */
  readonly label: string;
  readonly placeholder?: string;
  readonly renderOption?: (option: O) => ReactNode;
}

function Row<O extends ComboOption>({ row, render }: { readonly row: ComboRow<O>; readonly render: (o: O) => ReactNode }) {
  return <div {...row.props} className="kb-glass-combo-row">{render(row.option)}</div>;
}

export function GlassCombobox<O extends ComboOption = ComboOption>({ label, placeholder, renderOption, ...hook }: GlassComboboxProps<O>) {
  const view = useSearchCombobox<O>(hook);
  const render = renderOption ?? ((o: O) => (<><span>{o.label}</span>{o.detail && <span className="kb-glass-combo-detail">{o.detail}</span>}</>));
  return (
    <div className="kb-glass-combo">
      <label className="kb-glass-field">
        <span>{label}</span>
        <input type="text" className="kb-glass-input" placeholder={placeholder} {...view.inputProps} />
      </label>
      {view.open && (
        <div className="kb-glass-combo-list" {...(view.groups.some((g) => g.rows.length > 0) || view.trailing ? { ...view.listProps, 'aria-label': label } : { id: view.listProps.id })}>
          {view.groups.map((g) => (
            <div key={g.key} role="group" aria-labelledby={g.headingId}>
              <div id={g.headingId} className="kb-glass-combo-head">{g.label}</div>
              {g.empty && <div className="kb-glass-combo-empty">{g.empty}</div>}
              {g.rows.map((r) => <Row key={r.id} row={r} render={render} />)}
            </div>
          ))}
          {view.trailing && <Row row={view.trailing} render={render} />}
        </div>
      )}
      <div className="kb-visually-hidden" role="status" aria-live="polite">{view.liveText}</div>
    </div>
  );
}
