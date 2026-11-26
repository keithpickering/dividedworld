import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXCERPT_WORDS } from './excerpt.ts';
import { READ_WORDS } from './read.ts';
import { CLIPS, DIGEST_MOST, renderDigest, standingWords, type Digest, type DigestConversation } from './digest.ts';
import type { Memory } from './memory.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';

const she = PRONOUN_PRESETS.she;
const they = PRONOUN_PRESETS.they;

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const small: Digest = {
  since: '2026-10-30T00:00:00Z',
  until: '2026-10-31T00:00:00Z',
  threads: [{ thread: id(1), title: 'Who ate the pie', board: 'General', posts: 9, heat: 0.38, controversy: 0.5, length: 40 }],
  standings: [{ rank: 1, character: id(2), amount: 120 }],
  moves: [],
  boards: [{ id: id(60), name: 'Busy Place', premise: 'Where it is loud.', posts: 12 }, { id: id(61), name: 'Empty Place', premise: '', posts: 0 }],
  boardDays: 21,
  quotes: [{ from: id(2), to: id(3), count: 2 }],
  bossReactions: [{ act: id(9), thread: id(1), total: 5, tally: { fire: 4, skull: 1 } }],
  excerpts: [{ act: id(8), thread: id(1), character: id(3), reactions: 7, text: 'It was me all along' }],
  conversations: [],
  characters: [
    { id: id(2), name: 'Mario', staff: false, pronouns: she },
    { id: id(3), name: 'Luigi', staff: false, pronouns: they },
  ],
};
const memory: Memory = {
  hobby: { name: 'tomatoes', since: '2026-10-30', from: 'Luigi' },
  opinions: [{ character: id(2), score: 3, note: 'funny' }],
  grudges: [{ character: id(3), note: 'stole my pie' }],
  wheelhouse: ['speedruns'],
  realWorld: ['elections'],
  marks: [],
};

