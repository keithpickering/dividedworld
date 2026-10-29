/**
 * Makes the name folds, the data that says when two characters' names are the same name
 * (the owner's answer 12, on #4): Unicode's confusable prototypes (UTS #39's confusables.txt),
 * its case folding (CaseFolding.txt, its C and F mappings), and its canonical decompositions and
 * combining classes (UnicodeData.txt), from the files Unicode publishes for one release, into
 * the client's copy and the database's. Decomposing is the data's own, not the platform's: a
 * database's normalize() and a browser's are each a release or more behind, and they differ, so
 * the two copies would key a name differently, and a lookalike the platform does not yet
 * decompose would pass.
 *
 *   node tools/name-folds.mjs --confusables <confusables.txt> --casefolding <CaseFolding.txt> --unicodedata <UnicodeData.txt>
 *
 * It writes engine/rules/name-folds.data.ts, the one list, and from it
 * supabase/migrations/0010_name_folds.sql, which loads the same mappings and records the
 * release. tools/check-name-folds.mjs holds the migration to exactly what migration() below
 * makes of the data module, so the two copies cannot drift. A new Unicode release is taken by
 * running this on its files, in a change of its own: the migration that loads it then needs a
 * successor that reloads name_maps and recomputes every character's key, since 0010 is applied
 * once (see 0011_names.sql).
 *
 * The files are read from paths given, never fetched: nothing here reaches the network at build
 * time ("This repository copies; it never imports").
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const DATA = 'engine/rules/name-folds.data.ts';
export const MIGRATION = 'supabase/migrations/0010_name_folds.sql';
export const PREFIX = 'export const NAME_FOLDS: NameFolds = ';

const cp = (hex) => String.fromCodePoint(parseInt(hex, 16));
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** Every line that is data (not a comment or blank) must be read, or the file is refused: a regex that stopped matching would drop mappings without a word. */
const dataLines = (text) => text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

/** confusables.txt: each source code point and the prototype it looks like, and the release. */
export function parseConfusables(text) {
  const version = /^# Version: (\d+\.\d+\.\d+)/m.exec(text)?.[1];
  const date = /^# Date: (\d{4}-\d{2}-\d{2})/m.exec(text)?.[1];
  if (!version || !date) throw new Error('confusables.txt: no "# Version:" or "# Date:" line');
  const map = {};
  for (const line of dataLines(text)) {
    const m = /^([0-9A-F]{4,6}) ;\t([0-9A-F ]+?) ;\tMA\t/.exec(line);
    if (!m) throw new Error(`confusables.txt: a line that is not a mapping: ${JSON.stringify(line.slice(0, 60))}`);
    map[cp(m[1])] = m[2].split(' ').map(cp).join('');
  }
  return { version, date, map, sha256: sha(text) };
}

/** CaseFolding.txt: its common and full foldings, which together are full case folding; its simple (S) and Turkic (T) lines are not. */
export function parseCaseFolding(text) {
  const version = /^# CaseFolding-(\d+\.\d+\.\d+)\.txt/m.exec(text)?.[1];
  if (!version) throw new Error('CaseFolding.txt: no "# CaseFolding-<version>.txt" line');
  const map = {};
  for (const line of dataLines(text)) {
    const m = /^([0-9A-F]{4,6}); ([CFST]); ([0-9A-F ]+);/.exec(line);
    if (!m) throw new Error(`CaseFolding.txt: a line that is not a folding: ${JSON.stringify(line.slice(0, 60))}`);
    if (m[2] === 'C' || m[2] === 'F') map[cp(m[1])] = m[3].split(' ').map(cp).join('');
  }
  return { version, map, sha256: sha(text) };
}

/**
 * UnicodeData.txt: each code point's full canonical decomposition, taken to its end (a
 * decomposition's own decomposable parts decomposed too), and each combining class that is not
 * 0. Hangul syllables are decomposed by their algorithm (names.ts, 0011_names.sql), not listed.
 * The file names no release, so the one it is read with is the release the others name.
 */
