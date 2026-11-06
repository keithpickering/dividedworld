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

test('the system prompt carries the Boss\'s career as plain facts, and says so when there is none', () => {
  const facts = {
    boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: false, roster: [], notes: [],
  };
  const served = meetingSystemPrompt({ ...facts, career: { led: [{ season: 3, since: '2026-04-01T00:00:00+00:00', until: null, how: 'nomination' }], offices: [] } });
  assert.ok(served.includes('Your career, as plain facts'), served);
  assert.ok(served.includes('Boss in Season 3, from 2026-04-01 until now'), served);
  assert.ok(meetingSystemPrompt({ ...facts, career: { led: [], offices: [] } }).includes('You have held no office before.'));
});

test('the Boss\'s recent notes are in the prompt as its own thoughts, capped at notesRead with the newest kept, and the section is absent when there are none', () => {
  const facts = {
    boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: false, roster: [],
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
  const prompt = meetingSystemPrompt({ boss: testSystem.roster[0]!, system: testSystem, settings, phase: ctx().phase, bank: 2, successorAllowed: false, roster: [], notes: [], career: { led: [], offices: [] } });
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
