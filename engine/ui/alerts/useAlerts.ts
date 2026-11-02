/**
 * Reading the player's Alerts for Alerts.tsx: the newest page of `KayfaApi.alerts`, each older page when asked for, the account's mark as it stood
 * when the page opened (the divider is drawn at it, and stays there while the page is open), the player's own characters (the filters), and what the
 * words need beside the rows: the Acts they name and, for a card played on a post or a trap, the post it landed on, and where each followed thread was
 * read to. Opening the page moves the mark to the newest row's time, forward only.
 *
 * Every read is the signed-in account's own, or a public Act: nothing here is asked about anyone but because a row of the player's names it. A read that
 * only decorates a row (an Act, a reading place) fails to plain words, never to an unread page.
 *
 * The reading is the signed-in account's: another account signing in reads afresh, and nothing of the last account's is drawn meanwhile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ALERTS_PAGE, type Act, type Alert, type Id, type KayfaApi, type MyCharacter } from '../data/api.ts';

export interface AlertsRead {
  readonly rows: readonly Alert[];
  /** The account's mark when the page opened (an ISO time), or null if it never had looked. */
  readonly mark: string | null;
  /** Whether the mark could be read; if not, the page draws no divider and does not move it. */
  readonly markKnown: boolean;
  /** The player's own characters; empty where they could not be read (no filters). */
  readonly mine: readonly MyCharacter[];
  readonly acts: ReadonlyMap<Id, Act>;
  /** The furthest seq read in each followed thread; null where it could not be read. */
  readonly reading: Readonly<Record<Id, number>> | null;
  /** Followed thread -> the player's own character that started it (from the thread's first post, a public fact); a thread followed by choice is absent. */
  readonly started: ReadonlyMap<Id, Id>;
  /** Whether an older page may exist. */
  readonly more: boolean;
}

type State =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly key: string }
  | { readonly status: 'ready'; readonly key: string; readonly data: AlertsRead; readonly older: 'idle' | 'loading' | 'failed' };

/** A row's identity: what it is about and when, so a row read twice is one. */
export const rowKey = (a: Alert): string => `${a.kind}|${a.sub ?? ''}|${a.act ?? ''}|${a.thread ?? ''}|${a.at}`;

const CHUNK = 100;
const inChunks = <T,>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
const orElse = <T,>(read: Promise<T>, fallback: T) => read.catch(() => fallback);

/** The Acts the rows name, and the posts those Acts landed on (a card's, a trap's), beyond those already held. */
async function actsAround(api: KayfaApi, rows: readonly Alert[], held: ReadonlyMap<Id, Act>): Promise<Map<Id, Act>> {
  const acts = new Map(held);
  const read = async (ids: readonly Id[]) => {
    const want = [...new Set(ids)].filter((id) => !acts.has(id));
    for (const part of await Promise.all(inChunks(want).map((chunk) => orElse(api.actsById(chunk), [] as readonly Act[])))) for (const a of part) acts.set(a.id, a);
  };
  await read(rows.map((r) => r.act).filter((id): id is Id => id !== null));
  const named = rows.map((r) => (r.act === null ? undefined : acts.get(r.act)?.targetActId)).filter((id): id is Id => typeof id === 'string');
  await read(named);
  return acts;
}

/** The followed threads among these rows that one of the player's characters started, from one read of their first posts. A failed read leaves them tagged "Followed". */
async function startedAmong(api: KayfaApi, rows: readonly Alert[], mine: readonly MyCharacter[], held: ReadonlyMap<Id, Id>): Promise<Map<Id, Id>> {
  const started = new Map(held);
  const threads = [...new Set(rows.filter((r) => r.kind === 'followed' && r.thread !== null).map((r) => r.thread!))];
  if (threads.length === 0) return started;
  const own = new Set(mine.map((c) => c.id));
  for (const a of await orElse(api.openingActs(threads), [] as readonly Act[])) if (a.character !== null && own.has(a.character)) started.set(a.thread, a.character);
  return started;
}

