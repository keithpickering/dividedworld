import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemSettings, testSystem } from '../rules/test-system.ts';
import { DEMAND_KINDS } from './demands.ts';
import { DEMAND_ID_ROLES, MEETING_RULE, inheritedText, meetingSystemPrompt, namedCharacters, repairAnswer, ruleSchema, type InheritedMove, type RepairContext } from './meeting.ts';
import { noteMost } from './memory.ts';
import { phaseAt } from './phases.ts';

const H = 3_600_000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const BOARD = '11111111-1111-4111-8111-111111111111';
const OTHER_BOARD = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const OTHER_THREAD = '44444444-4444-4444-8444-444444444444';
const ANN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HIDDEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const settings = { ...systemSettings, reactionCap: 3 };

const ctx = (): RepairContext => ({
  // The engine's own fixture, never an instance's content ("KayfaBB never knows which instance it runs").
  settings: settings,
  system: testSystem,
  boss: testSystem.firstBoss,
  phase: phaseAt({ startsAt: NOW - 30 * 24 * H, endsAt: NOW + 60 * 24 * H }, NOW, settings),
  bank: 5,
  now: NOW,
  boards: new Set([BOARD]),
  threads: new Set([THREAD]),
  isPublic: (id) => id === ANN || id === BOB,
  successorAllowed: false,
  successors: new Set(['some-boss']),
  mods: new Set(),
  rules: [],
});
const move = (demand: unknown) => ({
  kind: 'renameBoard',
  params: { board: BOARD, name: 'Pirate Puns Palace', premise: 'Everything about puns.' },
  demand,
  go_live_at: new Date(NOW + 30 * H).toISOString(),
  expires_in_hours: 72,
  why: 'Because.',
});
const answer = (demand: unknown) => ({
  memory: { hobby: { name: 'pro wrestling', since: '2026-11-01', from: 'Ann' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [] },
  profile: { interests: [], favorites: [], mood: 'smug', signature: 'It is decided.' },
  moves: [move(demand)],
});
const kept = (demand: unknown) => {
  const r = repairAnswer(answer(demand), ctx());
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};

test('a demand naming a real board, thread and public characters is kept', () => {
  assert.equal(kept({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } }).moves.length, 1);
  assert.equal(kept({ kind: 'characterPostsInThread', params: { character: ANN, thread: THREAD, count: 3 } }).moves.length, 1);
});

test('a demand naming a board that is not in the meeting\'s list is dropped and recorded', () => {
  const r = kept({ kind: 'postsOnBoard', params: { board: OTHER_BOARD, count: 5 } });
  assert.equal(r.moves.length, 0);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].demand.params.board' && t.predicate === 'isBoard'), JSON.stringify(r.trims));
});

test('a demand naming a thread the model was not given is dropped and recorded', () => {
  const r = kept({ kind: 'characterPostsInThread', params: { character: ANN, thread: OTHER_THREAD, count: 3 } });
  assert.equal(r.moves.length, 0);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].demand.params.thread' && t.predicate === 'isThread'), JSON.stringify(r.trims));
});

test('a demand naming a character who is not public now is dropped and recorded', () => {
  const r = kept({ kind: 'crossQuote', params: { a: ANN, b: HIDDEN, reactions: 99 } });
  assert.equal(r.moves.length, 0);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].demand.params.b' && t.predicate === 'publicCharacter'), JSON.stringify(r.trims));
});

test('the characters a demand names are among those the meeting asks the database about', () => {
  const ids = namedCharacters(answer({ kind: 'crossQuote', params: { a: ANN, b: HIDDEN, reactions: 99 } }));
  assert.deepEqual(ids.sort(), [ANN, HIDDEN]);
});

test('every uuid a demand kind takes has a role the repair checks', () => {
  for (const d of DEMAND_KINDS) for (const name of d.uuids) assert.ok(DEMAND_ID_ROLES[name], `${d.key}.${name} has no role in DEMAND_ID_ROLES`);
});

