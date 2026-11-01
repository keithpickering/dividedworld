import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COUNT_MOST, DEMAND_KINDS, demandAsk, demandKind, demandProblems, demandWords } from './demands.ts';

const CAP = 3;
const board = '11111111-1111-4111-8111-111111111111';
const a = '22222222-2222-4222-8222-222222222222';
const b = '33333333-3333-4333-8333-333333333333';
const crossQuote = (reactions: unknown) => ({ kind: 'crossQuote', params: { a, b, reactions } });

test('a crossQuote with reactions at the cap is rejected, naming the predicate; at the cap plus one it passes', () => {
  const at = demandProblems(crossQuote(CAP), CAP);
  assert.equal(at.ok, false);
  assert.ok(!at.ok && at.path === 'demand.params.reactions' && at.predicate === `atLeast(${CAP + 1})`, JSON.stringify(at));
  assert.equal(demandProblems(crossQuote(CAP - 1), CAP).ok, false);
  const over = demandProblems(crossQuote(CAP + 1), CAP);
  assert.ok(over.ok, JSON.stringify(over));
  assert.deepEqual(over.ok && over.value, crossQuote(CAP + 1));
});

test('the threshold follows the cap an instance sets, and a quadrant demand is held to it as well', () => {
  assert.equal(demandProblems(crossQuote(4), 4).ok, false);
  assert.equal(demandProblems(crossQuote(4), 3).ok, true);
  const quadrant = (count: number) => ({ kind: 'quadrantOnBoard', params: { board, quadrant: 'excitedPositive', count } });
  assert.equal(demandProblems(quadrant(3), CAP).ok, false);
  assert.equal(demandProblems(quadrant(4), CAP).ok, true);
});

test('a demand outside the whitelist, or malformed, is rejected with the path and predicate that failed', () => {
  const no = (d: unknown) => {
    const r = demandProblems(d, CAP);
    assert.ok(!r.ok, JSON.stringify(d));
    return r;
  };
  assert.match(no({ kind: 'shout', params: {} }).predicate, /^oneOf\(postsOnBoard/);
  assert.equal(no(null).predicate, 'isObject');
  assert.equal(no({ kind: 'postsOnBoard', params: { board, count: 0 } }).predicate, 'atLeast(1)');
  assert.equal(no({ kind: 'postsOnBoard', params: { board, count: 1.5 } }).predicate, 'isWhole');
  assert.equal(no({ kind: 'postsOnBoard', params: { board, count: COUNT_MOST + 1 } }).predicate, `atMost(${COUNT_MOST})`);
  assert.equal(no({ kind: 'postsOnBoard', params: { board: 'not a uuid, but thirty-six characters long', count: 2 } }).predicate, 'isUuid');
  assert.equal(no({ kind: 'postsOnBoard', params: { count: 2 } }).predicate, 'required');
  assert.equal(no({ kind: 'quadrantOnBoard', params: { board, quadrant: 'smug', count: 9 } }).path, 'demand.params.quadrant');
});

test('every demand kind accepts a well-formed demand and renders its template as plain words', () => {
  const samples: Record<string, Record<string, unknown>> = {
    postsOnBoard: { board, count: 12 },
    distinctCharactersOnBoard: { board, count: 5 },
    quadrantOnBoard: { board, quadrant: 'calmPositive', count: 20 },
    characterPostsInThread: { character: a, thread: b },
    crossQuote: { a, b, reactions: 6 },
  };
  assert.deepEqual(DEMAND_KINDS.map((k) => k.key).sort(), Object.keys(samples).sort(), 'a kind added here needs a sample here');
  for (const k of DEMAND_KINDS) {
    const params = samples[k.key]!;
    assert.ok(demandProblems({ kind: k.key, params }, CAP).ok, `${k.key} accepts its sample`);
    for (const progress of [{ done: 0, of: 12 }, { done: 7, of: 12 }]) {
      const words = k.template(params, progress);
      assert.ok(words.trim().length > 0, `${k.key} renders something`);
      assert.doesNotMatch(words, /[{}]|undefined|NaN|\[object|null/, `${k.key} leaves nothing unfilled: ${words}`);
      assert.ok(words.includes(`${progress.done} of ${progress.of}`), `${k.key} says the progress: ${words}`);
    }
  }
});

test('the kinds in TypeScript are the kinds demand_progress has a case for (the two lists are one list)', () => {
  const sql = fs.readFileSync(path.join(import.meta.dirname, '../../supabase/migrations/0045_moves.sql'), 'utf8');
  const body = sql.slice(sql.indexOf('create function demand_progress'));
  const cases = [...body.matchAll(/^\s*when '([A-Za-z]+)' then/gm)].map((m) => m[1]!).sort();
  assert.deepEqual(cases, DEMAND_KINDS.map((k) => k.key).sort());
});

test('a crossQuote between a character and itself is rejected, naming the predicate', () => {
  const same = demandProblems({ kind: 'crossQuote', params: { a, b: a, reactions: CAP + 1 } }, CAP);
  assert.ok(!same.ok && same.path === 'demand.params.b' && same.predicate === 'distinctCharacters', JSON.stringify(same));
  const shouted = demandProblems({ kind: 'crossQuote', params: { a, b: a.toUpperCase(), reactions: CAP + 1 } }, CAP);
  assert.ok(!shouted.ok && shouted.predicate === 'distinctCharacters', 'the same uuid in capitals is the same character');
});

test('uuids in a demand are lowercased, as Postgres compares them, and not recorded as a trim', () => {
  const mixed = '11111111-1111-4111-8111-AAAAAAAAAAAA';
  const r = demandProblems({ kind: 'postsOnBoard', params: { board: mixed, count: 3 } }, CAP);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.ok && r.value, { kind: 'postsOnBoard', params: { board: mixed.toLowerCase(), count: 3 } });
  assert.equal(r.ok && r.trims.length, 0);
});

test('a demand reads in plain words with no progress for a move that has not landed, and with it for a move in force', () => {
  assert.equal(demandAsk({ kind: 'distinctCharactersOnBoard', params: { board, count: 8 } }), 'Needs 8 different characters to post on this board.');
  assert.equal(
    demandWords({ kind: 'distinctCharactersOnBoard', params: { board, count: 12 } }, { done: 7, of: 12 }),
    'Needs 12 different characters to post on this board: 7 of 12 so far.',
  );
  assert.match(demandAsk({ kind: 'shout', params: {} }), /plain word/u);
  for (const k of DEMAND_KINDS) assert.doesNotMatch(k.needs({ board, count: 5, quadrant: 'calmPositive', reactions: 6 }), /[{}]|undefined|NaN/u, k.key);
});

test('every demand kind names what it counts, for the glass\'s short way out, in capitals and in the singular for one', () => {
  for (const k of DEMAND_KINDS) {
    assert.match(k.unit.one, /^[A-Z ]+$/u, k.key);
    assert.match(k.unit.many, /^[A-Z ]+$/u, k.key);
    assert.notEqual(k.unit.one, k.unit.many, k.key);
  }
});

test('every demand kind says in a few plain words what met it', () => {
  const params = { board, count: 12, quadrant: 'calmPositive', reactions: 6 };
  for (const k of DEMAND_KINDS) assert.doesNotMatch(k.met(params), /[{}]|undefined|NaN/u, k.key);
  assert.equal(demandKind('distinctCharactersOnBoard')!.met(params), '12 posted');
});
