/**
 * The hand's sheet story (engine/ui/cards/Hand.board.stories.tsx) reads each card's rules to a screen reader and ends with who made
 * its art (docs/plans/2026-11-05-card-template-plan.md, Task 6). It lives here, with the other tests of a story through the
 * preview, because the preview hands the story an instance and a test in engine/ui may not reach one.
 */
import { render, waitFor } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import * as preview from '../.storybook/preview.tsx';
import * as handBoard from '../engine/ui/cards/Hand.board.stories.tsx';

setProjectAnnotations(preview as never);

test('the hand sheet story\'s description ends "Art by Divided World."', async () => {
  const Sheet = (composeStories(handBoard as never) as Record<string, React.ComponentType>)['Sheet']!;
  const { container } = render(<Sheet />);
  await waitFor(() => expect(container.querySelector('.kb-postcard')).not.toBeNull());
  const says = [...container.querySelectorAll('.kb-visually-hidden[id^="kb-hand-board-says-"]')];
  expect(says.length).toBeGreaterThan(0);
  for (const s of says) expect(s.textContent, s.id).toMatch(/Art by Divided World\.$/u);
});
