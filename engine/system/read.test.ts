import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markQuotes, readLines, readThread, READ_WINDOW, READ_WORDS, type ReadCandidate, type ReadFocus, type ReadOptions } from './read.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';
import type { ReadOrigin } from './extras.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = 'char-me';
function cand(seq: number, author: string, body: string, o: Partial<ReadCandidate> = {}): ReadCandidate {
  return { act: o.act ?? uuid(1000 + seq), seq, at: `2026-11-0${(seq % 9) + 1}T00:00:00Z`, author, name: o.name ?? author, pronouns: null, body, replyTo: null, quotes: [], poll: null, plays: [], reactions: {}, rewoundTo: null, ...o };
}
const NOW = Date.parse('2026-11-25T12:00:00Z');
const BASE: Omit<ReadOptions, 'readMost'> = { now: NOW, seen: () => null, origin: null };
/** `readThread` with the ceiling and the defaults: no origin, no `seen`. */
const rt = (all: readonly ReadCandidate[], focus: ReadFocus, readMost: number, o: Partial<ReadOptions> = {}) => readThread(all, focus, { ...BASE, readMost, ...o });
const index = (cs: readonly ReadCandidate[]): Map<string, ReadCandidate> => new Map(cs.map((c) => [c.act, c]));
const q = (act: string, words: string): string => `[quote=${act}]${words}[/quote]`;

test('the fixed words and window', () => {
  assert.equal(READ_WINDOW, 60);
  assert.equal(READ_WORDS, 'Every post you are shown is whole. Where the game left posts out for space, a line says how many; it is not part of anyone\'s post, and your post never mentions it. Lines in square brackets under a post, and the line saying where a thread was spun from, describe things that really happened on the board: polls, cards played on posts, and the post a thread was spun from. React to them in character if you like; never quote them as anyone\'s words.');
});

test('Spritey thread: the opener is whole and the quoting reply reads the marker then its two questions', () => {
  const opener = cand(1, 'spritey', 'o'.repeat(312), { name: 'Spritey' });
  const mine = cand(3, ME, 'Here is my long whole post. '.repeat(24).trim(), { name: 'QC-1000' });
  const questions = '\n\nWhy did it happen? Who else saw it?';
  const body = q(mine.act, mine.body) + questions;
  const reply = cand(4, 'spritey', body, { name: 'Spritey', replyTo: mine.act, quotes: [mine.act] });
  assert.ok(body.length > 700);
  const r = rt([opener, mine, reply], { self: ME, must: [] }, 2000);
  assert.equal(r.omitted, 1); // post #2 is not a candidate here
  assert.equal(r.posts[0]!.body, opener.body);
  assert.equal(r.posts[2]!.body, `[quoting your post #3]${questions}`);
  assert.equal(r.posts[2]!.marks.quotesYou, true);
  assert.equal(r.posts[2]!.marks.repliesToYou, true);
});

test('markQuotes names the author for a post that is not the persona\'s, using the given name only', () => {
  const a = cand(2, 'x', 'the whole words', { name: 'Veiled Someone' });
  assert.equal(markQuotes(`hi ${q(a.act, 'the   whole words')} there`, index([a]), ME), 'hi [quoting Veiled Someone, post #2] there');
});

test('a partial quote, a changed (forged) quote, counterfeits and a non-candidate quote stay byte for byte', () => {
  const a = cand(2, 'x', 'one two three four');
  const map = index([a]);
  const cases = [
    `x ${q(a.act, 'two three')} y`,
    `x ${q(a.act, 'one two three five')} y`,
    `x [quote]one two three four[/quote] y`,
    `x [quote=Some Name]one two three four[/quote] y`,
    `x ${q(uuid(9999), 'anything')} y`,
    `x [code]${q(a.act, 'one two three four')}[/code]`,
  ];
  for (const c of cases) assert.equal(markQuotes(c, map, ME), c);
});

test('a concealed quote of a hidden post is a hidden-post marker; a concealed quote of a candidate is not', () => {
  const a = cand(2, 'x', 'words');
  assert.equal(markQuotes(`a [quote=${uuid(777)}][/quote] b`, index([a]), ME), 'a [quoting a hidden post] b');
  assert.equal(markQuotes(`a [quote=${a.act}][/quote] b`, index([a]), ME), `a [quote=${a.act}][/quote] b`);
});

