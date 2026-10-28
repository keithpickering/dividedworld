/**
 * Guard: a repository path or an npm script named in the prose layers resolves, or the
 * sentence says it is gone.
 *
 * A sentence that names a file is making a claim the build can check, and until this
 * guard nothing did. A check once said for four days that "its branches are driven red"
 * in a test file that had never existed; a branch was trusted on the strength of a
 * sentence. A survey of the same prose found thirteen more of the same shape: a skill
 * naming a function that had been renamed, a page naming a database column no migration
 * creates, a skill saying a key was "deliberately absent from CI" after two workflows had
 * it. None of them changed a pixel or a test. They were found by a person reading, which
 * is the one detector this repository does not run on every push.
 *
 * Two kinds, decided in specs/2026-10-28-doc-layers.md and encoded in LAYERS below:
 *
 *   Current   CLAUDE.md, README.md, specs/, .github/, and any document under docs/ that
 *             is not a record. Read as true today. A dead reference here FAILS THE
 *             BUILD — unless the sentence itself says the thing is absent (the
 *             HISTORICAL grammar, or an explicit <!-- historical --> on the line),
 *             because "tools/x.mjs was never written" is a true sentence about a file
 *             that does not exist.
 *   Record    docs/plans/, docs/research/, the skills in .claude/skills/, and any file that opens
 *             by saying what it surveyed or the date it was written. Left as written,
 *             by the repository's own rule. A dead reference here is REPORTED, never
 *             gated, so the build's tail says which records have aged without anyone
 *             being tempted to edit a record into looking current.
 *
 * A file is current unless it is declared a record, so a new document that names dead
 * things fails loudly by default and earns its exemption by living where records live
 * or by saying what it surveyed.
 *
 * Read from git rather than the disk: a file deleted but still on disk must not pass,
 * and an untracked scratch file must not make a reference true. Reads source, not a
 * generated tree, because prose is decided in source; it runs before anything slow for
 * that reason and takes well under a second. The detection is exported and pure so
 * tools/test-doc-references.mjs can drive every branch red on purpose.
 *
 * Not covered, deliberately: pull request numbers ("waiting on PR #97" outlived the
 * merge), function names inside prose, and counts stated in words ("18 queries" when
 * the fixture holds 21). Those stay a person's sweep. This guard takes the cheap,
 * exact eighty percent so that sweep can spend its attention on the rest.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The prose layers, and which of them are records. Everything scanned and not matched
    here is current. A record is declared by where it lives or by opening, within its
    first eight lines, with the commit it surveyed — `Surveyed 2026-09-18, at commit
    a7ecb02` — or with `Record, written YYYY-MM-DD`, which is how every plan opens.
    The skills under .claude/skills/ are records too: a skill's text is reported against, never
    edited to satisfy a guard. */
export const LAYERS = {
  scan: [/^CLAUDE\.md$/, /^README\.md$/, /^specs\/.*\.md$/, /^\.claude\/.*\.md$/, /^docs\/.*\.md$/, /^\.github\/.*\.md$/],
  recordDirs: ['docs/plans/', 'docs/research/', 'docs/working-rules/', '.claude/skills/'],
  recordMarker: /\bSurveyed\b|^Record, written \d{4}-\d{2}-\d{2}/m,
  recordMarkerLines: 8,
};

/** Paths the build writes and git never holds. Their absence from the tree is the
    design, so a reference to one is not a dead reference. */
export const GENERATED = ['dist/', 'node_modules/'];

/** Top-level directories a backticked span must start with to count as a path. Root
    files (`package.json`, `LICENSE`) are not checked: a bare filename is too often a
    file of that name somewhere else. */
const DIRS = ['src', 'tools', 'supabase', 'docs', 'public', 'specs', 'scripts', '.github', '.claude'];
const PATH_RE = new RegExp(`^(?:${DIRS.map((d) => d.replace('.', '\\.')).join('|')})/`);

/** A span that is a shape, not a file: `docs/plans/YYYY-MM-DD-NN-slug.md`,
    `supabase/tests/NN-*.sql`, `src/core/**`, `public/scans/<slug>/pNN.jpg`. */
const PLACEHOLDER_RE = /[<>*…{}]|\.\.\.|YYYY|\bMM-DD\b|\bNN+\b/;

/** The sentence says the thing is gone or was never there. Kept narrow on purpose: a
    broad grammar ("instead of", "planned") would exempt real drift, and the explicit
    marker exists for the sentence this cannot recognise. */
export const HISTORICAL_RE =
  /not exist|never (?:been )?(?:written|built|created|existed|shipped|added)|no longer|was (?:deleted|removed|renamed|retired|replaced|dropped|never)|(?:has|have|had) been (?:deleted|removed|retired|renamed|dropped|replaced)|is gone|retired|superseded|used to|formerly|gitignored|not yet (?:written|built|created|exist|in the)|does not (?:yet )?exist|to be written|would be written|should not be written|has not been written|is not written|writes? (?:it )?to|written by|generated by|refuses? to (?:write|create)/i;
export const MARKER_RE = /<!--\s*historical\s*-->/;

/** Below this many references across the current layer, the extraction has broken and
    a pass would be a pass over nothing. Set to half the count measured on the day the
    guard landed here, so it trips on a broken extractor and not on an ordinary edit. */
