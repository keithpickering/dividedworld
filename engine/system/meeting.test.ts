import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemSettings, testSystem } from '../rules/test-system.ts';
import { DEMAND_KINDS } from './demands.ts';
import { DEMAND_ID_ROLES, MEETING_RULE, inheritedText, meetingSystemPrompt, namedCharacters, referenceText, repairAnswer, ruleSchema, type InheritedMove, type MachineSlotFacts, type RepairContext } from './meeting.ts';
import { noteMost } from './memory.ts';
import { phaseAt } from './phases.ts';
import { personaPrompt } from './prompt.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';
import { BEAT_WORDS, BUNDLE_WORDS, shownBeats, type ArcRead } from './beats.ts';
import type { Beat, Persona } from '../rules/types.ts';

const H = 3_600_000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const BOARD = '11111111-1111-4111-8111-111111111111';
const OTHER_BOARD = '22222222-2222-4222-8222-222222222222';
const THREAD = '33333333-3333-4333-8333-333333333333';
const OTHER_THREAD = '44444444-4444-4444-8444-444444444444';
const ANN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HIDDEN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HIDDEN2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';

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
  groups: {
    conferred: new Map([['trialMembers', 'punishment'], ['teachersPet', 'favor']]),
    capped: new Set([HIDDEN]),
    held: new Set([BOB]),
  },
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
  assert.ok(r.trims.some((t) => t.path === 'moves[0].kind' && t.predicate === 'oneOf(renameBoard, setRule, conferGroup, pullSlot, repriceSlot, flashSale, createBoard, moveThread, mergeBoard)'), JSON.stringify(r.trims));
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
    boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [],
  };
  const served = meetingSystemPrompt({ ...facts, career: { led: [{ season: 3, since: '2026-04-01T00:00:00+00:00', until: null, how: 'nomination' }], offices: [] } });
  assert.ok(served.includes('Your career, as plain facts'), served);
  assert.ok(served.includes('Boss in Season 3, from 2026-04-01 until now'), served);
  assert.ok(meetingSystemPrompt({ ...facts, career: { led: [], offices: [] } }).includes('You have held no office before.'));
});

test('the Boss\'s recent notes are in the prompt as its own thoughts, capped at notesRead with the newest kept, and the section is absent when there are none', () => {
  const facts = {
    boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [],
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
  const prompt = meetingSystemPrompt({ boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] } });
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
  const text = meetingSystemPrompt({ boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] } });
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
    key: M1, name: 'Sir Patrols-a-Lot', pronouns: PRONOUN_PRESETS.they, temperament: 'fussy about bumps', beats: ['games', 'general'], petRules: ['noDoublePost'],
    career: { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00+00:00', until: null, cause: 'seed' }] }, notes: ['Saw a bump in Games.'],
    memory: memoryOf('birdwatching', { opinions: [{ character: ANN, score: 2, note: 'Polite.' }] }),
    granted: 3, unspent: 1, boards: [{ id: BOARD, name: 'Mario Fan Games' }], order: 'Crack down on bumping.',
  };
  const facts = { boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] }, characterName: (id: string) => (id === ANN ? 'Ann the Great' : 'someone') };
  const text = meetingSystemPrompt({ ...facts, mods: [mod] });
  for (const piece of ['Sir Patrols-a-Lot', `key ${M1}`, 'Mod Bot from 2026-10-01', 'games, general', 'noDoublePost', 'fussy about bumps', 'Saw a bump in Games.', 'birdwatching', 'Ann the Great 2', 'they spent 2 and 1 goes back to your bank', `Mario Fan Games (${BOARD})`, 'Crack down on bumping.']) {
    assert.ok(text.includes(piece), `${piece} is in the prompt`);
  }
  assert.match(text, /setRule[^\n]*Made by the Boss or a Mod Bot/);
  assert.match(text, /renameBoard[^\n]*Made by the Boss\./);
  assert.match(text, /\(setRule, conferGroup punishments; every other kind stays yours\)/);
  assert.match(text, /a rule a Mod sets lasts at most 7 days/);
  assert.match(text, /at most 6 patrols/);
  assert.ok(!/owner|class|reactor/i.test(text.slice(text.indexOf('Your Mod Bots.'), text.indexOf('Answer only'))), 'nothing about who owns a mask, a class or a reactor');
  assert.match(meetingSystemPrompt({ ...facts, mods: [] }), /You have no Mod Bots on staff\. Do not answer with orders or patrols\./);
  const fresh = meetingSystemPrompt({ ...facts, mods: [{ ...mod, granted: null, unspent: 0, memory: null, order: null, boards: [], notes: [] }] });
  assert.match(fresh, /You have never handed them an allowance/);
  assert.match(fresh, /They have no memory yet; write their first\./);
  assert.match(fresh, /Their beat is empty now/);
});

test('a Mod\'s section is written with its own pronouns: they/them reads "Their beat now", it/its "Its beat now", and the heading and the roster carry the label', () => {
  const mod = {
    key: M1, name: 'Sir Patrols-a-Lot', pronouns: PRONOUN_PRESETS.they, temperament: 'fussy', beats: [], petRules: [],
    career: { led: [], offices: [] }, notes: ['Saw a bump.'], memory: memoryOf('birdwatching'),
    granted: 3, unspent: 1, boards: [{ id: BOARD, name: 'Mario Fan Games' }], order: 'Crack down on bumping.',
  };
  const facts = { boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: true, roster: [{ key: 'mod-x', name: 'Xe', pronouns: PRONOUN_PRESETS.he }], notes: [], career: { led: [], offices: [] }, characterName: () => 'someone' };
  const they = meetingSystemPrompt({ ...facts, mods: [mod] });
  assert.ok(they.includes('## Sir Patrols-a-Lot (they/them, key mod-one)'), 'the heading');
  for (const line of ['They have held no office before.', 'You last handed them 3 moves; they spent 2', 'Their beat now: Mario Fan Games', 'Your standing order to them: Crack down', 'Their memory: hobby birdwatching', 'Their notes since their last memory (their own thoughts;']) assert.ok(they.includes(line), line);
  const it = meetingSystemPrompt({ ...facts, mods: [{ ...mod, pronouns: PRONOUN_PRESETS.it }] });
  for (const line of ['## Sir Patrols-a-Lot (it/its, key mod-one)', 'It has held no office before.', 'You last handed it 3 moves; it spent 2', 'Its beat now: Mario Fan Games', 'Its notes since its last memory (its own thoughts;']) assert.ok(it.includes(line), line);
  assert.ok(they.includes(`${personaPrompt(testSystem, testSystem.roster[0]!, 'boss')}\n\nYour pronouns are she/her (she, her, her, hers, herself).`), 'the self line follows the persona');
  assert.ok(they.includes('mod-x (Xe, he/him)'), 'the successors\' roster');
  const section = they.slice(they.indexOf('## Sir Patrols-a-Lot'), they.indexOf('The season is in its last week'));
  assert.ok(!/ its |\bIt \b/.test(section), section);
});

test('the Boss\'s prompt opens with the Boss premise, holds the Boss\'s office line, and no other office\'s premise or line', () => {
  const facts = { boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: true, roster: [], notes: [], career: { led: [], offices: [] }, characterName: () => 'someone', mods: [] };
  const text = meetingSystemPrompt(facts);
  assert.ok(text.startsWith(testSystem.offices.boss.premise), 'opens with the Boss premise');
  assert.ok(text.includes(testSystem.roster[0]!.officeLines!.boss!), 'the Boss line');
  for (const other of ['Mod premise.', 'Member premise.', 'You used to run the place.']) assert.ok(!text.includes(other), other);
});

