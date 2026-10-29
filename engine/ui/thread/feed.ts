/**
 * What a thread screen holds of the thread: the Acts it shows, the live Acts it holds back, and
 * how far it has read. A reducer, so every case of a broadcast arriving twice, late, out of order
 * or for a page the reader is not on is one tested rule.
 *
 * `shown` is a contiguous run of seqs, read from the server a page at a time, plus the live Acts
 * released after its end. `held` is the live Acts not yet shown: they wait for the reader to reach
 * the bottom (or ask for them), so the page never moves by itself. A held Act is released only
 * when the run reaches the thread's tail (`tailLoaded`); on an earlier page it waits for the reader
 * to get there. An Act is keyed by id: the same id again is the same Act, and an edited post comes
 * again under its own id with what it shows now.
 */
import type { Act, Id, ThreadSummary } from '../data/api.ts';

export interface Feed {
  /** The first read has landed; before it, live Acts are only collected. */
  readonly ready: boolean;
  readonly summary: ThreadSummary | null;
  readonly firstPage: number;
  readonly lastPage: number;
  /** The highest seq read from the server. */
  readonly baseEnd: number;
  /** The highest seq the server has told this screen about by a read. */
  readonly serverLast: number;
  /** The run reaches the thread's last Act as the server last said. */
  readonly tailLoaded: boolean;
  readonly shown: ReadonlyMap<Id, Act>;
  readonly held: ReadonlyMap<Id, Act>;
  /** Acts released at the bottom with a slide. */
  readonly slid: ReadonlySet<Id>;
  /** The highest seq known, live Acts included: how many pages the thread has. */
  readonly knownLast: number;
}

export type FeedAction =
  | { readonly type: 'loaded'; readonly summary: ThreadSummary; readonly firstPage: number; readonly lastPage: number; readonly acts: readonly Act[]; readonly tailLoaded: boolean }
  | { readonly type: 'more'; readonly page: number; readonly acts: readonly Act[]; readonly tailLoaded: boolean }
  | { readonly type: 'live'; readonly act: Act }
  | { readonly type: 'fill'; readonly acts: readonly Act[] }
  | { readonly type: 'release'; readonly slide: boolean; readonly force: boolean };

export const emptyFeed: Feed = {
  ready: false, summary: null, firstPage: 1, lastPage: 1, baseEnd: 0, serverLast: 0, tailLoaded: false,
  shown: new Map(), held: new Map(), slid: new Set(), knownLast: 0,
};

const maxSeq = (acts: Iterable<Act>, from = 0) => { let m = from; for (const a of acts) if (a.seq !== null && a.seq > m) m = a.seq; return m; };

/** The seq of the last Act shown. */
export const shownEnd = (f: Feed): number => maxSeq(f.shown.values());

/** The Acts in the order they read: by seq. */
export const ordered = (m: ReadonlyMap<Id, Act>): Act[] => [...m.values()].sort((a, b) => a.seq! - b.seq!);

/** The incoming version replaces what is held unless what is held was edited later. */
function newer(held: Act, incoming: Act): Act {
  if (held.editedAt && (!incoming.editedAt || Date.parse(held.editedAt) > Date.parse(incoming.editedAt))) return held;
  return incoming;
}

/** What the held Acts that the server's read already covers leave behind. */
function pruned(held: ReadonlyMap<Id, Act>, shown: ReadonlyMap<Id, Act>, baseEnd: number): Map<Id, Act> {
  const out = new Map<Id, Act>();
  for (const [id, a] of held) if (!shown.has(id) && a.seq !== null && a.seq > baseEnd) out.set(id, a);
  return out;
}

export function feedReducer(f: Feed, a: FeedAction): Feed {
  switch (a.type) {
    case 'loaded': {
      const shown = new Map(a.acts.map((x) => [x.id, x]));
      const baseEnd = maxSeq(a.acts);
      const held = pruned(f.held, shown, baseEnd);
      const serverLast = Math.max(a.summary.lastSeq, baseEnd);
      return {
        ready: true, summary: a.summary, firstPage: a.firstPage, lastPage: a.lastPage, baseEnd, serverLast,
        tailLoaded: a.tailLoaded || baseEnd >= serverLast, shown, held, slid: new Set(), knownLast: maxSeq(held.values(), serverLast),
      };
    }
    case 'more': {
      const shown = new Map(f.shown);
      for (const x of a.acts) shown.set(x.id, x);
      const baseEnd = maxSeq(a.acts, f.baseEnd);
      const serverLast = Math.max(f.serverLast, baseEnd);
      return {
        ...f, lastPage: a.page, baseEnd, serverLast, tailLoaded: a.tailLoaded || baseEnd >= serverLast, shown,
        held: pruned(f.held, shown, baseEnd), knownLast: Math.max(f.knownLast, serverLast),
      };
    }
    case 'live': {
      const { act } = a;
      const was = f.shown.get(act.id);
      if (was) return { ...f, shown: new Map(f.shown).set(act.id, newer(was, act)) };
      const held = f.held.get(act.id);
      if (held) return { ...f, held: new Map(f.held).set(act.id, newer(held, act)) };
      /* An edit is no place in the thread, and a post at or below what was read is on a page this screen is not showing. */
      if (act.seq === null || (f.ready && act.seq <= f.baseEnd)) return f;
      return { ...f, held: new Map(f.held).set(act.id, act), knownLast: Math.max(f.knownLast, act.seq) };
    }
    case 'fill': {
      const held = new Map(f.held);
      let knownLast = f.knownLast;
      for (const x of a.acts) {
        if (x.seq === null || x.seq <= f.baseEnd || f.shown.has(x.id) || held.has(x.id)) continue;
        held.set(x.id, x);
        knownLast = Math.max(knownLast, x.seq);
      }
      return { ...f, held, knownLast };
    }
    case 'release': {
      if (!f.tailLoaded || f.held.size === 0) return f;
      const shown = new Map(f.shown);
      const slid = new Set(f.slid);
      const held = new Map(f.held);
      let end = shownEnd(f);
      for (const x of ordered(f.held)) {
        if (!a.force && x.seq !== end + 1) break;
        shown.set(x.id, x);
        held.delete(x.id);
        if (a.slide) slid.add(x.id);
        end = x.seq!;
      }
      return shown.size === f.shown.size ? f : { ...f, shown, held, slid };
    }
  }
}
