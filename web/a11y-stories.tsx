/**
 * Every Storybook story in its fake world, for the two tests that hold them: web/a11y.test.tsx (no axe violation, a
 * part of the stories a run) and web/a11y-screens.test.tsx (each screen has a story that shows it).
 *
 * The composition root's: it imports the preview, which hands the stories an instance's look and words, so it lives in
 * web/ and not in engine/ui/ (the engine never knows an instance; the pure check, engine/ui/a11y.ts, and its poisoned
 * twin stay in the engine). The stories are found by glob, so a screen's new story is held the day it is written.
 */
import { render, waitFor } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { expect } from 'vitest';
import * as preview from '../.storybook/preview.tsx';

setProjectAnnotations(preview as never);

const modules = import.meta.glob<Record<string, unknown>>(
  ['../engine/ui/**/*.stories.tsx', '../instances/*/ui/**/*.stories.tsx'],
  { eager: true },
);

type Composed = { storyName?: string; parameters?: { a11y?: { frames?: boolean } }; id: string; play?: (ctx: { canvasElement: HTMLElement }) => Promise<void>; (): unknown };
export type Found = { file: string; key: string; name: string; Story: Composed };

/** Every story, in an order that is the same in every run: by file, then as the file declares them. The split deals from this order. */
export const stories: Found[] = Object.entries(modules)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .flatMap(([file, mod]) =>
    Object.entries(composeStories(mod as never) as Record<string, Composed>).map(([key, Story]) => ({
      file,
      key,
      name: `${(mod.default as { title?: string }).title ?? file} / ${Story.storyName ?? key}`,
      Story,
    })),
  );

/** What proves a screen's own content is on the page: each screen's directory, and a selector only that content has. */
export const SCREENS: readonly (readonly [string, string])[] = [
  ['index', '.kb-board-row'], ['board', '.kb-thread-row'], ['thread', '.kb-act'], ['reactions', '.kb-picker'],
  ['composer', '.kb-composer'], ['spin', '.kb-spin-form, [role="group"][aria-label="Origin"]'], ['characters', '.kb-roster-card'],
  ['profile-edit', '.kb-profile-edit'], ['profile', '.kb-profile'], ['season', '.kb-season, .kb-rankings'], ['reveal', '.kb-reveal-post, .kb-tally-post'],
  ['frame', '.kb-hud-bar'], ['front-door', '.kb-front-door .kb-act'], ['account', '.kb-acct'], ['postbit', '.kb-postbit-text'], ['orbs', '.kb-orbs-row'], ['alerts', '.kb-alerts-row'],
];

/** The directory a story's file is in, which is its screen's name in SCREENS. */
export const screenOf = (file: string): string => /\/([a-z-]+)\/[^/]+\.stories\.tsx$/u.exec(file)?.[1] ?? '';

/** Stories that are an error or an empty state on purpose: a missing thing, a signed-out reader, a bare orb row. */
const BY_DESIGN = /NotFound|SignedOut|\/ SignIn$|\/ Register$|^HUD\/Orbs/u;
/** Least visible text a story that shows a screen has. */
const FLOOR = 30;

/** Settled: nothing loading, something on the page, and the page unchanged for a moment (a world fills in over several reads). */
async function settled(container: HTMLElement, floor: number): Promise<void> {
  let last = '';
  let since = Date.now();
  await waitFor(() => {
    expect(container.querySelector('[aria-busy="true"]:not(button, a, [role="button"])')).toBeNull();
    expect((container.textContent ?? '').trim().length).toBeGreaterThan(floor);
    const now = container.innerHTML;
    if (now !== last) { last = now; since = Date.now(); }
    expect(Date.now() - since).toBeGreaterThanOrEqual(100);
  });
}

/**
 * Renders a story as a reader would find it and returns its container: settled, its play function run, and showing its
 * screen. A story that renders an error or an empty page is checked against nothing, so it fails here unless it is one
 * of the by-design states above.
 */
export async function show({ Story, name }: Found): Promise<HTMLElement> {
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
  return container;
}
