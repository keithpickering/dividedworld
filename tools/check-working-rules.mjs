/**
 * Guard: every section of CLAUDE.md opens with its rule in one bold paragraph.
 *
 *   node tools/check-working-rules.mjs           fail if a section has no headline
 *   node tools/check-working-rules.mjs --list    print every heading and its rule
 *
 * CLAUDE.md is a log of incidents, and left alone the imperative in each entry arrives
 * after forty lines of what happened. It is read in full at the start of every session,
 * and re-read whenever a rule has to be found, so a rule that lives at the foot of its
 * own story is a rule that gets re-derived from the story each time. The same logic as
 * a document manifest: the headline is what makes the record scannable, and the record
 * stays underneath it.
 *
 * The shape this holds: directly under each `## ` heading, after one blank line, the first
 * paragraph is wholly bold — it starts with `**`, ends with `**` (a closing period inside
 * the bold is fine), and nothing else shares the paragraph. `###` subsections are not held
 * to it; they are parts of one entry, not entries.
 *
 * Why a guard and not the habit: the file grows by one entry per incident, written at the
 * end of a session that has just spent hours on the incident, which is exactly when the
 * story gets written and the sentence does not. Two lists that must agree — the headings
 * and the headlines — are asserted rather than trusted, for the reason the entry of that
 * name gives. `--list` is the scan view: what the file looks like with the stories folded.
 *
 * The incidents and the owner's words do not live here. Each rule's record is
 * `docs/working-rules/<slug>.md`, where the slug is the rule's heading (or a standing
 * permission's bold name) in lowercase with each run of other characters turned into a
 * hyphen. The same check holds the records to the same shape the headlines are:
 *
 *   - a record for every name, no record without a name, no two names with one slug (the
 *     rule "Two lists that must agree are one list");
 *   - every paragraph of a record opens `Incident.` or `The owner's words.`, so a
 *     condition has no paragraph to sit in;
 *   - outside quotation marks, an `The owner's words.` paragraph holds no backticked span
 *     (a path under docs/plans, docs/research or docs/surveys aside: a pointer to another
 *     record) and no number with a unit unless the same token is in that name's CLAUDE.md
 *     text. An `Incident.` paragraph is exempt from both halves: its figures and names
 *     are the incident, and a condition has to be a sentence of its own to be acted on.
 *
 * `problems()` is pure and exported; tools/test-working-rules.mjs drives it red.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FILE = 'CLAUDE.md';
export const RECORD_DIR = 'docs/working-rules';
export const PREAMBLE = 'How a task starts here';
export const PERMISSIONS = 'A standing permission is written down, or it is only remembered';

/**
 * Split markdown into `## ` sections. Returns [{ title, line, paragraph }], where
 * `paragraph` is the first non-blank block after the heading, joined with spaces.
 */
export function sections(md) {
  /* `\r?\n`: a Windows checkout is CRLF (`.gitattributes` says `text=auto`), and this
     file's own test once failed there, unable to find the first heading verbatim, on
     the first Windows build after the guard landed. The trims below would have hidden
     a stray `\r` from the checker; the split is tolerant anyway so no caller has to
     know. */
  const lines = md.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('## ')) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const block = [];
    while (j < lines.length && lines[j].trim() !== '' && !lines[j].startsWith('#')) block.push(lines[j].trim()), j++;
    out.push({ title: lines[i].slice(3).trim(), line: i + 1, paragraph: block.join(' ') });
  }
  return out;
}

/** The rule a section's headline states, or null if the paragraph is not a headline. */
export function headline(paragraph) {
  const m = paragraph.match(/^\*\*(.+)\*\*$/);
  if (!m) return null;
  const inner = m[1];
  // Bold that closes and reopens inside the paragraph (`**One.** **Two.**`) is two
  // sentences run together, not a headline; a paragraph that closes its bold and carries
  // on in plain text already fails the match above, because it ends outside the bold.
  if (inner.includes('**')) return null;
  return inner;
}

/** The record file name a rule's name gives: NFKD, lowercase, each run outside [a-z0-9] a `-`, ends trimmed. */
export function slug(name) {
  return name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Every name that has a record: the preamble's fixed name, each `## ` heading, and each
 * top-level bullet of the standing-permissions section that opens `- **Name.**` or
 * `- **Name**`. `text` is the CLAUDE.md text the name owns (for the token rule): the
 * preamble, a section up to its first bullet, or the bullet.
 */
export function names(md) {
  const lines = md.split(/\r?\n/);
  const heads = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('## ')) heads.push(i);
  const out = [{ name: PREAMBLE, line: 1, text: lines.slice(0, heads[0] ?? lines.length).join('\n') }];
  heads.forEach((start, k) => {
    const end = heads[k + 1] ?? lines.length;
    const name = lines[start].slice(3).trim();
    if (name !== PERMISSIONS) {
      out.push({ name, line: start + 1, text: lines.slice(start + 1, end).join('\n') });
      return;
    }
    const bullets = [];
    for (let i = start + 1; i < end; i++) if (/^- \*\*[^*]+\*\*/.test(lines[i])) bullets.push(i);
    out.push({ name, line: start + 1, text: lines.slice(start + 1, bullets[0] ?? end).join('\n') });
    bullets.forEach((b, n) => {
      const bold = lines[b].match(/^- \*\*([^*]+)\*\*/)[1].replace(/\.$/, '');
      out.push({ name: bold, line: b + 1, text: lines.slice(b, bullets[n + 1] ?? end).join('\n') });
    });
  });
  return out;
}