test('only the outermost quote is replaced, and a quote closed by the end of the body is whole', () => {
  const a = cand(2, 'x', 'inner words', { name: 'Ann' });
  const outer = cand(3, 'y', `${q(a.act, 'inner words')} and more`, { name: 'Bo' });
  const map = index([a, outer]);
  assert.equal(markQuotes(`${q(outer.act, outer.body)}!`, map, ME), '[quoting Bo, post #3]!');
  assert.equal(markQuotes(`${q(outer.act, 'unrelated')}`, map, ME), `${q(outer.act, 'unrelated')}`);
  assert.equal(markQuotes(`see [quote=${a.act}]inner words`, map, ME), 'see [quoting Ann, post #2]');
});

test('no shown body is a cut of its marked source', () => {
  const a = cand(1, 'a', 'x'.repeat(5000), { name: 'Ann' });
  const m = cand(2, ME, 'z'.repeat(900));
  const b = cand(3, 'b', `${q(a.act, a.body)} ${'y'.repeat(3000)} ${q(m.act, m.body)} tail`, { name: 'Bo', quotes: [a.act, m.act] });
  const cs = [a, m, b];
  const r = rt(cs, { self: ME, must: [] }, 100000);
  assert.equal(r.posts.length, 3);
  const map = index(cs);
  assert.ok(r.posts.find((p) => p.act === b.act)!.body.startsWith('[quoting Ann, post #1] '));
  for (const p of r.posts) assert.equal(p.body, markQuotes(cs.find((c) => c.act === p.act)!.body, map, ME));
});

test('a whole quote nested inside a kept (partial) outer quote stays as written', () => {
  const a = cand(2, 'x', 'inner whole words', { name: 'Ann' });
  const t = cand(3, 'y', `${q(a.act, 'inner whole words')} and more`, { name: 'Bo' });
  const body = `[quote=${t.act}]only the ${q(a.act, 'inner whole words')}[/quote]`;
  assert.equal(markQuotes(body, index([a, t]), ME), body);
});

test('tier order: answered reply, a post quoting the persona and the opener beat newer strangers', () => {
  const opener = cand(1, 'op', 'o'.repeat(100));
  const mine = cand(2, ME, 'm'.repeat(100));
  const reply = cand(3, 'r', 'r'.repeat(100), { replyTo: mine.act });
  const quoter = cand(4, 'qq', q(mine.act, mine.body) + 'q'.repeat(100), { quotes: [mine.act] });
  const s1 = cand(5, 's1', 's'.repeat(100));
  const s2 = cand(6, 's2', 's'.repeat(100));
  const s3 = cand(7, 's3', 's'.repeat(100));
  const all = [opener, mine, reply, quoter, s1, s2, s3];
  const quoterSize = rt(all, { self: ME, must: [reply.act] }, 10000).posts.find((p) => p.act === quoter.act)!.body.length;
  const r = rt(all, { self: ME, must: [reply.act] }, 100 + 100 + quoterSize + 100);
  const shown = r.posts.map((p) => p.seq);
  assert.deepEqual(shown, [1, 2, 3, 4]);
  assert.deepEqual(r.answered, [reply.act]);
  assert.equal(r.omitted, 3);
});

test('a long post is passed over, not a stop: two later short strangers are still taken', () => {
  const big = cand(1, 'a', 'b'.repeat(30000));
  const s1 = cand(2, 'c', 'short one');
  const s2 = cand(3, 'd', 'short two');
  const r = rt([big, s1, s2], { self: ME, must: [] }, 1000);
  // the opener (tier 3) is the big one and does not fit; the strangers do.
  assert.deepEqual(r.posts.map((p) => p.seq), [2, 3]);
  assert.equal(r.omitted, 1);
  const cs2 = [cand(1, 'o', 'open'), cand(2, 'a', 'b'.repeat(30000)), cand(3, 'c', 'short one'), cand(4, 'd', 'short two')];
  const r2 = rt(cs2, { self: ME, must: [] }, 1000);
  assert.deepEqual(r2.posts.map((p) => p.seq), [1, 3, 4]);
});

