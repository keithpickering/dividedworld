import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APOLOGY_RULE, APOLOGY_VERDICTS, apologyPrompt, repairApology } from './apology.ts';
import type { Persona } from '../rules/types.ts';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');

test('a verdict in the list passes, its ruling kept', () => {
  assert.deepEqual(repairApology({ verdict: 'accepted', ruling: 'Fine. Go.' }, 80), { verdict: 'accepted', ruling: 'Fine. Go.', trims: [], dropped: [] });
  assert.equal(repairApology({ verdict: ' Rejected ', ruling: 'No.' }, 80).verdict, 'rejected');
  assert.deepEqual([...APOLOGY_VERDICTS], ['accepted', 'rejected']);
});

test('a verdict outside the list is rejected, naming oneOf', () => {
  const r = repairApology({ verdict: 'maybe', ruling: 'We shall see.' }, 80);
  assert.equal(r.verdict, null);
  assert.deepEqual(r.dropped, [{ path: 'verdict', predicate: 'oneOf(accepted, rejected)' }]);
  assert.equal(repairApology('accepted', 80).verdict, null);
});

test('a ruling of 81 words is trimmed to 80 and the trim recorded', () => {
  const r = repairApology({ verdict: 'accepted', ruling: words(81) }, 80);
  assert.equal(r.verdict, 'accepted');
  assert.equal(r.ruling, words(80));
  assert.deepEqual(r.trims, [{ path: 'ruling', predicate: 'maxWords(80)', before: 81, after: 80 }]);
});

test('a ruling of 80 words is kept whole, and a blank ruling is rejected naming atLeast', () => {
  assert.deepEqual(repairApology({ verdict: 'rejected', ruling: words(80) }, 80).trims, []);
  const r = repairApology({ verdict: 'rejected', ruling: '  ' }, 80);
  assert.equal(r.verdict, null);
  assert.deepEqual(r.dropped, [{ path: 'ruling', predicate: 'atLeast(1)' }]);
});

test('the shape the model layer repairs against passes anything, so a bad answer costs nothing there', () => {
  assert.equal(APOLOGY_RULE.type, 'object');
});

const persona = { persona: 'You are the Monitor, dry and fair.' } as Persona;
test('the prompt carries the voice, the move in words, the apology and both verdicts, and no owner', () => {
  const p = apologyPrompt(persona, 'Ann was made Pariah on Games.', 'I am sorry I bumped.', 80);
  assert.match(p.system, /dry and fair/);
  assert.match(p.system, /accepted/);
  assert.match(p.system, /rejected/);
  assert.match(p.system, /80 words/);
  assert.match(p.message, /Ann was made Pariah on Games\./);
  assert.match(p.message, /I am sorry I bumped\./);
  assert.doesNotMatch(p.system + p.message, /owner|class/i);
  assert.deepEqual((p.schema as any).properties.verdict.enum, ['accepted', 'rejected']);
});
