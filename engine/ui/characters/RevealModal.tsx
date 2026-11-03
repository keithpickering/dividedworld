/**
 * Reveal a character's class, on the board: the composer's confirmation, in the thread it is
 * written in. It names the class it will show, says it can't be taken back, and takes an optional
 * line of the character's own words. The board's modal (modal.tsx) around the core in reveal.ts;
 * My characters asks the same on the glass (RevealOverlay.tsx), with a board and thread to choose.
 */
import type { Id, MyCharacter } from '../data/api.ts';
import { Modal } from '../modal.tsx';
import { MAX, revealWords, useReveal } from './reveal.ts';

export interface RevealModalProps {
  readonly character: MyCharacter;
  /** The thread the reveal is posted in: the composer's own. */
  readonly thread: Id;
  readonly onClose: () => void;
  readonly onDone?: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

export function RevealModal({ character, thread, onClose, onDone, returnFocusTo }: RevealModalProps) {
  const r = useReveal(character);
  const words = revealWords(character, r.className);

  const submit = async () => {
    const outcome = await r.submit(thread, 'this thread');
    if (!outcome.ok) return;
    onDone?.(outcome.done);
    onClose();
  };

  return (
    <Modal title={`Reveal ${character.name}'s class`} onClose={onClose} returnFocusTo={returnFocusTo}>
      <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <p>{words.sentence}</p>
        {words.pendingTurn && <p className="kb-small kb-muted">{words.pendingTurn}</p>}
        <p className="kb-small">It will be posted in this thread.</p>
        <label className="kb-field">
          <span>In the character&apos;s words (optional)</span>
          <input className="kb-input kb-wide" value={r.message} onChange={(e) => r.setMessage(e.target.value)} aria-describedby="reveal-count" />
        </label>
        <p id="reveal-count" className="kb-small kb-muted">{r.count} of {MAX} characters. Plain text.</p>
        {r.over && <p role="alert" className="kb-notice" data-kb-tone="refusal">The message is at most {MAX} characters.</p>}
        {r.refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{r.refusal}</p>}
        <div className="kb-dialog-actions">
          <button type="button" className="kb-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="kb-button" data-kb-primary="" disabled={r.over || r.busy}>{words.button}</button>
        </div>
      </form>
    </Modal>
  );
}
