/**
 * The plain words the glass says about a move, from the engine's catalogs and never from the Boss: the long label on a move's
 * Act, the short "WAY OUT" segment, how a landed move ended, and a move as one sentence (engine/system/moves.ts, demands.ts).
 * The fiction may lie; the log never does: what a move is called here is what the code did, in the engine's own words, and the
 * Boss's lines are quoted as its own where they appear at all.
 *
 * Pure: no clock, no screen.
 */
import { demandAsk, demandKind } from '../../system/demands.ts';
import { moveKind, type MoveNames, type MoveParts } from '../../system/moves.ts';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { modRole } from '../cards/visit.ts';
import type { BoardName, Demand, KayfaApi, DemandProgress, MoveEnd, Office } from '../data/api.ts';
import type { UiCopy } from '../types.ts';
import { shortDate } from '../postbit/dates.ts';

/**
 * The long label of a move's Act ("The Boss renamed this board"; the glass draws it in capitals), the catalog's template filled with the
 * actor's role (`UiCopy.roleWord`, or a Mod Bot's own role word when Mod Bots move). A kind the catalog lacks is still said plainly.
 */
export const moveLabel = (kind: string, role: string): string => (moveKind(kind)?.label ?? '{role} made a move').replace('{role}', role);

/**
 * Who made a move, in the instance's words, as a sentence begins ("The Boss", "A Mod"). `office` is the one stamped on the move's Act when it landed (`payload.office`,
 * `moveOffice`), never the persona's office now: a Mod may make some of the Boss's moves, and the persona may hold another office later. `UiCopy.roleWord` is the Boss's; a Mod's is
 * `UiCopy.modRole`, else the engine's "A Mod". A move with no stamp (made before 0137, when only the Boss and the rule-setting Mods moved) is read as the Boss's.
 */
export const officeRole = (copy: Pick<UiCopy, 'roleWord' | 'modRole'>, office: Office | undefined): string => (office === 'mod' ? modRole(copy) : copy.roleWord);

/** The office stamped on a move's Act (`payload.office`), or undefined for a move from before the stamp. */
export const moveOffice = (payload: Readonly<Record<string, unknown>>): 'boss' | 'mod' | undefined => (payload['office'] === 'boss' || payload['office'] === 'mod' ? payload['office'] : undefined);

/**
 * The glass's short segment: "WAY OUT: 7 OF 12 POSTERS". A move that asks nothing ends only by its expiry or an admin; a demand
 * that could not be read (or that this build has no words for) says only that there is a way out, with the details one press away.
 */
export function wayOut(demand: Demand | null, progress: DemandProgress | null, expiresAt: string | null): string {
  const kind = demand ? demandKind(demand.kind) : undefined;
  if (kind && progress && !progress.error && progress.of > 0) return `WAY OUT: ${progress.done} OF ${progress.of} ${progress.of === 1 ? kind.unit.one : kind.unit.many}`;
  if (!demand && expiresAt) return `WAY OUT: RUNS OUT ${shortDate(expiresAt).toUpperCase()}`;
  return 'WAY OUT: DETAILS';
}

/**
 * How a landed move ended, in a few words for a moderation log: "in force", "undone: 12 posted", "ran out Oct 31", "reversed by an admin",
 * "ended at the handover" (a new Boss set it aside, or its review never came). A move a later Boss keeps says so (`keptBy`, that Boss's name).
 */
export function endedWords(end: MoveEnd | null, demand: Demand | null, keptBy?: string | null): string {
  const kept = keptBy ? `, kept by ${keptBy}` : '';
  return `${endedBase(end, demand)}${kept}`;
}

function endedBase(end: MoveEnd | null, demand: Demand | null): string {
  if (end === null) return 'in force';
  if (end.why === 'superseded') return 'ended at the handover';
  if (end.why === 'spent') return 'used up at the handover';
  if (end.why === 'unmet') return 'Stripped: the demand was not met by its check';
  if (end.why === 'overturned') return 'Ended: overturned on appeal';
  if (end.why === 'met' && demand?.kind === 'apologyAccepted') return 'Ended: an apology was accepted';
  if (end.why === 'met') {
    const met = demand ? demandKind(demand.kind)?.met(demand.params) : undefined;
    return met ? `undone: ${met}` : 'undone: its demand was met';
  }
  if (end.why === 'expired') return `ran out ${shortDate(end.at)}`;
  return end.by === 'admin' ? 'reversed by an admin' : 'reversed';
}

/** A move as one short sentence in pieces (see `MoveKind.parts`); a kind the catalog lacks is named, not guessed at. `names` fills the character, group and board a group move names. */
export function moveParts(kind: string, params: Readonly<Record<string, unknown>>, was: string | null, tense: 'done' | 'plan', names?: MoveNames): MoveParts {
  return moveKind(kind)?.parts(params, was, tense, names) ?? [`${tense === 'plan' ? 'Make' : 'Made'} a move this build has no words for (${kind})`];
}

