/**
 * Import an instance that tools/export-instance.mjs wrote, into a fresh one: a database the
 * migrations have made and nothing has filled. Every row comes back as it was, ids, sequence
 * numbers and times included, so the imported forum is the same forum
 * ("Portable by construction"; supabase/tests/e2e/0003-export.ts holds the round trip).
 *
 *   node tools/import-instance.mjs --from <export directory> --to postgres://… [--storage https://<project>]
 *
 * The files the export carries (every avatar) are put back in Storage under their names, each
 * checked against its hash first, before any row goes in: a file nobody names is harmless, and a
 * row naming a file that is not there is a broken avatar. They need --storage and the new
 * project's service key in KAYFABB_STORAGE_KEY.
 *
 * It says which database it writes before it writes, never prints the URL's credentials, and
 * refuses, naming the table, a database that is not fresh (a table holding any row) or whose
 * tables differ from the export's (another version of the migrations): an import never mixes
 * two forums or guesses at a column.
 *
 * The rows go in one transaction, as a replica writes them (session_replication_role), so the
 * triggers that number an Act, cap a player's characters, check a card's words or check that an
 * unmask names the class its character held do not run again over rows they already ran over; the append-only guards fire on updates and deletes,
 * and an import makes neither. Since a replica checks no foreign key either, the import checks
 * them all itself once every row is in, and a file shorter or longer than the manifest says is
 * refused by name: a lost line never imports quietly. Then each identity's next value is set past
 * its rows, and the settlement's job is scheduled from the imported settings, as the trigger the
 * replica skipped would have scheduled it (supabase/migrations/0004_schedule.sql), and so is the
 * view count's (0018_reading.sql). Any failure rolls all of it back.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { BUCKETS, FORMAT, NOT_EXPORTED, answered, args, connection, fail, fileOf, filesNamed, nameFolds, psql, psqlStream, scrub, sha256, storage, tables } from './instance-files.mjs';

const usage = 'usage: node tools/import-instance.mjs --from <export directory> --to postgres://… [--storage https://<project>]';

/** One line of COPY's text format: a JSON line has no raw tab or newline, only backslashes to double. */
const copyLine = (json) => json.replace(/\\/g, '\\\\');
const literal = (s) => `'${s.replace(/'/g, "''")}'`;

function check(db, manifest) {
  if (manifest.format !== FORMAT) throw new Error(`the export is ${manifest.format ?? 'not one of ours'}, not ${FORMAT}`);
  const here = new Map(tables(db).map((t) => [t.name, t]));
  const theirs = new Map(manifest.tables.map((t) => [t.name, t]));
  for (const t of manifest.tables) {
    if (t.file !== fileOf(t.name)) throw new Error(`the manifest names a file for ${t.name} other than ${fileOf(t.name)}`);
    if (!Number.isSafeInteger(t.rows) || t.rows < 0) throw new Error(`the manifest's row count for ${t.name} is not a count`);
    const mine = here.get(t.name);
    if (!mine) throw new Error(`the export has ${t.name}, which this database does not: apply the migrations the export was made with`);
    if (JSON.stringify(mine.columns) !== JSON.stringify(t.columns)) throw new Error(`${t.name}'s columns differ from the export's: apply the migrations the export was made with`);
  }
  for (const name of here.keys()) {
    if (!theirs.has(name)) throw new Error(`this database has ${name}, which the export does not: the export is from other migrations or another Auth`);
  }
  if (!manifest.nameFolds) throw new Error('the export names no release of the name folds: it was made before they were carried; export it again with these tools');
  if (JSON.stringify(nameFolds(db)) !== JSON.stringify(manifest.nameFolds)) {
    const release = (f) => Object.entries(f ?? {}).map(([what, v]) => `${what} ${v?.version ?? '?'}`).join(', ');
    throw new Error(`the name folds differ: this database holds ${release(nameFolds(db))} and the export was made with ${release(manifest.nameFolds)}, or the same release from other files: apply the migrations the export was made with`);
  }
  const held = psql(db, manifest.tables.map((t) => `select ${literal(t.name)} where exists (select 1 from ${t.name});`).join('\n'));
  if (held) throw new Error(`the database is not empty (${held.split('\n').join(', ')}); an import goes into a fresh instance`);
}

/** Every foreign key out of an imported table, checked once all the rows are in. */
const foreignKeys = (names) => `do $$ declare k record; orphaned boolean; begin
  for k in
    select format('%I.%I', ns.nspname, cl.relname) as child, con.confrelid::regclass::text as parent, con.conname,
      (select string_agg(format('c.%I', a.attname), ', ' order by u.i) from unnest(con.conkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.n) as child_cols,
      (select string_agg(format('p.%I', a.attname), ', ' order by u.i) from unnest(con.confkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = u.n) as parent_cols,
      (select string_agg(format('c.%I is not null', a.attname), ' and ' order by u.i) from unnest(con.conkey) with ordinality u(n, i) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.n) as present
    from pg_constraint con join pg_class cl on cl.oid = con.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where con.contype = 'f' and format('%I.%I', ns.nspname, cl.relname) = any (array[${names.map(literal).join(', ')}]::text[])
      -- A key into a table no export carries (one Auth might add) is Auth's to keep, not ours to judge.
      and (select format('%I.%I', pn.nspname, pc.relname) from pg_class pc join pg_namespace pn on pn.oid = pc.relnamespace where pc.oid = con.confrelid) = any (array[${names.map(literal).join(', ')}]::text[])
  loop
    execute format('select exists (select 1 from %s c where %s and not exists (select 1 from %s p where (%s) = (%s)))', k.child, k.present, k.parent, k.parent_cols, k.child_cols) into orphaned;
    if orphaned then raise exception '% (%) references a row the export does not hold, in %', k.child, k.conname, k.parent; end if;
  end loop;
end $$;\n`;

