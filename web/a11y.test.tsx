/**
 * The composition root's sweep: every Storybook story, rendered in its fake world (web/a11y-stories.tsx), actually
 * shows its screen and holds no axe violation at WCAG AA.
 *
 * A story is about a second of axe, and a test file runs on one worker, so vitest.config.ts runs this file once per
 * part, each on a worker of its own, with `A11Y_PART` saying which part ("3/8"); a run takes its share of the stories
 * (web/a11y-share.ts), and the parts between them take every story once. Run with no part, it sweeps them all.
 */
import { describe, expect, test } from 'vitest';
import { axeViolations, describeViolations } from '../engine/ui/a11y.ts';
import { readPart, share } from './a11y-share.ts';
import { show, stories } from './a11y-stories.tsx';

const part = readPart(process.env.A11Y_PART);
const mine = share(stories, part);

describe('stories', () => {
  test('are found, and this part holds some', () => {
    expect(stories.length).toBeGreaterThan(10);
    expect(mine.length).toBeGreaterThan(0);
  });

  describe.each(mine)('$name', (story) => {
    test('shows its screen and has no axe violation at AA', async () => {
      await show(story);
      expect(describeViolations(await axeViolations(document.body, { frames: story.Story.parameters?.a11y?.frames }))).toBe('');
    });
  });
});
