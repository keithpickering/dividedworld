import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASKABLE_MOVE_KINDS, MOVE_KINDS, moveKind, moveParamsProblems } from './moves.ts';

const board = '11111111-1111-4111-8111-111111111111';
const rename = { board, name: 'Pointless Toast Palace', premise: 'Toast, and only toast.', description: 'A 2003 board index.' };

test('the catalog holds renameBoard, structural, with a long plain label', () => {
  assert.deepEqual(MOVE_KINDS.map((k) => [k.key, k.structural]), [['renameBoard', true], ['nameSuccessor', true]]);
  assert.deepEqual(ASKABLE_MOVE_KINDS.map((k) => k.key), ['renameBoard'], 'a successor is named in its own answer, never among the moves');
  assert.deepEqual(MOVE_KINDS.map((k) => k.shapesBoard), [true, false]);
  assert.equal(moveKind('renameBoard')?.label, 'THE SYSTEM RENAMED THIS BOARD');
  assert.equal(moveKind('shout'), undefined);
});

test('renameBoard params are held to their shape; a string over its outer bound is trimmed and recorded, a missing field rejected', () => {
  const ok = moveParamsProblems('renameBoard', rename);
  assert.ok(ok.ok && ok.trims.length === 0);
  const long = moveParamsProblems('renameBoard', { ...rename, name: 'x'.repeat(260) });
  assert.ok(long.ok && long.trims.length === 1 && long.trims[0]?.path === 'name', JSON.stringify(long));
  const missing = moveParamsProblems('renameBoard', { board, name: 'x', premise: 'y' });
  assert.ok(!missing.ok && missing.path === 'description' && missing.predicate === 'required');
  const notUuid = moveParamsProblems('renameBoard', { ...rename, board: 'x'.repeat(36) });
  assert.ok(!notUuid.ok && notUuid.predicate === 'isUuid');
  const unknown = moveParamsProblems('shout', {});
  assert.ok(!unknown.ok && unknown.path === 'kind');
});

test('the log line reads in plain words with nothing unfilled', () => {
  const words = moveKind('renameBoard')!.template(rename);
  assert.equal(words, 'The System renamed a board to "Pointless Toast Palace". Its subject is now: Toast, and only toast.');
  assert.doesNotMatch(words, /[{}]|undefined/);
});

test('an uppercase board uuid is lowercased by the repair, and is not a trim', () => {
  const mixed = '11111111-1111-4111-8111-AAAAAAAAAAAA';
  const r = moveParamsProblems('renameBoard', { ...rename, board: mixed });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((r.value as { board: string }).board, mixed.toLowerCase());
  assert.equal(r.trims.length, 0);
});

test('every move kind has plain words for a stock line\'s {move}, naming only params it has', () => {
  for (const k of MOVE_KINDS) {
    assert.ok(k.plain.trim() !== '', `${k.key} has no plain words`);
    const fields = Object.keys((k.params as { fields: Record<string, unknown> }).fields);
    for (const [, token] of k.plain.matchAll(/\{(\w+)\}/g)) assert.ok(fields.includes(token!), `${k.key}'s words name {${token}}, which is no param`);
  }
});

test('a move reads as one short plain sentence in pieces, with the boards it names (the moderation log and the admin queue)', () => {
  const parts = moveKind('renameBoard')!.parts;
  assert.deepEqual(parts(rename, 'General', 'done'), ['Renamed ', { board, name: 'General' }, ' to ', { board, name: 'Pointless Toast Palace' }]);
  assert.deepEqual(parts(rename, 'General', 'plan'), ['Rename ', { board, name: 'General' }, ' to ', { board, name: 'Pointless Toast Palace' }]);
  assert.deepEqual(parts(rename, null, 'done')[1], { board, name: 'a board' });
});

test('a successor move names a roster key and reads as one short plain sentence', () => {
  const k = moveKind('nameSuccessor')!;
  assert.ok(moveParamsProblems('nameSuccessor', { boss: 'grumble' }).ok);
  assert.equal(moveParamsProblems('nameSuccessor', {}).ok, false);
  assert.equal(moveParamsProblems('nameSuccessor', { boss: '' }).ok, false);
  assert.deepEqual(k.parts({ boss: 'grumble' }, 'Grumble', 'plan'), ['Name ', 'Grumble', ' as the next Boss']);
  assert.deepEqual(k.parts({ boss: 'grumble' }, null, 'done'), ['Named ', 'grumble', ' as the next Boss']);
});
