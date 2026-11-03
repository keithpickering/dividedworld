/**
 * The rows of Settings › Accessibility that the welcome page's Before you start draws as well (theme, motion and text size), so both draw
 * one control and one sentence each, and a choice made on either is the same choice. Each row is a fieldset of skewed radios whose legend
 * is the row's label; what to do with a choice is the screen's (preferences.ts saves it).
 */
import { useId, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Preferences } from '../data/api.ts';
import './account.css';

export interface Option<V extends string | number> { readonly value: V; readonly label: string }

export const MOTION: readonly Option<Preferences['motion']>[] = [
  { value: 'system', label: 'Follow my device' },
  { value: 'reduce', label: 'Reduced' },
  { value: 'full', label: 'Full' },
];
export const TEXT_SIZE: readonly Option<Preferences['textSize']>[] = [100, 125, 150, 200].map((n) => ({ value: n as Preferences['textSize'], label: `${n}%` }));

/** A row of skewed choices, one radio each, as the board draws them; its fieldset's legend is the row's label. */
export function Choice<V extends string | number>({ legend, options, value, onChange, sentence, level = 3 }: {
  readonly legend: string; readonly options: readonly Option<V>[]; readonly value: V; readonly onChange: (v: V) => void; readonly sentence: ReactNode;
  /** The row label's heading level: 3 under Settings' sections, 4 where the row sits under an h3 (the welcome page's Before you start). */
  readonly level?: 3 | 4;
}) {
  const name = useId();
  const Label = level === 3 ? 'h3' : 'h4';
  /* The fieldset is the radio group and its legend names it, so the group is named once. */
  return (
    <fieldset className="kb-acct-row kb-acct-choice" role="radiogroup">
      <legend className="kb-acct-row-legend"><Label className="kb-acct-row-label">{legend}</Label></legend>
      <div className="kb-acct-row-body">
        <div className="kb-acct-seg">
          {options.map((o) => (
            <label key={o.value} className="kb-acct-seg-option">
              <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span className="kb-acct-seg-face kb-glass-skew"><b className="kb-glass-upright">{o.label}</b></span>
            </label>
          ))}
        </div>
        <p className="kb-acct-row-sentence">{sentence}</p>
      </div>
    </fieldset>
  );
}

type Level = { readonly level?: 3 | 4 };

export function MotionRow({ value, onChange, level }: { readonly value: Preferences['motion']; readonly onChange: (v: Preferences['motion']) => void } & Level) {
  const { ui } = useKayfa();
  return (
    <Choice legend="Motion" options={MOTION} value={value} onChange={onChange} level={level}
      sentence={`Reduced stops the drifting smoke, the pulses and the orb shine. A card's effect stays: ${ui.copy.reducedMotionCard}`} />
  );
}

export function TextSizeRow({ value, onChange, level }: { readonly value: Preferences['textSize']; readonly onChange: (v: Preferences['textSize']) => void } & Level) {
  return (
    <Choice legend="Text size" options={TEXT_SIZE} value={value} onChange={onChange} level={level}
      sentence="Applies to the board and the glass together. Past 150% the glass folds into one column, and nothing is cut off." />
  );
}

/** The board's colors: the device's, black on white, white on black, then the instance's own themes. An account's theme this instance does not offer is shown as the device's. */
export function ThemeRow({ value, onChange, legend = 'The board', level }: { readonly value: string; readonly onChange: (v: string) => void; readonly legend?: string } & Level) {
  const { ui } = useKayfa();
  const options: readonly Option<string>[] = [
    { value: 'system', label: 'Follow my device' },
    { value: 'light', label: 'Black on white' },
    { value: 'dark', label: 'White on black' },
    ...ui.themes.slice(1).map((t) => ({ value: t.key, label: t.name })),
  ];
  const shown = options.some((o) => o.value === value) ? value : 'system';
  return (
    <Choice legend={legend} options={options} value={shown} onChange={onChange} level={level}
      sentence="The 2003 board stays 2003 whichever you choose. Only its colors swap." />
  );
}
