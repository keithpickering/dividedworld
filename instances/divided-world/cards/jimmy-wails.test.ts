/**
 * Jimmy Wails's own rules: its configuration, its drives and its sob story.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, openDrive, staffConfigOf } from '../../../engine/rules/cards.ts';
import { defaults as settings } from '../settings.ts';
import { jimmy, post } from './test-kit.ts';

// Jimmy Wails (docs/plans/2026-11-03-jimmy-wails-plan.md, Task 6): a Sweet uncommon Cast on a post whose plays share a drive, each drawing a plate and needing a sob story.
const hour = 3_600_000;
const play = (act: string, drive: string, closes: number): import('../../../engine/rules/cards.ts').CardEffect => ({ card: 'jimmy-wails', act, drive, closes: new Date(closes).toISOString() });

test('Jimmy Wails accepts an empty configuration and nothing else', () => {
  const j = jimmy();
  assert.deepEqual(j.validateConfig({}), { ok: true, value: {} });
  assert.equal(j.validateConfig({ ink: 'red' }).ok, false);
  assert.equal(j.validateConfig(undefined).ok, false);
  assert.equal(j.validateConfig('x').ok, false);
  assert.equal(j.validateConfig(null).ok, false);
  assert.equal(staffConfigOf(j, () => 0) !== null, true, 'a Mod Bot plays it as {}');
});

test('Jimmy Wails: a fourth play on an open drive is refused, and one after the close lands as the opening of another', () => {
  const j = jimmy();
  const now = new Date();
  const open = (n: number) => Array.from({ length: n }, (_, i) => play(`a${i}`, 'a0', now.getTime() + 7 * 24 * hour));
  assert.equal(decidePlay(j, settings, post(10), open(2), {}, 'Please.', { now }).ok, true, 'a third joins');
  assert.deepEqual(decidePlay(j, settings, post(10), open(3), {}, 'Please.', { now }), { ok: false, why: 'this post\'s drive already carries 3 appeals' }, 'a fourth is refused, in the database\'s words');
  const closed = Array.from({ length: 3 }, (_, i) => play(`c${i}`, 'c0', now.getTime() - hour));
  assert.equal(decidePlay(j, settings, post(10), closed, {}, 'Please.', { now }).ok, true, 'a play after the close opens another drive');
  assert.equal(decidePlay(j, settings, post(10), [...closed, ...open(2)], {}, 'Please.', { now }).ok, true, 'earlier closed drives do not count against the open one');
  assert.equal(openDrive([...closed, ...open(3)], 'jimmy-wails', now)?.plays.length, 3);
  // The landing's other refusals are the usual ones: a post only, a post's own kind.
  assert.match((decidePlay(j, settings, { reach: 'thread', act: 't', title: 'x' } as never, [], {}, 'Please.', { now }) as { why: string }).why, /lands on a post/);
});

test('Jimmy Wails: a blank message is refused, in the card\'s words', () => {
  const j = jimmy();
  for (const blank of ['', '   ', undefined, null]) assert.deepEqual(decidePlay(j, settings, post(10), [], {}, blank), { ok: false, why: 'an appeal needs a sob story' }, String(blank));
  assert.equal(decidePlay(j, settings, post(10), [], {}, 'My cat needs a sweater.').ok, true);
});
