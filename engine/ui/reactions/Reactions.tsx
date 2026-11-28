/**
 * The reactions under a post, drawn as meta tiles (engine/ui/glass/meta-tile.css; the meta acts design, sections 1, 5 and 6): one
 * tile for each kind with a count (the player's own ringed, on their screen only) and a React tile that opens the picker, unless
 * the post is by one of the player's own characters, where the tiles are plain and there is no React. A tile that is a button
 * holds a reaction with its kind as the HUD character (send.ts: one `useReactionSend` call for the row, whose queue the picker shares).
 * A press does not send: it is pending on this screen for REACTION_GRACE_MS (reaction-grace design, sections 2 to 5), drawn as a chip
 * whose count is one more, with a ring that drains; a press on the pending tile is an undo, which sends nothing, ever. The send is
 * the grace's end. A refusal then is shown in a note under the row, and opens nothing. The row's buttons are one tab stop,
 * moved along by the arrow keys. Only the player's own screen knows which characters are theirs, and nothing here says who reacted.
 * A pending kind counts as the player's own toward the cap and the one-of-a-kind rule.
 *
 * On a staged page (staged.ts: the front door's sample thread) the reader needs no character: React is on every post, a press is
 * pending with the same grace and the same undo, and at its end answered on their screen alone (the kind is theirs in `mine`, its
 * count grows by one), nothing is sent or estimated, and the words name no mask.
 *
 * A reaction this screen just left lands with the stamp (reactions.css), when the server answers and not at the press: the tile gives
 * under the press, the emoji leaps and slams back, a ring in its quadrant's class color stamps down onto the tile and settles into the
 * player's own ring, shards burst from it and the count rolls up. It plays on the reactor's screen alone, for their own press, and
 * never for a reaction that arrives from anyone else, so it says nothing about who reacted.
 * Under Off (the player's Motion setting, or the device's reduced motion) nothing moves: the ring and the count are simply there, and
 * a pending tile shows the seconds left as text, for the same 5 seconds.
 */
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { blindPlaysOf, createPlays, localKindsOf, useAt, usePlays, type LocalKind, type Plays } from '../cards/plays.ts';
import { dayAndTime } from '../characters/format.ts';
import { emojiOfKey } from '../../rules/emoji.ts';
import { useKayfa } from '../context.tsx';
import type { Id, MyCharacter, MyReaction } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useTally, type Tallies } from '../thread/tallies.ts';
import { REACTION_GRACE_MS, useMine, usePending, type Mine, type Pending } from './mine.ts';
import { Picker } from './Picker.tsx';
import type { Chip, Landed, ReactionDeck } from './deck.ts';

export type { Chip, Landed, ReactionDeck };
import { useReactionSend, type Answered } from './send.ts';
import { Tooltip } from '../glass/index.ts';
import '../cards/kit.css';
import '../glass/meta-tile.css';
import './reactions.css';
import { Layers } from '../glass/layer.tsx';
import { useStaged } from '../staged.ts';
import { useMotionReduced } from '../appearance.ts';
import type { Quadrant } from '../../rules/types.ts';

/** The tooltip's words on a press of your own sent kind, in the row and in the picker (reaction-grace design, section 7). */
export const CANT_TAKE_BACK = "Reactions can't be taken back.";

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

/** Who a staged page's reader is to `mine`: no character, and nothing is sent as one. */
const STAGED_READER = 'staged:reader';

/** The seconds left on a pending kind, whole and rounded up, never under one: what its name and the reduced-motion text say. */
const secondsLeft = (p: Pending): number => Math.max(1, Math.ceil((p.due - Date.now()) / 1000));

/** What a post's row says where a card draws its reactions (`CardUi.drawsReactions`). */
export const LOOSE_LINE = "This post's reactions are loose inside it.";

/** The tab stop of the React tile; a kind's is its key. */
const REACT_STOP = ' react'; /* a space: no reaction key has one */


/** The shards a stamp throws, one every 360/SHARDS degrees (reactions.css lays each by its index). */
const SHARDS = 8;
/**
 * How long a stamp's marks stay on the tile: the longest the stamp runs (reactions.css: the Smooth feel's, after the picker's exit at
 * its longest), and a margin. Clearing it later than it ends costs nothing; the marks are spent by then.
 */
const STAMP_MS = 1400;


