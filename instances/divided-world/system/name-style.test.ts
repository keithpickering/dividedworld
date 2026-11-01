import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameStyle } from './name-style.ts';

test('the design\'s examples are in style', () => {
  for (const name of ['Pointless Toast Palace', 'Pirate Puns Palace', 'Pointless Post SATAN SATAN SATAN', 'Pointless Post Palace']) {
    assert.deepEqual(nameStyle(name), [], name);
  }
});

test('three words sharing a first letter are in style, whatever the case or the punctuation', () => {
  for (const name of ['Big Bad Bowser', 'sneaky snake society', 'Koopa, Kart & Karaoke Klub', '"Wario" Wants Waluigi']) assert.deepEqual(nameStyle(name), [], name);
});

test('a name that ends in a word alliterating with the two before it is in style, however long', () => {
  assert.deepEqual(nameStyle('The Official Mushroom Kingdom Mario Memes Mansion'), []);
});

test('a take on Pointless Post Palace is in style when it keeps two of its three words in place', () => {
  for (const name of ['Pointless Post Penthouse', 'Pointless Toast Palace', 'Mighty Post Palace', 'Pointless Post Of Doom']) {
    assert.deepEqual(nameStyle(name), [], name);
  }
});

test('a plain name fails, in plain words', () => {
  const problems = nameStyle('General Discussion');
  assert.ok(problems.length > 0);
  assert.match(problems.join(' '), /three words/);
});

test('a name with three words that do not share a letter fails and says why', () => {
  const problems = nameStyle('Mario Fan Games');
  assert.ok(problems.length > 0);
  assert.match(problems.join(' '), /first letter/);
  assert.match(problems.join(' '), /Pointless Post Palace/);
});

test('an empty or blank name fails', () => {
  assert.ok(nameStyle('').length > 0);
  assert.ok(nameStyle('   ').length > 0);
  assert.ok(nameStyle('--- !!!').length > 0);
});

test('only the last three words must alliterate; a near miss fails', () => {
  assert.ok(nameStyle('Pointless Pirate Puns Games').length > 0);
});
