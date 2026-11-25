/** The plain words of a Mod's visit, a report it judged and an appeal it heard, in its moderation log (modlog.ts; `moves_log`, 0111). */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { didWords, endedModWords, isModAct, postOf } from './modlog.ts';

describe('the moderation log\'s words for a Mod\'s acts', () => {
  test('tells a visit, a report and an appeal from a move', () => {
    assert.deepEqual(['visit', 'report', 'appeal', 'request', 'renameBoard', 'setRule'].map((kind) => isModAct({ kind })), [true, true, true, true, false, false]);
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
    assert.deepEqual([null, 'filed', 'intercepted', 'trapped', 'reversed', 'dropped', 'odd'].map(visit), ['open', 'filed', 'talked down', 'ended by a trap', 'ended by an admin', 'dropped, never filed', 'ended']);
    const report = (outcome: string | null) => endedModWords({ kind: 'report', outcome, params: {} });
    assert.deepEqual(['visit', 'dismissed', 'backfire', null].map(report), ['sent a visit', 'dismissed', 'backfired onto the reporter', 'judged']);
    const visited = (outcome: string, v: boolean | undefined) => endedModWords({ kind: 'report', outcome, params: v === undefined ? {} : { visited: v } });
    assert.equal(visited('visit', false), 'judged a visit, but none opened');
    assert.equal(visited('backfire', false), 'backfired, but no visit opened');
    assert.deepEqual([visited('visit', true), visited('backfire', true), visited('visit', undefined), visited('backfire', undefined), visited('dismissed', false)], ['sent a visit', 'backfired onto the reporter', 'sent a visit', 'backfired onto the reporter', 'dismissed']);
    const appeal = (outcome: string | null, points_delta: number | null = null) => endedModWords({ kind: 'appeal', outcome, params: { points_delta } });
    assert.deepEqual([appeal('overturned'), appeal('upheld'), appeal('reduced', -1), appeal('reduced'), appeal('increased', 2), appeal(null)], ['overturned', 'upheld', 'reduced by 1', 'reduced', 'increased by 2', 'ruled on']);
  });

  /* A request a staff member ruled on (staff requests, design section 5): the glass's words, from the code's own facts; nothing a persona or the Boss wrote is in a row. */
  const asked = (ruling: string, by: string, extra: Record<string, unknown> = {}) => ({ kind: 'request', params: { thread: 'th-1', title: 'Best Mario game', post: 8, ruling, by, move_kind: ruling === 'fulfill' ? 'moveThread' : null, ruled: null, lapses_at: null, ...extra } });
  const said = (r: ReturnType<typeof asked>) => { const w = didWords(r); return `${w.before}[${w.thread}]${w.between}post #${postOf(r)}${w.after}`; };

  test('a request says what the staff member did with it, in four phrasings', () => {
    assert.equal(said(asked('fulfill', 'mod')), 'Granted a request in [Best Mario game] (post #8): moved a thread');
    assert.equal(said(asked('reject', 'mod')), 'Rejected a request in [Best Mario game] (post #8)');
    assert.equal(said(asked('confer', 'mod')), 'Passed a request in [Best Mario game] (post #8) to the Boss');
    assert.equal(said(asked('confer', 'boss')), 'Took a request in [Best Mario game] (post #8) to the meeting');
  });

  test('a request names a thread with no title as a thread, and a move this build has no words for plainly', () => {
    assert.equal(said(asked('reject', 'mod', { title: null })), 'Rejected a request in [a thread] (post #8)');
    assert.equal(said(asked('fulfill', 'boss', { move_kind: 'nonesuch' })), 'Granted a request in [Best Mario game] (post #8): made a move');
  });

  test('a request that waits says when it lapses, and then how it was ruled', () => {
    const waiting = { kind: 'request', outcome: null, params: { ruling: 'confer', by: 'mod', ruled: null, lapses_at: '2026-11-27T12:00:00Z' } };
    assert.equal(endedModWords(waiting), 'waiting, lapses Nov 27');
    assert.equal(endedModWords({ ...waiting, params: { ...waiting.params, lapses_at: null } }), 'waiting');
    const ended = (outcome: string) => endedModWords({ kind: 'request', outcome, params: { ruling: 'confer', by: 'mod', ruled: outcome, lapses_at: null } });
    assert.deepEqual(['fulfill', 'reject', 'lapsed'].map(ended), ['ruled: granted', 'ruled: refused', 'lapsed']);
  });

  test('a request ruled at once has nothing more to say about how it ended', () => {
    assert.equal(endedModWords({ kind: 'request', outcome: null, params: { ruling: 'reject', by: 'mod', ruled: 'reject' } }), '');
    assert.equal(endedModWords({ kind: 'request', outcome: null, params: { ruling: 'fulfill', by: 'boss', ruled: 'fulfill' } }), '');
  });
});
