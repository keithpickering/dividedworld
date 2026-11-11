import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leastAnswer } from './stub.ts';
import { systemSettings, testSystem } from '../rules/test-system.ts';
import { PRONOUN_PRESETS } from '../rules/pronouns.ts';
import { phaseAt } from '../system/phases.ts';
import { MEETING_RULE, repairAnswer, ruleSchema, type RepairContext } from '../system/meeting.ts';
import { CHATTER_RULE, chatterSchema, repairChatter, type OfferedCard } from '../system/chatter.ts';
import { FILING_RULE, PATROL_RULE, filingPrompt, patrolPrompt, repairFiling, repairPatrol, type FilingInput, type PatrolInput } from '../system/judgment.ts';
import { APOLOGY_RULE, apologyPrompt, repairApology } from '../system/apology.ts';
import { repair } from '../system/validate.ts';

const H = 3_600_000;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const GAMES = '11111111-1111-4111-8111-111111111111';
const P1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

/** Every outcome a repair may give: accepted, or rejected naming a predicate. A throw of any other kind fails the test. */
const settled = (r: { ok?: boolean; predicate?: string }): void => {
  if (r.ok === false) assert.match(String(r.predicate), /\S/, 'a rejection names its predicate');
};

test('a string is "stub", repeated to its minLength; numbers are minimum or 0; booleans are false', () => {
  assert.equal(leastAnswer({ type: 'string' }), 'stub');
  assert.equal(leastAnswer({ type: 'string', minLength: 10 }), 'stubstubst');
  assert.equal(leastAnswer({ type: 'number' }), 0);
  assert.equal(leastAnswer({ type: 'integer', minimum: 3 }), 3);
  assert.equal(leastAnswer({ type: 'boolean' }), false);
  assert.equal(leastAnswer({ type: 'null' }), null);
});