async function load(db, dir, manifest) {
  const child = psqlStream(db);
  let stderr = '';
  let exited = false;
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.resume();
  // psql stopping on an error closes its input: the write that meets it is dropped, and the
  // error that stopped it is the one reported.
  child.stdin.on('error', () => {});
  const done = new Promise((resolve) => child.on('close', (code) => { exited = true; resolve(code); }));
  const write = async (text) => {
    if (exited) return;
    if (!child.stdin.write(text)) await Promise.race([new Promise((r) => child.stdin.once('drain', r)), done]);
  };
  await write('begin;\nset local session_replication_role = replica;\ncreate temp table import_rows (j jsonb) on commit drop;\n');
  for (const t of manifest.tables) {
    if (exited) break;
    const columns = t.columns.map(([c]) => c).join(', ');
    await write('truncate import_rows;\ncopy import_rows from stdin;\n');
    const lines = readline.createInterface({ input: fs.createReadStream(path.join(dir, t.file), 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
      if (exited) break;
      if (line) await write(copyLine(line) + '\n');
    }
    await write('\\.\n');
    await write(`do $$ declare n bigint := (select count(*) from import_rows); begin
      if n <> ${t.rows} then raise exception '%: the export says % row(s), and its file holds %', ${literal(t.name)}, ${t.rows}, n; end if;
    end $$;\n`);
    await write(`insert into ${t.name} (${columns}) overriding system value select ${t.columns.map(([c]) => `r.${c}`).join(', ')} from import_rows, jsonb_populate_record(null::${t.name}, import_rows.j) r;\n`);
  }
  await write(foreignKeys(manifest.tables.map((t) => t.name)));
  // A restore fires no trigger, so each character's name keys are the ones carried: each is
  // computed again from its name and this database's folds, and one that differs is refused.
  await write(`do $$ declare n bigint; begin
    select count(*) into n from public.characters where name_key is distinct from public.name_skeleton(name) or name_look is distinct from public.name_look(name);
    if n > 0 then raise exception '% character(s) carry a name key that is not their name''s: the export was edited after it was made', n; end if;
  end $$;\n`);
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
  end $$;
  set local session_replication_role = origin;
  select schedule_settlement() where exists (select 1 from settings where key = 'settlementCron');
  select schedule_view_counts() where exists (select 1 from settings where key = 'viewCountCron');
  commit;\n`);
  if (!exited) child.stdin.end();
  const code = await done;
  if (code !== 0) throw new Error(scrub(stderr.trim()) || `psql exited ${code}`);
}

/**
 * The files the export carries, each the one its manifest names and hashes, and together every file
 * its rows name: a file missing, changed, or named by nobody is refused before anything is written.
 */
async function checkFiles(dir, manifest) {
  const files = manifest.files ?? [];
  const carried = new Set(files.map((f) => `${f.bucket}/${f.name}`));
  const named = new Set((await filesNamed(dir)).map((f) => `${f.bucket}/${f.name}`));
  for (const f of named) if (!carried.has(f)) throw new Error(`a row names ${f}, which the export does not carry`);
  for (const f of files) {
    if (!BUCKETS.some((b) => b.bucket === f.bucket) || !named.has(`${f.bucket}/${f.name}`)) throw new Error(`the export carries ${f.bucket}/${f.name}, which no row names`);
    const bytes = fs.readFileSync(path.join(dir, 'files', f.bucket, f.name));
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) throw new Error(`${f.bucket}/${f.name} is not the file the export made`);
  }
  return files;
}

async function main() {
  const { from, to, storage: storageUrl } = args(process.argv.slice(2), usage);
  const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'));
  const db = connection(to);
  console.log(`importing into ${db.named}; the server says it is ${answered(db)}; from the export of ${manifest.from} made ${manifest.exportedAt}`);
  check(db, manifest);
  const files = await checkFiles(from, manifest);
  if (files.length) {
    const store = storage(storageUrl);
    console.log(`putting ${files.length} file(s) into ${store.named}`);
    for (const f of files) await store.put(f.bucket, f.name, fs.readFileSync(path.join(from, 'files', f.bucket, f.name)), BUCKETS.find((b) => b.bucket === f.bucket).contentType);
  }
  await load(db, from, manifest);
  for (const t of manifest.tables) console.log(`  ${t.name}: ${t.rows} row(s), each counted as it went in`);
  console.log(`still to do, since an export does not carry them:\n${NOT_EXPORTED.map((n) => `  - ${n}`).join('\n')}`);
}

main().catch(fail);
