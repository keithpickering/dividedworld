import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personaPrompt } from './prompt.ts';
import { POSTING_OFFICES } from './pool.ts';

const offices = {
  boss: { premise: 'Boss premise.', answerRules: 'Boss rules.' },
  mod: { premise: 'Mod premise.', answerRules: 'Mod rules.' },
  member: { premise: 'Member premise.', answerRules: 'Member rules.' },
};
const withLines = { selfPrompt: 'I am Ann.', officeLines: { boss: 'Boss line.', member: 'Member line.' } };

test('a persona\'s prompt is its office\'s premise, its own words, its line for that office when it has one, then the office\'s answer rules', () => {
  assert.equal(personaPrompt({ offices }, withLines, 'boss'), 'Boss premise.\n\nI am Ann.\n\nBoss line.\n\nBoss rules.');
  assert.equal(personaPrompt({ offices }, withLines, 'member'), 'Member premise.\n\nI am Ann.\n\nMember line.\n\nMember rules.');
});

test('a line for another office never appears, and a persona with no office lines gets three parts', () => {
  const mod = personaPrompt({ offices }, withLines, 'mod');
  assert.equal(mod, 'Mod premise.\n\nI am Ann.\n\nMod rules.', 'it has no mod line');
  assert.ok(!mod.includes('Boss line.') && !mod.includes('Member line.'));
  assert.equal(personaPrompt({ offices }, { selfPrompt: 'I am Bo.' }, 'boss'), 'Boss premise.\n\nI am Bo.\n\nBoss rules.');
});

test('each posting office takes its own premise and rules', () => {
  for (const o of POSTING_OFFICES) {
    const text = personaPrompt({ offices }, { selfPrompt: 'x' }, o);
    assert.ok(text.includes(offices[o].premise) && text.includes(offices[o].answerRules), o);
    for (const other of POSTING_OFFICES.filter((p) => p !== o)) assert.ok(!text.includes(offices[other].premise) && !text.includes(offices[other].answerRules), `${o} holds ${other}'s`);
  }
});