test('a digest renders as plain text with each section and the characters by name', () => {
  const text = renderDigest(small, memory, ['A feed item']);
  for (const heading of ['What you remember', 'Hot threads', 'Boards', 'Standings', 'Moves', 'Quotes between characters', 'Reactions to your own posts', 'Top posts', 'Outside']) {
    assert.ok(text.includes(`## ${heading}`), heading);
  }
  assert.ok(text.includes('"Who ate the pie" on General: 9 posts in the window (0.38 an hour), 40 in all, controversy 0.5.'));
  assert.ok(text.includes('Busy Place (Where it is loud.): 12 posts in 21 days'));
  assert.ok(text.includes('Empty Place: 0 posts in 21 days'), 'a board with no premise reads without parentheses');
  assert.ok(text.includes('1. Mario (she/her): 120'));
  assert.ok(text.includes('Mario (she/her) quoted Luigi (they/them) 2 times.'));
  assert.ok(text.includes('5 in all: fire 4, skull 1.'));
  assert.ok(text.includes('Luigi (they/them), 7 reactions: It was me all along'));
  assert.ok(text.includes('Opinion of Mario (she/her): 3. funny'));
  assert.ok(text.includes('- A feed item'));
  assert.ok(!/[<>]|\{|\}/.test(text.replace(/## /g, '')), 'plain text, no markup or json');
});

test('a new Boss is told it has no memory, and empty sections say so', () => {
  const text = renderDigest({ ...small, threads: [], boards: [], standings: [], quotes: [], bossReactions: [], excerpts: [] }, null, []);
  assert.ok(text.includes('You are new to this board.'));
  assert.ok(text.includes('No settlement landed in the window.'));
  assert.ok(text.includes('Nothing from outside.'));
});

test('a character the digest does not list is "someone", never an id', () => {
  const text = renderDigest({ ...small, characters: [] }, null, []);
  assert.ok(text.includes('1. someone: 120'));
  assert.ok(!text.includes(id(2)));
});

// The ceilings the renderer owns, every field at its longest and every list over-long: the rendered length has a
// ceiling computed from the constants, whatever a digest hands it.
test('a move in force and one that ended read as plain lines with their state and progress first', () => {
  const inForce = { act: id(20), kind: 'renameBoard', params: { name: 'Pointless Toast Palace' }, demand: { kind: 'postsOnBoard' }, progress: { done: 7, of: 12, met: false }, ended: null };
  const ended = { ...inForce, act: id(21), progress: { done: 12, of: 12, met: true }, ended: { why: 'reversed', by: 'admin', at: '2026-10-31T00:00:00Z' } };
  const text = renderDigest({ ...small, moves: [inForce, ended] }, null, []);
  assert.ok(text.includes('renameBoard: in force; demand postsOnBoard 7 of 12; renamed a board to "Pointless Toast Palace"'), text);
  assert.ok(text.includes('renameBoard: ended reversed by admin; demand postsOnBoard 12 of 12, met; renamed a board to "Pointless Toast Palace"'), text);
  const held = { act: null, kind: 'renameBoard', params: { name: 'Held Hall' }, demand: { kind: 'postsOnBoard' }, progress: null, ended: null, state: 'held', heldAt: '2026-10-31T00:00:00Z', why: 'fun' };
  assert.ok(renderDigest({ ...small, moves: [held] }, null, []).includes('renameBoard: held by an admin before it landed; demand postsOnBoard, never asked; renamed a board to "Held Hall"'));
  assert.ok(renderDigest({ ...small, moves: [{ note: 'unknown shape' }] }, null, []).includes('{"note":"unknown shape"}'));
});

test('a move that ended met says who met it, by name, up to the ceiling, and names no one it was not given', () => {
  const met = { act: id(30), kind: 'renameBoard', params: { name: 'Toast' }, demand: { kind: 'postsOnBoard' }, progress: { done: 3, of: 3, met: true }, ended: { why: 'met', by: 'demand', at: '2026-10-31T00:00:00Z' }, state: 'ended' };
  const people = Array.from({ length: DIGEST_MOST.metBy + 2 }, (_, i) => ({ id: id(40 + i), name: `Person ${i}`, staff: false, pronouns: she }));
  const render = (metBy: unknown) => renderDigest({ ...small, moves: [{ ...met, metBy }], characters: people }, null, []);
  assert.ok(render([people[0]!.id, people[1]!.id, people[2]!.id]).includes('met by Person 0 (she/her), Person 1 (she/her) and Person 2 (she/her).'));
  assert.ok(render([people[0]!.id]).includes('met by Person 0 (she/her).'));
  assert.ok(render([people[0]!.id, id(99)]).includes('met by Person 0 (she/her) and someone.'), 'an id the digest does not name reads as someone');
  assert.ok(!/met by Person/.test(render([])), 'no one listed, nothing said');
  assert.ok(!/met by Person/.test(render('not a list')));
  const all = render(people.map((p) => p.id));
  assert.ok(all.includes(`Person ${DIGEST_MOST.metBy - 1} (she/her).`) && !all.includes(`Person ${DIGEST_MOST.metBy}`), 'at most the ceiling are named');
});

test('the rendered length is bounded by the ceilings, whatever the digest holds', () => {
  const { threads: T, excerpts: E, excerptChars: C, feed: F, metBy: M, boards: B } = DIGEST_MOST;
  const OVER = 3;
  const long = (n: number): string => 'x'.repeat(n);
  const names = Array.from({ length: (4 + M) * (E + OVER) }, (_, i) => ({ id: id(1000 + i), name: long(500), staff: false, pronouns: PRONOUN_PRESETS.it }));
  const lists = (n: number) => Array.from({ length: n }, (_, i) => i);
  const digest: Digest = {
    since: '2026-10-30T00:00:00.000000+00:00',
    until: '2026-10-31T00:00:00.000000+00:00',
    threads: lists(T + OVER).map((i) => ({ thread: id(i), title: long(5000), board: long(5000), posts: 99999999, heat: 99999999.99, controversy: 0.7499, length: 99999999 })),
    standings: lists(E + OVER).map((i) => ({ rank: i + 1, character: names[i]!.id, amount: 2000000000 })),
    moves: lists(E + OVER).map((i) => ({ move: long(5000), i, metBy: lists(M + OVER).map((k) => names[4 * (E + OVER) + (i * M + k) % (M * (E + OVER))]!.id) })),
    boards: lists(B + OVER).map((i) => ({ id: id(i), name: long(5000), premise: long(5000), posts: 99999999 })),
    boardDays: 99999999,
    quotes: lists(E + OVER).map((i) => ({ from: names[i]!.id, to: names[i + 1]!.id, count: 99999999 })),
    bossReactions: lists(E + OVER).map((i) => ({ act: id(i), thread: id(i), total: 99999999, tally: Object.fromEntries(lists(12).map((k) => [long(100) + k, 99999999])) })),
    excerpts: lists(E + OVER).map((i) => ({ act: id(i), thread: id(i), character: names[i]!.id, reactions: 99999999, text: long(5 * C) })),
    conversations: [],
    characters: names,
  };
  const text = renderDigest(digest, null, lists(F + OVER).map(() => long(5000)));
  // A line's fixed words and numbers fit in 200; every free string counts at its clip.
  const LINE = 200;
  const bound =
    2000 + // headings, the window, the empty-section sentences
    T * (CLIPS.title + CLIPS.board + LINE) +
    B * (CLIPS.board + CLIPS.premise + LINE) + // boards
    E * (CLIPS.name + LINE) + // standings
    E * (CLIPS.move + LINE + M * (CLIPS.name + 2)) + // moves, and those who met them
    E * (2 * CLIPS.name + LINE) + // quotes
    E * (CLIPS.tallyKinds * (CLIPS.kind + LINE) + LINE) + // reactions to the Boss
    E * (CLIPS.name + C + LINE) + // top posts
    F * (CLIPS.feedItem + LINE);
  assert.ok(text.length <= bound, `${text.length} > ${bound}`);
  // And the lists really stop at their ceilings: one past each is not shown.
  const lines = (heading: string): number => {
    const body = text.split(`## ${heading}\n`)[1]!.split('\n\n')[0]!;
    return body.split('\n').length;
  };
  assert.equal(lines('Hot threads'), T);
  assert.equal(lines('Boards'), B);
  assert.equal(lines('Standings'), E);
  assert.equal(lines('Moves'), E);
  assert.equal(lines('Quotes between characters'), E);
  assert.equal(lines('Reactions to your own posts'), E);
  assert.equal(lines('Top posts'), E);
  assert.equal(lines('Outside'), F);
  assert.ok(text.split('\n').every((l) => !l.includes('x'.repeat(C + 1))), 'an excerpt is clipped to the excerpt maximum');
  // Longer free text does not make it longer: the clips hold.
  const longer = renderDigest({ ...digest, threads: digest.threads.map((t) => ({ ...t, title: long(50000) })), boards: digest.boards.map((b) => ({ ...b, name: long(50000), premise: long(50000) })) }, null, []);
  assert.equal(longer.length, renderDigest(digest, null, []).length);
});

test('the board lines read name, premise, posts and days, cut to their bounds', () => {
  const text = renderDigest({ ...small, boards: [{ id: id(70), name: '  Spaced\n out  ', premise: 'Line one.\nLine two.', posts: 1 }, { id: id(71), name: 'N'.repeat(500), premise: 'P'.repeat(500), posts: 3 }], boardDays: 7 }, null, []);
  const body = text.split('## Boards\n')[1]!.split('\n\n')[0]!.split('\n');
  assert.equal(body[0], 'Spaced out (Line one. Line two.): 1 post in 7 days.');
  assert.equal(body[1], `${'N'.repeat(CLIPS.board)} (${'P'.repeat(CLIPS.premise)}): 3 posts in 7 days.`);
  const none = renderDigest({ ...small, boards: [] }, null, []);
  assert.ok(none.includes('## Boards\nNo board is open.'), 'an empty list says so');
});

test('the lines name no owner, class or reaction: a board line is its name, premise and count', () => {
  const text = renderDigest(small, null, []);
  const line = text.split('\n').find((l) => l.startsWith('Busy Place'))!;
  assert.equal(line, 'Busy Place (Where it is loud.): 12 posts in 21 days.');
});

test('a board line with a days count that is no number never reads NaN', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number, '21' as unknown as number]) {
    const text = renderDigest({ ...small, boardDays: bad }, null, []);
    assert.ok(!text.includes('NaN') && !text.includes('Infinity') && !text.includes('undefined'), String(bad));
    assert.ok(text.includes('Busy Place (Where it is loud.): 12 posts.'), `without days: ${String(bad)}`);
  }
});

