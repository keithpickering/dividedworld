/**
 * The author's hold, shared by the cards that hold their author's saves for a while after a play lands (Autocorrect, Hot Box).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdEnds, heldUntil, holdLeft } from './hold.ts';
import { defaults as settings } from '../settings.ts';

test('holdEnds: a hold of some hours ends that long after the landing; 0 holds none', () => {
  const landed = new Date('2026-11-16T10:00:00Z');
  assert.equal(holdEnds(24, landed)?.toISOString(), '2026-11-17T10:00:00.000Z');
  assert.equal(holdEnds(0, landed), undefined);
});

test('heldUntil reads the hold from the economy key it is given, for the screens', () => {
  assert.equal(heldUntil(settings, 'autocorrect.holdHours', '2026-11-16T10:00:00Z')?.toISOString(), '2026-11-17T10:00:00.000Z');
  assert.equal(heldUntil(settings, 'autocorrect.holdHours', 'not a time'), undefined);
  assert.equal(heldUntil({ economy: {} }, 'autocorrect.holdHours', '2026-11-16T10:00:00Z'), undefined, 'an economy without the setting holds nothing');
  assert.equal(heldUntil({ economy: { 'x.holdHours': 2 } }, 'x.holdHours', '2026-11-16T10:00:00Z')?.toISOString(), '2026-11-16T12:00:00.000Z');
});

test('holdLeft rounds up to the minute', () => {
  assert.equal(holdLeft(59_999), 'less than a minute');
  assert.equal(holdLeft(60_000), '1m');
  assert.equal(holdLeft(12 * 60_000 - 1), '12m');
  assert.equal(holdLeft((5 * 60 + 12) * 60_000), '5h 12m');
  assert.equal(holdLeft(2 * 3_600_000), '2h 0m');
});
