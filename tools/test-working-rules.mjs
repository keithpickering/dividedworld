/**
 * tools/check-working-rules.mjs, driven red on purpose.
 *
 *   node tools/test-working-rules.mjs
 *
 * Every case starts from the real CLAUDE.md and breaks one section, because a checker
 * proved against a synthetic file proves only that it can read the file. The last case
 * asserts the committed file passes, so a `problems()` gone quiet fails here.
 *
 * The case this exists for is the first: an entry written at the end of a long session,
 * story first, with the rule somewhere in the fortieth line — the shape every entry
 * takes when nothing reads it.
 */
import fs from 'node:fs';
import { problems, headline, sections, FILE, loadRecords, slug } from './check-working-rules.mjs';

/* Normalised to LF on the way in: this file builds HEAD with `\n` and searches for it
   verbatim, and on a Windows checkout CLAUDE.md is CRLF — the first Windows build after
   this guard landed threw "could not find the first heading verbatim" here. The
   checker itself is exercised as CRLF in the case before the last. */
const REAL = fs.readFileSync(FILE, 'utf8').replace(/\r\n?/g, '\n');
const first = sections(REAL)[0];
if (!first) throw new Error('CLAUDE.md has no sections to test against');
const HEAD = `## ${first.title}\n`;
if (!REAL.includes(HEAD)) throw new Error('could not find the first heading verbatim');

let failures = 0;

