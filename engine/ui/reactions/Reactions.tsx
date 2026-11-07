/**
 * The reactions under a post, drawn as meta tiles (engine/ui/glass/meta-tile.css; the meta acts design, sections 1, 5 and 6): one
 * tile for each kind with a count (the player's own ringed, on their screen only) and a React tile that opens the picker, unless
 * the post is by one of the player's own characters, where the tiles are plain and there is no React. A tile that is a button
 * reacts with its kind as the HUD character, by the picker's own send (send.ts: one `useReactionSend` call for the row, whose lock
 * the picker shares); a refusal opens the picker with the server's words in its alert. The row's buttons are one tab stop,
 * moved along by the arrow keys. Only the player's own screen knows which characters are theirs, and nothing here says who reacted.
 *
 * On a staged page (staged.ts: the front door's sample thread) the reader needs no character: React is on every post, a press is
 * answered on their screen alone (the kind is theirs in `mine`, its count grows by one), nothing is sent or estimated, and the
 * words name no mask.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useTally, type Tallies } from '../thread/tallies.ts';
import { useMine, type Mine } from './mine.ts';
import { Picker } from './Picker.tsx';
import { useReactionSend, type SendAnswer } from './send.ts';
import '../cards/kit.css';
import '../glass/meta-tile.css';
import './reactions.css';
import { Layers } from '../glass/layer.tsx';
import { useStaged } from '../staged.ts';

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
  /** What the picker stands by: the whole row (the default), or the React tile, for a row that takes no box of its own (the Lens's grid of actions). */
  readonly pickerAt?: 'row' | 'button';
}

/** A staged page's send: the kind is the reader's, its count grows by one, on this screen alone; a kind already theirs is not sent again. */
const STAGED_READER = 'staged:reader';
const stagedSend = (act: Id, tallies: Tallies, mine: Mine) => async (kind: string): Promise<SendAnswer> => {
  if (!mine.add({ act, kind, character: STAGED_READER })) return 'busy';
  tallies.merge(act, { [kind]: (tallies.get(act)[kind] ?? 0) + 1 });
  return 'sent';
};

/** The tab stop of the React tile; a kind's is its key. */
const REACT_STOP = ' react'; /* a space: no reaction key has one */

