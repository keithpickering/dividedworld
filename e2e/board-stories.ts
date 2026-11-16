import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storyNameFromExport, toId } from 'storybook/internal/csf';
/*
 * Storybook ships its id functions only under `storybook/internal/csf` (an export its package
 * declares, but internal: it may move in a minor release). The a11y spec's check against the story
 * route's own list fails by name if it does, so a moved export cannot leave a story unread.
 */

/**
 * The board stories' ids, worked out where Playwright collects its tests: every
 * `engine/ui/**\/*.board.stories.tsx` the end-to-end build's story route serves
 * (web/src/data/fixtures/stories.tsx), each story by the id Storybook gives it (its meta's title and
 * its export's name, through Storybook's own `toId`). The route's own list is read in the browser
 * and compared with this one (e2e/a11y.spec.ts), so a story this misses fails by name rather than
 * going unread.
 */
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_UI = path.join(REPO, 'engine', 'ui');
/** An instance's own board stories live beside its art, in its `ui` folder (the story route globs both). */
export const instanceUis = (repo = REPO): string[] => {
  const instances = path.join(repo, 'instances');
  return fs.readdirSync(instances, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(instances, e.name, 'ui')).filter((p) => fs.existsSync(p));
};

function storyFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return storyFiles(p);
    return e.name.endsWith('.board.stories.tsx') ? [p] : [];
  });
}

/** Every board story's id, sorted, as the story route lists them. */
export function boardStoryIds(roots: readonly string[] = [ENGINE_UI, ...instanceUis()]): string[] {
  return roots.flatMap((root) => storyFiles(root).map((file) => ({ root, file }))).flatMap(({ root, file }) => {
    const text = fs.readFileSync(file, 'utf8');
    /* The meta's title: the object a file's `meta` names (a story's own data may have titles too), in either quote (one with an
       apostrophe, Feelin' Fab's, is double-quoted). */
    const title = /\bconst meta\b[^=]*=\s*\{[^}]*?\btitle:\s*(?:'([^']+)'|"([^"]+)")/.exec(text)?.slice(1).find(Boolean);
    if (!title) throw new Error(`${path.relative(root, file)} has no title the story ids can be worked out from`);
    /* An export the meta's `excludeStories` names is data, not a story, and the story route composes none of them. */
    /* Only an array of quoted names is understood (a regex, a spread or a variable is not), and one the file has in any other form throws, as the
       title lookup does, so data is never listed as a story. The search is of the whole text and not the meta object alone: matching the object's
       closing brace without a parser would be less robust than this, and a story's own data naming `excludeStories` is not a thing that exists. */
    const exclusion = /\bexcludeStories\b/.test(text) ? /\bexcludeStories:\s*\[([^\]]*)\]/.exec(text)?.[1] : '';
    if (exclusion === undefined || exclusion.replace(/['"]\w+['"]/g, '').replace(/[\s,]/g, '') !== '') {
      throw new Error(`${path.relative(root, file)} has an excludeStories the story ids cannot work out the excluded exports from (write it as an array of quoted names)`);
    }
    const excluded = new Set([...exclusion.matchAll(/['"](\w+)['"]/g)].map((m) => m[1]!));
    return [...text.matchAll(/^export const (\w+)\b/gm)].filter((m) => !excluded.has(m[1]!)).map((m) => toId(title, storyNameFromExport(m[1]!)));
  }).sort();
}

/** The story route's own list of ids, as its start error names them for an id it does not have. */
export function routeStoryIds(errorText: string): string[] {
  const list = /The board stories are: (.*)\.$/m.exec(errorText)?.[1];
  return list ? list.split(', ').sort() : [];
}
