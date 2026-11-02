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
 * page and never toast. A settlement is announced to everyone alike on `reach` (`onSettled`: its id and time, nothing of any player's); each client then
 * reads its own head of `alerts()` and toasts the settlement only if it moved this account's characters, once by the settlement's id. The reads are
 * spread over a few seconds, so a busy instance's players do not all ask in the same instant.
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

/** The longest a client waits before reading its own alerts after a settlement is announced; each picks a moment of its own within it. */
export const SETTLED_SPREAD_MS = 3000;

/** Arrivals kept at most: the column folds past three, and a long-open page must not grow without end. */
const KEPT = 100;

export const newsKey = (n: LiveNews) => `news|${n.kind}|${n.sub ?? ''}|${n.act ?? ''}|${n.at}`;

export function useAlertFeed(api: KayfaApi, account: Id | null, path: string): { readonly unread: number | null; readonly arrivals: readonly Arrival[] } {
  const [held, setHeld] = useState<{ readonly account: Id | null; readonly unread: number | null; readonly arrivals: readonly Arrival[] }>({ account, unread: null, arrivals: [] });
  const seen = useRef(new Set<string>());
  const asked = useRef(0);

  /* The count again, the latest answer winning, and an answer that cannot be read leaves the count as it was. */
  const count = useCallback(() => {
    if (account === null) return;
    const mine = ++asked.current;
    void Promise.resolve().then(() => api.alertsUnread()).then(
      (n) => { if (mine === asked.current) setHeld((h) => (h.account === account ? { ...h, unread: n } : h)); },
      () => { /* the count stays as it was; opening Alerts reads it plainly */ },
    );
  }, [api, account]);

  useEffect(() => {
    seen.current = new Set();
    setHeld({ account, unread: null, arrivals: [] });
    if (account === null) return undefined;
    const heard = (a: Arrival) => {
      if (seen.current.has(a.id)) return;
      seen.current.add(a.id);
      setHeld((h) => (h.account === account ? { ...h, arrivals: [...h.arrivals, a].slice(-KEPT) } : h));
      count();
    };
    const settledSeen = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let live = true;
    const settled = (s: LiveSettled) => {
      if (settledSeen.has(s.id)) return;
      settledSeen.add(s.id);
      const timer = setTimeout(() => {
        timers.delete(timer);
        void Promise.resolve().then(() => api.alerts()).then(
          (rows) => {
            if (!live) return;
            count();
            const mine = rows.find((r) => r.kind === 'settlement' && r.sub === s.id);
            if (mine) heard({ id: `settlement|${s.id}`, kind: 'settlement', sub: mine.sub, act: null, character: null, at: mine.at, count: mine.count });
          },
          () => { /* it is counted at the next page, and in Alerts */ },
        );
      }, Math.random() * SETTLED_SPREAD_MS);
      timers.add(timer);
    };
    const offAccount = api.subscribeAccount({ onAlert: (a: LiveAlert) => heard(a) });
    const offReach = api.subscribeReach({
      onNews: (n) => heard({ id: newsKey(n), kind: n.kind, sub: n.sub, act: n.act, character: null, at: n.at }),
      onSettled: settled,
    });
    return () => { live = false; for (const t of timers) clearTimeout(t); offAccount(); offReach(); };
  }, [api, account, count]);

  /* Each page read. */
  useEffect(() => { count(); }, [count, path]);

  const mine = held.account === account;
  return { unread: mine ? held.unread : null, arrivals: mine ? held.arrivals : [] };
}
