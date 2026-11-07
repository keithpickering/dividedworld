import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRONOUN_FORMS, PRONOUN_PRESETS, ENGINE_DEFAULT_PRONOUNS, normalizePronouns, presetOf, pronounLabel, pronounProblems, selfPronounLine, words } from './pronouns.ts';
import type { PronounSet } from './pronouns.ts';

const xe: PronounSet = { subject: 'xe', object: 'xem', determiner: 'xyr', possessive: 'xyrs', reflexive: 'xemself', plural: false };

test('every preset passes, and the engine default is it/its', () => {
  assert.deepEqual(Object.keys(PRONOUN_PRESETS), ['it', 'he', 'she', 'they']);
  for (const [k, set] of Object.entries(PRONOUN_PRESETS)) assert.deepEqual(pronounProblems(set), [], k);
  assert.deepEqual(pronounProblems(xe), []);
  assert.equal(ENGINE_DEFAULT_PRONOUNS, PRONOUN_PRESETS.it);
  assert.equal(PRONOUN_PRESETS.they.plural, true);
  assert.equal(PRONOUN_PRESETS.she.possessive, 'hers');
});

test('the words agree with the set', () => {
  assert.equal(PRONOUN_FORMS.length, 15);
  assert.equal(words(PRONOUN_PRESETS.they).is, 'are');
  assert.equal(words(PRONOUN_PRESETS.it).is, 'is');
  assert.equal(words(PRONOUN_PRESETS.it).s, 's');
  assert.equal(words(PRONOUN_PRESETS.they).s, '');
  assert.equal(words(PRONOUN_PRESETS.she).Their, 'Her');
  assert.equal(words(PRONOUN_PRESETS.they).was, 'were');
  assert.equal(words(PRONOUN_PRESETS.they).has, 'have');
  assert.equal(words(PRONOUN_PRESETS.he).does, 'does');
  assert.equal(words(PRONOUN_PRESETS.he).themself, 'himself');
  assert.equal(words(PRONOUN_PRESETS.it).Themself, 'Itself');
  assert.deepEqual(Object.keys(words(PRONOUN_PRESETS.he)).sort(), [...PRONOUN_FORMS].sort());
  assert.ok(Object.isFrozen(words(PRONOUN_PRESETS.he)));
});

test('labels, and which preset a set is', () => {
  assert.equal(pronounLabel(PRONOUN_PRESETS.he), 'he/him');
  assert.equal(pronounLabel(PRONOUN_PRESETS.she), 'she/her');
  assert.equal(pronounLabel(PRONOUN_PRESETS.they), 'they/them');
  assert.equal(pronounLabel(PRONOUN_PRESETS.it), 'it/its');
  assert.equal(pronounLabel(xe), 'xe/xem');
  assert.equal(presetOf(PRONOUN_PRESETS.she), 'she');
  assert.equal(presetOf(xe), null);
  assert.equal(presetOf({ ...PRONOUN_PRESETS.he, subject: 'HE ' }), 'he');
  assert.deepEqual(normalizePronouns({ ...xe, subject: ' Xe ' }), xe);
  assert.equal(selfPronounLine(PRONOUN_PRESETS.she), 'Your pronouns are she/her (she, her, her, hers, herself).');
});

test('each poison is refused with its predicate named', () => {
  const bad = (patch: Record<string, unknown>) => pronounProblems({ ...PRONOUN_PRESETS.they, ...patch }).join(' | ');
  assert.match(bad({ subject: 'abcdefghijklm' }), /subject has 13 characters; at most 12/);
  assert.match(bad({ object: '' }), /object is empty/);
  assert.match(bad({ subject: 'they ' }), /subject holds a space/);
  assert.match(bad({ subject: 'x​y' }), /subject holds a character that is not a letter \(U\+200B\)/);
  assert.match(bad({ determiner: '-xe' }), /determiner has a hyphen that is not between two letters/);
  assert.match(bad({ possessive: "xe'" }), /possessive has an apostrophe that is not between two letters/);
  assert.match(bad({ subject: 'x3' }), /subject holds a character that is not a letter \(U\+0033\)/);
  assert.match(bad({ plural: 'yes' }), /plural is not true or false/);
  assert.match(bad({ subject: 7 }), /subject is not text/);
  assert.match(pronounProblems({ subject: 'a', object: 'b', determiner: 'c', possessive: 'd', plural: true }).join('|'), /no reflexive/);
  assert.match(bad({ extra: 'x' }), /"extra", which is not a form/);
  assert.match(pronounProblems(null).join('|'), /not an object/);
  assert.match(pronounProblems([]).join('|'), /not an object/);
  assert.deepEqual(pronounProblems({ ...xe, subject: "x’e", object: 'xem-xem' }), []);
});
