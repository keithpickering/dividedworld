/**
 * The story sweep's split (web/a11y-share.ts), held to the one thing it must never do: leave a story in no part, or in
 * two. A story no part holds is a story nothing checks, and the sweep would stay green over it.
 */
import { describe, expect, test } from 'vitest';
import { readPart, share } from './a11y-share.ts';

const names = (n: number): string[] => Array.from({ length: n }, (_, i) => `Story ${String(i).padStart(3, '0')}`);

describe('share', () => {
  test.each([1, 2, 3, 8, 13])('every item is in exactly one of %i parts', (of) => {
    for (const total of [0, 1, of - 1, of, of + 1, 428]) {
      const all = names(Math.max(0, total));
      const held = Array.from({ length: of }, (_, i) => share(all, { index: i + 1, of })).flat();
      expect([...held].sort()).toEqual([...all].sort());
    }
  });

  test('the parts are the same size to within one, so no worker carries the sweep alone', () => {
    const all = names(428);
    const sizes = Array.from({ length: 8 }, (_, i) => share(all, { index: i + 1, of: 8 }).length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  test('neighbors in the list go to different parts, so one board\'s slow stories are spread', () => {
    const all = names(16);
    expect(share(all, { index: 1, of: 8 })).toEqual(['Story 000', 'Story 008']);
    expect(share(all, { index: 8, of: 8 })).toEqual(['Story 007', 'Story 015']);
  });

  test('one part of one is the whole list', () => {
    const all = names(5);
    expect(share(all, { index: 1, of: 1 })).toEqual(all);
  });
});

describe('readPart', () => {
  test('reads "3/8"', () => {
    expect(readPart('3/8')).toEqual({ index: 3, of: 8 });
  });

  /* A part that did not reach the worker must not read as "every story": eight runs would each sweep them all, green and eight times the work. */
  test.each([undefined, ''])('refuses %j: the sweep always runs as a part', (text) => {
    expect(() => readPart(text)).toThrow(/A11Y_PART/u);
  });

  test.each(['0/8', '9/8', '3', '3/0', 'a/b', '3/8/1', ' 3/8', '-1/8', '1.5/8'])('refuses %j rather than sweep nothing', (text) => {
    expect(() => readPart(text)).toThrow(/A11Y_PART/u);
  });
});

/* The config is where the parts are made, and a part that no project runs is a share of the stories nothing checks. */
describe('vitest.config.ts', () => {
  type Project = { test: { name: string; include: string[]; exclude?: string[]; env?: Record<string, string> } };
  const SWEEP = 'web/a11y.test.tsx';

  test('runs the sweep once for each part, 1 to n of the same n, and in no other project', async () => {
    const config = (await import('../vitest.config.ts')).default as { test: { projects: Project[] } };
    const projects = config.test.projects;
    const sweeping = projects.filter((p) => p.test.include.includes(SWEEP));
    expect(sweeping.length).toBeGreaterThan(1);
    for (const p of sweeping) expect(p.test.include).toEqual([SWEEP]);
    const parts = sweeping.map((p) => readPart(p.test.env?.A11Y_PART));
    expect(parts).toEqual(sweeping.map((_, i) => ({ index: i + 1, of: sweeping.length })));
    /* Every other project leaves the sweep out by name: without a part it would sweep every story a second time. */
    const others = projects.filter((p) => !sweeping.includes(p));
    expect(others.length).toBe(1);
    for (const p of others) expect(p.test.exclude).toContain(SWEEP);
    /* A part keeps the zone every test runs in. */
    for (const p of sweeping) expect(p.test.env?.TZ).toBe('America/Los_Angeles');
  });
});
