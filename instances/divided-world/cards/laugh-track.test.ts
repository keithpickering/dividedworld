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
  const text = `${'zing '.repeat(PLACES.most)}${'zaps '.repeat(3)}`;
  const out = repair([cue('zing'), cue('zaps')], text);
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

test('canApply refuses a cue nested in another, with a third inside the outer one after the inner ends', () => {
  const text = 'alpha bravo charlie delta echoes foxtrot';
  const outer = 'alpha bravo charlie delta'; // chars 0 to 25
  const inner = 'bravo'; // inside the outer
  const third = 'charlie'; // also inside the outer, after the inner ends
  const verdict = laughTrack.canApply(target(text), [], { cues: [cue(outer), cue(inner), cue(third)] }, new Date());
  assert.equal(verdict.ok, false);
  assert.match(verdict.ok ? '' : verdict.why, /two cues cover the same words/);
});

test('canApply refuses a post with 200000 places in the card\'s own words, never throws, and is quick', () => {
  const text = 'word '.repeat(200000);
  const started = performance.now();
  const verdict = laughTrack.canApply(target(text), [], { cues: [cue('word')] }, new Date());
  const took = performance.now() - started;
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok ? '' : verdict.why, `these cues cover 200000 places in this post; a play covers at most ${PLACES.most}`);
  assert.ok(took < 1500, `took ${Math.round(took)} ms`);
});

test('repairStaff does not throw and stays quick on a post with a very long run of places', () => {
  const text = 'word '.repeat(20000);
  const started = performance.now();
  const out = repair([cue('word'), cue('word word')], text);
  assert.ok(performance.now() - started < 1500);
  assert.ok(Array.isArray((out.config as { cues: Cue[] }).cues));
  repair([cue('word')], 'word '.repeat(200000));
});

test('a phrase validation would refuse is dropped by the repair, so the valid cue after it is kept (too short, too long, a line break)', () => {
  const text = 'Hello there wonderful world, nice try! a b';
  const out = repair([cue('a b', 'boo'), cue('nice try')], text);
  assert.deepEqual(out.config, { cues: [cue('nice try')] });
  assert.deepEqual(out.trims, [{ path: PATH, predicate: 'cueShape', before: 2, after: 1 }]);
  assert.equal(laughTrack.validateConfig(out.config).ok, true, 'what repair keeps, validation keeps');
  const long = 'w'.repeat(101);
  const longOut = repair([cue(long), cue('nice try')], `${long} nice try`);
  assert.deepEqual(longOut.config, { cues: [cue('nice try')] });
  const broken = repair([cue('nice\ntry'), cue('wonderful')], 'nice\ntry wonderful');
  assert.deepEqual(broken.config, { cues: [cue('wonderful')] });
  assert.equal(laughTrack.validateConfig(broken.config).ok, true);
});

test('the repaired cue carries the trimmed phrase, the one validation decides', () => {
  const out = repair([cue('  nice try  ', 'cheer')], 'oh nice try there');
  assert.deepEqual(out.config, { cues: [cue('nice try', 'cheer')] });
  assert.deepEqual(out.trims, [], 'trimming whitespace is no trim of a cue');
  assert.deepEqual((laughTrack.validateConfig(out.config) as unknown as { value: { cues: Cue[] } }).value.cues, [cue('nice try', 'cheer')]);
});

test('repairStaff never throws and never invents a cue on hostile input', () => {
  const text = WORDS.join(' ');
  for (const config of [null, undefined, 'cues', 7, [], { cues: null }, { cues: 'alpha' }, { cues: {} }]) {
    assert.deepEqual(laughTrack.repairStaff!(config, target(text)), { config, trims: [] });
  }
  const hostile = laughTrack.repairStaff!({ cues: [null, 3, [cue('alpha')], undefined, { phrase: cue('alpha'), sound: 'laugh' }, cue('bravo')] }, target(text));
  assert.deepEqual(hostile.config, { cues: [cue('bravo')] });
  const huge = laughTrack.repairStaff!({ cues: [cue('a'.repeat(100000)), cue('alpha')] }, target(text));
  assert.deepEqual(huge.config, { cues: [cue('alpha')] });
  const onlyHuge = { cues: [cue('a'.repeat(100000))] };
  assert.deepEqual(laughTrack.repairStaff!(onlyHuge, target(text)), { config: onlyHuge, trims: [] });
});

test('the overlap pass stops at five clear cues and the rest are counted as dropped by mostFiveCues', () => {
  const words = Array.from({ length: 2000 }, (_, i) => `word${String(i).padStart(4, '0')}`);
  const started = performance.now();
  const out = repair(words.map((w) => cue(w)), words.join(' '));
  assert.ok(performance.now() - started < 1500);
  assert.equal((out.config as { cues: Cue[] }).cues.length, 5);
  assert.deepEqual(out.trims, [{ path: PATH, predicate: 'mostFiveCues', before: 2000, after: 5 }]);
  const mixed = repair([cue('alpha'), cue('alpha'), ...WORDS.slice(1, 7).map((w) => cue(w))]);
  assert.deepEqual(mixed.trims, [
    { path: PATH, predicate: 'overlapsEarlierCue', before: 8, after: 7 },
    { path: PATH, predicate: 'mostFiveCues', before: 7, after: 5 },
  ]);
});
