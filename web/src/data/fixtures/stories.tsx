/**
 * The end-to-end build's story route: the board match's stories (`engine/ui/**\/*.board.stories.tsx`),
 * each found by the id Storybook gives it and composed with the preview's decorators, as Storybook
 * renders it, so a story that asks for a world gets the fake with the app's providers around it.
 * The board match opens one at `?fixture=boards&story=<id>` (address.ts; e2e/boards.spec.ts), at the
 * board's size, and reads it by role and name as it reads the app.
 *
 * Only web/src/main.tsx's end-to-end branch loads this module, and it is the composition root's,
 * like the fixture beside it: the preview it imports names an instance. The preview carries the
 * fake (engine/ui/data/fake.ts) and with it the marker tools/check-web-bundle.mjs looks for, so a
 * production bundle that carried the route would fail the check.
 */
import { composeStories, setProjectAnnotations } from '@storybook/react-vite';
import type { ComponentType } from 'react';
import * as preview from '../../../../.storybook/preview.tsx';

setProjectAnnotations(preview as never);

const modules = import.meta.glob<Record<string, unknown>>('../../../../engine/ui/**/*.board.stories.tsx', { eager: true });

type Composed = ComponentType & { readonly id: string };
const STORIES: ReadonlyMap<string, Composed> = new Map(
  Object.values(modules).flatMap((mod) => Object.values(composeStories(mod as never) as Record<string, Composed>).map((s) => [s.id, s] as const)),
);

/** Every board story's id, sorted. */
export const BOARD_STORY_IDS: readonly string[] = [...STORIES.keys()].sort();

/** The story an id names, ready to render; throws naming the id and every one there is. */
export function boardStory(id: string): ComponentType {
  const story = STORIES.get(id);
  if (!story) throw new Error(`There is no board story with the id "${id}". The board stories are: ${BOARD_STORY_IDS.join(', ')}.`);
  return story;
}
