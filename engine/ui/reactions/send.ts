/**
 * The one way a reaction is sent: the picker's path, which the reaction tiles take too, so the refusal,
 * the re-read of the player's own reactions and the estimate request are the same wherever a reaction is
 * pressed. A press does not send: `press` holds the kind in `mine` as the HUD character, and sends it only
 * when REACTION_GRACE_MS has passed; `undo` within that time sends nothing, ever. Each held kind has its own
 * timer; a due kind joins a queue that sends one at a time through `api.react`, as the character it was
 * pressed as (a mask change in the meantime does not change it), and nothing waiting is dropped. Each answer
 * goes to `onAnswer`: 'sent' (after the same `mine`, tally and estimate effects as ever) or the refusal to
 * show (the held kind released first).
 *
 * Leaving ends the grace early and does not end the reaction: unmounting sends what this hook holds at once,
 * and so does `pagehide`, with a keepalive request so it can outlive the page. Only the kinds this hook
 * pressed are flushed, so another row of the same Act closing does not send what this one holds.
 *
 * Call it once per Act: its queue is one per call, so a row of tiles and its picker share one hook.
 * `press` and `undo` are new functions each render; do not hold them in a dependency list.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, MyCharacter } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import type { Tallies } from '../thread/tallies.ts';
import { REACTION_GRACE_MS, type Mine, type Pending } from './mine.ts';

/* Kinds taken onto a queue and not yet answered, per `mine`: any row's undo reads it, so a kind on its way is never undone from another row. */
const taken = new WeakMap<Mine, Set<string>>();
const takenKey = (act: Id, kind: string): string => `${act}\u0000${kind}`;

export type SendAnswer = 'sent' | { readonly refusal: string } | 'busy';
export interface Answered { readonly kind: string; readonly character: Id; readonly answer: 'sent' | { readonly refusal: string } }

interface Args {
  readonly act: Id;
  readonly as: MyCharacter | null;
  readonly tallies: Tallies;
  readonly mine: Mine;
  readonly onAnswer: (a: Answered) => void;
}

export function useReactionSend({ act, as, tallies, mine, onAnswer }: Args): { press(kind: string): 'held' | 'busy'; undo(kind: string): boolean; busy: boolean } {
  const { api } = useKayfa();
  const player = usePlayer();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /* What a late timer or a send that outlives the row reads: the latest of each, never a stale render's. */
  const live = useRef({ api, player, tallies, mine, act, as, onAnswer });
  live.current = { api, player, tallies, mine, act, as, onAnswer };
  const own = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; pending: Pending }>());
  const queue = useRef<{ pending: Pending; keepalive: boolean }[]>([]);
  const draining = useRef(false);
  const hiding = useRef(false);

  const sendOne = async ({ pending, keepalive }: { pending: Pending; keepalive: boolean }): Promise<void> => {
    const { api, player, tallies, mine, act } = live.current;
    let answer: 'sent' | { refusal: string };
    try {
      const r = keepalive ? await api.react(act, pending.character, pending.kind, { keepalive: true }) : await api.react(act, pending.character, pending.kind);
      if (r.ok) {
        mine.add({ act, kind: pending.kind, character: pending.character });
        /* A blind post answers no tally to anyone: the screen holds none of its totals. */
        if (r.value.tally !== null) tallies.merge(act, r.value.tally);
        player.reactionLanded();
        answer = 'sent';
      } else {
        mine.release(act, pending.kind);
        /* A refusal may mean what this screen holds is stale (another tab left that kind): read the player's own again. */
        try { mine.merge(act, await api.myReactions([act])); } catch { /* the server's words are the answer, whatever the re-read did */ }
        answer = { refusal: r.error };
      }
    } catch {
      mine.release(act, pending.kind);
      answer = { refusal: 'The reaction could not be sent. Try again.' };
    }
    taken.get(mine)?.delete(takenKey(act, pending.kind));
    if (alive.current) live.current.onAnswer({ kind: pending.kind, character: pending.character, answer });
  };

  /* One send at a time on the Act's one lock; a kind that comes due while another is in flight waits its turn. */
  const drain = async (): Promise<void> => {
    if (draining.current) return;
    draining.current = true;
    if (alive.current) setBusy(true);
    try {
      for (let item = queue.current.shift(); item; item = queue.current.shift()) await sendOne(item);
    } finally {
      draining.current = false;
      if (alive.current) setBusy(false);
    }
  };

  /* A kind leaves this hook's map exactly once, by its timer, an undo or a flush, so it is never sent twice. */
  const take = (kind: string, keepalive: boolean): void => {
    const entry = own.current.get(kind);
    if (!entry) return;
    clearTimeout(entry.timer);
    own.current.delete(kind);
    /* Another row's undo may have released it from `mine` since: what `mine` no longer holds is never sent. */
    const { mine, act } = live.current;
    if (!mine.pending(act).includes(entry.pending)) return;
    taken.set(mine, (taken.get(mine) ?? new Set()).add(takenKey(act, kind)));
    queue.current.push({ pending: entry.pending, keepalive });
  };

  /* A kind released from `mine` by another row leaves this hook's map with its timer. */
  const prune = (): void => {
    const { mine, act } = live.current;
    const held = mine.pending(act);
    for (const [kind, entry] of [...own.current]) {
      if (held.includes(entry.pending)) continue;
      clearTimeout(entry.timer);
      own.current.delete(kind);
    }
    sync();
  };
  const pruneRef = useRef(prune);
  pruneRef.current = prune;
  useEffect(() => mine.subscribe(act, () => pruneRef.current()), [mine, act]);

  const flush = (keepalive: boolean): void => {
    for (const kind of [...own.current.keys()]) take(kind, keepalive);
    sync();
    void drain();
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const onHide = useRef((): void => flushRef.current(true)).current;

  /* The pagehide listener is on while this hook holds anything, off when it holds nothing. */
  function sync(): void {
    const want = own.current.size > 0;
    if (want && !hiding.current) { window.addEventListener('pagehide', onHide); hiding.current = true; }
    else if (!want && hiding.current) { window.removeEventListener('pagehide', onHide); hiding.current = false; }
  }
  useEffect(() => () => { flush(false); }, []);

  const press = (kind: string): 'held' | 'busy' => {
    const { as, mine, act } = live.current;
    if (!as) return 'busy';
    const pending: Pending = { act, kind, character: as.id, due: Date.now() + REACTION_GRACE_MS };
    if (!mine.hold(pending)) return 'busy';
    own.current.set(kind, { timer: setTimeout(() => { take(kind, false); sync(); void drain(); }, REACTION_GRACE_MS), pending });
    sync();
    return 'held';
  };

  const undo = (kind: string): boolean => {
    const { mine, act } = live.current;
    const entry = own.current.get(kind);
    if (!entry) {
      /* Held by another row of this Act (they share `mine`): release it, and that row's timer goes with it. */
      if (taken.get(mine)?.has(takenKey(act, kind)) || !mine.pending(act).some((p) => p.kind === kind)) return false;
      return mine.release(act, kind) !== null;
    }
    clearTimeout(entry.timer);
    own.current.delete(kind);
    mine.release(act, kind);
    sync();
    return true;
  };
  return { press, undo, busy };
}
