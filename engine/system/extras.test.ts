import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originLine, placeWords, playLine, pollLines, pollShort, reactionLine, rewoundLine, type ReadOrigin, type ReadPlace, type ReadPlay, type ReadPoll } from './extras.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const minus = (ms: number): string => new Date(NOW - ms).toISOString();
const plus = (ms: number): string => new Date(NOW + ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

const poll = (o: Partial<ReadPoll> = {}): ReadPoll => ({
  question: 'Best kart in the series?', options: ['Mach 8', 'Blue Falcon'], pick: 2, secret: true, endsAt: plus(2 * H), closed: false, closedBy: null, counts: [5, 7], voters: 9, ...o,
});

test('an open poll: question, rules, time left, each option with its count and share, and how many characters voted', () => {
  assert.deepEqual(pollLines(poll(), NOW), [
    '[poll on this post] "Best kart in the series?" (pick up to 2; secret ballots)',
    '  Open: ends in 2 hours.',
    '  1. Mach 8: 5 (42%)',
    '  2. Blue Falcon: 7 (58%)',
    '  9 characters voted.',
  ]);
});

test('a poll closed by its time, by its author and by an admin; public one-pick; an option at 0; one voter; none', () => {
  assert.equal(pollLines(poll({ closed: true, endsAt: minus(180 * D) }), NOW)[1], '  Closed 6 months ago.');
  assert.equal(pollLines(poll({ closed: true, endsAt: plus(3 * D), closedBy: 'author' }), NOW)[1], '  Closed early, by its author.');
  assert.equal(pollLines(poll({ closed: true, endsAt: plus(3 * D), closedBy: 'admin' }), NOW)[1], '  Closed early, by an admin.');
  const open = pollLines(poll({ pick: 1, secret: false, counts: [0, 3], voters: 1 }), NOW);
  assert.equal(open[0], '[poll on this post] "Best kart in the series?" (pick one)');
  assert.deepEqual(open.slice(2), ['  1. Mach 8: 0 (0%)', '  2. Blue Falcon: 3 (100%)', '  1 character voted.']);
  const none = pollLines(poll({ counts: [0, 0], voters: 0 }), NOW);
  assert.deepEqual(none.slice(2), ['  1. Mach 8: 0 (0%)', '  2. Blue Falcon: 0 (0%)', '  No one has voted.']);
});

test('pollShort: open, tied, closed, early, and no votes', () => {
  const q = poll({ question: 'Rename this board?', options: ['Yes', 'No'], counts: [9, 4], voters: 13 });
  assert.equal(pollShort(q, NOW), '[poll: "Rename this board?", Yes leads 9 to 4, closes in 2 hours]');
  assert.equal(pollShort({ ...q, counts: [6, 6] }, NOW), '[poll: "Rename this board?", Yes and No tied at 6, closes in 2 hours]');
  assert.equal(pollShort({ ...q, closed: true, endsAt: minus(3 * D) }, NOW), '[poll: "Rename this board?", Yes won 9 to 4, closed 3 days ago]');
  assert.equal(pollShort({ ...q, closed: true, closedBy: 'admin', endsAt: plus(D) }, NOW), '[poll: "Rename this board?", Yes won 9 to 4, closed early by an admin]');
  assert.equal(pollShort({ ...q, counts: [0, 0] }, NOW), '[poll: "Rename this board?", no votes yet, closes in 2 hours]');
});

test('a poll with voters\' names renders exactly as one without', () => {
  assert.deepEqual(pollLines(poll({ names: [['Wario'], ['Toad', 'Yoshi']] }), NOW), pollLines(poll(), NOW));
  assert.equal(pollShort(poll({ names: [['Wario'], []] }), NOW), pollShort(poll(), NOW));
});

test('reactions: most first then by kind, as the instance names them; none is no line', () => {
  const name = (k: string): string => ({ heart: '❤', laugh: '😂', wow: '😮' })[k] ?? k;
  assert.equal(reactionLine({ laugh: 1, heart: 3, wow: 1 }, name), '[Reactions: ❤ 3, 😂 1, 😮 1]');
  assert.equal(reactionLine({ wow: 2, heart: 2 }, name), '[Reactions: ❤ 2, 😮 2]');
  assert.equal(reactionLine({}, name), null);
  assert.equal(reactionLine({ heart: 0 }, name), null);
});

test('a play: the instance\'s sentence when it has one, else the card\'s name, else a face-down card', () => {
  const play: ReadPlay = { play: 'p1', card: 'whoops', at: minus(2 * D), by: 'Wario', config: {}, state: {} };
  const cardName = (k: string): string | undefined => (k === 'whoops' ? 'Whoops!' : undefined);
  assert.equal(playLine(play, { now: NOW, seen: 'Wario covered this post in goop, 2 days ago.', cardName }), '[Wario covered this post in goop, 2 days ago.]');
  assert.equal(playLine(play, { now: NOW, seen: null, cardName }), '[Whoops! was played on this post, 2 days ago.]');
  assert.equal(playLine({ ...play, card: 'other' }, { now: NOW, seen: null, cardName }), '[A card was played on this post, 2 days ago.]');
  assert.equal(playLine({ ...play, card: null }, { now: NOW, seen: null, cardName }), '[A card set face down was played on this post, 2 days ago.]');
});

test('a rewound post says it shows how it looked', () => {
  assert.equal(rewoundLine(minus(3 * H), NOW), '[This post is showing how it looked 3 hours ago.]');
  assert.equal(rewoundLine(null, NOW), null);
});

const post = (seq: number, title = 'Best kart?') => ({ kind: 'post' as const, thread: 't1', title, seq });

test('placeWords says every origin_place kind', () => {
  const cards = { cardName: (k: string) => (k === 'whoops' ? 'Whoops!' : undefined), groupName: (k: string) => (k === 'g1' ? 'The Pit' : undefined) };
  const w = (p: ReadPlace | null): string => placeWords(p, cards);
  assert.equal(w(post(4)), 'post #4 in "Best kart?"');
  assert.equal(w({ kind: 'update', act: 'u1', title: 'New board' }), 'the Updates post "New board"');
  assert.equal(w({ kind: 'poll', question: 'Which?', on: post(4) }), 'the poll "Which?" on post #4 in "Best kart?"');
  assert.equal(w({ kind: 'poll', question: 'x'.repeat(70), on: post(4) }), `the poll "${'x'.repeat(60)}…" on post #4 in "Best kart?"`);
  assert.equal(w({ kind: 'ballot', character: { id: 'c1', name: 'Wario' }, question: 'Which?', on: post(4) }), 'Wario\'s ballot in the poll "Which?" on post #4 in "Best kart?"');
  assert.equal(w({ kind: 'play', card: 'whoops', on: post(4) }), 'Whoops! on post #4 in "Best kart?"');
  assert.equal(w({ kind: 'play', card: null, on: { kind: 'board', slug: 'games', name: 'Games' } }), 'a face-down card on the board Games');
  assert.equal(w({ kind: 'play', card: 'zzz', on: { kind: 'thread', id: 't2', title: 'Hello' } }), 'a card on the thread "Hello"');
  assert.equal(w({ kind: 'play', card: 'whoops', on: { kind: 'update', act: 'u1', title: 'News' } }), 'Whoops! on the Updates post "News"');
  assert.equal(w({ kind: 'play', card: 'whoops', on: { kind: 'character', id: 'c2', name: 'Toad' }, at: post(31) }), 'Whoops! on Toad, at post #31 in "Best kart?"');
  assert.equal(w({ kind: 'play', card: 'whoops', on: { kind: 'character', id: 'c2', name: null }, from: post(12) }), 'Whoops! on a character, cast from post #12 in "Best kart?"');
  assert.equal(w({ kind: 'play', card: 'whoops', on: null }), 'Whoops!');
  const ask = { asker: { id: 'a', name: 'Yoshi' }, staff: { id: 's', name: 'Mod One' }, group: null, on: post(4) };
  assert.equal(w({ kind: 'answer', spun: 'ask', ask: 'report', punishment: null, ...ask }), 'Yoshi\'s report of post #4 in "Best kart?"');
  assert.equal(w({ kind: 'answer', spun: 'answer', ask: 'report', punishment: null, ...ask }), 'Mod One\'s verdict on Yoshi\'s report of post #4 in "Best kart?"');
  assert.equal(w({ kind: 'answer', spun: 'answer', ask: 'appeal', punishment: 'ban', ...ask }), 'Mod One\'s ruling on Yoshi\'s appeal of the ban from post #4 in "Best kart?"');
  assert.equal(w({ kind: 'answer', spun: 'ask', ask: 'appeal', punishment: 'infraction', ...ask, staff: null }), 'Yoshi\'s appeal of the warn points from post #4 in "Best kart?"');
  assert.equal(w({ kind: 'answer', spun: 'ask', ask: 'appeal', punishment: 'move', ...ask, group: 'g1', on: null }), 'Yoshi\'s appeal of the move into The Pit');
  assert.equal(w({ kind: 'answer', spun: 'ask', ask: 'appeal', punishment: 'move', ...ask, group: 'gx', on: null }), 'Yoshi\'s appeal of the move into gx');
  assert.equal(w({ kind: 'answer', spun: 'ask', ask: 'report', punishment: null, ...ask, on: null }), 'Yoshi\'s report of a post');
  assert.equal(w(null), 'somewhere on the board');
});

test('the origin line: when it was spun and when the origin happened; "as it stood" for a moment', () => {
  const o: ReadOrigin = { kind: 'post', place: post(4), at: minus(180 * D), spunAt: minus(3 * D), moment: false, post: null };
  assert.equal(originLine(o, NOW), '(This thread was spun 3 days ago from post #4 in "Best kart?", written 6 months ago.)');
  const named: ReadOrigin = { ...o, post: { act: 'p4', seq: 4, at: minus(180 * D), author: 'wario', name: 'Wario', body: '', title: 'Best kart?', poll: null, plays: [], reactions: {} } };
  assert.equal(originLine(named, NOW), '(This thread was spun 3 days ago from Wario\'s post #4 in "Best kart?", written 6 months ago.)');
  const m: ReadOrigin = { ...o, kind: 'card', place: { kind: 'play', card: 'whoops', on: post(4) }, moment: true };
  assert.equal(originLine(m, NOW, { cardName: () => 'Whoops!' }), '(This thread was spun 3 days ago from Whoops! on post #4 in "Best kart?", 6 months ago, as it stood when it was spun.)');
});
