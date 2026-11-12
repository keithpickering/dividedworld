/**
 * The feed's return from the glass (the web plan's glass amendment to Task 3): a reader who comes
 * back by Back to a thread that grew while they were away finds the posts that came behind the
 * thread's "new posts" bar, as a live post would be, and is not moved. The rest of the reducer is
 * held by Thread.test.tsx, through the screen.
 */
import { describe, expect, it } from 'vitest';
import type { Act, ThreadSummary } from '../data/api.ts';
import { emptyFeed, feedReducer, shownEnd, waitingPosts, type Feed, type FeedAction } from './feed.ts';

const act = (seq: number, over: Partial<Act> = {}): Act => ({
  id: `act-${seq}`, character: 'c', kind: 'post', thread: 't', targetActId: null, seq,
  createdAt: '2026-10-29T12:00:00Z', payload: { body: `post ${seq}` }, currentPayload: { body: `post ${seq}` }, editedAt: null, shownEditedAt: null, ...over,
});
const run = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => act(from + i));
const summary = (lastSeq: number) => ({ id: 't', board: 'b', title: 'T', originActId: null, createdAt: '', lastAt: '', lastSeq } as unknown as ThreadSummary);
const loaded = (o: { acts: readonly Act[]; last: number; page: number; full?: boolean; back?: { shown: number; known: number } | null }): FeedAction => ({
  type: 'loaded', summary: summary(o.last), firstPage: o.page, lastPage: o.page, acts: o.acts, tailLoaded: !o.full, back: o.back ?? null,
});
const seqs = (m: ReadonlyMap<string, Act>) => [...m.values()].map((a) => a.seq).sort((a, b) => a! - b!);
const reduce = (...actions: FeedAction[]) => actions.reduce<Feed>(feedReducer, emptyFeed);

describe('a return to the last page, which grew while the reader was away', () => {
  /* Twenty to a page: the reader left page 2 at post 25, its last; 26 to 30 came meanwhile. */
  const back = reduce(loaded({ acts: run(21, 30), last: 30, page: 2, back: { shown: 25, known: 25 } }));
  it('shows what the reader had and holds what came, as live posts are held', () => {
    expect(seqs(back.shown)).toEqual([21, 22, 23, 24, 25]);
    expect(seqs(back.held)).toEqual([26, 27, 28, 29, 30]);
    expect(back.tailLoaded).toBe(true);
    expect(waitingPosts(back)).toEqual({ count: 5, first: 26, last: 30 });
  });
  it('lets them in by the bar\'s way out, all at once or by reading on to the bottom', () => {
    expect(seqs(feedReducer(back, { type: 'release', slide: false, force: true }).shown)).toEqual(run(21, 30).map((a) => a.seq));
    const read = feedReducer(back, { type: 'release', slide: true, force: false });
    expect(shownEnd(read)).toBe(30);
    expect(waitingPosts(read)).toBeNull();
  });
  it('still holds a post that was waiting behind the bar when the reader left', () => {
    const f = reduce(loaded({ acts: run(21, 28), last: 28, page: 2, back: { shown: 25, known: 27 } }));
    expect(seqs(f.held)).toEqual([26, 27, 28]);
  });
  it('takes an edit of a held post in place, and a live post after them joins them', () => {
    const edited = act(27, { currentPayload: { body: 'edited' }, editedAt: '2026-10-29T13:00:00Z' });
    const f = [{ type: 'live', act: edited } as const, { type: 'live', act: act(31) } as const].reduce<Feed>(feedReducer, back);
    expect(f.held.get('act-27')?.currentPayload).toEqual({ body: 'edited' });
    expect(waitingPosts(f)).toEqual({ count: 6, first: 26, last: 31 });
  });
  it('holds nothing when nothing came', () => {
    const f = reduce(loaded({ acts: run(21, 25), last: 25, page: 2, back: { shown: 25, known: 25 } }));
    expect(seqs(f.shown)).toEqual([21, 22, 23, 24, 25]);
    expect(waitingPosts(f)).toBeNull();
  });
});

