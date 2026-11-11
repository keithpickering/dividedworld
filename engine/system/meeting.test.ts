import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemSettings, testSystem } from '../rules/test-system.ts';
import { DEMAND_KINDS } from './demands.ts';
import { DEMAND_ID_ROLES, MEETING_FIELDS, MEETING_PARTS, MEETING_RULE, partRule, partSchema, inheritedText, meetingSystemPrompt, namedCharacters, referenceText, repairAnswer, ruleSchema, type InheritedMove, type MachineSlotFacts, type RepairContext } from './meeting.ts';
import { noteMost } from './memory.ts';
import { schemaProblems } from './schema.ts';
import { repair } from './validate.ts';
import { phaseAt } from './phases.ts';
import { personaPrompt } from './prompt.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';

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
  assert.ok(r.trims.some((t) => t.path === 'moves[0].kind' && t.predicate === 'oneOf(renameBoard, setRule, conferGroup, pullSlot, repriceSlot, flashSale)'), JSON.stringify(r.trims));
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

test('a setRule\'s param given as the number\'s digits in text is read as a number, and the trim is recorded', () => {
  const r = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'minLength', param: '20', band: 'minor' }), ctx());
  assert.ok(r.ok && r.moves.length === 1, JSON.stringify(r));
  assert.equal(r.ok && r.moves[0]!.params['param'], 20);
  assert.ok(r.ok && r.trims.some((t) => t.path === 'moves[0].params.param' && t.predicate === 'asNumber'), JSON.stringify(r.ok && r.trims));
});

test('a setRule\'s param given as text is read as its predicate wants it, and the trim is recorded', () => {
  const count = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'minLength', param: '3', band: 'minor' }), ctx());
  assert.ok(count.ok && count.moves.length === 1, JSON.stringify(count));
  assert.equal(count.ok && count.moves[0]!.params['param'], 3);
  assert.ok(count.ok && count.trims.some((t) => t.path === 'moves[0].params.param' && t.predicate === 'asNumber' && t.before === 1 && t.after === 3), JSON.stringify(count.trims));
  const none = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'noAllCaps', param: '', band: 'minor' }), ctx());
  assert.ok(none.ok && none.moves.length === 1, JSON.stringify(none));
  assert.equal(none.ok && none.moves[0]!.params['param'], null);
  assert.ok(none.ok && none.trims.some((t) => t.path === 'moves[0].params.param' && t.predicate === 'asNone'), JSON.stringify(none.trims));
  const left = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'noAllCaps', band: 'minor' }), ctx());
  assert.ok(left.ok && left.moves.length === 1 && !left.trims.some((t) => t.predicate === 'asNone'), JSON.stringify(left));
  const word = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'bannedWord', param: 'toast', band: 'minor' }), ctx());
  assert.ok(word.ok && word.moves.length === 1 && word.moves[0]!.params['param'] === 'toast', JSON.stringify(word));
});

test('the meeting\'s schema has no empty schema anywhere, and an any rule has no schema to send', () => {
  const empties: string[] = [];
  const walk = (node: any, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (!Array.isArray(node) && !('type' in node) && !('properties' in node) && !('items' in node) && !('enum' in node) && path.split('.').pop() !== 'properties') empties.push(path);
    for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  walk(ruleSchema(MEETING_RULE), '$');
  assert.deepEqual(empties, []);
  assert.throws(() => ruleSchema({ type: 'object', fields: { xs: { type: 'list', of: { type: 'object', fields: { p: { type: 'any' } } } } } }), { message: 'ruleSchema: an "any" rule at xs[].p has no schema to send' });
});

test('a setRule on a board outside the meeting\'s list, or with a param its predicate refuses, is dropped and recorded', () => {
  const off = repairAnswer(ruleAnswer({ board: OTHER_BOARD, predicate: 'noDoublePost', band: 'minor' }), ctx());
  assert.ok(off.ok && off.moves.length === 0 && off.trims.some((t) => t.path === 'moves[0].params.board' && t.predicate === 'isBoard'), JSON.stringify(off));
  const high = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'minLength', param: '9000', band: 'minor' }), ctx());
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
  const houseClash = ruleMove({ board: B2, predicate: 'maxLength', param: '50', band: 'minor' });
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