test('a nomination is not a move the Boss may propose, and the prompt does not offer it as one', () => {
  const r = repairAnswer({ ...answer({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } }), moves: [{ ...move({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } }), kind: 'nameSuccessor', params: { boss: 'someone' } }] }, ctx());
  assert.ok(r.ok);
  assert.equal(r.moves.length, 0);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].kind' && t.predicate === 'oneOf(renameBoard, setRule, conferGroup)'), JSON.stringify(r.trims));
});

test('a demand only the code sets is dropped when the Boss chooses it, and recorded', () => {
  const r = repairAnswer(answer({ kind: 'apologyAccepted', params: {} }), ctx());
  assert.ok(r.ok);
  assert.equal(r.moves.length, 0);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].demand.kind' && t.predicate.startsWith('oneOf(postsOnBoard')), JSON.stringify(r.trims));
});

test('an inheritance answer must name a move the Boss was shown, when it was shown a list', () => {
  const shown = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const unseen = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const raw = { ...answer({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } }), inherited: [{ move_act: shown.toUpperCase(), decision: 'keep' }, { move_act: unseen, decision: 'end' }] };
  const r = repairAnswer(raw, { ...ctx(), inheritable: new Set([shown]) });
  assert.ok(r.ok);
  assert.deepEqual(r.inherited.map((x) => x.move_act), [shown.toUpperCase()]);
  assert.ok(r.trims.some((t) => t.path === 'inherited[1].move_act' && t.predicate === 'inheritedMove'));
  const none = repairAnswer(raw, { ...ctx(), inheritable: new Set() });
  assert.ok(none.ok && none.inherited.length === 0);
});

test('the inheritance section is in plain words, says reviewing is free and what happens to an unanswered move, and is empty when nothing is due', () => {
  const due: InheritedMove = { act: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', kind: 'renameBoard', params: { board: BOARD, name: 'Pie Place' }, landedAt: '2026-10-20T09:00:00Z', expiresAt: null, by: 'The Old Boss', boardName: 'General' };
  const text = inheritedText([due], 1).join('\n');
  assert.match(text, /Renamed General to Pie Place \(by The Old Boss, since 2026-10-20\)/);
  assert.match(text, /Neither costs a move from your bank/);
  assert.match(text, /1 day after the handover/);
  assert.deepEqual(inheritedText([], 3), []);
});

test('the system prompt carries the Boss\'s career as plain facts, and says so when there is none', () => {
  const facts = {
    boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [],
  };
  const served = meetingSystemPrompt({ ...facts, career: { led: [{ season: 3, since: '2026-04-01T00:00:00+00:00', until: null, how: 'nomination' }], offices: [] } });
  assert.ok(served.includes('Your career, as plain facts'), served);
  assert.ok(served.includes('Boss in Season 3, from 2026-04-01 until now'), served);
  assert.ok(meetingSystemPrompt({ ...facts, career: { led: [], offices: [] } }).includes('You have held no office before.'));
});

test('the Boss\'s recent notes are in the prompt as its own thoughts, capped at notesRead with the newest kept, and the section is absent when there are none', () => {
  const facts = {
    boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [],
    career: { led: [], offices: [] },
  };
  const notes = Array.from({ length: settings.pool.notesRead + 3 }, (_, i) => `thought number ${i + 1}`);
  const served = meetingSystemPrompt({ ...facts, notes });
  assert.match(served, /your own recent thoughts/);
  assert.ok(served.includes(`thought number ${notes.length}`), 'the newest note is kept');
  assert.ok(served.includes('thought number 4'), 'the oldest note inside the cap is kept');
  assert.ok(!served.includes('thought number 3\n') && !/thought number 3$/m.test(served), 'a note past the cap is cut from the old end');
  assert.ok(served.indexOf('thought number 4') < served.indexOf(`thought number ${notes.length}`), 'oldest first');
  const none = meetingSystemPrompt({ ...facts, notes: [] });
  assert.ok(!none.includes('your own recent thoughts'), none);
});

test('noteMost is the 280 the database check holds', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/0085_staff_notes.sql', import.meta.url), 'utf8');
  assert.equal(noteMost, 280);
  assert.match(sql, new RegExp(`between 1 and ${noteMost}\\b`));
});

