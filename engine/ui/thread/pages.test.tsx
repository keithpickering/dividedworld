import { describe, expect, it } from 'vitest';
import { pageEndsThread } from './pages.ts';

describe('whether a read of a page reached the end of the thread', () => {
  const range = { start: 1, end: 20 };
  it('is not the end when the page came back short of a range that stops before the last number', () => {
    expect(pageEndsThread(19, range, 30)).toBe(false);
  });
  it('is the end when the page came back short and its range takes in the last number', () => {
    expect(pageEndsThread(7, range, 7)).toBe(true);
    expect(pageEndsThread(19, range, 20)).toBe(true);
  });
  it('is not the end when the page came back full', () => {
    expect(pageEndsThread(20, range, 20)).toBe(false);
    expect(pageEndsThread(20, range, 30)).toBe(false);
  });
});
