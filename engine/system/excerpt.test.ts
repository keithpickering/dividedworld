import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excerpt, EXCERPT_WORDS } from './excerpt.ts';

test('a text at or under the bound, not cut, comes back on one line and unchanged', () => {
  assert.equal(excerpt('It was me all along', 40), 'It was me all along');
  assert.equal(excerpt('one\n two\t three', 40), 'one two three');
  assert.equal(excerpt('abcde', 5), 'abcde');
});

test('a text over the bound is cut at a word, ends in an ellipsis and is never longer than the bound plus one', () => {
  const out = excerpt('I made Plumber Platformer and it is great', 20);
  assert.equal(out, 'I made Plumber…');
  assert.ok(out.length <= 21);
  const solid = excerpt('x'.repeat(50), 10);
  assert.equal(solid, `${'x'.repeat(10)}…`);
});

test('a text under the bound that the source already cut ends in an ellipsis, back to its last whole word', () => {
  assert.equal(excerpt('I made Plumber Platfo', 1000, true), 'I made Plumber…');
  assert.equal(excerpt('Platfo', 1000, true), 'Platfo…');
});

test('the sentence that says what an ellipsis means is fixed', () => {
  assert.equal(EXCERPT_WORDS, 'An excerpt that ends in … was shortened by the game for space; its author wrote more.');
});

test('an empty or blank text stays empty, cut or not', () => {
  assert.equal(excerpt('', 10), '');
  assert.equal(excerpt('   \n ', 10, true), '');
});
