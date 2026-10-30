/**
 * Reveal a character's class, a confirmation: it names the class it will show, says it can't be
 * taken back, and takes an optional line of the character's own words (up to 200 characters). The
 * reveal is the character's own Act in a thread; with `thread` given (the composer's) it is that
 * thread, and without it the player chooses a board and a thread. The server checks the class and
 * writes it; the dialog only asks.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Board, Id, MyCharacter, ThreadSummary } from '../data/api.ts';
import { Modal } from '../modal.tsx';
import { usePlayer } from '../player.tsx';
import { withArticle } from './format.ts';

export interface RevealDialogProps {
  readonly character: MyCharacter;
  /** The thread to reveal in, when the screen has one; otherwise the player chooses. */
  readonly thread?: Id | null;
  readonly onClose: () => void;
  readonly onDone?: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

const MAX = 200;
const PAGE = 20;

export function RevealDialog({ character, thread = null, onClose, onDone, returnFocusTo }: RevealDialogProps) {
  const { api, instance } = useKayfa();
  const { refresh } = usePlayer();
  const [boards, setBoards] = useState<readonly Board[]>([]);
  const [board, setBoard] = useState('');
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [chosen, setChosen] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const className = instance.classes.find((c) => c.key === character.class)?.name ?? character.class;

  useEffect(() => {
    if (thread) return;
    let live = true;
    void api.boards().then((b) => { if (live) setBoards(b.filter((x) => !x.isSystem)); }, () => { if (live) setRefusal('The boards could not be loaded. Close this and try again.'); });
    return () => { live = false; };
  }, [api, thread]);

  useEffect(() => {
    setThreads([]);
    setTotal(null);
    setChosen('');
    if (thread || !board) return;
    let live = true;
    void api.threads(board, { offset: 0, limit: PAGE }).then((r) => { if (live) { setThreads(r.threads); setTotal(r.total); } }, () => { if (live) setRefusal('That board’s threads could not be loaded. Choose it again.'); });
    return () => { live = false; };
  }, [api, board, thread]);

  /* The next page, appended: a thread that moved onto an earlier page meanwhile is not listed twice. */
  const older = async () => {
    setMore(true);
    try {
      const r = await api.threads(board, { offset: threads.length, limit: PAGE });
      setThreads((have) => [...have, ...r.threads.filter((t) => !have.some((h) => h.id === t.id))]);
      setTotal(r.total);
    } catch {
      setRefusal('Older threads could not be loaded. Try again.');
    } finally {
      setMore(false);
    }
  };

  const where = thread ?? chosen;
  const over = [...message].length > MAX;

  const submit = async () => {
    if (!where || over || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.unmask(character.id, where, message);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await refresh();
      const title = thread ? 'this thread' : threads.find((t) => t.id === where)?.title ?? 'the thread';
      onDone?.(`${character.name} revealed as ${className} in ${title}.`);
      onClose();
    } catch {
      setRefusal('The reveal could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Reveal ${character.name}'s class`} onClose={onClose} returnFocusTo={returnFocusTo}>
      <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <p>
          {character.name} is {withArticle(className)}. This shows everyone that, as checked by The System, as {character.name}&apos;s own post. Anyone can react to it or spin a thread from it, and this can&apos;t be taken back.
        </p>
        {character.pendingTurn && <p className="kb-small kb-muted">{character.name} has a Turn waiting. This reveals the class it holds now, {className}, as of today. If its settlement is due, a reveal waits until it has run.</p>}
        {thread ? (
          <p className="kb-small">It will be posted in this thread.</p>
        ) : (
          <>
            <label className="kb-field">
              <span>Board</span>
              <select className="kb-select" value={board} onChange={(e) => setBoard(e.target.value)}>
                <option value="">Choose a board</option>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="kb-field">
              <span>Thread</span>
              <select className="kb-select" value={chosen} onChange={(e) => setChosen(e.target.value)} disabled={!board}>
                <option value="">{board ? 'Choose a thread' : 'Choose a board first'}</option>
                {threads.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </label>
            {board && total === 0 && <p className="kb-small kb-muted">No threads on this board yet; choose another board.</p>}
            {total !== null && threads.length < total && (
              <p><button type="button" className="kb-button" disabled={more} onClick={() => void older()}>Show older threads</button></p>
            )}
          </>
        )}
        <label className="kb-field">
          <span>In the character&apos;s words (optional)</span>
          <input className="kb-input kb-wide" value={message} onChange={(e) => setMessage(e.target.value)} aria-describedby="reveal-count" />
        </label>
        <p id="reveal-count" className="kb-small kb-muted">{[...message].length} of {MAX} characters. Plain text.</p>
        {over && <p role="alert" className="kb-notice" data-kb-tone="refusal">The message is at most {MAX} characters.</p>}
        {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
        <div className="kb-dialog-actions">
          <button type="button" className="kb-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="kb-button" data-kb-primary="" disabled={!where || over || busy}>Reveal {character.name} as {withArticle(className)}</button>
        </div>
      </form>
    </Modal>
  );
}
