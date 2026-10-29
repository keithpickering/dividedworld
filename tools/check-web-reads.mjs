/**
 * Guard: the web app reads only public projections and the player's own rows.
 *
 *   node tools/check-web-reads.mjs
 *
 * "A response never proves a private fact." The database already refuses most of what a
 * browser must not read, but not all: a table granted to its owner's rows (`characters`,
 * `class_history`, `ledger`) is readable as yourself, and a screen reading one where a narrow
 * view exists starts depending on columns no screen should hold (a character's owner, its
 * class history's ids, whose gaps count other players' Turns). A read of a private table changes
 * no screen a test looks at; it puts a private fact in a browser, where any player can see it in
 * the network panel. So the names the app may read are a list here, read on every build.
 *
 * Read from the TypeScript AST of every tracked file in web/, engine/ui/ and instances/<name>/ui/
 * (`git ls-files` on purpose: an untracked scratch file neither fails the build nor makes it pass):
 * - `.from('x')` on anything but a built-in (`Array`, `Buffer`, `Object`, `Uint8Array`, `Set`, `Map`,
 *   alone or read through `globalThis.`/`window.`), and `.rpc('x')`, name a table, view or
 *   function, written as a property or as `client['from']`, through parentheses, casts and `!`;
 *   each must be in ALLOWED_READS or ALLOWED_RPCS. One the guard cannot read (a variable) fires,
 *   since it could name anything. A `.from()` is read at once with `.select()`: one stored,
 *   returned, or followed by anything else fires, and a `.insert()`, `.upsert()`, `.update()` or
 *   `.delete()` fires whatever it names, since every write goes through a function (`act`, an
 *   allowed rpc), which holds the rules.
 * - `from`, `rpc` and `schema` taken off a client without being called at once (destructured,
 *   `.bind`-ed, assigned) fire; `.schema()` is read at once with `.from()`.
 * - `.storage.from('x')` names a bucket; only ALLOWED_BUCKETS (the public avatar bucket) is clean.
 * - A string holding `/rest/v1/x` or `/rest/v1/rpc/x` is held to the same lists; one that ends at
 *   `/rest/v1`, `/rest/v1/` or `/rest/v1/rpc/` (a path built in pieces) fires, unreadable.
 * - `@supabase/supabase-js` is imported, exported from, `import()`-ed or `require()`-d only in
 *   web/src/data/, the one place a client lives ("Portable by construction").
 *
 * The detection is exported and pure so tools/test-web-reads.mjs drives every branch red.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files the guard reads. */
export const SOURCE = /^(web\/|engine\/ui\/|instances\/[^/]+\/ui\/).*\.(ts|tsx|mts|js|mjs)$/;
const DATA_LAYER = /^web\/src\/data\//;

/**
 * The tables and views a screen may read: public projections, then the player's own rows, each a
 * view or a table whose policy is the caller's own (supabase/migrations/; 0030_screens_reads.sql
 * adds the my_* views, thread_list and screen_settings).
 */
export const ALLOWED_READS = Object.freeze([
  // Public: what anyone could have watched.
  'boards', 'threads', 'thread_list', 'acts_public', 'characters_public', 'character_profiles', 'class_kinds', 'reaction_kinds', 'card_kinds',
  'reaction_tallies', 'effect_state', 'pip_styles', 'thread_view_counts', 'seasons', 'settlements', 'standings', 'season_standings',
  'class_reveals', 'turns_announced', 'screen_settings', 'character_post_counts',
  // The player's own.
  'my_characters', 'my_wallet', 'my_ledger', 'my_wallet_events', 'my_cards', 'my_reactions', 'my_invites', 'reading',
  'account_preferences', 'effect_releases',
]);

/** The SQL functions a screen may call directly; every other write goes through the `act` function. */
export const ALLOWED_RPCS = Object.freeze(['whoami', 'is_admin', 'next_settlement_at', 'mark_read', 'set_preferences', 'set_profile', 'release_effect', 'card_target']);

const WRITES = new Set(['insert', 'upsert', 'update', 'delete']);
const NOT_A_CLIENT = new Set(['Array', 'Buffer', 'Object', 'Uint8Array', 'Set', 'Map']);
/** The storage buckets a screen may touch: the avatar bucket is public, so a read of it proves nothing private. */
export const ALLOWED_BUCKETS = Object.freeze(['avatars']);
const GLOBALS = new Set(['globalThis', 'window', 'self']);
/** The members of a client the guard reads; each must be called at once, with a literal. */
const CLIENT_MEMBERS = new Set(['from', 'rpc', 'schema']);

/** The expression under any parentheses, casts, non-null marks and satisfies. */
function unwrap(node) {
  let n = node;
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
  return n;
}

/** The name a member access reads, `a.x` or `a['x']`, or null for any other node. */
function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))) return node.argumentExpression.text;
  return null;
}

/** True when an expression is a built-in (`Array`, `globalThis.Array`) and not a client. */
function isBuiltIn(node) {
  const n = unwrap(node);
  if (ts.isIdentifier(n)) return NOT_A_CLIENT.has(n.text);
  const name = memberName(n);
  return name !== null && NOT_A_CLIENT.has(name) && ts.isIdentifier(unwrap(n.expression)) && GLOBALS.has(unwrap(n.expression).text);
}

