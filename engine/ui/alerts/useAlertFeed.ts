/**
 * What reaches the HUD live, for its Alerts count and its toasts (the alerts plan, Task 10; the alerts design, section 8): the account's own private
 * channel (`subscribeAccount`) and the news every player hears on `reach` (`subscribeReach`'s `onNews`: an update, season news). Both are
 * at-least-once, so an arrival is kept once, by its id (the alert's own uuid; news has none, so its kind, sub, Act and time stand for it).
 *
 * The count is `alertsUnread`, read again on each page (`path` changing) and on each arrival, and shown "9+" at the bound by the HUD. It is a read of the
 * account's own and nothing is computed here from anyone else's. The channel is bound to the account signed in when it is opened, so a change of
 * account opens it again and nothing of the last account's is kept: the arrivals and the count are held with the account they were heard for.
 *
 * Followed threads are derived when read and pushed to no one ("a post would otherwise fan out to every follower live"), so they count at the next
 * page and never toast. What reaches every player alike, news on `reach` (`onNews`) and a settlement (`onSettled`: its id and time, nothing of any
 * player's), is read back over about ten seconds (`REACH_SPREAD_MS`): one timer at a random moment, joined by whatever else arrives meanwhile, then
 * the count once, and `settlementMoved` for each settlement heard, which toasts only if it moved this account's characters, once by the settlement's
 * id. Otherwise every client of a busy instance would ask in the same quarter second. The account's own channel is private to it and arrives
 * to it alone, so its alert reads the count after a burst as before (`COUNT_AFTER_MS`). The news toast itself shows at once; only the reads wait.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlertKind } from '../../rules/alerts.ts';
import type { Id, KayfaApi, LiveAlert, LiveNews, LiveSettled } from '../data/api.ts';

/** An alert or an item of news as it arrived. */
export interface Arrival {
  readonly id: string;
  readonly kind: AlertKind;
  readonly sub: string | null;
  readonly act: Id | null;
  readonly character: Id | null;
  readonly at: string;
  /** A settlement's count of the player's characters it moved (from their own row); absent otherwise. */
  readonly count?: number | null;
}

/** The longest a client waits before reading back what reached everyone alike (news, a settlement); each picks a moment of its own within it. */
export const REACH_SPREAD_MS = 10_000;

/** Arrivals kept at most: the column folds past three, and a long-open page must not grow without end. What is remembered of having heard one is kept in step. */
export const KEPT = 100;

/** Adds `key` to a set that holds the latest `KEPT` keys it was given, dropping the oldest. */
export function remember(set: Set<string>, key: string): void {
  set.add(key);
  while (set.size > KEPT) set.delete(set.values().next().value as string);
}

/** A burst of arrivals reads the count once, this long after the last. */
export const COUNT_AFTER_MS = 250;

export const newsKey = (n: LiveNews) => `news|${n.kind}|${n.sub ?? ''}|${n.act ?? ''}|${n.at}`;

/**
 * Where the count may come from without a read (the forum-load plan, Task 12): `boot` is the first load's, for this account; a route with a
 * `loader` shows its document's `doc` count (null where the document carries none), and reads nothing on a move; a route without one reads
 * `alertsUnread()` on each move, as it always did.
 */
export interface UnreadSeed {
  readonly boot: number | null;
  readonly loader: boolean;
  readonly doc: number | null;
}

