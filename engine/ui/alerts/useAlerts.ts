/**
 * The player's Alerts for Alerts.tsx: the newest page is the route's document (`alertsPage`, the glass-load plan, Task 12: the rows, the account's mark as it
 * stood when the page opened, the Acts the words need and where each followed thread was read to), each older page is read when asked for, and the
 * player's own characters (the filters) are the player's. The divider is drawn at the mark as it stood when the page opened, and stays there while the
 * page is open. Opening the page moves the mark to the newest row's time, forward only, once the page has landed (a write, never part of the load).
 *
 * Every read is the signed-in account's own, or a public Act: nothing here is asked about anyone but because a row of the player's names it. A read that
 * only decorates a row (an Act, a reading place) fails to plain words, never to an unread page.
 *
 * The reading is the signed-in account's: another account signing in reads afresh, and nothing of the last account's is drawn meanwhile.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '../router.tsx';
import { readTrapActs } from './trap-reads.ts';
import { ALERTS_PAGE, type Act, type Alert, type AlertsPage, type Id, type KayfaApi, type MyCharacter } from '../data/api.ts';

export interface AlertsRead {
  readonly rows: readonly Alert[];
  /** The account's mark when the page opened (an ISO time), or null if it never had looked. */
  readonly mark: string | null;
  /** Whether the mark could be read; if not, the page draws no divider and does not move it. */
  readonly markKnown: boolean;
  /**
   * When the account was opened (an ISO time), or null where the backend holds nothing older: with no mark, what arrived after it is new
   * and what came before is Earlier (issue #148), as the HUD's count has it. Not read means the mark is not known.
   */
  readonly joined: string | null;
  /** The player's own characters; empty where they could not be read (no filters). */
  readonly mine: readonly MyCharacter[];
  readonly acts: ReadonlyMap<Id, Act>;
  /** Public names of the authors of the posts a card an admin ended was played on. */
  readonly names: ReadonlyMap<Id, string>;
  /** The staff characters among them: a staff catching set card takes nothing, and its alert says the card is spent. */
  readonly staff: ReadonlySet<Id>;
  /** The furthest seq read in each followed thread; null where it could not be read. */
  readonly reading: Readonly<Record<Id, number>> | null;
  /** Followed thread -> the player's own character that started it (from the thread's first post, a public fact); a thread followed by choice is absent. */
  readonly started: ReadonlyMap<Id, Id>;
  /** Whether an older page may exist. */
  readonly more: boolean;
}

/** What the screen holds of the pages read: the document's, and each older page's. The player's characters are not in it: they are the player's, read at each render. */
interface Held {
  readonly doc: AlertsPage;
  readonly rows: readonly Alert[];
  readonly acts: ReadonlyMap<Id, Act>;
  readonly names: ReadonlyMap<Id, string>;
  readonly staff: ReadonlySet<Id>;
  /** Followed thread -> the character that wrote its first post. */
  readonly openings: ReadonlyMap<Id, Id>;
  readonly reading: Readonly<Record<Id, number>> | null;
  readonly more: boolean;
  readonly older: 'idle' | 'loading' | 'failed';
}

/** A row's identity: what it is about and when, so a row read twice is one. */
export const rowKey = (a: Alert): string => `${a.kind}|${a.sub ?? ''}|${a.act ?? ''}|${a.thread ?? ''}|${a.at}`;

const CHUNK = 100;
const inChunks = <T,>(xs: readonly T[]) => Array.from({ length: Math.ceil(xs.length / CHUNK) }, (_, i) => xs.slice(i * CHUNK, (i + 1) * CHUNK));
const orElse = <T,>(read: Promise<T>, fallback: T) => read.catch(() => fallback);

