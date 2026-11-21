/**
 * Runs every `*.test.mjs` in tools/hype/ (the film's camera, the music's map and windows), as one build step. The runner's steps are
 * `node tools/x.mjs` or `npm run x`, and `node --test` takes a glob only on a command line, so this is that command line.
 * Node 22 reads the glob itself; a folder named alone would be run as a file.
 */
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, ['--test', 'tools/hype/*.test.mjs'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
