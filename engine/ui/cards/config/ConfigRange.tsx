/**
 * A labeled range for a card's settings: a native `input[type=range]`, so the arrow keys, Home and End are the browser's, with the words for its
 * value in `aria-valuetext` (a reader says "4 posts, 40 orbs" and not "4"). It is at least 24px tall (config.css), so a thumb is a target.
 */
import type { ReactNode } from 'react';
import './config.css';

export interface ConfigRangeProps {
  readonly id: string;
  readonly label: ReactNode;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly value: number;
  /** The value in words, for a reader. */
  readonly valueText: string;
  readonly onChange: (value: number) => void;
}

export function ConfigRange({ id, label, min, max, step = 1, value, valueText, onChange }: ConfigRangeProps) {
  return (
    <div className="kb-play-config-field">
      <label htmlFor={id} className="kb-play-label">{label}</label>
      <input
        id={id}
        type="range"
        className="kb-play-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