/**
 * What a post's reactions row draws as chips, and the one line it says under them where a card hides the totals: the tally, the reader's own and pending kinds, and the blind plays' hiding. `Reactions` draws these
 * as buttons; the Lens's compact ended row draws the same chips as plain text, so whatever hides a total from a reader on the row hides it there too. `author` is the Act's author, for who the reader is to the card.
 */
export function useReactionChips(act: Id, author: Id | null, tallies: Tallies, mine: Mine, plays: Plays = NO_PLAYS) {
  const { instance, ui } = useKayfa();
  const player = usePlayer();
  const tally = useTally(tallies, act);
  const own = useMine(mine, act);
  const waiting = usePending(mine, act);
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
  const pendingOf = (key: string) => waiting.find((p) => p.kind === key) ?? null;
  /* What is drawn: for a reader the totals are hidden from, only their own kinds and no count; else every kind the tally holds, the instance's first and then the kinds a card added. */
  const chipOf = (key: string, count: number | null): Chip | null => {
    const known = instance.reactions.find((r) => r.key === key);
    const pending = pendingOf(key);
    if (known) return { key, name: readable(key), emoji: known.emoji, quadrant: known.quadrant, count, open: true, pending };
    const emoji = emojiOfKey(key);
    if (emoji === null) return null;
    const kind = kindOf(key);
    return { key, name: localName(emoji, label(kind)), emoji, quadrant: kind?.quadrant ?? null, count, open: kind?.ended !== true, pending };
  };
  /* A pending kind is drawn as its tally's count and one more (its own press), and a kind with no chip yet gets one. */
  const counted = [...new Set([...Object.keys(tally).filter((k) => (tally[k] ?? 0) > 0), ...waiting.map((p) => p.kind)])];
  const shownKeys = hidden ? [...new Set([...ownKinds, ...waiting.map((p) => p.kind)])] : [...instance.reactions.map((r) => r.key).filter((k) => counted.includes(k)), ...counted.filter((k) => !instance.reactions.some((r) => r.key === k)).sort()];
  const shown = shownKeys.flatMap((k) => { const c = chipOf(k, hidden ? null : (tally[k] ?? 0) + (pendingOf(k) === null ? 0 : 1)); return c ? [c] : []; });
  const line = blindUntil === null ? null : sees
    ? `No other player${isAuthor && caster ? '' : ` but the ${isAuthor ? 'caster' : 'author'}`} can see these until ${dayAndTime(blindUntil)}.`
    : `Reaction totals are hidden on this post until ${dayAndTime(blindUntil)}.`;
  return { shown, line, kinds0, own, waiting } as const;
}

/** Everything a post's reactions row does, for `Reactions` to draw as tiles or for a card to draw its own way (`useReactionRow`). */
export interface ReactionRow extends ReactionDeck {
  readonly line: string | null;
  readonly local: readonly LocalKind[];
  readonly as: MyCharacter | null;
  readonly busy: boolean;
  /** The row's polite status words. */
  readonly said: string;
  readonly cap: number;
  /** What counts as the player's own on this post: what was sent and what is pending. */
  readonly kinds: ReadonlySet<string>;
  readonly left: number;
  /** A free kind starts its grace (the cap is read as it is now). */
  readonly start: (kind: string) => 'held' | 'busy';
  readonly clearRefusal: () => void;
  readonly picker: ReactionDeck['picker'] & {
    /** Open for the row: `back` is the element focus goes back to when the picker closes by itself. */
    readonly openFor: (anchor: RefObject<HTMLElement | null>, back: RefObject<HTMLElement | null>) => void;
    /** The picker's layer, drawn where the post wants it. */
    readonly node: ReactNode;
  };
}

interface RowArgs {
  readonly act: Id;
  readonly author: Id | null;
  readonly authorName?: string;
  readonly tallies: Tallies;
  readonly mine: Mine;
  readonly subject?: string;
  readonly plays?: Plays;
}

/** What a picker is open for: where it opens, whether it offers only new kinds, and where focus goes back to. */
interface PickerAt { readonly anchor: RefObject<HTMLElement | null>; readonly onlyNew: boolean; readonly back: RefObject<HTMLElement | null> | null }

/**
 * What a post's reactions row does: the chips, the reader's own and pending kinds, the grace and its undo, the cap and the one-of-a-kind rule, the send queue (one for the row and its picker), the
 * refusal under the row, the stamp's landed kind and the picker's open state. `Reactions` draws it as tiles; a card that draws the reactions is given it as `EffectProps.reactions` (design, section 1.3).
 */
