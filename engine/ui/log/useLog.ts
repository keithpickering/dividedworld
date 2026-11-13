/**
 * The player's log for Log.tsx and Settlement.tsx: the newest page and what its lines name (lines.ts's `LogData`) are the route's document
 * (`log_page`, the glass-load plan, Task 12); each older page is read when asked for. Every read is the player's own (the log, their standings and
 * announced Turns, their estimate) or a public Act, character or thread the lines link; none is asked about anyone but because a line of the
 * player's names it. Nothing here writes: the summary marks itself seen once it is drawn (Settlement.tsx).
 *
 * The document is the signed-in account's: the router reads it again for another account, and nothing of the last account's is drawn meanwhile.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Act, Estimate, EffectState, Id, KayfaApi, Log, MyCharacter } from '../data/api.ts';
import { estimateActIds, type LogDoc } from '../glass-docs.ts';
import { useNavigation } from '../router.tsx';
import { actsFollowed, actsNamed, type LogData } from './lines.ts';

/** Two pages as one: the older page's rows after the newer's, each settlement once, and the older page's cursor. */
export function mergeLogs(newer: Log, older: Log): Log {
  const have = new Set(newer.settlements.map((s) => s.id));
  return {
    settlements: [...newer.settlements, ...older.settlements.filter((s) => !have.has(s.id))],
    wallet: [...newer.wallet, ...older.wallet],
    cards: [...newer.cards, ...older.cards],
    packs: [...newer.packs, ...older.packs],
    playsOnMine: [...newer.playsOnMine, ...older.playsOnMine],
    writes: [...newer.writes, ...older.writes],
    saves: [...newer.saves, ...older.saves],
    setEnds: [...newer.setEnds, ...older.setEnds],
    caught: [...newer.caught, ...older.caught],
    ended: [...newer.ended, ...older.ended],
    infractions: [...newer.infractions, ...older.infractions],
    bans: [...newer.bans, ...older.bans],
    groupMoves: [...newer.groupMoves, ...older.groupMoves],
    reports: [...newer.reports, ...older.reports],
    appeals: [...newer.appeals, ...older.appeals],
    cosmetics: [...newer.cosmetics, ...older.cosmetics],
    falls: [...newer.falls, ...older.falls],
    before: older.before,
  };
}

/** The most ids one decorating read names (characters' names), as the adapter keeps its reads by id short. */
const CHUNK = 100;
const inChunks = <T,>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
/** A read that only decorates a line (a name, a title, a save's state): its failure leaves the line in plain words, never the page unread. */
const orElse = <T,>(read: Promise<T>, fallback: T) => read.catch(() => fallback);

/**
 * Everything the lines need beside the log itself, for the log as it stands. `before` is what was read for the pages already shown: the
 * first page is the route's document (`logDataOf`), and an older page reads only the Acts, names and states none of the pages before it named,
 * so a page costs its own lines.
 */
export async function around(api: KayfaApi, log: Log, own: LogData): Promise<LogData> {
  const ids = own.mine.map((c) => c.id);
  const acts = new Map(own.acts);
  const named = actsNamed(log, own.estimate, own.turns).filter((id) => !acts.has(id));
  /* The saves' states are read beside the Acts: they need only the plays' ids. */
  const plays = [...new Set(log.saves.map((s) => s.play))].filter((p) => !own.states.has(p));
  const [read, saved] = await Promise.all([
    named.length === 0 ? [] : api.actsById(named),
    plays.length === 0 ? {} : orElse(api.effectStates(plays), {}),
  ]);
  for (const a of read) acts.set(a.id, a);
  /* A card play names the post it landed on; a strike's card its spring; a spring what it caught or was sprung by, and that play's
     post. Two rounds reach each of them. */
  for (let round = 0; round < 2; round++) {
    const followed = actsFollowed(acts);
    if (followed.length === 0) break;
    for (const a of await api.actsById(followed)) acts.set(a.id, a);
  }
  const names = new Map(own.names);
  const staff = new Set(own.staff ?? []);
  /* A play beyond a post carries its target's name (play_card, 0056); one written without reads it as it stands, so only those are asked
     for: their characters' names, threads' titles and boards' names, in one pass over the card Acts. */
  const unnamed: { character: Id[]; thread: Id[]; board: Id[] } = { character: [], thread: [], board: [] };
  for (const a of acts.values()) {
    const reach = a.payload.reach;
    if (a.kind !== 'card' || typeof a.payload.targetName === 'string' || (reach !== 'character' && reach !== 'thread' && reach !== 'board')) continue;
    const target = a.payload[reach];
    if (typeof target === 'string') unnamed[reach].push(target);
  }
  /* A face-down card's Who names characters its setter's own line says by name (castWaits), though none of them is on the page. */
  const whoNamed = log.cards.flatMap((c) => c.who ?? []);
  /* A draw's drawer and a wash's washer are named by the lines about them, though none of their Acts is read (a draw's strokes stay out of the page). */
  const drawn = [...(log.draws ?? []), ...(log.wallsDrawn ?? [])].map((r) => r.character);
  const others = [...new Set([...acts.values()].map((a) => a.character).concat(unnamed.character, whoNamed, drawn).filter((c): c is Id => c !== null && !ids.includes(c) && !names.has(c)))];
  for (const part of await Promise.all(inChunks(others).map((chunk) => orElse(api.characters(chunk), [])))) for (const c of part) { names.set(c.id, c.name); if (c.staff !== undefined) staff.add(c.id); }
  const titles = new Map(own.titles);
  const threads = [...new Set(own.turns.map((t) => acts.get(t.act)?.thread).concat(unnamed.thread).filter((t): t is Id => t !== undefined && !titles.has(t)))];
  for (const t of await Promise.all(threads.map((id) => orElse(api.thread(id), null)))) if (t) titles.set(t.id, t.title);
  const boards = [...new Set(unnamed.board)].filter((b) => !titles.has(b));
  for (const b of await Promise.all(boards.map((id) => orElse(api.board(id), null)))) if (b) titles.set(b.id, b.name);
  const states = new Map(own.states);
  for (const [play, s] of Object.entries(saved as Readonly<Record<Id, EffectState>>)) states.set(play, s.state);
  return { ...own, log, acts, names, staff, titles, states };
}

