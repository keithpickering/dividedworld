import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceProblems, settingsProblems } from '../../engine/rules/instance.ts';
import { instance, playtestInstance } from './index.ts';
import { defaults, playtest, playtestOverrides } from './settings.ts';
import { reactions } from './reactions.ts';
import { QUADRANTS } from '../../engine/rules/types.ts';
import { hintPatterns } from '../../engine/rules/hints.ts';
import { hintWords } from './ui/hint-words.ts';

test('the defaults hold every setting the engine reads, in range', () => {
  assert.deepEqual(settingsProblems(defaults), []);
});

test('the toast defaults are the alerts design\'s section 8: news of your own characters toasts, followed threads, hints and season news do not', () => {
  assert.deepEqual([...defaults.toastDefaults].sort(), ['cardEnded', 'cardOnYours', 'quote', 'ruling', 'settlement', 'trapSprang', 'trapStruck', 'update']);
  assert.deepEqual(playtest.toastDefaults, defaults.toastDefaults);
  assert.deepEqual(settingsProblems({ ...defaults, toastDefaults: ['quote', 'quote'] }).length > 0, true, 'a kind named twice is a problem');
});

test('the playtest settings hold every setting the engine reads, in range', () => {
  assert.deepEqual(settingsProblems(playtest), []);
});

test('the defaults are the design\'s section 10 table, in hundredths of an orb', () => {
  assert.equal(defaults.walletCap, 600);
  assert.equal(defaults.vote, 10);
  assert.equal(defaults.halving, 0.5);
  assert.equal(defaults.reactionCap, 3);
  assert.equal(defaults.charactersPerPlayer, 6);
  assert.deepEqual(defaults.seasonLength, { unit: 'month', count: 3 });
  assert.deepEqual(defaults.turnCooldown, { unit: 'day', count: 30 });
  assert.equal(defaults.registrationMode, 'invite');
  assert.equal(defaults.postMaxLength, 20_000);
  assert.equal(defaults.titleMaxLength, 120);
  assert.equal(defaults.postsPerPage, 20);
  assert.equal(defaults.hotReplies, 10);
  assert.deepEqual(defaults.presenceWindow, { unit: 'minute', count: 5 });
  assert.equal(defaults.presenceNames, 15);
  assert.equal(defaults.presencePollSeconds, 30);
  assert.match(defaults.settlementCron, /^\d+ \d+ \* \* \*$/, 'daily');
});

test('the classes\' and cards\' numbers are the table\'s, as settings', () => {
  assert.deepEqual(defaults.economy, {
    'lurker.earlyPlayers': 3, 'lurker.earlyMatch': 10, 'lurker.crowd': 3, 'lurker.spunThreadRepliers': 3, 'lurker.spunThread': 20,
    'lurker.postsAllowed': 3, 'lurker.overPosting': -10,
    'heel.saltyOutdraws': 20,
    'face.cardOutdraws': -20,
    'jabroni.saltyLanded': 20,
    'technician.evergreen': 5, 'technician.evergreenDays': 3,
    'whoops.perLength': 25, 'whoops.lengthStep': 500, 'whoops.mostAdded': 200,
    'autocorrect.perVolume': 25, 'autocorrect.volumeStep': 50, 'autocorrect.mostAdded': 200,
    'youWereSaying.baseTokens': 25, 'youWereSaying.stepTokens': 25, 'youWereSaying.stepPrice': 25, 'youWereSaying.mostTokens': 200,
    'machine.pullMost': 2, 'machine.moveDaysMost': 7, 'machine.repriceLeast': 50, 'machine.repriceMost': 200, 'machine.flashHoursLeast': 24, 'machine.flashHoursMost': 48,
  });
  assert.ok(Object.isFrozen(defaults.economy));
});

test('every card set face down stays set a week if nothing springs it', () => {
  assert.deepEqual(defaults.setLasts, { unit: 'day', count: 7 });
});

test('the playtest overrides are separate values, not edits of the defaults', () => {
  assert.deepEqual(playtestOverrides, { seasonLength: { unit: 'week', count: 3 }, turnCooldown: { unit: 'day', count: 7 } });
  assert.deepEqual(defaults.seasonLength, { unit: 'month', count: 3 });
  assert.deepEqual(defaults.turnCooldown, { unit: 'day', count: 30 });
  assert.deepEqual(playtest.seasonLength, { unit: 'week', count: 3 });
  assert.deepEqual(playtest.turnCooldown, { unit: 'day', count: 7 });
  assert.notEqual(playtest, defaults);
  assert.ok(Object.isFrozen(defaults), 'the defaults cannot be edited in place');
  assert.ok(Object.isFrozen(defaults.seasonLength) && Object.isFrozen(defaults.turnCooldown), 'not even their spans');
  assert.throws(() => { (defaults.seasonLength as { count: number }).count = 99; }, TypeError);
  const { seasonLength: _s, turnCooldown: _t, ...restPlaytest } = playtest;
  const { seasonLength: _s2, turnCooldown: _t2, ...restDefaults } = defaults;
  assert.deepEqual(restPlaytest, restDefaults, 'the playtest changes only what it overrides');
});

test('every reaction key is unique, plain, and has a quadrant', () => {
  const keys = reactions.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const r of reactions) {
    assert.match(r.key, /^[a-z][a-z0-9-]*$/, `${r.key} is a plain key, safe in SQL and a URL`);
    assert.ok(QUADRANTS.includes(r.quadrant), `${r.key} has a quadrant`);
  }
});

