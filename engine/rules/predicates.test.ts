import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREDICATES, predicate, predicateProblems } from './predicates.ts';
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