export function useAlertFeed(api: KayfaApi, account: Id | null, path: string, seed: UnreadSeed = { boot: null, loader: false, doc: null }): { readonly unread: number | null; readonly arrivals: readonly Arrival[] } {
  const [held, setHeld] = useState<{ readonly account: Id | null; readonly unread: number | null; readonly arrivals: readonly Arrival[] }>({ account, unread: seed.boot, arrivals: [] });
  const bootUnread = useRef(seed.boot);
  bootUnread.current = seed.boot;
  const seen = useRef(new Set<string>());
  const asked = useRef(0);
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* The count again, the latest answer winning, and an answer that cannot be read leaves the count as it was. */
  const count = useCallback(() => {
    if (account === null) return;
    const mine = ++asked.current;
    void Promise.resolve().then(() => api.alertsUnread()).then(
      (n) => { if (mine === asked.current) setHeld((h) => (h.account === account ? { ...h, unread: n } : h)); },
      () => { /* the count stays as it was; opening Alerts reads it plainly */ },
    );
  }, [api, account]);

  /* The count a little after the last arrival of a burst. */
  const countSoon = useCallback(() => {
    if (soon.current !== null) clearTimeout(soon.current);
    soon.current = setTimeout(() => { soon.current = null; count(); }, COUNT_AFTER_MS);
  }, [count]);

  useEffect(() => {
    seen.current = new Set();
    setHeld({ account, unread: bootUnread.current, arrivals: [] });
    if (account === null) return undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const pending = new Set<string>();
    let live = true;
    /* What reached everyone alike is read back at one random moment, the count once and then each settlement heard; an arrival meanwhile joins it. */
    const spreadSoon = () => {
      if (timers.size > 0) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!live) return;
        count();
        const ids = [...pending];
        pending.clear();
        for (const id of ids) {
          void Promise.resolve().then(() => api.settlementMoved(id)).then(
            (mine) => {
              if (!live || mine === null) return;
              keep({ id: `settlement|${id}`, kind: 'settlement', sub: id, act: null, character: null, at: mine.at, count: mine.count });
            },
            () => { /* it is counted at the next page, and in Alerts */ },
          );
        }
      }, Math.random() * REACH_SPREAD_MS);
      timers.add(timer);
    };
    /* An arrival is kept once, by its id; true when it is new. */
    const keep = (a: Arrival): boolean => {
      if (seen.current.has(a.id)) return false;
      remember(seen.current, a.id);
      setHeld((h) => (h.account === account ? { ...h, arrivals: [...h.arrivals, a].slice(-KEPT) } : h));
      return true;
    };
    /* `by` is the path an arrival came by: the account's own channel reads the count after a burst; news, heard by everyone alike, is spread. */
    const heard = (by: 'account' | 'news', a: Arrival) => {
      if (!keep(a)) return;
      if (by === 'account') countSoon(); else spreadSoon();
    };
    const settledSeen = new Set<string>();
    const settled = (s: LiveSettled) => {
      if (settledSeen.has(s.id)) return;
      remember(settledSeen, s.id);
      pending.add(s.id);
      spreadSoon();
    };
    const offAccount = api.subscribeAccount({ onAlert: (a: LiveAlert) => heard('account', a) });
    const offReach = api.subscribeReach({
      onNews: (n) => heard('news', { id: newsKey(n), kind: n.kind, sub: n.sub, act: n.act, character: null, at: n.at }),
      onSettled: settled,
    });
    return () => {
      live = false;
      for (const t of timers) clearTimeout(t);
      if (soon.current !== null) { clearTimeout(soon.current); soon.current = null; }
      offAccount(); offReach();
    };
  }, [api, account, countSoon]);

  /* A boot read for this account after the feed opened (a sign-in on this page) is its count. */
  useEffect(() => {
    if (seed.boot !== null) setHeld((h) => (h.account === account ? { ...h, unread: seed.boot } : h));
  }, [account, seed.boot]);

  /* Each page: the shown document's count where the route loads one; else boot's count at the first, else a read. */
  const firstPage = useRef(true);
  useEffect(() => {
    const first = firstPage.current;
    firstPage.current = false;
    if (seed.loader) {
      if (seed.doc !== null) setHeld((h) => (h.account === account ? { ...h, unread: seed.doc } : h));
      return;
    }
    if (first && seed.boot !== null) return;
    count();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a move, or the shown document, decides; the seed's other fields are read as they stand
  }, [count, path, seed.loader, seed.doc]);

  const mine = held.account === account;
  return { unread: mine ? held.unread : null, arrivals: mine ? held.arrivals : [] };
}
