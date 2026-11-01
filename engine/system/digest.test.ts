import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIPS, renderDigest, type Digest } from './digest.ts';
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

// The largest caps the instance allows and every field at its longest: the rendered length has a ceiling.
test('the rendered length is bounded by the caps at their largest', () => {
  const THREADS = 10;
  const EXCERPTS = 8;
  const CHARS = 280;
  const FEED = 30;
  const long = (n: number): string => 'x'.repeat(n);
  const names = Array.from({ length: 3 * EXCERPTS + 1 }, (_, i) => ({ id: id(100 + i), name: long(200), staff: false }));
  const digest: Digest = {
    since: '2026-10-30T00:00:00.000000+00:00',
    until: '2026-10-31T00:00:00.000000+00:00',
    threads: Array.from({ length: THREADS }, (_, i) => ({ thread: id(i), title: long(500), board: long(500), posts: 99999999, heat: 99999999.99, controversy: 0.7499, length: 99999999 })),
    standings: Array.from({ length: EXCERPTS }, (_, i) => ({ rank: i + 1, character: names[i]!.id, amount: 2000000000 })),
    moves: [],
    quotes: Array.from({ length: EXCERPTS }, (_, i) => ({ from: names[i]!.id, to: names[i + 1]!.id, count: 99999999 })),
    bossReactions: Array.from({ length: EXCERPTS }, (_, i) => ({ act: id(i), thread: id(i), total: 99999999, tally: Object.fromEntries(Array.from({ length: 12 }, (_, k) => [long(CLIPS.kind) + k, 99999999])) })),
    excerpts: Array.from({ length: EXCERPTS }, (_, i) => ({ act: id(i), thread: id(i), character: names[i]!.id, reactions: 99999999, text: long(CHARS) })),
    characters: names,
  };
  const text = renderDigest(digest, null, Array.from({ length: FEED }, () => long(1000)));
  // threads: ~(120 + 60 + 120) a line; excerpts: 280 + 64 + 40; the rest and the feed's 200 a line, with generous headers.
  const bound = 2500 + THREADS * 330 + EXCERPTS * (350 + 140 + 140 + 440 + 120) + FEED * 210;
  assert.ok(text.length <= bound, `${text.length} > ${bound}`);
  assert.ok(text.length < 30000, `${text.length} is not small`);
  // Longer free text does not make it longer: the clips hold.
  const longer = renderDigest({ ...digest, threads: digest.threads.map((t) => ({ ...t, title: long(5000) })) }, null, []);
  const same = renderDigest(digest, null, []);
  assert.equal(longer.length, same.length);
});