test('the inheritance section names no pronoun for the Boss before', () => {
  const due: InheritedMove = { act: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', kind: 'renameBoard', params: { board: BOARD, name: 'Pie Place' }, landedAt: '2026-10-20T09:00:00Z', expiresAt: null, by: 'The Old Boss', boardName: 'General' };
  const text = inheritedText([due], 1).join('\n');
  assert.match(text, /These moves, made by the Boss before you, are still in force\./);
  assert.ok(!/of theirs/.test(text));
});

test('the ids the model may use write each character as Name (label)', () => {
  const text = referenceText({ boards: [], threads: [], characters: [{ id: ANN, name: 'Gloomba', pronouns: PRONOUN_PRESETS.she }, { id: BOB, name: 'Zed', pronouns: PRONOUN_PRESETS.they }] });
  assert.ok(text.includes(`- Gloomba (she/her): ${ANN}`) && text.includes(`- Zed (they/them): ${BOB}`), text);
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

/* ------------------------------------------------------------------------- the machine's moves ---- */

const SLOT_A = '51000000-0000-4000-8000-00000000000a';
const SLOT_B = '51000000-0000-4000-8000-00000000000b';
const SLOT_C = '51000000-0000-4000-8000-00000000000c';
const SLOT_PACK = '51000000-0000-4000-8000-0000000000ff';
const SLOT_HIDDEN = '51000000-0000-4000-8000-000000000011';
const SLOT_OUT = '51000000-0000-4000-8000-000000000022';
const facts = (id: string, over: Partial<MachineSlotFacts> = {}): MachineSlotFacts => ({ id, position: 1, card: 'whoops', pack: null, availability: 'onSale', price: 100, pullable: true, move: null, ...over });
const SHELF: MachineSlotFacts[] = [
  facts(SLOT_A), facts(SLOT_B, { card: 'dud' }), facts(SLOT_C, { card: 'trap' }),
  facts(SLOT_PACK, { card: null, pack: 'booster', price: 300, pullable: false }),
  facts(SLOT_HIDDEN, { card: 'main-event', availability: 'hidden', pullable: false }),
  facts(SLOT_OUT, { card: 'glitter', availability: 'soldOut', pullable: false }),
];
const withMachine = (machine: readonly MachineSlotFacts[] | undefined = SHELF): RepairContext => ({ ...ctx(), machine });
const PULL_DEMAND = { kind: 'postsOnBoard', params: { board: BOARD, count: 5 } };
const machineMove = (kind: string, params: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  kind, params, demand: PULL_DEMAND, go_live_at: new Date(NOW + 2 * H).toISOString(), expires_in_hours: 72, why: 'Because.', ...extra,
});
const withMoves = (...moves: unknown[]) => ({ ...answer(PULL_DEMAND), moves });
const plan = (moves: unknown[], c: RepairContext = withMachine()) => {
  const r = repairAnswer(withMoves(...moves), c);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const dropped = (r: ReturnType<typeof plan>, path: string, predicate: string) => assert.ok(r.trims.some((t) => t.path === path && t.predicate === predicate), `${path} ${predicate} in ${JSON.stringify(r.trims)}`);

test('a pull of a slot whose card is in an on-sale pack is kept, with its demand', () => {
  const r = plan([machineMove('pullSlot', { slot: SLOT_A })]);
  assert.equal(r.moves.length, 1);
  assert.deepEqual(r.moves[0]!.params, { slot: SLOT_A });
  assert.deepEqual(r.moves[0]!.demand, PULL_DEMAND);
  assert.equal(r.moves[0]!.structural, false);
});

test('a pull over machine.pullMost is dropped and recorded, counting the pulls already in force', () => {
  const three = plan([machineMove('pullSlot', { slot: SLOT_A }), machineMove('pullSlot', { slot: SLOT_B }), machineMove('pullSlot', { slot: SLOT_C })]);
  assert.deepEqual(three.moves.map((m) => m.params['slot']), [SLOT_A, SLOT_B]);
  dropped(three, 'moves[2].params.slot', 'pullsAtMost(2)');
  const inForce = SHELF.map((s) => (s.id === SLOT_C ? { ...s, move: { kind: 'pullSlot', act: 'x' } } : s));
  const one = plan([machineMove('pullSlot', { slot: SLOT_A }), machineMove('pullSlot', { slot: SLOT_B })], withMachine(inForce));
  assert.deepEqual(one.moves.map((m) => m.params['slot']), [SLOT_A]);
  dropped(one, 'moves[1].params.slot', 'pullsAtMost(2)');
  // The bound is the instance's.
  const retuned = { ...withMachine(), settings: { ...settings, economy: { 'machine.pullMost': 1 } } };
  assert.equal(plan([machineMove('pullSlot', { slot: SLOT_A }), machineMove('pullSlot', { slot: SLOT_B })], retuned).moves.length, 1);
});

test('a pull of a pack, of a card in no on-sale pack, of a slot not on sale, or of a slot that does not exist is dropped', () => {
  const r = plan([
    machineMove('pullSlot', { slot: SLOT_PACK }), machineMove('pullSlot', { slot: SLOT_HIDDEN }), machineMove('pullSlot', { slot: SLOT_OUT }),
    machineMove('pullSlot', { slot: '51000000-0000-4000-8000-0000000000ee' }), machineMove('pullSlot', { slot: SLOT_A }),
  ], withMachine([...SHELF, facts('51000000-0000-4000-8000-0000000000dd', { card: 'orphan', pullable: false })]));
  assert.deepEqual(r.moves.map((m) => m.params['slot']), [SLOT_A]);
  dropped(r, 'moves[0].params.slot', 'pullable');
  dropped(r, 'moves[1].params.slot', 'pullable');
  dropped(r, 'moves[2].params.slot', 'pullable');
  dropped(r, 'moves[3].params.slot', 'isSlot');
  const orphan = plan([machineMove('pullSlot', { slot: '51000000-0000-4000-8000-0000000000dd' })], withMachine([facts('51000000-0000-4000-8000-0000000000dd', { card: 'orphan', pullable: false })]));
  dropped(orphan, 'moves[0].params.slot', 'pullable');
});

test('with no machine given the repair cannot name a slot, so every machine move is dropped', () => {
  const r = plan([machineMove('pullSlot', { slot: SLOT_A })], ctx());
  assert.equal(r.moves.length, 0);
  dropped(r, 'moves[0].params.slot', 'isSlot');
});

test('one move per slot: a second move on a slot, in force or in the same answer, is dropped', () => {
  const r = plan([machineMove('pullSlot', { slot: SLOT_A }), machineMove('repriceSlot', { slot: SLOT_A, percent: 150 }), machineMove('repriceSlot', { slot: SLOT_B, percent: 70 }, { demand: undefined })]);
  assert.deepEqual(r.moves.map((m) => m.kind), ['pullSlot', 'repriceSlot']);
  dropped(r, 'moves[1].params.slot', 'oneMovePerSlot');
  const busy = SHELF.map((s) => (s.id === SLOT_B ? { ...s, move: { kind: 'repriceSlot', act: 'x' } } : s));
  const b = plan([machineMove('repriceSlot', { slot: SLOT_B, percent: 70 })], withMachine(busy));
  dropped(b, 'moves[0].params.slot', 'oneMovePerSlot');
});

test('a reprice is on a slot that is on sale, packs included; its percent is held to the economy\'s bounds, and not 100', () => {
  const r = plan([
    machineMove('repriceSlot', { slot: SLOT_PACK, percent: 80 }), machineMove('repriceSlot', { slot: SLOT_OUT, percent: 80 }), machineMove('repriceSlot', { slot: SLOT_HIDDEN, percent: 80 }),
    machineMove('repriceSlot', { slot: SLOT_B, percent: 250 }), machineMove('repriceSlot', { slot: SLOT_C, percent: 100 }),
  ]);
  assert.deepEqual(r.moves.map((m) => [m.params['slot'], m.params['percent']]), [[SLOT_PACK, 80], [SLOT_B, 200]]);
  dropped(r, 'moves[1].params.slot', 'onSaleSlot');
  dropped(r, 'moves[2].params.slot', 'onSaleSlot');
  // A percent over its bound is clamped to it and recorded (the ordinary overshoot), never a lost answer; 100 changes nothing and is dropped.
  assert.ok(r.trims.some((t) => t.path === 'moves[3].params.percent' && t.predicate === 'atMost(200)' && t.before === 250 && t.after === 200), JSON.stringify(r.trims));
  dropped(r, 'moves[4].params.percent', 'notOneHundred');
});

test('a percent or hours one past its bound is clamped to the bound and recorded; a fraction stays refused', () => {
  const up = plan([machineMove('repriceSlot', { slot: SLOT_A, percent: 201 })]);
  assert.equal(up.moves[0]!.params['percent'], 200);
  assert.ok(up.trims.some((t) => t.path === 'moves[0].params.percent' && t.predicate === 'atMost(200)' && t.before === 201 && t.after === 200), JSON.stringify(up.trims));
  const down = plan([machineMove('repriceSlot', { slot: SLOT_A, percent: 49 }, { demand: undefined })]);
  assert.equal(down.moves[0]!.params['percent'], 50);
  assert.equal(down.moves[0]!.demand, null);
  assert.ok(down.trims.some((t) => t.path === 'moves[0].params.percent' && t.predicate === 'atLeast(50)' && t.before === 49 && t.after === 50), JSON.stringify(down.trims));
  const long = plan([machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 49 }, { demand: undefined })]);
  assert.equal(long.moves[0]!.params['hours'], 48);
  assert.equal(long.moves[0]!.expiresInHours, 48);
  assert.ok(long.trims.some((t) => t.path === 'moves[0].params.hours' && t.predicate === 'atMost(48)' && t.before === 49 && t.after === 48), JSON.stringify(long.trims));
  const short = plan([machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 23 }, { demand: undefined })]);
  assert.equal(short.moves[0]!.params['hours'], 24);
  dropped(plan([machineMove('repriceSlot', { slot: SLOT_A, percent: 120.5 })]), 'moves[0].params.percent', 'isWhole');
  dropped(plan([machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 30.5 }, { demand: undefined })]), 'moves[0].params.hours', 'isWhole');
});

