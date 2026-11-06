/**
 * footers.ts: the one line each characters form says beside its buttons, built from the form's state. Every variant a line can say is
 * listed here, so the copy the owner approves is exactly what these assertions pin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { debutFooter, newCharacterFooter, revealFooter } from './footers.ts';
import { untilWords } from './format.ts';

const base = { name: 'Waiting Wanda', className: 'Face' } as const;

test('New character says what making the character does, for each of the six ways it can debut', () => {
  const said = (timing: 'now' | 'tally', loudness: 'silent' | 'announced' | 'with_class', o: { name?: string; className?: string } = {}) => newCharacterFooter({ ...base, ...o, timing, loudness });
  assert.equal(said('now', 'announced'), 'Waiting Wanda is on the board as soon as you make it, and The System announces it. Its class stays yours alone.');
  assert.equal(said('now', 'silent'), 'Waiting Wanda is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays yours alone.');
  assert.equal(said('now', 'with_class'), "Waiting Wanda is on the board as soon as you make it, and The System announces it as a Face. That stays public, and can't be taken back.");
  assert.equal(said('tally', 'announced'), 'Waiting Wanda waits, seen by no one but you, and debuts at the next settlement, announced by The System. Its class stays yours alone.');
  assert.equal(said('tally', 'silent'), 'Waiting Wanda waits, seen by no one but you, and appears at the next settlement without a word. Its class stays yours alone.');
  assert.equal(said('tally', 'with_class'), "Waiting Wanda waits, seen by no one but you, and debuts at the next settlement, announced as a Face. That stays public, and can't be taken back.");
});

test('New character names no one yet and no class yet without breaking the sentence', () => {
  assert.equal(newCharacterFooter({ name: '  ', className: '', timing: 'now', loudness: 'announced' }), 'Your character is on the board as soon as you make it, and The System announces it. Its class stays yours alone.');
  assert.equal(newCharacterFooter({ name: 'Wanda', className: '', timing: 'now', loudness: 'with_class' }), "Wanda is on the board as soon as you make it, and The System announces it with the class you choose. That stays public, and can't be taken back.");
  assert.equal(newCharacterFooter({ name: 'Wanda', className: 'Underdog', timing: 'tally', loudness: 'with_class' }), "Wanda waits, seen by no one but you, and debuts at the next settlement, announced as an Underdog. That stays public, and can't be taken back.");
});

test('the Debut dialog says when the character debuts and that it can be dropped now, or what dropping does', () => {
  assert.equal(debutFooter({ name: 'Waiting Wanda', timing: 'tally', until: 'in 7 h 42 min' }), 'It debuts at the next settlement, in 7 h 42 min. Until then you can drop it now instead.');
  assert.equal(debutFooter({ name: 'Waiting Wanda', timing: 'tally', until: null }), 'It debuts at the next settlement. Until then you can drop it now instead.');
  assert.equal(debutFooter({ name: 'Waiting Wanda', timing: 'now', until: 'in 7 h 42 min' }), 'Waiting Wanda goes on the board at once and can post at once, instead of at the next settlement.');
});

test('the Reveal modal says one thing', () => {
  assert.equal(revealFooter(), 'The reveal is checked by The System and posted at once.');
});

test('untilWords counts a time off in the largest two units, never under a minute', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();
  const MIN = 60_000;
  assert.equal(untilWords(at(7 * 60 * MIN + 42 * MIN), now), 'in 7 h 42 min');
  assert.equal(untilWords(at(7 * 60 * MIN + 41 * MIN + 30_000), now), 'in 7 h 42 min', 'rounded up to the minute');
  assert.equal(untilWords(at(7 * 60 * MIN), now), 'in 7 h');
  assert.equal(untilWords(at(42 * MIN), now), 'in 42 min');
  assert.equal(untilWords(at(10_000), now), 'in 1 min');
  assert.equal(untilWords(at(-5 * MIN), now), 'in 1 min', 'a settlement that is due is a minute off at most');
  assert.equal(untilWords(at(27 * 60 * MIN + 30 * MIN), now), 'in 1 d 3 h');
  assert.equal(untilWords(at(48 * 60 * MIN), now), 'in 2 d');
});
