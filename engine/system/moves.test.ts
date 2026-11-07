import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASKABLE_MOVE_KINDS, MOVE_KINDS, moveKind, moveParamsProblems } from './moves.ts';

const board = '11111111-1111-4111-8111-111111111111';
const rename = { board, name: 'Pointless Toast Palace', premise: 'Toast, and only toast.', description: 'A 2003 board index.' };

test('the catalog holds renameBoard, structural, with a long plain label', () => {
  assert.deepEqual(MOVE_KINDS.map((k) => [k.key, k.structural]), [['renameBoard', true], ['nameSuccessor', true], ['setRule', false], ['conferGroup', false]]);
  assert.deepEqual(ASKABLE_MOVE_KINDS.map((k) => k.key), ['renameBoard', 'setRule', 'conferGroup'], 'a successor is named in its own answer, never among the moves');
  assert.deepEqual(MOVE_KINDS.map((k) => k.shapesBoard), [true, false, false, false]);
  assert.equal(moveKind('renameBoard')?.label, '{role} renamed this board');
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
  const words = moveKind('renameBoard')!.template(rename, 'The Boss');
  assert.equal(words, 'The Boss renamed a board to "Pointless Toast Palace". Its subject is now: Toast, and only toast.');
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

test('every move kind names the offices that may make it, and only the two offices exist', () => {
  for (const k of MOVE_KINDS) {
    assert.ok(Array.isArray(k.offices) && k.offices.length > 0, `${k.key} has no offices`);
    for (const o of k.offices) assert.ok(o === 'boss' || o === 'mod', `${k.key} names the office ${o}`);
    assert.equal(new Set(k.offices).size, k.offices.length, `${k.key} names an office twice`);
  }
  assert.deepEqual(moveKind('renameBoard')!.offices, ['boss']);
  assert.deepEqual(moveKind('nameSuccessor')!.offices, ['boss']);
  assert.deepEqual(moveKind('setRule')!.offices, ['boss', 'mod']);
});

const rule = { board, predicate: 'noDoublePost', param: null, band: 'minor' };

test('setRule is a small move, askable, and keeps its params whole', () => {
  const k = moveKind('setRule')!;
  assert.deepEqual([k.structural, k.shapesBoard, k.askable, k.label, k.plain], [false, false, true, 'Set a rule', 'a rule']);
  assert.deepEqual(k.uuids, ['board']);
  const ok = moveParamsProblems('setRule', rule);
  assert.ok(ok.ok && ok.trims.length === 0, JSON.stringify(ok));
  assert.deepEqual((ok as { value: unknown }).value, rule, 'a null param stays null in the repaired params');
  const counted = moveParamsProblems('setRule', { board, predicate: 'minLength', param: 20, band: 'moderate' });
  assert.ok(counted.ok);
  assert.deepEqual((counted as { value: unknown }).value, { board, predicate: 'minLength', param: 20, band: 'moderate' });
  const worded = moveParamsProblems('setRule', { board, predicate: 'bannedWord', param: 'toast', band: 'severe' });
  assert.ok(worded.ok);
});

test('setRule with a null board is every board, and an uppercase board is lowercased', () => {
  const house = moveParamsProblems('setRule', { ...rule, board: null });
  assert.ok(house.ok, JSON.stringify(house));
  assert.equal((house as { value: { board: unknown } }).value.board, null);
  const absent = moveParamsProblems('setRule', { predicate: 'noDoublePost', band: 'minor' });
  assert.ok(absent.ok && (absent.value as { board: unknown; param: unknown }).board === null && (absent.value as { param: unknown }).param === null);
  const mixed = moveParamsProblems('setRule', { ...rule, board: '11111111-1111-4111-8111-AAAAAAAAAAAA' });
  assert.ok(mixed.ok && (mixed.value as { board: string }).board === '11111111-1111-4111-8111-aaaaaaaaaaaa');
});

test('setRule is refused naming what failed: the predicate, its param, the band, the board', () => {
  const bad = (params: unknown) => moveParamsProblems('setRule', params);
  const unknown = bad({ ...rule, predicate: 'noPoison' });
  assert.ok(!unknown.ok && unknown.path === 'predicate' && unknown.predicate.startsWith('oneOf(minLength'), JSON.stringify(unknown));
  const high = bad({ board, predicate: 'minLength', param: 201, band: 'minor' });
  assert.ok(!high.ok && high.path === 'param' && high.predicate === 'atMost(200)', JSON.stringify(high));
  const spaced = bad({ board, predicate: 'bannedWord', param: 'two words', band: 'minor' });
  assert.ok(!spaced.ok && spaced.path === 'param' && spaced.predicate === 'noSpaces');
  const extra = bad({ ...rule, param: 4 });
  assert.ok(!extra.ok && extra.path === 'param' && extra.predicate === 'noParam');
  const band = bad({ ...rule, band: 'dire' });
  assert.ok(!band.ok && band.path === 'band' && band.predicate.startsWith('oneOf('));
  const notUuid = bad({ ...rule, board: 'x'.repeat(36) });
  assert.ok(!notUuid.ok && notUuid.path === 'board' && notUuid.predicate === 'isUuid');
  const missing = bad({ board });
  assert.ok(!missing.ok && missing.path === 'predicate' && missing.predicate === 'required');
});

test('a setRule reads in plain words with nothing unfilled, for the log and for the admin queue', () => {
  const k = moveKind('setRule')!;
  const words = k.template(rule, 'The Boss');
  assert.match(words, /no double posting/);
  assert.doesNotMatch(words, /[{}]|undefined|null/);
  assert.deepEqual(k.parts(rule, 'General', 'plan'), ['Set a rule on ', { board, name: 'General' }, ': no double posting']);
  assert.deepEqual(k.parts(rule, 'General', 'done'), ['Set a rule on ', { board, name: 'General' }, ': no double posting']);
  assert.deepEqual(k.parts({ ...rule, board: null, predicate: 'minLength', param: 20 }, null, 'plan'), ['Set a house rule for every board: posts of at least 20 characters']);
  assert.match(k.template({ ...rule, board: null }, 'The Boss'), /every board/);
});

const who = '22222222-2222-4222-8222-222222222222';

test('conferGroup is small, askable, made by the Boss or a Mod, and shapes no board', () => {
  const k = moveKind('conferGroup')!;
  assert.ok(k);
  assert.deepEqual([k.structural, k.shapesBoard, k.askable, k.offices], [false, false, true, ['boss', 'mod']]);
  assert.equal(k.label, '{role} moved a member');
  assert.equal(k.plain, 'moving a member into "{group}"');
});

test('conferGroup params: a punishment with a board, a favor with checkAt, a non-uuid board rejected naming isUuid, a 41-character group rejected', () => {
  const punish = moveParamsProblems('conferGroup', { character: who, group: 'trial', board });
  assert.ok(punish.ok, JSON.stringify(punish));
  assert.equal((punish.value as Record<string, unknown>)['board'], board);
  const favor = moveParamsProblems('conferGroup', { character: who, group: 'regular', checkAt: '2026-11-20T00:00:00Z' });
  assert.ok(favor.ok, JSON.stringify(favor));
  assert.equal((favor.value as Record<string, unknown>)['board'], null);
  const bad = moveParamsProblems('conferGroup', { character: who, group: 'trial', board: 'x'.repeat(36) });
  assert.ok(!bad.ok && bad.path === 'board' && bad.predicate === 'isUuid', JSON.stringify(bad));
  const badChar = moveParamsProblems('conferGroup', { character: 'x'.repeat(36), group: 'trial' });
  assert.ok(!badChar.ok && badChar.path === 'character' && badChar.predicate === 'isUuid', JSON.stringify(badChar));
  const long = moveParamsProblems('conferGroup', { character: who, group: 'g'.repeat(41) });
  assert.ok(long.ok && long.trims.length === 1 && long.trims[0]?.path === 'group', JSON.stringify(long));
  const none = moveParamsProblems('conferGroup', { character: who, group: '' });
  assert.ok(!none.ok && none.path === 'group', JSON.stringify(none));
});

test('conferGroup reads in plain words from the names it is given, and never names a group itself', () => {
  const k = moveKind('conferGroup')!;
  const p = { character: who, group: 'trial', board };
  const names = { character: 'Pipewrench', group: 'Trial Members', board: 'General' };
  assert.equal(k.template(p, 'The Boss', names), 'The Boss put Pipewrench in Trial Members, barred from posting on General.');
  assert.equal(k.template({ character: who, group: 'regular' }, 'The Boss', { character: 'Pipewrench', group: 'Regulars' }), 'The Boss put Pipewrench in Regulars.');
  assert.doesNotMatch(k.template(p, 'The Boss'), /[{}]|undefined|null/);
  assert.deepEqual(k.parts(p, null, 'done', names), ['Put Pipewrench in Trial Members, barred from ', { board, name: 'General' }]);
  assert.deepEqual(k.parts(p, null, 'plan', names), ['Put Pipewrench in Trial Members, barred from ', { board, name: 'General' }, ' (planned)']);
  assert.deepEqual(k.parts({ character: who, group: 'regular' }, null, 'done', { character: 'Pipewrench', group: 'Regulars' }), ['Put Pipewrench in Regulars']);
});