test('a slot id in capitals is found, lowercased, and the change is recorded', () => {
  const r = plan([machineMove('pullSlot', { slot: SLOT_A.toUpperCase() })]);
  assert.equal(r.moves.length, 1, JSON.stringify(r.trims));
  assert.equal(r.moves[0]!.params['slot'], SLOT_A);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.slot' && t.predicate === 'lowercaseUuid'), JSON.stringify(r.trims));
});

test('a markup must carry a demand and a markdown carries none: a demand given to a markdown is dropped, a markup without one is dropped', () => {
  const r = plan([
    machineMove('repriceSlot', { slot: SLOT_A, percent: 150 }, { demand: undefined }),
    machineMove('repriceSlot', { slot: SLOT_B, percent: 150 }),
    machineMove('repriceSlot', { slot: SLOT_C, percent: 60 }),
    machineMove('pullSlot', { slot: SLOT_PACK }, { demand: undefined }),
  ]);
  assert.deepEqual(r.moves.map((m) => [m.params['slot'], m.demand === null]), [[SLOT_B, false], [SLOT_C, true]]);
  dropped(r, 'moves[0].demand', 'isObject');
  dropped(r, 'moves[2].demand', 'noDemand');
  const down = plan([machineMove('repriceSlot', { slot: SLOT_C, percent: 60 }, { demand: undefined })]);
  assert.equal(down.moves.length, 1, 'a markdown with no demand is whole as it stands');
  assert.equal(down.moves[0]!.demand, null);
});

test('a flash sale is on a hidden slot, one at a time; it lasts its hours, whatever expiry was asked', () => {
  const r = plan([
    machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 30 }, { demand: undefined, expires_in_hours: 100 }),
    machineMove('flashSale', { slot: SLOT_A, hours: 30 }, { demand: undefined }),
    machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 49 }, { demand: undefined }),
  ]);
  assert.equal(r.moves.length, 1);
  assert.equal(r.moves[0]!.expiresInHours, 30, 'the window is the hours');
  assert.equal(r.moves[0]!.demand, null);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].expires_in_hours' && t.before === 100 && t.after === 30), JSON.stringify(r.trims));
  dropped(r, 'moves[1].params.slot', 'hiddenSlot');
  dropped(r, 'moves[2].params.slot', 'oneMovePerSlot');
  const two = SHELF.concat(facts('51000000-0000-4000-8000-000000000033', { card: 'second', availability: 'hidden', pullable: false }));
  const second = plan([machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 24 }, { demand: undefined }), machineMove('flashSale', { slot: '51000000-0000-4000-8000-000000000033', hours: 24 }, { demand: undefined })], withMachine(two));
  assert.equal(second.moves.length, 1);
  dropped(second, 'moves[1].params.slot', 'oneFlashAtATime');
  const running = two.map((s) => (s.id === '51000000-0000-4000-8000-000000000033' ? { ...s, move: { kind: 'flashSale', act: 'x' } } : s));
  dropped(plan([machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 24 }, { demand: undefined })], withMachine(running)), 'moves[0].params.slot', 'oneFlashAtATime');
});

test('a machine move lasts at most machine.moveDaysMost: a longer expiry is clamped and recorded', () => {
  const r = plan([machineMove('pullSlot', { slot: SLOT_A }, { expires_in_hours: 400 })]);
  assert.equal(r.moves[0]!.expiresInHours, 7 * 24);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].expires_in_hours' && t.before === 400 && t.after === 168), JSON.stringify(r.trims));
  const retuned = plan([machineMove('pullSlot', { slot: SLOT_A }, { expires_in_hours: 400 })], { ...withMachine(), settings: { ...settings, economy: { 'machine.moveDaysMost': 3 } } });
  assert.equal(retuned.moves[0]!.expiresInHours, 72);
});

test('a machine move costs a move from the bank like any other, and the old kinds are untouched by the machine', () => {
  const r = plan([machineMove('pullSlot', { slot: SLOT_A }), machineMove('pullSlot', { slot: SLOT_B })], { ...withMachine(), bank: 1 });
  assert.equal(r.moves.length, 1);
  const rename = repairAnswer(answer(PULL_DEMAND), ctx());
  assert.ok(rename.ok && rename.moves.length === 1);
});

test('the reference text lists the machine\'s slots with their ids, and says the Boss reads no purchase', () => {
  const text = referenceText({ boards: [], threads: [], characters: [], machine: SHELF });
  assert.match(text, /## The machine/);
  assert.ok(text.includes(SLOT_A) && text.includes(SLOT_HIDDEN) && text.includes(SLOT_PACK));
  assert.match(text, /whoops.*1\.00.*on sale/);
  assert.match(text, /hidden/);
  const none = referenceText({ boards: [], threads: [], characters: [] });
  assert.doesNotMatch(none, /The machine/);
  const moved = referenceText({ boards: [], threads: [], characters: [], machine: [{ ...facts(SLOT_A), move: { kind: 'pullSlot', act: 'x' } }] });
  assert.match(moved, /pullSlot in force/);
});

test('the prompt tells the Boss the machine\'s three moves, their bounds and which carry a demand', () => {
  const served = meetingSystemPrompt({ boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.it, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], career: { led: [], offices: [] }, notes: [] });
  assert.match(served, /pullSlot/);
  assert.match(served, /at most 2 slots pulled at once/);
  assert.match(served, /50 to 200 percent/);
  assert.match(served, /24 to 48 hours/);
  assert.match(served, /carries no demand/);
});

// ---- Member groups (Task 8): the meeting confers groups ----

const groupMove = (params: unknown, demand: unknown, extra: Record<string, unknown> = {}) => ({ ...move(demand), kind: 'conferGroup', params, ...extra });
const groupAnswer = (...moves: unknown[]) => ({ ...answer(null), moves });
const apology = { kind: 'apologyAccepted', params: {} };
const posts = { kind: 'postsOnBoard', params: { board: BOARD, count: 5 } };
const repairedGroup = (moves: unknown[], extra: Partial<RepairContext> = {}) => {
  const r = repairAnswer(groupAnswer(...moves), { ...ctx(), isPublic: (id) => id === ANN || id === BOB || id === HIDDEN, ...extra });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};

