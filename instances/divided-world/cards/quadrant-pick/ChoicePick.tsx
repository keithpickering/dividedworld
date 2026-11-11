/**
 * A choice among a few named options in a play form, as native radios in a wrapping row under a legend: the reactions a card names
 * (`QuadrantPick`) and the class an Off Day names are this. Native, so the arrow keys move between the options and Space chooses, with the
 * browser's own focus ring; the chosen option's label is outlined as well, so it is told from the others by more than the dot. Nothing is
 * chosen until the player chooses (`value` undefined), and the play form waits for it.
 */
import './choice-pick.css';

export interface ChoicePickProps {
  /** The group's name, which is its legend: what the choice is for. */
  readonly legend: string;
  /** Unique on the page, so two groups keep their choices apart. */
  readonly name: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** The value chosen now, or undefined before the player has chosen. */
  readonly value: string | undefined;
  readonly onChoose: (value: string) => void;
}

export function ChoicePick({ legend, name, options, value, onChoose }: ChoicePickProps) {
  return (
    <fieldset className="kb-choice-pick">
      <legend className="kb-choice-pick-legend">{legend}</legend>
      <div className="kb-choice-options">
        {options.map((o) => (
          <label key={o.value} className="kb-choice-option">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChoose(o.value)} />
            <span className="kb-choice-name">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
