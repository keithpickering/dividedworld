/**
 * Whether each scheduled job is running, for every part of a page that says so (the admin strip, the Admin tab's mark, a waiting
 * note). The rows are `job_status`'s, the same for every caller, and the health is `jobHealth` of them at the backend's own clock
 * (`api.now()`), so a story's or a test's clock decides what is late.
 *
 * One cache serves the whole page: it is kept per backend, one read in flight at a time, and a read at most once a minute however many
 * parts ask (design, section 8: a busy instance's pages must not each ask). One timer a minute, shared and running only while a part is
 * mounted, recomputes the health from the rows it holds and reads again when they are a minute old. A read that failed gives `null`, and
 * `null` shows nothing late: a read failing is never a reason to say a job stopped.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { jobHealth, type JobHealth, type JobName, type JobRow } from '../../rules/jobs.ts';
import type { KayfaApi } from '../data/api.ts';
import { useKayfa } from '../context.tsx';

const MINUTE = 60_000;
/** A timer fires a hair early or late against the clock the rows are dated by: a row a second under a minute old is read again, never held for two. */
const STALE = MINUTE - 1000;

interface Store {
  rows: readonly JobRow[] | null;
  /** The last good read's time, by `api.now()`; null before one. */
  readAt: number | null;
  inflight: boolean;
  health: readonly JobHealth[] | null;
  readonly listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const stores = new WeakMap<KayfaApi, Store>();
const storeOf = (api: KayfaApi): Store => {
  let s = stores.get(api);
  if (s === undefined) { s = { rows: null, readAt: null, inflight: false, health: null, listeners: new Set(), timer: null }; stores.set(api, s); }
  return s;
};

function recompute(api: KayfaApi, s: Store): void {
  /* The grace is each row's own: `job_status` carries the `jobGraceMinutes` setting on every row, so there is no second source to agree with. */
  s.health = s.rows === null ? null : jobHealth(s.rows, {}, new Date(api.now()));
  for (const l of [...s.listeners]) l();
}

function read(api: KayfaApi, s: Store): void {
  if (s.inflight || (s.readAt !== null && api.now() - s.readAt < STALE)) return;
  s.inflight = true;
  const at = api.now();
  /* Started inside a promise, so a read that throws before it returns a promise reads as a failed read, as a rejected one does: never a reason to say a job stopped. */
  Promise.resolve().then(() => api.jobStatus()).then(
    (rows) => { s.rows = rows; s.readAt = at; },
    () => { s.rows = null; s.readAt = at; },
  ).finally(() => { s.inflight = false; recompute(api, s); });
}

function subscribe(api: KayfaApi, listener: () => void): () => void {
  const s = storeOf(api);
  s.listeners.add(listener);
  if (s.timer === null) {
    s.timer = setInterval(() => { recompute(api, s); read(api, s); }, MINUTE);
  }
  read(api, s);
  return () => {
    s.listeners.delete(listener);
    if (s.listeners.size === 0 && s.timer !== null) { clearInterval(s.timer); s.timer = null; }
  };
}

/** Every job's health, or null before the first read and while the read fails. */
export function useJobHealth(): readonly JobHealth[] | null {
  const { api } = useKayfa();
  /* Stable, so a render never unsubscribes and resubscribes (which would restart the shared timer). */
  const on = useCallback((listener: () => void) => subscribe(api, listener), [api]);
  return useSyncExternalStore(on, () => storeOf(api).health);
}

/** The job's entry when it is stopped, else null (also while nothing is known). */
export function useJobLate(job: JobName): JobHealth | null {
  const health = useJobHealth();
  return health?.find((h) => h.job === job && h.stopped) ?? null;
}
