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
