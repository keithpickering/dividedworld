/**
 * A waiting character's dialog: drop it now, or change how it debuts at the settlement. Until the
 * tally it can be dropped or its announcement changed; neither is final until it debuts. It is a
 * glass overlay over My characters, as the Turn is, on the Turn's smoke (Overlay.tsx).
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { DebutLoudness, DebutTiming, MyCharacter } from '../data/api.ts';
import { Overlay } from '../glass/Overlay.tsx';
import { usePlayer } from '../player.tsx';
import { DebutChoice } from './DebutChoice.tsx';
import './characters.css';

export interface DebutDialogProps {
  readonly character: MyCharacter;
  /** `now` drops it; `tally` changes how it debuts at the settlement. */
  readonly timing: DebutTiming;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

export function DebutDialog({ character, timing, onClose, onDone, returnFocusTo }: DebutDialogProps) {
  const { api, instance } = useKayfa();
  const { refresh } = usePlayer();
  const [loudness, setLoudness] = useState<DebutLoudness>(character.debutLoudness ?? 'announced');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const className = instance.classes.find((c) => c.key === character.class)?.name ?? character.class;
  const drop = timing === 'now';

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.setDebut(character.id, timing, loudness);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await refresh();
      onDone(drop ? `${character.name} has debuted.` : `${character.name} will debut at the next settlement, as you chose.`);
    } catch {
      setRefusal('That could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay title={drop ? `Drop ${character.name} now` : `How ${character.name} debuts`} kicker="My characters › Debut" surface="turn" className="kb-debut-dialog" onClose={onClose} returnFocusTo={returnFocusTo}>
      <form className="kb-debut" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <DebutChoice name={character.name} className={className} timing={timing} loudness={loudness} onLoudness={setLoudness} />
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <div className="kb-turn-actions">
          <button type="button" className="kb-glass-action kb-glass-skew" onClick={onClose}><span className="kb-glass-upright">Cancel</span></button>
          <button type="submit" className="kb-glass-confirm kb-glass-skew" disabled={busy}><span className="kb-glass-upright">{drop ? `Drop ${character.name} now` : `Save how ${character.name} debuts`}</span></button>
        </div>
      </form>
    </Overlay>
  );
}
