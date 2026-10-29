/**
 * Import an instance that tools/export-instance.mjs wrote, into a fresh one: a database the
 * migrations have made and nothing has filled. Every row comes back as it was, ids, sequence
 * numbers and times included, so the imported forum is the same forum
 * ("Portable by construction"; supabase/tests/e2e/0003-export.ts holds the round trip).
 *
 *   node tools/import-instance.mjs --from <export directory> --to postgres://…
 *
 * It says which database it writes before it writes, never prints the URL's credentials, and
 * refuses, naming the table, a database that is not fresh (a table holding any row) or whose
 * tables differ from the export's (another version of the migrations): an import never mixes
 * two forums or guesses at a column.
 *
 * The rows go in one transaction, as a replica writes them (session_replication_role), so the
 * triggers that number an Act, cap a player's characters or check a card's words do not run
 * again over rows they already ran over; the append-only guards fire on updates and deletes,
 * and an import makes neither. Then each identity's next value is set past its rows.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { FORMAT, NOT_EXPORTED, args, named, psql, tables } from './instance-files.mjs';

const usage = 'usage: node tools/import-instance.mjs --from <export directory> --to postgres://…';

/** One line of COPY's text format: a JSON line has no raw tab or newline, only backslashes to double. */
const copyLine = (json) => json.replace(/\\/g, '\\\\');

function check(to, manifest) {
  if (manifest.format !== FORMAT) throw new Error(`the export is ${manifest.format ?? 'not one of ours'}, not ${FORMAT}`);
  const here = new Map(tables(to).map((t) => [t.name, t]));
  const theirs = new Map(manifest.tables.map((t) => [t.name, t]));
  for (const t of manifest.tables) {
    const mine = here.get(t.name);
    if (!mine) throw new Error(`the export has ${t.name}, which this database does not: apply the migrations the export was made with`);
    if (JSON.stringify(mine.columns) !== JSON.stringify(t.columns)) throw new Error(`${t.name}'s columns differ from the export's: apply the migrations the export was made with`);
  }
  for (const name of here.keys()) {
    if (name.startsWith('public.') && !theirs.has(name)) throw new Error(`this database has ${name}, which the export does not: the export is from other migrations`);
  }
  const held = psql(to, manifest.tables.map((t) => `select '${t.name}' where exists (select 1 from ${t.name});`).join('\n'));
  if (held) throw new Error(`the database is not empty (${held.split('\n').join(', ')}); an import goes into a fresh instance`);
}

/** The tables in an order that writes each row after the rows it references. */
function ordered(to, manifest) {
  const edges = psql(to, `
    select format('%I.%I', cn.nspname, c.relname), format('%I.%I', fn.nspname, f.relname)
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace cn on cn.oid = c.relnamespace
      join pg_class f on f.oid = k.confrelid join pg_namespace fn on fn.oid = f.relnamespace
    where k.contype = 'f' and k.conrelid <> k.confrelid`).split('\n').filter(Boolean).map((l) => l.split('|'));
  const names = manifest.tables.map((t) => t.name);
  const after = new Map(names.map((n) => [n, new Set()]));
  for (const [table, references] of edges) if (after.has(table) && after.has(references)) after.get(table).add(references);
  const out = [];
  const seen = new Set();
  const visit = (n, path = new Set()) => {
    if (seen.has(n) || path.has(n)) return;
    path.add(n);
    for (const r of after.get(n)) visit(r, path);
    seen.add(n);
    out.push(n);
  };
  for (const n of names) visit(n);
  return out.map((n) => manifest.tables.find((t) => t.name === n));
}

async function load(to, dir, order) {
  const child = spawn('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', to, '-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.resume();
  const done = new Promise((resolve) => child.on('close', resolve));
  const write = async (text) => { if (!child.stdin.write(text)) await new Promise((r) => child.stdin.once('drain', r)); };
  await write('begin;\nset local session_replication_role = replica;\ncreate temp table import_rows (j jsonb) on commit drop;\n');
  for (const t of order) {
    const columns = t.columns.map(([c]) => c).join(', ');
    await write('truncate import_rows;\ncopy import_rows from stdin;\n');
    const lines = readline.createInterface({ input: fs.createReadStream(path.join(dir, t.file), 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) if (line) await write(copyLine(line) + '\n');
    await write('\\.\n');
    await write(`insert into ${t.name} (${columns}) overriding system value select ${t.columns.map(([c]) => `r.${c}`).join(', ')} from import_rows, jsonb_populate_record(null::${t.name}, import_rows.j) r;\n`);
  }
  // Each identity and serial column's next value past its rows.
  await write(`do $$ declare s record; most bigint; begin
    for s in select format('%I.%I', n.nspname, c.relname) as tbl, a.attname as col, pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) as seq
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'auth') and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        and pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) is not null
    loop
      execute format('select max(%I) from %s', s.col, s.tbl) into most;
      if most is not null then perform setval(s.seq, most, true); end if;
    end loop;
  end $$;\ncommit;\n`);
  child.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(stderr.trim() || `psql exited ${code}`);
}

async function main() {
  const { from, to } = args(process.argv.slice(2), usage);
  const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'));
  console.log(`importing into ${named(to)}, from the export of ${manifest.from} made ${manifest.exportedAt}`);
  check(to, manifest);
  await load(to, from, ordered(to, manifest));
  for (const t of manifest.tables) console.log(`  ${t.name}: ${t.rows} row(s)`);
  console.log(`still to do, since an export does not carry them:\n${NOT_EXPORTED.map((n) => `  - ${n}`).join('\n')}`);
}

main().catch((e) => {
  console.error(String(e.stderr || e.message || e).trim());
  process.exit(1);
});
