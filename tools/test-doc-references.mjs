/**
 * Tests for the guard in tools/check-doc-references.mjs.
 *
 * The guard exists because a sentence naming a file is a claim nothing checked: a check
 * once named its own self-test for four days, and the self-test did not exist. A dead
 * reference changes no pixel and no test, so the only honest way to know each branch
 * fires is to hand the detector documents that carry the defect, and documents that
 * merely look like they do. Every branch below is driven red and clean on purpose.
 */
import { docReferenceFaults, referencesIn, layerOf, HISTORICAL_RE } from './check-doc-references.mjs';

let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

/* A small tree, and the scripts package.json would hold. */
const TREE = new Set([
  'tools/build.mjs',
  'tools/check-working-rules.mjs',
  'docs/plans/port-manifest.md',
  'docs/research/2026-09-18 Drift in filed documents.md',
  'specs/README.md',
  'supabase/migrations/0001_extensions.sql',
]);
const DIRS = new Set(['tools', 'docs', 'docs/plans', 'docs/research', 'specs', 'supabase', 'supabase/migrations']);
const exists = (p) => TREE.has(p) || DIRS.has(p);
const scripts = new Set(['build', 'build:ci', 'typecheck', 'test:sql']);
const run = (files) => docReferenceFaults(files, { exists, scripts });
const faults = (text, file = 'CLAUDE.md') => run({ [file]: text });

// The good document: live paths, a live script, a directory both ways, a path with
// spaces, a path with a line number, a fragment. Nothing fires.
{
  const r = faults(
    'See `tools/build.mjs` and `tools/check-working-rules.mjs:27`, run `npm run test:sql`,\n' +
      'the folder `docs/plans/` and `docs/plans` and `specs/README.md#the-taxonomy`,\n' +
      'filed at `docs/research/2026-09-18 Drift in filed documents.md`.',
  );
  check('a document whose references all resolve is clean', r.current.length === 0 && r.record.length === 0, JSON.stringify(r));
  check('and every reference on it was counted, so the pass is not over nothing', r.scannedCurrent === 7, `scanned ${r.scannedCurrent}`);
}

// The defect that started this: a current document naming a test file that does not exist.
{
  const r = faults('Its branches are driven red in `tools/test-nowhere.mjs`.');
  check('a dead path in a current document fires', r.current.length === 1 && r.current[0].ref === 'tools/test-nowhere.mjs', JSON.stringify(r.current));
  check('and it is not filed under records', r.record.length === 0);
  check('and it names the line', r.current[0].line === 1);
}

// A missing npm script fires; a present one does not.
{
  check('`npm run nope` fires', faults('Run `npm run nope` first.').current.length === 1);
  check('`npm run build` with trailing flags is read as build', faults('Run `npm run build -- --force`.').current.length === 0);
}

// The sentence says the thing is gone: excused, and counted as excused.
{
  const r = faults('`tools/check-schema-deployed.mjs` was never written; the schema burst brings it.');
  check('a path the sentence says was never written is excused', r.current.length === 0 && r.excused === 1, JSON.stringify(r));
  check('"does not exist" excuses', faults('`tools/x.mjs` does not exist.').current.length === 0);
  check('"no longer" excuses', faults('`tools/x.mjs` is no longer part of the build.').current.length === 0);
  check('the explicit marker excuses a sentence the grammar cannot read', faults('Compare `tools/x.mjs`. <!-- historical -->').current.length === 0);
  check('a sentence that merely mentions a plan does not excuse', faults('We planned `tools/x.mjs` for the picker.').current.length === 1);
}

// Generated paths are the design, not drift.
{
  check('a generated path is not a dead reference', faults('Written to `node_modules/.cache/scratch/repo` by the test.').current.length === 0);
  check('`dist/` is not a dead reference', faults('Grep `dist/search-index.json`.').current.length === 0);
}

// Shapes are not files.
{
  const refs = referencesIn('`docs/plans/YYYY-MM-DD-NN-slug.md`, `supabase/tests/NN-*.sql`, `src/core/**`, `public/scans/<slug>/pNN.jpg`');
  check('placeholders are not references', refs.length === 0, JSON.stringify(refs));
  check('a bare directory name without a slash is not a reference', referencesIn('the `tools` folder and `src`').length === 0);
  check('a path outside the known roots is not a reference', referencesIn('`lib/foo.mjs` and `~/.claude/settings.json`').length === 0);
}

// Commands, ranges and elided names: the path is what is looked up.
{
  check('a script named with its flag resolves by the script', faults('Run `tools/check-working-rules.mjs --list`.').current.length === 0);
  check('a script named with its flag still fires when the script is dead', faults('Run `tools/gone.mjs --check`.').current.length === 1);
  check('a document name with spaces is not cut at the first space', faults('Filed at `docs/research/2026-09-18 Drift in filed documents.md`.').current.length === 0);
  check('a ~line range is stripped', faults('See `tools/build.mjs:~190-210`.').current.length === 0);
  check('an elided name with three dots is a shape, not a file', referencesIn('`docs/research/Drift in ... documents.md`').length === 0);
}

// Records: reported, never gated, whichever way they are declared.
{
  const r = faults('Waiting on `tools/tick.mjs`.', 'docs/plans/2026-09-18-04-pipeline.md');
  check('a record by directory is reported, not failed', r.current.length === 0 && r.record.length === 1, JSON.stringify(r));
  const s = faults('**Surveyed 2026-09-18, at commit `a7ecb02`.**\n\nSee `supabase/tests/99-nothing.sql`.', 'docs/site-inventory.md');
  check('a record by its opening survey line is reported, not failed', s.current.length === 0 && s.record.length === 1, JSON.stringify(s));
  check('a record does not count toward the current floor', s.scannedCurrent === 0);
  const late = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nSurveyed long after the head. `tools/x.mjs`';
  check('"Surveyed" past the first eight lines does not make a record', layerOf('docs/thing.md', late) === 'current');
  check('a new document is current by default', layerOf('docs/new-queue.md', 'Things to ask for.') === 'current');
}
{
  const r = faults('Waiting on `tools/tick.mjs`.', 'docs/working-rules/secrets.md');
  check('a working-rules record is a record: a dead path is reported, not failed', r.current.length === 0 && r.record.length === 1, JSON.stringify(r));
}
{
  const f = run({ 'docs/notes.md': 'Record, written 2026-09-18.\n\nSee `tools/gone.mjs`.' });
  check('a file opening "Record, written <date>" is a record wherever it lives',
    f.record.length === 1 && f.current.length === 0);
}

// The grammar is narrow on purpose.
{
  check('"rather than" alone does not excuse', !HISTORICAL_RE.test('use `tools/a.mjs` rather than the dev server'));
  check('"was deleted" excuses', HISTORICAL_RE.test('`docs/stats.json` was deleted after serving stale counts'));
}

console.log(`\n  doc-references: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-doc-references: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
