import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIPS, DIGEST_MOST, renderDigest, type Digest } from './digest.ts';
import type { Memory } from './memory.ts';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const small: Digest = {
  since: '2026-10-30T00:00:00Z',
  until: '2026-10-31T00:00:00Z',
  threads: [{ thread: id(1), title: 'Who ate the pie', board: 'General', posts: 9, heat: 0.38, controversy: 0.5, length: 40 }],
  standings: [{ rank: 1, character: id(2), amount: 120 }],
  moves: [],
  quotes: [{ from: id(2), to: id(3), count: 2 }],
  bossReactions: [{ act: id(9), thread: id(1), total: 5, tally: { fire: 4, skull: 1 } }],
  excerpts: [{ act: id(8), thread: id(1), character: id(3), reactions: 7, text: 'It was me all along' }],
  characters: [
    { id: id(2), name: 'Mario', staff: false },
    { id: id(3), name: 'Luigi', staff: false },
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
  for (const heading of ['What you remember', 'Hot threads', 'Standings', 'Moves', 'Quotes between characters', 'Reactions to your own posts', 'Top posts', 'Outside']) {
    assert.ok(text.includes(`## ${heading}`), heading);
  }
  assert.ok(text.includes('"Who ate the pie" on General: 9 posts in the window (0.38 an hour), 40 in all, controversy 0.5.'));
  assert.ok(text.includes('1. Mario: 120'));
  assert.ok(text.includes('Mario quoted Luigi 2 times.'));
  assert.ok(text.includes('5 in all: fire 4, skull 1.'));
  assert.ok(text.includes('Luigi (7 reactions): It was me all along'));
  assert.ok(text.includes('Opinion of Mario: 3. funny'));
  assert.ok(text.includes('- A feed item'));
  assert.ok(!/[<>]|\{|\}/.test(text.replace(/## /g, '')), 'plain text, no markup or json');
});

test('a new Boss is told it has no memory, and empty sections say so', () => {
  const text = renderDigest({ ...small, threads: [], standings: [], quotes: [], bossReactions: [], excerpts: [] }, null, []);
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
  assert.ok(renderDigest({ ...small, moves: [{ note: 'unknown shape' }] }, null, []).includes('{"note":"unknown shape"}'));
});

test('the rendered length is bounded by the ceilings, whatever the digest holds', () => {
  const { threads: T, excerpts: E, excerptChars: C, feed: F } = DIGEST_MOST;
  const OVER = 3;
  const long = (n: number): string => 'x'.repeat(n);
  const names = Array.from({ length: 4 * (E + OVER) }, (_, i) => ({ id: id(1000 + i), name: long(500), staff: false }));
  const lists = (n: number) => Array.from({ length: n }, (_, i) => i);
  const digest: Digest = {
    since: '2026-10-30T00:00:00.000000+00:00',
    until: '2026-10-31T00:00:00.000000+00:00',
    threads: lists(T + OVER).map((i) => ({ thread: id(i), title: long(5000), board: long(5000), posts: 99999999, heat: 99999999.99, controversy: 0.7499, length: 99999999 })),
    standings: lists(E + OVER).map((i) => ({ rank: i + 1, character: names[i]!.id, amount: 2000000000 })),
    moves: lists(E + OVER).map((i) => ({ move: long(5000), i })),
    quotes: lists(E + OVER).map((i) => ({ from: names[i]!.id, to: names[i + 1]!.id, count: 99999999 })),
    bossReactions: lists(E + OVER).map((i) => ({ act: id(i), thread: id(i), total: 99999999, tally: Object.fromEntries(lists(12).map((k) => [long(100) + k, 99999999])) })),
    excerpts: lists(E + OVER).map((i) => ({ act: id(i), thread: id(i), character: names[i]!.id, reactions: 99999999, text: long(5 * C) })),
    characters: names,
  };
  const text = renderDigest(digest, null, lists(F + OVER).map(() => long(5000)));
  // A line's fixed words and numbers fit in 200; every free string counts at its clip.
  const LINE = 200;
  const bound =
    2000 + // headings, the window, the empty-section sentences
    T * (CLIPS.title + CLIPS.board + LINE) +
    E * (CLIPS.name + LINE) + // standings
    E * (CLIPS.move + LINE) + // moves
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
  assert.equal(lines('Standings'), E);
  assert.equal(lines('Moves'), E);
  assert.equal(lines('Quotes between characters'), E);
  assert.equal(lines('Reactions to your own posts'), E);
  assert.equal(lines('Top posts'), E);
  assert.equal(lines('Outside'), F);
  assert.ok(text.split('\n').every((l) => !l.includes('x'.repeat(C + 1))), 'an excerpt is clipped to the excerpt maximum');
  // Longer free text does not make it longer: the clips hold.
  const longer = renderDigest({ ...digest, threads: digest.threads.map((t) => ({ ...t, title: long(50000) })) }, null, []);
  assert.equal(longer.length, renderDigest(digest, null, []).length);
});