/** Every fault in one file. */
function fileFaults(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const literal = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null);
  const fault = (node, name, why) => out.push({ file, line: lineOf(node), name, why });

  /** The node above `node` once parentheses, casts and non-null marks are passed. */
  const up = (node) => {
    let n = node;
    while (n.parent && (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isNonNullExpression(n.parent) || ts.isSatisfiesExpression(n.parent) || ts.isTypeAssertionExpression(n.parent))) n = n.parent;
    return n;
  };

  /** The methods a call's result is chained into: `.from('x').insert()` gives ["insert"]. */
  const chained = (call) => {
    const names = [];
    let n = up(call);
    while (n.parent && memberName(n.parent) !== null && n.parent.expression === n && n.parent.parent && ts.isCallExpression(up(n.parent).parent) && up(n.parent).parent.expression === up(n.parent)) {
      names.push(memberName(n.parent));
      n = up(up(n.parent).parent);
    }
    return names;
  };

  /** The Supabase module a call or import names: import('@supabase/x'), require('@supabase/x'). */
  const loadedModule = (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length < 1) return null;
    const callee = node.expression;
    const loads = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
    return loads ? literal(node.arguments[0]) : null;
  };

  const visit = (node) => {
    const spec = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier ? literal(node.moduleSpecifier) : loadedModule(node);
    if (spec?.startsWith('@supabase/') && !DATA_LAYER.test(file)) fault(node, spec, 'a Supabase client lives only in web/src/data/');

    /* A destructured from or rpc is a client member read where no call shows its name. */
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      const init = node.parent.parent.initializer;
      if (ts.isIdentifier(key) && CLIENT_MEMBERS.has(key.text) && !(init && isBuiltIn(init))) fault(node, key.text, `a .${key.text} taken off a client without calling it at once with a literal`);
    }

    const member = memberName(node);
    if (member !== null && CLIENT_MEMBERS.has(member) && !isBuiltIn(node.expression)) {
      const outer = up(node);
      const call = outer.parent;
      const called = call && ts.isCallExpression(call) && call.expression === outer;
      const name = called ? literal(call.arguments[0]) : null;
      const recv = unwrap(node.expression);
      const storage = member === 'from' && memberName(recv) === 'storage';
      if (!called) fault(node, member, `a .${member} read without a call: the guard cannot tell what it will name`);
      else if (storage) {
        if (name === null) fault(call, null, 'a storage bucket the guard cannot read, which could be any bucket');
        else if (!ALLOWED_BUCKETS.includes(name)) fault(call, name, 'not the public avatar bucket');
      } else if (member === 'schema') {
        const next = up(call).parent;
        if (!(next && memberName(next) === 'from')) fault(call, null, 'a .schema() is read at once with .from()');
      } else if (name === null) fault(call, null, member === 'from' ? 'a table the guard cannot read, which could be any table' : 'a function the guard cannot read, which could be any function');
      else if (member === 'rpc') {
        if (!ALLOWED_RPCS.includes(name)) fault(call, name, 'not a function the screens may call directly');
      } else if (!ALLOWED_READS.includes(name)) fault(call, name, 'not a public projection or one of the player\'s own views');
      else {
        const [first, ...rest] = chained(call);
        const w = [first, ...rest].find((m) => WRITES.has(m));
        if (w) fault(call, name, `a .${w}(): every write goes through the act function or an allowed rpc`);
        else if (first !== 'select') fault(call, name, 'a .from() is read at once with .select()');
      }
    }

    const s = literal(node) ?? (ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((t) => t.literal.text)].join('\0') : null);
    if (s !== null) {
      if (/\/rest\/v1(\/(rpc\/?)?)?(\0|$)/.test(s)) fault(node, null, 'a REST path the guard cannot read, which could name any table');
      else {
        for (const m of s.matchAll(/\/rest\/v1\/(rpc\/)?([A-Za-z_][\w]*)/g)) {
          const ok = m[1] ? ALLOWED_RPCS.includes(m[2]) : ALLOWED_READS.includes(m[2]);
          if (!ok) fault(node, m[2], m[1] ? 'a REST rpc path to a function the screens may not call' : 'a REST path to a table that is not a public projection or one of the player\'s own views');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * Every fault in a set of files, as `{ file, line, name, why }`; [] is clean.
 * @param {Record<string, string>} files repository path to text
 */
export function readFaults(files) {
  const out = [];
  for (const [file, text] of Object.entries(files)) if (SOURCE.test(file)) out.push(...fileFaults(file, text));
  return out;
}

/** The tracked web, screen and instance-ui sources, read from disk. */
export function treeFiles() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, string>} */
  const files = {};
  for (const p of tree) if (SOURCE.test(p) && fs.existsSync(path.join(repoRoot, p))) files[p] = fs.readFileSync(path.join(repoRoot, p), 'utf8');
  return files;
}

function main() {
  const files = treeFiles();
  /* A guard reading nothing would pass; the data layer is always there, so an empty read is a broken read. */
  if (!Object.keys(files).some((f) => DATA_LAYER.test(f))) {
    console.error('  web-reads: no file in web/src/data/ was read, which cannot be right; refusing to report a pass on nothing');
    process.exit(1);
  }
  const faults = readFaults(files);
  if (faults.length) {
    console.error(`  web-reads: ${faults.length} read(s) outside the public projections and the player's own rows:`);
    for (const f of faults) console.error(`    ${f.file}:${f.line}  ${f.name ?? '(unreadable)'}  ${f.why}`);
    console.error('  See CLAUDE.md, "A response never proves a private fact"; the lists are in tools/check-web-reads.mjs.');
    process.exit(1);
  }
  console.log(`  web-reads: ${Object.keys(files).length} web, screen and instance-ui file(s), every read a public projection or the player's own`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