const heldFrom = (doc: AlertsPage): Held => ({
  doc,
  rows: doc.alerts,
  acts: new Map(doc.acts.map((a) => [a.id, a])),
  names: new Map(doc.people.map((c) => [c.id, c.name])),
  staff: new Set(doc.people.filter((c) => c.staff !== undefined).map((c) => c.id)),
  openings: new Map(doc.openings.flatMap((a) => (a.character === null ? [] : [[a.thread, a.character] as const]))),
  reading: doc.reading,
  more: doc.alerts.length >= ALERTS_PAGE,
  older: 'idle',
});

/** The Acts the rows name, and the posts those Acts landed on (a card's, a trap's), beyond those already held; used for an older page. */
async function actsAround(api: KayfaApi, rows: readonly Alert[], held: ReadonlyMap<Id, Act>, heldNames: ReadonlyMap<Id, string>): Promise<{ acts: Map<Id, Act>; names: Map<Id, string>; staff: Set<Id> }> {
  const staff = new Set<Id>();
  const acts = new Map(held);
  const names = new Map(heldNames);
  const read = async (ids: readonly Id[]) => {
    const want = [...new Set(ids)].filter((id) => !acts.has(id));
    for (const part of await Promise.all(inChunks(want).map((chunk) => orElse(api.actsById(chunk), [] as readonly Act[])))) for (const a of part) acts.set(a.id, a);
  };
  await read(rows.map((r) => r.act).filter((id): id is Id => id !== null));
  const named = rows.map((r) => (r.act === null ? undefined : acts.get(r.act)?.targetActId)).filter((id): id is Id => typeof id === 'string');
  await read(named);
  /* A card an admin ended is the card_end, then the play, then the post it landed on and that post's author's name. */
  const ended = rows.filter((r) => r.kind === 'cardEnded' && r.act !== null).map((r) => acts.get(acts.get(r.act!)?.targetActId ?? ''));
  await read(ended.map((p) => p?.targetActId).filter((id): id is Id => typeof id === 'string'));
  const authors = ended.map((p) => (p?.targetActId ? acts.get(p.targetActId)?.character : undefined)).filter((c): c is Id => typeof c === 'string' && !names.has(c));
  for (const part of await Promise.all(inChunks([...new Set(authors)]).map((chunk) => orElse(api.characters(chunk), [])))) for (const c of part) names.set(c.id, c.name);
  /* A face-down card that struck names its spring and its set, and the setter's character. */
  const trap = await readTrapActs(api, rows, acts);
  for (const [id, a] of trap.acts) acts.set(id, a);
  for (const [id, n] of trap.names) names.set(id, n);
  for (const id of trap.staff) staff.add(id);
  return { acts, names, staff };
}