test('a digest excerpt the source cut ends in an ellipsis though it is under the bound, and one that fit does not', () => {
  const cutOut = renderDigest({ ...small, excerpts: [{ ...small.excerpts[0]!, text: 'It was me all al', cut: true }] }, null, []);
  assert.ok(cutOut.includes('It was me all…'), 'the source said it cut');
  const whole = renderDigest({ ...small, excerpts: [{ ...small.excerpts[0]!, text: 'It was me all along', cut: false }] }, null, []);
  assert.ok(whole.includes('It was me all along') && !whole.includes('along…'), 'a post that fit gains no ellipsis');
});

test('a digest excerpt over the bound is cut at a word with an ellipsis, and the digest says once what that means, only when it shows one', () => {
  const text = 'word '.repeat(400);
  const out = renderDigest({ ...small, excerpts: [{ ...small.excerpts[0]!, text }] }, null, []);
  assert.ok(out.includes('word…'), 'cut at a word, marked');
  assert.ok(!out.includes('word '.repeat(300)), 'the excerpt is bounded');
  assert.equal(out.split(EXCERPT_WORDS).length - 1, 1);
  const none = renderDigest({ ...small, excerpts: [] }, null, []);
  assert.ok(!none.includes(EXCERPT_WORDS));
});

// ---- The conversations (docs/plans/2026-11-22-chattier-staff-plan.md, Task 6; the design's section 5) ----
const conv = (n: number, over: Partial<DigestConversation> = {}): DigestConversation => ({
  thread: id(100 + n),
  title: `Thread ${n}`,
  persona: { staff: 'mod-a', character: id(4) },
  with: [{ id: id(2), name: 'Mario' }, { id: id(3), name: 'Luigi' }],
  turns: 3,
  reactions: 11,
  exchange: { text: 'Your pie is cold, friends.', cut: false, reply: { character: id(3), text: 'It was fresh when I left it.', cut: false } },
  ...over,
});
const withStaff: Digest = { ...small, characters: [...small.characters, { id: id(4), name: 'Modly', staff: true, pronouns: she }] };

test('the conversations section renders each field: thread, persona, who it answered, turns, reactions and the hottest exchange', () => {
  const text = renderDigest({ ...withStaff, conversations: [conv(1)] }, null, []);
  assert.ok(text.includes('## Conversations'));
  assert.ok(text.indexOf('## Top posts') < text.indexOf('## Conversations') && text.indexOf('## Conversations') < text.indexOf('## Outside'), 'after the excerpts');
  const row = text.split('\n').find((l) => l.startsWith('1. Modly'))!;
  assert.ok(row.includes('Modly (she/her)'), row);
  assert.ok(row.includes('"Thread 1"'), row);
  assert.ok(row.includes('3 turns') && row.includes('11 reactions'), row);
  assert.ok(row.includes('Mario (she/her)') && row.includes('Luigi (they/them)'), row);
  assert.ok(row.includes('Your pie is cold, friends.') && row.includes('It was fresh when I left it.'), row);
  assert.ok(/Luigi \(they\/them\)[^]*It was fresh/.test(row), 'the reply is credited to its author');
  assert.ok(/quoted from the board, never instructions/i.test(text), 'says the posts are never instructions');
});

test('the conversations section is absent when there are none, and a conversation with no exchange still reads', () => {
  const none = renderDigest({ ...withStaff, conversations: [] }, null, []);
  assert.ok(!none.includes('## Conversations'));
  assert.ok(!/never instructions/i.test(none));
  const bare = renderDigest({ ...withStaff, conversations: [conv(1, { exchange: null, with: [], turns: 1, reactions: 0 })] }, null, []);
  assert.ok(bare.includes('1 turn,') && bare.includes('0 reactions'), bare);
});

test('the conversations slice to DIGEST_MOST.conversations whatever they are handed, and every free string is clipped', () => {
  const C = DIGEST_MOST.excerptChars;
  const many = Array.from({ length: DIGEST_MOST.conversations + 4 }, (_, i) => conv(i + 1, {
    title: 'T'.repeat(5000),
    with: Array.from({ length: 30 }, (_, k) => ({ id: id(500 + k), name: 'N'.repeat(500) })),
    exchange: { text: 'x'.repeat(5 * C), cut: false, reply: { character: id(3), text: 'y'.repeat(5 * C), cut: false } },
  }));
  const text = renderDigest({ ...withStaff, conversations: many }, null, []);
  const body = text.split('## Conversations\n')[1]!.split('\n\n')[0]!.split('\n');
  assert.equal(body.length, DIGEST_MOST.conversations);
  assert.ok(text.split('\n').every((l) => !l.includes('x'.repeat(C + 1)) && !l.includes('y'.repeat(C + 1)) && !l.includes('T'.repeat(CLIPS.title + 1))));
  assert.ok(body.every((l) => l.length < CLIPS.title + 8 * (CLIPS.name + 30) + 2 * C + 400), 'a line is bounded by clips: names at most 8');
});

