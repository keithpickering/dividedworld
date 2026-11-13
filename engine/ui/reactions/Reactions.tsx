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
import { blindPlaysOf, createPlays, localKindsOf, useAt, usePlays, type LocalKind, type Plays } from '../cards/plays.ts';
import { dayAndTime } from '../characters/format.ts';
import { emojiOfKey } from '../../rules/emoji.ts';
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

/** A local kind's name for a reader and a screen reader: the emoji (which a screen reader speaks by its own name), the quadrant's label where a play says it, then that a card added it. */
export const localName = (emoji: string, label: string | null): string => `${emoji}${label === null ? '' : `, ${label}`}, added by a card`;

/** Nobody's plays: a row drawn outside a thread has no card on its post to read. */
const NO_PLAYS = createPlays();

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
  /**
   * The thread's plays, for the cards that change this post's row: the reactions a `reaction` card added to it (a chip for each, and a place in the picker),
   * and a `totals` veil that hides its counts. None outside a thread.
   */
  readonly plays?: Plays;
  /** What the picker stands by: the whole row (the default), or the React tile, for a row that takes no box of its own (the Lens's grid of actions). */
  readonly pickerAt?: 'row' | 'button';
}

/**
 * A staged page's send: the kind is the reader's, its count grows by one, on this screen alone. It holds the cap and the one-of-a-kind
 * rule itself, as the server does in play, since two presses in one tick are both decided on what the last render knew.
 */
const STAGED_READER = 'staged:reader';
const stagedSend = (act: Id, tallies: Tallies, mine: Mine, cap: number) => async (kind: string): Promise<SendAnswer> => {
  if (mine.get(act).length >= cap || !mine.add({ act, kind, character: STAGED_READER })) return 'busy';
  tallies.merge(act, { [kind]: (tallies.get(act)[kind] ?? 0) + 1 });
  return 'sent';
};

/** The tab stop of the React tile; a kind's is its key. */
const REACT_STOP = ' react'; /* a space: no reaction key has one */

/** One chip of the row: the kind's key, its words, its emoji, its count (none where the totals are hidden from the reader), and whether a press can still count. */
interface Chip { readonly key: string; readonly name: string; readonly emoji: string; readonly count: number | null; readonly open: boolean }

