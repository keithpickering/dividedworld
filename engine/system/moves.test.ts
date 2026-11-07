import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASKABLE_MOVE_KINDS, MOVE_KINDS, machineLimits, moveKind, moveParamsProblems } from './moves.ts';
import { MACHINE_DEFAULTS } from '../rules/packs.ts';

const board = '11111111-1111-4111-8111-111111111111';
const rename = { board, name: 'Pointless Toast Palace', premise: 'Toast, and only toast.', description: 'A 2003 board index.' };

test('the catalog holds renameBoard, structural, with a long plain label', () => {
  assert.deepEqual(MOVE_KINDS.map((k) => [k.key, k.structural]), [['renameBoard', true], ['nameSuccessor', true], ['setRule', false], ['pullSlot', false], ['repriceSlot', false], ['flashSale', false]]);
  assert.deepEqual(ASKABLE_MOVE_KINDS.map((k) => k.key), ['renameBoard', 'setRule', 'pullSlot', 'repriceSlot', 'flashSale'], 'a successor is named in its own answer, never among the moves');
  assert.deepEqual(MOVE_KINDS.map((k) => k.shapesBoard), [true, false, false, false, false, false]);
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
  for (const k of MOVE_KINDS.filter((x) => x.askable && !x.key.match(/Slot$|flashSale/))) assert.equal(k.demand({}), 'required', `${k.key} still carries a demand`);
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
