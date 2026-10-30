/**
 * What a thread screen holds of the thread: the Acts it shows, the live Acts it holds back, and
 * how far it has read. A reducer, so every case of a broadcast arriving twice, late, out of order
 * or for a page the reader is not on is one tested rule.
 *
 * A read covers a range of seqs and returns the Acts in it. A number no Act answers to (a card
 * numbered before cards took none) is a gap in the run, not an Act that is missing: the read says
 * how far it reached (`through`), and the run counts as shown through that number.
 *
 * `shown` is a contiguous run of seqs, read from the server a page at a time, plus the live Acts
 * released after its end. `held` is the live Acts not yet shown: they wait for the reader to reach
 * the bottom (or ask for them), so the page never moves by itself. A held Act is released only
 * when the run reaches the thread's tail (`tailLoaded`); on an earlier page it waits for the reader
 * to get there. An Act is keyed by id: the same id again is the same Act, and an edited post comes
 * again under its own id with what it shows now.
 *
 * A return from the glass (Back, engine/ui/glass/back.ts) is read like any page, with what the
 * thread showed and knew of when the reader left: the Acts the read holds after the last one shown
 * are held as live Acts are, so a thread that grew meanwhile shows its bar rather than moving the
 * reader, and every Act is drawn as it is now. Where the page read is not the tail, `newFrom` is
 * the first Act that came since (the first the read holds after the last one shown, or the first
 * the thread had not known of, live Acts collected before the read included), so the bar counts
 * what came and leads to it, not to pages the reader had simply not reached; reading on past it,
 * or opening a page that holds it, lets it go.
 */
import type { Act, Id, ThreadSummary } from '../data/api.ts';
import type { ThreadReturn } from '../glass/back.ts';

export interface Feed {
  /** The first read has landed; before it, live Acts are only collected. */
  readonly ready: boolean;
  readonly summary: ThreadSummary | null;
  readonly firstPage: number;
  readonly lastPage: number;
  /** The highest seq read from the server. */
  readonly baseEnd: number;
  /** The highest seq the shown run covers, numbers no Act answers to included. */
  readonly through: number;
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
  /** After a return from the glass, the first seq that came while the reader was away and is not yet shown; none otherwise. */
  readonly newFrom: number | null;
}

export type FeedAction =
  /** `back`: what the thread showed and knew of when the reader left it for the glass, on the read Back opens. */
  | { readonly type: 'loaded'; readonly summary: ThreadSummary; readonly firstPage: number; readonly lastPage: number; readonly acts: readonly Act[]; readonly tailLoaded: boolean; readonly through?: number; readonly back?: ThreadReturn | null }
  | { readonly type: 'more'; readonly page: number; readonly acts: readonly Act[]; readonly tailLoaded: boolean; readonly through?: number }
  | { readonly type: 'live'; readonly act: Act }
  | { readonly type: 'fill'; readonly acts: readonly Act[] }
  | { readonly type: 'release'; readonly slide: boolean; readonly force: boolean };

export const emptyFeed: Feed = {
  ready: false, summary: null, firstPage: 1, lastPage: 1, baseEnd: 0, through: 0, serverLast: 0, tailLoaded: false,
  shown: new Map(), held: new Map(), slid: new Set(), knownLast: 0, newFrom: null,
};

const maxSeq = (acts: Iterable<Act>, from = 0) => { let m = from; for (const a of acts) if (a.seq !== null && a.seq > m) m = a.seq; return m; };

/** The seq the shown run reaches: its last Act, or the last number its read covered when that is further. */
export const shownEnd = (f: Feed): number => maxSeq(f.shown.values(), f.through);

/** The Acts in the order they read: by seq. */
export const ordered = (m: ReadonlyMap<Id, Act>): Act[] => [...m.values()].sort((a, b) => a.seq! - b.seq!);

/** The incoming version replaces what is held unless what is held was edited later. */
export function newer(held: Act, incoming: Act): Act {
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
      const baseEnd = maxSeq(a.acts);
      const serverLast = Math.max(a.summary.lastSeq, baseEnd);
      /* A return splits the read at the last post shown, unless that would leave the page empty. */
      const back = a.back && a.acts.some((x) => x.seq !== null && x.seq <= a.back!.shown) ? a.back : null;
      const read = new Map(a.acts.map((x) => [x.id, x]));
      const shown = back ? new Map(a.acts.filter((x) => x.seq === null || x.seq <= back.shown).map((x) => [x.id, x])) : read;
      const held = pruned(f.held, read, baseEnd);
      for (const x of a.acts) if (!shown.has(x.id)) held.set(x.id, x);
      const knownLast = maxSeq(held.values(), serverLast);
      let newFrom: number | null = null;
      /* Only the read says what follows the last post shown: a live Act collected before it is past
         what the thread knew of, or it is a post the read covers. */
      if (back) newFrom = a.acts.some((x) => x.seq !== null && x.seq > back.shown) ? back.shown + 1 : knownLast > back.known ? back.known + 1 : null;
      else if (f.newFrom !== null) newFrom = f.newFrom > baseEnd ? f.newFrom : knownLast > baseEnd ? baseEnd + 1 : null;
      return {
        ready: true, summary: a.summary, firstPage: a.firstPage, lastPage: a.lastPage, baseEnd, through: back ? 0 : a.through ?? 0, serverLast,
        tailLoaded: a.tailLoaded || baseEnd >= serverLast, shown, held, slid: new Set(), knownLast, newFrom,
      };
    }
    case 'more': {
      const shown = new Map(f.shown);
      const baseEnd = maxSeq(a.acts, f.baseEnd);
      /* Held Acts the run now passes (a return's, behind its bar) come in, in order, before the page read. */
      for (const x of f.held.values()) if (x.seq !== null && x.seq <= baseEnd) shown.set(x.id, x);
      for (const x of a.acts) shown.set(x.id, x);
      const serverLast = Math.max(f.serverLast, baseEnd);
      const knownLast = Math.max(f.knownLast, serverLast);
      const newFrom = f.newFrom === null ? null : f.newFrom > baseEnd ? f.newFrom : knownLast > baseEnd ? baseEnd + 1 : null;
      return {
        ...f, lastPage: a.page, baseEnd, through: Math.max(f.through, a.through ?? 0), serverLast, tailLoaded: a.tailLoaded || baseEnd >= serverLast, shown,
        held: pruned(f.held, shown, baseEnd), knownLast, newFrom,
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
      if (shown.size === f.shown.size) return f;
      const newFrom = f.newFrom !== null && f.newFrom > end ? f.newFrom : null;
      return { ...f, shown, held, slid, newFrom };
    }
  }
}

/**
 * The posts the bar stands for: on a page short of the tail, after a return, every post since the
 * first that came while the reader was away (some on pages not read yet); otherwise the posts held.
 */
export function waitingPosts(f: Feed): { readonly count: number; readonly first: number; readonly last: number } | null {
  if (!f.tailLoaded && f.newFrom !== null && f.knownLast >= f.newFrom) return { count: f.knownLast - f.newFrom + 1, first: f.newFrom, last: f.knownLast };
  const held = ordered(f.held);
  if (held.length === 0) return null;
  return { count: held.length, first: held[0]!.seq!, last: held.at(-1)!.seq! };
}
