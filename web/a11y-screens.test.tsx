/**
 * Each screen has a story that renders that screen's own content. The sweep (web/a11y.test.tsx) holds every story to
 * axe, and an axe pass over a page that never showed its screen proves nothing about the screen; so for each screen in
 * SCREENS, one of its directory's stories must put the selector only that screen's content has on the page.
 *
 * Its own file because the sweep runs in parts, on several workers, and no one part sees every story. A screen's
 * stories are tried in order until one shows it, so a passing screen costs about one render.
 */
import { cleanup } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SCREENS, screenOf, show, stories } from './a11y-stories.tsx';

describe('screens', () => {
  test.each(SCREENS)('%s has a story that renders its own content', async (dir, selector) => {
    const tried: string[] = [];
    for (const story of stories.filter((s) => screenOf(s.file) === dir)) {
      const container = await show(story);
      /* A glass overlay the story opens (the React picker) is put on the body, outside the story's container. */
      const found = container.querySelector(selector) ?? document.body.querySelector(selector);
      cleanup();
      if (found) return;
      tried.push(story.name);
    }
    expect.fail(tried.length ? `none of ${dir}/'s stories shows ${selector}: ${tried.join('; ')}` : `no story is in a directory named ${dir}/`);
  });
});