export function useAlerts(api: KayfaApi, on: boolean | null, account: Id | null) {
  const [read, setRead] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const key = account ?? '';
  const state: State = read.status !== 'loading' && read.key === key ? read : { status: 'loading' };

  /** Threads unfollowed on this page: a page read before the unfollow must not bring their rows back. */
  const unfollowed = useRef(new Set<Id>());
  const withoutUnfollowed = (rows: readonly Alert[]) => rows.filter((r) => !(r.kind === 'followed' && r.thread !== null && unfollowed.current.has(r.thread)));

  useEffect(() => {
    if (!on) return undefined;
    let live = true;
    setRead({ status: 'loading' });
    unfollowed.current = new Set();
    (async () => {
      /* The rows are the page; the mark and the characters only dress it: a failed read of either is a page without them. */
      const [rows, prefs, mine] = await Promise.all([api.alerts(), orElse(api.preferences(), null), orElse(api.myCharacters(), [] as readonly MyCharacter[])]);
      const [acts, started, reading] = await Promise.all([
        actsAround(api, rows, new Map()),
        startedAmong(api, rows, mine, new Map()),
        (async () => {
          const threads = [...new Set(rows.filter((r) => r.kind === 'followed' && r.thread !== null).map((r) => r.thread!))];
          return threads.length === 0 ? {} : orElse(api.reading(threads), null);
        })(),
      ]);
      return { rows, mark: prefs === null ? null : prefs.alertsSeenAt, markKnown: prefs !== null, mine, acts, started, reading, more: rows.length >= ALERTS_PAGE } satisfies AlertsRead;
    })().then(
      (data) => {
        if (!live) return;
        setRead({ status: 'ready', key, data, older: 'idle' });
        /* Opening the page moves the mark to the newest row's time, never backward (the server keeps it so as well), and only once the page is
           there to be seen: a page left before it was read, or a pass a StrictMode remount cancelled, moves nothing. Without a mark, nothing moves. */
        const newest = data.rows[0]?.at;
        if (newest !== undefined && data.markKnown && (data.mark === null || Date.parse(newest) > Date.parse(data.mark))) void Promise.resolve(api.seeAlerts(newest)).catch(() => { /* seen again next time */ });
      },
      () => { if (live) setRead({ status: 'failed', key }); },
    );
    return () => { live = false; };
  }, [api, on, key, attempt]);

  const older = useCallback(() => {
    if (state.status !== 'ready' || state.older === 'loading' || !state.data.more) return;
    const { data } = state;
    const last = data.rows.at(-1);
    if (!last) return;
    setRead({ ...state, older: 'loading' });
    (async () => {
      const page = await api.alerts(last.at);
      const fresh = page.filter((r) => !data.rows.some((h) => rowKey(h) === rowKey(r)));
      const [acts, started, reading] = await Promise.all([
        actsAround(api, fresh, data.acts),
        startedAmong(api, fresh, data.mine, data.started),
        (async () => {
          const threads = [...new Set(fresh.filter((r) => r.kind === 'followed' && r.thread !== null).map((r) => r.thread!))];
          return threads.length === 0 ? {} : orElse(api.reading(threads), null);
        })(),
      ]);
      return { page, fresh, acts, started, reading };
    })().then(
      (got) => setRead((now) => {
        if (now.status !== 'ready' || now.key !== key) return now;
        /* Merged into the page as it stands now, not as it stood at the click: a row unfollowed meanwhile stays gone. */
        const have = new Set(now.data.rows.map(rowKey));
        const fresh = withoutUnfollowed(got.fresh).filter((r) => !have.has(rowKey(r)));
        const reading = got.reading === null || now.data.reading === null ? null : { ...now.data.reading, ...got.reading };
        const data: AlertsRead = {
          ...now.data, rows: [...now.data.rows, ...fresh], acts: new Map([...now.data.acts, ...got.acts]),
          started: new Map([...now.data.started, ...got.started]), reading, more: got.page.length >= ALERTS_PAGE,
        };
        return { status: 'ready', key, data, older: 'idle' };
      }),
      () => setRead((now) => (now.status === 'ready' && now.key === key ? { ...now, older: 'failed' } : now)),
    );
  }, [api, key, state]);

  /** Takes a followed thread's rows off the list, once it is unfollowed. */
  const dropFollowed = useCallback((thread: Id) => {
    unfollowed.current.add(thread);
    setRead((now) => (now.status === 'ready' ? { ...now, data: { ...now.data, rows: now.data.rows.filter((r) => !(r.kind === 'followed' && r.thread === thread)) } } : now));
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, older, dropFollowed, retry };
}
