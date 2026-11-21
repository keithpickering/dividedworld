/**
 * Runs every `*.test.mjs` in tools/hype/ (the film's camera, the music's map and windows, the edit), as one build step. The runner's
 * steps are `node tools/x.mjs` or `npm run x`, and `node --test` takes a glob only on a command line, so this is that command line.
 * Node 22 reads the glob itself; a folder named alone would be run as a file.
 *
 *   node tools/test-hype.mjs [glob]        (the glob is for tools/test-test-hype.mjs, which drives this red)
 *
 * It fails when the glob matches no test file, when no test ran (a skipped or todo test did not run), and when a test failed: a runner that passes over nothing has only
 * shown that it runs.
 */
import { spawnSync } from 'node:child_process';

const glob = process.argv[2] ?? 'tools/hype/*.test.mjs';
const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', glob], { encoding: 'utf8', maxBuffer: 1 << 26 });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
/* A file that holds no test is itself reported as one, named by its path: those are not tests that ran. */
/* A test that was skipped or marked todo did not run either (`ok 1 - name # SKIP`, `# TODO`). */
const ran = [...r.stdout.matchAll(/^(?:not )?ok \d+ - (.*)$/gmu)].filter((m) => !/\.mjs$/u.test(m[1]) && !/ # (?:SKIP|TODO)\b/u.test(m[1])).length;
if (r.status !== 0) process.exit(r.status ?? 1);
if (ran === 0) {
  console.error(`test-hype: no test ran for ${glob}: no *.test.mjs matched, or the files hold no test`);
  process.exit(1);
}
