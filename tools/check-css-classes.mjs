/**
 * Guard: every `kb-*` class a component names has a rule.
 *
 *   node tools/check-css-classes.mjs
 *
 * A class with no rule anywhere draws as the browser's default: a button with no style, a list with
 * its bullets. Nothing else notices (the behavior tests find the element by its role, and the
 * layout checks measure what is drawn, not what should have been), and it happens when a change deletes
 * a stylesheet's rules and leaves a component naming them (the admin screen's buttons, after the glass
 * control replaced the write-update ones).
 *
 * Read: every `.tsx` under engine/ and instances/ that is not a test, from the TypeScript AST. In a
 * `className` attribute, every string literal, no-substitution template and template chunk (a ternary's
 * branches, a `&&`, an array joined, the arguments of a call) is split on whitespace, and a word that starts
 * with `kb-` is a class a component names. A chunk that a `${}` continues (`kb-thing-${a}`) is a prefix
 * and not a class. A class is defined when any tracked stylesheet, comments stripped, has `.kb-name` in
 * a selector. A class with no rule
 * must be in ALLOWED_HOOKS: a hook that is on an element for a script, a test, a layout check or a
 * stylesheet's selector chain that names an attribute, and has no style of its own. Every entry is
 * justified where it is listed, and tools/test-css-classes.mjs fails an entry no component names.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass. The detection
 * is exported and pure so tools/test-css-classes.mjs drives it red on a component with a class no rule defines.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COMPONENT = /^(engine|instances)\/.*\.tsx$/;
const TEST = /\.test\.tsx$|\.stories\.tsx$/;
const STYLESHEET = /\.css$/;

/**
 * Classes a component names that no stylesheet styles, each group with why. A class that should have a style gets its
 * rule instead (the stale `kb-glass-chamfer-4` on the settlement's rank card was removed, not listed).
 * @type {ReadonlySet<string>}
 */
export const ALLOWED_HOOKS = new Set([

  /* Page and section roots. Each marks the one element a page or section draws in, so an instance's theme (a CSS file
  of overrides, docs/plans/2026-10-29-screens-design.md section 12) and an e2e can name it; the page's own look is its
  children's rules and the glass's page frame, so the root has none of its own. */
  'kb-settings',
  'kb-settings-section',
  'kb-sign-in',
  'kb-index',
  'kb-contact',
  'kb-staff',
  'kb-open-account',
  'kb-edit-post',
  'kb-editor',
  'kb-season-news',
  'kb-updates-main',
  'kb-updates-side',
  'kb-log-details',

  /* The part of a dialog or a card a theme can name. The look is the shared frame's (engine/ui/glass/Frame.tsx) or the
  card kit's; the part adds none. */
  'kb-vending-about-dialog',
  'kb-picker-body',
  'kb-lens-act',
  'kb-lens-action',
  'kb-lens-who-section',
  'kb-mark-more',
  'kb-callout-first',
  'kb-play-message',
  'kb-editor-hint',
  'kb-quote-body',

  /* A row's or a line's part inside a grid or a flow its parent's rule lays out (the write-update row's grid gives the
  label its 1fr and the text its 3fr by position, the queue's move by its columns); the part is named for a theme and
  for a test's query, and adds no rule. */
  'kb-write-update-label',
  'kb-write-update-text',
  'kb-queue-when',
  'kb-turn-when',
  'kb-turn-note',
  'kb-roster-panel-head',
  'kb-character-sub',
  'kb-composer-now-region',
  'kb-composer-reveal',
  'kb-spin-now-region',
  'kb-origin-update-title',
  'kb-settled-wallet',
  'kb-acct-choice',
  'kb-board-link',
  'kb-thread-last-link',
  'kb-thread-started',
  'kb-thread-spun',

  /* A profile's, a postbit's or a staff page's named part: text that takes the surrounding block's type and color,
  named so a theme can restyle it alone. */
  'kb-profile-name',
  'kb-profile-title',
  'kb-profile-standing',
  'kb-profile-counts',
  'kb-profile-class',
  'kb-postbit-title',
  'kb-postbit-rank-name',
  'kb-staff-career',
  'kb-career',
  'kb-preview-line',
  'kb-preview-nothing',
  'kb-portrait-none',
  'kb-reveal-name',

  /* A state or kind a component marks on an element for a theme or a test, where the state's look is already drawn by
  the element's own class or its data attribute. */
  'kb-flag-hot',
  'kb-move-counted',
  'kb-orb--full',
  'kb-new-thread-body',
  'kb-new-thread-none',
  'kb-new-thread-title',
  'kb-new-thread-toggle',
  'kb-system-post',
  'kb-guide-classes',
  'kb-guide-marker',
  'kb-legend',
]);

/** The classes a stylesheet's selectors define, its comments stripped. */
function definedIn(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  for (const m of bare.matchAll(/\.(kb-[A-Za-z0-9_-]+)/g)) out.add(m[1]);
  return out;
}

/** Each `kb-` class a `className` attribute or object property names in a component's source, with its line. */
export function namedIn(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const words = (chunk, node, prefixAtEnd) => {
    const parts = chunk.split(/\s+/);
    parts.forEach((w, i) => {
      if (!w.startsWith('kb-')) return;
      /* The last word of a chunk that a `${}` continues is the start of a name, not a name. */
      if (prefixAtEnd && i === parts.length - 1) return;
      out.push({ name: w, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    });
  };
  const read = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) words(node.text, node, false);
    else if (ts.isTemplateExpression(node)) {
      words(node.head.text, node.head, true);
      for (const span of node.templateSpans) {
        read(span.expression);
        words(span.literal.text, span.literal, ts.isTemplateMiddle(span.literal));
      }
      return;
    }
    ts.forEachChild(node, read);
  };
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'className' && node.initializer) read(node.initializer);
    /* An object that carries props to an element (`{ className: 'kb-toast' }`) names classes the same way. */
    else if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'className') read(node.initializer);
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Every `kb-` class a component names that no stylesheet defines and no hook allows.
 * @param {Record<string, string>} files tracked path to text
 */
export function classFaults(files) {
  const defined = new Set();
  for (const [p, t] of Object.entries(files)) if (STYLESHEET.test(p)) for (const c of definedIn(t)) defined.add(c);
  const faults = [];
  for (const [p, t] of Object.entries(files)) {
    if (!COMPONENT.test(p) || TEST.test(p)) continue;
    for (const n of namedIn(t, p)) if (!defined.has(n.name) && !ALLOWED_HOOKS.has(n.name)) faults.push({ file: p, line: n.line, name: n.name });
  }
  return faults;
}

export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if ((STYLESHEET.test(p) || COMPONENT.test(p)) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  /* A guard reading nothing would pass. */
  if (!Object.keys(files).some((f) => f.endsWith('.css')) || !Object.keys(files).some((f) => COMPONENT.test(f))) {
    console.error('  css-classes: no stylesheet or no component was read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = classFaults(files);
  if (faults.length) {
    console.error(`  css-classes: ${faults.length} class(es) a component names that no stylesheet styles:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.name}`);
    console.error('  Give the class a rule, use the glass control, or list it in ALLOWED_HOOKS (tools/check-css-classes.mjs) with why it has no style.');
    process.exit(1);
  }
  console.log(`  css-classes: ${Object.keys(files).length} file(s), every kb- class a component names has a rule`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