test('a punishment that names a board gets the apology demand from the code, whatever the model wrote, and the change is recorded', () => {
  const r = repairedGroup([groupMove({ character: ANN, group: 'trialMembers', board: BOARD }, posts)]);
  assert.equal(r.moves.length, 1);
  assert.deepEqual(r.moves[0]!.demand, apology);
  assert.deepEqual(r.moves[0]!.params, { character: ANN, group: 'trialMembers', board: BOARD });
  assert.ok(r.trims.some((t) => t.path === 'moves[0].demand' && t.predicate === 'setByCode(apologyAccepted)'), JSON.stringify(r.trims));
  // The model that already wrote the apology changes nothing, and nothing is recorded.
  const same = repairedGroup([groupMove({ character: ANN, group: 'trialMembers', board: BOARD }, apology)]);
  assert.deepEqual(same.moves[0]!.demand, apology);
  assert.ok(!same.trims.some((t) => t.path === 'moves[0].demand'), JSON.stringify(same.trims));
});

test('a punishment that names no board keeps the demand the model chose; the apology demand is dropped there, as the code alone sets it', () => {
  const kept = repairedGroup([groupMove({ character: ANN, group: 'trialMembers' }, posts)]);
  assert.deepEqual(kept.moves[0]!.demand, posts);
  const dropped = repairedGroup([groupMove({ character: ANN, group: 'trialMembers' }, apology)]);
  assert.equal(dropped.moves.length, 0);
  assert.ok(dropped.trims.some((t) => t.path === 'moves[0].demand.kind' && t.predicate.startsWith('oneOf(postsOnBoard')), JSON.stringify(dropped.trims));
  // A punishment's board must be a board of the meeting's list.
  const off = repairedGroup([groupMove({ character: ANN, group: 'trialMembers', board: OTHER_BOARD }, apology)]);
  assert.equal(off.moves.length, 0);
  assert.ok(off.trims.some((t) => t.path === 'moves[0].params.board' && t.predicate === 'isBoard'), JSON.stringify(off.trims));
  // A punishment carries no check.
  const checked = repairedGroup([groupMove({ character: ANN, group: 'trialMembers', checkAt: new Date(NOW + 40 * H).toISOString() }, posts)]);
  assert.equal(checked.moves.length, 1);
  assert.ok(!('checkAt' in checked.moves[0]!.params));
  assert.ok(checked.trims.some((t) => t.path === 'moves[0].params.checkAt' && t.predicate === 'punishmentHasNoCheck'), JSON.stringify(checked.trims));
});

test('a group outside the conferred catalog drops the move and is recorded', () => {
  for (const group of ['members', 'nonesuch']) {
    const r = repairedGroup([groupMove({ character: ANN, group }, posts)]);
    assert.equal(r.moves.length, 0, group);
    assert.ok(r.trims.some((t) => t.path === 'moves[0].params.group' && t.predicate === 'conferredGroup'), JSON.stringify(r.trims));
  }
});

test('a character who is not public now, who is capped or who is held drops the move, each recorded under its own predicate', () => {
  const cases: [string, string][] = [[HIDDEN2, 'publicCharacter'], [HIDDEN, 'underPunishmentCap'], [BOB, 'inNoGroupMove']];
  for (const [character, predicate] of cases) {
    const r = repairedGroup([groupMove({ character, group: 'trialMembers' }, posts)]);
    assert.equal(r.moves.length, 0, predicate);
    assert.ok(r.trims.some((t) => t.path === 'moves[0].params.character' && t.predicate === predicate), `${predicate}: ${JSON.stringify(r.trims)}`);
  }
  // Two moves on one character in one answer: the second would be refused by the queue, so it is dropped here.
  const twice = repairedGroup([groupMove({ character: ANN, group: 'trialMembers' }, posts), groupMove({ character: ANN.toUpperCase(), group: 'teachersPet' }, posts, { expires_in_hours: 72 })]);
  assert.equal(twice.moves.length, 1);
  assert.ok(twice.trims.some((t) => t.path === 'moves[1].params.character' && t.predicate === 'inNoGroupMove'), JSON.stringify(twice.trims));
});

test('a favor without a checkAt gets one at half its expiry from its go-live, and the addition is recorded', () => {
  const r = repairedGroup([groupMove({ character: ANN, group: 'teachersPet' }, posts)]);
  assert.equal(r.moves.length, 1);
  const m = r.moves[0]!;
  assert.equal(m.expiresInHours, 72);
  assert.equal(m.params['checkAt'], new Date(m.goLiveAt + 36 * H).toISOString());
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.checkAt' && t.predicate === 'halfExpiry'), JSON.stringify(r.trims));
  // One the model gave inside the window stays; one outside it is replaced and the change recorded.
  const inside = new Date(NOW + 30 * H + 10 * H).toISOString();
  const keeps = repairedGroup([groupMove({ character: ANN, group: 'teachersPet', checkAt: inside }, posts)]);
  assert.equal(keeps.moves[0]!.params['checkAt'], inside);
  assert.ok(!keeps.trims.some((t) => t.path === 'moves[0].params.checkAt'));
  const late = repairedGroup([groupMove({ character: ANN, group: 'teachersPet', checkAt: new Date(NOW + 400 * H).toISOString() }, posts)]);
  assert.equal(late.moves[0]!.params['checkAt'], new Date(late.moves[0]!.goLiveAt + 36 * H).toISOString());
  assert.ok(late.trims.some((t) => t.path === 'moves[0].params.checkAt' && t.predicate === 'halfExpiry'));
});

test('a favor that names a board loses the board, and the trim is recorded; the favor stands', () => {
  const r = repairedGroup([groupMove({ character: ANN, group: 'teachersPet', board: BOARD }, posts)]);
  assert.equal(r.moves.length, 1);
  assert.ok(!('board' in r.moves[0]!.params));
  assert.deepEqual(r.moves[0]!.demand, posts);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.board' && t.predicate === 'favorBarsNoBoard'), JSON.stringify(r.trims));
});

test('namedCharacters includes the character a group move names, so it is checked against who is public now', () => {
  assert.deepEqual(namedCharacters(groupAnswer(groupMove({ character: ANN.toUpperCase(), group: 'trialMembers' }, posts))), [ANN]);
});

