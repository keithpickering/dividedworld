/**
 * Reveal a character's class, on the glass: My characters' confirmation, a glass overlay on the
 * Turn's smoke, as Debut and the Turn are (Overlay.tsx), so the three dialogs that change or
 * announce a class read as one family (the glass reveal design, §1 and §2). The player chooses a
 * thread (one searchable field, the newest when empty; a board filter is optional), and the preview shows the character's own post as the thread will draw it.
 * The rules of a reveal are reveal.ts's, shared with the board's dialog (RevealModal.tsx).
 */
import { useEffect, useState } from 'react';
import { useBoot } from '../boot.tsx';
import { useKayfa } from '../context.tsx';
import type { Board, Id, MyCharacter } from '../data/api.ts';
import { GlassButton } from '../glass/Button.tsx';
import { FieldCount } from '../glass/FieldCount.tsx';
import { FormFoot } from '../glass/FormFoot.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { GlassCombobox } from '../glass/GlassCombobox.tsx';
import type { ComboSource } from '../search/useSearchCombobox.ts';
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
  /** The thread the opener is on: the board filter and the Thread field start on it, so Reveal is ready at once. */
  readonly at?: { readonly id: Id; readonly title: string; readonly board: Id } | null;
  /** The overlay's kicker, which each opener words (the HUD, My characters). */
  readonly kicker: string;
}

/** The chosen thread: its id goes to the reveal, its title to the preview. */
interface Chosen { readonly id: string; readonly title: string }

export function RevealOverlay({ character, onClose, onDone, returnFocusTo, at = null, kicker }: RevealOverlayProps) {
  const { api, ui } = useKayfa();
  const r = useReveal(character);
  const { setRefusal } = r;
  const words = revealWords(character, r.className, ui.copy.gameWord);
  /* The boards are boot's, read once for the frame: the overlay opens with them in its first render. Only where boot is not there (a story, a screen before boot) are they read. */
  const boot = useBoot();
  const [read, setRead] = useState<readonly Board[]>([]);
  const boards = (boot ? boot.boards : read).filter((x) => !x.isSystem);
  /* The optional filter: '' is All boards. The field is remounted when it changes, so a thread chosen under another filter is cleared. */
  const [board, setBoard] = useState(at?.board ?? '');
  const [chosen, setChosen] = useState<Chosen | null>(at ? { id: at.id, title: at.title } : null);

  const hasBoot = boot !== null;
  useEffect(() => {
    if (hasBoot) return undefined;
    let live = true;
    void api.boards().then((b) => { if (live) setRead(b); }, () => { if (live) setRefusal('The boards could not be loaded. Close this and try again.'); });
    return () => { live = false; };
  }, [api, hasBoot, setRefusal]);

  /* Empty, the newest threads; typed into, titles. The System's board is never offered, and each option names its board. */
  const source: ComboSource = async (query) => {
    const found = await api.suggest(query, { kinds: ['threads'], excludeSystem: true, board: board || null, most: 10 });
    return [{ key: 'threads', label: 'Threads', options: found.threads.map((t) => ({ id: t.id, label: t.title, detail: t.boardName })), empty: 'No threads found.' }];
  };

  const title = chosen?.title ?? null;

  const submit = async () => {
    if (!chosen) return;
    const outcome = await r.submit(chosen.id, title ?? 'the thread');
    if (!outcome.ok) return;
    onDone(outcome.done);
    onClose();
  };

  return (
    <Overlay title={`Reveal ${character.name}'s class`} kicker={kicker} surface="turn" className="kb-reveal-dialog" onClose={onClose} returnFocusTo={returnFocusTo}>
      <form className="kb-reveal" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <p className="kb-reveal-line">{words.sentence}</p>
        {words.pendingTurn && <p className="kb-reveal-line kb-reveal-note">{words.pendingTurn}</p>}
        <div className="kb-reveal-where">
          <label className="kb-glass-field">
            <span>Board</span>
            <select className="kb-glass-select" aria-label="Board (optional)" value={board} onChange={(e) => { setBoard(e.target.value); setChosen(null); }}>
              <option value="">All boards</option>
              {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {/* The picker is this one block, so a later search can replace it. Typing after a choice makes it no longer the chosen thread; a choice itself fills the box with the chosen title, which is not a change. */}
          <GlassCombobox
            key={board}
            label="Thread"
            placeholder="Search thread titles"
            allowEmpty
            initialQuery={chosen?.title ?? ''}
            minChars={2}
            source={source}
            onChoose={(o) => setChosen({ id: o.id, title: o.label })}
            onQueryChange={(text) => setChosen((c) => (c && text !== c.title ? null : c))}
          />
        </div>
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
          <GlassButton onClick={onClose}>Cancel</GlassButton>
          <GlassButton type="submit" kind="primary" busy={r.busy} disabled={!chosen || r.over}>{words.button}</GlassButton>
        </FormFoot>
      </form>
    </Overlay>
  );
}