export function useReactionRow({ act, author, authorName = 'this character', tallies, mine, subject, plays = NO_PLAYS }: RowArgs): ReactionRow {
  const { settings } = useKayfa();
  const player = usePlayer();
  const { shown, line, kinds0, own, waiting } = useReactionChips(act, author, tallies, mine, plays);
  const [picking, setPicking] = useState<PickerAt | null>(null);
  /* The server's words for a reaction refused at its send: under the row until the next press on it. */
  const [rowRefusal, setRowRefusal] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const staged = useStaged();
  const theirs = author !== null && player.characters.some((c) => c.id === author);
  const as = staged ? null : player.hudCharacter;
  const canReact = !theirs && (staged || as !== null);
  /* One send for the row and its picker: one queue for the Act (send.ts). A staged page's is its own, below, and sends nothing. */
  const [landed, setLanded] = useState<Landed | null>(null);
  const stamped = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(stamped.current), []);
  const openNow = useRef(picking !== null);
  openNow.current = picking !== null;
  /* A picker is for the character it was opened for: another character in the HUD closes it, and what was said of a reaction as the last one goes. */
  const asId = as?.id;
  useEffect(() => { setPicking(null); setSaid(''); }, [asId]);
  /* What an answer that comes back late is checked against: the HUD character and whether a press is possible now. */
  const live = useRef({ asId, canReact });
  live.current = { asId, canReact };
  /* The stamp: a reaction that counts, for the character it was pressed as, lands with the stamp when it is sent, and the status says so. */
  const landedNow = (kind: string, character: Id): void => {
    if (live.current.asId !== (staged ? undefined : character) || !live.current.canReact) return;
    clearTimeout(stamped.current);
    setLanded({ key: kind, after: openNow.current });
    stamped.current = setTimeout(() => setLanded(null), STAMP_MS);
    const who = staged ? undefined : player.characters.find((c) => c.id === character)?.name;
    setSaid(`Reacted with ${readable(kind)}${who ? ` as ${who}` : ''}`);
  };
  /* The send at the grace's end (the hook's `onAnswer`): the stamp for a reaction that counted, the server's words under the row for one refused (it opens nothing). */
  const answered = ({ kind, character, answer }: Answered): void => {
    if (answer === 'sent') { landedNow(kind, character); return; }
    setSaid('');
    setRowRefusal(answer.refusal);
  };
  const sent = useReactionSend({ act, as, tallies, mine, onAnswer: answered });
  /* A staged page's pending kinds: the same grace, its own timers, and at their end what a staged send does, on this screen alone. */
  const cap = settings.reactionCap;
  const stagedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const stagedPress = (kind: string): 'held' | 'busy' => {
    const pending: Pending = { act, kind, character: STAGED_READER, due: Date.now() + REACTION_GRACE_MS };
    if (!mine.hold(pending)) return 'busy';
    stagedTimers.current.set(kind, setTimeout(() => {
      stagedTimers.current.delete(kind);
      /* Released by an undo from elsewhere meanwhile: nothing to land. */
      if (!mine.pending(act).includes(pending)) return;
      /* The cap and the one-of-a-kind rule are held here as the server holds them in play. */
      if (mine.get(act).length >= cap || !mine.add({ act, kind, character: STAGED_READER })) { mine.release(act, kind); return; }
      tallies.merge(act, { [kind]: (tallies.get(act)[kind] ?? 0) + 1 });
      landedNow(kind, STAGED_READER);
    }, REACTION_GRACE_MS));
    return 'held';
  };
  const stagedUndo = (kind: string): boolean => {
    clearTimeout(stagedTimers.current.get(kind));
    stagedTimers.current.delete(kind);
    return mine.release(act, kind) !== null;
  };
  /* Leaving ends a staged kind's grace early and does not end the reaction (design, section 5): each held kind lands locally at once, as it would at its end, with no stamp (nobody is left to see it) and no request. */
  useEffect(() => () => {
    for (const [kind, timer] of stagedTimers.current) {
      clearTimeout(timer);
      const held = mine.pending(act).find((p) => p.kind === kind);
      if (held === undefined) continue;
      if (mine.get(act).length >= cap || !mine.add({ act, kind, character: STAGED_READER })) { mine.release(act, kind); continue; }
      tallies.merge(act, { [kind]: (tallies.get(act)[kind] ?? 0) + 1 });
    }
    stagedTimers.current.clear();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the latest cap and stores are read as it unmounts
  }, [mine, act]);
  const busy = staged ? false : sent.busy;
  /* The seconds on a pending tile's name (and the reduced-motion text) are read at render: the row renders once a second while anything is pending. */
  const [, tick] = useState(0);
  const holding = waiting.length > 0;
  useEffect(() => {
    if (!holding) return;
    const every = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(every);
  }, [holding]);

  const kinds = new Set([...own.map((o) => o.kind), ...waiting.map((p) => p.kind)]);
  const left = Math.max(0, cap - kinds.size);
  /* A free kind starts its grace. The cap is read from `mine` as it is now, not as the last render drew it: two presses in one tick are each decided on what the one before left. */
  const start = (key: string): 'held' | 'busy' => {
    if (!canReact) return 'busy';
    if (mine.get(act).length + mine.pending(act).length >= cap) return 'busy';
    const r = staged ? stagedPress(key) : sent.press(key);
    if (r === 'held') setSaid(`Reacting with ${readable(key)}${as ? ` as ${as.name}` : ''} in ${REACTION_GRACE_MS / 1000} seconds`);
    return r;
  };
  /* A pending kind's press is its undo: it sends nothing, ever. */
  const undo = (key: string): void => {
    setRowRefusal(null);
    if (staged ? stagedUndo(key) : sent.undo(key)) setSaid(`${readable(key)} undone`);
  };
  const press = (key: string): 'held' | 'busy' | 'undone' | 'kept' => {
    if (!canReact) return 'busy';
    setRowRefusal(null);
    if (mine.pending(act).some((p) => p.kind === key)) { undo(key); return 'undone'; }
    if (mine.get(act).some((o) => o.kind === key)) return 'kept';
    return start(key);
  };
  const openAt = (anchor: HTMLElement | RefObject<HTMLElement | null>, onlyNew: boolean, back: RefObject<HTMLElement | null> | null) => {
    if (!canReact) return;
    setRowRefusal(null);
    setPicking({ anchor: anchor instanceof HTMLElement ? { current: anchor } : anchor, onlyNew, back });
  };
  const node = (
    <Layers>
      {picking !== null && canReact && (
        <Picker
          subject={subject ?? `${authorName}'s post`} as={as} own={own} pending={waiting} local={kinds0} press={(k) => { setRowRefusal(null); return start(k); }} undo={undo} anchor={picking.anchor}
          {...(picking.onlyNew ? { onlyNew: true as const, onPost: shown.map((c) => c.key) } : {})}
          onClose={(refocus) => { setPicking(null); if (refocus) picking.back?.current?.focus(); }}
        />
      )}
    </Layers>
  );
  return {
    chips: shown, line, local: kinds0, own, pending: waiting, canReact, as, busy, said, cap, kinds, left, press, start, undo, clearRefusal: () => setRowRefusal(null), refusal: rowRefusal, landed,
    picker: { isOpen: picking !== null, open: (anchor, onlyNew) => openAt(anchor, onlyNew === true, null), openFor: (anchor, back) => openAt(anchor, false, back), close: () => setPicking(null), node },
  };
}

