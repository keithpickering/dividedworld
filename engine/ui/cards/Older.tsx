/**
 * The Lens's older plays (docs/plans/2026-11-21-post-plays-design.md, section 3): a page holds a kind's plays in force and its newest and most-drawn, so the rest of an
 * old kind's plays are read here, twenty at a time, newest first, when the reader asks. The words are the glass's own: plain and out of character.
 *
 * A page is taken in as a visit's tab is read (`readVisit`): the casters into the thread's people, the plays into the store, the tallies and the reader's own reactions
 * into theirs, and the threads spun from each play into the spun loader. The plays join the store with `older`, so the server's count of the kind is not counted twice
 * and none is billed: a paged back is no mark or tab of its own, and a paged row sits where it was paged, after the rows held, in the order it came.
 */
import { useCallback, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Character, Id, KindPage, KayfaApi, ThreadSummary } from '../data/api.ts';
import { GlassButton } from '../glass/Button.tsx';
import type { Mine } from '../reactions/mine.ts';
import { spunLoader } from '../spin/spun.ts';
import type { Tallies } from '../thread/tallies.ts';
import type { Plays } from './plays.ts';

/** How many older plays a press reads. */
export const OLDER_PAGE = 20;
/** The most the server reads in a page (`kind_plays` clamps `size` to 1..50). */
const OLDER_MOST = 50;

/** The button's words, and what it says when a read did not land. */
export const olderButton = (more: number): string => `Show older plays (${more} more)`;
export const OLDER_FAILED = 'Couldn’t load older plays. Try again';

/** The page's own Acts that are plays (a card or a set), in the order they came: the rows a page adds, before the ones the Lens already holds are set aside. */
const playsOf = (page: KindPage): readonly Id[] => page.plays.filter((a) => a.kind === 'card' || a.kind === 'set').map((a) => a.id);

/**
 * Take a page of older plays in: `onCast` is told its casters first (the thread's people), then its plays join `store`, and its tallies, the reader's reactions and the spun
 * threads are put where the rows read them. Returns the ids of the plays the store now holds, in the order the page gave them.
 */
export function takeInOlder(api: KayfaApi, page: KindPage, post: Id, to: { readonly store: Plays; readonly tallies: Tallies; readonly mine: Mine; readonly onCast?: ((cast: readonly Character[]) => void) | null }): readonly Id[] {
  to.onCast?.(page.cast);
  to.store.add(page.plays, { older: true });
  const ids = playsOf(page);
  for (const [id, t] of Object.entries(page.tallies)) to.tallies.merge(id, t);
  for (const id of ids) to.mine.merge(id, page.mine.filter((r) => r.act === id));
  const loader = spunLoader(api);
  const from = new Map<Id, ThreadSummary[]>();
  for (const t of page.spun) if (t.originActId !== null) from.set(t.originActId, [...(from.get(t.originActId) ?? []), t]);
  for (const id of ids) loader.seed(id, from.get(id) ?? []);
  const held = new Set(to.store.get(post).plays.map((p) => p.id));
  return ids.filter((id) => held.has(id));
}

export interface Older {
  /** The plays paged in so far, in the order they came: after the rows the Lens holds, never re-sorted. */
  readonly ids: readonly Id[];
  readonly busy: boolean;
  readonly failed: boolean;
  /** The last read said no more were left. */
  readonly done: boolean;
  /** The play focus goes to now that its row is drawn (a new object for each page); `id` null means the last row of Ended, where a page brought no new row and none are left; or null. */
  readonly focus: { readonly id: Id | null } | null;
  readonly press: () => void;
}

/**
 * A kind's older plays on a post. `card` is the kind to the server (null for card backs). `held` holds the ids of every play the page has billed, so a play the page
 * already sent is never a row twice; `heldEnded` is how many of the rows held are ended, and the first read asks for that many more, since the newest ended play is among
 * them and the server counts from the newest.
 */
export function useOlder({ post, card, store, tallies, mine, held, heldEnded, onCast }: {
  readonly post: Id; readonly card: string | null; readonly store: Plays; readonly tallies: Tallies; readonly mine: Mine; readonly held: ReadonlySet<Id>; readonly heldEnded: number;
  readonly onCast?: ((cast: readonly Character[]) => void) | null;
}): Older {
  const { api } = useKayfa();
  const [ids, setIds] = useState<readonly Id[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState<{ readonly at: string; readonly id: Id } | null>(null);
  const [done, setDone] = useState(false);
  const [focus, setFocus] = useState<{ readonly id: Id | null } | null>(null);
  /* A second press while a read is out does nothing: a ref, since two presses can land before the state does. */
  const out = useRef(false);
  const press = useCallback(() => {
    if (out.current) return;
    out.current = true;
    setBusy(true);
    setFailed(false);
    /* The server counts from the newest ended play, which the page already holds (as it may hold a few more ended plays), so the first read asks for that many more than a page and still brings about a page of new rows.
       The server clamps a page at 50, so with more than 30 ended rows held a read is a page of fewer new rows; the cursor it returns carries the next read on, so a press always makes progress. */
    const size = cursor === null ? Math.min(OLDER_MOST, OLDER_PAGE + heldEnded) : OLDER_PAGE;
    /* On a back tab `heldEnded` counts this tab's ended rows alone, so the first page is smaller than a page of new rows; the cursor carries the next read on, so progress is safe.
       A page that lands after the kind was switched or the Lens closed writes the plays it read into the store, under the post and kind it was asked for, and is otherwise dropped: the rows state it would set is gone with its Who. */
    void api.kindPlays(post, card, cursor, size).then((page) => {
      const taken = takeInOlder(api, page, post, { store, tallies, mine, onCast });
      const have = new Set([...held, ...ids]);
      const fresh = taken.filter((id) => !have.has(id));
      setIds([...ids, ...fresh]);
      setCursor(page.next);
      setDone(page.next === null);
      /* The first new row takes focus, or the last where the button it was pressed on is gone with nothing left. */
      const at = page.next === null ? fresh.at(-1) ?? null : fresh[0];
      /* The button goes with the last page: with no new row to take focus, it falls to the last row of Ended and never to the page. */
      if (at !== undefined) setFocus({ id: at });
    }).catch(() => { setFailed(true); }).finally(() => { out.current = false; setBusy(false); });
  }, [api, post, card, cursor, heldEnded, store, tallies, mine, onCast, held, ids]);
  return { ids, busy, failed, done, focus, press };
}

/** The foot of the Ended group: one button, which is busy while a read is out and says so when one failed. */
export function OlderButton({ more, busy, failed, onPress }: { readonly more: number; readonly busy: boolean; readonly failed: boolean; readonly onPress: () => void }) {
  return (
    <div className="kb-lens-pager">
      <GlassButton size="s" busy={busy} onClick={onPress}>{failed ? OLDER_FAILED : olderButton(more)}</GlassButton>
    </div>
  );
}
