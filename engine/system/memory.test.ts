import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairMemory, type Memory } from './memory.ts';

const pub = new Set(['a', 'b', 'c']);
const base = {
  hobby: { name: 'tomatoes', since: '2026-10-30', from: 'a' },
  opinions: [{ character: 'a', score: 3, note: 'funny' }],
  grudges: [],
  wheelhouse: ['speedruns'],
  realWorld: ['elections'],
};

test('a memory in range is kept as given, with empty marks and no trims', () => {
  const r = repairMemory(base, pub);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions, base.opinions);
  assert.deepEqual(r.memory.marks, []);
  assert.deepEqual(r.trims, []);
});

test('a score out of range is clamped and recorded', () => {
  const r = repairMemory({ ...base, opinions: [{ character: 'a', score: 9, note: '' }, { character: 'b', score: -7, note: '' }] }, pub);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => o.score), [5, -5]);
  assert.deepEqual(r.trims, [
    { path: 'opinions[0].score', predicate: 'between(-5, 5)', before: 9, after: 5 },
    { path: 'opinions[1].score', predicate: 'between(-5, 5)', before: -7, after: -5 },
  ]);
});

test('an opinion or a grudge naming a character that is not public is dropped and recorded', () => {
  const r = repairMemory({ ...base, opinions: [{ character: 'a', score: 1, note: '' }, { character: 'secret', score: 4, note: '' }], grudges: [{ character: 'nobody', note: 'x' }, { character: 'c', note: 'y' }] }, pub);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => o.character), ['a']);
  assert.deepEqual(r.memory.grudges.map((g) => g.character), ['c']);
  assert.deepEqual(r.trims.map((t) => [t.path, t.predicate]), [['opinions[1]', 'publicCharacter'], ['grudges[0]', 'publicCharacter']]);
});

test('a repair that cannot be made names the predicate that failed', () => {
  const r = repairMemory({ ...base, hobby: undefined }, pub);
  assert.ok(!r.ok);
  assert.equal(r.path, 'hobby');
  assert.equal(r.predicate, 'required');
});

test('a returning Boss keeps an earlier opinion only while the character is still public', () => {
  const previous: Memory = { ...(base as unknown as Memory), marks: [], opinions: [{ character: 'b', score: 2, note: 'old' }, { character: 'gone', score: -4, note: 'retired' }], grudges: [{ character: 'gone', note: 'old grudge' }, { character: 'c', note: 'kept' }] };
  const r = repairMemory(base, pub, previous);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions.map((o) => o.character).sort(), ['a', 'b']);
  assert.deepEqual(r.memory.grudges.map((g) => g.character), ['c']);
  assert.deepEqual(r.trims.map((t) => t.path), ['previous.opinions[1]', 'previous.grudges[0]']);
});

test('the new answer wins over an earlier opinion of the same character', () => {
  const previous: Memory = { ...(base as unknown as Memory), marks: [], opinions: [{ character: 'a', score: -2, note: 'old' }], grudges: [] };
  const r = repairMemory(base, pub, previous);
  assert.ok(r.ok);
  assert.deepEqual(r.memory.opinions, [{ character: 'a', score: 3, note: 'funny' }]);
});
