import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences } from './match.ts';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';

const words = (text: string, phrase: string) => occurrences(text, phrase).map(({ from, to }) => text.slice(from, to));

test('whole words in any case: "cats" covers "Cats." and "CATS" but not "concatenate" or "cats2"', () => {
  assert.deepEqual(words('Cats. I love CATS, not concatenate or cats2 or scats.', 'cats'), ['Cats', 'CATS']);
});

test('a phrase of several words matches as written, and its occurrences never overlap', () => {
  assert.deepEqual(words('big cats and big cats', 'Big Cats'), ['big cats', 'big cats']);
  assert.deepEqual(occurrences('haha haha haha', 'haha haha'), [{ from: 0, to: 9 }]);
});

test('accented and non-Latin words match whole, and only whole', () => {
  assert.deepEqual(words('Café au lait, cafés, CAFÉ', 'café'), ['Café', 'CAFÉ']);
  assert.deepEqual(words('кошка и кошки, КОШКА', 'кошка'), ['кошка', 'КОШКА']);
  assert.deepEqual(words('数字 数字2', '数字'), ['数字']);
});

test('characters a regular expression gives meaning to are matched as themselves', () => {
  assert.deepEqual(words('a (b+c)* d and a bbc d', 'a (b+c)* d'), ['a (b+c)* d']);
});

test('read through the visible text: a quote\'s words are never matched, and bold across a word is', () => {
  const text = visibleText(parse('my ca[b]ts[/b] [quote=0f8fad5b-d9cb-469f-a165-70867728950e]cats[/quote] cats'));
  assert.equal(occurrences(text, 'cats').length, 2);
});

test('a phrase with no word in it matches nothing', () => {
  assert.deepEqual(occurrences('a ... b', '...'), []);
});

test('case folding is the matcher\'s simple one: ß is not SS, and an occurrence after a character outside the BMP has its offset in the string\'s units', () => {
  assert.deepEqual(words('STRASSE and straße', 'straße'), ['straße']);
  assert.deepEqual(occurrences('𝒜 cats', 'cats'), [{ from: 3, to: 7 }]);
});