test('the prompt lists the conferred groups with their tones and the rules for choosing, and says which kinds a Mod may be handed', () => {
  const mod = { key: M1, name: 'Sir Patrols-a-Lot', pronouns: PRONOUN_PRESETS.it, temperament: 'fussy', beats: [], petRules: [], career: { led: [], offices: [] }, notes: [], memory: null, granted: null, unspent: 0, boards: [], order: null };
  const facts = { boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] }, characterName: () => 'someone', mods: [mod] };
  const text = meetingSystemPrompt({ ...facts, groups: { conferred: [{ key: 'trialMembers', name: 'Trial Members', tone: 'punishment' }, { key: 'teachersPet', name: 'Teacher\'s Pet', tone: 'favor' }] } });
  assert.match(text, /trialMembers \(Trial Members\): a punishment/);
  assert.match(text, /teachersPet \(Teacher's Pet\): a favor/);
  assert.match(text, /A punishment may name one board[^\n]*accepted apology/);
  assert.match(text, /A favor bars nothing[^\n]*it names a checkAt[^\n]*demand/);
  assert.match(text, /capped \(punished[^\n]*or held \(already in a group move\) cannot be chosen/);
  assert.match(text, /a Mod may be handed setRule and conferGroup punishments on its beat/);
  assert.ok(!/Group moves\./.test(meetingSystemPrompt(facts)), 'no conferred groups, no section');
});


test('the reference list names the group each character is in now beside its name; a character with none shown is listed as before', () => {
  const text = referenceText({ boards: [], threads: [], characters: [{ id: ANN, name: 'Ann the Great', pronouns: PRONOUN_PRESETS.she, group: 'Trial Members' }, { id: BOB, name: 'Bob', pronouns: PRONOUN_PRESETS.it }] });
  assert.match(text, new RegExp(`- Ann the Great \\(she/her\\) \\(Trial Members\\): ${ANN}`));
  assert.match(text, new RegExp(`- Bob \\(it/its\\): ${BOB}`));
});

test('a first group move dropped for its board does not reserve its character: a valid second move on the same character stands', () => {
  const bad = groupMove({ character: ANN, group: 'trialMembers', board: OTHER_BOARD }, apology);
  const good = groupMove({ character: ANN, group: 'trialMembers' }, posts);
  const r = repairedGroup([bad, good]);
  assert.equal(r.moves.length, 1);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.board' && t.predicate === 'isBoard'));
  assert.ok(!r.trims.some((t) => t.path === 'moves[1].params.character'), JSON.stringify(r.trims));
});

// A lasting kind has no expiry (a thing built to stay). No real kind is lasting yet, so a test kind joins the catalog for these tests alone.
test('an expires_in_hours given for a lasting kind is dropped and recorded; for any other kind it is kept', async () => {
  const { MOVE_KINDS, RENAME_BOARD } = await import('./moves.ts');
  const lasting = { ...RENAME_BOARD, key: 'testLasting', lasting: true, demand: () => 'none' as const };
  (MOVE_KINDS as unknown as unknown[]).push(lasting);
  try {
    const a = answer(null);
    const r = repairAnswer({ ...a, moves: [{ ...move(null), kind: 'testLasting', expires_in_hours: 72 }, move({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } })] }, { ...ctx(), bank: 50 });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.moves.length, 2, JSON.stringify(r.trims));
    assert.equal(r.moves[0]!.kind, 'testLasting');
    assert.equal(r.moves[0]!.expiresInHours, 0, 'a lasting move has no expiry');
    assert.deepEqual(r.trims.filter((t) => t.path === 'moves[0].expires_in_hours'), [{ path: 'moves[0].expires_in_hours', predicate: 'noExpiry', before: 72, after: 0 }]);
    assert.equal(r.moves[1]!.expiresInHours, 72);
    assert.deepEqual(r.trims.filter((t) => t.path === 'moves[1].expires_in_hours'), []);
  } finally {
    (MOVE_KINDS as unknown as unknown[]).pop();
  }
});

test('a lasting kind given no expiry (0 hours) records no drop', async () => {
  const { MOVE_KINDS, RENAME_BOARD } = await import('./moves.ts');
  (MOVE_KINDS as unknown as unknown[]).push({ ...RENAME_BOARD, key: 'testLasting', lasting: true, demand: () => 'none' as const });
  try {
    const r = repairAnswer({ ...answer(null), moves: [{ ...move(null), kind: 'testLasting', expires_in_hours: 0 }] }, { ...ctx(), bank: 50 });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.moves[0]!.expiresInHours, 0);
    assert.deepEqual(r.trims.filter((t) => t.path.endsWith('expires_in_hours')), []);
  } finally {
    (MOVE_KINDS as unknown as unknown[]).pop();
  }
});

// The queue refuses a lasting board move that names nothing real, and a refusal there would fail the whole meeting, so the meeting drops it first.
const lastingMove = (kind: string, params: Record<string, unknown>) => ({ ...move(null), kind, params, expires_in_hours: 0, demand: null });
const repairedLasting = (m: unknown, over: Partial<RepairContext> = {}) => {
  const r = repairAnswer({ ...answer(null), moves: [m] }, { ...ctx(), bank: 50, boards: new Set([BOARD, OTHER_BOARD]), ...over });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};

test('a createBoard name is held to the name style and the name length, a fallback to a board that exists', () => {
  const create = { name: 'Toast Corner', premise: 'Toast.', description: 'A board.' };
  assert.equal(repairedLasting(lastingMove('createBoard', create)).moves.length, 1);
  const long = repairedLasting(lastingMove('createBoard', { ...create, name: 'x'.repeat(61) }));
  assert.ok(long.moves.length === 0 && long.trims.some((t) => t.path === 'moves[0].params.name' && t.predicate === 'atMost(60)'), JSON.stringify(long.trims));
  const styled = repairedLasting(lastingMove('createBoard', create), { system: { ...testSystem, nameStyle: () => ['not in the style'] } });
  assert.ok(styled.moves.length === 0 && styled.trims.some((t) => t.path === 'moves[0].params.name' && t.predicate === 'nameStyle'), JSON.stringify(styled.trims));
  const lost = repairedLasting(lastingMove('createBoard', { ...create, fallback: '99999999-9999-4999-8999-999999999999' }));
  assert.ok(lost.moves.length === 0 && lost.trims.some((t) => t.path === 'moves[0].params.fallback' && t.predicate === 'isBoard'), JSON.stringify(lost.trims));
  assert.equal(repairedLasting(lastingMove('createBoard', { ...create, fallback: OTHER_BOARD })).moves.length, 1);
});

test('a moveThread names a thread and a board the meeting was given; a mergeBoard names two boards it was given', () => {
  assert.equal(repairedLasting(lastingMove('moveThread', { thread: THREAD, board: OTHER_BOARD })).moves.length, 1);
  const noThread = repairedLasting(lastingMove('moveThread', { thread: OTHER_THREAD, board: OTHER_BOARD }));
  assert.ok(noThread.moves.length === 0 && noThread.trims.some((t) => t.path === 'moves[0].params.thread' && t.predicate === 'isThread'), JSON.stringify(noThread.trims));
  const noBoard = repairedLasting(lastingMove('moveThread', { thread: THREAD, board: '99999999-9999-4999-8999-999999999999' }));
  assert.ok(noBoard.moves.length === 0 && noBoard.trims.some((t) => t.path === 'moves[0].params.board' && t.predicate === 'isBoard'), JSON.stringify(noBoard.trims));
  assert.equal(repairedLasting(lastingMove('mergeBoard', { board: BOARD, into: OTHER_BOARD })).moves.length, 1);
  const noInto = repairedLasting(lastingMove('mergeBoard', { board: BOARD, into: '99999999-9999-4999-8999-999999999999' }));
  assert.ok(noInto.moves.length === 0 && noInto.trims.some((t) => t.path === 'moves[0].params.into' && t.predicate === 'isBoard'), JSON.stringify(noInto.trims));
  const same = repairedLasting(lastingMove('mergeBoard', { board: BOARD, into: BOARD }));
  assert.ok(same.moves.length === 0 && same.trims.some((t) => t.path === 'moves[0].params.into' && t.predicate === 'differsFromBoard'), JSON.stringify(same.trims));
});

/* ------------------------------------------------------------------ beats, bundles and held-back kinds ---- */
// The fangame split's arc in miniature (the engine's own fixture, never an instance's content): one beat with a bundle and slots, one with none, a locked one, and one that names a role of another beat.
const SPLIT: Beat = {
  key: 'split',
  unlock: [{ kind: 'phase', phase: 'reign' }],
  due: { phase: 'reign', daysIntoPhase: 7 },
  brief: 'SPLIT-BRIEF you have had the idea of your career.',
  bundle: {
    name: 'The Split',
    parts: [
      { role: 'minus', kind: 'createBoard', params: { name: 'World -1', premise: 'Everything else.', description: 'Not fangames.' } },
      {
        role: 'fangames',
        kind: 'createBoard',
        params: {},
        slots: {
          name: { default: 'Platformer Physics Palace', hint: 'your new fangame board, named in the board-name style' },
          premise: { default: 'Mario fangames, someday finished.', hint: 'what the board is for' },
          description: { default: 'Fangames only. Please.', hint: 'its subtitle' },
        },
      },
    ],
  },
};
const APART: Beat = { key: 'picking-apart', unlock: [{ kind: 'beatLanded', beat: 'split' }], brief: 'APART-BRIEF tidy the clutter into World -1.' };
const CONSOLIDATION: Beat = { key: 'consolidation', unlock: [{ kind: 'phase', phase: 'meltdown' }], brief: 'LOCKED-BRIEF whole boards go into World -1.' };
const EVERYTHING: Beat = {
  key: 'everything',
  unlock: [{ kind: 'beatLanded', beat: 'split' }],
  due: { daysBeforeEnd: 2 },
  brief: 'EVERYTHING-BRIEF merge the fangame board into World -1.',
  bundle: { name: 'Everything is World -1', parts: [{ role: 'final', kind: 'mergeBoard', params: { board: { role: 'fangames', beat: 'split' }, into: { role: 'minus', beat: 'split' } } }] },
};
const LAP: Beat = { key: 'victory-lap', unlock: [{ kind: 'phase', phase: 'reign' }], brief: 'LAP-BRIEF tidy with a light heart.' };
const arcPersona: Pick<Persona, 'arc' | 'miniArcs'> = { arc: [SPLIT, APART, CONSOLIDATION, EVERYTHING], miniArcs: [LAP] };
const read = (keys: string[], due: string[] = [], heldBack: string[] = []): ArcRead => ({ beats: keys.map((key) => ({ key, mini: key === 'victory-lap', due: due.includes(key) })), heldBack });
const promptFacts = (extra: Record<string, unknown> = {}) => ({
  boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [],
  career: { led: [], offices: [] }, ...extra,
});
/** What the secret must never reach: a locked beat's brief, or its key. */
const leaksLocked = (prompt: string): boolean => prompt.includes('LOCKED-BRIEF') || prompt.includes('consolidation');