export function parseUnicodeData(text) {
  const one = {};
  const ccc = {};
  for (const line of dataLines(text)) {
    const f = line.split(';');
    if (f.length !== 15 || !/^[0-9A-F]{4,6}$/.test(f[0])) throw new Error(`UnicodeData.txt: a line that is not a code point's: ${JSON.stringify(line.slice(0, 60))}`);
    if (f[3] !== '0') ccc[cp(f[0])] = Number(f[3]);
    if (f[5] && !f[5].startsWith('<')) one[cp(f[0])] = f[5].split(' ').map(cp).join('');
  }
  const full = (c, depth = 0) => {
    if (depth > 20) throw new Error('UnicodeData.txt: a decomposition that never ends');
    return one[c] === undefined ? c : [...one[c]].map((x) => full(x, depth + 1)).join('');
  };
  const decompose = Object.fromEntries(Object.keys(one).map((c) => [c, full(c)]));
  return { decompose, ccc, sha256: sha(text) };
}

const byCodePoint = (a, b) => a.codePointAt(0) - b.codePointAt(0);
const entries = (map) => Object.keys(map).sort(byCodePoint).map((k) => [k, map[k]]);

/** The client's copy: a module whose one value is the data, a mapping to a line. */
export function dataModule(confusables, caseFolding, unicodeData) {
  const lines = (map) => entries(map).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return `/**
 * Made by tools/name-folds.mjs from Unicode's confusables.txt (UTS #39, version ${confusables.version}, dated
 * ${confusables.date}), CaseFolding.txt (version ${caseFolding.version}) and that release's UnicodeData.txt. Do not edit: run the tool on a release's
 * files. supabase/migrations/0010_name_folds.sql holds the same data, made from this file and held to
 * it by tools/check-name-folds.mjs. Unicode's terms of use: https://www.unicode.org/terms_of_use.html
 */
export interface NameFolds {
  readonly unicode: string;
  readonly confusablesDate: string;
  readonly caseFolding: string;
  readonly confusablesSha256: string;
  readonly caseFoldingSha256: string;
  readonly unicodeDataSha256: string;
  /** Each code point and its full canonical decomposition, Hangul syllables aside. */
  readonly decompose: Readonly<Record<string, string>>;
  /** Each code point's canonical combining class, where it is not 0. */
  readonly ccc: Readonly<Record<string, number>>;
  /** Each code point and its full case folding. */
  readonly fold: Readonly<Record<string, string>>;
  /** Each code point and the prototype it looks like. */
  readonly confusable: Readonly<Record<string, string>>;
}

${PREFIX}{
  "unicode": ${JSON.stringify(confusables.version)},
  "confusablesDate": ${JSON.stringify(confusables.date)},
  "caseFolding": ${JSON.stringify(caseFolding.version)},
  "confusablesSha256": ${JSON.stringify(confusables.sha256)},
  "caseFoldingSha256": ${JSON.stringify(caseFolding.sha256)},
  "unicodeDataSha256": ${JSON.stringify(unicodeData.sha256)},
  "decompose": {
${lines(unicodeData.decompose)}
  },
  "ccc": {
${lines(unicodeData.ccc)}
  },
  "fold": {
${lines(caseFolding.map)}
  },
  "confusable": {
${lines(confusables.map)}
  }
};
`;
}

/** The data, read back from the client's module. */
export function readData(text) {
  const at = text.indexOf(PREFIX);
  if (at < 0) throw new Error(`${DATA}: no "${PREFIX.trim()}"`);
  const body = text.slice(at + PREFIX.length).trimEnd();
  if (!body.endsWith(';')) throw new Error(`${DATA}: the data does not end with ";"`);
  return JSON.parse(body.slice(0, -1));
}