test('the rule\'s schema lists description among the rename\'s params, and the prompt says it is the Boss\'s own words', () => {
  const schema = ruleSchema(MEETING_RULE) as any;
  const params = schema.properties.moves.items.properties.params;
  assert.ok('description' in params.properties, JSON.stringify(Object.keys(params.properties)));
  assert.ok(!params.required.includes('description'), 'optional: a Boss that gives none gets the stock line');
  const prompt = meetingSystemPrompt({ boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] } });
  const rename = prompt
    .split('\n').find((l) => l.startsWith('- renameBoard'))!;
  assert.match(rename, /description \(text\)/);
  assert.match(prompt, /renameBoard description is your own words, in character/);
});

test('a description the Boss writes is kept, one over 2000 is trimmed with a record, and a blank one is left out', () => {
  const withDescription = (description: unknown) => {
    const a = answer({ kind: 'postsOnBoard', params: { board: BOARD, count: 10 } });
    (a.moves[0] as any).params = { ...(a.moves[0] as any).params, description };
    return repairAnswer(a, ctx());
  };
  const said = withDescription('Pirates park puns here.');
  assert.ok(said.ok && said.moves[0]!.params['description'] === 'Pirates park puns here.');
  const long = withDescription('d'.repeat(2400));
  assert.ok(long.ok && (long.moves[0]!.params['description'] as string).length === 2000);
  assert.ok(long.ok && long.trims.some((t) => t.path === 'moves[0].params.description' && t.predicate === 'maxLength(2000)' && t.before === 2400 && t.after === 2000), JSON.stringify(long.ok && long.trims));
  for (const blank of ['', '  ', undefined]) {
    const r = withDescription(blank);
    assert.ok(r.ok && r.moves.length === 1 && !('description' in r.moves[0]!.params), JSON.stringify(r));
  }
});

const ruleMove = (params: unknown) => ({ ...move({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } }), kind: 'setRule', params });
const ruleAnswer = (params: unknown) => ({ ...answer(null), moves: [ruleMove(params)] });

test('a setRule on a listed board, or on every board, is kept; a numeric param stays a number', () => {
  const on = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'minLength', param: 20, band: 'minor' }), ctx());
  assert.ok(on.ok && on.moves.length === 1, JSON.stringify(on));
  assert.deepEqual(on.ok && on.moves[0]!.params, { board: BOARD, predicate: 'minLength', param: 20, band: 'minor' });
  const all = repairAnswer(ruleAnswer({ predicate: 'noDoublePost', band: 'severe' }), ctx());
  assert.ok(all.ok && all.moves.length === 1, JSON.stringify(all));
  assert.equal(all.ok && all.moves[0]!.params['board'], null);
});

test('a setRule on a board outside the meeting\'s list, or with a param its predicate refuses, is dropped and recorded', () => {
  const off = repairAnswer(ruleAnswer({ board: OTHER_BOARD, predicate: 'noDoublePost', band: 'minor' }), ctx());
  assert.ok(off.ok && off.moves.length === 0 && off.trims.some((t) => t.path === 'moves[0].params.board' && t.predicate === 'isBoard'), JSON.stringify(off));
  const high = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'minLength', param: 9000, band: 'minor' }), ctx());
  assert.ok(high.ok && high.moves.length === 0 && high.trims.some((t) => t.path === 'moves[0].params.param' && t.predicate === 'atMost(200)'), JSON.stringify(high));
});

test('the prompt lists the predicates a rule may use', () => {
  const text = meetingSystemPrompt({ boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] } });
  assert.match(text, /setRule: set a rule/);
  for (const key of ['minLength', 'noDoublePost', 'repliesOnly']) assert.ok(text.includes(key), key);
});

/* ------------------------------------------------------------------ orders, patrols and the Mods' memory (Mod Bots plan, Task 4) ---- */

