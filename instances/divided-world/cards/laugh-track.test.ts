/**
 * Laugh Track's repair of a persona's cues (plan 2026-11-11, Task 10): each predicate, none left, and a player's play never repaired.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CUES, PLACES, laughTrack, type Cue } from './laugh-track.ts';
import { decidePlay, postTarget } from '../../../engine/rules/cards.ts';
import { defaults as settings } from '../settings.ts';

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echoes', 'foxtrot', 'golfing', 'hotel'];
const target = (text: string) => postTarget('p1', 'post', text);
const cue = (phrase: string, sound: Cue['sound'] = 'laugh'): Cue => ({ phrase, sound });
const PATH = 'card.config.laugh-track.cues';
const repair = (cues: unknown, text = WORDS.join(' ')) => laughTrack.repairStaff!({ cues }, target(text));

test('cueShape drops a cue that is not a phrase and a known sound', () => {
  const out = repair([cue('alpha'), { phrase: 'bravo', sound: 'gasp' }, { phrase: 7, sound: 'boo' }, null, 'charlie', cue('delta', 'cheer')]);
  assert.deepEqual(out.config, { cues: [cue('alpha'), cue('delta', 'cheer')] });
  assert.deepEqual(out.trims, [{ path: PATH, predicate: 'cueShape', before: 6, after: 2 }]);
});

test('phraseNotInPost drops a cue whose phrase is not in the post', () => {
  const out = repair([cue('alpha'), cue('banana split'), cue('bravo')]);
  assert.deepEqual(out.config, { cues: [cue('alpha'), cue('bravo')] });
  assert.deepEqual(out.trims, [{ path: PATH, predicate: 'phraseNotInPost', before: 3, after: 2 }]);
});

test('overlapsEarlierCue drops a repeat of an earlier cue\'s words and a cue over an earlier kept cue\'s places, and keeps the earlier', () => {
  const out = repair([cue('alpha bravo'), cue('ALPHA  bravo', 'boo'), cue('bravo charlie'), cue('delta')]);
  assert.deepEqual(out.config, { cues: [cue('alpha bravo'), cue('delta')] });
  assert.deepEqual(out.trims, [{ path: PATH, predicate: 'overlapsEarlierCue', before: 4, after: 2 }]);
});

test('mostFiveCues keeps the first five', () => {
  const out = repair(WORDS.slice(0, 7).map((w) => cue(w)));
  assert.deepEqual((out.config as { cues: Cue[] }).cues.map((c) => c.phrase), WORDS.slice(0, 5));
  assert.deepEqual(out.trims, [{ path: PATH, predicate: 'mostFiveCues', before: 7, after: 5 }]);
});

test('mostThirtyPlaces drops cues from the end while the places pass thirty, and never the last cue', () => {
  const text = `${'zing '.repeat(PLACES.most)}${'zap '.repeat(3)}`;
  const out = repair([cue('zing'), cue('zap')], text);
  assert.deepEqual(out.config, { cues: [cue('zing')] });
  assert.deepEqual(out.trims, [{ path: PATH, predicate: 'mostThirtyPlaces', before: 2, after: 1 }]);
  const alone = repair([cue('zing')], 'zing '.repeat(PLACES.most + 1));
  assert.deepEqual(alone.trims, [], 'one cue stays, and the decision refuses in the card\'s own words');
});

test('a clean list is returned as it is with no trim, and the other fields are kept', () => {
  const config = { cues: [cue('alpha'), cue('bravo')], seed: 4 };
  const out = laughTrack.repairStaff!(config, target(WORDS.join(' ')));
  assert.deepEqual(out, { config, trims: [] });
});

test('with no cue left the options come back unchanged and no cue is invented', () => {
  const config = { cues: [cue('banana split'), { phrase: 'alpha', sound: 'gasp' }] };
  assert.deepEqual(laughTrack.repairStaff!(config, target(WORDS.join(' '))), { config, trims: [] });
  assert.deepEqual(laughTrack.repairStaff!({ cues: 'alpha' }, target('alpha')), { config: { cues: 'alpha' }, trims: [] });
  assert.deepEqual(laughTrack.repairStaff!(undefined, target('alpha')), { config: undefined, trims: [] });
  const decided = decidePlay(laughTrack, settings, target(WORDS.join(' ')), [], config, '');
  assert.equal(decided.ok, false);
});

test('a player\'s play is never repaired: six cues are refused, not trimmed', () => {
  const six = WORDS.slice(0, CUES.most + 1).map((w) => cue(w));
  const decided = decidePlay(laughTrack, settings, target(WORDS.join(' ')), [], { cues: six }, '');
  assert.equal(decided.ok, false);
  assert.match(decided.ok ? '' : decided.why, /1 to 5 cues/);
});
