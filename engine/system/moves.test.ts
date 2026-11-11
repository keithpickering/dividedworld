import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASKABLE_MOVE_KINDS, MOVE_KINDS, machineLimits, moveKind, moveParamsProblems } from './moves.ts';
import { MACHINE_DEFAULTS } from '../rules/packs.ts';

const board = '11111111-1111-4111-8111-111111111111';
const rename = { board, name: 'Pointless Toast Palace', premise: 'Toast, and only toast.', description: 'A 2003 board index.' };

test('the catalog holds renameBoard, structural, with a long plain label', () => {
  assert.deepEqual(MOVE_KINDS.map((k) => [k.key, k.structural]), [['renameBoard', true], ['nameSuccessor', true], ['setRule', false], ['conferGroup', false], ['pullSlot', false], ['repriceSlot', false], ['flashSale', false], ['createBoard', true], ['moveThread', false], ['mergeBoard', true]]);
  assert.deepEqual(ASKABLE_MOVE_KINDS.map((k) => k.key), ['renameBoard', 'setRule', 'conferGroup', 'pullSlot', 'repriceSlot', 'flashSale', 'createBoard', 'moveThread', 'mergeBoard'], 'a successor is named in its own answer, never among the moves');
  assert.deepEqual(MOVE_KINDS.map((k) => k.shapesBoard), [true, false, false, false, false, false, false, true, false, true]);
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
    const fields = [...Object.keys((k.params as { fields: Record<string, unknown> }).fields), ...(k.derived ?? [])];
    for (const [, token] of k.plain.matchAll(/\{(\w+)\}/g)) assert.ok(fields.includes(token!), `${k.key}'s words name {${token}}, which is no param and no declared derived token`);
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


/* ------------------------------------------------------------------------- the machine's three moves ---- */

const slot = '55555555-5555-4555-8555-555555555555';

test('the machine\'s three moves are small, askable, the Boss\'s alone, and shape no board', () => {
  for (const key of ['pullSlot', 'repriceSlot', 'flashSale']) {
    const k = moveKind(key)!;
    assert.deepEqual([k.structural, k.shapesBoard, k.askable, k.offices, k.uuids], [false, false, true, ['boss'], ['slot']], key);
    assert.match(k.label, /^\{role\} [a-z ]+$/);
  }
  assert.deepEqual(Object.keys((moveKind('pullSlot')!.params as { fields: object }).fields), ['slot']);
  assert.deepEqual(Object.keys((moveKind('repriceSlot')!.params as { fields: object }).fields), ['slot', 'percent']);
  assert.deepEqual(Object.keys((moveKind('flashSale')!.params as { fields: object }).fields), ['slot', 'hours']);
});

test('the machine limits are the economy\'s machine.* numbers, the engine\'s defaults where a key is missing', () => {
  assert.deepEqual(machineLimits({}), { pullMost: 2, moveDaysMost: 7, repriceLeast: 50, repriceMost: 200, flashHoursLeast: 24, flashHoursMost: 48 });
  assert.equal(machineLimits({ 'machine.pullMost': 5 }).pullMost, 5);
  assert.equal(MACHINE_DEFAULTS['machine.pullMost'], 2);
});

test('a pull, a reprice and a flash sale keep good params, and lowercase the slot', () => {
  assert.ok(moveParamsProblems('pullSlot', { slot }).ok);
  const r = moveParamsProblems('repriceSlot', { slot: slot.replace('5555', 'AAAA'), percent: 150 });
  assert.ok(r.ok && (r.value as { slot: string }).slot === slot.replace('5555', 'aaaa'), JSON.stringify(r));
  assert.ok(moveParamsProblems('flashSale', { slot, hours: 36 }).ok);
});

test('each limit on a machine move is refused by moveParamsProblems, naming the path and the predicate', () => {
  const no = (key: string, params: unknown, limits = machineLimits({})) => {
    const r = moveParamsProblems(key, params, limits);
    assert.ok(!r.ok, `${key} ${JSON.stringify(params)} should be refused`);
    return `${r.path}:${r.predicate}`;
  };
  assert.equal(no('pullSlot', { slot: 'x'.repeat(36) }), 'slot:isUuid');
  assert.equal(no('pullSlot', {}), 'slot:required');
  assert.equal(no('repriceSlot', { slot, percent: 49 }), 'percent:atLeast(50)');
  assert.equal(no('repriceSlot', { slot, percent: 201 }), 'percent:atMost(200)');
  assert.equal(no('repriceSlot', { slot, percent: 100 }), 'percent:notOneHundred');
  assert.equal(no('repriceSlot', { slot, percent: 120.5 }), 'percent:isWhole');
  assert.equal(no('repriceSlot', { slot }), 'percent:required');
  assert.equal(no('flashSale', { slot, hours: 23 }), 'hours:atLeast(24)');
  assert.equal(no('flashSale', { slot, hours: 49 }), 'hours:atMost(48)');
  assert.equal(no('flashSale', { slot, hours: 30.5 }), 'hours:isWhole');
  // The bounds are the instance's: a retuned economy moves them.
  const wide = machineLimits({ 'machine.repriceLeast': 10, 'machine.repriceMost': 300, 'machine.flashHoursMost': 72 });
  assert.ok(moveParamsProblems('repriceSlot', { slot, percent: 20 }, wide).ok);
  assert.ok(moveParamsProblems('repriceSlot', { slot, percent: 300 }, wide).ok);
  assert.ok(moveParamsProblems('flashSale', { slot, hours: 72 }, wide).ok);
  assert.equal(no('repriceSlot', { slot, percent: 49 }, machineLimits({ 'machine.repriceLeast': 60 })), 'percent:atLeast(60)');
});

test('a pull and a markup carry a demand; a markdown and a flash sale carry none', () => {
  assert.equal(moveKind('pullSlot')!.demand({ slot }), 'required');
  assert.equal(moveKind('repriceSlot')!.demand({ slot, percent: 150 }), 'required');
  assert.equal(moveKind('repriceSlot')!.demand({ slot, percent: 50 }), 'none');
  assert.equal(moveKind('flashSale')!.demand({ slot, hours: 24 }), 'none');
  for (const k of MOVE_KINDS.filter((x) => x.askable && !x.lasting && !x.key.match(/Slot$|flashSale/))) assert.equal(k.demand({}), 'required', `${k.key} still carries a demand`);
});

test('the machine\'s moves read in plain words, with nothing unfilled and the slot named when the screen knows it', () => {
  const pull = moveKind('pullSlot')!, up = moveKind('repriceSlot')!, flash = moveKind('flashSale')!;
  for (const [k, p] of [[pull, { slot }], [up, { slot, percent: 150 }], [up, { slot, percent: 50 }], [flash, { slot, hours: 24 }]] as const) {
    assert.doesNotMatch(k.template(p, 'The Boss'), /[{}]|undefined|null/);
    assert.ok(k.template(p, 'The Boss').startsWith('The Boss '));
    assert.doesNotMatch(k.parts(p, null, 'plan').join(''), /[{}]|undefined|null/);
  }
  assert.match(up.template({ slot, percent: 150 }, 'The Boss'), /up to 150%/);
  assert.match(up.template({ slot, percent: 50 }, 'The Boss'), /down to 50%/);
  assert.deepEqual(pull.parts({ slot }, 'Whoops!', 'done'), ['Pulled ', 'Whoops!', ' from the machine']);
  assert.deepEqual(pull.parts({ slot }, 'Whoops!', 'plan'), ['Pull ', 'Whoops!', ' from the machine']);
  assert.deepEqual(pull.parts({ slot }, null, 'done'), ['Pulled ', 'a slot', ' from the machine']);
  assert.deepEqual(flash.parts({ slot, hours: 24 }, 'Main Event', 'done'), ['Opened a flash sale on ', 'Main Event', ' for 24 hours']);
});

const who = '22222222-2222-4222-8222-222222222222';

test('conferGroup is small, askable, made by the Boss or a Mod, and shapes no board', () => {
  const k = moveKind('conferGroup')!;
  assert.ok(k);
  assert.deepEqual([k.structural, k.shapesBoard, k.askable, k.offices], [false, false, true, ['boss', 'mod']]);
  assert.equal(k.label, '{role} moved a member');
  assert.equal(k.plain, 'moving a member into "{groupName}"');
  assert.deepEqual(k.derived, ['groupName']);
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

test('every move kind declares whether it is lasting; the three that build the board are', () => {
  for (const k of MOVE_KINDS) assert.equal(typeof (k as { lasting?: unknown }).lasting, 'boolean', `${k.key} declares lasting`);
  assert.deepEqual(MOVE_KINDS.filter((k) => k.lasting).map((k) => k.key), ['createBoard', 'moveThread', 'mergeBoard']);
});

test('a lasting kind carries no demand, whatever its params (a catalog invariant)', () => {
  for (const k of MOVE_KINDS.filter((x) => x.lasting)) assert.equal(k.demand({}), 'none', `${k.key} declares no demand`);
});

const thread = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const create = { name: 'Toast Corner', premise: 'Toast, and only toast.', description: 'A new board.' };

test('the three lasting board moves are the Boss\'s, askable, with no demand; two are structural and shape a board', () => {
  for (const [key, structural] of [['createBoard', true], ['moveThread', false], ['mergeBoard', true]] as const) {
    const k = moveKind(key)!;
    assert.deepEqual([k.lasting, k.structural, k.shapesBoard, k.askable, k.offices, k.demand({})], [true, structural, structural, true, ['boss'], 'none'], key);
  }
  assert.deepEqual([moveKind('createBoard')!.label, moveKind('moveThread')!.label, moveKind('mergeBoard')!.label], ['Created a board', 'Moved a thread', 'Merged a board']);
});

test('createBoard keeps good params, names an optional fallback by uuid, trims a long name and refuses a missing premise', () => {
  assert.ok(moveParamsProblems('createBoard', create).ok);
  const withFallback = moveParamsProblems('createBoard', { ...create, fallback: board.toUpperCase() });
  assert.ok(withFallback.ok && (withFallback.value as { fallback: string }).fallback === board, JSON.stringify(withFallback));
  const without = moveParamsProblems('createBoard', create);
  assert.ok(without.ok && (without.value as { fallback: unknown }).fallback === null, JSON.stringify(without));
  const bad = moveParamsProblems('createBoard', { ...create, fallback: 'x'.repeat(36) });
  assert.ok(!bad.ok && bad.path === 'fallback' && bad.predicate === 'isUuid', JSON.stringify(bad));
  const long = moveParamsProblems('createBoard', { ...create, name: 'x'.repeat(260) });
  assert.ok(long.ok && long.trims.length === 1 && long.trims[0]?.path === 'name', JSON.stringify(long));
  const missing = moveParamsProblems('createBoard', { name: 'Toast Corner', description: 'x' });
  assert.ok(!missing.ok && missing.path === 'premise', JSON.stringify(missing));
});

test('moveThread and mergeBoard name uuids; a merge of a board into itself is refused', () => {
  assert.ok(moveParamsProblems('moveThread', { thread, board }).ok);
  const noThread = moveParamsProblems('moveThread', { thread: 'x'.repeat(36), board });
  assert.ok(!noThread.ok && noThread.path === 'thread' && noThread.predicate === 'isUuid', JSON.stringify(noThread));
  assert.ok(moveParamsProblems('mergeBoard', { board, into: other }).ok);
  const same = moveParamsProblems('mergeBoard', { board, into: board.toUpperCase() });
  assert.ok(!same.ok && same.path === 'into' && same.predicate === 'differsFromBoard', JSON.stringify(same));
  const noInto = moveParamsProblems('mergeBoard', { board });
  assert.ok(!noInto.ok && noInto.path === 'into', JSON.stringify(noInto));
});

test('the three lasting board moves read in plain words, and name the boards they touch', () => {
  assert.equal(moveKind('createBoard')!.template(create, 'The Boss'), 'The Boss made a board named "Toast Corner". Its subject is: Toast, and only toast.');
  assert.deepEqual(moveKind('createBoard')!.parts(create, null, 'plan'), ['Create a board named "Toast Corner"']);
  assert.deepEqual(moveKind('createBoard')!.parts(create, null, 'done'), ['Created a board named "Toast Corner"']);
  assert.deepEqual(moveKind('moveThread')!.parts({ thread, board }, null, 'done', { board: 'General' }), ['Moved a thread to ', { board, name: 'General' }]);
  assert.deepEqual(moveKind('mergeBoard')!.parts({ board, into: other }, 'Toast', 'plan', { board: 'General' }), ['Merge ', { board, name: 'Toast' }, ' into ', { board: other, name: 'General' }]);
  for (const k of ['createBoard', 'moveThread', 'mergeBoard']) assert.doesNotMatch(moveKind(k)!.template({ ...create, thread, board, into: other }, 'The Boss'), /[{}]|undefined|null/, k);
});

test('inside a bundle a board param may be {role}, the board the part of that role makes; outside one it is refused', () => {
  const role = { role: 'minus' };
  const inside = moveParamsProblems('moveThread', { thread, board: role }, machineLimits(), true);
  assert.ok(inside.ok && JSON.stringify((inside.value as { board: unknown }).board) === JSON.stringify(role), JSON.stringify(inside));
  const outside = moveParamsProblems('moveThread', { thread, board: role });
  assert.ok(!outside.ok && outside.path === 'board' && outside.predicate === 'roleInsideBundle', JSON.stringify(outside));
  assert.ok(moveParamsProblems('createBoard', { ...create, fallback: role }, machineLimits(), true).ok, 'a fallback may name a role');
  assert.ok(moveParamsProblems('mergeBoard', { board: { role: 'fangames' }, into: role }, machineLimits(), true).ok, 'a merge may name two roles');
  assert.ok(moveParamsProblems('mergeBoard', { board, into: role }, machineLimits(), true).ok, 'a merge may name a role and a board');
  const same = moveParamsProblems('mergeBoard', { board: role, into: { role: 'minus' } }, machineLimits(), true);
  assert.ok(!same.ok && same.path === 'into' && same.predicate === 'differsFromBoard', 'a board is never merged into itself, even by role: ' + JSON.stringify(same));
});

test('a role is a name and nothing more, and never stands for a thread or a board of a move that does not build the board', () => {
  const asThread = moveParamsProblems('moveThread', { thread: { role: 'minus' }, board }, machineLimits(), true);
  assert.ok(!asThread.ok && asThread.path === 'thread', JSON.stringify(asThread));
  for (const bad of [{ role: '' }, { role: 'Minus' }, { role: 'a'.repeat(41) }, { role: 7 }, { role: 'minus', beat: 'Split' }, { role: 'minus', beat: 7 }, { role: 'minus', beat: 'split', extra: 1 }, { beat: 'split' }, {}, { name: 'minus' }]) {
    const r = moveParamsProblems('moveThread', { thread, board: bad }, machineLimits(), true);
    assert.ok(!r.ok && r.path === 'board', `${JSON.stringify(bad)} is no role: ${JSON.stringify(r)}`);
  }
  // A role of an earlier beat's bundle (Task 6) is a role: {role, beat}, the beat written as a key is.
  assert.ok(moveParamsProblems('moveThread', { thread, board: { role: 'minus', beat: 'split' } }, machineLimits(), true).ok);
  const rename = moveParamsProblems('renameBoard', { board: { role: 'minus' }, name: 'x', premise: 'y', description: 'z' }, machineLimits(), true);
  assert.ok(!rename.ok && rename.path === 'board', JSON.stringify(rename));
});

test('a part that names a role reads in plain words without a link to a board that is not there yet', () => {
  const parts = moveKind('moveThread')!.parts({ thread, board: { role: 'minus' } }, null, 'plan');
  assert.deepEqual(parts, ['Move a thread to ', 'the board the part "minus" makes']);
  assert.deepEqual(moveKind('mergeBoard')!.parts({ board: { role: 'b' }, into: { role: 'a' } }, null, 'plan'), ['Merge ', 'the board the part "b" makes', ' into ', 'the board the part "a" makes']);
  assert.doesNotMatch(moveKind('moveThread')!.template({ thread, board: { role: 'minus' } }, 'The Boss'), /[{}]|undefined|null|\[object/);
});
