/**
 * The story sweep's split. web/a11y.test.tsx checks every Storybook story with axe, about a second a story, and a test
 * file runs on one worker: as one file the sweep was 435 seconds on one CPU while the suite's other files had finished
 * on all of them in 225, and the build was as long as this file (issue #495). So vitest.config.ts runs the file once per
 * part, each part on a worker of its own, and each run takes its share of the stories here.
 *
 * Pure, with no import, so its test (web/a11y-share.test.ts) proves the one thing that matters: every story is in
 * exactly one part.
 */

/** One run's part: `index` of `of`, from 1. */
export type Part = { index: number; of: number };

/**
 * What `A11Y_PART` says: "3/8" is part 3 of 8, and "1/1" is the whole sweep. Anything else throws, not set included:
 * a part misread as "nothing" would sweep no story and stay green, and a part that never reached the worker, read as
 * "every story", would have each run sweep them all, green and as many times the work as there are parts.
 */
export function readPart(text: string | undefined): Part {
  const m = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(text ?? '');
  const part = m ? { index: Number(m[1]), of: Number(m[2]) } : null;
  if (!part || part.index > part.of) throw new Error(`A11Y_PART is ${JSON.stringify(text)}; it must be "i/n" with 1 <= i <= n, e.g. "3/8" (vitest.config.ts sets it for each part)`);
  return part;
}

/**
 * This part's share of `items`: every `of`-th one, starting at `index`. Dealt like cards and never cut into runs,
 * because the list is in story order and one board's stories are slow together.
 */
export function share<T>(items: readonly T[], part: Part): T[] {
  return items.filter((_, i) => i % part.of === part.index - 1);
}
