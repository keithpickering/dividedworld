/**
 * Which story the end-to-end build's address names: `?fixture=boards&story=<id>`, the board match's
 * way to open a story beside its board (e2e/boards.spec.ts). Kept apart from the stories
 * themselves (stories.tsx), so web/src/main.tsx asks it before it loads them: the app's own pages,
 * the boards' moments among them, never load Storybook's preview. main.tsx calls it only in the
 * end-to-end build, so a production bundle neither reads the parameter nor carries the route.
 */
export function storyFromAddress(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get('fixture') === 'boards' ? params.get('story') : null;
}
