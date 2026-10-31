import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUTIES, DUTY_SPECS, staffFor } from './duties.ts';

test('every duty has a mode and a default tier', () => {
  for (const d of DUTIES) assert.ok(DUTY_SPECS[d].mode === 'chat' || DUTY_SPECS[d].mode === 'completion', d);
  assert.equal(DUTY_SPECS.meeting.tier, 'strong');
  assert.equal(DUTY_SPECS.standingOrderLine.mode, 'completion');
});

test('staffFor returns the staff key the instance assigns the duty', () => {
  const instance = { system: { duties: { meeting: 'director', appeal: 'bot' } } };
  assert.equal(staffFor('meeting', instance), 'director');
  assert.equal(staffFor('appeal', instance), 'bot');
});

test('staffFor throws, naming the duty, for one the instance leaves unassigned', () => {
  assert.throws(() => staffFor('renameJudge', { system: { duties: { meeting: 'director' } } }), /renameJudge/);
  assert.throws(() => staffFor('meeting', {}), /meeting/);
});
