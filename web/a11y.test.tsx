/**
 * The composition root's sweep: it imports the preview, which hands the stories an instance's look
 * and words, so it lives in web/ and not in engine/ui/ (the engine never knows an instance; the pure
 * check it calls, engine/ui/a11y.ts, and its poisoned twin stay in the engine).
 *
 * Every Storybook story, rendered in its fake world, holds no axe violation at WCAG AA, and
 * actually shows its screen: a story that renders an error or an empty page is checked against
 * nothing, so it fails here unless it is one of the by-design states listed below. The stories are
 * found by glob, so a screen's new story is held the day it is written.
 */
import { render, waitFor } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { describe, expect, test } from 'vitest';
import * as preview from '../.storybook/preview.tsx';
import { axeViolations, describeViolations } from '../engine/ui/a11y.ts';

setProjectAnnotations(preview as never);

const modules = import.meta.glob<Record<string, unknown>>(
  ['../engine/ui/**/*.stories.tsx', '../instances/*/ui/**/*.stories.tsx'],
  { eager: true },
);

type Composed = { storyName?: string; id: string; play?: (ctx: { canvasElement: HTMLElement }) => Promise<void>; (): unknown };
const stories = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(composeStories(mod as never) as Record<string, Composed>).map(([key, Story]) => ({
    file,
    key,
    name: `${(mod.default as { title?: string }).title ?? file} / ${Story.storyName ?? key}`,
    Story,
  })),
);

/** What proves a screen's own content is on the page: each screen's directory, and a selector only that content has. */
const SCREENS: readonly (readonly [string, string])[] = [
  ['index', '.kb-board-row'], ['board', '.kb-thread-row'], ['thread', '.kb-act'], ['reactions', '.kb-picker'],
  ['composer', '.kb-composer'], ['spin', '.kb-spin-form, [role="group"][aria-label="Origin"]'], ['characters', '.kb-character-row'],
  ['profile-edit', '.kb-profile-edit'], ['profile', '.kb-profile'], ['standings', '.kb-standings'], ['reveal', '.kb-reveal-post, .kb-tally-post'],
  ['frame', '.kb-hud-bar'], ['account', '.kb-acct'], ['postbit', '.kb-postbit-text'], ['orbs', '.kb-orbs-row'],
];

/** Stories that are an error or an empty state on purpose: a missing thing, a signed-out reader, a bare orb row. */
const BY_DESIGN = /NotFound|SignedOut|\/ SignIn$|\/ Register$|^HUD\/Orbs/u;
/** Least visible text a story that shows a screen has. */
const FLOOR = 30;

/** Settled: nothing loading, something on the page, and the page unchanged for a moment (a world fills in over several reads). */
async function settled(container: HTMLElement, floor: number): Promise<void> {
  let last = '';
  let since = Date.now();
  await waitFor(() => {
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect((container.textContent ?? '').trim().length).toBeGreaterThan(floor);
    const now = container.innerHTML;
    if (now !== last) { last = now; since = Date.now(); }
    expect(Date.now() - since).toBeGreaterThanOrEqual(100);
  });
}

const shown = new Map<string, Set<string>>();

describe('stories', () => {
  test('are found', () => {
    expect(stories.length).toBeGreaterThan(10);
  });

  describe.each(stories)('$name', ({ Story, file, name }) => {
    test('shows its screen and has no axe violation at AA', async () => {
      const Shown = Story as unknown as React.ComponentType;
      const { container } = render(<Shown />);
      const designed = BY_DESIGN.test(name);
      await settled(container, designed ? 0 : FLOOR);
      /* A story's play function is part of what it shows (an opened picker): run it, then settle again. */
      if (Story.play) {
        await Story.play({ canvasElement: container });
        await settled(container, 0);
      }
      if (!designed) {
        const heading = container.querySelector('h1')?.textContent ?? '';
        expect(heading, 'a story must not render an error page').not.toMatch(/^(No such|Not found|Could not)/iu);
      }
      const dir = /\/([a-z-]+)\/[^/]+\.stories\.tsx$/u.exec(file)?.[1] ?? '';
      const selector = SCREENS.find(([d]) => d === dir)?.[1];
      /* A glass overlay the story opens (the React picker) is put on the body, outside the story's container. */
      if (selector && (container.querySelector(selector) ?? document.body.querySelector(selector))) {
        if (!shown.has(dir)) shown.set(dir, new Set());
        shown.get(dir)!.add(name);
      }
      expect(describeViolations(await axeViolations(document.body))).toBe('');
    });
  });

  /* Runs after every story above (a file's tests run in order). */
  test('each screen has a story that renders that screen\'s own content', () => {
    const missing = SCREENS.map(([d]) => d).filter((d) => !shown.has(d));
    expect(missing).toEqual([]);
  });
});
