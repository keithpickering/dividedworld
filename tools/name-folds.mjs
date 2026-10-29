/**
 * Makes the name folds, the data that says when two characters' names are the same name
 * (the owner's answer 12, on #4): Unicode's confusable prototypes (UTS #39's confusables.txt)
 * and its case folding (CaseFolding.txt, its C and F mappings), from the two files Unicode
 * publishes, into the client's copy and the database's.
 *
 *   node tools/name-folds.mjs --confusables <confusables.txt> --casefolding <CaseFolding.txt>
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

/** confusables.txt: each source code point and the prototype it looks like, and the release. */
export function parseConfusables(text) {
  const version = /^# Version: (\d+\.\d+\.\d+)/m.exec(text)?.[1];
  const date = /^# Date: (\d{4}-\d{2}-\d{2})/m.exec(text)?.[1];
  if (!version || !date) throw new Error('confusables.txt: no "# Version:" or "# Date:" line');
  const map = {};
  for (const line of text.split('\n')) {
    const m = /^([0-9A-F]{4,6}) ;\t([0-9A-F ]+?) ;\tMA\t/.exec(line);
    if (m) map[cp(m[1])] = m[2].split(' ').map(cp).join('');
  }
  return { version, date, map, sha256: sha(text) };
}

/** CaseFolding.txt: its common and full foldings, which together are full case folding. */
export function parseCaseFolding(text) {
  const version = /^# CaseFolding-(\d+\.\d+\.\d+)\.txt/m.exec(text)?.[1];
  if (!version) throw new Error('CaseFolding.txt: no "# CaseFolding-<version>.txt" line');
  const map = {};
  for (const line of text.split('\n')) {
    const m = /^([0-9A-F]{4,6}); ([CF]); ([0-9A-F ]+);/.exec(line);
    if (m) map[cp(m[1])] = m[3].split(' ').map(cp).join('');
  }
  return { version, map, sha256: sha(text) };
}

const byCodePoint = (a, b) => a.codePointAt(0) - b.codePointAt(0);
const entries = (map) => Object.keys(map).sort(byCodePoint).map((k) => [k, map[k]]);

/** The client's copy: a module whose one value is the data, a mapping to a line. */
export function dataModule(confusables, caseFolding) {
  const lines = (map) => entries(map).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return `/**
 * Made by tools/name-folds.mjs from Unicode's confusables.txt (UTS #39, version ${confusables.version}, dated
 * ${confusables.date}) and CaseFolding.txt (version ${caseFolding.version}). Do not edit: run the tool on a release's
 * files. supabase/migrations/0010_name_folds.sql holds the same data, made from this file and held to
 * it by tools/check-name-folds.mjs. Unicode's terms of use: https://www.unicode.org/terms_of_use.html
 */
export interface NameFolds {
  readonly unicode: string;
  readonly confusablesDate: string;
  readonly caseFolding: string;
  readonly confusablesSha256: string;
  readonly caseFoldingSha256: string;
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
  const rows = [...entries(data.fold).map(([k, v]) => ['fold', k, v]), ...entries(data.confusable).map(([k, v]) => ['confusable', k, v])];
  return `-- The name folds: Unicode's case folding and its confusable prototypes (UTS #39), with which
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
  ('case folding', '${data.caseFolding}', '${data.caseFoldingSha256}');

create table name_maps (
  kind text not null check (kind in ('fold', 'confusable')),
  source text not null,
  target text not null,
  primary key (kind, source)
);
insert into name_maps (kind, source, target) values
${rows.map(([kind, k, v]) => `  ('${kind}', ${literal(k)}, ${literal(v)})`).join(',\n')};

alter table unicode_data enable row level security;
alter table name_maps enable row level security;
revoke all on unicode_data, name_maps from anon, authenticated;
`;
}

function main(argv) {
  const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const conf = at('--confusables');
  const fold = at('--casefolding');
  if (!conf || !fold) throw new Error('usage: node tools/name-folds.mjs --confusables <confusables.txt> --casefolding <CaseFolding.txt>');
  const confusables = parseConfusables(fs.readFileSync(conf, 'utf8'));
  const caseFolding = parseCaseFolding(fs.readFileSync(fold, 'utf8'));
  if (confusables.version !== caseFolding.version) throw new Error(`confusables.txt is Unicode ${confusables.version} and CaseFolding.txt ${caseFolding.version}: take one release`);
  const module = dataModule(confusables, caseFolding);
  fs.writeFileSync(DATA, module);
  fs.writeFileSync(MIGRATION, migration(readData(module)));
  console.log(`wrote ${DATA} and ${MIGRATION}: Unicode ${confusables.version}, ${Object.keys(caseFolding.map).length} folds, ${Object.keys(confusables.map).length} confusables`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
