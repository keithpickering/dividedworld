/**
 * Export an instance: every table, private ones included, one JSON line per row, read in one
 * snapshot so the files agree with each other ("Portable by construction"). An admin's act: it
 * reads who plays every character and every class, so the directory it writes, and every file
 * in it, is readable by its owner alone, as private as the database.
 *
 *   node tools/export-instance.mjs --from postgres://… --to <new directory>
 *
 * It says which database it reads before it reads it, and never prints the URL's credentials.
 * tools/import-instance.mjs reads what it writes; supabase/tests/e2e/0003-export.ts holds the
 * pair to a round trip that comes back the same, table by table.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { FORMAT, NOT_EXPORTED, answered, args, connection, fail, fileOf, psql, tables } from './instance-files.mjs';

const usage = 'usage: node tools/export-instance.mjs --from postgres://… --to <new directory>';

const rowsIn = async (file) => {
  let n = 0;
  for await (const line of readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })) if (line) n++;
  return n;
};

async function main() {
  const { from, to } = args(process.argv.slice(2), usage);
  // psql's \o takes a quoted path, in which a backslash is an escape: refused rather than read two ways.
  if (/[\\\n\r]/.test(path.resolve(to))) throw new Error('the export directory\'s path holds a backslash or a line break; choose another');
  if (fs.existsSync(to) && fs.readdirSync(to).length) throw new Error(`${to} is not empty; an export goes into a new directory`);
  const db = connection(from);
  console.log(`exporting from ${db.named}; the server says it is ${answered(db)}`);
  // Every file this process and psql make is its owner's alone.
  process.umask(0o077);
  fs.mkdirSync(to, { recursive: true, mode: 0o700 });
  fs.chmodSync(to, 0o700);
  const all = tables(db);
  const file = (t) => path.join(path.resolve(to), fileOf(t.name));
  const quoted = (p) => `'${p.replace(/'/g, "''")}'`;
  psql(db, [
    'begin transaction isolation level repeatable read read only;',
    ...all.flatMap((t) => [`\\o ${quoted(file(t))}`, `select to_jsonb(t)::text from ${t.name} t order by ${t.order};`]),
    '\\o',
    'commit;',
  ].join('\n'));
  // The tables were listed before the snapshot; a migration between the two is refused.
  if (JSON.stringify(tables(db)) !== JSON.stringify(all)) throw new Error('the tables changed while they were exported; export again into a new directory');
  const manifest = {
    format: FORMAT,
    exportedAt: new Date().toISOString(),
    from: db.named,
    tables: await Promise.all(all.map(async (t) => ({ name: t.name, file: fileOf(t.name), columns: t.columns, rows: await rowsIn(file(t)) }))),
    notExported: NOT_EXPORTED,
  };
  fs.writeFileSync(path.join(to, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  for (const t of manifest.tables) console.log(`  ${t.name}: ${t.rows} row(s)`);
  console.log(`not exported:\n${NOT_EXPORTED.map((n) => `  - ${n}`).join('\n')}`);
  console.log(`wrote ${path.resolve(to)}`);
}

main().catch(fail);
