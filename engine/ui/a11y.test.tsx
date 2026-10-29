/**
 * Every Storybook story, rendered in its fake world, holds no axe violation at WCAG AA. The stories
 * are found by glob, so a screen's new story is held the day it is written; a screen without a story
 * is a gap `screens covered` below names.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { describe, expect, test } from 'vitest';
import * as preview from '../../.storybook/preview.tsx';
import { axeViolations, describeViolations } from './a11y.ts';

setProjectAnnotations(preview as never);

const modules = import.meta.glob<Record<string, unknown>>(
  ['./**/*.stories.tsx', '../../instances/*/ui/**/*.stories.tsx'],
  { eager: true },
);

const stories = Object.entries(modules).flatMap(([file, mod]) =>
  Object.entries(composeStories(mod as never) as Record<string, { storyName?: string; id: string; (): unknown }>).map(([key, Story]) => ({
    file,
    name: `${(mod.default as { title?: string }).title ?? file} / ${Story.storyName ?? key}`,
    Story,
  })),
);

/** The screens the plan names; each has at least one story, or the check below names the gap. */
const SCREENS = ['index/', 'board/', 'thread/', 'reactions/', 'composer/', 'spin/', 'characters/', 'profile-edit/', 'profile/', 'standings/', 'reveal/', 'frame/'];

describe('stories', () => {
  test('are found', () => {
    expect(stories.length).toBeGreaterThan(10);
  });

  test('screens covered: every screen has a story', () => {
    const files = Object.keys(modules).join('\n');
    const missing = SCREENS.filter((s) => !files.includes(`/${s}`));
    expect({ missing, files }).toEqual({ missing: [], files });
  });

  describe.each(stories)('$name', ({ Story }) => {
    test('has no axe violation at AA', async () => {
      const Composed = Story as unknown as React.ComponentType;
      const { container } = render(<Composed />);
      /* The world is seeded asynchronously; settle until nothing is loading. */
      await waitFor(() => {
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      });
      await new Promise((r) => setTimeout(r, 50));
      await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
      const found = await axeViolations(document.body);
      expect(describeViolations(found)).toBe('');
    });
  });
});
void screen;