test('a 0 in a kind\'s own number field is not given: it is refused by name, never clamped to the least', () => {
  const percent = plan([machineMove('repriceSlot', { slot: SLOT_A, percent: 0 })]);
  assert.equal(percent.moves.length, 0, JSON.stringify(percent.trims));
  dropped(percent, 'moves[0].params.percent', 'required');
  assert.ok(!percent.trims.some((t) => t.before === 0 && t.after === 50), JSON.stringify(percent.trims));
  const hours = plan([machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 0 }, { demand: undefined })]);
  assert.equal(hours.moves.length, 0, JSON.stringify(hours.trims));
  dropped(hours, 'moves[0].params.hours', 'required');
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

test('a field two kinds share is dropped without a trim for the kind that has none, and kept for the kind that has it', () => {
  const r = plan([
    machineMove('repriceSlot', { slot: SLOT_C, percent: 60, board: BOARD }, { demand: undefined }),
    move(PULL_DEMAND),
  ]);
  assert.equal(r.moves.length, 2, JSON.stringify(r.trims));
  assert.ok(!('board' in r.moves[0]!.params), JSON.stringify(r.moves[0]));
  assert.equal(r.moves[1]!.params['board'], BOARD);
  assert.ok(!r.trims.some((t) => t.path.startsWith('moves[0].params.board')), JSON.stringify(r.trims));
  const favor = repairAnswer(withMoves(machineMove('flashSale', { slot: SLOT_HIDDEN, hours: 24, board: BOARD }, { demand: undefined })), withMachine());
  assert.ok(favor.ok && favor.moves.length === 1 && !('board' in favor.moves[0]!.params), JSON.stringify(favor));
});