test('the must tier: the newest two of three 20,000 replies fit 40,000; one 50,000 is still whole', () => {
  const mine = cand(1, ME, 'mine');
  const a = cand(2, 'a', 'a'.repeat(20000), { replyTo: mine.act });
  const b = cand(3, 'b', 'b'.repeat(20000), { replyTo: mine.act });
  const c = cand(4, 'c', 'c'.repeat(20000), { replyTo: mine.act });
  const r = rt([mine, a, b, c], { self: ME, must: [a.act, b.act, c.act] }, 40000);
  assert.deepEqual(r.answered, [b.act, c.act]);
  assert.deepEqual(r.posts.map((p) => p.seq), [3, 4]); // the answered posts fill 40,000; the persona's own post they answer no longer fits
  assert.equal(r.omitted, 2);
  const big = cand(2, 'a', 'a'.repeat(50000), { replyTo: mine.act });
  const r2 = rt([mine, big], { self: ME, must: [big.act] }, 40000);
  assert.deepEqual(r2.answered, [big.act]);
  assert.equal(r2.posts.find((p) => p.act === big.act)!.body.length, 50000);
});

test('omitted and the not-shown lines count exactly', () => {
  const cs = [1, 2, 3, 4, 5, 6].map((n) => cand(n, `u${n}`, `post ${n} `.repeat(1)));
  const r = rt(cs, { self: ME, must: [] }, cs[0]!.body.length + cs[3]!.body.length + cs[5]!.body.length);
  assert.equal(r.posts.length + r.omitted, 6);
  const lines = readLines(r);
  const notShown = lines.filter((l) => /^\(\d+ (earlier )?posts? not shown\)$/.test(l));
  const total = notShown.reduce((n, l) => n + Number(/\d+/.exec(l)![0]), 0);
  assert.equal(total, r.omitted);
  const first = r.posts[0]!.seq;
  if (first > 1) assert.equal(lines[0], `(${first - 1} earlier posts not shown)`);
});

test('the earlier-posts line is written when the opener is left out', () => {
  const cs = [cand(1, 'o', 'o'.repeat(500)), cand(2, 'a', 'a'.repeat(500)), cand(3, ME, 'mine'), cand(4, 'r', 'reply', { replyTo: uuid(1003) })];
  const r = rt(cs, { self: ME, must: [cs[3]!.act] }, 20);
  assert.deepEqual(r.posts.map((p) => p.seq), [3, 4]);
  assert.deepEqual(readLines(r)[0], '(2 earlier posts not shown)');
  const one = [cand(1, 'o', 'o'.repeat(500)), cand(2, ME, 'mine'), cand(3, 'r', 'reply', { replyTo: uuid(1002) })];
  const r1 = rt(one, { self: ME, must: [one[2]!.act] }, 20);
  assert.equal(readLines(r1)[0], '(1 earlier post not shown)');
});

test('must tier older replies stop at the first that does not fit', () => {
  const mine = cand(1, ME, 'm');
  const a = cand(2, 'a', 'a'.repeat(5000), { replyTo: mine.act });
  const b = cand(3, 'b', 'b'.repeat(30000), { replyTo: mine.act });
  const c = cand(4, 'c', 'c'.repeat(20000), { replyTo: mine.act });
  const r = rt([mine, a, b, c], { self: ME, must: [a.act, b.act, c.act] }, 40000);
  assert.deepEqual(r.answered, [c.act]);
});

test('a post quoted by an answered reply is pulled in the must tier, ahead of newer posts', () => {
  const old = cand(1, 'str', 'old stranger words', { name: 'Str' });
  const mine = cand(2, ME, 'mine');
  const reply = cand(3, 'r', `${q(old.act, old.body)} reply`, { quotes: [old.act] });
  const toIt = cand(4, 'k', 'k'.repeat(50), { replyTo: mine.act });
  const newer = cand(5, 'n', 'n'.repeat(50));
  const all = [old, mine, reply, toIt, newer];
  const replySize = rt(all, { self: ME, must: [reply.act] }, 10000).posts.find((p) => p.act === reply.act)!.body.length;
  const r = rt(all, { self: ME, must: [reply.act] }, replySize + old.body.length);
  assert.deepEqual(r.posts.map((p) => p.seq), [1, 3]);
});