describe('a return to a page the thread grew past', () => {
  /* The reader left page 2 at post 25, its last; 26 to 45 came, filling it and starting page 3. */
  const back = reduce(loaded({ acts: run(21, 40), last: 45, page: 2, full: true, back: { shown: 25, known: 25 } }));
  it('holds the rest of the page, and the bar counts every post since and says which pages they are on', () => {
    expect(seqs(back.shown)).toEqual([21, 22, 23, 24, 25]);
    expect(back.tailLoaded).toBe(false);
    expect(waitingPosts(back)).toEqual({ count: 20, first: 26, last: 45 });
  });
  it('reading on to the next page brings in the held posts before it, in order, and the bar goes', () => {
    const f = feedReducer(back, { type: 'more', page: 3, acts: run(41, 45), tailLoaded: true });
    expect(seqs(f.shown)).toEqual(run(21, 45).map((a) => a.seq));
    expect(f.held.size).toBe(0);
    expect(waitingPosts(f)).toBeNull();
  });
  it('opening the page the bar leads to shows everything, held no longer', () => {
    const f = feedReducer(back, loaded({ acts: run(21, 40), last: 45, page: 2, full: true }));
    expect(seqs(f.shown)).toEqual(run(21, 40).map((a) => a.seq));
    expect(waitingPosts(f)).toEqual({ count: 5, first: 41, last: 45 });
  });
});

describe('a return to an earlier page', () => {
  /* The reader left page 1 of three (45 posts known); 46 and 47 came. */
  const back = reduce(loaded({ acts: run(1, 20), last: 47, page: 1, full: true, back: { shown: 20, known: 45 } }));
  it('shows the page as it was, and the bar counts only what came since, on the page it is on', () => {
    expect(seqs(back.shown)).toEqual(run(1, 20).map((a) => a.seq));
    expect(back.held.size).toBe(0);
    expect(waitingPosts(back)).toEqual({ count: 2, first: 46, last: 47 });
  });
  it('keeps the bar while the reader reads on short of them, and drops it once a page holds them', () => {
    const on = feedReducer(back, { type: 'more', page: 2, acts: run(21, 40), tailLoaded: false });
    expect(waitingPosts(on)).toEqual({ count: 2, first: 46, last: 47 });
    expect(waitingPosts(feedReducer(back, loaded({ acts: run(41, 47), last: 47, page: 3 })))).toBeNull();
  });
  it('says nothing when nothing came', () => {
    expect(waitingPosts(reduce(loaded({ acts: run(1, 20), last: 45, page: 1, full: true, back: { shown: 20, known: 45 } })))).toBeNull();
  });
  it('counts a live post that came before the read as what came, not the pages between', () => {
    /* 46 arrives live while the return's read is out, and the read was answered before it was written. */
    const f = reduce({ type: 'live', act: act(46) }, loaded({ acts: run(1, 20), last: 45, page: 1, full: true, back: { shown: 20, known: 45 } }));
    expect(seqs(f.shown)).toEqual(run(1, 20).map((a) => a.seq));
    expect(waitingPosts(f)).toEqual({ count: 1, first: 46, last: 46 });
  });
});

describe('what a return cannot make of a read', () => {
  it('a return whose last shown post is before the page read holds nothing back, so the page is never empty', () => {
    const f = reduce(loaded({ acts: run(21, 30), last: 30, page: 2, back: { shown: 12, known: 12 } }));
    expect(seqs(f.shown)).toEqual(run(21, 30).map((a) => a.seq));
  });
  it('a read with no return is the page as the server has it', () => {
    const f = reduce(loaded({ acts: run(21, 30), last: 30, page: 2 }));
    expect(seqs(f.shown)).toEqual(run(21, 30).map((a) => a.seq));
    expect(waitingPosts(f)).toBeNull();
  });
});

describe('a legacy numbered card at the thread\'s tail', () => {
  /* Card #4 was numbered before cards took none: a read returns 1 to 3 for a thread whose last number is 4. */
  const f = reduce({ type: 'loaded', summary: summary(4), firstPage: 1, lastPage: 1, acts: run(1, 3), tailLoaded: true, through: 4 });
  it('counts the numbers the read covered as shown, so the next post is released, not held', () => {
    expect(shownEnd(f)).toBe(4);
    const live = feedReducer(f, { type: 'live', act: act(5) });
    expect(seqs(feedReducer(live, { type: 'release', slide: false, force: false }).shown)).toEqual([1, 2, 3, 5]);
  });
});

