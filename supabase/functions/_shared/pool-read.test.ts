import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRONOUN_PRESETS, type PronounSet } from '../../../engine/rules/pronouns.ts';
import { readLines } from '../../../engine/system/read.ts';
import { readContext, readOf, readingOf, type PoolRead } from './pool-read.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const DAY = 24 * 3_600_000;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const IT = PRONOUN_PRESETS.it as PronounSet;
const HE = PRONOUN_PRESETS.he as PronounSet;

const ctx = readContext({ cards: [{ key: 'whoops', name: 'Whoops!', seen: () => 'Wario played Whoops!.' }], reactions: [{ key: 'heart', emoji: '❤' }], settings: { postMaxLength: 20_000 } }, NOW);
const post = (seq: number, o: Record<string, unknown> = {}) => ({ act: `a${seq}`, seq, at: ago(DAY), author: 'wario', name: 'Wario', pronouns: null, body: `Body ${seq}`, replyTo: null, quotes: [], ...o });
const lines = (pr: PoolRead): string[] => readLines(readOf(pr, IT, [], 100_000, ctx));

test('readContext carries the instance\'s cards and reactions and the time', () => {
  assert.equal(ctx.now, NOW);
  assert.equal(ctx.cards[0]!.key, 'whoops');
  assert.equal(ctx.postMaxLength, 20_000, 'and the post length limit, the bound on a covered read');
});

test('a pool_read from before 0426 (no extras on any post) reads as posts with none', () => {
  const l = lines({ title: 'T', self: null, posts: [post(1)] });
  assert.deepEqual(l.filter((x) => x.startsWith('[')), []);
  assert.ok(l.includes('Body 1'));
});

test('extras on a post are rendered: poll, play (the instance\'s sentence), reactions', () => {
  const l = lines({
    title: 'T', self: null, posts: [post(1, {
      poll: { question: 'Q?', options: ['A', 'B'], pick: 1, secret: false, endsAt: ago(-DAY), closed: false, closedBy: null, closedAt: null, counts: [1, 0], voters: 1 },
      plays: [{ play: 'p', card: 'whoops', at: ago(DAY), by: 'Wario', config: {}, state: null, text: null, covered: null }], reactions: { heart: 2 },
    })],
  });
  assert.ok(l.some((x) => x.startsWith('[poll on this post]')));
  assert.ok(l.includes('[Wario played Whoops!.]'));
  assert.ok(l.includes('[Reactions: ❤ 2]'));
});

test('a null origin, and an absent one, read as no origin', () => {
  for (const origin of [null, undefined]) assert.ok(!lines({ title: 'T', self: null, posts: [post(1)], origin }).some((x) => x.startsWith('(This thread was spun')));
});

test('an origin with a null post is its one line; an origin post with no extras reads as having none', () => {
  const base = { kind: 'update', place: null, at: ago(DAY), spunAt: ago(DAY), moment: false };
  const bare = lines({ title: 'T', self: null, posts: [post(1)], origin: { ...base, post: null } });
  assert.ok(bare[0]!.startsWith('(This thread was spun'));
  const op = { act: 'o', seq: null, at: ago(DAY), author: null, name: 'Wario', pronouns: null, body: 'Old words', title: 'Update' } as unknown as NonNullable<PoolRead['origin']>['post'];
  const l = lines({ title: 'T', self: null, posts: [post(1)], origin: { ...base, post: op } });
  assert.ok(l.includes('Old words'));
  assert.doesNotMatch(l.join('\n'), /null|undefined/);
});

test('pronouns: a null set takes the fallback, a given set is kept, for posts and for the origin post', () => {
  const he = lines({ title: 'T', self: null, posts: [post(1, { pronouns: HE })] }).join('\n');
  const it = lines({ title: 'T', self: null, posts: [post(1)] }).join('\n');
  assert.notEqual(he, it, 'a given set shows differently from the fallback');
  const base = { kind: 'post', place: null, at: ago(DAY), spunAt: ago(DAY), moment: false };
  const o = (pronouns: PronounSet | null) => ({ ...base, post: { act: 'o', seq: 4, at: ago(DAY), author: 'x', name: 'Wario', pronouns, body: 'B', title: 'T' } }) as unknown as PoolRead['origin'];
  const originTag = (l: string[]): string | undefined => l.find((x) => x.includes('[origin,'));
  assert.equal(originTag(lines({ title: 'T', self: null, posts: [post(1)], origin: o(null) })), 'Wario (it/its) [origin, post #4 in "T"]', 'null origin pronouns take the fallback');
  assert.equal(originTag(readLines(readOf({ title: 'T', self: null, posts: [post(1)], origin: o(HE) }, IT, [], 100_000, ctx))), 'Wario (he/him) [origin, post #4 in "T"]', 'a given set is kept');
});

test('readingOf reaches a card\'s covers by key, and gives null for an unknown card or a back with no card', () => {
  const cctx = readContext({ cards: [{ key: 'tape', name: 'Tape', covers: () => [{ from: 0, to: 2, words: 'Not' }] }, { key: 'plain', name: 'Plain' }], reactions: [], settings: { postMaxLength: 20_000 } }, NOW);
  const reading = readingOf(1000, cctx);
  const p = { config: null, state: null, text: 'It was' };
  assert.deepEqual(reading.covers!('tape', p), [{ from: 0, to: 2, words: 'Not' }]);
  assert.equal(reading.covers!('plain', p), null);
  assert.equal(reading.covers!('gone', p), null);
  assert.equal(reading.covers!(null, p), null);
  const l = readLines(readOf({ title: 'T', self: null, posts: [post(1, { body: 'It was me', plays: [{ play: 'p', card: 'tape', at: ago(DAY), by: 'Wario', config: null, state: null, text: null, covered: null }] })] }, IT, [], 100_000, cctx));
  assert.ok(l.includes('Not me') || l.includes('Not was me'), l.join('\n'));
});

test('readingOf bounds a covered read by the instance\'s post length limit', () => {
  const tctx = readContext({ cards: [{ key: 'tape', name: 'Tape', covers: (p) => Array.from(p.text.matchAll(/abcd/g), (m) => ({ from: m.index, to: m.index + 4, words: '['.repeat(100) }) ) }], reactions: [], settings: { postMaxLength: 20_000 } }, NOW);
  assert.equal(readingOf(1000, tctx).coveredMost, 20_000);
  const body = 'abcd '.repeat(4000);
  const play = { play: 'p', card: 'tape', at: ago(DAY), by: 'Wario', config: null, state: null, text: null, covered: null };
  const read = readOf({ title: 'T', self: null, posts: [post(1, { body, plays: [play] })] }, IT, ['a1'], 1000, tctx);
  assert.equal(read.posts.length, 1, 'the judged post is read whatever its size');
  assert.ok(read.posts[0]!.body.length <= 20_000, `${read.posts[0]!.body.length}`);
});