/** @param {string} name @param {string} md @param {RegExp} expected */
function red(name, md, expected) {
  const found = problems(md);
  if (found.some((p) => expected.test(p))) {
    console.log(`ok    ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${name}`);
  console.error(`      expected a complaint matching ${expected}`);
  console.error(found.length ? `      got:${found.map((f) => `\n        - ${f}`).join('')}` : '      got: no complaints at all');
}

/* Replace the first section's headline paragraph with `para`. */
function withFirstParagraph(para) {
  const after = REAL.indexOf(HEAD) + HEAD.length;
  const rest = REAL.slice(after);
  const m = rest.match(/^\n*(\*\*[^\n]*(?:\n[^\n]+)*)\n/);
  if (!m) throw new Error('first section has no bold paragraph to replace');
  return REAL.slice(0, after) + '\n' + para + rest.slice(m[0].length - 1);
}

red('a story-first entry with no headline',
  withFirstParagraph('The migration was applied by hand, and the repository was left behind production.'),
  /is not one bold sentence/);
red('an emphasised opening that carries on in the same paragraph',
  withFirstParagraph('**Record every schema change.** The migration was applied by hand.'),
  /is not one bold sentence/);
red('a headline that never closes its bold',
  withFirstParagraph('**Record every schema change as a migration.'),
  /is not one bold sentence/);
red('two bold sentences run together',
  withFirstParagraph('**Record every schema change.** **Never apply SQL by hand.**'),
  /is not one bold sentence/);
red('a heading with nothing under it',
  REAL.replace(HEAD, `## An entry somebody started\n\n${HEAD}`),
  /nothing follows the heading/);
red('a file with no sections',
  '# Working rules\n\nJust an intro.\n',
  /no `## ` sections/);

/* headline() itself, on the shapes that matter. */
const cases = [
  ['**Run the check.**', 'Run the check.'],
  ['**Run `nvm use 22`; on Node 18 it does not run.**', 'Run `nvm use 22`; on Node 18 it does not run.'],
  ['**Run the check.** Then more.', null],
  ['Run the check.', null],
  ['**One.** **Two.**', null],
];
for (const [input, want] of cases) {
  const got = headline(input);
  if (got === want) console.log(`ok    headline(${JSON.stringify(input)})`);
  else { failures += 1; console.error(`FAIL  headline(${JSON.stringify(input)}) → ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`); }
}

/* A Windows checkout: the same file, CRLF. */
{
  const found = problems(REAL.replace(/\n/g, '\r\n'));
  if (found.length) {
    failures += 1;
    console.error(`FAIL  the committed ${FILE}, as a Windows checkout has it (CRLF), does not pass:${found.map((f) => `\n        - ${f}`).join('')}`);
  } else {
    console.log(`ok    the committed ${FILE} passes as CRLF too`);
  }
}

/* The records: every case starts from the real records and breaks one. */
const RECORDS = Object.fromEntries(Object.entries(loadRecords()).map(([f, t]) => [f, t.replace(/\r\n?/g, '\n')]));
const with_ = (extra) => ({ ...RECORDS, ...extra });
const without = (file) => Object.fromEntries(Object.entries(RECORDS).filter(([f]) => f !== file));
const redR = (name, md, records, expected) => {
  const found = problems(md, records);
  if (found.some((p) => expected.test(p))) { console.log(`ok    ${name}`); return; }
  failures += 1;
  console.error(`FAIL  ${name}\n      expected a complaint matching ${expected}`);
  console.error(found.length ? `      got:${found.map((f) => `\n        - ${f}`).join('')}` : '      got: no complaints at all');
};
const green = (name, md, records) => {
  const found = problems(md, records);
  if (!found.length) { console.log(`ok    ${name}`); return; }
  failures += 1;
  console.error(`FAIL  ${name}\n      wanted no complaint, got:${found.map((f) => `\n        - ${f}`).join('')}`);
};

if (slug("Write for a member's understanding, not for the most specific term") !== 'write-for-a-member-s-understanding-not-for-the-most-specific-term') {
  failures += 1; console.error('FAIL  slug() of a heading with an apostrophe and a comma');
} else console.log('ok    slug() of a heading with an apostrophe and a comma');

redR('a heading added with no record file', `${REAL}\n## A rule nobody filed\n\n**Do the thing.**\n`, RECORDS, /"A rule nobody filed" has no record/);
redR('a record file with no heading', REAL, with_({ 'old-rule.md': '# Old rule\n\nIncident. It happened.\n' }), /no rule is named old-rule/);
redR('two headings that slug alike', `${REAL}\n## Append only\n\n**Do the thing.**\n`, RECORDS, /share the slug append-only/);
redR('a bullet renamed without its file', REAL.replace('- **Closing an issue.**', '- **Closing issues.**'), RECORDS, /"Closing issues" has no record/);
redR('a record whose bullet was renamed leaves its old file with no name', REAL.replace('- **Closing an issue.**', '- **Closing issues.**'), RECORDS, /no rule is named closing-an-issue/);
redR('a record paragraph that opens as a condition', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nSo the cockpit never hands over on a Friday.\n` }), /not `Incident\.` or `The owner's words\.`/);
redR('a condition written only in the record, as a backticked token', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nThe owner's words. A secret is never written where \`Freeze:\` marks it.\n` }), /`Freeze:` is not in CLAUDE\.md/);
redR('a number with a unit in the owner\'s words, outside quotation marks', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nThe owner's words. The cap is 2000 cents a day.\n` }), /the number "2000 cents"/);
green('the same figure inside quotation marks', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nThe owner's words. He said "the cap is 2000 cents a day" and moved on.\n` }));
green('the same figure in an incident paragraph', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nIncident. The cap was 2000 cents a day.\n` }));
redR('an operative token moved out of its own rule into another rule\'s record (non-incident)', REAL, with_({ 'append-only.md': `${RECORDS['append-only.md']}\nThe owner's words. A build runs \`tools/build.mjs\` first.\n` }), /`tools\/build\.mjs` is not in CLAUDE\.md under "Append-only"/);
green('a backticked token in an incident paragraph', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nIncident. It was set in \`Freeze:\`.\n` }));
green('a pointer to another record in the owner\'s words', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nThe owner's words. See \`docs/plans/2026-10-17-1446-claude-md-slim.md\`.\n` }));
redR('a path to code in the owner\'s words is not a pointer to a record', REAL, with_({ 'secrets.md': `${RECORDS['secrets.md']}\nThe owner's words. See \`tools/build.mjs\`.\n` }), /`tools\/build\.mjs` is not in CLAUDE\.md/);
green('a token the rule\'s own CLAUDE.md text holds', REAL, with_({ 'two-lists-that-must-agree-are-one-list.md': `${RECORDS['two-lists-that-must-agree-are-one-list.md']}\nThe owner's words. The list is \`STEPS\`.\n` }));
green('records written CRLF', REAL, Object.fromEntries(Object.entries(RECORDS).map(([f, t]) => [f, t.replace(/\n/g, '\r\n')])));
redR('a missing record directory', REAL, {}, /has no record/);
{
  const dropped = without('secrets.md');
  redR('a record deleted', REAL, dropped, /"Secrets" has no record/);
}

/* And the real file passes, with its records. */
const real = problems(REAL, RECORDS);
if (real.length) {
  failures += 1;
  console.error(`FAIL  the committed ${FILE} and its records have ${real.length} problem(s):${real.map((f) => `\n        - ${f}`).join('')}`);
} else {
  console.log(`ok    the committed ${FILE} and its ${Object.keys(RECORDS).length} records pass (${sections(REAL).length} sections)`);
}

if (failures) {
  console.error(`\n${failures} failure(s) in test-working-rules`);
  process.exit(1);
}
console.log('\nall working-rules cases pass');
