import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemSettings, testSystem } from '../rules/test-system.ts';
import { DEMAND_KINDS } from './demands.ts';
import { DEMAND_ID_ROLES, inheritedText, namedCharacters, repairAnswer, type InheritedMove, type RepairContext } from './meeting.ts';
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
  assert.ok(r.trims.some((t) => t.path === 'moves[0].kind' && t.predicate === 'oneOf(renameBoard)'), JSON.stringify(r.trims));
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