/** What a post gives the reactions row it holds: the one row its Acts' tiles and its card's deck both draw from (`ReactionRowScope`). */
interface Held { readonly act: Id; readonly author: Id | null; readonly row: ReactionRow; readonly loose: boolean }
const RowCtx = createContext<Held | null>(null);

/** The deck a post gives its effects, where a card that draws the reactions is live on it; undefined everywhere else. */
export const useReactionDeck = (): ReactionDeck | undefined => {
  const held = useContext(RowCtx);
  return held !== null && held.loose ? held.row : undefined;
};

/**
 * One reaction row for a post, held above the post's words and its row so that both the row's tiles and a card's effect draw from the same one (a second would be a second send queue
 * for the Act). `loose` is whether a card that draws the reactions is live on the post: the row then draws its bar with one line, and the picker is drawn here, where no tile opens it.
 */
export function ReactionRowScope({ on, loose, children, ...args }: RowArgs & { readonly on: boolean; readonly loose: boolean; readonly children: ReactNode }) {
  if (!on) return <>{children}</>;
  return <ScopeOn loose={loose} {...args}>{children}</ScopeOn>;
}
function ScopeOn({ loose, children, ...args }: RowArgs & { readonly loose: boolean; readonly children: ReactNode }) {
  const row = useReactionRow(args);
  return <RowCtx.Provider value={{ act: args.act, author: args.author, row, loose }}>{children}{loose && row.picker.node}</RowCtx.Provider>;
}

