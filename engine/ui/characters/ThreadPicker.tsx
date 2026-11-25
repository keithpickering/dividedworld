/**
 * The thread picker the Reveal and the announced Turn share, on the glass: an optional board filter and one searchable field of
 * threads (the newest when empty, titles when typed into). The System's board is never offered, and each option names its board.
 * It owns the filter and the field; the chosen thread is the screen's (`value`), and typing after a choice makes it no longer chosen.
 */
import { useEffect, useState } from 'react';
import { useBoot } from '../boot.tsx';
import { useKayfa } from '../context.tsx';
import type { Board, Id } from '../data/api.ts';
import { GlassCombobox } from '../glass/GlassCombobox.tsx';
import type { ComboSource } from '../search/useSearchCombobox.ts';
import './characters.css';

/** The chosen thread: its id goes to the call, its title to the preview. `board` starts the filter on the thread's own board. */
export interface ChosenThread { readonly id: Id; readonly title: string; readonly board?: Id }

export interface ThreadPickerProps {
  readonly value: ChosenThread | null;
  readonly onChange: (thread: ChosenThread | null) => void;
  /** Which boards the filter offers: the default is every board but The System's. */
  readonly boards?: (board: Board) => boolean;
  /** Called when the boards could not be read (only where boot is not there). */
  readonly onBoardsFailed?: () => void;
}

export function ThreadPicker({ value, onChange, boards: only = (b) => !b.isSystem, onBoardsFailed }: ThreadPickerProps) {
  const { api } = useKayfa();
  /* The boards are boot's, read once for the frame: the picker opens with them in its first render. Only where boot is not there (a story, a screen before boot) are they read. */
  const boot = useBoot();
  const [read, setRead] = useState<readonly Board[]>([]);
  const boards = (boot ? boot.boards : read).filter(only);
  /* The optional filter: '' is All boards. The field is remounted when it changes, so a thread chosen under another filter is cleared. */
  const [board, setBoard] = useState(value?.board ?? '');

  const hasBoot = boot !== null;
  useEffect(() => {
    if (hasBoot) return undefined;
    let live = true;
    void api.boards().then((b) => { if (live) setRead(b); }, () => { if (live) onBoardsFailed?.(); });
    return () => { live = false; };
  }, [api, hasBoot, onBoardsFailed]);

  /* Empty, the newest threads; typed into, titles. The System's board is never offered, and each option names its board. */
  const source: ComboSource = async (query) => {
    const found = await api.suggest(query, { kinds: ['threads'], excludeSystem: true, board: board || null, most: 10 });
    return [{ key: 'threads', label: 'Threads', options: found.threads.map((t) => ({ id: t.id, label: t.title, detail: t.boardName })), empty: 'No threads found.' }];
  };

  return (
    <div className="kb-reveal-where">
      <label className="kb-glass-field">
        <span>Board</span>
        <select className="kb-glass-select" aria-label="Board (optional)" value={board} onChange={(e) => { setBoard(e.target.value); onChange(null); }}>
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
        initialQuery={value?.title ?? ''}
        minChars={2}
        source={source}
        onChoose={(o) => onChange({ id: o.id, title: o.label })}
        onQueryChange={(text) => { if (value && text !== value.title) onChange(null); }}
      />
    </div>
  );
}
