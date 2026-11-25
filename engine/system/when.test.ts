import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, until, amountWords } from './when.ts';

const NOW = Date.parse('2026-11-25T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** An ISO timestamp `ms` before NOW. */
const before = (ms: number) => new Date(NOW - ms).toISOString();
/** An ISO timestamp `ms` after NOW. */
const after = (ms: number) => new Date(NOW + ms).toISOString();

test('ago: under a minute is just now, from a minute on it counts minutes', () => {
  assert.equal(ago(before(0), NOW), 'just now');
  assert.equal(ago(before(59_000), NOW), 'just now');
  assert.equal(ago(before(MIN), NOW), 'a minute ago');
  assert.equal(ago(before(2 * MIN), NOW), '2 minutes ago');
  assert.equal(ago(before(12 * MIN), NOW), '12 minutes ago');
  assert.equal(ago(before(59 * MIN + 59_000), NOW), '59 minutes ago');
});

test('ago: an hour band from 60 minutes to under 48 hours', () => {
  assert.equal(ago(before(60 * MIN), NOW), 'an hour ago');
  assert.equal(ago(before(60 * MIN + 59_000), NOW), 'an hour ago');
  assert.equal(ago(before(2 * HOUR), NOW), '2 hours ago');
  assert.equal(ago(before(24 * HOUR), NOW), '24 hours ago');
  assert.equal(ago(before(47 * HOUR + 59 * MIN), NOW), '47 hours ago');
  assert.equal(ago(before(48 * HOUR), NOW), '2 days ago');
});

test('ago: a day band from 48 hours to under 60 days', () => {
  assert.equal(ago(before(3 * DAY), NOW), '3 days ago');
  assert.equal(ago(before(30 * DAY), NOW), '30 days ago');
  assert.equal(ago(before(59 * DAY + 23 * HOUR), NOW), '59 days ago');
  assert.equal(ago(before(60 * DAY), NOW), '2 months ago');
});

test('ago: a month band (30-day months) from 60 days to under 24 months', () => {
  assert.equal(ago(before(6 * 30 * DAY), NOW), '6 months ago');
  assert.equal(ago(before(719 * DAY), NOW), '23 months ago');
});

test('ago: a year band (365-day years) from 24 months, singular for one', () => {
  assert.equal(ago(before(720 * DAY), NOW), 'a year ago');
  assert.equal(ago(before(729 * DAY), NOW), 'a year ago');
  assert.equal(ago(before(730 * DAY), NOW), '2 years ago');
  assert.equal(ago(before(3 * 365 * DAY), NOW), '3 years ago');
});

test('ago: a then after now, or one that does not parse, reads just now', () => {
  assert.equal(ago(after(0), NOW), 'just now');
  assert.equal(ago(after(HOUR), NOW), 'just now');
  assert.equal(ago('not a time', NOW), 'just now');
  assert.equal(ago('', NOW), 'just now');
});

test('until: under a minute is in under a minute, from a minute on it counts', () => {
  assert.equal(until(after(0), NOW), 'in under a minute');
  assert.equal(until(after(59_000), NOW), 'in under a minute');
  assert.equal(until(after(MIN), NOW), 'in a minute');
  assert.equal(until(after(2 * MIN), NOW), 'in 2 minutes');
  assert.equal(until(after(12 * MIN), NOW), 'in 12 minutes');
  assert.equal(until(after(59 * MIN + 59_000), NOW), 'in 59 minutes');
});

test('until: the bands match ago, with the frame in front', () => {
  assert.equal(until(after(60 * MIN), NOW), 'in an hour');
  assert.equal(until(after(2 * HOUR), NOW), 'in 2 hours');
  assert.equal(until(after(47 * HOUR + 59 * MIN), NOW), 'in 47 hours');
  assert.equal(until(after(48 * HOUR), NOW), 'in 2 days');
  assert.equal(until(after(59 * DAY), NOW), 'in 59 days');
  assert.equal(until(after(60 * DAY), NOW), 'in 2 months');
  assert.equal(until(after(719 * DAY), NOW), 'in 23 months');
  assert.equal(until(after(720 * DAY), NOW), 'in a year');
  assert.equal(until(after(730 * DAY), NOW), 'in 2 years');
});

test('until: a then before now, or one that does not parse, reads in under a minute', () => {
  assert.equal(until(before(0), NOW), 'in under a minute');
  assert.equal(until(before(HOUR), NOW), 'in under a minute');
  assert.equal(until('not a time', NOW), 'in under a minute');
  assert.equal(until('', NOW), 'in under a minute');
});

test('amountWords: 0 and NaN and anything below 0 read none', () => {
  assert.equal(amountWords(0), 'none');
  assert.equal(amountWords(NaN), 'none');
  assert.equal(amountWords(-1), 'none');
});

test('amountWords: a bit below 0.15, from a tiny share on', () => {
  assert.equal(amountWords(1e-9), 'a bit');
  assert.equal(amountWords(0.1499), 'a bit');
});

test('amountWords: some from 0.15 to under 0.4', () => {
  assert.equal(amountWords(0.15), 'some');
  assert.equal(amountWords(0.3999), 'some');
});

test('amountWords: about half from 0.4 to under 0.6', () => {
  assert.equal(amountWords(0.4), 'about half');
  assert.equal(amountWords(0.5999), 'about half');
});

test('amountWords: most from 0.6 to under 0.85', () => {
  assert.equal(amountWords(0.6), 'most');
  assert.equal(amountWords(0.8499), 'most');
});

test('amountWords: almost all from 0.85 to under 1', () => {
  assert.equal(amountWords(0.85), 'almost all');
  assert.equal(amountWords(0.9999), 'almost all');
});

test('amountWords: all at 1, and a share above 1 clamps to all', () => {
  assert.equal(amountWords(1), 'all');
  assert.equal(amountWords(1.5), 'all');
});
