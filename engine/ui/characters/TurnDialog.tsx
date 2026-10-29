/**
 * The Turn, a modal: the class to Turn to, how loud, and the preview of what everyone will see. A
 * Turn takes effect at the next settlement; until then it can be changed (this dialog again, its
 * choices filled in) or withdrawn. Asking again before then is the same Turn, changed. Out of
 * character and plain: the class is the player's own, and the preview names a class only where the
 * player chose to name it.
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { MyCharacter } from '../data/api.ts';
import { Modal } from '../modal.tsx';
import { usePlayer } from '../player.tsx';
import { shortDate } from '../postbit/dates.ts';
import { ClassCards } from './ClassCards.tsx';
import { dayAndTime, spanWords, withArticle } from './format.ts';
import { PreviewBox } from './PreviewBox.tsx';
import { turnPreview } from './previews.ts';

export interface TurnDialogProps {
  readonly character: MyCharacter;
  /** The settlement's time, where it is known. */
  readonly nextSettlement: string | null;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

export function TurnDialog({ character, nextSettlement, onClose, onDone, returnFocusTo }: TurnDialogProps) {
  const { api, instance, settings } = useKayfa();
  const { refresh } = usePlayer();
  const pending = character.pendingTurn;
  const [to, setTo] = useState<string | null>(pending?.class ?? null);
  const [loudness, setLoudness] = useState<'silent' | 'announced'>(pending?.loudness ?? 'announced');
  const [named, setNamed] = useState({ was: pending?.showFrom ?? false, to: pending?.showTo ?? false });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const nameOf = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const now = nameOf(character.class);
  /* A silent Turn names nothing: the boxes are off and clear while it is chosen. */
  const showFrom = loudness === 'announced' && named.was;
  const showTo = loudness === 'announced' && named.to;
  const when = pending?.takesEffectAt ?? nextSettlement;

  const submit = async () => {
    if (!to || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.turn(character.id, to, loudness, showFrom, showTo);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await refresh();
      onDone(`${character.name}'s Turn is waiting for the next settlement.`);
    } catch {
      setRefusal('The Turn could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={pending ? `Change ${character.name}'s Turn` : `Turn ${character.name}`} onClose={onClose} returnFocusTo={returnFocusTo}>
      <form className="kb-turn" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <p className="kb-small">
          {character.name} is {withArticle(now)} (since {shortDate(character.classSince)}). After a Turn it can Turn again in {spanWords(settings.turnCooldown)}.
        </p>
        <ClassCards legend="Turn to" value={to} onChange={setTo} exclude={[character.class]} />
        <fieldset className="kb-choice">
          <legend>How loud</legend>
          <label className="kb-choice-option">
            <input type="radio" name="turn-loudness" checked={loudness === 'silent'} onChange={() => setLoudness('silent')} />
            <span><b>Silent.</b> Nobody is told. Until you reveal it, only you know.</span>
          </label>
          <label className="kb-choice-option">
            <input type="radio" name="turn-loudness" checked={loudness === 'announced'} onChange={() => setLoudness('announced')} />
            <span><b>Announced.</b> The System posts that {character.name} has Turned.</span>
          </label>
          <label className="kb-choice-option kb-choice-sub">
            <input type="checkbox" checked={showFrom} disabled={loudness === 'silent'} onChange={(e) => setNamed({ ...named, was: e.target.checked })} />
            <span>Name the old class. The post says what {character.name} was.</span>
          </label>
          <label className="kb-choice-option kb-choice-sub">
            <input type="checkbox" checked={showTo} disabled={loudness === 'silent'} onChange={(e) => setNamed({ ...named, to: e.target.checked })} />
            <span>Name the new class. The post says what {character.name} is now, and {character.name} reveals it.</span>
          </label>
        </fieldset>
        {to ? (
          <PreviewBox preview={turnPreview({ name: character.name, was: now, to: nameOf(to), loudness, showFrom, showTo })} />
        ) : (
          <p className="kb-muted kb-small">Choose a class to see what everyone will see.</p>
        )}
        <p className="kb-small">
          Takes effect at the next settlement{when ? `, ${dayAndTime(when)}` : ''}. Until then {character.name} is still {withArticle(now)}, and you can change this Turn or withdraw it.
        </p>
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <div className="kb-dialog-actions">
          <button type="button" className="kb-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="kb-button" data-kb-primary="" disabled={!to || busy}>{pending ? 'Change the Turn' : `Turn ${character.name}`}</button>
        </div>
      </form>
    </Modal>
  );
}
