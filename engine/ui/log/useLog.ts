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
import type { Act, Id, KayfaApi, Log } from '../data/api.ts';
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

/** Everything the lines need beside the log itself, read for the log as it stands. */
async function around(api: KayfaApi, log: Log): Promise<LogData> {
  const mine = await api.myCharacters();
  const ids = mine.map((c) => c.id);
  const [estimate, standings, season, turns] = await Promise.all([
    api.estimate().catch(() => null),
    ids.length === 0 ? {} : api.standingAmounts(ids),
    api.season(),
    ids.length === 0 ? [] : api.turnsAnnounced(ids),
  ]);
  const acts = new Map<Id, Act>();
  const named = actsNamed(log, estimate, turns);
  for (const a of named.length === 0 ? [] : await api.actsById(named)) acts.set(a.id, a);
  /* A card play names the post it landed on. */
  const targets = [...acts.values()].filter((a) => a.kind === 'card' && a.targetActId && !acts.has(a.targetActId)).map((a) => a.targetActId!);
  for (const a of targets.length === 0 ? [] : await api.actsById(targets)) acts.set(a.id, a);
  const others = [...new Set([...acts.values()].map((a) => a.character).filter((c): c is Id => c !== null && !ids.includes(c)))];
  const names = new Map<Id, string>((others.length === 0 ? [] : await api.characters(others)).map((c) => [c.id, c.name]));
  const threads = [...new Set(turns.map((t) => acts.get(t.act)?.thread).filter((t): t is Id => t !== undefined))];
  const titles = new Map<Id, string>();
  for (const t of await Promise.all(threads.map((id) => api.thread(id)))) if (t) titles.set(t.id, t.title);
  return { log, mine, estimate, standings, season, turns, acts, names, titles };
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
    api.log(data.log.before).then((page) => around(api, mergeLogs(data.log, page))).then(
      (next) => setRead((now) => (now.status === 'ready' && now.key === key ? { status: 'ready', key, data: next, older: 'idle' } : now)),
      () => setRead((now) => (now.status === 'ready' && now.key === key ? { ...now, older: 'failed' } : now)),
    );
  }, [api, key, state]);

  return { state, older };
}
