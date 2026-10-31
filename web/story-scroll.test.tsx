/**
 * The board stories that scroll to a post (engine/ui/cards/Plate.board.stories.tsx) run in jsdom as well as in
 * Storybook, in web/a11y.test.tsx's sweep, and jsdom has no `Element.scrollIntoView`. A story's timer that calls it
 * unguarded throws in a timer, outside any test: Vitest reports that as an unhandled error, the whole run exits 1 with
 * every test passing, and it does so only on a machine slow enough that the timer fires while the story is still
 * mounted, which was CI's.
 */
import { render, waitFor } from '@testing-library/react';
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import { expect, test } from 'vitest';
import * as preview from '../.storybook/preview.tsx';
import * as plate from '../engine/ui/cards/Plate.board.stories.tsx';

setProjectAnnotations(preview as never);

test('a story that scrolls to a post draws it and throws nothing where scrollIntoView does not exist', async () => {
  expect(Element.prototype.scrollIntoView).toBeUndefined();
  const thrown: unknown[] = [];
  /* The timer is Node's, so its throw is an uncaught exception of the process, not an 'error' event of the window. */
  const onError = (e: unknown) => { thrown.push(e); };
  process.on('uncaughtException', onError);
  try {
    const Splatted = (composeStories(plate as never) as Record<string, React.ComponentType>)['Splatted']!;
    const { container } = render(<Splatted />);
    await waitFor(() => expect(container.querySelector('#post-41')).not.toBeNull());
    /* The story looks for its post every 100 ms; wait out two ticks after the post is on the page. */
    await new Promise((r) => setTimeout(r, 350));
    expect(thrown.map(String)).toEqual([]);
  } finally {
    process.off('uncaughtException', onError);
  }
});