test('the prompt no longer tells the Boss to leave out a demand or a rule\'s board, which its schema requires', () => {
  const served = meetingSystemPrompt({ boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.it, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], career: { led: [], offices: [] }, notes: [] });
  assert.ok(!/leave "demand" out/.test(served) && !/left out for every board/.test(served), served);
  assert.match(served, /empty kind/);
  assert.match(served, /empty text for every board/);
  assert.match(served, /every field is written[^\n]*blank[^\n]*ignored/);
  assert.ok(!/Your answer is your whole new memory/.test(served));
  assert.match(served, /memory you answer in the self part/);
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

/* ------------------------------------------------------------------ the three parts (provider schemas plan, Task 4) ---- */

const tally = (schema: any): { properties: number; optional: number; unions: number } => {
  const t = { properties: 0, optional: 0, unions: 0 };
  const walk = (n: any): void => {
    if (n === null || typeof n !== 'object') return;
    if (n.properties) {
      const keys = Object.keys(n.properties);
      t.properties += keys.length;
      t.optional += keys.filter((k) => !(n.required ?? []).includes(k)).length;
      for (const k of keys) walk(n.properties[k]);
    }
    if (n.items) walk(n.items);
    if (n.anyOf) { t.unions += 1; n.anyOf.forEach(walk); }
  };
  walk(schema);
  return t;
};

test('every field of the answer is in exactly one part, and MEETING_RULE is built from the parts', () => {
  assert.deepEqual(MEETING_PARTS.map((p) => p.key), ['moves', 'staff', 'self']);
  assert.deepEqual(MEETING_PARTS.map((p) => [...p.fields]), [['moves', 'inherited', 'successor'], ['orders', 'patrols'], ['memory', 'profile']]);
  const listed = MEETING_PARTS.flatMap((p) => [...p.fields]);
  assert.equal(new Set(listed).size, listed.length, `a field is in two parts: ${listed.join(', ')}`);
  assert.deepEqual([...listed].sort(), Object.keys(MEETING_FIELDS).sort(), 'a field is in no part');
  assert.deepEqual(Object.keys((MEETING_RULE as { fields: object }).fields), listed);
  for (const p of MEETING_PARTS) {
    assert.deepEqual(Object.keys((partRule(p.key) as { fields: object }).fields), [...p.fields]);
    assert.match(p.ask, /\S/);
  }
  assert.ok(MEETING_PARTS[0]!.ask.includes('Hold your meeting.'));
});

const DESIGN_PROPERTIES = { moves: 36, staff: 23, self: 20 } as const;
const OPTIONAL = { moves: 1, staff: 7, self: 1 } as const;
for (const key of ['moves', 'staff', 'self'] as const) {
  const t = tally(partSchema(key));
  test(`the ${key} part's schema is accepted by the provider's rules: ${t.properties} properties, ${t.optional} optional, ${t.unions} unions`, () => {
    assert.deepEqual(schemaProblems(partSchema(key)), []);
    assert.deepEqual(t, { properties: DESIGN_PROPERTIES[key], optional: OPTIONAL[key], unions: 0 });
  });
}

test('the moves part asks for every field of a move, and its loose params and demand are all required', () => {
  const schema = partSchema('moves') as any;
  assert.deepEqual([...schema.required].sort(), ['inherited', 'moves'], 'an empty list says none, so inherited is required; successor has no blank that says none');
  assert.ok(!schema.required.includes('successor'));
  const item = schema.properties.moves.items;
  assert.deepEqual([...item.required].sort(), ['demand', 'expires_in_hours', 'go_live_at', 'kind', 'params', 'why']);
  assert.deepEqual([...item.properties.params.required].sort(), Object.keys(item.properties.params.properties).sort());
  assert.deepEqual([...item.properties.demand.required].sort(), ['kind', 'params']);
  assert.deepEqual([...item.properties.demand.properties.params.required].sort(), Object.keys(item.properties.demand.properties.params.properties).sort());
  assert.ok(Object.keys(item.properties.params.properties).length > 4);
});

test('a schema merged from all three parts is too large for the provider, by propertiesTotal', () => {
  const merged = { type: 'object', additionalProperties: false, properties: {} as Record<string, unknown>, required: [] as string[] };
  for (const key of ['moves', 'staff', 'self'] as const) {
    const s = partSchema(key) as any;
    Object.assign(merged.properties, s.properties);
    merged.required.push(...(s.required ?? []));
  }
  assert.ok(schemaProblems(merged).some((p) => p.predicate.startsWith('propertiesTotal')), JSON.stringify(schemaProblems(merged)));
});

const BLANK_PARAMS = { board: '', name: '', premise: '', description: '', predicate: '', param: '', band: '', character: '', group: '', checkAt: '', slot: '', percent: 0, hours: 0 };
const BLANK_DEMAND = { kind: '', params: { board: '', count: 0, quadrant: '', character: '', thread: '', a: '', b: '', reactions: 0 } };
const askedMove = (kind: string, params: Record<string, unknown>, demand: unknown = BLANK_DEMAND) => ({
  kind, params: { ...BLANK_PARAMS, ...params }, demand, go_live_at: new Date(NOW + 30 * H).toISOString(), expires_in_hours: 72, why: 'Because.',
});
const movesOnly = (...moves: unknown[]) => ({ moves, inherited: [] });
const plain = (raw: unknown, c: RepairContext = ctx()) => {
  const r = repairAnswer(raw, c);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};

test('a rename with a 0 in percent and a blank predicate keeps exactly its four params, with no trim for the rest', () => {
  const r = plain(movesOnly(askedMove('renameBoard', { board: BOARD, name: 'Pirate Puns Palace', premise: 'Everything about puns.', description: 'Ahoy.' }, { kind: 'postsOnBoard', params: { ...BLANK_DEMAND.params, board: BOARD, count: 4, thread: THREAD, a: ANN } })));
  assert.equal(r.moves.length, 1, JSON.stringify(r.trims));
  assert.deepEqual(r.moves[0]!.params, { board: BOARD, name: 'Pirate Puns Palace', premise: 'Everything about puns.', description: 'Ahoy.' });
  assert.deepEqual(r.moves[0]!.demand, { kind: 'postsOnBoard', params: { board: BOARD, count: 4 } });
  assert.deepEqual(r.trims.filter((t) => /\.(params|demand)/.test(t.path)), []);
});

test('a number or a blank in another kind\'s field is never read, never recorded, and never costs the answer', () => {
  const r = plain(movesOnly(askedMove('renameBoard', { board: BOARD, name: 'Pirate Puns Palace', premise: 'Everything about puns.', predicate: 7, band: 9, slot: 3 }, { kind: 'postsOnBoard', params: { ...BLANK_DEMAND.params, board: BOARD, count: 4, quadrant: 5 } })));
  assert.equal(r.moves.length, 1, JSON.stringify(r.trims));
  assert.deepEqual(r.moves[0]!.params, { board: BOARD, name: 'Pirate Puns Palace', premise: 'Everything about puns.' });
  assert.deepEqual(r.trims.filter((t) => /\.(params|demand)/.test(t.path)), []);
});

test('a house rule (blank board) is a rule on every board, and a blank param is none where the predicate takes none', () => {
  const r = plain(movesOnly(askedMove('setRule', { board: '', predicate: 'noAllCaps', param: '', band: 'minor' }, { kind: 'postsOnBoard', params: { ...BLANK_DEMAND.params, board: BOARD, count: 4 } })));
  assert.equal(r.moves.length, 1, JSON.stringify(r.trims));
  assert.deepEqual(r.moves[0]!.params, { board: null, predicate: 'noAllCaps', param: null, band: 'minor' });
});

test('a conferral\'s blank board and blank checkAt are absent', () => {
  const r = plain(movesOnly(askedMove('conferGroup', { character: ANN, group: 'trialMembers', board: '', checkAt: '' }, { kind: 'postsOnBoard', params: { ...BLANK_DEMAND.params, board: BOARD, count: 4 } })));
  assert.equal(r.moves.length, 1, JSON.stringify(r.trims));
  assert.deepEqual(r.moves[0]!.params, { character: ANN, group: 'trialMembers' });
});

test('a favor whose demand kind is blank has no demand, and no stray-demand trim is recorded', () => {
  const SLOT = '51000000-0000-4000-8000-00000000000a';
  const shelf: MachineSlotFacts[] = [{ id: SLOT, position: 1, card: 'whoops', pack: null, availability: 'onSale', price: 100, pullable: true, move: null }];
  const r = plain(movesOnly(askedMove('repriceSlot', { slot: SLOT, percent: 80 })), { ...ctx(), machine: shelf });
  assert.equal(r.moves.length, 1, JSON.stringify(r.trims));
  assert.equal(r.moves[0]!.demand, null);
  assert.ok(!r.trims.some((t) => t.predicate === 'noDemand'), JSON.stringify(r.trims));
});

test('a move that needs a demand and gives a blank demand kind is dropped, recorded at its demand', () => {
  const r = plain(movesOnly(askedMove('renameBoard', { board: BOARD, name: 'Pirate Puns Palace', premise: 'Everything about puns.' })));
  assert.equal(r.moves.length, 0);
  assert.ok(r.trims.some((t) => t.path.startsWith('moves[0].demand')), JSON.stringify(r.trims));
});

test('a blank name on a rename, and a 0 count in a demand, are refused by name', () => {
  const name = plain(movesOnly(askedMove('renameBoard', { board: BOARD, name: '', premise: 'Everything about puns.' }, { kind: 'postsOnBoard', params: { ...BLANK_DEMAND.params, board: BOARD, count: 4 } })));
  assert.equal(name.moves.length, 0, JSON.stringify(name.trims));
  assert.ok(name.trims.some((t) => t.path === 'moves[0].params.name'), JSON.stringify(name.trims));
  const count = plain(movesOnly(askedMove('renameBoard', { board: BOARD, name: 'Pirate Puns Palace', premise: 'Everything about puns.' }, { kind: 'postsOnBoard', params: { ...BLANK_DEMAND.params, board: BOARD, count: 0 } })));
  assert.equal(count.moves.length, 0, JSON.stringify(count.trims));
  assert.ok(count.trims.some((t) => t.path.startsWith('moves[0].demand') && /atLeast/.test(t.predicate)), JSON.stringify(count.trims));
});

test('a number in a text field that is not an any field is not read as text: the move is refused, the answer stands', () => {
  const r = repairAnswer(movesOnly(askedMove('renameBoard', { board: BOARD, name: 42, premise: 'Everything about puns.' }, { kind: 'postsOnBoard', params: { ...BLANK_DEMAND.params, board: BOARD, count: 4 } })), ctx());
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.moves.length, 0);
  assert.ok(!r.trims.some((t) => t.predicate === 'asText'), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.name' && t.predicate === 'isString'), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.name' && t.predicate !== 'isString'), JSON.stringify(r.trims));
});