/** The row drawn as tiles, from one's own `useReactionRow`, or the post's, where its scope holds the row for this Act and author. */
export function Reactions(props: Props) {
  const held = useContext(RowCtx);
  if (held !== null && held.act === props.act && held.author === props.author) return <RowView {...props} row={held.row} loose={held.loose} />;
  return <OwnRow {...props} />;
}
function OwnRow(props: Props) {
  const row = useReactionRow({ act: props.act, author: props.author, ...(props.authorName === undefined ? {} : { authorName: props.authorName }), tallies: props.tallies, mine: props.mine, ...(props.subject === undefined ? {} : { subject: props.subject }), ...(props.plays === undefined ? {} : { plays: props.plays }) });
  return <RowView {...props} row={row} loose={false} />;
}

function RowView({ pickerAt = 'row', row, loose }: Props & { readonly row: ReactionRow; readonly loose: boolean }) {
  const { ui } = useKayfa();
  const player = usePlayer();
  const { chips: shown, line, canReact, as, busy, said, cap, kinds, left, landed, refusal: rowRefusal } = row;
  const waiting = row.pending;
  /* The row's one tab stop: the last tile focused, else React where there is one, else the first tile. */
  const [stop, setStop] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  /* The tooltip of an own sent tile (one open at a time): the kind it stands on, the tile it stands by, and a count that restarts its 3 seconds. */
  const [tipKind, setTipKind] = useState<string | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [tipRestart, setTipRestart] = useState(0);
  const tipAt = useRef<HTMLElement | null>(null);
  const rowEl = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced();
  const asId = as?.id;
  useEffect(() => { setTipOpen(false); }, [asId]);
  /*
   * What was left of a pending kind's grace when this row first drew it, kept for as long as the kind is pending. The ring's animation-delay is
   * made from it (reactions.css), and a running animation keeps its start when its delay changes, so a delay recomputed at each of the
   * once-a-second renders would push the ring along and drain it too fast. Another row of the Act, drawn partway, has its own record and so
   * starts from the true time left.
   */
  const firstLefts = useRef(new WeakMap<Pending, number>());
  const firstLeft = (p: Pending): number => {
    const known = firstLefts.current.get(p);
    if (known !== undefined) return known;
    const left = Math.max(0, p.due - Date.now());
    firstLefts.current.set(p, left);
    return left;
  };
  /* A card that draws the reactions has them loose in the post: the row keeps its bar and says where they went. */
  if (loose) {
    return (
      <div ref={rowEl} className="kb-reactions" data-kb-over-ink="" data-kb-loose="">
        <p className="kb-reactions-line kb-small">{LOOSE_LINE}</p>
      </div>
    );
  }
  if (shown.length === 0 && !canReact && line === null) return null;
  const stops = [...(canReact ? shown.filter((r) => r.open).map((r) => r.key) : []), ...(canReact ? [REACT_STOP] : [])];
  const current = stop !== null && stops.includes(stop) ? stop : (stops.includes(REACT_STOP) ? REACT_STOP : stops[0]);

  const pressed = (key: string, el: HTMLElement) => {
    row.clearRefusal();
    if (waiting.some((p) => p.kind === key)) { row.undo(key); return; }
    /* Your own sent kind: it can't be taken back, and the tooltip says so; a press while it is open gives it a fresh 3 seconds. */
    if (row.own.some((o) => o.kind === key)) {
      tipAt.current = el;
      if (tipOpen && tipKind === key) setTipRestart((n) => n + 1); else { setTipKind(key); setTipOpen(true); }
      return;
    }
    row.start(key);
  };

  /* Left and Right along the row's buttons (no wrap), Home and End to the ends; only its own buttons answer, not the picker's, whose events pass through here. */
  const move = (e: KeyboardEvent) => {
    const all = [...(rowEl.current?.querySelectorAll<HTMLElement>('[data-kb-stop]') ?? [])];
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
      ref={rowEl} className="kb-reactions" data-kb-over-ink="" aria-busy={busy || undefined}
      onKeyDown={move} onFocus={(e) => { const s = (e.target as HTMLElement).dataset['kbStop']; if (s !== undefined) setStop(s); }}
    >
      {shown.length > 0 && (
        <ul className="kb-reaction-list" aria-label="Reactions">
          {shown.map((r) => {
            const n = r.count;
            const waits = r.pending;
            const left5 = waits === null ? 0 : secondsLeft(waits);
            /* Sent and kept by this screen: a pending kind is not yours yet (its press is an undo). */
            const yours = waits === null && kinds.has(r.key);
            const face = (
              <span className="kb-meta-tile-in" aria-hidden="true">
                <span className="kb-reaction-emoji">{r.emoji}</span>
                {n === null ? '' : <>{' '}<span className="kb-reaction-count"><span key={n}>{n}</span></span></>}
                {waits !== null && reduced && <span className="kb-reaction-grace">{left5}</span>}
              </span>
            );
            const common = { 'data-kb-reaction': r.key, 'data-kb-own': yours ? '' : undefined } as const;
            /* The stamp's color: the class the instance gives the kind's quadrant, else the glass's ready gold (reactions.css). */
            const cls = r.quadrant === null ? undefined : ui.quadrantClasses?.[r.quadrant];
            /* A pending tile also carries its grace: the whole of it and what is left, which reactions.css starts the ring from. */
            const style = {
              ...(cls === undefined ? {} : { '--kb-reaction-hue': `var(--kb-glass-class-${cls}-large)` }),
              ...(waits === null ? {} : { '--kb-grace-ms': `${REACTION_GRACE_MS}ms`, '--kb-grace-due': `${firstLeft(waits)}ms` }),
            } as CSSProperties;
            const stamp = landed?.key === r.key ? (landed.after ? 'after' : 'now') : undefined;
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
            /* A pending tile says who it will go out as (the mask it was pressed as, which a switch in the HUD does not change), and how to undo. */
            const waitsAs = waits === null || waits.character === STAGED_READER ? undefined : player.characters.find((c) => c.id === waits.character)?.name;
            const name = waits !== null ? `${r.name}${n === null ? ', yours' : ''}, sending in ${left5} ${left5 === 1 ? 'second' : 'seconds'}${waitsAs ? ` as ${waitsAs}` : ''}. Press again to undo`
              : n === null ? `${r.name}, yours${yours ? ", can't be taken back" : ''}`
              : yours ? `${r.name}, ${n}, including yours, can't be taken back`
                : left === 0 ? `${r.name}, ${n}. You have left all ${cap} of your reactions on this post`
                  : `${r.name}, ${n}. React${as ? ` as ${as.name}` : ''}`;
            return (
              <li key={r.key}>
                <button
                  type="button" className="kb-meta-tile kb-reaction" {...common} aria-label={name} aria-disabled={waits === null && (yours || left === 0) ? 'true' : undefined}
                  data-kb-stop={r.key} tabIndex={current === r.key ? 0 : -1} onClick={(e) => pressed(r.key, e.currentTarget)}
                  data-kb-landed={stamp} data-kb-pending={waits === null ? undefined : ''}
                  data-kb-sending={waits !== null && busy && waits.due <= Date.now() ? '' : undefined} style={style}
                >
                  {face}
                  {stamp !== undefined && !reduced && (
                    <span className="kb-reaction-stamp" aria-hidden="true">
                      <span className="kb-reaction-seal" />
                      <span className="kb-reaction-wave" />
                      {Array.from({ length: SHARDS }, (_, i) => (
                        <span key={i} className="kb-reaction-shard" style={{ '--kb-shard': i } as CSSProperties} />
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {canReact && (
        <button
          ref={button} type="button" className="kb-meta-tile kb-reaction kb-react-button" aria-haspopup="dialog" aria-expanded={row.picker.isOpen}
          data-kb-stop={REACT_STOP} tabIndex={current === REACT_STOP ? 0 : -1} onClick={() => { row.clearRefusal(); if (row.picker.isOpen) row.picker.close(); else row.picker.openFor(pickerAt === 'button' ? button : rowEl, button); }}
        >
          <span className="kb-meta-tile-in"><span aria-hidden="true">+ </span>React</span>
        </button>
      )}
      {/* Mounted from the first press on, so its exit plays when it closes, and keyed by the last kind pressed: a press on another own tile moves it there, and a quiet row holds no tooltip. */}
      {tipKind !== null && <Tooltip key={tipKind} anchor={tipAt} open={tipOpen} onClose={() => setTipOpen(false)} restart={tipRestart}>{CANT_TAKE_BACK}</Tooltip>}
      {rowRefusal !== null && <p className="kb-notice kb-reactions-refusal" data-kb-tone="refusal" role="alert">{rowRefusal}</p>}
      {line !== null && <p className="kb-reactions-line kb-small">{line}</p>}
      {canReact && <span role="status" className="kb-visually-hidden" data-kb-row-status="">{said}</span>}
      {row.picker.node}
    </div>
  );
}
