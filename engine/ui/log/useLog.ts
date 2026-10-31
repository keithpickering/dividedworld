/**
 * Reading the player's log for Log.tsx and Settlement.tsx: the newest page of `KayfaApi.log`, each
 * older page when asked for, and what its lines name (lines.ts's `LogData`). Every read is the
 * player's own (the log, their characters, their estimate, their standings and announced Turns) or a
 * public Act, character or thread the lines link; none is asked about anyone but because a line of
 * the player's names it.
 *
 * The reading is the signed-in account's: another account signing in reads afresh, and nothing of the
 * last account's is drawn meanwhile (the key below, as RankingsScreen keys its read).
 */
import { useCallback, useEffect, useState } from 'react';
import type { Act, EffectState, Id, KayfaApi, Log } from '../data/api.ts';
import { actsNamed, type LogData } from './lines.ts';

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly key: string }
  | { readonly status: 'ready'; readonly key: string; readonly data: LogData; readonly older: 'idle' | 'loading' | 'failed' };

/** Two pages as one: the older page's rows after the newer's, each settlement once, and the older page's cursor. */
export function mergeLogs(newer: Log, older: Log): Log {
  const have = new Set(newer.settlements.map((s) => s.id));
  return {
    settlements: [...newer.settlements, ...older.settlements.filter((s) => !have.has(s.id))],
    wallet: [...newer.wallet, ...older.wallet],
    cards: [...newer.cards, ...older.cards],
    playsOnMine: [...newer.playsOnMine, ...older.playsOnMine],
    saves: [...newer.saves, ...older.saves],
    before: older.before,
  };
}

/** The most ids one decorating read names (characters' names), as the adapter keeps its reads by id short. */
const CHUNK = 100;
const inChunks = <T,>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
/** A read that only decorates a line (a name, a title, a save's state): its failure leaves the line in plain words, never the page unread. */
const orElse = <T,>(read: Promise<T>, fallback: T) => read.catch(() => fallback);

/**
 * Everything the lines need beside the log itself, for the log as it stands. `before` is what was read for the pages already
 * shown: the player's own state (characters, estimate, standings, season, announced Turns) is read once, with the first page,
 * and an older page reads only the Acts, names and states none of the pages before it named, so a page costs its own lines.
 */
async function around(api: KayfaApi, log: Log, before?: LogData): Promise<LogData> {
  const own = before ?? await (async () => {
    const mine = await api.myCharacters();
    const ids = mine.map((c) => c.id);
    const [estimate, standings, season, announced] = await Promise.all([
      api.estimate().catch(() => null),
      ids.length === 0 ? {} : api.standingAmounts(ids),
      api.season(),
      ids.length === 0 ? [] : api.turnsAnnounced(ids),
    ]);
    /* Only a character's latest Turn is a line (lines.ts), so only its announcement is named. */
    const turns = announced.filter((t) => mine.some((c) => c.id === t.character && Date.parse(c.classSince) === Date.parse(t.at)));
    return { mine, estimate, standings, season, turns, acts: new Map<Id, Act>(), names: new Map<Id, string>(), titles: new Map<Id, string>(), states: new Map<Id, unknown>() };
  })();
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
  /* A card play names the post it landed on. */
  const targets = [...acts.values()].filter((a) => a.kind === 'card' && a.targetActId && !acts.has(a.targetActId)).map((a) => a.targetActId!);
  for (const a of targets.length === 0 ? [] : await api.actsById(targets)) acts.set(a.id, a);
  const names = new Map(own.names);
  const others = [...new Set([...acts.values()].map((a) => a.character).filter((c): c is Id => c !== null && !ids.includes(c) && !names.has(c)))];
  for (const part of await Promise.all(inChunks(others).map((chunk) => orElse(api.characters(chunk), [])))) for (const c of part) names.set(c.id, c.name);
  const titles = new Map(own.titles);
  const threads = [...new Set(own.turns.map((t) => acts.get(t.act)?.thread).filter((t): t is Id => t !== undefined && !titles.has(t)))];
  for (const t of await Promise.all(threads.map((id) => orElse(api.thread(id), null)))) if (t) titles.set(t.id, t.title);
  const states = new Map(own.states);
  for (const [play, s] of Object.entries(saved as Readonly<Record<Id, EffectState>>)) states.set(play, s.state);
  return { ...own, log, acts, names, titles, states };
}

/** The player's log, read when `on` (signed in), with `older()` to read the next page below it. */
export function useLog(api: KayfaApi, on: boolean | null, account: Id | null) {
  const [read, setRead] = useState<State>({ status: 'loading' });
  const key = account ?? '';
  const state: State = read.status !== 'loading' && read.key === key ? read : { status: 'loading' };

  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    api.log().then((log) => around(api, log)).then(
      (data) => { if (live) setRead({ status: 'ready', key, data, older: 'idle' }); },
      () => { if (live) setRead({ status: 'failed', key }); },
    );
    return () => { live = false; };
  }, [api, on, key]);

  const older = useCallback(() => {
    if (state.status !== 'ready' || state.older === 'loading' || state.data.log.before === null) return;
    const { data } = state;
    setRead({ ...state, older: 'loading' });
    api.log(data.log.before).then((page) => around(api, mergeLogs(data.log, page), data)).then(
      (next) => setRead((now) => (now.status === 'ready' && now.key === key ? { status: 'ready', key, data: next, older: 'idle' } : now)),
      () => setRead((now) => (now.status === 'ready' && now.key === key ? { ...now, older: 'failed' } : now)),
    );
  }, [api, key, state]);

  return { state, older };
}