test('a setRule\'s param sent as a JSON number keeps the move, read as its text and then as the count, both recorded', () => {
  const r = repairAnswer(ruleAnswer({ board: BOARD, predicate: 'minLength', param: 20, band: 'minor' }), ctx());
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.moves.length, 1, JSON.stringify(r.trims));
  assert.equal(r.moves[0]!.params['param'], 20);
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.param' && t.predicate === 'asText' && t.before === 20 && t.after === 2), JSON.stringify(r.trims));
  assert.ok(r.trims.some((t) => t.path === 'moves[0].params.param' && t.predicate === 'asNumber'), JSON.stringify(r.trims));
  const demand = repairAnswer(answer({ kind: 'postsOnBoard', params: { board: BOARD, count: 5, quadrant: 7 } }), ctx());
  assert.ok(demand.ok && demand.moves.length === 1, JSON.stringify(demand));
});

test('an answer with a part missing is an answer with none of it', () => {
  const none = plain({});
  assert.deepEqual([none.moves, none.inherited, none.successor, none.orders, none.patrols, none.memory, none.profile], [[], [], null, [], [], undefined, undefined]);
  const staff = plain({ orders: [], patrols: [] });
  assert.deepEqual([staff.moves, staff.memory, staff.profile], [[], undefined, undefined]);
  const moves = plain(movesOnly(move({ kind: 'postsOnBoard', params: { board: BOARD, count: 5 } })));
  assert.equal(moves.moves.length, 1);
  assert.equal(moves.memory, undefined);
  assert.equal(moves.profile, undefined);
  assert.deepEqual([moves.orders, moves.patrols], [[], []]);
  const shown = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const handover = plain({ moves: [], inherited: [{ move_act: shown, decision: 'keep' }] });
  assert.deepEqual(handover.inherited.map((x) => x.move_act), [shown]);
  const self = plain({ memory: answer(null).memory, profile: answer(null).profile });
  assert.ok(self.memory !== undefined && self.profile !== undefined);
  assert.deepEqual([self.moves, self.inherited, self.successor], [[], [], null]);
});

