/**
 * THIS's own rules: its configuration, where it lands and its persona options.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORDS, thisCard } from './this.ts';
import { characters } from './phrase-bound.ts';
import { postTarget } from '../../../engine/rules/cards.ts';
import { defaults as settings } from '../settings.ts';
import { on, seenOf } from './test-kit.ts';

/* ---- THIS (docs/plans/2026-11-13-this-plan.md, Task 3) ---- */
const thisConfig = (phrase: unknown, words?: unknown) => thisCard.validateConfig(words === undefined ? { phrase } : { phrase, words });
const thisWhy = (v: unknown) => (v as { why: string }).why;

test('THIS is a common Pepperoni Cast on a post that stacks three deep, free to set', () => {
  assert.deepEqual([thisCard.key, thisCard.name, thisCard.alignment, thisCard.rarity, thisCard.reaches, thisCard.stack, thisCard.lasts], ['this', 'THIS', 'pepperoni', 'common', ['post'], 3, undefined]);
  assert.equal(thisCard.setPhrase?.({ phrase: 'Mario', words: 'this' }), 'Mario');
  assert.equal(thisCard.playPrice(settings, on('Mario'), { phrase: 'Mario', words: '' }), 0);
});

test('THIS\'s configuration: no words is nothing, the words are one line of at most 60 characters, and both are trimmed', () => {
  assert.deepEqual(thisConfig('Mario'), { ok: true, value: { phrase: 'Mario', words: '' } });
  assert.deepEqual(thisConfig('  Mario  ', '  so true  '), { ok: true, value: { phrase: 'Mario', words: 'so true' } });
  assert.equal(thisConfig('Mario', 'a'.repeat(WORDS.most)).ok, true);
  assert.equal(thisWhy(thisConfig('Mario', 'a'.repeat(WORDS.most + 1))), 'the words are at most 60 characters');
  assert.equal(thisConfig('Mario', '\u{1F600}'.repeat(60)).ok, true, 'sixty emoji are sixty characters');
  assert.equal(thisWhy(thisConfig('Mario', '\u{1F600}'.repeat(61))), 'the words are at most 60 characters');
  assert.equal(thisWhy(thisConfig('Mario', 'two\nlines')), 'the words are one line');
  assert.equal(thisWhy(thisConfig('two\nlines', 'ok')), 'the phrase is one line');
  assert.equal(thisWhy(thisConfig('a'.repeat(101))), 'the phrase is at most 100 characters');
  assert.equal(thisWhy(thisConfig('abc')), 'the phrase has at least 4 letters or digits');
  assert.equal(thisWhy(thisConfig(7)), 'the phrase is the words to point at');
  assert.equal(thisWhy(thisConfig('Mario', 7)), 'the words are what the note says after THIS');
  assert.equal(thisWhy(thisConfig('abc', 7)), 'the phrase has at least 4 letters or digits', 'the phrase is asked first');
  assert.deepEqual(thisCard.validateConfig({ phrase: 'Mario', words: '   ' }), { ok: true, value: { phrase: 'Mario', words: '' } }, 'words of only spaces are no words');
  assert.equal(thisWhy(thisConfig('Mario', 'one two')), 'the words are one line', 'a line separator is a line break');
  assert.equal(thisWhy(thisConfig('Mario', null)), 'the words are what the note says after THIS');
  assert.equal(thisCard.validateConfig(null).ok, false);
});

test('THIS lands on a post that holds its phrase, three deep, and on the caster\'s own post', () => {
  const cfg = { phrase: 'Mario', words: 'this' };
  const t = (n: number) => Array.from({ length: n }, (_, i) => ({ card: 'this', act: `t${i}` }));
  assert.equal(thisCard.canApply(on('I like Mario a lot'), [], cfg, new Date()).ok, true);
  assert.deepEqual(thisCard.canApply(on('I like Luigi'), [], cfg, new Date()), { ok: false, why: '“Mario” is not in this post\'s own words' });
  assert.equal(thisCard.canApply(on('Mario'), t(2), cfg, new Date()).ok, true);
  assert.deepEqual(thisCard.canApply(on('Mario'), t(3), cfg, new Date()), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
  assert.equal(thisCard.canApply(on('my own Mario post'), [], cfg, new Date()).ok, true, 'the caster\'s own post');
});

test('THIS with no configuration answers what landsOn does', () => {
  assert.equal(thisCard.canApply(on('anything'), [], undefined, new Date()).ok, true);
  assert.deepEqual(thisCard.canApply(on('x'), [{ card: 'this', act: 'a' }, { card: 'this', act: 'b' }, { card: 'this', act: 'c' }], undefined, new Date()), { ok: false, why: 'this post already carries 3 of that card, the most it takes' });
});

test('THIS\'s persona options: the words are trimmed to 60 characters at a word\'s end and the trim is named; nothing else is repaired', () => {
  const repair = (config: unknown, text = 'I like Mario a lot') => thisCard.repairStaff!(config, postTarget('p1', 'post', text), 'cast');
  const phrase = 'Mario';
  const sixtyOne = `${'a'.repeat(30)} ${'b'.repeat(30)}`;
  assert.equal(characters(sixtyOne), 61);
  assert.deepEqual(repair({ phrase, words: sixtyOne }), {
    config: { phrase, words: 'a'.repeat(30) },
    trims: [{ path: 'card.config.this.words', predicate: 'mostSixtyCharacters', before: 61, after: 30 }],
  });
  assert.deepEqual(repair({ phrase, words: 'c'.repeat(70) }), {
    config: { phrase, words: 'c'.repeat(60) },
    trims: [{ path: 'card.config.this.words', predicate: 'mostSixtyCharacters', before: 70, after: 60 }],
  });
  const sixty = { phrase, words: 'd'.repeat(60) };
  assert.deepEqual(repair(sixty), { config: sixty, trims: [] });
  const emoji = repair({ phrase, words: '\u{1F600}'.repeat(70) });
  assert.equal(characters((emoji.config as { words: string }).words), 60, 'cut by characters, never through a surrogate pair');
  assert.equal(thisConfig(phrase, (emoji.config as { words: string }).words).ok, true);
  const missing = { phrase: 'Luigi', words: 'fine' };
  assert.deepEqual(repair(missing), { config: missing, trims: [] });
  const verdict = thisCard.validateConfig(missing);
  assert.equal(verdict.ok, true);
  assert.equal(thisCard.canApply(on('I like Mario a lot'), [], (verdict as { value: { phrase: string; words: string } }).value, new Date()).ok, false);
  assert.deepEqual(repair({ phrase: 'ab', words: 'x' }), { config: { phrase: 'ab', words: 'x' }, trims: [] });
  assert.deepEqual(repair('nonsense'), { config: 'nonsense', trims: [] });
});

test('THIS says which words the arrow points at and what it says of them', () => {
  assert.equal(seenOf('this', { config: { phrase: 'Wiggler sprites', words: 'so true' } }), 'Wario pointed an arrow at “Wiggler sprites”, 2 days ago, with a note: “THIS so true”.');
  assert.match(seenOf('this', { config: { phrase: 'Wiggler sprites', words: '' }, by: null }), /^Someone pointed an arrow at “Wiggler sprites”, 2 days ago, with a note: “THIS”\.$/);
  assert.match(seenOf('this'), /some of the words in this post/);
});