test('company ranks above strangers', () => {
  const mine = cand(1, ME, 'mine');
  const friend = cand(2, 'friend', 'f'.repeat(50), { replyTo: mine.act });
  const friend2 = cand(3, 'friend', 'g'.repeat(50));
  const stranger = cand(4, 'str', 's'.repeat(50));
  const opener = cand(0, 'op', 'o'.repeat(50));
  const r = rt([opener, mine, friend, friend2, stranger], { self: ME, must: [] }, 4 + 50 + 50 + 50);
  assert.deepEqual(r.posts.map((p) => p.seq), [0, 1, 2, 3]);
});

test('a stranger post quoted by a post that quotes the persona ranks at tier 2', () => {
  const mine = cand(1, ME, 'mine');
  const old = cand(2, 'str', 'old words', { name: 'Str' });
  const quoter = cand(3, 'qq', `${q(mine.act, 'mine')}${q(old.act, 'old words')}`, { quotes: [mine.act, old.act] });
  const opener = cand(0, 'op', 'o'.repeat(40));
  const newer = cand(4, 'n', 'n'.repeat(40));
  const all = [opener, old, mine, quoter, newer];
  const sizeQ = rt(all, { self: ME, must: [] }, 10000).posts.find((p) => p.act === quoter.act)!.body.length;
  const r = rt(all, { self: ME, must: [] }, 4 + sizeQ + 9 + 40);
  assert.deepEqual(r.posts.map((p) => p.seq), [0, 1, 2, 3]);
  assert.ok(r.posts.some((p) => p.act === old.act));
});

test('the persona\'s own answered post is taken in the must tier', () => {
  const opener = cand(1, 'op', 'o'.repeat(500));
  const mine = cand(2, ME, 'mine');
  const reply = cand(3, 'r', 'reply', { replyTo: mine.act });
  const r = rt([opener, mine, reply], { self: ME, must: [reply.act] }, 9);
  assert.deepEqual(r.posts.map((p) => p.seq), [2, 3]);
});

test('readLines writes the header with pronouns and marks, and the body', () => {
  const mine = cand(1, ME, 'my words', { name: 'QC-1000', pronouns: PRONOUN_PRESETS.he });
  const rep = cand(2, 'r', 'their words', { name: 'Gloomba', pronouns: PRONOUN_PRESETS.she, replyTo: mine.act });
  const r = rt([mine, rep], { self: ME, must: [rep.act] }, 1000);
  assert.deepEqual(readLines(r), ['QC-1000 (he/him) [post #1] (you)', 'my words', 'Gloomba (she/her) [post #2] (answering) (replies to you)', 'their words']);
  assert.equal(readLines(r, { mustLabel: 'judged' })[2], 'Gloomba (she/her) [post #2] (judged) (replies to you)');
});

test('the same inputs read the same', () => {
  const cs = [cand(1, 'a', 'one'), cand(2, ME, 'two'), cand(3, 'b', 'three', { replyTo: uuid(1002) })];
  const f = { self: ME, must: [cs[2]!.act] };
  assert.deepEqual(rt(cs, f, 500), rt(cs, f, 500));
});

test('a sparse candidate set counts every post of the thread not shown', () => {
  const cs = [cand(1, 'o', 'open'), ...Array.from({ length: 61 }, (_, i) => cand(100 + i, `u${i}`, 'x'))];
  const r = rt(cs, { self: ME, must: [] }, 100000);
  assert.equal(r.posts.length, 62);
  assert.equal(r.omitted, 98);
  const lines = readLines(r);
  assert.equal(lines.filter((l) => /not shown/.test(l)).length, 1);
  assert.equal(lines[2], '(98 posts not shown)');
  const tail = rt([cand(1, 'o', 'open'), cand(2, 'a', 'a'.repeat(100)), cand(5, 'b', 'b'.repeat(100))], { self: ME, must: [] }, 4);
  assert.equal(tail.omitted, 4);
  assert.equal(readLines(tail).at(-1), '(4 posts not shown)');
});