test('the prompt shows each unlocked, unplayed beat\'s brief and its bundle\'s slots with their hints, in the persona\'s order', () => {
  const beats = shownBeats(arcPersona, read(['split', 'picking-apart', 'victory-lap']));
  assert.deepEqual(beats.map((b) => b.beat.key), ['split', 'picking-apart', 'victory-lap']);
  const prompt = meetingSystemPrompt(promptFacts({ beats, heldBack: [] }));
  for (const word of ['SPLIT-BRIEF', 'APART-BRIEF', 'LAP-BRIEF']) assert.ok(prompt.includes(word), `${word} is shown`);
  assert.ok(prompt.includes('fangames.name') && prompt.includes('your new fangame board, named in the board-name style'), 'a slot by its role and name, with its hint');
  assert.ok(prompt.includes('fangames.description') && prompt.includes('its subtitle'));
  assert.ok(!prompt.includes('minus.'), 'a part with no slots has none to show');
  assert.ok(prompt.indexOf('SPLIT-BRIEF') < prompt.indexOf('APART-BRIEF') && prompt.indexOf('APART-BRIEF') < prompt.indexOf('LAP-BRIEF'));
});

test('the prompt\'s words about beats and bundles are exactly the owner\'s, and nothing is said about beats when none is unlocked', () => {
  assert.equal(`${BEAT_WORDS} ${BUNDLE_WORDS}`, 'A beat is yours: an idea you have had. Play it when the board is ready, in your own words. A bundle is for moves that tell one story.');
  const shown = meetingSystemPrompt(promptFacts({ beats: shownBeats(arcPersona, read(['split'])), heldBack: [] }));
  assert.ok(shown.includes(`${BEAT_WORDS} ${BUNDLE_WORDS}`), 'the three sentences, together');
  const none = meetingSystemPrompt(promptFacts({ beats: [], heldBack: [] }));
  assert.ok(!none.includes('A beat is yours') && !/\bbeat\b/i.test(none), 'a Boss with no beat to play is told nothing of beats');
  assert.ok(none.includes(BUNDLE_WORDS), 'every Boss may compose a bundle');
});

test('a locked beat\'s brief and key reach no prompt; the check is red on a poisoned prompt that lists one', () => {
  const clean = meetingSystemPrompt(promptFacts({ beats: shownBeats(arcPersona, read(['split'])), heldBack: [] }));
  assert.ok(!leaksLocked(clean), 'only what the database calls unlocked is shown');
  // A read that does not list the locked beat shows none of it, whatever the persona holds.
  assert.ok(!shownBeats(arcPersona, read(['split'])).some((b) => b.beat.key === 'consolidation'));
  // The poison: the plausible bug is to show every beat the persona holds. The check must see it.
  const everything = [...(arcPersona.arc ?? []), ...(arcPersona.miniArcs ?? [])].map((beat) => ({ beat, mini: false, due: false }));
  assert.ok(leaksLocked(meetingSystemPrompt(promptFacts({ beats: everything, heldBack: [] }))), 'a prompt built with a locked beat\'s brief is caught');
  // A key the persona has not (an instance edited since) is not shown.
  assert.deepEqual(shownBeats(arcPersona, read(['gone'])), []);
  assert.deepEqual(shownBeats(arcPersona, undefined), []);
});

test('a due beat is marked "must be played at this meeting", and one not due is not', () => {
  const prompt = meetingSystemPrompt(promptFacts({ beats: shownBeats(arcPersona, read(['split', 'picking-apart'], ['split'])), heldBack: [] }));
  assert.match(prompt, /split \(must be played at this meeting\)/);
  assert.ok(!/picking-apart \(must be played/.test(prompt));
});

test('a kind held back is not listed, and the rest still are', () => {
  const all = meetingSystemPrompt(promptFacts({ beats: [], heldBack: [] }));
  assert.ok(all.includes('- createBoard:') && all.includes('- moveThread:'));
  const held = meetingSystemPrompt(promptFacts({ beats: [], heldBack: ['createBoard'] }));
  assert.ok(!held.includes('createBoard'), 'the kind is not named at all');
  assert.ok(held.includes('- moveThread:') && held.includes('- mergeBoard:'));
});

const withAnswer = (extra: Record<string, unknown>, c: Partial<RepairContext> = {}) => {
  const r = repairAnswer({ ...answer(null), moves: [], ...extra }, { ...ctx(), ...c });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const shownSplit = shownBeats(arcPersona, read(['split', 'picking-apart', 'everything'], []));
const dueSplit = shownBeats(arcPersona, read(['split', 'everything'], ['split', 'everything']));

test('a held-back kind named in an answer is dropped and recorded, as a move and as a part', () => {
  const create = { kind: 'createBoard', params: { name: 'Pirate Puns Palace', premise: 'Puns.', description: 'Arr.' }, expires_in_hours: 0, why: 'Because.', go_live_at: new Date(NOW).toISOString() };
  const r = withAnswer({ moves: [create], bundle: { name: 'Story', parts: [{ ...create, role: 'a' }] } }, { heldBack: new Set(['createBoard']) });
  assert.equal(r.moves.length, 0);
  assert.equal(r.bundles.length, 0);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].kind' && t.predicate === 'heldBack'), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'bundle.parts[0].kind' && t.predicate === 'heldBack'), JSON.stringify(r.trims));
  const free = withAnswer({ moves: [create] });
  assert.equal(free.moves.length, 1, 'a persona that holds nothing back has the whole catalog');
});

test('a beat answer is repaired against its template: slots fill the parts, the rest are the writer\'s, and the bundle is authored at no cost', () => {
  const r = withAnswer({ beats: [{ beat: 'split', slots: { fangames: { name: 'Platformer Palace Pals', premise: 'Games by fans.' } }, why: 'My greatest initiative.' }] }, { beats: shownSplit });
  assert.equal(r.bundles.length, 1);
  const b = r.bundles[0]!;
  assert.deepEqual([b.name, b.beat, b.cost], ['The Split', 'split', 0]);
  assert.deepEqual(b.parts.map((p) => [p.role, p.kind]), [['minus', 'createBoard'], ['fangames', 'createBoard']]);
  assert.equal(b.parts[0]!.params['name'], 'World -1', 'the writer\'s fixed name is the writer\'s');
  assert.equal(b.parts[1]!.params['name'], 'Platformer Palace Pals');
  assert.equal(b.parts[1]!.params['premise'], 'Games by fans.');
  assert.equal(b.parts[1]!.params['description'], 'Fangames only. Please.', 'a slot left out is its default');
  assert.ok(b.parts.every((p) => p.why === 'My greatest initiative.' && p.expiresInHours === 0 && p.demand === null));
  assert.ok(b.parts.every((p) => p.goLiveAt === NOW + 24 * H), 'a board made is a structural move: it waits the hold');
  assert.equal(r.moves.length, 0);
  assert.deepEqual(r.defaulted, []);
});

test('a role of an earlier beat is kept in a part\'s params, for the database to resolve', () => {
  const r = withAnswer({ beats: [{ beat: 'everything', why: 'It has come to me.' }] }, { beats: shownSplit, bank: 0 });
  const b = r.bundles[0]!;
  assert.deepEqual(b.parts[0]!.params, { board: { role: 'fangames', beat: 'split' }, into: { role: 'minus', beat: 'split' } });
});

test('a slot over its bound is trimmed and recorded, a slot name is held to the name style and the name length, a slot the template lacks is dropped', () => {
  const styled = { system: { ...testSystem, nameStyle: (n: string) => (n.endsWith('Palace') ? [] : ['not in the style']) } };
  const long = `${'x'.repeat(60)} Palace`;
  const r = withAnswer({ beats: [{ beat: 'split', slots: { fangames: { name: 'Bad name', premise: 'p'.repeat(501), description: 'ok', hair: 'blue' }, nobody: { name: 'x' } }, why: 'w' }] }, { beats: shownSplit, ...styled });
  const b = r.bundles[0]!;
  assert.equal(b.parts[1]!.params['name'], 'Platformer Physics Palace', 'a name outside the style is the default, never corrected');
  assert.equal((b.parts[1]!.params['premise'] as string).length, 500);
  const at = (path: string) => r.trims.find((t) => t.path === path);
  assert.equal(at('beats[0].slots.fangames.name')?.predicate, 'nameStyle');
  assert.deepEqual(at('beats[0].slots.fangames.premise'), { path: 'beats[0].slots.fangames.premise', predicate: 'maxLength(500)', before: 501, after: 500 });
  assert.equal(at('beats[0].slots.fangames.hair')?.predicate, 'isSlot');
  assert.equal(at('beats[0].slots.nobody')?.predicate, 'isSlot');
  const tooLong = withAnswer({ beats: [{ beat: 'split', slots: { fangames: { name: long } }, why: 'w' }] }, { beats: shownSplit });
  const bl = tooLong.bundles[0]!;
  assert.equal((bl.parts[1]!.params['name'] as string).length, 60, 'the board-name length, from the settings');
  assert.deepEqual(tooLong.trims.find((t) => t.path === 'beats[0].slots.fangames.name'), { path: 'beats[0].slots.fangames.name', predicate: 'atMost(60)', before: long.length, after: 60 });
});

test('a beat that is not shown (locked, unknown or named twice) is dropped and recorded, and a beat with no bundle is played at no cost', () => {
  const r = withAnswer({ beats: [{ beat: 'consolidation', why: 'w' }, { beat: 'picking-apart', why: 'Done tidying.' }, { beat: 'picking-apart', why: 'again' }] }, { beats: shownSplit, bank: 0 });
  assert.deepEqual(r.bundles.map((b) => b.beat), ['picking-apart']);
  const apart = r.bundles[0]!;
  assert.deepEqual([apart.parts.length, apart.cost, apart.name], [0, 0, '']);
  assert.ok(r.trims.some((t) => t.path === 'beats[0].beat' && t.predicate === 'unlockedBeat'), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'beats[2].beat' && t.predicate === 'uniqueBeat'));
});