/** The player's Alerts: the document's page, `older()` to read the next page below it, and `dropFollowed` for an Unfollow. */
export function useAlerts(api: KayfaApi, doc: AlertsPage, mine: readonly MyCharacter[]) {
  const { track } = useNavigation();
  const [held, setHeld] = useState<Held>(() => heldFrom(doc));
  /* A document read again (a retry, another account's) replaces what was held; an older page read before it is not carried over. */
  const current = held.doc === doc ? held : heldFrom(doc);
  if (current !== held) setHeld(current);

  /** Threads unfollowed on this page: a page read before the unfollow must not bring their rows back. */
  const unfollowed = useRef(new Set<Id>());
  const docRef = useRef(doc);
  if (docRef.current !== doc) { docRef.current = doc; unfollowed.current = new Set(); }
  const withoutUnfollowed = (rows: readonly Alert[]) => rows.filter((r) => !(r.kind === 'followed' && r.thread !== null && unfollowed.current.has(r.thread)));

  const data = useMemo<AlertsRead>(() => {
    const own = new Set(mine.map((c) => c.id));
    return {
      rows: current.rows, mark: current.doc.seenAt, markKnown: true, joined: current.doc.openedAt ?? null, mine, acts: current.acts, names: current.names, staff: current.staff, reading: current.reading,
      started: new Map([...current.openings].filter(([, c]) => own.has(c))), more: current.more,
    };
  }, [current, mine]);

  /*
   * Opening the page moves the mark to the newest row's time, never backward (the server keeps it so as well), and only once the page has landed: this
   * runs when the screen is drawn, never in the loader, so a hover is not a visit. Without a mark nothing moves; once for each document.
   */
  const marked = useRef<AlertsPage | null>(null);
  useEffect(() => {
    if (marked.current === doc) return;
    marked.current = doc;
    const newest = doc.alerts[0]?.at;
    if (newest !== undefined && (doc.seenAt === null || Date.parse(newest) > Date.parse(doc.seenAt))) void Promise.resolve(api.seeAlerts(newest)).catch(() => { /* seen again next time */ });
  }, [api, doc]);

  /* The page's first rows: a trapStruck alert's spring, set and setter are read beside the document, and fill in when they arrive. */
  useEffect(() => {
    if (!doc.alerts.some((r) => r.kind === 'trapStruck')) return;
    let live = true;
    void readTrapActs(api, doc.alerts, new Map(doc.acts.map((a) => [a.id, a]))).then((got) => {
      if (!live || (got.acts.size === 0 && got.names.size === 0)) return;
      setHeld((now) => (now.doc === doc ? { ...now, acts: new Map([...now.acts, ...got.acts]), names: new Map([...now.names, ...got.names]), staff: new Set([...now.staff, ...got.staff]) } : now));
    });
    return () => { live = false; };
  }, [api, doc]);

  const older = useCallback(() => {
    if (current.older === 'loading' || !current.more) return;
    const last = current.rows.at(-1);
    if (!last) return;
    setHeld({ ...current, older: 'loading' });
    /* The read is the router's to count (the meter), and the button is busy while it is out. */
    track((async () => {
      const page = await api.alerts(last.at);
      const have = new Set(current.rows.map(rowKey));
      const fresh = page.filter((r) => !have.has(rowKey(r)));
      const threads = [...new Set(fresh.filter((r) => r.kind === 'followed' && r.thread !== null).map((r) => r.thread!))];
      const [{ acts, names, staff }, openings, reading] = await Promise.all([
        actsAround(api, fresh, current.acts, current.names),
        threads.length === 0 ? [] : orElse(api.openingActs(threads), [] as readonly Act[]),
        threads.length === 0 ? {} : orElse(api.reading(threads), null),
      ]);
      return { page, fresh, acts, names, staff, openings, reading };
    })()).then(
      (got) => setHeld((now) => {
        if (now.doc !== doc) return now;
        /* Merged into the page as it stands now, not as it stood at the click: a row unfollowed meanwhile stays gone. */
        const have = new Set(now.rows.map(rowKey));
        const fresh = withoutUnfollowed(got.fresh).filter((r) => !have.has(rowKey(r)));
        const reading = got.reading === null || now.reading === null ? null : { ...now.reading, ...got.reading };
        return {
          ...now, rows: [...now.rows, ...fresh], acts: new Map([...now.acts, ...got.acts]), names: new Map([...now.names, ...got.names]), staff: new Set([...now.staff, ...got.staff]),
          openings: new Map([...now.openings, ...got.openings.flatMap((a) => (a.character === null ? [] : [[a.thread, a.character] as const]))]), reading, more: got.page.length >= ALERTS_PAGE, older: 'idle',
        };
      }),
      () => setHeld((now) => (now.doc === doc ? { ...now, older: 'failed' } : now)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- withoutUnfollowed reads a ref
  }, [api, doc, current, track]);

  /** Takes a followed thread's rows off the list, once it is unfollowed. */
  const dropFollowed = useCallback((thread: Id) => {
    unfollowed.current.add(thread);
    setHeld((now) => ({ ...now, rows: now.rows.filter((r) => !(r.kind === 'followed' && r.thread === thread)) }));
  }, []);

  return { data, older: current.older, onOlder: older, dropFollowed };
}
