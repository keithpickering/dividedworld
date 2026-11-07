/**
 * The pronoun picker (docs/plans/2026-11-05-pronouns-design.md, section 7), on New character and Edit profile: the four presets and
 * Custom… as radio cards, drawn as the class cards are (a card per choice, the chosen one lit). Custom… opens five labeled
 * one-word fields, each with the they-set for a placeholder, each with its problem under it in the words `pronounProblems` gives,
 * and a pair of radios for how verbs agree. Under it a live preview, in the character's name, reads the chosen set in a sentence
 * (a polite live region, so a screen reader hears the change). The picker holds nothing but which card is lit; the set is the
 * parent's, and the parent refuses to save while `pronounFieldProblems` finds any.
 */
import { useId, useState } from 'react';
import { PRONOUN_PRESETS, normalizePronouns, pronounLabel, pronounProblems, presetOf, words, type PronounPreset, type PronounSet } from '../../rules/pronouns.ts';

export interface PronounPickerProps {
  /** The character's name, for the preview; blank reads "Your character". */
  readonly name: string;
  readonly value: PronounSet;
  readonly onChange: (set: PronounSet) => void;
}

type FormKey = 'subject' | 'object' | 'determiner' | 'possessive' | 'reflexive';

const FIELDS: readonly { readonly key: FormKey; readonly label: string }[] = [
  { key: 'subject', label: 'Subject' },
  { key: 'object', label: 'Object' },
  { key: 'determiner', label: 'Possessive adjective' },
  { key: 'possessive', label: 'Possessive' },
  { key: 'reflexive', label: 'Reflexive' },
];
const PRESET_ORDER: readonly PronounPreset[] = ['it', 'he', 'she', 'they'];
const BLANK: PronounSet = { subject: '', object: '', determiner: '', possessive: '', reflexive: '', plural: false };

/** The problems of a set (as it would be stored), by the field each belongs to; a field with none is absent. */
export function pronounFieldProblems(set: PronounSet): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of pronounProblems(normalizePronouns(set))) {
    const key = FIELDS.find((f) => p.startsWith(`the ${f.key} `) || p === `the pronouns have no ${f.key}`)?.key;
    if (key) (out[key] ??= []).push(p);
  }
  return out;
}

/** Whether a set may be saved. */
export const pronounsHold = (set: PronounSet): boolean => pronounProblems(normalizePronouns(set)).length === 0;

export function PronounPicker({ name, value, onChange }: PronounPickerProps) {
  const id = useId();
  const [custom, setCustom] = useState(() => presetOf(value) === null);
  const problems = pronounFieldProblems(value);
  const lit = custom ? 'custom' : presetOf(value);

  /* The preview never shows a half-typed form: a blank or refused one reads as the they-set's. */
  const shown = (() => {
    const t = PRONOUN_PRESETS.they;
    const pick = (k: FormKey) => (value[k].trim() !== '' && !problems[k] ? value[k].trim() : t[k]);
    return words({ subject: pick('subject'), object: pick('object'), determiner: pick('determiner'), possessive: pick('possessive'), reflexive: pick('reflexive'), plural: value.plural });
  })();
  const who = name.trim() || 'Your character';

  const card = (key: string, label: string, onPick: () => void) => (
    <label key={key} className="kb-pronoun-card" data-kb-chosen={lit === key || undefined}>
      <input type="radio" name={`${id}-set`} value={key} checked={lit === key} onChange={onPick} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="kb-pronouns">
      <fieldset className="kb-choice kb-pronoun-cards">
        <legend>Pronouns</legend>
        {PRESET_ORDER.map((k) => card(k, pronounLabel(PRONOUN_PRESETS[k]), () => { setCustom(false); onChange(PRONOUN_PRESETS[k]); }))}
        {card('custom', 'Custom…', () => { setCustom(true); if (presetOf(value) !== null) onChange(BLANK); })}
      </fieldset>
      {custom && (
        <div className="kb-pronoun-custom">
          {FIELDS.map((f) => {
            const mine = problems[f.key] ?? [];
            return (
              <div key={f.key} className="kb-pronoun-field">
                <label className="kb-glass-field">
                  <span>{f.label}</span>
                  <input
                    className="kb-glass-input" value={value[f.key]} placeholder={PRONOUN_PRESETS.they[f.key]}
                    autoComplete="off" autoCapitalize="none" spellCheck={false}
                    aria-invalid={mine.length > 0 || undefined} aria-describedby={mine.length > 0 ? `${id}-${f.key}-problem` : undefined}
                    onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
                  />
                </label>
                {mine.length > 0 && <p id={`${id}-${f.key}-problem`} className="kb-pronoun-problem">{mine.join('; ')}</p>}
              </div>
            );
          })}
          <fieldset className="kb-choice kb-pronoun-verbs">
            <legend>Verbs</legend>
            <label className="kb-choice-option">
              <input type="radio" name={`${id}-verbs`} checked={value.plural} onChange={() => onChange({ ...value, plural: true })} />
              <span>Verbs like <i>they are</i></span>
            </label>
            <label className="kb-choice-option">
              <input type="radio" name={`${id}-verbs`} checked={!value.plural} onChange={() => onChange({ ...value, plural: false })} />
              <span>Verbs like <i>it is</i></span>
            </label>
          </fieldset>
        </div>
      )}
      <p className="kb-pronoun-preview kb-roster-line" aria-live="polite">
        {who} posted. {shown.They} {shown.is} a Face. The card is {shown.theirs}; {shown.they} played it on {shown.their} own post {shown.themself}.
      </p>
    </div>
  );
}