export function Reactions({ act, author, authorName = 'this character', tallies, mine, subject, pickerAt = 'row', plays = NO_PLAYS }: Props) {
  const { instance, ui, settings } = useKayfa();
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
  const staged = useStaged();
  const theirs = author !== null && player.characters.some((c) => c.id === author);
  /* The cards on this post that change its row (card notes, Part 3): the kinds a card added, and the totals a card hides until a time. */
  const here = usePlays(plays, act).plays;
  const kinds0 = localKindsOf(here, instance.cards);
  const ends = here.filter((p) => p.ends !== undefined).map((p) => Date.parse(p.ends!));
  const now = useAt(ends);
  const blind = blindPlaysOf(here, instance.cards, now);
  const blindUntil = blind.length === 0 ? null : blind.reduce((latest, b) => (Date.parse(b.ends) > Date.parse(latest) ? b.ends : latest), blind[0]!.ends);
  /* Who the reader is to the card is their own screen's fact, from their own characters; the totals came for the author's player and the caster alone. */
  const isAuthor = theirs;
  const caster = blind.some((b) => b.caster !== null && player.characters.some((c) => c.id === b.caster));
  const sees = blindUntil !== null && (isAuthor || caster);
  const hidden = blindUntil !== null && !sees;
  const label = (k: LocalKind | undefined) => (k === undefined ? null : ui.quadrantLabels[k.quadrant]);
  const kindOf = (key: string) => kinds0.find((k) => k.key === key);
  const ownKinds = [...new Set(own.map((o) => o.kind))];
  /* What is drawn: for a reader the totals are hidden from, only their own kinds and no count; else every kind the tally holds, the instance's first and then the kinds a card added. */
  const chipOf = (key: string, count: number | null): Chip | null => {
    const known = instance.reactions.find((r) => r.key === key);
    if (known) return { key, name: readable(key), emoji: known.emoji, count, open: true };
    const emoji = emojiOfKey(key);
    if (emoji === null) return null;
    const kind = kindOf(key);
    return { key, name: localName(emoji, label(kind)), emoji, count, open: kind?.ended !== true };
  };
  const counted = Object.keys(tally).filter((k) => (tally[k] ?? 0) > 0);
  const shownKeys = hidden ? ownKinds : [...instance.reactions.map((r) => r.key).filter((k) => counted.includes(k)), ...counted.filter((k) => !instance.reactions.some((r) => r.key === k)).sort()];
  const shown = shownKeys.flatMap((k) => { const c = chipOf(k, hidden ? null : tally[k] ?? 0); return c ? [c] : []; });
  const line = blindUntil === null ? null : sees
    ? `Only you${isAuthor && caster ? '' : ` and the ${isAuthor ? 'caster' : 'author'}`} can see these until ${dayAndTime(blindUntil)}.`
    : `Reaction totals are hidden on this post until ${dayAndTime(blindUntil)}.`;
  const as = staged ? null : player.hudCharacter;
  const canReact = !theirs && (staged || as !== null);
  /* One send for the row and its picker: one lock for the Act (send.ts). A staged page's is answered here, and sends nothing. */
  const sent = useReactionSend({ act, as, tallies, mine });
  const { send, busy } = staged ? { send: stagedSend(act, tallies, mine, settings.reactionCap), busy: false } : sent;
  /* A picker is for the character it was opened for: another character in the HUD closes it, and what was said of a reaction as the last one goes. */
  const asId = as?.id;
  useEffect(() => { setOpen(false); setSaid(''); }, [asId]);
  /* What an answer that comes back late is checked against: the HUD character and whether a press is possible now. */
  const live = useRef({ asId, canReact });
  live.current = { asId, canReact };
  if (shown.length === 0 && !canReact && line === null) return null;

  const kinds = new Set(own.map((o) => o.kind));
  const cap = settings.reactionCap;
  const left = Math.max(0, cap - kinds.size);
  const stops = [...(canReact ? shown.filter((r) => r.open).map((r) => r.key) : []), ...(canReact ? [REACT_STOP] : [])];
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
            const n = r.count;
            const yours = kinds.has(r.key);
            const face = (
              <span className="kb-meta-tile-in" aria-hidden="true"><span className="kb-reaction-emoji">{r.emoji}</span>{n === null ? '' : ` ${n}`}</span>
            );
            const common = { 'data-kb-reaction': r.key, 'data-kb-own': yours ? '' : undefined } as const;
            /* Where the totals are hidden the chip is the reader's own kind with no number; its name says so, as an own kind's does. */
            const said = n === null ? `${r.name}, yours` : `${r.name}, ${n}${yours ? ', including yours' : ''}`;
            if (!canReact || !r.open) {
              return (
                <li key={r.key}>
                  <span className="kb-meta-tile kb-reaction" {...common}>
                    <span className="kb-visually-hidden">{said}</span>
                    {face}
                  </span>
                </li>
              );
            }
            const name = n === null ? `${r.name}, yours`
              : yours ? `${r.name}, ${n}, including yours`
                : left === 0 ? `${r.name}, ${n}. You have left all ${cap} of your reactions on this post`
                  : `${r.name}, ${n}. React${as ? ` as ${as.name}` : ''}`;
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
      {line !== null && <p className="kb-reactions-line kb-small">{line}</p>}
      {canReact && <span role="status" className="kb-visually-hidden">{said}</span>}
      <Layers>
      {open && canReact && (
        <Picker
          subject={subject ?? `${authorName}'s post`} as={as} own={own} local={kinds0} send={send} busy={busy} refusal={refusal} anchor={pickerAt === 'button' ? button : row}
          onClose={(refocus) => { setOpen(false); if (refocus) button.current?.focus(); }}
        />
      )}
      </Layers>
    </div>
  );
}