const M1 = 'mod-one';
const M2 = 'mod-two';
const M3 = 'mod-three';
const B2 = '55555555-5555-4555-8555-555555555555';
const B3 = '66666666-6666-4666-8666-666666666666';
const modCtx = (extra: Partial<RepairContext> = {}): RepairContext => ({ ...ctx(), mods: new Set([M1, M2, M3]), boards: new Set([BOARD, B2, B3]), ...extra });
const order = (mod: string, boards: string[], allowance: number, extra: Record<string, unknown> = {}) => ({ mod, boards, order: `Watch ${mod}'s boards.`, allowance, ...extra });
const withOrders = (orders: unknown[], extra: Record<string, unknown> = {}) => ({ ...answer(null), moves: [], orders, ...extra });
const memoryOf = (hobby: string, extra: Record<string, unknown> = {}) => ({ hobby: { name: hobby, since: '2026-11-01', from: 'Ann' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [], ...extra });

test('an order for a key not on staff is dropped and recorded; the orders of the Mods on staff are kept', () => {
  const r = repairAnswer(withOrders([order(M1, [BOARD], 1), order('nobody', [B2], 1)]), modCtx());
  assert.ok(r.ok);
  assert.deepEqual(r.orders.map((o) => o.mod), [M1]);
  assert.ok(r.trims.some((t) => t.path === 'orders[1].mod' && t.predicate === 'modOnStaff'), JSON.stringify(r.trims));
  const twice = repairAnswer(withOrders([order(M1, [BOARD], 1), order(M1, [B2], 2)]), modCtx());
  assert.ok(twice.ok && twice.orders.length === 1 && twice.orders[0]!.boards[0] === BOARD);
  assert.ok(twice.ok && twice.trims.some((t) => t.path === 'orders[1].mod' && t.predicate === 'uniqueMod'));
});

test('a board that is not a board is dropped from an order, and a board named in two orders stays with the first', () => {
  const r = repairAnswer(withOrders([order(M1, [BOARD, OTHER_BOARD, B2], 0), order(M2, [B2, B3, B3], 0)]), modCtx());
  assert.ok(r.ok);
  assert.deepEqual(r.orders.map((o) => o.boards), [[BOARD, B2], [B3]]);
  assert.ok(r.trims.some((t) => t.path === 'orders[0].boards[1]' && t.predicate === 'isBoard'), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'orders[1].boards[0]' && t.predicate === 'uniqueBoard'));
  assert.ok(r.trims.some((t) => t.path === 'orders[1].boards[2]' && t.predicate === 'uniqueBoard'), 'a board named twice in one order is once');
  // A board named by an order dropped for its key is not claimed.
  const free = repairAnswer(withOrders([order('nobody', [BOARD], 1), order(M1, [BOARD], 0)]), modCtx());
  assert.ok(free.ok && free.orders[0]!.boards[0] === BOARD);
});

test('an allowance is made whole and clamped to allowanceMost with a trim, never rejected', () => {
  const r = repairAnswer(withOrders([order(M1, [], 9), order(M2, [], 1.7), order(M3, [], -2)]), modCtx({ bank: 20 }));
  assert.ok(r.ok);
  assert.deepEqual(r.orders.map((o) => o.allowance), [3, 1, 0]);
  assert.ok(r.trims.some((t) => t.path === 'orders[0].allowance' && t.predicate === 'atMost(3)' && t.before === 9 && t.after === 3), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'orders[1].allowance' && t.predicate === 'wholeNumberAtLeast(0)' && t.before === 1.7 && t.after === 1));
  assert.ok(r.trims.some((t) => t.path === 'orders[2].allowance' && t.before === -2 && t.after === 0));
});

test('the allowances together are cut from the last order backward to what the bank holds after the Boss\'s own moves', () => {
  const rename = (i: number) => ({ ...move({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } }), params: { board: BOARD, name: `Pirate Puns Palace ${'Q'.repeat(i)}`, premise: 'x' } });
  // A bank of 5 less one move leaves 4 for three orders asking 3 + 2 + 3.
  const r = repairAnswer(withOrders([order(M1, [], 3), order(M2, [], 2), order(M3, [], 3)], { moves: [rename(0)] }), modCtx({ bank: 5 }));
  assert.ok(r.ok);
  assert.equal(r.moves.length, 1);
  assert.deepEqual(r.orders.map((o) => o.allowance), [3, 1, 0]);
  assert.ok(r.trims.some((t) => t.path === 'orders[2].allowance' && t.predicate === 'withinBank' && t.before === 3 && t.after === 0), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'orders[1].allowance' && t.predicate === 'withinBank' && t.before === 2 && t.after === 1));
  assert.ok(!r.trims.some((t) => t.path === 'orders[0].allowance' && t.predicate === 'withinBank'), 'the first order is not touched while the later ones can pay');
  // The Boss's own moves come first: a bank of 1 and a move leaves nothing to hand out.
  const none = repairAnswer(withOrders([order(M1, [], 2)], { moves: [rename(0)] }), modCtx({ bank: 1.9 }));
  assert.ok(none.ok && none.moves.length === 1 && none.orders[0]!.allowance === 0);
});