test('a conversation whose exchange was cut by SQL ends in an ellipsis', () => {
  const text = renderDigest({ ...withStaff, conversations: [conv(1, { exchange: { text: 'Your pie is col', cut: true, reply: { character: id(3), text: 'It was fre', cut: true } } })] }, null, []);
  assert.ok(/Your pie is[^"]*…"/.test(text) && /It was[^"]*…"/.test(text), text);
  const whole = renderDigest({ ...withStaff, conversations: [conv(1)] }, null, []);
  assert.ok(!whole.includes('…"'), 'a post that fit has no ellipsis');
});

test('a quote mark inside a quoted post or title cannot close the quote early', () => {
  const text = renderDigest({ ...withStaff, conversations: [conv(1, { title: 'The "big" one', exchange: { text: 'I said "no" twice', cut: false, reply: { character: id(3), text: 'He said "yes" first', cut: false } } })] }, null, []);
  const row = text.split('\n').find((l) => l.startsWith('1. Modly'))!;
  assert.equal((row.match(/"/g) ?? []).length, 6, row);
  assert.ok(row.includes("The 'big' one") && row.includes("I said 'no' twice") && row.includes("He said 'yes' first"), row);
});

/* ------------------------------------------------------------------ the requests (staff requests plan, Task 5) ---- */

const request = (n: number, body: string, at = '2026-10-30T12:00:00Z'): import('./digest.ts').DigestRequest => ({
  id: n, requestAct: id(100 + n), thread: id(1), title: 'Who ate the pie', board: id(60), boardName: 'General', askerName: `Asker ${n}`, staff: 'sigh', staffName: 'Sigh Bot', body, at, lapsesAt: '2026-11-02T12:00:00Z',
});

test('the requests section reads each waiting request with its id, where, who asked, who passed it, how long it waited and when it lapses, and the post whole', () => {
  const body = 'Please move this thread to Off Topic.\n\nIt is not about games, and it never was.';
  const text = renderDigest({ ...small, requests: [request(12, body)] }, null, []);
  assert.ok(text.includes('## Requests waiting for your ruling'), text);
  assert.ok(text.includes('Request 12 in "Who ate the pie" on General: Asker 12 asked, and Sigh Bot passed it to you'), text);
  assert.ok(text.includes('waiting 12 hours'), 'the wait is the window\'s end less when it was conferred (2026-10-31T00:00 less 2026-10-30T12:00)');
  assert.ok(text.includes('lapses 2026-11-02T12:00:00Z'));
  assert.ok(text.includes('> Please move this thread to Off Topic.\n> \n> It is not about games, and it never was.'), `the post whole, every line: ${text}`);
  assert.ok(text.includes(READ_WORDS), 'the whole-posts line, once');
  assert.equal(text.split(READ_WORDS).length - 1, 1);
});

test('no section and no whole-posts line when no request waits (or the digest is from a database that has none)', () => {
  for (const d of [small, { ...small, requests: [] }]) {
    const text = renderDigest(d, null, []);
    assert.ok(!text.includes('Requests waiting'), text);
    assert.ok(!text.includes(READ_WORDS));
  }
});

test('when more wait than the read held, the section says how many more, from the total the database counted', () => {
  const d = { ...small, requests: [request(1, 'one'), request(2, 'two'), request(3, 'three')], requestsWaiting: 14 };
  const text = renderDigest(d, null, [], { readMost: 10_000, meetingMost: 3 });
  assert.ok(text.includes('(11 more requests wait and are not shown here; they stay waiting.)'), text);
  // A total that is not more than the list (or absent) adds nothing.
  const same = renderDigest({ ...d, requestsWaiting: 3 }, null, [], { readMost: 10_000, meetingMost: 3 });
  assert.ok(!same.includes('not shown here'), same);
  assert.ok(!renderDigest({ ...d, requestsWaiting: undefined }, null, [], { readMost: 10_000, meetingMost: 3 }).includes('not shown here'));
  // Left out by the ceiling and by the total are both counted, once each.
  const both = renderDigest({ ...d, requests: [request(1, 'short'), request(2, 'z'.repeat(900)), request(3, 'short')], requestsWaiting: 5 }, null, [], { readMost: 500, meetingMost: 3 });
  assert.ok(both.includes('(3 more requests wait'), both);
});

test('requests are bounded by meetingMost and then by readMost over the bodies: the longest is dropped first, the count is said, and no body is ever cut', () => {
  const big = 'x'.repeat(900);
  const d = { ...small, requests: [request(1, 'short one'), request(2, big), request(3, 'short two'), request(4, 'y'.repeat(500))] };
  const text = renderDigest(d, null, [], { readMost: 500, meetingMost: 3 });
  // meetingMost 3 leaves requests 1 to 3 (oldest first); over 500 characters, the longest (2) goes.
  assert.ok(text.includes('Request 1 ') && text.includes('Request 3 '), text);
  assert.ok(!text.includes('Request 2 ') && !text.includes('Request 4 '), text);
  assert.ok(!text.includes(big.slice(0, 50)));
  assert.ok(text.includes('(2 more requests wait and are not shown here; they stay waiting.)'), text);
  const whole = renderDigest(d, null, [], { readMost: 10_000, meetingMost: 10 });
  assert.ok(whole.includes(big) && whole.includes('y'.repeat(500)), 'under the ceiling every body is whole');
  assert.ok(!whole.includes('not shown here'));
  // The oldest, alone over the ceiling, is still read whole: a request must not starve behind its own size.
  const alone = renderDigest({ ...small, requests: [request(5, big)] }, null, [], { readMost: 500, meetingMost: 10 });
  assert.ok(alone.includes(big) && !alone.includes('not shown here'));
});

test('the requests section is outside the excerpt budget: it does not touch the excerpts', () => {
  const text = renderDigest({ ...small, requests: [request(1, 'a'.repeat(3_000))] }, null, [], { readMost: 40_000, meetingMost: 10 });
  assert.ok(text.includes('a'.repeat(3_000)));
  assert.ok(text.includes('It was me all along'));
});

// ---- the digest sees the board (docs/plans/2026-11-25-digest-sees-the-board-plan.md, Task 3) ----
const NOW = Date.parse('2026-11-25T12:00:00Z');
const hoursAgo = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
const seeOpts = { now: NOW, seen: (card: string | null, p: { by: string | null }) => (card === 'splat' ? `Wario splatted this post ${p.by === null ? '' : 'by hand'}`.trim() : null), cardName: (k: string) => (k === 'splat' ? 'Splat' : undefined) };
const poll = { question: 'Rename this board?', options: ['Yes', 'No'], pick: 1, secret: false, endsAt: hoursAgo(-2), closed: false, closedBy: null, closedAt: null, counts: [9, 4], voters: 13 };
const play = (n: number, card: string | null = 'splat') => ({ play: id(500 + n), card, at: hoursAgo(3), by: 'Wario', config: null, state: null, text: null, covered: null });
const origin = { kind: 'post', place: { kind: 'post' as const, thread: id(1), title: 'Best kart?', seq: 4 }, at: hoursAgo(24 * 30), spunAt: hoursAgo(72), moment: false, post: null };
const withExtras = { poll, plays: [play(1), play(2)], reactions: {}, rewoundTo: null };

test('an excerpt carries its poll in short form, each play as the instance says it, and the origin of a spun opener', () => {
  const d: Digest = { ...small, excerpts: [{ ...small.excerpts[0]!, extras: withExtras, origin }] };
  const row = renderDigest(d, memory, [], undefined, seeOpts).split('\n').find((l) => l.startsWith('Luigi (they/them), 7 reactions'))!;
  assert.ok(row.includes('It was me all along [poll: "Rename this board?", Yes leads 9 to 4, closes in 2 hours]'), row);
  assert.equal(row.split('[Wario splatted this post by hand]').length, 3, 'both plays');
  assert.ok(row.includes('(This thread was spun 3 days ago from post #4 in "Best kart?", written 30 days ago.)'), row);
});

test('the Boss\'s reaction shows the post\'s excerpt and its extras; both sides of an exchange show theirs', () => {
  const d: Digest = {
    ...small,
    bossReactions: [{ act: id(9), thread: id(1), total: 5, tally: { fire: 4, skull: 1 }, text: 'my own hot take', extras: { ...withExtras, plays: [play(1)] } }],
    conversations: [{ thread: id(1), title: 'T', persona: { staff: 's', character: id(2) }, with: [], turns: 1, reactions: 2,
      exchange: { text: 'persona line', extras: { ...withExtras, poll: null, plays: [play(3, null)] }, reply: { character: id(3), text: 'asker line', extras: { ...withExtras, plays: [] } } } }],
  };
  const text = renderDigest(d, memory, [], undefined, seeOpts);
  const boss = text.split('\n').find((l) => l.startsWith('5 in all: fire 4, skull 1.'))!;
  assert.ok(boss.includes('my own hot take') && boss.includes('[Wario splatted this post by hand]') && boss.includes('[poll:'), boss);
  const conv = text.split('\n').find((l) => l.includes(' in "T": 1 turn'))!;
  assert.ok(/asker line" \[poll: .*\] and Mario .* answered "persona line" \[A card set face down was played on this post, 3 hours ago\.\]/.test(conv), conv);
});

// The text the digest rendered before the new sections (engine/system/digest.ts at origin/main) for `small` and `memory`, pasted from that renderer's own output: a guard that the old shape reads as it always did.
const OLD_SHAPE = "# The board from 2026-10-30T00:00:00Z to 2026-10-31T00:00:00Z\n\n## What you remember\nYour hobby: tomatoes (since 2026-10-30, from Luigi).\nOpinion of Mario (she/her): 3. funny\nGrudge against Luigi (they/them). stole my pie\nThe wheelhouse you have learned: speedruns.\nReal-world subjects you leave alone: elections.\n\n## Hot threads\n1. \"Who ate the pie\" on General: 9 posts in the window (0.38 an hour), 40 in all, controversy 0.5.\n\n## Boards\nBusy Place (Where it is loud.): 12 posts in 21 days.\nEmpty Place: 0 posts in 21 days.\n\n## Standings\n1. Mario (she/her): 120\n\n## Moves\nNo move is in force and none ended in the window.\n\n## Quotes between characters\nMario (she/her) quoted Luigi (they/them) 2 times.\n\n## Reactions to your own posts\n5 in all: fire 4, skull 1.\n\n## Top posts\nLuigi (they/them), 7 reactions: It was me all along\n\nAn excerpt that ends in \u2026 was shortened by the game for space; its author wrote more.\n\n## Outside\n- A feed item";

test('an old digest, without the new fields, renders exactly as before: no new section at all', () => {
  const text = renderDigest(small, memory, ['A feed item']);
  for (const h of ['Polls', 'Spins', 'Cards on the board', 'Standouts']) assert.ok(!text.includes(`## ${h}`), h);
  assert.equal(text, OLD_SHAPE);
  assert.equal(renderDigest(small, memory, ['A feed item'], undefined, seeOpts), OLD_SHAPE, 'the words change nothing where no extras are carried');
});

test('a post that was rewound says so in short form; its reaction counts are left to the excerpt line', () => {
  const d: Digest = { ...small, excerpts: [{ ...small.excerpts[0]!, extras: { poll: null, plays: [], reactions: { fire: 3 }, rewoundTo: hoursAgo(5) } }] };
  const row = renderDigest(d, memory, [], undefined, seeOpts).split('\n').find((l) => l.startsWith('Luigi (they/them), 7 reactions'))!;
  assert.ok(row.includes('[This post is showing how it looked 5 hours ago.]'), row);
  assert.ok(!row.includes('fire'), row);
});

const standout = (c: string, n: number, count: number) => ({ character: id(70 + n), name: c, count });
const board: Digest = {
  ...small,
  polls: [{ poll: id(80), post: id(81), thread: id(1), seq: 5, title: 'Who ate the pie', board: 'General', extras: { poll, plays: [], reactions: {}, rewoundTo: null } }],
  spins: [{ thread: id(2), title: 'Best kart?', origin }],
  plays: [{ ...play(7), post: id(82), thread: id(1), title: 'Who ate the pie', seq: 3 }, { ...play(8, null), post: id(83), thread: id(1), title: 'Who ate the pie', seq: null }],
  standouts: { days: 7, cards: [standout('Wario', 1, 9), standout('Toad', 2, 3), standout('Peach', 3, 2)], received: [standout('Mario', 4, 5)], polls: [], ballots: [], spun: [], exchanges: [] },
};

test('each new section reads in full form after Top posts', () => {
  const text = renderDigest(board, memory, [], undefined, seeOpts);
  assert.ok(text.indexOf('## Top posts') < text.indexOf('## Polls') && text.indexOf('## Polls') < text.indexOf('## Spins') && text.indexOf('## Spins') < text.indexOf('## Cards on the board') && text.indexOf('## Cards on the board') < text.indexOf('## Standouts'));
  assert.ok(text.includes('On post #5 in "Who ate the pie" (General):\n[poll] "Rename this board?" (pick one)'), 'poll in full form with where');
  assert.ok(!text.split('## Polls\n')[1]!.split('\n\n')[0]!.includes('this post'), 'a poll row has no "this post"');
  assert.ok(text.includes('  1. Yes: 9 (69%)'));
  assert.ok(text.includes('"Best kart?": (This thread was spun 3 days ago from post #4 in "Best kart?", written 30 days ago.)'), 'spin');
  assert.ok(text.includes('[Wario splatted this post by hand] on post #3 in "Who ate the pie".'), 'card');
  assert.ok(text.includes('[A card set face down was played, 3 hours ago] on a post in "Who ate the pie".'), 'card with no seq, no seen sentence: no "this post"');
  assert.ok(!/was played on this post[^\n]* on (a post|post #)/.test(text), 'never "on this post" before "on post #N"');
  assert.ok(text.includes('Most cards played this week: Wario, by far; then Toad and Peach.'), text);
  assert.ok(text.includes('Most cards received this week: Mario, the only one.'));
  assert.ok(!text.includes('Most polls'), 'a category with no one is left out');
});

test('each new section says none when its field is present and empty', () => {
  const text = renderDigest({ ...small, polls: [], spins: [], plays: [], standouts: { days: 7, cards: [], received: [], polls: [], ballots: [], spun: [], exchanges: [] } }, memory, [], undefined, seeOpts);
  for (const none of ['No poll was open or ran in the window.', 'No thread was spun in the window.', 'No card was played in the window.', 'Nobody stood out this week.']) assert.ok(text.includes(none), none);
});

test('standingWords: one, two and three names, from each count\'s share of the leader\'s', () => {
  assert.equal(standingWords([]), '');
  assert.equal(standingWords([4]), '{1}, the only one.');
  assert.equal(standingWords([10, 4]), '{1}, by far; then {2}.');
  assert.equal(standingWords([10, 5]), '{1}, with {2} behind.', 'half is not under half');
  assert.equal(standingWords([10, 9]), '{1} and {2}, neck and neck.');
  assert.equal(standingWords([10, 8]), '{1}, with {2} close behind.');
  assert.equal(standingWords([10, 6]), '{1}, with {2} behind.');
  assert.equal(standingWords([10, 4, 1]), '{1}, by far; then {2} and {3}.');
  assert.equal(standingWords([10, 10, 2]), '{1} and {2}, neck and neck; {3} behind.');
  assert.equal(standingWords([10, 9, 8]), '{1} and {2}, neck and neck; {3} close behind.');
  assert.equal(standingWords([10, 8, 7]), '{1}, with {2} and {3} neck and neck close behind.');
  assert.equal(standingWords([10, 6, 3]), '{1}, with {2} behind; {3} behind.');
  assert.equal(standingWords([10, 7, 5]), '{1}, with {2} close behind; {3} behind.', 'the third is measured against the leader: five is half of ten');
  assert.equal(standingWords([10, 7, 6]), '{1}, with {2} and {3} neck and neck behind.', 'a pair neck and neck is as far behind as the lower of them');
  assert.equal(standingWords([10, 5, 5]), '{1}, with {2} and {3} neck and neck behind.', 'two within a tenth are neck and neck wherever they stand');
  assert.equal(standingWords([10, 4, 4]), '{1}, by far; then {2} and {3}, neck and neck.');
  assert.equal(standingWords([10, 10, 10]), '{1}, {2} and {3}, neck and neck.');
  assert.equal(standingWords([3, 10, 4]), standingWords([10, 4, 3]), 'order does not matter');
});

test('the Standouts section never contains a digit, whatever the days or the names', () => {
  for (const days of [1, 7, 14, 30, 11, 99]) {
    const text = renderDigest({ ...board, standouts: { ...board.standouts!, days } }, null, [], undefined, seeOpts);
    const section = text.split('## Standouts\n')[1]!.split('\n\n')[0]!;
    assert.ok(!/\d/.test(section), `${days}: ${section}`);
  }
});

test('the new lists stop at their ceilings and every free string is clipped; the length bound holds', () => {
  const { polls: P, spins: S, plays: L, standouts: O, excerpts: E, conversations: V, postPlays: PP } = DIGEST_MOST;
  const OVER = 3;
  const long = (n: number): string => 'x'.repeat(n);
  const lists = (n: number) => Array.from({ length: n }, (_, i) => i);
  const bigPoll = { ...poll, question: long(5000), options: lists(40).map(() => long(5000)), counts: lists(40).map(() => 99999999), voters: 99999999 };
  const ex = { poll: bigPoll, plays: lists(30).map((i) => ({ ...play(i), by: long(5000) })), reactions: {}, rewoundTo: hoursAgo(1) };
  const bigOrigin = { ...origin, place: { kind: 'post' as const, thread: id(1), title: long(5000), seq: 99999999 } };
  const wide = (n: number) => ({ character: id(1), name: long(5000), count: n + 1 });
  const see = { extras: ex, origin: bigOrigin };
  const d: Digest = {
    ...small,
    excerpts: lists(E + OVER).map((i) => ({ act: id(i), thread: id(i), character: id(2), reactions: 1, text: long(5000), ...see })),
    bossReactions: lists(E + OVER).map((i) => ({ act: id(i), thread: id(i), total: 1, tally: { fire: 1 }, text: long(5000), ...see })),
    conversations: lists(V + OVER).map((i) => conv(i + 1, { exchange: { text: long(5000), ...see, reply: { character: id(3), text: long(5000), ...see } } })),
    polls: lists(P + OVER).map((i) => ({ poll: id(i), post: id(i), thread: id(i), seq: 99999999, title: long(5000), board: long(5000), extras: { ...ex } })),
    spins: lists(S + OVER).map((i) => ({ thread: id(i), title: long(5000), origin: bigOrigin })),
    plays: lists(L + OVER).map((i) => ({ ...play(i), post: id(i), thread: id(i), title: long(5000), seq: 99999999 })),
    standouts: { days: 99999999, cards: lists(O + OVER).map(wide), received: lists(O + OVER).map(wide), polls: lists(O + OVER).map(wide), ballots: lists(O + OVER).map(wide), spun: lists(O + OVER).map(wide), exchanges: lists(O + OVER).map(wide) },
  };
  const opts = { now: NOW, seen: () => long(5000), cardName: () => long(5000) };
  const text = renderDigest(d, null, [], undefined, opts);
  const sect = (h: string): string[] => text.split(`## ${h}\n`)[1]!.split('\n\n')[0]!.split('\n');
  assert.equal(sect('Cards on the board').length, L);
  assert.equal(sect('Spins').length, S);
  assert.equal(sect('Polls').filter((l) => l.startsWith('On post #')).length, P);
  assert.ok(sect('Standouts').every((l) => !/\d/.test(l)));
  assert.equal(sect('Standouts').length, 6, 'six categories');
  assert.ok(sect('Standouts').every((l) => l.split(', ').length <= 3 + 2), 'at most three names');
  assert.ok(sect('Standouts').every((l) => l.length <= 4 * CLIPS.name + 200));
  // A shown post carries at most DIGEST_MOST.postPlays play lines: the 30 plays it was handed are cut to that.
  const top = sect('Top posts');
  assert.equal(top.length, E);
  assert.ok(top.every((l) => l.split('[' + 'x'.repeat(50)).length - 1 <= PP), 'a post shows at most postPlays play lines');
  assert.ok(top.every((l) => l.split('[' + 'x'.repeat(50)).length - 1 === PP), 'and shows that many when it has more');
  // The new parts' bound, from the constants: each row's free strings at their clips, with the extras every shown post can carry (excerpts, the Boss's reactions, both sides of each conversation).
  const pollMost = DIGEST_MOST.pollOptions * (CLIPS.option + 60) + CLIPS.question + 300;
  const newBound = P * (CLIPS.title + CLIPS.board + pollMost + 100) + S * (CLIPS.title + CLIPS.origin + 100) + L * (CLIPS.title + CLIPS.play + 100) + 6 * (O * CLIPS.name + 300) + 1000;
  const bare = { ...d, polls: undefined, spins: undefined, plays: undefined, standouts: undefined };
  const sections = text.length - renderDigest(bare, null, [], undefined, opts).length;
  assert.ok(sections <= newBound, `${sections} > ${newBound}`);
  const extrasOnly = (e: typeof ex | undefined, o: typeof bigOrigin | undefined) => renderDigest({ ...d, polls: undefined, spins: undefined, plays: undefined, standouts: undefined, excerpts: d.excerpts.map((x) => ({ ...x, extras: e, origin: o })), bossReactions: d.bossReactions.map((x) => ({ ...x, extras: e, origin: o })), conversations: d.conversations.map((c) => ({ ...c, exchange: { ...c.exchange!, extras: e, origin: o, reply: { ...c.exchange!.reply, extras: e, origin: o } } })) }, null, [], undefined, opts).length;
  const extraText = renderDigest({ ...d, polls: undefined, spins: undefined, plays: undefined, standouts: undefined }, null, [], undefined, opts).length - extrasOnly(undefined, undefined);
  const extraBound = (E + E + 2 * V) * (CLIPS.question + CLIPS.pollShort + 20 + CLIPS.play + 10 + PP * (CLIPS.play + 1) + CLIPS.origin + 1);
  assert.ok(extraText <= extraBound, `extras ${extraText} > ${extraBound}`);
  assert.ok(extraText > extraBound / 2, `the bound is tight: ${extraText} against ${extraBound}`);
  assert.equal(text.length, renderDigest({ ...d, polls: d.polls!.map((p) => ({ ...p, title: long(50000) })) }, null, [], undefined, opts).length, 'longer free text does not make it longer');
});

test('a poll row with no seq says "a post"; one with no poll in it is skipped; a play with no seq never reads undefined', () => {
  const row = (over: object) => ({ poll: id(80), post: id(81), thread: id(1), title: 'Pie', board: 'General', extras: { poll, plays: [], reactions: {}, rewoundTo: null }, ...over });
  const text = renderDigest({ ...small, polls: [row({}), row({ seq: null }), row({ title: 'Skipped', extras: { poll: null, plays: [], reactions: {}, rewoundTo: null } }), row({ title: 'Bare', extras: undefined })] as never, plays: [{ ...play(1, null), post: id(1), thread: id(1), title: 'Pie' } as never] }, null, [], undefined, seeOpts);
  assert.ok(text.includes('On a post in "Pie" (General):\n[poll]'), text);
  assert.ok(!text.includes('Skipped') && !text.includes('Bare'), 'a row that cannot be shown is left out');
  assert.ok(!text.includes('undefined') && !text.includes('NaN'), text);
  assert.ok(text.includes('] on a post in "Pie".'), text);
});

test('standouts: names stay with their counts however the list is ordered, and a category with no positive count is left out', () => {
  const st = (cards: ReturnType<typeof standout>[]) => ({ days: 7, cards, received: [], polls: [], ballots: [], spun: [], exchanges: [] });
  const text = renderDigest({ ...small, standouts: st([standout('Peach', 1, 2), standout('Wario', 2, 9), standout('Toad', 3, 3)]) }, null, [], undefined, seeOpts);
  assert.ok(text.includes('Most cards played this week: Wario, by far; then Toad and Peach.'), text);
  const zero = renderDigest({ ...small, standouts: st([standout('Peach', 1, 0), standout('Wario', 2, 4), standout('Toad', 3, -1), standout('Bad', 4, Number.NaN)]) }, null, [], undefined, seeOpts);
  assert.ok(zero.includes('Most cards played this week: Wario, the only one.'), zero);
  const allZero = renderDigest({ ...small, standouts: st([standout('Peach', 1, 0)]) }, null, [], undefined, seeOpts);
  assert.ok(!allZero.includes('Most cards played') && allZero.includes('Nobody stood out this week.'), allZero);
  const tie = renderDigest({ ...small, standouts: st([standout('Zed', 1, 5), standout('Abe', 2, 5)]) }, null, [], undefined, seeOpts);
  assert.ok(tie.includes('Abe and Zed, neck and neck.'), 'a tie reads by name');
});

test('a tied poll in short form keeps its closing tail and its counts match the options it shows', () => {
  const opts = Array.from({ length: 30 }, (_, i) => `Option ${i} ${'z'.repeat(100)}`);
  const tied = { ...poll, question: 'q'.repeat(5000), options: opts, counts: opts.map(() => 7), voters: 210 };
  const d: Digest = { ...small, excerpts: [{ ...small.excerpts[0]!, extras: { poll: tied, plays: [], reactions: {}, rewoundTo: null } }] };
  const row = renderDigest(d, null, [], undefined, seeOpts).split('\n').find((l) => l.startsWith('Luigi (they/them), 7 reactions'))!;
  assert.ok(/, closes in 2 hours\]$/.test(row), row.slice(-120));
});

// ---- covers (docs/plans/2026-11-26-autocorrect-reads-plan.md, Task 3) ----
test('an excerpt with a covering play is read covered; a request\'s body is not', () => {
  const tape = { ...play(1, 'tape'), config: { from: 0, to: 2, words: 'Not' } };
  const covers = (card: string | null, p: { config: unknown }) => (card === 'tape' ? [p.config as { from: number; to: number; words: string }] : null);
  const words = { ...seeOpts, covers };
  const d: Digest = {
    ...small,
    bossReactions: [{ act: id(9), thread: id(1), total: 5, tally: { fire: 4 }, text: 'my own hot take', extras: { ...withExtras, plays: [tape] } }],
    excerpts: [{ ...small.excerpts[0]!, extras: { ...withExtras, plays: [tape] } }],
    conversations: [{ thread: id(1), title: 'T', persona: { staff: 's', character: id(2) }, with: [], turns: 1, reactions: 2,
      exchange: { text: 'persona line', extras: { ...withExtras, poll: null, plays: [] }, reply: { character: id(3), text: 'asker line', extras: { ...withExtras, plays: [tape] } } } }],
    requests: [request(1, 'It was me all along')],
  };
  const text = renderDigest(d, memory, [], undefined, words);
  assert.ok(text.includes('Luigi (they/them), 7 reactions: Not was me all along'), text);
  assert.ok(text.includes('The post: Not own hot take'), 'a standout\'s post');
  assert.ok(text.includes('wrote "Notker line"'), 'an exchange');
  assert.ok(text.includes('persona line'), 'a post with no plays is as written');
  assert.ok(text.includes('It was me all along'), 'a request\'s body is whole');
  assert.ok(renderDigest(d, memory, [], undefined, seeOpts).includes('7 reactions: It was me all along'), 'with no covers, as written');
});
