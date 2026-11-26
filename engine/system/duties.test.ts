import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUTIES, DUTY_SPECS, staffFor } from './duties.ts';

test('every duty has a mode and a default tier', () => {
  for (const d of DUTIES) assert.ok(DUTY_SPECS[d].mode === 'chat' || DUTY_SPECS[d].mode === 'completion', d);
  assert.equal(DUTY_SPECS.meeting.tier, 'strong');
  assert.deepEqual(DUTY_SPECS.standingOrderLine, { mode: 'chat', tier: 'light' });
});

test('the pool\'s chatter is a light-tier chat duty', () => {
  assert.deepEqual(DUTY_SPECS.chatter, { mode: 'chat', tier: 'light' });
  assert.ok((DUTIES as readonly string[]).includes('chatter'));
});

test('the Mod Bots\' calls are light-tier chat duties', () => {
  for (const d of ['filing', 'reportJudge', 'patrolJudge', 'apologyJudge'] as const) {
    assert.deepEqual(DUTY_SPECS[d], { mode: 'chat', tier: 'light' }, d);
    assert.ok((DUTIES as readonly string[]).includes(d), d);
  }
});

test('a persona\'s turn is a light-tier chat duty of its own, so the ledger prices the turns apart from the pool\'s picks', () => {
  assert.deepEqual(DUTY_SPECS.conversation, { mode: 'chat', tier: 'light' });
  assert.ok((DUTIES as readonly string[]).includes('conversation'));
});

test('the Roster Report\'s commentary is a light-tier chat duty of its own, so the ledger prices it apart from the meeting', () => {
  assert.deepEqual(DUTY_SPECS.roster, { mode: 'chat', tier: 'light' });
  assert.ok((DUTIES as readonly string[]).includes('roster'));
});

test('a quiz visit\'s question is a light-tier chat duty of its own', () => {
  assert.deepEqual(DUTY_SPECS.quizQuestion, { mode: 'chat', tier: 'light' });
  assert.ok((DUTIES as readonly string[]).includes('quizQuestion'));
});

test('staffFor returns the staff key the instance assigns the duty', () => {
  const instance = { system: { duties: { meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'beat', chatter: 'boss', filing: 'beat', reportJudge: 'beat', patrolJudge: 'beat', apologyJudge: 'beat', conversation: 'boss', roster: 'boss', quizQuestion: 'filer' } as const } };
  assert.equal(staffFor('meeting', instance), 'boss');
  assert.equal(staffFor('appeal', instance), 'beat');
});

test('staffFor throws, naming the duty, for one the instance leaves unassigned', () => {
  assert.throws(() => staffFor('renameJudge', { system: { duties: { meeting: 'boss' } } } as never), /renameJudge/);
  assert.throws(() => staffFor('meeting', {}), /meeting/);
});
