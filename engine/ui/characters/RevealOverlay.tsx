/**
 * Reveal a character's class, on the glass: the one reveal dialog, a glass overlay on the Turn's
 * smoke, as the Turn is (Overlay.tsx), so the dialogs that change or announce a
 * class read as one family (the glass reveal design, §1 and §2). It has two openers, each wording
 * its own kicker: the HUD's "No other player sees this" and My characters. Opened on a thread (`at`), it
 * starts on that thread and is ready at once; opened on nothing, the player chooses a thread (one
 * searchable field, the newest when empty; a board filter is optional). The preview shows the
 * character's own post as the thread will draw it. The rules of a reveal are reveal.ts's.
 */
import { useCallback, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, MyCharacter } from '../data/api.ts';
import { GlassButton } from '../glass/Button.tsx';
import { FieldCount } from '../glass/FieldCount.tsx';
import { FormFoot } from '../glass/FormFoot.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { revealFooter } from './footers.ts';
import { PreviewBox } from './PreviewBox.tsx';
import { ThreadPicker, type ChosenThread } from './ThreadPicker.tsx';
import { revealPreview } from './previews.ts';
import { MAX, revealWords, useReveal } from './reveal.ts';
import './characters.css';

export interface RevealOverlayProps {
  readonly character: MyCharacter;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
  /** The thread the opener is on: the board filter and the Thread field start on it, so Reveal is ready at once. */
  readonly at?: { readonly id: Id; readonly title: string; readonly board: Id } | null;
  /** The overlay's kicker, which each opener words (the HUD, My characters). */
  readonly kicker: string;
}

export function RevealOverlay({ character, onClose, onDone, returnFocusTo, at = null, kicker }: RevealOverlayProps) {
  const { ui } = useKayfa();
  const r = useReveal(character);
  const { setRefusal } = r;
  const words = revealWords(character, r.className, ui.copy.gameWord);
  const [chosen, setChosen] = useState<ChosenThread | null>(at ? { id: at.id, title: at.title, board: at.board } : null);
  const failed = useCallback(() => setRefusal('The boards could not be loaded. Close this and try again.'), [setRefusal]);

  const title = chosen?.title ?? null;

  const submit = async () => {
    if (!chosen) return;
    const outcome = await r.submit(chosen.id, title ?? 'the thread');
    if (!outcome.ok) return;
    onDone(outcome.done);
    onClose();
  };

  return (
    <Overlay title={`Reveal ${character.name}'s class`} kicker={kicker} surface="turn" className="kb-reveal-dialog" onClose={r.busy ? () => {} : onClose} returnFocusTo={returnFocusTo}>
      <form className="kb-reveal" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <p className="kb-reveal-line">{words.sentence}</p>
        {words.pendingTurn && <p className="kb-reveal-line kb-reveal-note">{words.pendingTurn}</p>}
        <ThreadPicker value={chosen} onChange={setChosen} onBoardsFailed={failed} />
        <div className="kb-reveal-words">
          <label className="kb-glass-field">
            <span>In the character&apos;s words (optional)</span>
            <input className="kb-glass-input" value={r.message} onChange={(e) => r.setMessage(e.target.value)} aria-describedby="reveal-count" />
          </label>
          <FieldCount id="reveal-count" hint="Plain text." text={r.message} max={MAX} />
        </div>
        <PreviewBox preview={revealPreview({ name: character.name, className: r.className, message: r.message, threadTitle: title })} />
        {r.over && <p role="alert" className="kb-notice" data-kb-tone="refusal">The message is at most {MAX} characters.</p>}
        {r.refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{r.refusal}</p>}
        <FormFoot line={revealFooter(ui.copy.gameWord)}>
          <GlassButton disabled={r.busy} onClick={onClose}>Cancel</GlassButton>
          <GlassButton type="submit" kind="primary" busy={r.busy} disabled={!chosen || r.over}>{words.button}</GlassButton>
        </FormFoot>
      </form>
    </Overlay>
  );
}
