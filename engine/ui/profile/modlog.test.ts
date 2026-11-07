/** The plain words of a Mod's visit, a report it judged and an appeal it heard, in its moderation log (modlog.ts; `moves_log`, 0109). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { didWords, endedModWords, isModAct, postOf } from './modlog.ts';

describe('the moderation log\'s words for a Mod\'s acts', () => {
  test('tells a visit, a report and an appeal from a move', () => {
    assert.deepEqual(['visit', 'report', 'appeal', 'renameBoard', 'setRule'].map((kind) => isModAct({ kind })), [true, true, true, false, false]);
  });

  test('a visit says its rule, its band and what sent it', () => {
    assert.deepEqual(didWords({ kind: 'visit', params: { post: 41, rule: 'Rule 2: No double posting', band: 'minor', cause: 'rule' } }), { before: 'Visited ', after: ' (Rule 2: No double posting, minor)' });
    assert.equal(didWords({ kind: 'visit', params: { rule: null, rule_number: 3, band: 'severe', cause: 'report' } }).after, ' (Rule 3, severe), after a report');
    assert.equal(didWords({ kind: 'visit', params: { band: 'minor', cause: 'tail' } }).after, ' (minor), for Obstruction');
    assert.equal(didWords({ kind: 'visit', params: { cause: 'patrol' } }).after, ', on patrol');
    assert.equal(didWords({ kind: 'visit', params: { cause: 'backfire' } }).after, ', after a report backfired');
    assert.deepEqual(didWords({ kind: 'visit', params: {} }), { before: 'Visited ', after: '' });
  });

  test('a report and an appeal say what they were of', () => {
    assert.equal(didWords({ kind: 'report', params: { post: 4 } }).before, 'Judged a report of ');
    assert.equal(didWords({ kind: 'appeal', params: { punishment: 'ban' } }).before, 'Heard an appeal of a ban from ');
    assert.equal(didWords({ kind: 'appeal', params: { punishment: 'infraction' } }).before, 'Heard an appeal of warn points from ');
    assert.equal(postOf({ params: { post: 4 } }), 4);
    assert.equal(postOf({ params: { post: null } }), null);
  });

  test('how each ended, in a few plain words', () => {
    const visit = (outcome: string | null) => endedModWords({ kind: 'visit', outcome, params: {} });
    assert.deepEqual([null, 'filed', 'intercepted', 'trapped', 'reversed', 'odd'].map(visit), ['open', 'filed', 'talked down', 'ended by a trap', 'ended by an admin', 'ended']);
    const report = (outcome: string | null) => endedModWords({ kind: 'report', outcome, params: {} });
    assert.deepEqual(['visit', 'dismissed', 'backfire', null].map(report), ['sent a visit', 'dismissed', 'backfired onto the reporter', 'judged']);
    const appeal = (outcome: string | null, points_delta: number | null = null) => endedModWords({ kind: 'appeal', outcome, params: { points_delta } });
    assert.deepEqual([appeal('overturned'), appeal('upheld'), appeal('reduced', -1), appeal('reduced'), appeal('increased', 2), appeal(null)], ['overturned', 'upheld', 'reduced by 1', 'reduced', 'increased by 2', 'ruled on']);
  });
});
