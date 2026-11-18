import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modBotDrafts } from './drafts.ts';
import { system } from '../../index.ts';
import { MOD_BOT_PREMISE, MOD_BOT_ANSWER_RULES } from '../../persona.ts';
import { instance } from '../../../index.ts';
import { instanceProblems } from '../../../../../engine/rules/instance.ts';
import { predicate } from '../../../../../engine/rules/predicates.ts';

test('eight drafts, each with its own key, name, signature, temperament, hobby and prompt, and none a placeholder', () => {
  assert.equal(modBotDrafts.length, 8);
  for (const field of ['key', 'name', 'signature', 'temperament', 'startingHobby', 'persona', 'persuadedBy'] as const) {
    assert.equal(new Set(modBotDrafts.map((p) => p[field])).size, modBotDrafts.length, field);
  }
  for (const p of modBotDrafts) assert.doesNotMatch(`${p.key} ${p.name} ${p.title}`, /placeholder/i, p.key);
  const taken = new Set(system.roster.map((p) => p.key));
  for (const p of modBotDrafts) assert.ok(!taken.has(p.key), `${p.key} is not already in the roster`);
});

test('every draft is built on the Mod Bot premise and closes on the Mod Bot answer rules', () => {
  for (const p of modBotDrafts) {
    assert.ok(p.persona.startsWith(MOD_BOT_PREMISE), p.key);
    assert.ok(p.persona.endsWith(MOD_BOT_ANSWER_RULES), p.key);
    assert.ok(p.persona.includes(`You are ${p.name}, ${p.title}.`), p.key);
  }
});

test('the roster with the drafts added raises no problem the engine knows of', () => {
  const withDrafts = { ...instance, system: { ...system, roster: [...system.roster, ...modBotDrafts], firstStaff: [...system.firstStaff, ...modBotDrafts.map((p) => p.key)] } };
  assert.deepEqual(instanceProblems(withDrafts), []);
});

test('every draft lobbies for at least two known predicates, visits inside the settings\' hours and pushes for bands the warn bar has', () => {
  const { modBots, warnBar } = instance.settings;
  for (const p of modBotDrafts) {
    assert.ok(p.petRules.length >= 2, p.key);
    for (const k of p.petRules) assert.ok(predicate(k) !== undefined, `${p.key}: ${k}`);
    const { least, most } = p.strictness.visitHours;
    assert.ok(least >= modBots.visitHours.least && most <= modBots.visitHours.most && least <= most, p.key);
    assert.ok(p.strictness.bands.length >= 1, p.key);
    for (const b of p.strictness.bands) assert.ok(b in warnBar.bands, `${p.key}: ${b}`);
    for (const b of p.beats) assert.ok(instance.boards.some((board) => board.slug === b), `${p.key}: ${b}`);
  }
});

test('the drafts spread across the three weaknesses', () => {
  const kinds = modBotDrafts.map((p) => p.weakness.kind);
  for (const k of ['quiz', 'bribe', 'distraction']) assert.ok(kinds.filter((x) => x === k).length >= 2, k);
});

test('every quiz has at least five questions, each answer is one of its trimmed, distinct choices, and no position holds more than a third of the answers', () => {
  for (const p of modBotDrafts) {
    if (p.weakness.kind !== 'quiz') continue;
    const qs = p.weakness.questions;
    assert.ok(qs.length >= 5, p.key);
    for (const q of qs) {
      assert.ok(q.choices.includes(q.answer), `${p.key}: ${q.question}`);
      assert.ok(q.choices.length >= 2 && q.choices.length <= 8, `${p.key}: ${q.question}`);
      assert.equal(new Set(q.choices).size, q.choices.length, `${p.key}: ${q.question}`);
      assert.ok(q.choices.every((c) => c === c.trim()), `${p.key}: ${q.question}`);
    }
    const at = qs.map((q) => q.choices.indexOf(q.answer));
    const most = Math.max(...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => at.filter((a) => a === i).length));
    assert.ok(most <= Math.ceil(qs.length / 3), `${p.key}: positions ${at.join(',')}`);
  }
});

test('no draft\'s startingHobby, persuadedBy or temperament refers to the persona as it, its or itself, so its pronouns can change without a sweep', () => {
  for (const p of modBotDrafts) {
    for (const field of ['startingHobby', 'persuadedBy', 'temperament'] as const) assert.doesNotMatch(p[field], /\b(it|its|itself)\b/i, `${p.key}.${field}`);
  }
});
