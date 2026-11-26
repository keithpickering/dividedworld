/**
 * footers.ts: the one line each characters form says beside its buttons, built from the form's state. Every variant a line can say is
 * listed here, so the copy the owner approves is exactly what these assertions pin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { newCharacterFooter, revealFooter } from './footers.ts';
import { untilWords } from './format.ts';

const base = { name: 'Waiting Wanda', pronouns: PRONOUN_PRESETS.it } as const;
const she = PRONOUN_PRESETS.she;
const they = PRONOUN_PRESETS.they;

test('New character says what making the character does: it is on the board at once, nobody is told', () => {
  assert.equal(newCharacterFooter(base), 'Waiting Wanda is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays hidden from every other player.');
});

test('New character writes the character\'s own pronouns, verbs agreeing, for she/her and they/them', () => {
  assert.equal(newCharacterFooter({ ...base, pronouns: she }), 'Waiting Wanda is on the board as soon as you make her. Nobody is told, and her first post is her entrance. Her class stays hidden from every other player.');
  assert.equal(newCharacterFooter({ ...base, pronouns: they }), 'Waiting Wanda is on the board as soon as you make them. Nobody is told, and their first post is their entrance. Their class stays hidden from every other player.');
});

test('New character names no one yet without breaking the sentence, and says nothing of a debut', () => {
  const said = newCharacterFooter({ name: '  ', pronouns: PRONOUN_PRESETS.it });
  assert.equal(said, 'Your character is on the board as soon as you make it. Nobody is told, and its first post is its entrance. Its class stays hidden from every other player.');
  assert.doesNotMatch(said, /debut|settlement|Promo/u);
});

test('the Reveal overlay says one thing', () => {
  assert.equal(revealFooter('the game'), 'The reveal is checked by the game and posted at once.');
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
  assert.equal(untilWords(at(0), now), null, 'a settlement that is due has no countdown');
  assert.equal(untilWords(at(-5 * MIN), now), null, 'nor one that is past');
  assert.equal(untilWords(at(27 * 60 * MIN + 30 * MIN), now), 'in 1 d 3 h');
  assert.equal(untilWords(at(48 * 60 * MIN), now), 'in 2 d');
});
