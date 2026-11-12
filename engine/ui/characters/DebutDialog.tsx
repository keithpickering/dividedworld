/**
 * A waiting character's dialog: drop it now, or change how it debuts at the settlement. Until the
 * tally it can be dropped or its announcement changed; neither is final until it debuts. It is a
 * glass overlay over My characters, as the Turn is, on the Turn's smoke (Overlay.tsx). On the
 * phone it is a sheet with its two buttons at its foot (characters.css).
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER, type DebutLoudness, type DebutTiming, type MyCharacter } from '../data/api.ts';
import { GlassButton } from '../glass/Button.tsx';
import { FormFoot } from '../glass/FormFoot.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { usePlayer } from '../player.tsx';
import { DebutChoice } from './DebutChoice.tsx';
import { readBack, STALE_PAGE } from './readBack.ts';
import { debutFooter } from './footers.ts';
import { untilWords } from './format.ts';
import './characters.css';

export interface DebutDialogProps {
  readonly character: MyCharacter;
  /** `now` drops it; `tally` changes how it debuts at the settlement. */
  readonly timing: DebutTiming;
  /** When the next settlement runs (an ISO time), where it is known: the footer says how far off it is. */
  readonly nextSettlement?: string | null;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

export function DebutDialog({ character, timing, nextSettlement = null, onClose, onDone, returnFocusTo }: DebutDialogProps) {
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
    let answer;
    try {
      answer = await api.setDebut(character.id, timing, loudness);
    } catch {
      /* The adapter does not throw; if the call did, nothing says it did not go through. */
      setRefusal(LOST_ANSWER);
      setBusy(false);
      return;
    }
    if (!answer.ok) { setRefusal(answer.error); setBusy(false); return; }
    /* Written: the dialog ends, so the button stays busy and a second press cannot send a second one. */
    const fresh = await readBack(refresh);
    onDone((drop ? `${character.name} has debuted.` : `${character.name} will debut at the next settlement, as you chose.`) + (fresh ? '' : STALE_PAGE));
  };

  return (
    <Overlay title={drop ? `Drop ${character.name} now` : `How ${character.name} debuts`} kicker="My characters › Debut" surface="turn" className="kb-debut-dialog" onClose={busy ? () => {} : onClose} returnFocusTo={returnFocusTo}>
      <form className="kb-debut" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <DebutChoice name={character.name} pronouns={character.pronouns} className={className} timing={timing} loudness={loudness} onLoudness={setLoudness} />
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <FormFoot line={debutFooter({ name: character.name, pronouns: character.pronouns, timing, until: nextSettlement ? untilWords(nextSettlement, api.now()) : null })}>
          <GlassButton disabled={busy} onClick={onClose}>Cancel</GlassButton>
          <GlassButton type="submit" kind="primary" busy={busy}>{drop ? `Drop ${character.name} now` : `Save how ${character.name} debuts`}</GlassButton>
        </FormFoot>
      </form>
    </Overlay>
  );
}
