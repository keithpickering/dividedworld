/**
 * Reveal a character's class, on the glass: My characters' confirmation, a glass overlay on the
 * Turn's smoke, as Debut and the Turn are (Overlay.tsx), so the three dialogs that change or
 * announce a class read as one family (the glass reveal design, §1 and §2). The player chooses a
 * board and a thread, and the preview shows the character's own post as the thread will draw it.
 * The rules of a reveal are reveal.ts's, shared with the board's dialog (RevealModal.tsx).
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Board, MyCharacter, ThreadSummary } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { FieldCount } from '../glass/FieldCount.tsx';
import { FormFoot } from '../glass/FormFoot.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { revealFooter } from './footers.ts';
import { PreviewBox } from './PreviewBox.tsx';
import { revealPreview } from './previews.ts';
import { MAX, revealWords, useReveal } from './reveal.ts';
import './characters.css';

export interface RevealOverlayProps {
  readonly character: MyCharacter;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

const PAGE = 20;

export function RevealOverlay({ character, onClose, onDone, returnFocusTo }: RevealOverlayProps) {
  const { api } = useKayfa();
  const r = useReveal(character);
  const { setRefusal } = r;
  const words = revealWords(character, r.className);
  const [boards, setBoards] = useState<readonly Board[]>([]);
  const [board, setBoard] = useState('');
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [chosen, setChosen] = useState('');
  /* The board whose threads are listed now, so a page asked for under another one is dropped. */
  const listed = useRef('');

  useEffect(() => {
    let live = true;
    void api.boards().then((b) => { if (live) setBoards(b.filter((x) => !x.isSystem)); }, () => { if (live) setRefusal('The boards could not be loaded. Close this and try again.'); });
    return () => { live = false; };
  }, [api, setRefusal]);

  useEffect(() => {
    setThreads([]);
    setTotal(null);
    setChosen('');
    setMore(false);
    listed.current = board;
    if (!board) return;
    let live = true;
    void api.threads(board, { offset: 0, limit: PAGE }).then((t) => { if (live) { setThreads(t.threads); setTotal(t.total); } }, () => { if (live) setRefusal('That board’s threads could not be loaded. Choose it again.'); });
    return () => { live = false; };
  }, [api, board, setRefusal]);

  /*
   * The next page, appended: a thread that moved onto an earlier page meanwhile is not listed
   * twice, and a page that comes after the board was changed is dropped, as the effects drop theirs.
   */
  const older = async () => {
    const of = board;
    setMore(true);
    try {
      const t = await api.threads(of, { offset: threads.length, limit: PAGE });
      if (listed.current !== of) return;
      setThreads((have) => [...have, ...t.threads.filter((x) => !have.some((h) => h.id === x.id))]);
      setTotal(t.total);
    } catch {
      if (listed.current === of) setRefusal('Older threads could not be loaded. Try again.');
    } finally {
      if (listed.current === of) setMore(false);
    }
  };

  const title = threads.find((t) => t.id === chosen)?.title ?? null;

  const submit = async () => {
    if (!chosen) return;
    const outcome = await r.submit(chosen, title ?? 'the thread');
    if (!outcome.ok) return;
    onDone(outcome.done);
    onClose();
  };

  return (
    <Overlay title={`Reveal ${character.name}'s class`} kicker="My characters › Reveal" surface="turn" className="kb-reveal-dialog" onClose={onClose} returnFocusTo={returnFocusTo}>
      <form className="kb-reveal" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <p className="kb-reveal-line">{words.sentence}</p>
        {words.pendingTurn && <p className="kb-reveal-line kb-reveal-note">{words.pendingTurn}</p>}
        <div className="kb-reveal-where">
          <label className="kb-glass-field">
            <span>Board</span>
            <select className="kb-glass-select" value={board} onChange={(e) => setBoard(e.target.value)}>
              <option value="">Choose a board</option>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="kb-glass-field">
            <span>Thread</span>
            <select className="kb-glass-select" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={!board}>
              <option value="">{board ? 'Choose a thread' : 'Choose a board first'}</option>
              {threads.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </label>
        </div>
        {board && total === 0 && <p className="kb-reveal-line">No threads on this board yet; choose another board.</p>}
        {total !== null && threads.length < total && (
          <ButtonRow><GlassButton size="s" disabled={more} onClick={() => void older()}>Show older threads</GlassButton></ButtonRow>
        )}
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
        <FormFoot line={revealFooter()}>
          <GlassButton onClick={onClose}>Cancel</GlassButton>
          <GlassButton type="submit" kind="primary" busy={r.busy} disabled={!chosen || r.over}>{words.button}</GlassButton>
        </FormFoot>
      </form>
    </Overlay>
  );
}
