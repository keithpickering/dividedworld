import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_CAPS, phaseAt } from './phases.ts';
import type { Settings } from '../rules/types.ts';

const DAY = 24 * 60 * 60 * 1000;
const settings = {
  phases: {
    honeymoon: { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 },
    reign: { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 },
    meltdown: { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 },
  },
} as unknown as Settings;
/** A ninety-day season, so the phases do not overlap. */
const season = { startsAt: 1_000 * DAY, endsAt: 1_090 * DAY };
const at = (day: number) => season.startsAt + day * DAY;

test('the first day of a season is the honeymoon, with its numbers', () => {
  const r = phaseAt(season, at(0), settings);
  assert.equal(r.phase, 'honeymoon');
  assert.deepEqual(r.numbers, { weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 });
  assert.deepEqual(r.clamps, []);
});

test('the honeymoon ends after its days, and the middle of a season is the reign', () => {
  assert.equal(phaseAt(season, at(13.99), settings).phase, 'honeymoon');
  assert.equal(phaseAt(season, at(14), settings).phase, 'reign');
  const r = phaseAt(season, at(45), settings);
  assert.equal(r.phase, 'reign');
  assert.deepEqual(r.numbers, { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 });
});

test('the last 21 days of a season are the meltdown', () => {
  assert.equal(phaseAt(season, at(68.99), settings).phase, 'reign');
  assert.equal(phaseAt(season, at(69), settings).phase, 'meltdown');
  assert.equal(phaseAt(season, season.endsAt - 1, settings).phase, 'meltdown');
  assert.deepEqual(phaseAt(season, at(80), settings).numbers, { weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 });
});

test('a season shorter than its two ramps gives the honeymoon its days first and the meltdown the rest', () => {
  const short = { startsAt: 0, endsAt: 21 * DAY };
  assert.equal(phaseAt(short, 13 * DAY, settings).phase, 'honeymoon');
  assert.equal(phaseAt(short, 14 * DAY, settings).phase, 'meltdown');
});

test('a Boss\'s override inside the caps is used and records nothing', () => {
  const r = phaseAt(season, at(45), settings, { phases: { reign: { weeklyMoves: 7 } } });
  assert.equal(r.numbers.weeklyMoves, 7);
  assert.equal(r.numbers.bankCap, 10, 'what the Boss does not override stays');
  assert.deepEqual(r.clamps, []);
});

test('a Boss\'s override past a cap is clamped to it and the clamp is recorded', () => {
  const over = PHASE_CAPS.reign.weeklyMoves + 50;
  const r = phaseAt(season, at(45), settings, { phases: { reign: { weeklyMoves: over } } });
  assert.equal(r.numbers.weeklyMoves, PHASE_CAPS.reign.weeklyMoves);
  assert.deepEqual(r.clamps, [{ path: 'phases.reign.weeklyMoves', predicate: `atMost(${PHASE_CAPS.reign.weeklyMoves})`, before: over, after: PHASE_CAPS.reign.weeklyMoves }]);
});

test('an override of the honeymoon\'s days moves where the reign starts, clamped like any number', () => {
  const r = phaseAt(season, at(20), settings, { phases: { honeymoon: { days: 1000 } } });
  assert.equal(r.phase, 'honeymoon', 'twenty days in, still inside the clamped honeymoon');
  assert.equal(r.clamps.length, 1);
  assert.equal(r.clamps[0]!.path, 'phases.honeymoon.days');
  assert.equal(r.clamps[0]!.after, PHASE_CAPS.honeymoon.days);
});

test('an override below the least is raised to it and recorded', () => {
  const r = phaseAt(season, at(45), settings, { phases: { reign: { bankCap: 0 } } });
  assert.equal(r.numbers.bankCap, 1);
  assert.deepEqual(r.clamps.map((c) => [c.path, c.predicate]), [['phases.reign.bankCap', 'atLeast(1)']]);
});

test('the settings themselves are never changed', () => {
  const before = JSON.stringify(settings);
  phaseAt(season, at(45), settings, { phases: { reign: { weeklyMoves: 9999 } } });
  assert.equal(JSON.stringify(settings), before);
});