test('the system settings are the plan\'s numbers, and the System ships switched off', () => {
  assert.equal(defaults.systemEnabled, false);
  assert.match(defaults.meetingCron, /^\d+ \d+ \* \* \*$/, 'daily');
  assert.notEqual(defaults.meetingCron, defaults.settlementCron);
  assert.deepEqual(defaults.phases.honeymoon, { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 });
  assert.deepEqual(defaults.phases.reign, { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 });
  assert.deepEqual(defaults.phases.meltdown, { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 });
  assert.equal(defaults.inheritanceGraceDays, 3);
  assert.equal(defaults.rosterRecentExcluded, 2);
  assert.equal(defaults.structuralHoldHours, 24);
  assert.equal(defaults.boardNameMaxLength, 60);
  assert.equal(defaults.demandCheckMinutes, 5);
  assert.equal(defaults.demandChecksPerTick, 40);
  assert.deepEqual(defaults.modBots, { allowanceMost: 3, ruleDaysMost: 7, visitHours: { least: 2, most: 12 }, patrolsPerDay: 6, patrolSample: 5, reportPrice: 25, reportsPerDay: 3, judgmentsPerDay: 60, filingLinesPerDay: 60, appealPrice: 50, tailHours: 24, cap: { punishments: 3, days: 7 }, filingCron: '*/5 * * * *', filingGraceMinutes: 10 });
  assert.deepEqual(defaults.warnBar, { size: 10, bands: { minor: 2, moderate: 4, severe: 7 }, decay: { unit: 'day', count: 14 }, banDays: [1, 3, 7] });
  assert.deepEqual(defaults.apology, { apologyEveryHours: 24, apologyJudgeBatch: 10, apologyRulingMaxWords: 80 });
  assert.deepEqual(defaults.modelTiers, { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' });
  assert.ok(Object.isFrozen(defaults.phases) && Object.isFrozen(defaults.phases.reign) && Object.isFrozen(defaults.modelTiers) && Object.isFrozen(defaults.warnBar.banDays) && Object.isFrozen(defaults.apology));
});

test('the new settings validate, in the defaults and the playtest, and reject what is out of range', () => {
  assert.deepEqual(settingsProblems(defaults), []);
  assert.deepEqual(settingsProblems(playtest), []);
  assert.match(settingsProblems({ ...defaults, boardNameMaxLength: 0 }).join(), /boardNameMaxLength/);
  assert.match(settingsProblems({ ...defaults, modelTiers: { strong: '', light: 'x' } }).join(), /modelTiers/);
});

test('Divided World\'s whole instance has no problems', () => {
  assert.deepEqual(instanceProblems(instance), []);
  assert.deepEqual(instanceProblems(playtestInstance), []);
});

test('hints: the thresholds are valid and a hint needs a crowd, a clear lead, and a real split', () => {
  assert.deepEqual(defaults.hints, { least: 8, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } });
  assert.deepEqual(settingsProblems({ ...defaults, hints: defaults.hints }), []);
  assert.ok(Object.isFrozen(defaults.hints), 'frozen with the rest');
  assert.deepEqual(playtest.hints, defaults.hints);
});

test('hints: the instance has words for every pattern, for a post and for a card, and they are plain text', () => {
  for (const pattern of hintPatterns) {
    for (const card of [false, true]) {
      const w = hintWords(pattern, { card });
      assert.ok(w, `${pattern} (card ${card}) has words`);
      assert.ok(w.line.length > 0 && w.line.length <= 60, `${pattern} line fits a toast: ${w.line}`);
      assert.ok(w.detail.length > 0, `${pattern} detail`);
      assert.doesNotMatch(w.line + w.detail, /[<>]/, 'plain text, never markup');
    }
  }
  assert.equal(hintWords('leading:excitedNegative', { card: false })?.line, 'Your post is picking up heat');
  assert.equal(hintWords('somethingNew', { card: false }), undefined, 'a pattern it has no words for is the engine\'s to say');
});

test('hints: a post is never called a card, nor a card a post, and the thunder says which side the player is on', () => {
  for (const pattern of hintPatterns.filter((p) => p !== 'thunder')) {
    assert.match(hintWords(pattern, { card: false })!.line, /post/i, pattern);
    assert.match(hintWords(pattern, { card: true })!.line, /card/i, pattern);
    assert.doesNotMatch(hintWords(pattern, { card: true })!.line, /post/i, pattern);
  }
  assert.match(hintWords('thunder', { card: false })!.line, /post/i);
  assert.match(hintWords('thunder', { card: true })!.line, /card/i);
});

test('hints: the thunder says "lately", since it compares the window\'s reactions and never the post\'s whole count (#149 F2)', () => {
  assert.equal(hintWords('thunder', { card: false })!.detail, 'A card played on your post has drawn more reactions lately than the post itself. The card is the main event now.');
  assert.equal(hintWords('thunder', { card: true })!.detail, 'The card you played has drawn more reactions lately than the post it landed on. You are the main event now.');
});

test('hints: the words claim no more than the threshold proves (a lead is "most", a split is "a real share", never "nobody" or "half")', () => {
  for (const pattern of hintPatterns) {
    for (const card of [false, true]) {
      const w = hintWords(pattern, { card })!;
      assert.doesNotMatch(w.line + ' ' + w.detail, /\b(nobody|no one|everyone|half the|all of)\b/i, `${pattern} (card ${card}) overstates what fired it: ${w.detail}`);
    }
  }
});
