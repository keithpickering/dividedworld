import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snippetParts } from './highlight.ts';

const t = (text: string) => ({ text, hit: false });
const h = (text: string) => ({ text, hit: true });

test('snippetParts: no marker is one plain part; an empty snippet is no part', () => {
  assert.deepEqual(snippetParts('just words'), [t('just words')]);
  assert.deepEqual(snippetParts(''), []);
});
test('snippetParts: a marked word is a hit between its plain neighbors', () => {
  assert.deepEqual(snippetParts('a <<big>> day'), [t('a '), h('big'), t(' day')]);
});
test('snippetParts: a marker at the start, at the end, or alone leaves no empty part', () => {
  assert.deepEqual(snippetParts('<<big>> day'), [h('big'), t(' day')]);
  assert.deepEqual(snippetParts('a <<big>>'), [t('a '), h('big')]);
  assert.deepEqual(snippetParts('<<big>>'), [h('big')]);
});
test('snippetParts: several hits, and adjacent hits, stay separate parts', () => {
  assert.deepEqual(snippetParts('<<a>> and <<b>>'), [h('a'), t(' and '), h('b')]);
  assert.deepEqual(snippetParts('<<a>><<b>>'), [h('a'), h('b')]);
});
test('snippetParts: an empty pair marks nothing', () => {
  assert.deepEqual(snippetParts('a <<>> b'), [t('a  b')]);
});
test('snippetParts: a closing marker with no opener is text', () => {
  assert.deepEqual(snippetParts('a >> b'), [t('a >> b')]);
  assert.deepEqual(snippetParts('<<x>> then >> y'), [h('x'), t(' then >> y')]);
});
test('snippetParts: an opener with no closer is text, and the words after it are not marked', () => {
  assert.deepEqual(snippetParts('a << b'), [t('a << b')]);
  assert.deepEqual(snippetParts('<<x>> then <<y'), [h('x'), t(' then <<y')]);
});
test('snippetParts: an opener inside a hit starts nothing: the first closer ends the hit, the inner opener is its text', () => {
  assert.deepEqual(snippetParts('<<a <<b>> c'), [h('a <<b'), t(' c')]);
});
test('snippetParts: a hit keeps its inner spaces', () => {
  assert.deepEqual(snippetParts('x <<y>> z << w >> v'), [t('x '), h('y'), t(' z '), h(' w '), t(' v')]);
});
