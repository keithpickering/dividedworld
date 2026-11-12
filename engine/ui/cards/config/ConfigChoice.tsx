/**
 * A choice among a few options for a card's settings, as the play form's own segmented radios (`kb-play-choice`, PlayForm.tsx's "Play it now or
 * Set face down"): a fieldset whose legend is the label, native radios in `kb-play-choice-opt` labels whose span is the picture, filled with a
 * check and an inset ring when chosen (play.css), so the choice is never by color alone. The radios are the controls: the arrow keys move among
 * them and Tab leaves the group, as a browser does it. `hideLegend` keeps the legend for a reader and takes it from the eye, for a form whose
 * own label already says what the choice is.
 */
export interface ConfigChoiceOption<V extends string> { readonly value: V; readonly label: string }

export interface ConfigChoiceProps<V extends string> {
  /** The radios' group name; unique on the page. */
  readonly name: string;
  readonly label: string;
  readonly hideLegend?: boolean;
  readonly options: readonly ConfigChoiceOption<V>[];
  readonly value: V;
  readonly onChoose: (value: V) => void;
}

export function ConfigChoice<V extends string>({ name, label, hideLegend, options, value, onChoose }: ConfigChoiceProps<V>) {
  return (
    <fieldset className="kb-play-choice">
      <legend className={hideLegend ? 'kb-play-label kb-visually-hidden' : 'kb-play-label'}>{label}</legend>
      <div className="kb-play-choice-row kb-play-config-choice-row">
        {options.map((o) => (
          <label key={o.value} className="kb-play-choice-opt">
            <input type="radio" name={name} className="kb-visually-hidden" value={o.value} checked={value === o.value} onChange={() => onChoose(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