test('candidates are deduped by act, first wins', () => {
  const a = cand(1, 'a', 'first');
  const r = rt([a, { ...a, body: 'second' }], { self: ME, must: [] }, 1000);
  assert.deepEqual(r.posts.map((p) => p.body), ['first']);
});

test('an unclosed quote of a non-candidate with empty contents reads as a hidden post', () => {
  assert.equal(markQuotes(`x [quote=${uuid(5)}]`, new Map(), ME), 'x [quoting a hidden post]');
});

test('edges: empty input, empty body, case and spacing, self-quote, self null, tiny ceiling, unknown must, many must', () => {
  assert.deepEqual(rt([], { self: ME, must: [uuid(1)] }, 10), { posts: [], omitted: 0, answered: [], through: 0 });
  assert.deepEqual(readLines(rt([], { self: ME, must: [] }, 10)), []);
  assert.equal(markQuotes('', new Map(), ME), '');
  const a = cand(2, 'x', 'Some  words\tthere', { name: 'Ann' });
  assert.equal(markQuotes(`[quote=${a.act.toUpperCase()}]Some words there[/quote]`, index([a]), ME), '[quoting Ann, post #2]');
  const selfQ = cand(1, 'x', 'plain', { quotes: [uuid(1001)] });
  assert.equal(rt([selfQ], { self: ME, must: [] }, 100).posts.length, 1);
  const n = rt([cand(1, ME, 'mine'), cand(2, 'a', 'abc')], { self: null, must: [] }, 100);
  assert.equal(n.posts.length, 2);
  assert.ok(n.posts.every((p) => !p.marks.you));
  const tiny = rt([cand(1, 'a', 'aaaa'), cand(2, 'b', 'bbbb')], { self: ME, must: [] }, 3);
  assert.deepEqual([tiny.posts.length, tiny.omitted], [0, 2]);
  const u = rt([cand(1, 'a', 'aaaa')], { self: ME, must: [uuid(999)] }, 100);
  assert.deepEqual(u.answered, []);
  assert.equal(u.posts.length, 1);
  const cs = [cand(1, 'a', 'a'), cand(2, 'b', 'b'), cand(3, 'c', 'c')];
  assert.deepEqual(rt(cs, { self: ME, must: [cs[1]!.act, cs[2]!.act] }, 100).answered, [cs[1]!.act, cs[2]!.act]);
});

test('must is ordered by seq, not by array position', () => {
  const a = cand(2, 'a', 'a'.repeat(30)), b = cand(3, 'b', 'b'.repeat(30)), c = cand(4, 'c', 'c'.repeat(30));
  const r = rt([a, b, c], { self: ME, must: [c.act, a.act, b.act] }, 60);
  assert.deepEqual(r.answered, [b.act, c.act]);
});

test('each shown post carries its tier: the answered reply 1, the persona\'s own 2, the opener 3, company 4, a stranger 5', () => {
  const opener = cand(1, 'o', 'opener');
  const mine = cand(2, ME, 'mine');
  const stranger = cand(3, 'z', 'stranger');
  const reply = cand(4, 'a', 'reply', { replyTo: mine.act });
  const r = rt([opener, mine, stranger, reply], { self: ME, must: [reply.act] }, 10_000);
  assert.deepEqual(r.posts.map((p) => [p.seq, p.tier]), [[1, 3], [2, 2], [3, 5], [4, 1]]);
});

test('thirdPerson is the body with every marker naming its author, the persona\'s own included; a plain body is unchanged', () => {
  const mine = cand(3, ME, 'my whole words', { name: 'QC-1000' });
  const reply = cand(4, 'x', `${q(mine.act, 'my whole words')} and more`, { quotes: [mine.act] });
  const plain = cand(5, 'y', 'just words');
  const r = rt([mine, reply, plain], { self: ME, must: [] }, 10_000);
  assert.equal(r.posts[1]!.body, '[quoting your post #3] and more');
  assert.equal(r.posts[1]!.thirdPerson, '[quoting QC-1000, post #3] and more');
  assert.equal(r.posts[2]!.thirdPerson, 'just words');
});

