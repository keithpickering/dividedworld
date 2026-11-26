import { describe, expect, test } from 'vitest';
import { shortTime } from './dates.ts';

/** Local-time instants, so the reader's zone (whatever the machine's is) decides the day, as it does on a page. */
const local = (y: number, mo: number, d: number, h: number, mi: number): Date => new Date(y, mo - 1, d, h, mi);
const now = local(2026, 11, 26, 14, 30).getTime();

describe('shortTime', () => {
  test('a time on the reader\'s own day is the time alone', () => {
    expect(shortTime(local(2026, 11, 26, 9, 5).toISOString(), now)).toBe('9:05 AM');
  });
  test('a time on another day this year adds the month and day, not the year', () => {
    expect(shortTime(local(2026, 11, 20, 14, 2).toISOString(), now)).toBe('Nov 20, 2:02 PM');
  });
  test('a time in another year adds the year', () => {
    expect(shortTime(local(2025, 12, 31, 23, 59).toISOString(), now)).toBe('Dec 31, 2025, 11:59 PM');
  });
  test('a time that cannot be read is nothing', () => {
    expect(shortTime('not a date', now)).toBe('');
  });
  test('the day turns at the reader\'s midnight: 11:59 PM the night before is another day, 12:00 AM is the day', () => {
    const noon = local(2026, 11, 26, 12, 0).getTime();
    expect(shortTime(local(2026, 11, 25, 23, 59).toISOString(), noon)).toBe('Nov 25, 11:59 PM');
    expect(shortTime(local(2026, 11, 26, 0, 0).toISOString(), noon)).toBe('12:00 AM');
  });
  test('New Year\'s Eve is another year the next morning', () => {
    const jan = local(2027, 1, 1, 0, 5).getTime();
    expect(shortTime(local(2026, 12, 31, 23, 58).toISOString(), jan)).toBe('Dec 31, 2026, 11:58 PM');
  });
});
