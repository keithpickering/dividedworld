/**
 * The polls store's ordering: what a page read says is never newer than what was heard after the read was asked (a late read must not undo a live count, a cast ballot
 * or a replaced poll), a poll a reread no longer holds is dropped, and a secret poll keeps no voter list.
 */
import { describe, expect, test } from 'vitest';
import type { Act, Ballot, Poll, PollVoter } from '../data/api.ts';
import { createPolls } from './store.ts';

const act = (id: string, payload: Record<string, unknown>, at: string, extra: Partial<Act> = {}): Act => ({
  id, character: 'c1', kind: 'poll', thread: 't', targetActId: 'post1', seq: null, createdAt: at, payload, currentPayload: payload, editedAt: null, shownEditedAt: null, ...extra,
});
const POLL: Poll = {
  post: 'post1', act: act('poll1', { question: 'Q?', options: ['A', 'B'], pick: 1, secret: false, closes_at: '2026-12-01T00:00:00.000Z' }, '2026-11-20T00:00:00.000Z'),
  counts: [0, 0], voters: 0, endsAt: '2026-12-01T00:00:00.000Z', closed: false, close: null, balloted: false,
};
const page = (polls: Poll[], voters: PollVoter[] = [], myBallots: Ballot[] = []) => ({ polls, voters, votersMore: [], myBallots, voterCast: [] });

/** A clock the test turns by hand, as the thread's tickets are. */
function world() {
  let n = 0;
  const polls = createPolls(() => ++n);
  return { polls, ask: () => ++n };
}

describe('a page read that started before what was heard', () => {
  test('does not undo a live count, a cast ballot or a close', () => {
    const w = world();
    w.polls.take(page([POLL]), 0, ['post1']);
    const asked = w.ask();
    w.polls.counts({ poll: 'poll1', counts: [1, 0], voters: 1, endsAt: POLL.endsAt, closed: false, at: '2026-11-20T01:00:00.000Z' });
    w.polls.take(page([POLL]), asked, ['post1']);
    expect(w.polls.get('post1')!.poll.counts).toEqual([1, 0]);
    const second = w.ask();
    w.polls.cast('poll1', 'c9', [1], { act: act('b1', { picks: [1] }, '2026-11-20T02:00:00.000Z', { kind: 'ballot', targetActId: 'poll1', character: 'c9' }), counts: { poll: 'poll1', counts: [1, 1], voters: 2, endsAt: POLL.endsAt, closed: false } });
    w.polls.take(page([POLL]), second, ['post1']);
    expect(w.polls.get('post1')!.poll.counts).toEqual([1, 1]);
    expect(w.polls.get('post1')!.mine.map((b) => b.character)).toEqual(['c9']);
  });

  test('is taken once it is newer than anything heard', () => {
    const w = world();
    w.polls.take(page([POLL]), 0, ['post1']);
    w.polls.counts({ poll: 'poll1', counts: [1, 0], voters: 1, endsAt: POLL.endsAt, closed: false, at: '2026-11-20T01:00:00.000Z' });
    w.polls.take(page([{ ...POLL, counts: [4, 4], voters: 8 }]), w.ask(), ['post1']);
    expect(w.polls.get('post1')!.poll.counts).toEqual([4, 4]);
  });
});

describe('a reread of a post', () => {
  test('drops a poll the page no longer holds, and keeps one it never asked about', () => {
    const w = world();
    w.polls.take(page([POLL]), 0, ['post1']);
    w.polls.take(page([]), w.ask(), ['post2']);
    expect(w.polls.get('post1')).toBeDefined();
    w.polls.take(page([]), w.ask(), ['post1']);
    expect(w.polls.get('post1')).toBeUndefined();
  });
});

describe('a secret poll', () => {
  test('keeps no voter, whatever a page carries for it', () => {
    const w = world();
    const secret: Poll = { ...POLL, act: act('poll1', { ...POLL.act.payload, secret: true }, POLL.act.createdAt) };
    w.polls.take(page([secret], [{ poll: 'poll1', act: 'b', character: 'c2', picks: [0], at: '2026-11-20T01:00:00.000Z' }]), 0, ['post1']);
    expect(w.polls.get('post1')!.voters).toEqual([]);
  });
});