test('an array is empty, or holds minItems of the least item; an object holds its required properties only', () => {
  assert.deepEqual(leastAnswer({ type: 'array', items: { type: 'string' } }), []);
  assert.deepEqual(leastAnswer({ type: 'array', items: { type: 'number' }, minItems: 2 }), [0, 0]);
  assert.deepEqual(leastAnswer({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a'] }), { a: 'stub' });
});

test('the first enum, the first of anyOf or oneOf, a const, and a schema with no type is an empty object', () => {
  assert.equal(leastAnswer({ type: 'string', enum: ['x', 'y'] }), 'x');
  assert.equal(leastAnswer({ anyOf: [{ type: 'number', minimum: 5 }, { type: 'string' }] }), 5);
  assert.equal(leastAnswer({ oneOf: [{ type: 'string' }] }), 'stub');
  assert.equal(leastAnswer({ const: 7 }), 7);
  assert.deepEqual(leastAnswer({}), {});
});

test('the meeting\'s schema gives an answer its repair accepts or rejects by name', () => {
  const schema = ruleSchema(MEETING_RULE);
  const answer = leastAnswer(schema);
  settled(repair(answer, MEETING_RULE));
  const settings = { ...systemSettings, reactionCap: 3 };
  const ctx: RepairContext = {
    settings, system: testSystem, boss: testSystem.firstBoss, phase: phaseAt({ startsAt: NOW - 30 * 24 * H, endsAt: NOW + 60 * 24 * H }, NOW, settings),
    bank: 5, now: NOW, boards: new Set([GAMES]), threads: new Set(), isPublic: () => false, successorAllowed: false, successors: new Set(), mods: new Set(), rules: [],
    groups: { conferred: new Map(), capped: new Set(), held: new Set() },
  };
  settled(repairAnswer(answer, ctx));
});

test('chatter\'s schema, asked for a title and offered cards, gives an answer repairChatter accepts or rejects by name', () => {
  const offered: OfferedCard[] = [{ key: 'whoops', name: 'Whoops!', play: 'cast' }, { key: 'bluffy', name: 'Bluffy', play: 'set' }];
  for (const askedTitle of [false, true]) {
    const answer = leastAnswer(chatterSchema({ askedTitle, offered }));
    settled(repair(answer, CHATTER_RULE));
    settled(repairChatter(answer, { postMaxLength: 200, titleMaxLength: 40, askedTitle, offered }));
  }
  const plain = leastAnswer(chatterSchema({ askedTitle: false, offered: [] }));
  assert.equal(repairChatter(plain, { postMaxLength: 200, titleMaxLength: 40, askedTitle: false, offered: [] }).ok, true);
});

const she = PRONOUN_PRESETS.she;
const base = {
  persona: { persona: 'You are Mod One.' }, pronouns: PRONOUN_PRESETS.they, order: 'Watch Games.',
  career: { led: [], offices: [{ office: 'mod', since: '2026-10-01T00:00:00Z', until: null, cause: 'seed' }] },
  memory: { hobby: { name: 'knitting', since: 'today', from: 'a friend' }, opinions: [], grudges: [], wheelhouse: [], realWorld: [], marks: [] },
  notes: [], rules: [{ board: GAMES, number: 2, predicate: 'noDoublePost', param: null, band: 'moderate' }],
  allowance: 2, beat: [{ id: GAMES, name: 'Games' }], ruleDaysMost: 7, expiryLeastHours: 24,
} as const;
const limits = { threadPosts: 8, excerptChars: 300, titleMaxLength: 100 };
const mctx = { allowance: 2, beat: [GAMES], ruleDaysMost: 7, expiryLeastHours: 24 };

test('a filing\'s schema, with and without a move on offer and in both modes, gives an answer repairFiling accepts or rejects by name', () => {
  const filing = (over: Partial<FilingInput> = {}): FilingInput => ({
    ...(base as unknown as FilingInput), board: { name: 'Games', premise: 'Talk about games.' }, thread: null,
    post: { name: 'Bob', pronouns: she, body: 'Odyssey.' }, charges: [{ rule: 'Rule 2', band: 'moderate', cause: 'rule' }], limits, ...over,
  });
  for (const over of [{}, { allowance: 0, beat: [] }, { mode: 'move' as const, said: 'Filed.' }]) {
    const { schema } = filingPrompt(filing(over));
    const answer = leastAnswer(schema);
    settled(repair(answer, FILING_RULE));
    const out = repairFiling(answer, mctx);
    assert.ok(out.dropped.every((d) => d.predicate.length > 0));
  }
});

test('a patrol\'s schema gives an answer repairPatrol accepts or rejects by name', () => {
  const patrol: PatrolInput = {
    ...(base as unknown as PatrolInput), rules: [], rulesShown: false,
    boards: [{ id: GAMES, name: 'Games', premise: 'Talk about games.', rules: base.rules as unknown as PatrolInput['boards'][number]['rules'] }],
    sample: [{ act: P1, thread: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', title: 'Best Mario game?', board: GAMES, name: 'Bob', pronouns: she, body: 'Odyssey.' }], limits,
  };
  const answer = leastAnswer(patrolPrompt(patrol).schema);
  assert.deepEqual((answer as { findings: unknown[] }).findings, []);
  settled(repair(answer, PATROL_RULE));
  const out = repairPatrol(answer, { ...mctx, sample: [{ act: P1, board: GAMES }], rulesOf: () => [] });
  assert.deepEqual(out.findings, []);
});

test('an apology\'s schema gives an answer repairApology accepts or rejects by name', () => {
  const { schema } = apologyPrompt({ persona: 'You are Mod One.' } as never, 'You put a bar on Ann.', 'Sorry.', 20);
  const answer = leastAnswer(schema);
  settled(repair(answer, APOLOGY_RULE));
  const out = repairApology(answer, 20);
  assert.ok(out.verdict !== null || out.dropped.every((d) => d.predicate.length > 0));
});
