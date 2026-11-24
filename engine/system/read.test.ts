import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markQuotes, readLines, readThread, READ_WINDOW, READ_WORDS, type ReadCandidate } from './read.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = 'char-me';
function cand(seq: number, author: string, body: string, o: Partial<ReadCandidate> = {}): ReadCandidate {
  return { act: o.act ?? uuid(1000 + seq), seq, at: `2026-11-0${(seq % 9) + 1}T00:00:00Z`, author, name: o.name ?? author, pronouns: null, body, replyTo: null, quotes: [], ...o };
}
const index = (cs: readonly ReadCandidate[]): Map<string, ReadCandidate> => new Map(cs.map((c) => [c.act, c]));
const q = (act: string, words: string): string => `[quote=${act}]${words}[/quote]`;

test('the fixed words and window', () => {
  assert.equal(READ_WINDOW, 60);
  assert.equal(READ_WORDS, 'Every post you are shown is whole. Where the game left posts out for space, a line says how many; it is not part of anyone\'s post, and your post never mentions it.');
});

test('Spritey thread: the opener is whole and the quoting reply reads the marker then its two questions', () => {
  const opener = cand(1, 'spritey', 'o'.repeat(312), { name: 'Spritey' });
  const mine = cand(3, ME, 'Here is my long whole post. '.repeat(24).trim(), { name: 'QC-1000' });
  const questions = '\n\nWhy did it happen? Who else saw it?';
  const body = q(mine.act, mine.body) + questions;
  const reply = cand(4, 'spritey', body, { name: 'Spritey', replyTo: mine.act, quotes: [mine.act] });
  assert.ok(body.length > 700);
  const r = readThread([opener, mine, reply], { self: ME, must: [] }, 2000);
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
  const r = readThread(cs, { self: ME, must: [] }, 100000);
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
  const quoterSize = readThread(all, { self: ME, must: [reply.act] }, 10000).posts.find((p) => p.act === quoter.act)!.body.length;
  const r = readThread(all, { self: ME, must: [reply.act] }, 100 + 100 + quoterSize + 100);
  const shown = r.posts.map((p) => p.seq);
  assert.deepEqual(shown, [1, 2, 3, 4]);
  assert.deepEqual(r.answered, [reply.act]);
  assert.equal(r.omitted, 3);
});

test('a long post is passed over, not a stop: two later short strangers are still taken', () => {
  const big = cand(1, 'a', 'b'.repeat(30000));
  const s1 = cand(2, 'c', 'short one');
  const s2 = cand(3, 'd', 'short two');
  const r = readThread([big, s1, s2], { self: ME, must: [] }, 1000);
  // the opener (tier 3) is the big one and does not fit; the strangers do.
  assert.deepEqual(r.posts.map((p) => p.seq), [2, 3]);
  assert.equal(r.omitted, 1);
  const cs2 = [cand(1, 'o', 'open'), cand(2, 'a', 'b'.repeat(30000)), cand(3, 'c', 'short one'), cand(4, 'd', 'short two')];
  const r2 = readThread(cs2, { self: ME, must: [] }, 1000);
  assert.deepEqual(r2.posts.map((p) => p.seq), [1, 3, 4]);
});

test('the must tier: the newest two of three 20,000 replies fit 40,000; one 50,000 is still whole', () => {
  const mine = cand(1, ME, 'mine');
  const a = cand(2, 'a', 'a'.repeat(20000), { replyTo: mine.act });
  const b = cand(3, 'b', 'b'.repeat(20000), { replyTo: mine.act });
  const c = cand(4, 'c', 'c'.repeat(20000), { replyTo: mine.act });
  const r = readThread([mine, a, b, c], { self: ME, must: [a.act, b.act, c.act] }, 40000);
  assert.deepEqual(r.answered, [b.act, c.act]);
  assert.deepEqual(r.posts.map((p) => p.seq), [3, 4]); // the answered posts fill 40,000; the persona's own post they answer no longer fits
  assert.equal(r.omitted, 2);
  const big = cand(2, 'a', 'a'.repeat(50000), { replyTo: mine.act });
  const r2 = readThread([mine, big], { self: ME, must: [big.act] }, 40000);
  assert.deepEqual(r2.answered, [big.act]);
  assert.equal(r2.posts.find((p) => p.act === big.act)!.body.length, 50000);
});