/** What a move asks, without progress: for a move that has not landed. */
export const demandNeeds = (demand: Demand | null, kind?: string): string =>
  demand ? demandAsk(demand)
    : kind === 'nameSuccessor' ? 'It asks nothing: it ends at the handover, or when an admin reverses it.'
      : kind !== undefined && moveKind(kind)?.lasting ? 'It asks nothing and does not run out: it stays until an admin reverses it or a later move replaces it.'
        : 'It asks nothing: it ends at its expiry, or when an admin reverses it.';


/**
 * The boards a move names, by their names now: the board a rename or a thread move names (`board`), and for a merge the board that takes the threads (`into`) as the sentence's second
 * board and the one that closes (`board`) as `from`. A board the list does not hold is left out, and the sentence falls to its neutral words rather than name another.
 */
export function moveBoardNames(kind: string, params: Readonly<Record<string, unknown>>, boards: readonly BoardName[]): MoveNames {
  const named = (id: unknown) => boards.find((b) => b.id === id)?.name;
  if (kind === 'mergeBoard') {
    const into = named(params['into']);
    const closed = named(params['board']);
    return { ...(into !== undefined ? { board: into } : {}), ...(closed !== undefined ? { from: closed } : {}) };
  }
  const board = named(params['board']);
  return board !== undefined ? { board } : {};
}

/**
 * The title of the thread a `moveThread` moved and the board it left, read once for the move (`act` when it has landed, else the thread it will move): null until read, for another
 * kind, and when the thread cannot be read, so a sentence says "a thread" rather than guess.
 */
export function useMovedThread(kind: string, params: Readonly<Record<string, unknown>>, act: string | null | undefined, boards: readonly BoardName[]): Pick<MoveNames, 'thread' | 'from' | 'fromId'> | null {
  const { api } = useKayfa();
  const thread = kind === 'moveThread' && typeof params['thread'] === 'string' ? params['thread'] : null;
  const key = thread === null ? null : `${act ?? ''}|${thread}`;
  /* The answer is kept with the move it was read for, so a sentence handed another move shows nothing of the one before while the next is read. */
  const [got, setGot] = useState<{ readonly key: string; readonly title: string; readonly from: string | null } | null>(null);
  useEffect(() => {
    if (thread === null || key === null) return;
    let live = true;
    setGot(null);
    void movedThreadNames(api, { thread, act: act ?? null }).then((r) => { if (live && r) setGot({ key, ...r }); });
    return () => { live = false; };
  }, [api, thread, act, key]);
  if (got === null || got.key !== key || got.title === '') return null;
  const from = got.from === null ? undefined : boards.find((b) => b.id === got.from)?.name;
  return { thread: got.title, ...(from !== undefined && got.from !== null ? { from, fromId: got.from } : {}) };
}

/** The most items one `moveThreadNames` call carries (the server reads that many). */
const NAMES_PER_CALL = 50;
interface Batch { readonly items: Map<string, { thread: string; act: string | null }>; readonly waiting: Map<string, ((r: { title: string; from: string | null } | null) => void)[]> }
const batches = new WeakMap<object, Batch>();

/**
 * The names of a moved thread, asked for by every sentence of a page in the same tick and read with one `moveThreadNames` call (and one more for each further 50), not one for a row:
 * a page of the queue or the log draws a sentence per move. A failed read answers null, and the sentence says "a thread".
 */
function movedThreadNames(api: KayfaApi, item: { thread: string; act: string | null }): Promise<{ title: string; from: string | null } | null> {
  const key = item.act ?? item.thread;
  let batch = batches.get(api);
  if (!batch) {
    batch = { items: new Map(), waiting: new Map() };
    batches.set(api, batch);
    const mine = batch;
    queueMicrotask(() => setTimeout(() => {
      batches.delete(api);
      const all = [...mine.items.values()];
      for (let i = 0; i < all.length; i += NAMES_PER_CALL) {
        const chunk = all.slice(i, i + NAMES_PER_CALL);
        api.moveThreadNames(chunk).then(
          (got) => { for (const c of chunk) for (const done of mine.waiting.get(c.act ?? c.thread) ?? []) done(got[c.act ?? c.thread] ?? null); },
          () => { for (const c of chunk) for (const done of mine.waiting.get(c.act ?? c.thread) ?? []) done(null); },
        );
      }
    }, 0));
  }
  batch.items.set(key, item);
  return new Promise((resolve) => { batch.waiting.set(key, [...(batch.waiting.get(key) ?? []), resolve]); });
}
