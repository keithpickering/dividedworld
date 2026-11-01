import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairMemory } from './memory.ts';

const caps = { memoryOpinions: 40, memoryGrudges: 20, memoryWheelhouse: 30, memoryRealWorld: 30 };
const pub = new Set(['a', 'b', 'c']);
const base = {
  hobby: { name: 'tomatoes', since: '2026-10-30', from: 'a' },
  opinions: [{ character: 'a', score: 3, note: 'funny' }],
  grudges: [],
  wheelhouse: ['speedruns'],
  realWorld: ['elections'],
};

test('a memory in range is kept as given, with empty marks and no trims', () => {
  const r = repairMemory(base, (id) => pub.has(id), caps);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions, base.opinions);
  assert.deepEqual(r.memory.marks, []);
  assert.deepEqual(r.trims, []);
});

test('a score out of range is clamped and recorded', () => {
  const r = repairMemory({ ...base, opinions: [{ character: 'a', score: 9, note: '' }, { character: 'b', score: -7, note: '' }] }, (id) => pub.has(id), caps);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => o.score), [5, -5]);
  assert.deepEqual(r.trims, [
    { path: 'opinions[0].score', predicate: 'between(-5, 5)', before: 9, after: 5 },
    { path: 'opinions[1].score', predicate: 'between(-5, 5)', before: -7, after: -5 },
  ]);
});

test('an opinion or a grudge naming a character that is not public is dropped and recorded', () => {
  const r = repairMemory({ ...base, opinions: [{ character: 'a', score: 1, note: '' }, { character: 'secret', score: 4, note: '' }], grudges: [{ character: 'nobody', note: 'x' }, { character: 'c', note: 'y' }] }, (id) => pub.has(id), caps);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => o.character), ['a']);
  assert.deepEqual(r.memory.grudges.map((g) => g.character), ['c']);
  assert.deepEqual(r.trims.map((t) => [t.path, t.predicate]), [['opinions[1]', 'publicCharacter'], ['grudges[0]', 'publicCharacter']]);
});

test('a repair that cannot be made names the predicate that failed', () => {
  const r = repairMemory({ ...base, hobby: undefined }, (id) => pub.has(id), caps);
  assert.ok(!r.ok);
  assert.equal(r.path, 'hobby');
  assert.equal(r.predicate, 'required');
});

test('an earlier opinion the new answer omits is not carried forward', () => {
  const r = repairMemory({ ...base, opinions: [{ character: 'a', score: 3, note: 'funny' }], grudges: [] }, (id) => pub.has(id), caps);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => o.character), ['a']);
  assert.deepEqual(r.memory.grudges, []);
});

test('an opinion of a character the digest did not name is kept while that character is public now', () => {
  const r = repairMemory({ ...base, opinions: [{ character: 'b', score: 2, note: 'old' }] }, (id) => id === 'b', caps);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => o.character), ['b']);
});

test('a list over its cap keeps the first N and records the trim', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ character: `c${i}`, score: 1, note: String(i) }));
  const r = repairMemory({ ...base, opinions: many, wheelhouse: ['1', '2', '3'] }, () => true, { ...caps, memoryWheelhouse: 2 });
  assert.ok(r.ok);
  assert.equal(r.memory.opinions.length, 40);
  assert.equal(r.memory.opinions[39]?.note, '39');
  assert.deepEqual(r.memory.wheelhouse, ['1', '2']);
  assert.deepEqual(r.trims, [
    { path: 'opinions', predicate: 'atMost(40)', before: 45, after: 40 },
    { path: 'wheelhouse', predicate: 'atMost(2)', before: 3, after: 2 },
  ]);
});

test('a character named twice in a list keeps its first entry and the drop is recorded', () => {
  const r = repairMemory({
    ...base,
    opinions: [{ character: 'a', score: 3, note: 'first' }, { character: 'b', score: 1, note: '' }, { character: 'a', score: -2, note: 'second' }],
    grudges: [{ character: 'c', note: 'one' }, { character: 'c', note: 'two' }],
  }, (id) => pub.has(id), caps);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => [o.character, o.score]), [['a', 3], ['b', 1]]);
  assert.deepEqual(r.memory.grudges.map((g) => g.note), ['one']);
  assert.deepEqual(r.trims, [
    { path: 'opinions[2]', predicate: 'uniqueCharacter', before: 1, after: 0 },
    { path: 'grudges[1]', predicate: 'uniqueCharacter', before: 1, after: 0 },
  ]);
});