test('omitted and the not-shown lines count exactly', () => {
  const cs = [1, 2, 3, 4, 5, 6].map((n) => cand(n, `u${n}`, `post ${n} `.repeat(1)));
  const r = readThread(cs, { self: ME, must: [] }, cs[0]!.body.length + cs[3]!.body.length + cs[5]!.body.length);
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
  const r = readThread(cs, { self: ME, must: [cs[3]!.act] }, 20);
  assert.deepEqual(r.posts.map((p) => p.seq), [3, 4]);
  assert.deepEqual(readLines(r)[0], '(2 earlier posts not shown)');
  const one = [cand(1, 'o', 'o'.repeat(500)), cand(2, ME, 'mine'), cand(3, 'r', 'reply', { replyTo: uuid(1002) })];
  const r1 = readThread(one, { self: ME, must: [one[2]!.act] }, 20);
  assert.equal(readLines(r1)[0], '(1 earlier post not shown)');
});

test('must tier older replies stop at the first that does not fit', () => {
  const mine = cand(1, ME, 'm');
  const a = cand(2, 'a', 'a'.repeat(5000), { replyTo: mine.act });
  const b = cand(3, 'b', 'b'.repeat(30000), { replyTo: mine.act });
  const c = cand(4, 'c', 'c'.repeat(20000), { replyTo: mine.act });
  const r = readThread([mine, a, b, c], { self: ME, must: [a.act, b.act, c.act] }, 40000);
  assert.deepEqual(r.answered, [c.act]);
});

test('a post quoted by an answered reply is pulled in the must tier, ahead of newer posts', () => {
  const old = cand(1, 'str', 'old stranger words', { name: 'Str' });
  const mine = cand(2, ME, 'mine');
  const reply = cand(3, 'r', `${q(old.act, old.body)} reply`, { quotes: [old.act] });
  const toIt = cand(4, 'k', 'k'.repeat(50), { replyTo: mine.act });
  const newer = cand(5, 'n', 'n'.repeat(50));
  const all = [old, mine, reply, toIt, newer];
  const replySize = readThread(all, { self: ME, must: [reply.act] }, 10000).posts.find((p) => p.act === reply.act)!.body.length;
  const r = readThread(all, { self: ME, must: [reply.act] }, replySize + old.body.length);
  assert.deepEqual(r.posts.map((p) => p.seq), [1, 3]);
});

test('company ranks above strangers', () => {
  const mine = cand(1, ME, 'mine');
  const friend = cand(2, 'friend', 'f'.repeat(50), { replyTo: mine.act });
  const friend2 = cand(3, 'friend', 'g'.repeat(50));
  const stranger = cand(4, 'str', 's'.repeat(50));
  const opener = cand(0, 'op', 'o'.repeat(50));
  const r = readThread([opener, mine, friend, friend2, stranger], { self: ME, must: [] }, 4 + 50 + 50 + 50);
  assert.deepEqual(r.posts.map((p) => p.seq), [0, 1, 2, 3]);
});

test('a stranger post quoted by a post that quotes the persona ranks at tier 2', () => {
  const mine = cand(1, ME, 'mine');
  const old = cand(2, 'str', 'old words', { name: 'Str' });
  const quoter = cand(3, 'qq', `${q(mine.act, 'mine')}${q(old.act, 'old words')}`, { quotes: [mine.act, old.act] });
  const opener = cand(0, 'op', 'o'.repeat(40));
  const newer = cand(4, 'n', 'n'.repeat(40));
  const all = [opener, old, mine, quoter, newer];
  const sizeQ = readThread(all, { self: ME, must: [] }, 10000).posts.find((p) => p.act === quoter.act)!.body.length;
  const r = readThread(all, { self: ME, must: [] }, 4 + sizeQ + 9 + 40);
  assert.deepEqual(r.posts.map((p) => p.seq), [0, 1, 2, 3]);
  assert.ok(r.posts.some((p) => p.act === old.act));
});

test('the persona\'s own answered post is taken in the must tier', () => {
  const opener = cand(1, 'op', 'o'.repeat(500));
  const mine = cand(2, ME, 'mine');
  const reply = cand(3, 'r', 'reply', { replyTo: mine.act });
  const r = readThread([opener, mine, reply], { self: ME, must: [reply.act] }, 9);
  assert.deepEqual(r.posts.map((p) => p.seq), [2, 3]);
});