test('a due beat left out of the answer is played with its defaults, and the record says so', () => {
  const r = withAnswer({}, { beats: dueSplit });
  assert.deepEqual(r.defaulted, ['split', 'everything']);
  const split = r.bundles[0]!;
  assert.equal(split.beat, 'split');
  assert.equal(split.parts[1]!.params['name'], 'Platformer Physics Palace');
  assert.ok(r.trims.some((t) => t.path === 'beats.split' && t.predicate === 'playedWithDefaults'), JSON.stringify(r.trims));
  const answered = withAnswer({ beats: [{ beat: 'split', why: 'w' }] }, { beats: dueSplit });
  assert.deepEqual(answered.defaulted, ['everything'], 'a due beat the answer names is not defaulted');
  assert.equal(withAnswer({}, { beats: shownSplit }).bundles.length, 0, 'a beat that is not due waits for the Boss');
});

const part = (extra: Record<string, unknown>) => ({ kind: 'createBoard', params: { name: 'Pirate Puns Palace', premise: 'Puns.', description: 'Arr.' }, why: 'Because.', ...extra });

test('a composed bundle costs the sum of its parts and keeps a part\'s role where a board goes', () => {
  const r = withAnswer({ bundle: { name: 'One story', parts: [part({ role: 'a' }), { kind: 'moveThread', params: { thread: THREAD, board: { role: 'a' } }, why: 'Move it.' }] } });
  assert.equal(r.bundles.length, 1);
  const b = r.bundles[0]!;
  assert.deepEqual([b.name, b.beat, b.cost, b.parts.length], ['One story', null, 2, 2]);
  assert.deepEqual(b.parts.map((p) => [p.role, p.kind]), [['a', 'createBoard'], [null, 'moveThread']]);
  assert.deepEqual(b.parts[1]!.params['board'], { role: 'a' });
});

test('a composed bundle over bundleMostParts is cut from the end and recorded, and a bundle the bank cannot pay is cut to what it can', () => {
  const six = [1, 2, 3, 4, 5, 6].map((i) => part({ role: `r${i}`, params: { name: `Pirate Puns Palace ${i}`, premise: 'p', description: 'd' } }));
  const r = withAnswer({ bundle: { name: 'Too many', parts: six } }, { bank: 10 });
  const b = r.bundles[0]!;
  assert.deepEqual(b.parts.map((p) => p.role), ['r1', 'r2', 'r3', 'r4']);
  assert.equal(b.cost, 4);
  assert.deepEqual(r.trims.find((t) => t.path === 'bundle.parts' && t.predicate === 'atMost(4)'), { path: 'bundle.parts', predicate: 'atMost(4)', before: 6, after: 4 });
  const poor = withAnswer({ bundle: { name: 'Too many', parts: six.slice(0, 4) } }, { bank: 2.5 });
  assert.equal((poor.bundles[0]!).cost, 2);
  assert.ok(poor.trims.some((t) => t.path === 'bundle.parts' && t.predicate === 'withinBank' && t.before === 4 && t.after === 2), JSON.stringify(poor.trims));
  const none = withAnswer({ bundle: { name: 'Too many', parts: six.slice(0, 2) } }, { bank: 0 });
  assert.equal(none.bundles.length, 0, 'a bundle with nothing left to pay is no bundle');
});

test('the bank pays the Boss\'s own moves before a composed bundle, and an authored bundle is never charged', () => {
  const move1 = { kind: 'createBoard', params: { name: 'Pirate Puns Palace', premise: 'p', description: 'd' }, expires_in_hours: 0, why: 'w', go_live_at: new Date(NOW).toISOString() };
  const r = withAnswer({ moves: [move1, move1, { ...move1, params: { ...move1.params, name: 'Koopa Kart Klub' } }], bundle: { name: 'Story', parts: [part({ role: 'a' }), part({ role: 'b' })] }, beats: [{ beat: 'split', why: 'w' }] }, { bank: 4, beats: shownSplit });
  assert.equal(r.moves.length, 3);
  assert.deepEqual(r.bundles.map((b) => b.cost), [0, 1], 'the beat is free; the composed bundle gets the one move left');
});