test('a memory without a profile, or a profile without a memory, is whole: the missing one is undefined', () => {
  const m = plain({ memory: answer(null).memory });
  assert.ok(m.memory !== undefined && m.profile === undefined);
  const p = plain({ profile: answer(null).profile });
  assert.ok(p.memory === undefined && p.profile !== undefined);
});

test('a present but broken memory still rejects, naming the path', () => {
  const r = repairAnswer({ memory: { hobby: 3 } }, ctx());
  assert.ok(!r.ok && r.path.startsWith('memory'), JSON.stringify(r));
});

test('the system prompt says the meeting is answered in three turns, and names each part once, from the parts', () => {
  const text = meetingSystemPrompt({ boss: testSystem.roster[0]!, bossPronouns: PRONOUN_PRESETS.she, system: testSystem, settings, phase: ctx().phase, bank: 2, mods: [], characterName: () => 'someone', successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] } });
  assert.match(text, /The meeting is answered in three turns/);
  for (const p of MEETING_PARTS) assert.equal(text.split(`the "${p.key}" part (${p.fields.join(', ')})`).length - 1, 1, p.key);
  assert.equal(MEETING_PARTS.length, 3);
  assert.ok(text.endsWith('Answer only in the structure you are asked for.'));
});

test('each part\'s own rule accepts its own schema\'s shape: a rule with every field optional, so a blank is read as absent', () => {
  for (const p of MEETING_PARTS) {
    const rule = partRule(p.key) as { fields: Record<string, { optional?: boolean }> };
    for (const f of p.fields) assert.equal(rule.fields[f]!.optional, true, `${p.key}.${f}`);
    assert.ok(repair({}, partRule(p.key)).ok, p.key);
  }
});
