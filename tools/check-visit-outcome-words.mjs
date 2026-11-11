/**
 * Holds the glass's words for how a visit ended to the outcomes the database allows ("Two lists that must agree are one list"). The
 * list is the latest `end_visit` check in supabase/migrations; the words are engine/ui/cards/visit.ts (`markText`, `tabName`,
 * `markLabel`, `noticeWords`) and engine/ui/profile/modlog.ts (`endedModWords`). It refuses:
 *
 *   1. an outcome the SQL allows with no words in one of the four places, or words for an outcome the SQL does not allow;
 *   2. words that say "admin" for an outcome some SQL writer ends with a null `by_act` and no writer names an Act for: nobody did that.
 *      (An outcome no writer ends at all may say admin; its words wait for the admin function that will write it.)
 *   3. a `noticeWords` that doubles the rule's number ("Rule 1: House Rule 1: x") for a rule that already says "Rule 1: x" or
 *      "House Rule 1: x"; the real function is imported by Node's type stripping and called with each shape of rule number.
 *
 *   node tools/check-visit-outcome-words.mjs
 *
 * tools/test-visit-outcome-words.mjs drives each refusal red.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIGRATIONS = 'supabase/migrations';
export const VISIT = 'engine/ui/cards/visit.ts';
export const VISIT_TSX = 'engine/ui/cards/Visit.tsx';
export const MODLOG = 'engine/ui/profile/modlog.ts';

/** The four texts, as the tree holds them (every migration, in order, as one text). */
export function readTree() {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  return {
    sqlText: files.map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')).join('\n'),
    visitText: fs.readFileSync(VISIT, 'utf8'),
    visitTsxText: fs.existsSync(VISIT_TSX) ? fs.readFileSync(VISIT_TSX, 'utf8') : '',
    modlogText: fs.readFileSync(MODLOG, 'utf8'),
  };
}

/** Every function's latest definition, by name: statements start at a line that opens with `create`, `drop` or `alter`. */
function latestFunctions(sql) {
  const latest = new Map();
  for (const chunk of sql.split(/^(?=(?:create|drop|alter)\s)/im)) {
    const m = /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/i.exec(chunk);
    if (m) latest.set(m[1], chunk);
  }
  return latest;
}

/** The text of the first function named `name` in `text`, to the closing brace that opens a line. */
function region(text, name) {
  const at = text.search(new RegExp(`export function ${name}\\b`));
  if (at < 0) return null;
  const end = text.indexOf('\n}', at);
  return text.slice(at, end < 0 ? undefined : end);
}

/** outcome -> the line of words, from `case 'x': return ...` lines or `x: ...` entries. */
function wordsByOutcome(body, shape) {
  const out = new Map();
  for (const line of body.split('\n')) {
    const m = shape === 'case' ? /^\s*case '(\w+)':/.exec(line) : /^\s{4}(\w+): [`'"]/.exec(line);
    if (m && m[1] !== 'open') out.set(m[1], line);
  }
  return out;
}

const RULES = [
  [{ cause: 'rule', rule: 'Rule 1: x', ruleNumber: 1 }, 'Rule 1: x'],
  [{ cause: 'rule', rule: 'House Rule 1: x', ruleNumber: 1 }, 'House Rule 1: x'],
  [{ cause: 'rule', rule: 'x', ruleNumber: 1 }, 'Rule 1: x'],
  [{ cause: 'rule', rule: 'Rule 1: x', ruleNumber: null }, 'Rule 1: x'],
  [{ cause: 'rule', rule: 'House Rule 1: x', ruleNumber: null }, 'House Rule 1: x'],
];

/** visit.ts with its relative imports made absolute, written where the system keeps scratch files, imported, and removed. */
async function loadNoticeWords(visitText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visit-words-'));
  try {
    const base = path.resolve(path.dirname(VISIT));
    const text = visitText.replace(/(from\s+')(\.{1,2}\/[^']+)(')/g, (_, a, spec, c) => a + pathToFileURL(path.resolve(base, spec)).href + c);
    const file = path.join(dir, 'visit.mts');
    fs.writeFileSync(file, text);
    return (await import(pathToFileURL(file).href)).noticeWords;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** What is wrong with the words, as sentences; nothing when they match the SQL. */
export async function visitWordFaults({ sqlText, visitText, modlogText }) {
  const faults = [];
  const fns = latestFunctions(sqlText);
  const def = fns.get('end_visit');
  const list = def && /outcome not in \(([^)]*)\)/i.exec(def);
  if (!list) return ['no latest end_visit check names the outcomes in supabase/migrations'];
  const allowed = [...list[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);

  const places = {
    markText: region(visitText, 'markText') === null ? null : wordsByOutcome(region(visitText, 'markText'), 'case'),
    tabName: region(visitText, 'tabName') === null ? null : wordsByOutcome(region(visitText, 'tabName'), 'case'),
    markLabel: region(visitText, 'markLabel') === null ? null : wordsByOutcome(region(visitText, 'markLabel'), 'key'),
    'modlog.ts endedModWords': region(modlogText, 'endedModWords') === null ? null : wordsByOutcome(region(modlogText, 'endedModWords').split("r.kind === 'report'")[0], 'case'),
  };
  for (const [place, found] of Object.entries(places)) {
    if (found === null) { faults.push(`${place} is not found, so its words for a visit's outcomes cannot be read`); continue; }
    for (const o of allowed) if (!found.has(o)) faults.push(`the outcome ${o} (end_visit allows it) has no words in ${place}`);
    for (const o of found.keys()) if (!allowed.includes(o)) faults.push(`${place} has words for ${o}, which end_visit does not allow`);
  }

  // Writers: every end_visit(…, 'outcome', by_act, …) call in each function's latest definition.
  const named = new Map();
  for (const [name, body] of fns) {
    if (name === 'end_visit') continue;
    for (const m of body.matchAll(/\bend_visit\(\s*[^,]+,\s*'(\w+)'\s*,\s*([^,]+),/g)) {
      const prior = named.get(m[1]) ?? { null: 0, act: 0 };
      if (/^null$/i.test(m[2].trim())) prior.null++; else prior.act++;
      named.set(m[1], prior);
    }
  }
  for (const [o, w] of named) {
    if (w.null === 0 || w.act > 0) continue;
    for (const [place, found] of Object.entries(places)) {
      if (found?.has(o) && /admin/i.test(found.get(o))) faults.push(`the words for ${o} in ${place} say admin, but every writer of ${o} passes a null by_act, so no admin ended it`);
    }
  }

  let notice;
  try { notice = await loadNoticeWords(visitText); } catch (e) { return [...faults, `engine/ui/cards/visit.ts could not be imported to test noticeWords: ${e.message}`]; }
  if (typeof notice !== 'function') return [...faults, 'engine/ui/cards/visit.ts exports no noticeWords'];
  for (const [partial, shown] of RULES) {
    const charge = { board: 'b', band: 'minor', ...partial };
    const got = notice([charge]);
    const want = `This post was found in violation of ${shown}.`;
    if (got !== want) faults.push(`noticeWords gives ${JSON.stringify(got)} for the rule ${JSON.stringify(partial.rule)} (number ${partial.ruleNumber}), not ${JSON.stringify(want)}; its rule test must accept "Rule 1: x" and "House Rule 1: x"`);
  }
  return faults;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const faults = await visitWordFaults(readTree());
  if (faults.length) { for (const f of faults) console.error(f); process.exit(1); }
  console.log("visit outcomes: every outcome end_visit allows has words, and the notice names each rule once");
}
