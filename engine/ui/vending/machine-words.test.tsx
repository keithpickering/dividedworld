/** The Vending Machine's plain words (machine-words.ts): a chance is never said as a number that is not the chance. */
import { describe, expect, test } from 'vitest';
import { percent } from './machine-words.ts';

describe('percent', () => {
  test('whole and tenth chances read as themselves', () => {
    expect(percent(0.85)).toBe('85%');
    expect(percent(0.125)).toBe('12.5%');
    expect(percent(0)).toBe('0%');
    expect(percent(1)).toBe('100%');
  });
  test('a chance above 0 that rounds to nothing is never "0%"', () => {
    expect(percent(0.0004)).toBe('<0.1%');
    expect(percent(0.00049)).toBe('<0.1%');
    expect(percent(0.0005)).toBe('0.1%');
  });
});