// ---- What a model reads of the board besides words (docs/plans/2026-11-25-reads-see-the-board-plan.md, Task 3) ----
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const later = (ms: number): string => new Date(NOW + ms).toISOString();
const aPoll = (o: Partial<NonNullable<ReadCandidate['poll']>> = {}): NonNullable<ReadCandidate['poll']> => ({
  question: 'Rename this board?', options: ['Yes', 'No'], pick: 1, secret: false, endsAt: later(2 * HOUR), closed: false, closedBy: null, counts: [9, 4], voters: 13, ...o,
});
const names = { cardName: (k: string) => (k === 'whoops' ? 'Whoops!' : undefined), reactionName: (k: string) => ({ heart: '❤', laugh: '😂' })[k as 'heart'] ?? k };
const one = (c: ReadCandidate, o: Partial<ReadOptions> = {}) => readLines(rt([c], { self: null, must: [] }, 100_000, { ...names, ...o }));

test('a post reads its body, then its poll, its plays and its reactions last', () => {
  const play = { play: 'p1', card: 'whoops', at: ago(2 * DAY), by: 'Wario', config: { color: 'teal' }, state: { washed: 0.2 } };
  const c = cand(1, 'a', 'Which?', { name: 'Ann', poll: aPoll(), plays: [play], reactions: { laugh: 1, heart: 3 } });
  const lines = one(c, { seen: (card, p) => (card === 'whoops' ? `Wario covered this post in teal goop, ${p.ago}. ${p.amountWords(0.2)} of it is scrubbed.` : null) });
  assert.deepEqual(lines, [
    'Ann [post #1]', 'Which?',
    '[poll on this post] "Rename this board?" (pick one)', '  Open: ends in 2 hours.', '  1. Yes: 9 (69%)', '  2. No: 4 (31%)', '  13 characters voted.',
    '[Wario covered this post in teal goop, 2 days ago. some of it is scrubbed.]',
    '[Reactions: ❤ 3, 😂 1]',
  ]);
});

test('a play with no sentence reads as the card\'s name, a back as a face-down card', () => {
  const c = cand(1, 'a', 'Hi', { name: 'Ann', plays: [{ play: 'p1', card: 'whoops', at: ago(HOUR), by: null, config: null, state: null }, { play: 'p2', card: null, at: ago(3 * HOUR), by: null, config: null, state: null }] });
  assert.deepEqual(one(c).slice(2), ['[Whoops! was played on this post, an hour ago.]', '[A card set face down was played on this post, 3 hours ago.]']);
});

test('a post with no extras reads as before; a rewound post says so before its body', () => {
  assert.deepEqual(one(cand(1, 'a', 'Hi', { name: 'Ann' })), ['Ann [post #1]', 'Hi']);
  assert.deepEqual(one(cand(1, 'a', 'Old words', { name: 'Ann', rewoundTo: ago(5 * DAY) })), ['Ann [post #1]', '[This post is showing how it looked 5 days ago.]', 'Old words']);
});

test('names on a poll change nothing that is rendered or chosen', () => {
  const plain = cand(1, 'a', 'Which?', { poll: aPoll() });
  const named = cand(1, 'a', 'Which?', { poll: aPoll({ names: [['Wario'], ['Toad']] }) });
  const strip = (r: ReturnType<typeof rt>) => r.posts.map((p) => ({ seq: p.seq, tier: p.tier, after: p.after }));
  assert.deepEqual(strip(rt([named], { self: null, must: [] }, 1000)), strip(rt([plain], { self: null, must: [] }, 1000)));
  assert.deepEqual(one(named), one(plain));
});

test('a long poll makes a tier-5 post not fit where its body alone would', () => {
  const o = cand(1, 'o', 'open');
  const plain = cand(2, 'x', 'b'.repeat(40));
  const withPoll = cand(2, 'x', 'b'.repeat(40), { poll: aPoll() });
  const room = 4 + 40;
  assert.deepEqual(rt([o, plain], { self: ME, must: [] }, room).posts.map((p) => p.seq), [1, 2]);
  assert.deepEqual(rt([o, withPoll], { self: ME, must: [] }, room).posts.map((p) => p.seq), [1]);
  assert.deepEqual(rt([o, withPoll], { self: ME, must: [] }, 1000).posts.map((p) => p.seq), [1, 2]);
});

