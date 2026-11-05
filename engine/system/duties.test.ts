import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUTIES, DUTY_SPECS, staffFor } from './duties.ts';

test('every duty has a mode and a default tier', () => {
  for (const d of DUTIES) assert.ok(DUTY_SPECS[d].mode === 'chat' || DUTY_SPECS[d].mode === 'completion', d);
  assert.equal(DUTY_SPECS.meeting.tier, 'strong');
  assert.equal(DUTY_SPECS.standingOrderLine.mode, 'completion');
});

test('the pool\'s chatter is a light-tier chat duty', () => {
  assert.deepEqual(DUTY_SPECS.chatter, { mode: 'chat', tier: 'light' });
  assert.ok((DUTIES as readonly string[]).includes('chatter'));
});

test('staffFor returns the staff key the instance assigns the duty', () => {
  const instance = { system: { duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'beat', chatter: 'boss' } as const } };
  assert.equal(staffFor('meeting', instance), 'boss');
  assert.equal(staffFor('appeal', instance), 'beat');
});

test('staffFor throws, naming the duty, for one the instance leaves unassigned', () => {
  assert.throws(() => staffFor('renameJudge', { system: { duties: { meeting: 'boss' } } } as never), /renameJudge/);
  assert.throws(() => staffFor('meeting', {}), /meeting/);
});
