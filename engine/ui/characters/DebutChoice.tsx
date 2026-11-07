/**
 * How a character debuts: now or at the settlement, and how loud (silent, announced, announced
 * with its class), with the preview of what everyone will see. New character and a waiting
 * character's dialog share it. The preview shows a class only for the option that names it.
 * It draws its sections as the fragment's own children, so the form or dialog around it spaces
 * them, a section gap apart, as it does its other sections. How loud is one row of three (a stack
 * on the phone): characters.css.
 */
import { useId } from 'react';
import { words, type PronounSet } from '../../rules/pronouns.ts';
import type { DebutLoudness, DebutTiming } from '../data/api.ts';
import { PreviewBox } from './PreviewBox.tsx';
import { debutPreview } from './previews.ts';

export interface DebutChoiceProps {
  readonly name: string;
  /** The character's pronouns: the picker's live choice on New character, the stored set in the Debut dialog. */
  readonly pronouns: PronounSet;
  /** The class's name, used in the preview only for "with its class". */
  readonly className: string;
  readonly timing: DebutTiming;
  readonly loudness: DebutLoudness;
  readonly onTiming?: (t: DebutTiming) => void;
  readonly onLoudness: (l: DebutLoudness) => void;
}

export function DebutChoice({ name, pronouns, className, timing, loudness, onTiming, onLoudness }: DebutChoiceProps) {
  const [when, loud] = [useId(), useId()];
  const shown = name.trim() || 'Your character';
  const w = words(pronouns);
  return (
    <>
      {onTiming && (
        <fieldset className="kb-choice">
          <legend>When {w.they} debut{w.s}</legend>
          <label className="kb-choice-option">
            <input type="radio" name={when} checked={timing === 'now'} onChange={() => onTiming('now')} />
            <span><b>Drop now.</b> {w.They} {w.is} on the board at once, and can post at once.</span>
          </label>
          <label className="kb-choice-option">
            <input type="radio" name={when} checked={timing === 'tally'} onChange={() => onTiming('tally')} />
            <span><b>Debut at the settlement.</b> {w.They} wait{w.s}, seen by no one but you, and debut{w.s} at the next settlement.</span>
          </label>
        </fieldset>
      )}
      <fieldset className="kb-choice kb-choice-loud">
        <legend>How loud</legend>
        <label className="kb-choice-option">
          <input type="radio" name={loud} checked={loudness === 'silent'} onChange={() => onLoudness('silent')} />
          <span><b>Silent.</b> Nobody is told. {timing === 'now' ? `${shown}'s first post is ${w.their} entrance.` : `${shown} simply appears.`}</span>
        </label>
        <label className="kb-choice-option">
          <input type="radio" name={loud} checked={loudness === 'announced'} onChange={() => onLoudness('announced')} />
          <span><b>Announced.</b> The System posts that {shown} debuts, never as what.</span>
        </label>
        <label className="kb-choice-option">
          <input type="radio" name={loud} checked={loudness === 'with_class'} onChange={() => onLoudness('with_class')} />
          <span><b>Announced, with {w.their} class.</b> The System also says what class {shown} is, and that stays public. This can&apos;t be taken back.</span>
        </label>
      </fieldset>
      <PreviewBox preview={debutPreview({ name: shown, pronouns, className, timing, loudness })} />
    </>
  );
}