const origin = (o: Partial<ReadOrigin> = {}): ReadOrigin => ({
  kind: 'post', place: { kind: 'post', thread: 't0', title: 'Best kart?', seq: 4 }, at: ago(180 * DAY), spunAt: ago(3 * DAY), moment: false,
  post: { act: uuid(5000), seq: 4, at: ago(180 * DAY), author: 'wario', name: 'Wario', pronouns: PRONOUN_PRESETS.he ?? null, body: 'Mach 8 forever.', title: 'Best kart?', thread: 't0', poll: aPoll(), plays: [], reactions: { heart: 2 } }, ...o,
});

test('a spun thread shows its origin directly above the opener: the line, the post block, then the opener', () => {
  const opener = cand(1, 'toad', '', { name: 'Toad' });
  const lines = readLines(rt([opener], { self: ME, must: [] }, 10_000, { ...names, origin: origin() }));
  assert.equal(lines[0], '(This thread was spun 3 days ago from Wario\'s post #4 in "Best kart?", written 6 months ago.)');
  assert.equal(lines[1], `Wario (he/him) [origin, post #4 in "Best kart?"]`);
  assert.equal(lines[2], 'Mach 8 forever.');
  assert.ok(lines.includes('[Reactions: ❤ 2]') && lines.some((l) => l.startsWith('[poll on this post]')));
  assert.equal(lines.at(-2), 'Toad [post #1]');
  assert.equal(lines.at(-1), '');
});

test('a play spin says it stands as it was when it was spun; an update origin has no post number; a place with no post is one line', () => {
  const opener = cand(1, 'toad', 'Hi', { name: 'Toad' });
  const play = origin({ kind: 'card', moment: true, place: { kind: 'play', card: 'whoops', on: { kind: 'post', thread: 't0', title: 'Best kart?', seq: 4 } } });
  assert.equal(readLines(rt([opener], { self: ME, must: [] }, 10_000, { ...names, origin: play }))[0], '(This thread was spun 3 days ago from Whoops! on post #4 in "Best kart?", 6 months ago, as it stood when it was spun.)');
  const upd = origin({ kind: 'update', place: { kind: 'update', act: 'u1', title: 'New board' }, post: { ...origin().post!, seq: null, title: 'New board' } });
  const lines = readLines(rt([opener], { self: ME, must: [] }, 10_000, { origin: upd }));
  assert.equal(lines[0], '(This thread was spun 3 days ago from the Updates post "New board", written 6 months ago.)');
  assert.equal(lines[1], 'Wario (he/him) [origin, the Updates post "New board"]');
  const bare = readLines(rt([opener], { self: ME, must: [] }, 10_000, { origin: origin({ post: null }) }));
  assert.deepEqual(bare.slice(1), ['Toad [post #1]', 'Hi']);
});

test('the origin never shows without the opener, and its size is part of the opener\'s', () => {
  const o = cand(1, 'o', 'open', { name: 'Open' });
  const mid = cand(2, 'm', 'mid', { name: 'Mid' });
  const spun = origin();
  const withOrigin = rt([o, mid], { self: ME, must: [] }, 10_000, { origin: spun }).posts;
  assert.equal(withOrigin[0]!.originLines!.length > 0, true);
  assert.deepEqual(withOrigin[1]!.originLines, []);
  // room for the opener's body and the other post, but not the opener's body plus its origin
  const lines = (r: ReturnType<typeof rt>) => readLines(r);
  const tight = rt([o, mid], { self: ME, must: [mid.act] }, 3 + 4, { origin: spun });
  assert.deepEqual(tight.posts.map((p) => p.seq), [2]);
  assert.equal(lines(tight).some((l) => l.includes('origin')), false);
  assert.equal(lines(tight).some((l) => l.includes('spun')), false);
});

test('a spun thread\'s opener ranks in tier 2, an unspun one in tier 3', () => {
  const cs = [cand(1, 'o', 'open'), cand(2, 'x', 'other')];
  assert.equal(rt(cs, { self: ME, must: [] }, 10_000).posts[0]!.tier, 3);
  assert.equal(rt(cs, { self: ME, must: [] }, 10_000, { origin: origin({ post: null }) }).posts[0]!.tier, 2);
});