test('an order may carry a new memory, repaired as the Boss\'s is (a character not public dropped, recorded under the order); one without leaves the Mod\'s memory alone', () => {
  const r = repairAnswer(withOrders([
    order(M1, [BOARD], 1, { memory: memoryOf('crosswords', { opinions: [{ character: ANN, score: 9, note: 'Fair.' }, { character: HIDDEN, score: 1, note: 'Who?' }] }) }),
    order(M2, [B2], 1),
  ]), modCtx());
  assert.ok(r.ok);
  assert.equal(r.orders[0]!.memory?.hobby.name, 'crosswords');
  assert.deepEqual(r.orders[0]!.memory?.opinions.map((o) => [o.character, o.score]), [[ANN, 5]], 'public only, scored within -5..5');
  assert.ok(r.trims.some((t) => t.path === 'orders[0].memory.opinions[1]' && t.predicate === 'publicCharacter'), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'orders[0].memory.opinions[0].score'));
  assert.equal(r.orders[1]!.memory, null);
  assert.deepEqual(namedCharacters(withOrders([order(M1, [], 0, { memory: memoryOf('x', { opinions: [{ character: HIDDEN, score: 1, note: '.' }], grudges: [{ character: BOB, note: '.' }] }) })])).sort(), [BOB, HIDDEN]);
});

test('an answer with no orders and no patrols is whole: the database carries each Mod\'s beat and order, and the Boss need not answer them', () => {
  const r = repairAnswer(answer({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } }), modCtx());
  assert.ok(r.ok && r.orders.length === 0 && r.patrols.length === 0);
});

test('patrols for a Mod not on staff or at no time are dropped, a time is moved into today, and past patrolsPerDay they are cut from the end', () => {
  const most = settings.modBots.patrolsPerDay;
  const at = (h: number) => new Date(NOW + h * H).toISOString();
  const raw = withOrders([], { patrols: [{ mod: 'nobody', at: at(1) }, { mod: M1, at: 'noon-ish' }, { mod: M1, at: at(-5) }, { mod: M2, at: at(90) }, ...Array.from({ length: most + 2 }, (_, i) => ({ mod: M3, at: at(i + 1) }))] });
  const r = repairAnswer(raw, modCtx());
  assert.ok(r.ok);
  assert.equal(r.patrols.length, most);
  assert.deepEqual(r.patrols.slice(0, 2), [{ mod: M1, at: at(0) }, { mod: M2, at: at(24) }], 'the past is now, the far future a day on');
  assert.ok(r.trims.some((t) => t.path === 'patrols[0].mod' && t.predicate === 'modOnStaff'));
  assert.ok(r.trims.some((t) => t.path === 'patrols[1].at' && t.predicate === 'isTime'));
  assert.ok(r.trims.some((t) => t.path === 'patrols' && t.predicate === `atMost(${most})` && t.before === most + 2 + 2 && t.after === most), JSON.stringify(r.trims));
});

const inForce = [{ board: BOARD, predicate: 'bannedWord', param: 'toast', number: 2 }, { board: null, predicate: 'minLength', param: 100, number: 1 }];

