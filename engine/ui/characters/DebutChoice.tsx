/**
 * How a character debuts: now or at the settlement, and how loud (silent, announced, announced
 * with its class), with the preview of what everyone will see. New character and a waiting
 * character's dialog share it. The preview shows a class only for the option that names it.
 */
import { useId } from 'react';
import type { DebutLoudness, DebutTiming } from '../data/api.ts';
import { PreviewBox } from './PreviewBox.tsx';
import { debutPreview } from './previews.ts';

export interface DebutChoiceProps {
  readonly name: string;
  /** The class's name, used in the preview only for "with its class". */
  readonly className: string;
  readonly timing: DebutTiming;
  readonly loudness: DebutLoudness;
  readonly onTiming?: (t: DebutTiming) => void;
  readonly onLoudness: (l: DebutLoudness) => void;
}

export function DebutChoice({ name, className, timing, loudness, onTiming, onLoudness }: DebutChoiceProps) {
  const [when, loud] = [useId(), useId()];
  const shown = name.trim() || 'Your character';
  return (
    <>
      {onTiming && (
        <fieldset className="kb-choice">
          <legend>When it debuts</legend>
          <label className="kb-choice-option">
            <input type="radio" name={when} checked={timing === 'now'} onChange={() => onTiming('now')} />
            <span><b>Drop now.</b> It is on the board at once, and can post at once.</span>
          </label>
          <label className="kb-choice-option">
            <input type="radio" name={when} checked={timing === 'tally'} onChange={() => onTiming('tally')} />
            <span><b>Debut at the settlement.</b> It waits, seen by no one but you, and debuts at the next settlement.</span>
          </label>
        </fieldset>
      )}
      <fieldset className="kb-choice">
        <legend>How loud</legend>
        <label className="kb-choice-option">
          <input type="radio" name={loud} checked={loudness === 'silent'} onChange={() => onLoudness('silent')} />
          <span><b>Silent.</b> Nobody is told. {timing === 'now' ? `${shown}'s first post is its entrance.` : `${shown} simply appears.`}</span>
        </label>
        <label className="kb-choice-option">
          <input type="radio" name={loud} checked={loudness === 'announced'} onChange={() => onLoudness('announced')} />
          <span><b>Announced.</b> The System posts that {shown} debuts, never as what.</span>
        </label>
        <label className="kb-choice-option">
          <input type="radio" name={loud} checked={loudness === 'with_class'} onChange={() => onLoudness('with_class')} />
          <span><b>Announced, with its class.</b> The System also says what class {shown} is, and that stays public. This can&apos;t be taken back.</span>
        </label>
      </fieldset>
      <PreviewBox preview={debutPreview({ name: shown, className, timing, loudness })} />
    </>
  );
}
