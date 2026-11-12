/**
 * A labeled text field for a card's settings (docs/plans/2026-11-12-laugh-track-band-design.md, section 5), in the play form's own look: the
 * label's line (with an optional action beside it, such as a cue's Remove), the input (`kb-play-input`), its hint, and its refusal. The refusal
 * is a status line that is always drawn, so a reader hears it when it appears, and it marks the input invalid; it is also in words, so color is
 * never the only sign. The hint and the refusal both describe the input.
 *
 * The id is the input's; the hint is `${id}-hint` and the refusal `${id}-why`. Enter in the field is the form's, not this piece's: a card's form
 * decides what Enter does (setting a card spends orbs, so a form that must not submit on Enter says so on its own).
 */
import type { ChangeEvent, FocusEventHandler, KeyboardEventHandler, ReactNode, Ref } from 'react';
import './config.css';

export interface ConfigFieldProps {
  readonly id: string;
  readonly label: ReactNode;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Quiet words under the field: what it takes. */
  readonly hint?: ReactNode;
  /** A refusal, in plain words; none when the field is fine. */
  readonly why?: string;
  /** Drawn on the label's line, at its far end. */
  readonly action?: ReactNode;
  readonly maxLength?: number;
  readonly onFocus?: FocusEventHandler<HTMLInputElement>;
  readonly onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  readonly ref?: Ref<HTMLInputElement>;
}

export function ConfigField({ id, label, value, onChange, hint, why, action, maxLength, onFocus, onKeyDown, ref }: ConfigFieldProps) {
  const hintId = `${id}-hint`;
  const whyId = `${id}-why`;
  const refused = why !== undefined && why !== '';
  return (
    <div className="kb-play-config-field">
      <div className="kb-play-config-line">
        <label htmlFor={id} className="kb-play-label">{label}</label>
        {action}
      </div>
      <input
        id={id}
        ref={ref}
        type="text"
        className="kb-play-input"
        autoComplete="off"
        spellCheck={false}
        value={value}
        maxLength={maxLength}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        aria-describedby={`${hint !== undefined ? `${hintId} ` : ''}${whyId}`}
        aria-invalid={refused ? true : undefined}
      />
      {hint !== undefined && <p id={hintId} className="kb-play-fine">{hint}</p>}
      <p id={whyId} className="kb-play-why" role="status">{refused ? why : ''}</p>
    </div>
  );
}
