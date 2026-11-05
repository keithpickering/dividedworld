/** format.ts's spanWords: a span the way a player says it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Span } from '../../rules/types.ts';
import { spanWords } from './format.ts';

const cases: [Span, string][] = [
  [{ count: 1, unit: 'minute' }, '1 minute'],
  [{ count: 2, unit: 'minute' }, '2 minutes'],
  [{ count: 1, unit: 'day' }, '1 day'],
  [{ count: 30, unit: 'day' }, '30 days'],
  [{ count: 1, unit: 'month' }, '1 month'],
  [{ count: 6, unit: 'month' }, '6 months'],
];

for (const [span, words] of cases) {
  test(`spanWords reads ${words}`, () => {
    assert.equal(spanWords(span), words);
  });
}
