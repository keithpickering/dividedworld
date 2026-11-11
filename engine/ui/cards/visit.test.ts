/** The glass's words for a visit (visit.ts): each outcome's mark, tab and label, a notice's rule, and the quiz's terms. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import type { VisitCharge, VisitOutcome } from '../data/api.ts';
import { markLabel, markText, noticeWords, tabName, tryTerms } from './visit.ts';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const ENDS = '2026-11-11T14:41:00Z';
const THEY = PRONOUN_PRESETS.they;
const charge = (over: Partial<VisitCharge> = {}): VisitCharge => ({ rule: 'Rule 2: No double posting', ruleNumber: 2, band: 'minor', cause: 'rule', ...over });

describe('a visit ended each way, in words', () => {
  const OUTCOMES: readonly VisitOutcome[] = ['filed', 'intercepted', 'trapped', 'reversed', 'dropped'];
  test('the mark says how it ended', () => {
    assert.deepEqual(OUTCOMES.map((o) => markText(o, ENDS, NOW)), ['Filed', 'Talked down', 'Trapped', 'Ended', 'Dropped']);
    assert.equal(markText('open', ENDS, NOW), '2:41');
  });
  test('the Lens tab says how it ended', () => {
    assert.deepEqual(OUTCOMES.map(tabName), ['Filed', 'Talked down', 'Trapped', 'Ended', 'Dropped']);
    assert.equal(tabName('open'), 'On a visit');
  });
  test('the mark is labeled with the Mod and how it ended; a dropped visit is not an admin\'s end', () => {
    assert.equal(markLabel('The Clerk', THEY, 'dropped', ENDS, NOW), "The Clerk's visit to this post could not be filed and was dropped. Opens the visit.");
    assert.equal(markLabel('The Clerk', THEY, 'reversed', ENDS, NOW), "The Clerk's visit to this post was ended by an admin. Opens the visit.");
    assert.equal(markLabel('The Clerk', THEY, 'filed', ENDS, NOW), 'The Clerk filed their visit to this post. Opens the visit.');
    assert.equal(markLabel('The Clerk', THEY, 'intercepted', ENDS, NOW), "The Clerk's visit to this post was talked down. Opens the visit.");
    assert.equal(markLabel('The Clerk', THEY, 'trapped', ENDS, NOW), "The Clerk's visit to this post was trapped, ended by a trap. Opens the visit.");
  });
});

describe('the notice a filed visit leaves', () => {
  test('a rule that names its number is said once', () => {
    assert.equal(noticeWords([charge()]), 'This post was found in violation of Rule 2: No double posting.');
  });
  test('a house rule is not given a second number', () => {
    assert.equal(noticeWords([charge({ rule: 'House Rule 1: Be kind', ruleNumber: 1 })]), 'This post was found in violation of House Rule 1: Be kind.');
  });
  test('a number with plain words gets the number in front', () => {
    assert.equal(noticeWords([charge({ rule: 'No double posting' })]), 'This post was found in violation of Rule 2: No double posting.');
  });
  test('no number says the words, or the premise', () => {
    assert.equal(noticeWords([charge({ rule: 'Keep it on topic', ruleNumber: null })]), 'This post was found in violation of Keep it on topic.');
    assert.equal(noticeWords([charge({ rule: null, ruleNumber: null })]), "This post was found in violation of the board's premise.");
  });
  test('a tail and a backfire say what they were', () => {
    assert.equal(noticeWords([charge({ rule: null, ruleNumber: null, cause: 'tail' })]), 'This post was found in violation of Obstruction.');
    assert.equal(noticeWords([charge({ cause: 'backfire' })]), "This post was found to be a waste of the staff's time.");
  });
});

describe('the quiz\'s terms', () => {
  test('say what an answer other than the Mod\'s costs, and that there is no timer', () => {
    assert.equal(tryTerms('The Clerk', 'Pipewrench', 24, 2), "One try for Pipewrench. An answer other than The Clerk's, and The Clerk visits Pipewrench's next post within 24 hours, charging Obstruction (minor, 2 warn points). There is no timer.");
  });
});
