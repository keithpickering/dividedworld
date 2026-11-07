import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREDICATES, predicate, predicateProblems, ruleConflict, type RuleInForce } from './predicates.ts';
import { BBCODE_TAGS } from '../bbcode/parse.ts';

const keys = ['minLength', 'maxLength', 'noAllCaps', 'noDoublePost', 'noNecropost', 'noDuplicateTitle', 'bannedWord', 'requiredWord', 'noTag', 'repliesOnly'];

test('the list is the design\'s ten, once each, with a kind of parameter', () => {
  assert.deepEqual(PREDICATES.map((p) => p.key), keys);
  assert.deepEqual(PREDICATES.map((p) => p.param), ['count', 'count', 'none', 'none', 'count', 'none', 'word', 'word', 'tag', 'none']);
});

test('a count is held to its key\'s bounds: minLength 1-200, maxLength 20-20000, noNecropost 1-365', () => {
  const edges: [string, number, number][] = [['minLength', 1, 200], ['maxLength', 20, 20000], ['noNecropost', 1, 365]];
  for (const [key, least, most] of edges) {
    assert.equal(predicateProblems(key, least), null, `${key} ${least}`);
    assert.equal(predicateProblems(key, most), null, `${key} ${most}`);
    assert.equal(predicateProblems(key, least - 1)?.predicate, `atLeast(${least})`, `${key} below`);
    assert.equal(predicateProblems(key, most + 1)?.predicate, `atMost(${most})`, `${key} above`);
    assert.equal(predicateProblems(key, 2.5)?.predicate, 'isInteger', `${key} fraction`);
    assert.equal(predicateProblems(key, '5')?.predicate, 'isInteger', `${key} text`);
    assert.equal(predicateProblems(key, null)?.predicate, 'required', `${key} none`);
    assert.equal(predicateProblems(key, Number.NaN)?.predicate, 'isInteger', `${key} NaN`);
  }
});

test('a word is 1 to 40 characters with no spaces', () => {
  for (const key of ['bannedWord', 'requiredWord']) {
    assert.equal(predicateProblems(key, 'toast'), null);
    assert.equal(predicateProblems(key, 'x'.repeat(40)), null);
    assert.equal(predicateProblems(key, 'x'.repeat(41))?.predicate, 'atMost(40)');
    assert.equal(predicateProblems(key, '')?.predicate, 'atLeast(1)');
    assert.equal(predicateProblems(key, 'two words')?.predicate, 'noSpaces');
    assert.equal(predicateProblems(key, 'tab\there')?.predicate, 'noSpaces');
    assert.equal(predicateProblems(key, 7)?.predicate, 'isString');
    assert.equal(predicateProblems(key, null)?.predicate, 'required');
  }
});

test('a tag is one the BBCode parser knows', () => {
  for (const tag of BBCODE_TAGS) assert.equal(predicateProblems('noTag', tag), null, tag);
  assert.ok(BBCODE_TAGS.includes('img') && BBCODE_TAGS.includes('quote'));
  assert.equal(predicateProblems('noTag', 'blink')?.predicate, `oneOf(${BBCODE_TAGS.join(', ')})`);
  assert.equal(predicateProblems('noTag', '[b]')?.predicate, `oneOf(${BBCODE_TAGS.join(', ')})`);
  assert.equal(predicateProblems('noTag', null)?.predicate, 'required');
});

test('a predicate with no parameter takes none', () => {
  for (const key of ['noAllCaps', 'noDoublePost', 'noDuplicateTitle', 'repliesOnly']) {
    assert.equal(predicateProblems(key, null), null);
    assert.equal(predicateProblems(key, undefined), null);
    assert.equal(predicateProblems(key, 3)?.predicate, 'noParam', key);
  }
});

test('an unknown key is named', () => {
  const p = predicateProblems('noPoison', null);
  assert.deepEqual(p, { path: 'predicate', predicate: `oneOf(${keys.join(', ')})` });
  assert.equal(predicate('noPoison'), undefined);
});

test('every predicate says itself in plain words with nothing unfilled', () => {
  const sample: Record<string, unknown> = { count: 5, word: 'toast', tag: 'img', none: null };
  for (const p of PREDICATES) {
    const words = p.plain(sample[p.param]);
    assert.ok(words.trim() !== '' && !/[{}]|undefined|null/.test(words), `${p.key}: ${words}`);
  }
  assert.equal(predicate('noDoublePost')!.plain(null), 'no double posting');
  assert.match(predicate('minLength')!.plain(5), /5/);
  assert.match(predicate('bannedWord')!.plain('toast'), /toast/);
});

const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const inForce = (board: string | null, predicate: string, param: unknown, number = 1): RuleInForce => ({ board, predicate, param, number });

test('ruleConflict mirrors the database: the same pairs on the boards they share, and nothing else', () => {
  assert.equal(ruleConflict([], B1, 'bannedWord', 'toast'), null);
  assert.match(ruleConflict([inForce(B1, 'bannedWord', 'Toast', 2)], B1, 'requiredWord', 'toast')!, /Rule 2 bans the word "Toast", which this rule would require/);
  assert.match(ruleConflict([inForce(B1, 'requiredWord', 'toast')], B1, 'bannedWord', 'TOAST')!, /requires the word/);
  assert.match(ruleConflict([inForce(B1, 'maxLength', 100)], B1, 'minLength', 101)!, /allows at most 100/);
  assert.equal(ruleConflict([inForce(B1, 'maxLength', 100)], B1, 'minLength', 100), null);
  assert.match(ruleConflict([inForce(B1, 'minLength', 50)], B1, 'maxLength', 49)!, /requires at least 50/);
  assert.match(ruleConflict([inForce(B1, 'noAllCaps', null, 3)], B1, 'noAllCaps', null)!, /Rule 3 already says that/);
  assert.match(ruleConflict([inForce(B1, 'bannedWord', 'Toast')], B1, 'bannedWord', 'toast')!, /already says that/);
  // A rule on another board does not meet this one; a house rule meets every board's; a board's rule and a house rule may both say it.
  assert.equal(ruleConflict([inForce(B2, 'bannedWord', 'toast')], B1, 'requiredWord', 'toast'), null);
  assert.match(ruleConflict([inForce(null, 'bannedWord', 'toast', 4)], B1, 'requiredWord', 'toast')!, /a house rule bans/);
  assert.equal(ruleConflict([inForce(null, 'noAllCaps', null)], B1, 'noAllCaps', null), null);
  assert.match(ruleConflict([inForce(B2, 'bannedWord', 'toast')], null, 'requiredWord', 'toast')!, /Rule 1 bans/);
});
