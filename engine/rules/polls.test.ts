import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countedBallots, pickRefusal, percent, pollClosed, pollCounts, pollDraftProblems, type PollDraft, type PollSettings } from './polls.ts';

const S: PollSettings = { pollOptionsMax: 10, pollQuestionMax: 200, pollOptionMax: 100, pollLastsMin: { unit: 'hour', count: 1 }, pollLastsMax: { unit: 'day', count: 14 } };
const good: PollDraft = { question: 'Which?', options: ['a', 'b', 'c'], pick: 1, secret: false, lasts: { unit: 'day', count: 3 } };
const bad = (patch: Record<string, unknown>) => pollDraftProblems({ ...good, ...patch }, S);

test('a well formed draft has no problem, whether lasts is a span or an interval string', () => {
  assert.deepEqual(pollDraftProblems(good, S), []);
  assert.deepEqual(pollDraftProblems({ ...good, lasts: '3 days' }, S), []);
  assert.deepEqual(pollDraftProblems({ ...good, lasts: '1 hour' }, S), []);
});

/* Each refusal held beside the sentence supabase/tests/0395-polls.sql expects of poll_written (those lines are named). */
const TABLE: [string, Record<string, unknown>, string][] = [
  ['one option (0395-polls.sql:270)', { options: ['a'] }, 'a poll has 2 to 10 options'],
  ['eleven options (:272)', { options: Array.from({ length: 11 }, (_, i) => String(i)) }, 'a poll has 2 to 10 options'],
  ['options that are no list (:274)', { options: 'ab' }, 'a poll has 2 to 10 options'],
  ['pick 0 (:284)', { pick: 0 }, 'a poll lets 1 to 3 options be picked'],
  ['pick past the options (:286)', { pick: 4 }, 'a poll lets 1 to 3 options be picked'],
  ['a pick that is no whole number', { pick: 1.5 }, 'a poll lets 1 to 3 options be picked'],
  ['a secret that is no boolean (:288)', { secret: 'yes' }, "a poll's ballots are public or secret"],
  ['30 minutes (:290)', { lasts: { unit: 'minute', count: 30 } }, 'a poll lasts from 1 hour to 14 days'],
  ['30 minutes as a string', { lasts: '30 minutes' }, 'a poll lasts from 1 hour to 14 days'],
  ['15 days (:292)', { lasts: '15 days' }, 'a poll lasts from 1 hour to 14 days'],
  ['"soon" (:294)', { lasts: 'soon' }, 'a poll lasts from 1 hour to 14 days'],
  ['no length (:296)', { lasts: undefined }, 'a poll lasts from 1 hour to 14 days'],
  ['a repeated option', { options: ['a', ' a ', 'c'] }, 'no two options are the same'],
  ['an empty question', { question: ' ​' }, 'question is empty'],
  ['a long question', { question: 'x'.repeat(201) }, 'question is longer than 200 characters'],
  ['an empty option', { options: ['a', ''] }, 'option is empty'],
  ['a long option', { options: ['a', 'y'.repeat(101)] }, 'option is longer than 100 characters'],
];
for (const [name, patch, said] of TABLE) test(`refusal: ${name}`, () => assert.deepEqual(bad(patch), [said]));

test('the span in a refusal is singular for 1, as span_words says it', () => {
  assert.deepEqual(pollDraftProblems({ ...good, lasts: 'soon' }, { ...S, pollLastsMax: { unit: 'week', count: 1 } }), ['a poll lasts from 1 hour to 1 week']);
});

test('the pick refusal is singular for 1', () => {
  assert.equal(pickRefusal(1), 'pick up to 1 option');
  assert.equal(pickRefusal(3), 'pick up to 3 options');
});

const b = (act: string, character: string | null, picks: number[], at: string) => ({ act, character, picks, at });
const poll = { options: ['a', 'b', 'c'], endsAt: '2026-01-02T00:00:00Z' };

test('a character counts once, by its latest ballot before the end; a withdrawal is no voter', () => {
  const ballots = [
    b('1', 'x', [0], '2026-01-01T01:00:00Z'), b('2', 'x', [1, 2], '2026-01-01T02:00:00Z'),
    b('3', 'y', [0], '2026-01-01T03:00:00Z'), b('4', 'y', [], '2026-01-01T04:00:00Z'),
    b('5', 'z', [2], '2026-01-01T05:00:00Z'), b('6', 'z', [0], '2026-01-02T00:00:00Z'),
    b('7', null, [0], '2026-01-01T05:00:00Z'),
  ];
  assert.deepEqual(countedBallots(ballots, poll.endsAt).map((x) => x.act).sort(), ['2', '4', '5']);
  assert.deepEqual(pollCounts(poll, ballots), { counts: [0, 1, 2], voters: 2 });
});

test('a tie in time is broken by id, and picks outside the options are ignored', () => {
  const t = '2026-01-01T01:00:00Z';
  assert.deepEqual(pollCounts(poll, [b('a', 'x', [0], t), b('b', 'x', [1, 9], t)]), { counts: [0, 1, 0], voters: 1 });
});

test('closed once now reaches the earlier of the end and the close', () => {
  assert.equal(pollClosed(poll, null, '2026-01-01T23:59:59Z'), false);
  assert.equal(pollClosed(poll, null, '2026-01-02T00:00:00Z'), true);
  assert.equal(pollClosed(poll, { createdAt: '2026-01-01T10:00:00Z' }, new Date('2026-01-01T10:00:00Z')), true);
});

test('percent is of the picks, rounded, 0 for none', () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(2, 3), 67);
  assert.equal(percent(0, 0), 0);
});

test('two options are one when equal after stripping spaces only, as btrim does: a newline is a difference', () => {
  assert.deepEqual(bad({ options: ['a', 'a\n', 'c'] }), []);
  assert.deepEqual(bad({ options: ['a', '  a', 'c'] }), ['no two options are the same']);
});

test('a unit that is an inherited key is no span', () => {
  assert.deepEqual(bad({ lasts: { unit: 'constructor', count: 3 } }), ['a poll lasts from 1 hour to 14 days']);
});

test('a draft that is null or a list, and an option that is no string, are refused in words', () => {
  assert.deepEqual(pollDraftProblems(null, S), ['question is empty']);
  assert.deepEqual(pollDraftProblems([], S), ['question is empty']);
  assert.deepEqual(bad({ options: ['a', 5, 'c'] }), ['option is empty']);
});

test('a ballot of no character is not counted; an invalid time counts for nothing and closes nothing', () => {
  assert.deepEqual(countedBallots([b('1', null, [0], '2026-01-01T00:00:00Z')], poll.endsAt), []);
  assert.deepEqual(countedBallots([b('1', 'x', [0], 'soon')], poll.endsAt), []);
  assert.deepEqual(countedBallots([b('1', 'x', [0], '2026-01-01T00:00:00Z')], 'never'), []);
  assert.equal(pollClosed({ endsAt: 'never' }, null, '2030-01-01T00:00:00Z'), false);
});

test('a close later than the end changes nothing: the earlier wins', () => {
  assert.equal(pollClosed(poll, { createdAt: '2026-01-05T00:00:00Z' }, '2026-01-03T00:00:00Z'), true);
  assert.equal(pollClosed(poll, { createdAt: '2026-01-05T00:00:00Z' }, '2026-01-01T00:00:00Z'), false);
});