test('a rule that conflicts with the rules in force is dropped and recorded, and spends nothing', () => {
  const clash = ruleMove({ board: BOARD, predicate: 'requiredWord', param: 'Toast', band: 'minor' });
  const houseClash = ruleMove({ board: B2, predicate: 'maxLength', param: 50, band: 'minor' });
  const fine = ruleMove({ board: BOARD, predicate: 'noAllCaps', band: 'minor' });
  const r = repairAnswer({ ...answer(null), moves: [clash, houseClash, fine] }, modCtx({ rules: inForce, bank: 1 }));
  assert.ok(r.ok);
  assert.deepEqual(r.moves.map((m) => m.params['predicate']), ['noAllCaps'], 'the bank of one still pays for the rule that is whole');
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params' && t.predicate === 'compliantPost(Rule 2 bans the word "toast", which this rule would require)'), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'moves[1].params' && t.predicate.startsWith('compliantPost(a house rule requires at least 100 characters')), JSON.stringify(r.trims));
  assert.ok(!r.trims.some((t) => t.path === 'moves' && t.predicate.startsWith('atMost')), 'nothing was cut by the bank');
  // A rule on a board the rules in force do not reach is whole.
  const other = repairAnswer({ ...answer(null), moves: [ruleMove({ board: B2, predicate: 'requiredWord', param: 'toast', band: 'minor' })] }, modCtx({ rules: [inForce[0]!] }));
  assert.ok(other.ok && other.moves.length === 1);
});

test('the prompt shows each Mod: its name, career, beat preferences, pet rules, temperament, notes, memory and what it spent; and which kinds a Mod may make', () => {
  const mod = {
    key: M1, name: 'Sir Patrols-a-Lot', temperament: 'fussy about bumps', beats: ['games', 'general'], petRules: ['noDoublePost'],
    career: { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00+00:00', until: null, cause: 'seed' }] }, notes: ['Saw a bump in Games.'],
    memory: memoryOf('birdwatching', { opinions: [{ character: ANN, score: 2, note: 'Polite.' }] }),
    granted: 3, unspent: 1, boards: [{ id: BOARD, name: 'Mario Fan Games' }], order: 'Crack down on bumping.',
  };
  const facts = { boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] }, characterName: (id: string) => (id === ANN ? 'Ann the Great' : 'someone') };
  const text = meetingSystemPrompt({ ...facts, mods: [mod] });
  for (const piece of ['Sir Patrols-a-Lot', `key ${M1}`, 'Mod Bot from 2026-10-01', 'games, general', 'noDoublePost', 'fussy about bumps', 'Saw a bump in Games.', 'birdwatching', 'Ann the Great 2', 'it spent 2 and 1 goes back to your bank', `Mario Fan Games (${BOARD})`, 'Crack down on bumping.']) {
    assert.ok(text.includes(piece), `${piece} is in the prompt`);
  }
  assert.match(text, /setRule[^\n]*Made by the Boss or a Mod Bot/);
  assert.match(text, /renameBoard[^\n]*Made by the Boss\./);
  assert.match(text, /\(setRule, conferGroup; every other kind stays yours\)/);
  assert.match(text, /a rule a Mod sets lasts at most 7 days/);
  assert.match(text, /at most 6 patrols/);
  assert.ok(!/owner|class|reactor/i.test(text.slice(text.indexOf('Your Mod Bots.'), text.indexOf('Answer only'))), 'nothing about who owns a mask, a class or a reactor');
  assert.match(meetingSystemPrompt({ ...facts, mods: [] }), /You have no Mod Bots on staff\. Do not answer with orders or patrols\./);
  const fresh = meetingSystemPrompt({ ...facts, mods: [{ ...mod, granted: null, unspent: 0, memory: null, order: null, boards: [], notes: [] }] });
  assert.match(fresh, /You have never handed it an allowance/);
  assert.match(fresh, /It has no memory yet/);
  assert.match(fresh, /Its beat is empty now/);
});

test('the rule\'s schema offers orders and patrols, both optional, and an order\'s memory is optional', () => {
  const schema = ruleSchema(MEETING_RULE) as any;
  assert.ok('orders' in schema.properties && 'patrols' in schema.properties);
  assert.ok(!schema.required.includes('orders') && !schema.required.includes('patrols'));
  const item = schema.properties.orders.items;
  assert.deepEqual([...item.required].sort(), ['mod']);
  assert.ok('memory' in item.properties);
});

test('an order with no line, no boards and no allowance is kept, not a reason to reject the answer', () => {
  const r = repairAnswer(withOrders([{ mod: M1 }, { mod: M2, order: '', boards: [] }]), modCtx());
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.orders.map((o) => [o.mod, o.boards, o.order, o.allowance]), [[M1, [], '', 0], [M2, [], '', 0]]);
});