const OPENERS = ['Incident.', "The owner's words."];
const QUOTED = /"(?:\\.|[^"\\])*"|\u201c[^\u201d]*\u201d/g;
const BACKTICKED = /`[^`]+`/g;
/* A pointer to another record is not a condition: a design, a survey or a research note. */
const RECORD_PATH = /^`docs\/(?:plans|research|surveys)\//;
const NUMBER_UNIT = /\b\d[\d,]*(?:\.\d+)?\s*(?:cents?|tokens?|hours?|days?|bytes?|minutes?)\b|\$\d[\d,]*(?:\.\d+)?/gi;
const squash = (t) => t.replace(/\s+/g, ' ');

/** A record's paragraphs after its `# ` title: [{ line, text }], text joined with spaces. */
export function recordParagraphs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  const title = i < lines.length && lines[i].startsWith('# ') ? lines[i].slice(2).trim() : null;
  if (title !== null) i++;
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const start = i;
    const block = [];
    while (i < lines.length && lines[i].trim() !== '') block.push(lines[i].trim()), i++;
    out.push({ line: start + 1, text: block.join(' ') });
  }
  return { title, paragraphs: out };
}

/** The record checks: the two lists, the grammar, the token rule. `records` is { 'file.md': text }. */
function recordProblems(md, records) {
  const out = [];
  const owners = names(md);
  const bySlug = new Map();
  for (const n of owners) {
    const s = slug(n.name);
    if (bySlug.has(s)) out.push(`"${bySlug.get(s).name}" and "${n.name}" share the slug ${s}: rename one of them`);
    else bySlug.set(s, n);
  }
  const files = Object.keys(records).filter((f) => f.endsWith('.md'));
  for (const [s, n] of bySlug) {
    if (!files.includes(`${s}.md`)) out.push(`"${n.name}" has no record: create ${RECORD_DIR}/${s}.md, or rename its record to match`);
  }
  for (const f of files) {
    const n = bySlug.get(f.slice(0, -3));
    if (!n) { out.push(`${RECORD_DIR}/${f}: no rule is named ${f.slice(0, -3)}: rename the file to its rule's slug, or delete it`); continue; }
    const { title, paragraphs } = recordParagraphs(records[f]);
    if (title === null) out.push(`${RECORD_DIR}/${f}: opens without a \`# \` title`);
    for (const p of paragraphs) {
      const opener = OPENERS.find((o) => p.text.startsWith(o));
      if (!opener) {
        out.push(`${RECORD_DIR}/${f} line ${p.line}: a paragraph opens "${p.text.slice(0, 40)}…", not \`Incident.\` or \`The owner's words.\``);
        continue;
      }
      const bare = p.text.replace(QUOTED, ' ');
      const owned = squash(n.text);
      const ownedLower = owned.toLowerCase();
      if (opener === 'Incident.') continue;
      for (const t of bare.match(BACKTICKED) ?? []) {
        if (RECORD_PATH.test(t)) continue;
        if (!owned.includes(t)) out.push(`${RECORD_DIR}/${f} line ${p.line}: ${t} is not in ${FILE} under "${n.name}": a condition belongs in ${FILE}, the record holds the incident and the words`);
      }
      for (const t of bare.match(NUMBER_UNIT) ?? []) {
        if (!ownedLower.includes(squash(t).toLowerCase())) out.push(`${RECORD_DIR}/${f} line ${p.line}: the number "${t}" is not in ${FILE} under "${n.name}": a condition belongs in ${FILE}, the record holds the incident and the words`);
      }
    }
  }
  return out;
}

/** The records in the record directory, as { 'file.md': text }. A missing directory is no records. */
export function loadRecords(dir = RECORD_DIR) {
  if (!fs.existsSync(dir)) return {};
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.md')) out[f] = fs.readFileSync(`${dir}/${f}`, 'utf8');
  return out;
}

/** Everything wrong, as strings; [] means the file holds its shape. With `records`, the records are held too. */
export function problems(md, records) {
  const out = [];
  const secs = sections(md);
  if (secs.length === 0) out.push(`${FILE} has no \`## \` sections at all`);
  for (const s of secs) {
    if (!s.paragraph) { out.push(`line ${s.line} "${s.title}": nothing follows the heading`); continue; }
    if (headline(s.paragraph) === null) {
      out.push(`line ${s.line} "${s.title}": the first paragraph is not one bold sentence — it opens "${s.paragraph.slice(0, 60)}…"`);
    }
  }
  if (records) out.push(...recordProblems(md, records));
  return out;
}

function main(argv) {
  const md = fs.readFileSync(FILE, 'utf8');
  if (argv.includes('--list')) {
    const rules = new Map(sections(md).map((s) => [s.title, headline(s.paragraph)]));
    for (const n of names(md)) {
      console.log(`${n.name}\n    ${slug(n.name)}.md\n    ${rules.get(n.name) ?? '(no headline)'}\n`);
    }
    return 0;
  }
  const bad = problems(md, loadRecords());
  if (bad.length) {
    console.error(`  working-rules: ${bad.length} problem(s) in ${FILE} and ${RECORD_DIR}/:`);
    for (const b of bad) console.error(`    - ${b}`);
    return 1;
  }
  console.log(`  working-rules: ${sections(md).length} section(s) in ${FILE}, each opening with its rule; ${names(md).length} record(s) in ${RECORD_DIR}/, one per name`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