test('readLines writes the header with pronouns and marks, and the body', () => {
  const mine = cand(1, ME, 'my words', { name: 'QC-1000', pronouns: PRONOUN_PRESETS.he });
  const rep = cand(2, 'r', 'their words', { name: 'Gloomba', pronouns: PRONOUN_PRESETS.she, replyTo: mine.act });
  const r = readThread([mine, rep], { self: ME, must: [rep.act] }, 1000);
  assert.deepEqual(readLines(r), ['QC-1000 (he/him) [post #1] (you)', 'my words', 'Gloomba (she/her) [post #2] (answering) (replies to you)', 'their words']);
  assert.equal(readLines(r, { mustLabel: 'judged' })[2], 'Gloomba (she/her) [post #2] (judged) (replies to you)');
});

test('the same inputs read the same', () => {
  const cs = [cand(1, 'a', 'one'), cand(2, ME, 'two'), cand(3, 'b', 'three', { replyTo: uuid(1002) })];
  const f = { self: ME, must: [cs[2]!.act] };
  assert.deepEqual(readThread(cs, f, 500), readThread(cs, f, 500));
});

test('a sparse candidate set counts every post of the thread not shown', () => {
  const cs = [cand(1, 'o', 'open'), ...Array.from({ length: 61 }, (_, i) => cand(100 + i, `u${i}`, 'x'))];
  const r = readThread(cs, { self: ME, must: [] }, 100000);
  assert.equal(r.posts.length, 62);
  assert.equal(r.omitted, 98);
  const lines = readLines(r);
  assert.equal(lines.filter((l) => /not shown/.test(l)).length, 1);
  assert.equal(lines[2], '(98 posts not shown)');
  const tail = readThread([cand(1, 'o', 'open'), cand(2, 'a', 'a'.repeat(100)), cand(5, 'b', 'b'.repeat(100))], { self: ME, must: [] }, 4);
  assert.equal(tail.omitted, 4);
  assert.equal(readLines(tail).at(-1), '(4 posts not shown)');
});

test('candidates are deduped by act, first wins', () => {
  const a = cand(1, 'a', 'first');
  const r = readThread([a, { ...a, body: 'second' }], { self: ME, must: [] }, 1000);
  assert.deepEqual(r.posts.map((p) => p.body), ['first']);
});

test('an unclosed quote of a non-candidate with empty contents reads as a hidden post', () => {
  assert.equal(markQuotes(`x [quote=${uuid(5)}]`, new Map(), ME), 'x [quoting a hidden post]');
});

test('edges: empty input, empty body, case and spacing, self-quote, self null, tiny ceiling, unknown must, many must', () => {
  assert.deepEqual(readThread([], { self: ME, must: [uuid(1)] }, 10), { posts: [], omitted: 0, answered: [], through: 0 });
  assert.deepEqual(readLines(readThread([], { self: ME, must: [] }, 10)), []);
  assert.equal(markQuotes('', new Map(), ME), '');
  const a = cand(2, 'x', 'Some  words\tthere', { name: 'Ann' });
  assert.equal(markQuotes(`[quote=${a.act.toUpperCase()}]Some words there[/quote]`, index([a]), ME), '[quoting Ann, post #2]');
  const selfQ = cand(1, 'x', 'plain', { quotes: [uuid(1001)] });
  assert.equal(readThread([selfQ], { self: ME, must: [] }, 100).posts.length, 1);
  const n = readThread([cand(1, ME, 'mine'), cand(2, 'a', 'abc')], { self: null, must: [] }, 100);
  assert.equal(n.posts.length, 2);
  assert.ok(n.posts.every((p) => !p.marks.you));
  const tiny = readThread([cand(1, 'a', 'aaaa'), cand(2, 'b', 'bbbb')], { self: ME, must: [] }, 3);
  assert.deepEqual([tiny.posts.length, tiny.omitted], [0, 2]);
  const u = readThread([cand(1, 'a', 'aaaa')], { self: ME, must: [uuid(999)] }, 100);
  assert.deepEqual(u.answered, []);
  assert.equal(u.posts.length, 1);
  const cs = [cand(1, 'a', 'a'), cand(2, 'b', 'b'), cand(3, 'c', 'c')];
  assert.deepEqual(readThread(cs, { self: ME, must: [cs[1]!.act, cs[2]!.act] }, 100).answered, [cs[1]!.act, cs[2]!.act]);
});

test('must is ordered by seq, not by array position', () => {
  const a = cand(2, 'a', 'a'.repeat(30)), b = cand(3, 'b', 'b'.repeat(30)), c = cand(4, 'c', 'c'.repeat(30));
  const r = readThread([a, b, c], { self: ME, must: [c.act, a.act, b.act] }, 60);
  assert.deepEqual(r.answered, [b.act, c.act]);
});