test('a composed bundle\'s parts are queued in dependency order, and a part naming a role nothing earlier makes is dropped, with what builds on it', () => {
  const thread = { kind: 'moveThread', params: { thread: THREAD, board: { role: 'a' } }, why: 'Move it.' };
  const reordered = withAnswer({ bundle: { name: 'Story', parts: [thread, part({ role: 'a' })] } });
  const b = reordered.bundles[0]!;
  assert.deepEqual(b.parts.map((p) => p.kind), ['createBoard', 'moveThread'], 'the board is made before a thread is moved to it');
  assert.ok(reordered.trims.some((t) => t.path === 'bundle.parts' && t.predicate === 'dependencyOrder'));
  const never = withAnswer({ bundle: { name: 'Story', parts: [part({ role: 'a' }), { ...thread, params: { thread: THREAD, board: { role: 'zzz' } } }] } });
  assert.equal((never.bundles[0]!).parts.length, 1);
  assert.ok(never.trims.some((t) => t.path === 'bundle.parts[1].params.board' && t.predicate === 'roleDefined'), JSON.stringify(never.trims));
  const styled = withAnswer({ bundle: { name: 'Story', parts: [part({ role: 'a' }), thread] } }, { system: { ...testSystem, nameStyle: () => ['no'] } });
  assert.equal(styled.bundles.length, 0, 'the part that makes the board is dropped for its name, so the move to it has no board and is dropped too');
  const beatRole = withAnswer({ bundle: { name: 'Story', parts: [{ ...thread, params: { thread: THREAD, board: { role: 'fangames', beat: 'split' } } }] } });
  assert.ok(beatRole.trims.some((t) => t.path === 'bundle.parts[0].params.board' && t.predicate === 'beatRoleNotComposed'), JSON.stringify(beatRole.trims));
  const loose = withAnswer({ moves: [{ ...thread, params: { thread: THREAD, board: { role: 'a' } }, expires_in_hours: 0, go_live_at: new Date(NOW).toISOString() }] });
  assert.ok(loose.trims.some((t) => t.path === 'moves[0].params.board' && t.predicate === 'roleInsideBundle'), 'a role is for a bundle');
});

test('the answer\'s rule carries beats and a bundle, both optional, and the schema says so', () => {
  const fields = (MEETING_RULE as { fields: Record<string, { optional?: boolean }> }).fields;
  assert.ok(fields['beats']?.optional && fields['bundle']?.optional);
  const schema = ruleSchema(MEETING_RULE) as { properties: Record<string, unknown>; required: string[] };
  assert.ok('beats' in schema.properties && 'bundle' in schema.properties);
  assert.ok(!schema.required.includes('beats') && !schema.required.includes('bundle'));
});

test('a role of another beat is a role: {role, beat} is a role reference, and nothing else is', async () => {
  const { isRoleRef, moveParamsProblems } = await import('./moves.ts');
  assert.ok(isRoleRef({ role: 'a' }) && isRoleRef({ role: 'a', beat: 'split' }));
  assert.ok(!isRoleRef({ role: 'a', beat: 'Split!' }) && !isRoleRef({ role: 'a', beat: 4 }) && !isRoleRef({ role: 'a', other: 1 }) && !isRoleRef({ beat: 'split' }));
  const merge = { board: { role: 'f', beat: 'split' }, into: { role: 'm', beat: 'split' } };
  assert.ok(moveParamsProblems('mergeBoard', merge, undefined, true).ok);
  const outside = moveParamsProblems('mergeBoard', merge);
  assert.ok(!outside.ok && outside.predicate === 'roleInsideBundle');
  const same = moveParamsProblems('mergeBoard', { board: { role: 'f', beat: 'split' }, into: { role: 'f', beat: 'split' } }, undefined, true);
  assert.ok(!same.ok && same.predicate === 'differsFromBoard', 'the same role of the same beat is one board, and no board merges into itself');
  const differ = moveParamsProblems('mergeBoard', { board: { role: 'f', beat: 'split' }, into: { role: 'f' } }, undefined, true);
  assert.ok(differ.ok, 'a role of this bundle and the same role of another beat are two boards');
});

test('no sentence in the prompt names a move kind the Boss holds back: each kind\'s prose goes with its line', async () => {
  const { ASKABLE_MOVE_KINDS } = await import('./moves.ts');
  const mod = { key: 'bot-a', name: 'Bot A', pronouns: PRONOUN_PRESETS.it, temperament: 'earnest', beats: [], petRules: [], career: { led: [], offices: [] }, notes: [], memory: null, granted: null, unspent: 0, boards: [], order: null };
  const groups = { conferred: [{ key: 'trialMembers', name: 'Trial Members', tone: 'punishment' as const }] };
  const base = { mods: [mod], groups, beats: [], heldBack: [] as string[] };
  const whole = meetingSystemPrompt(promptFacts(base));
  for (const k of ASKABLE_MOVE_KINDS) assert.ok(whole.includes(k.key), `${k.key} is named when it is listed`);
  for (const k of ASKABLE_MOVE_KINDS) {
    const prompt = meetingSystemPrompt(promptFacts({ ...base, heldBack: [k.key] }));
    assert.ok(!prompt.includes(k.key), `${k.key} is held back and still named: ${prompt.slice(Math.max(0, prompt.indexOf(k.key) - 80), prompt.indexOf(k.key) + 80)}`);
  }
  const none = meetingSystemPrompt(promptFacts({ ...base, heldBack: ASKABLE_MOVE_KINDS.map((k) => k.key) }));
  for (const k of ASKABLE_MOVE_KINDS) assert.ok(!none.includes(k.key), `${k.key} is named when every kind is held back`);
  assert.ok(!/Board names\.|vending machine|Group moves/.test(none), 'a section about kinds that are all held back is not written');
});

/* ---------------------------------------------------------- a malformed bundle or beat never costs the answer ---- */
test('a malformed bundle or beat is dropped or repaired and recorded; the answer, and its other moves, still stand', async () => {
  const { meetingSchema } = await import('./meeting.ts');
  const keep = { kind: 'createBoard', params: { name: 'Pirate Puns Palace', premise: 'p', description: 'd' }, expires_in_hours: 0, why: 'w', go_live_at: new Date(NOW).toISOString() };
  const at = (r: { trims: readonly { path: string; predicate: string }[] }, path: string) => r.trims.find((t) => t.path === path)?.predicate;
  // The whole bundle is no object, the beats are no list.
  const a = withAnswer({ moves: [keep], bundle: 'nope', beats: 'nope' }, { beats: shownSplit });
  assert.equal(a.moves.length, 1);
  assert.equal(at(a, 'bundle'), 'isObject');
  assert.equal(at(a, 'beats'), 'isList');
  // Parts: a part that is no object, one with no kind, one with no params are dropped, naming the predicate; a missing why and a missing name are made whole.
  const b = withAnswer({
    moves: [keep],
    bundle: { parts: [{ kind: 'createBoard', role: 'a', params: { name: 'Koopa Kart Klub', premise: 'p', description: 'd' } }, 5, { params: {} }, { kind: 'createBoard' }, { kind: 7, params: {} }] },
  });
  assert.equal(b.moves.length, 1);
  const bundle = b.bundles[0]!;
  assert.equal(bundle.name, 'a bundle');
  assert.equal(bundle.parts.length, 1);
  assert.ok(bundle.parts[0]!.why.length > 0 && bundle.parts[0]!.why.length <= 200, 'a missing why is made whole');
  assert.equal(at(b, 'bundle.name'), 'default');
  assert.equal(at(b, 'bundle.parts[1]'), 'isObject');
  assert.equal(at(b, 'bundle.parts[2].kind'), 'isString');
  assert.equal(at(b, 'bundle.parts[3].params'), 'isObject');
  assert.equal(at(b, 'bundle.parts[4].kind'), 'isString');
  // Parts that are not a list drop the bundle.
  assert.equal(at(withAnswer({ bundle: { name: 'x', parts: 'no' } }), 'bundle.parts'), 'isList');
  // Beats: an entry that is no object or names no beat is dropped; a why of the wrong type is the default.
  const c = withAnswer({ beats: [3, { why: 'x' }, { beat: 'split', why: 7 }] }, { beats: shownSplit, bank: 0 });
  assert.equal(at(c, 'beats[0]'), 'isObject');
  assert.equal(at(c, 'beats[1].beat'), 'isString');
  assert.deepEqual(c.bundles.map((x) => x.beat), ['split']);
  // The model is still given the strict shape.
  const schema = meetingSchema() as { properties: Record<string, any> };
  assert.deepEqual(schema.properties['bundle'].required, ['name', 'parts']);
  assert.ok(schema.properties['bundle'].properties.parts.items.required.includes('kind') && schema.properties['beats'].items.required.includes('beat'));
});