describe('a number whose Act is drawn under a post elsewhere', () => {
  /* The run reaches 799 of an 800-post thread's page; 800 is a reply a play drew under an earlier post. */
  const tail = (...more: FeedAction[]) => reduce(loaded({ acts: run(781, 799), last: 800, page: 40 }), ...more);
  it('does not hold back the post after it: a held 801 is released past a cut 800, and the end of the run steps over it', () => {
    const f = tail({ type: 'cut', seq: 800 }, { type: 'live', act: act(801) });
    expect(shownEnd(f)).toBe(800);
    expect(seqs(feedReducer(f, { type: 'release', slide: false, force: false }).shown)).toEqual([...run(781, 799).map((a) => a.seq), 801]);
  });
  it('steps over several cut numbers in a row, and a cut number that is not next to the run changes nothing', () => {
    const f = tail({ type: 'cut', seq: 800 }, { type: 'cut', seq: 801 }, { type: 'cut', seq: 900 }, { type: 'live', act: act(802) });
    expect(shownEnd(f)).toBe(801);
    expect(seqs(feedReducer(f, { type: 'release', slide: false, force: false }).shown)).toContain(802);
  });
  it('is the same whether the number was cut before the Acts around it came or after: the read says it, or a broadcast does', () => {
    const before = reduce({ ...loaded({ acts: run(781, 799), last: 800, page: 40 }), cut: [800] } as FeedAction, { type: 'live', act: act(801) });
    const after = tail({ type: 'live', act: act(801) }, { type: 'cut', seq: 800 });
    for (const f of [before, after]) {
      expect(f.cut.has(800)).toBe(true);
      expect(seqs(feedReducer(f, { type: 'release', slide: false, force: false }).shown)).toContain(801);
    }
    /* A later page takes its own cut numbers in too, and keeps the ones held. */
    const more = feedReducer(tail({ type: 'cut', seq: 790 }), { type: 'more', page: 41, acts: run(801, 819), tailLoaded: false, cut: [820] });
    expect([...more.cut].sort()).toEqual([790, 820]);
  });
  it('is never counted by the bar: not in the posts waiting, and not as the first or last of them', () => {
    const f = reduce(loaded({ acts: run(1, 20), last: 47, page: 1, full: true, back: { shown: 20, known: 45 } }), { type: 'cut', seq: 46 });
    expect(waitingPosts(f)).toEqual({ count: 1, first: 47, last: 47 });
    const tailCut = reduce(loaded({ acts: run(1, 20), last: 47, page: 1, full: true, back: { shown: 20, known: 45 } }), { type: 'cut', seq: 47 });
    expect(waitingPosts(tailCut)).toEqual({ count: 1, first: 46, last: 46 });
    const none = reduce(loaded({ acts: run(1, 20), last: 46, page: 1, full: true, back: { shown: 20, known: 45 } }), { type: 'cut', seq: 46 });
    expect(waitingPosts(none)).toBeNull();
  });
  it('is read again with its Act when the play ends inside the run: the Act takes its place in order', () => {
    const f = reduce(loaded({ acts: run(781, 799), last: 800, page: 40 }), { type: 'cut', seq: 800 });
    const un = feedReducer(f, { type: 'uncut', act: act(800) });
    expect(un.cut.has(800)).toBe(false);
    expect(seqs(un.shown)).toEqual(run(781, 800).map((a) => a.seq));
    /* Twice is once. */
    expect(feedReducer(un, { type: 'uncut', act: act(800) })).toEqual(un);
  });
  it('takes a middle number back the same way: shown between its neighbors', () => {
    const f = reduce({ ...loaded({ acts: [...run(1, 4), ...run(6, 20)], last: 20, page: 1 }), cut: [5] } as FeedAction);
    expect(seqs(f.shown)).not.toContain(5);
    expect(seqs(feedReducer(f, { type: 'uncut', act: act(5) }).shown)).toEqual(run(1, 20).map((a) => a.seq));
  });
  it('takes the Act off its number when a read made before the play had it there', () => {
    const f = reduce(loaded({ acts: run(781, 800), last: 800, page: 40 }), { type: 'cut', seq: 800 });
    expect(seqs(f.shown)).toEqual(run(781, 799).map((a) => a.seq));
    expect(f.cut.has(800)).toBe(true);
  });
  it('outside the run, only the number is let go: the Act is read with its page', () => {
    const f = reduce(loaded({ acts: run(1, 20), last: 45, page: 1, full: true }), { type: 'cut', seq: 41 });
    const un = feedReducer(f, { type: 'uncut', act: act(41) });
    expect(un.cut.has(41)).toBe(false);
    expect(seqs(un.shown)).toEqual(run(1, 20).map((a) => a.seq));
    expect(un.held.size).toBe(0);
  });
});
