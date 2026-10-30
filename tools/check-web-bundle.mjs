/**
 * Guard: the production web bundle carries nothing of the in-memory backend.
 *
 *   node tools/check-web-bundle.mjs [directory]     (default: web/dist/)
 *
 * The app runs on one of two backends (web/src/data/backend.ts): the instance's Supabase project,
 * or the in-memory fake (engine/ui/data/fake.ts) with a demo world, which only the end-to-end
 * build (`vite build --mode e2e`) is meant to hold. The glass work adds a second way to reach the
 * fake, the `?fixture=boards` URL, and a configuration slip that let either into a production
 * bundle would ship a page that answers from memory and seeds a world nobody made. Nothing at the
 * type level or in a test notices: the app works. So the fake carries a marker, the string
 * `KAYFA_FAKE_BACKEND`, as a value on the object `createFake` returns (and the fixture carries the
 * same), and this check reads every file `npm run build:web` wrote and fails naming each one that
 * holds it.
 *
 * Every file is read whole, so a marker split across two chunks is not a case: a bundler never cuts
 * inside a string literal, and a file read in two halves is not how the check works. An empty or
 * missing `web/dist/` fails as "nothing built", because a build that never ran has no marker in it
 * and would otherwise pass.
 *
 * The detection is exported and takes the directory, so tools/test-web-bundle.mjs drives it red
 * over scratch folders without building anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What the fake and the fixture carry. */
export const MARKER = 'KAYFA_FAKE_BACKEND';

/** Every file under a directory, as paths relative to it; [] for a directory that is not there. */
function filesUnder(dir, rel = '') {
  if (!fs.existsSync(path.join(dir, rel))) return [];
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(dir, next));
    else if (entry.isFile()) out.push(next.split(path.sep).join('/'));
  }
  return out.sort();
}

/**
 * What the check finds in a build directory: `{ files, carrying }`, the files read and the ones
 * that hold the marker. `files` is empty when nothing was built.
 */
export function bundleFaults(dir) {
  const files = filesUnder(dir);
  const carrying = files.filter((f) => fs.readFileSync(path.join(dir, f)).includes(MARKER));
  return { files, carrying };
}

function main() {
  const dir = path.resolve(process.argv[2] ?? path.join(repoRoot, 'web', 'dist'));
  const { files, carrying } = bundleFaults(dir);
  if (files.length === 0) {
    console.error(`  web-bundle: nothing built: ${dir} is missing or empty, so there is no bundle to check (run npm run build:web first)`);
    process.exit(1);
  }
  if (carrying.length) {
    console.error(`  web-bundle: ${carrying.length} file(s) in ${dir} carry ${MARKER}, so the in-memory backend reached this build:`);
    for (const f of carrying) console.error(`    ${f}`);
    console.error('  A production build runs on Supabase only: see web/src/data/backend.ts, which loads the fake in the e2e mode alone.');
    process.exit(1);
  }
  console.log(`  web-bundle: ${files.length} file(s) read, none carries ${MARKER}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
