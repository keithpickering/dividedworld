/**
 * The reactions under a post: chips with counts (the player's own marked, on their screen only), and
 * a React button that opens the picker, unless the post is by one of the player's own characters.
 * Only the player's own screen knows which characters are theirs, and nothing here says who reacted.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useTally, type Tallies } from '../thread/tallies.ts';
import { useMine, type Mine } from './mine.ts';
import { Picker } from './Picker.tsx';
import './reactions.css';

/** A reaction's name for a reader: its key made readable ("raised-hands" is "Raised hands"). */
export const readable = (key: string): string => {
  const words = key.replace(/[-_]+/gu, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

interface Props {
  readonly act: Id;
  /** Who wrote the Act; null for The System. */
  readonly author: Id | null;
  /** The author's name as the thread shows it, which the picker is named by ("React to Alex's post"). */
  readonly authorName?: string;
  readonly tallies: Tallies;
  readonly mine: Mine;
  /** What is reacted to, as the picker is named ("React to Mrs. Hooligan's Whoops!"); the author's post where none is given. */
  readonly subject?: string;
  /** Drawn on the glass (a play's panel), with the same picker, refusals and "your own" outline; the 2003 chrome's otherwise. */
  readonly look?: 'glass';
}

export function Reactions({ act, author, authorName = 'this character', tallies, mine, subject, look }: Props) {
  const { instance } = useKayfa();
  const player = usePlayer();
  const tally = useTally(tallies, act);
  const own = useMine(mine, act);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const shown = instance.reactions.filter((r) => (tally[r.key] ?? 0) > 0);
  const theirs = author !== null && player.characters.some((c) => c.id === author);
  const as = player.hudCharacter;
  const canReact = !theirs && as !== null;
  /* A picker is for the character it was opened for: another character in the HUD closes it. */
  const asId = as?.id;
  useEffect(() => { setOpen(false); }, [asId]);
  if (shown.length === 0 && !canReact) return null;
  return (
    <div ref={row} className="kb-reactions" data-kb-look={look}>
      {shown.length > 0 && (
        <ul className="kb-chips" aria-label="Reactions">
          {shown.map((r) => {
            const mine_ = own.some((o) => o.kind === r.key);
            return (
              <li key={r.key} className="kb-chip" data-kb-reaction={r.key} data-kb-own={mine_ ? '' : undefined}>
                <span className="kb-visually-hidden">{readable(r.key)}, {tally[r.key]}{mine_ ? ', including yours' : ''}</span>
                <span aria-hidden="true">{r.emoji} {tally[r.key]}</span>
              </li>
            );
          })}
        </ul>
      )}
      {canReact && (
        <button ref={button} type="button" className="kb-button kb-react-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">+ </span>React
        </button>
      )}
      {open && canReact && (
        <Picker
          act={act} subject={subject ?? `${authorName}'s post`} as={as} own={own} tallies={tallies} mine={mine} anchor={row}
          onClose={(refocus) => { setOpen(false); if (refocus) button.current?.focus(); }}
        />
      )}
    </div>
  );
}