/** A string as a Unicode-escaped SQL literal, so no character in the data can be misread. */
const literal = (s) => `U&'${[...s].map((c) => { const n = c.codePointAt(0); return n > 0xffff ? `\\+${n.toString(16).toUpperCase().padStart(6, '0')}` : `\\${n.toString(16).toUpperCase().padStart(4, '0')}`; }).join('')}'`;

/** The database's copy, made from the client's: the release, then every mapping. */
export function migration(data) {
  const rows = [
    ...entries(data.decompose).map(([k, v]) => ['decompose', k, v]),
    ...entries(data.fold).map(([k, v]) => ['fold', k, v]),
    ...entries(data.confusable).map(([k, v]) => ['confusable', k, v]),
  ];
  const classes = entries(data.ccc);
  return `-- The name folds: Unicode's canonical decompositions and combining classes, its case folding
-- and its confusable prototypes (UTS #39), with which
-- 0011_names.sql says when two characters' names are the same name. Made by tools/name-folds.mjs
-- from engine/rules/name-folds.data.ts, the client's copy, and held to it by
-- tools/check-name-folds.mjs; do not edit. Unicode ${data.unicode} (confusables.txt dated ${data.confusablesDate}),
-- CaseFolding ${data.caseFolding}. Unicode's terms of use: https://www.unicode.org/terms_of_use.html

-- Which release of each the database holds, for the client's copy to be compared with.
create table unicode_data (
  what text primary key,
  version text not null,
  source_sha256 text not null
);
insert into unicode_data (what, version, source_sha256) values
  ('confusables', '${data.unicode}', '${data.confusablesSha256}'),
  ('case folding', '${data.caseFolding}', '${data.caseFoldingSha256}'),
  ('unicode data', '${data.unicode}', '${data.unicodeDataSha256}');

create table name_maps (
  kind text not null check (kind in ('decompose', 'fold', 'confusable')),
  source text not null,
  target text not null,
  primary key (kind, source)
);
insert into name_maps (kind, source, target) values
${rows.map(([kind, k, v]) => `  ('${kind}', ${literal(k)}, ${literal(v)})`).join(',\n')};

-- Each code point's canonical combining class, where it is not 0, for decomposing in canonical order.
create table name_classes (
  source text primary key,
  class integer not null check (class between 1 and 254)
);
insert into name_classes (source, class) values
${classes.map(([k, v]) => `  (${literal(k)}, ${v})`).join(',\n')};

alter table unicode_data enable row level security;
alter table name_maps enable row level security;
alter table name_classes enable row level security;
revoke all on unicode_data, name_maps, name_classes from anon, authenticated;
`;
}

function main(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const conf = at('--confusables');
  const fold = at('--casefolding');
  const ucd = at('--unicodedata');
  if (!conf || !fold || !ucd) throw new Error('usage: node tools/name-folds.mjs --confusables <confusables.txt> --casefolding <CaseFolding.txt> --unicodedata <UnicodeData.txt>');
  const confusables = parseConfusables(fs.readFileSync(conf, 'utf8'));
  const caseFolding = parseCaseFolding(fs.readFileSync(fold, 'utf8'));
  const unicodeData = parseUnicodeData(fs.readFileSync(ucd, 'utf8'));
  if (confusables.version !== caseFolding.version) throw new Error(`confusables.txt is Unicode ${confusables.version} and CaseFolding.txt ${caseFolding.version}: take one release`);
  const module = dataModule(confusables, caseFolding, unicodeData);
  fs.writeFileSync(DATA, module);
  fs.writeFileSync(MIGRATION, migration(readData(module)));
  console.log(`wrote ${DATA} and ${MIGRATION}: Unicode ${confusables.version}, ${Object.keys(unicodeData.decompose).length} decompositions, ${Object.keys(unicodeData.ccc).length} combining classes, ${Object.keys(caseFolding.map).length} folds, ${Object.keys(confusables.map).length} confusables`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