/** The fixed pieces of the log's data: what the route's document read and the player's own rows. */
type Own = Omit<LogData, 'log' | 'acts' | 'names' | 'titles' | 'states'>;

/**
 * The log's data from the document: the first page and everything its lines name (`log_page`), and the player's own rows. The player's characters and the
 * next settlement are the player's (the frame's), the estimate is the document's (it may fill in later). A character's latest announced Turn is the line
 * (lines.ts): the document holds every announced Turn, and each character's latest is the one dated at its `classSince`.
 */
export function logDataOf(doc: LogDoc, mine: readonly MyCharacter[], nextSettlement: string | null, estimate: Estimate | null): LogData {
  const { page } = doc;
  /* Turns are the document's: a Turn taken while the page is open shows on the next read. */
  const ids = new Set(mine.map((c) => c.id));
  const names = new Map<Id, string>();
  const staff = new Set<Id>();
  for (const c of page.people) if (!ids.has(c.id)) { names.set(c.id, c.name); if (c.staff !== undefined) staff.add(c.id); }
  const titles = new Map<Id, string>();
  for (const t of page.threads) titles.set(t.id, t.title);
  for (const b of page.boards) titles.set(b.id, b.name);
  const states = new Map<Id, unknown>();
  for (const [play, s] of Object.entries(page.states as Readonly<Record<Id, EffectState>>)) states.set(play, s.state);
  return {
    log: page.log, mine, estimate, standings: page.standings, season: page.season, nextSettlement,
    turns: page.turns.filter((t) => mine.some((c) => c.id === t.character && Date.parse(c.classSince) === Date.parse(t.at))),
    acts: new Map([...page.acts, ...(doc.estimateActs ?? []), ...(doc.conduct?.acts ?? [])].map((a) => [a.id, a])), names, staff, titles: new Map([...titles, ...(doc.conduct?.titles ?? [])]), states,
    ...(doc.conduct ? { conduct: doc.conduct.rows } : {}),
  };
}

interface Held {
  readonly doc: LogDoc;
  /** The pages read so far, and what they name. */
  readonly log: Log;
  readonly acts: ReadonlyMap<Id, Act>;
  readonly names: ReadonlyMap<Id, string>;
  /** The staff characters among them: a Mod Bot's catching set card takes nothing, so a line about its catch says the card is spent. */
  readonly staff: ReadonlySet<Id>;
  readonly titles: ReadonlyMap<Id, string>;
  readonly states: ReadonlyMap<Id, unknown>;
  readonly estimate: Estimate | null;
  readonly older: 'idle' | 'loading' | 'failed';
}

/**
 * The player's log, from the route's document, with `older()` to read the next page below it. The document is one account's: the router reads it
 * again for another, and the page starts afresh when it does.
 */
export function useLog(api: KayfaApi, doc: LogDoc, mine: readonly MyCharacter[], nextSettlement: string | null) {
  const { track } = useNavigation();
  const [held, setHeld] = useState<Held>(() => heldOf(doc, mine, nextSettlement));
  const current = held.doc === doc ? held : heldOf(doc, mine, nextSettlement);
  if (current !== held) setHeld(current);

  const data = useMemo<LogData>(() => ({ ...logDataOf(doc, mine, nextSettlement, current.estimate), log: current.log, acts: current.acts, names: current.names, staff: current.staff, titles: current.titles, states: current.states }),
    [doc, mine, nextSettlement, current]);

  /* The estimate that was not in time fills in when it lands; the Acts its lines name, which the page did not, are read then. */
  useEffect(() => {
    const later = doc.estimateLater;
    if (!later) return undefined;
    let live = true;
    void later.then(async (estimate) => {
      if (!live || estimate === null) return;
      const want = estimateActIds(estimate, new Set(current.acts.keys()));
      const read = want.length === 0 ? [] : await orElse(api.actsById(want), [] as readonly Act[]);
      if (!live) return;
      setHeld((now) => (now.doc !== doc ? now : { ...now, estimate, acts: new Map([...now.acts, ...read.map((a) => [a.id, a] as const)]) }));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once for each document
  }, [api, doc]);

  const older = useCallback(() => {
    if (current.older === 'loading' || current.log.before === null) return;
    setHeld({ ...current, older: 'loading' });
    /* The read is the router's to count (the meter), and the button is busy while it is out. */
    track(api.log(current.log.before).then((page) => around(api, mergeLogs(current.log, page), data))).then(
      (next) => setHeld((now) => (now.doc === doc ? { ...now, log: next.log, acts: next.acts, names: next.names, staff: next.staff ?? new Set<Id>(), titles: next.titles, states: next.states, older: 'idle' } : now)),
      () => setHeld((now) => (now.doc === doc ? { ...now, older: 'failed' } : now)),
    );
  }, [api, doc, current, data, track]);

  return { data, older, olderState: current.older };
}

function heldOf(doc: LogDoc, mine: readonly MyCharacter[], nextSettlement: string | null): Held {
  const d = logDataOf(doc, mine, nextSettlement, doc.estimate);
  return { doc, log: d.log, acts: d.acts, names: d.names, staff: d.staff ?? new Set<Id>(), titles: d.titles, states: d.states, estimate: doc.estimate, older: 'idle' };
}