export const CURRENT_FLOOR = Number(process.env.DOC_REFERENCES_FLOOR ?? 8); // 17 measured on 2026-10-28

export function layerOf(file, text) {
  if (LAYERS.recordDirs.some((d) => file.startsWith(d))) return 'record';
  const head = text.split('\n', LAYERS.recordMarkerLines).join('\n');
  if (LAYERS.recordMarker.test(head)) return 'record';
  return 'current';
}

/**
 * Every repository path and npm script a document names in a backticked span, with
 * the line it sits on. A path keeps its spaces (a filed document's name may carry
 * them) and loses a trailing `:line`, a `#fragment` and a trailing slash before it is
 * looked up.
 */
export function referencesIn(text) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((lineText, i) => {
    for (const m of lineText.matchAll(/`([^`\n]+)`/g)) {
      const span = m[1].trim();
      const script = span.match(/^npm run ([A-Za-z0-9:_-]+)(?:\s|$)/);
      if (script) {
        out.push({ kind: 'script', ref: script[1], line: i + 1, lineText });
        continue;
      }
      if (!PATH_RE.test(span)) continue;
      if (PLACEHOLDER_RE.test(span)) continue;
      /* `tools/build.mjs --list` names a script and its flag; the path is the first
         token. A document may carry spaces in its own name, so only a first token that
         is itself a script is cut from what follows it. */
      const first = span.split(/\s+/)[0];
      const command = first !== span && /\.(?:mjs|cjs|js|ts|py|sh)$/.test(first) ? first : span;
      const ref = command.replace(/:~?\d+(?:-\d+)?$/, '').replace(/#.*$/, '').replace(/\/$/, '');
      if (!ref.includes('/')) continue;
      out.push({ kind: 'path', ref, line: i + 1, lineText });
    }
  });
  return out;
}

/**
 * Pure detection. `files` maps a repository path to its text; `exists(path)` answers
 * whether a path or directory is in the tree; `scripts` is the set of npm script names.
 * Returns the dead references split by layer, plus what was scanned and what the
 * historical grammar excused, so the caller can refuse a vacuous pass.
 */
export function docReferenceFaults(files, { exists, scripts }) {
  const current = [];
  const record = [];
  let scannedCurrent = 0;
  let excused = 0;

  for (const [file, text] of Object.entries(files)) {
    const layer = layerOf(file, text);
    for (const r of referencesIn(text)) {
      if (layer === 'current') scannedCurrent++;
      const resolved =
        r.kind === 'script'
          ? scripts.has(r.ref)
          : GENERATED.some((g) => r.ref === g.replace(/\/$/, '') || r.ref.startsWith(g)) || exists(r.ref);
      if (resolved) continue;
      if (HISTORICAL_RE.test(r.lineText) || MARKER_RE.test(r.lineText)) {
        excused++;
        continue;
      }
      (layer === 'current' ? current : record).push({ file, line: r.line, kind: r.kind, ref: r.ref });
    }
  }
  return { current, record, scannedCurrent, excused };
}

function tracked() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function main() {
  const tree = tracked();
  const fileSet = new Set(tree);
  const dirSet = new Set();
  for (const p of tree) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirSet.add(parts.slice(0, i).join('/'));
  }
  const exists = (p) => fileSet.has(p) || dirSet.has(p);
  const scripts = new Set(Object.keys(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts));

  const files = {};
  for (const p of tree) {
    if (LAYERS.scan.some((re) => re.test(p))) files[p] = fs.readFileSync(p, 'utf8');
  }

  const { current, record, scannedCurrent, excused } = docReferenceFaults(files, { exists, scripts });
  const show = (f) => `    ${f.file}:${f.line}  ${f.kind === 'script' ? 'npm run ' : ''}${f.ref}`;

  if (record.length) {
    console.log(
      `  doc-references: ${record.length} reference(s) in ${new Set(record.map((f) => f.file)).size} record(s) no longer resolve — records are left as written; listed so nobody reads them as current:\n` +
        record.map(show).join('\n'),
    );
  }

  if (current.length) {
    console.error(
      `  doc-references: ${current.length} reference(s) in current documents do not resolve:\n` +
        current.map(show).join('\n') +
        '\n  Fix the sentence, or — if the thing is gone on purpose — say so in the sentence, or end' +
        '\n  the line with <!-- historical -->. A document that describes a day rather than today' +
        '\n  opens with "Record, written <date>" or "Surveyed <date>, at commit <sha>" and is' +
        '\n  reported, not gated. See specs/2026-10-28-doc-layers.md.',
    );
    process.exit(1);
  }

  if (scannedCurrent < CURRENT_FLOOR) {
    console.error(
      `  doc-references: only ${scannedCurrent} reference(s) found across the current layer, which cannot be right —` +
        ` extraction is probably broken. Refusing to report a pass on nothing.`,
    );
    process.exit(1);
  }

  console.log(
    `  doc-references: ${scannedCurrent} path and script reference(s) in ${Object.keys(files).length} document(s) resolve` +
      (excused ? `; ${excused} name(s) something the sentence says is gone` : '') +
      (record.length ? `; ${record.length} aged in records, above` : ''),
  );
}

// Guarded so the test file can import the detection without the check running.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