export function Reactions({ act, author, authorName = 'this character', tallies, mine, subject, pickerAt = 'row' }: Props) {
  const { instance, settings } = useKayfa();
  const player = usePlayer();
  const tally = useTally(tallies, act);
  const own = useMine(mine, act);
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  /* The row's one tab stop: the last tile focused, else React where there is one, else the first tile. */
  const [stop, setStop] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const shown = instance.reactions.filter((r) => (tally[r.key] ?? 0) > 0);
  const staged = useStaged();
  const theirs = author !== null && player.characters.some((c) => c.id === author);
  const as = staged ? null : player.hudCharacter;
  const canReact = !theirs && (staged || as !== null);
  /* One send for the row and its picker: one lock for the Act (send.ts). A staged page's is answered here, and sends nothing. */
  const sent = useReactionSend({ act, as, tallies, mine });
  const { send, busy } = staged ? { send: stagedSend(act, tallies, mine), busy: false } : sent;
  /* A picker is for the character it was opened for: another character in the HUD closes it, and what was said of a reaction as the last one goes. */
  const asId = as?.id;
  useEffect(() => { setOpen(false); setSaid(''); }, [asId]);
  /* What an answer that comes back late is checked against: the HUD character and whether a press is possible now. */
  const live = useRef({ asId, canReact });
  live.current = { asId, canReact };
  if (shown.length === 0 && !canReact) return null;

  const kinds = new Set(own.map((o) => o.kind));
  const cap = settings.reactionCap;
  const left = Math.max(0, cap - kinds.size);
  const stops = [...(canReact ? shown.map((r) => r.key) : []), ...(canReact ? [REACT_STOP] : [])];
  const current = stop !== null && stops.includes(stop) ? stop : (stops.includes(REACT_STOP) ? REACT_STOP : stops[0]);

  const press = async (key: string) => {
    if (left === 0 || kinds.has(key)) return;
    const pressedAs = asId;
    const answer = await send(key);
    if (answer === 'busy') return;
    /* The press was for the character it was made as: another in the HUD, or no right to react now, and its answer is dropped. */
    if (live.current.asId !== pressedAs || !live.current.canReact) return;
    setSaid('');
    if (answer === 'sent') { setSaid(`Reacted with ${readable(key)}${as ? ` as ${as.name}` : ''}`); return; }
    /* The picker opens as it does from React, and gives focus back to it on Close: the modal layer returns focus to what held it as it opened. */
    button.current?.focus();
    setRefusal(answer.refusal);
    setOpen(true);
  };

  /* Left and Right along the row's buttons (no wrap), Home and End to the ends; only its own buttons answer, not the picker's, whose events pass through here. */
  const move = (e: KeyboardEvent) => {
    const all = [...(row.current?.querySelectorAll<HTMLElement>('[data-kb-stop]') ?? [])];
    const at = all.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    let to: number;
    if (e.key === 'ArrowRight') to = Math.min(all.length - 1, at + 1);
    else if (e.key === 'ArrowLeft') to = Math.max(0, at - 1);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = all.length - 1;
    else return;
    e.preventDefault();
    all[to]!.focus();
  };

  return (
    <div
      ref={row} className="kb-reactions" data-kb-over-ink="" aria-busy={busy || undefined}
      onKeyDown={move} onFocus={(e) => { const s = (e.target as HTMLElement).dataset['kbStop']; if (s !== undefined) setStop(s); }}
    >
      {shown.length > 0 && (
        <ul className="kb-reaction-list" aria-label="Reactions">
          {shown.map((r) => {
            const n = tally[r.key];
            const yours = kinds.has(r.key);
            const face = (
              <span className="kb-meta-tile-in" aria-hidden="true"><span className="kb-reaction-emoji">{r.emoji}</span> {n}</span>
            );
            const common = { 'data-kb-reaction': r.key, 'data-kb-own': yours ? '' : undefined } as const;
            if (!canReact) {
              return (
                <li key={r.key}>
                  <span className="kb-meta-tile kb-reaction" {...common}>
                    <span className="kb-visually-hidden">{readable(r.key)}, {n}{yours ? ', including yours' : ''}</span>
                    {face}
                  </span>
                </li>
              );
            }
            const name = yours ? `${readable(r.key)}, ${n}, including yours`
              : left === 0 ? `${readable(r.key)}, ${n}. You have left all ${cap} of your reactions on this post`
                : `${readable(r.key)}, ${n}. React${as ? ` as ${as.name}` : ''}`;
            return (
              <li key={r.key}>
                <button
                  type="button" className="kb-meta-tile kb-reaction" {...common} aria-label={name} aria-disabled={yours || left === 0 ? 'true' : undefined}
                  data-kb-stop={r.key} tabIndex={current === r.key ? 0 : -1} onClick={() => void press(r.key)}
                >
                  {face}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canReact && (
        <button
          ref={button} type="button" className="kb-meta-tile kb-reaction kb-react-button" aria-haspopup="dialog" aria-expanded={open}
          data-kb-stop={REACT_STOP} tabIndex={current === REACT_STOP ? 0 : -1} onClick={() => { setRefusal(null); setOpen(!open); }}
        >
          <span className="kb-meta-tile-in"><span aria-hidden="true">+ </span>React</span>
        </button>
      )}
      {canReact && <span role="status" className="kb-visually-hidden">{said}</span>}
      <Layers>
      {open && canReact && (
        <Picker
          subject={subject ?? `${authorName}'s post`} as={as} own={own} send={send} busy={busy} refusal={refusal} anchor={pickerAt === 'button' ? button : row}
          onClose={(refocus) => { setOpen(false); if (refocus) button.current?.focus(); }}
        />
      )}
      </Layers>
    </div>
  );
}
