/**
 * Sweep the avatars bucket: remove every file that no profile names and that was written more than
 * an hour ago (supabase/migrations/0025_avatars.sql; the clues design, section 5). An operator's
 * tool, as the export is, run by hand or on a schedule the operator keeps.
 *
 *   KAYFABB_STORAGE_KEY=<service key> node tools/sweep-avatars.mjs --from postgres://… --storage https://<project>
 *
 * Files no row names come from a replaced avatar whose removal failed, a write whose answer was
 * lost, and the originals profiles held before 0025, which that migration listed in
 * avatar_orphans. The bucket is listed, and the names the profiles give are read after the
 * listing. Once no original is left, the bucket, which 0025 kept private while one was there,
 * is made public. A database none of whose avatars is in the bucket, while the bucket holds old files it
 * does not name, is refused then, before anything is removed: it is not the bucket's own database. The originals go first,
 * whatever their age, since no profile can name an original again, and their rows with them;
 * then every listed file no profile names and written more than an hour before the listing: an
 * upload stores its files a moment before its profile is written, and the hour keeps the sweep
 * from ever taking one in between. It says which database and which
 * Storage it reads before it reads them, and never prints the URL's credentials or
 * the service key (instance-files.mjs's scrub). supabase/tests/e2e/0007-avatar-sweep.ts runs it
 * against a scratch database and a stand-in for Storage.
 */
import { BUCKETS, answered, connection, fail, psql, storage, unnamed } from './instance-files.mjs';

/** How many originals are removed, and their rows deleted, at once. */
const CHUNK = 1000;

const usage = 'usage: KAYFABB_STORAGE_KEY=<service key> node tools/sweep-avatars.mjs --from postgres://… --storage https://<project>';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (flag !== '--from' && flag !== '--storage') throw new Error(usage);
    out[flag.slice(2)] = argv[i + 1];
  }
  if (!out.from || !out.storage) throw new Error(usage);
  return out;
}

async function main() {
  const { from, storage: storageUrl } = args(process.argv.slice(2));
  const db = connection(from);
  const store = storage(storageUrl);
  console.log(`sweeping avatars in ${store.named}, named by ${db.named}; the server says it is ${answered(db)}`);
  const avatars = BUCKETS.find((b) => b.bucket === 'avatars');
  const namedNow = () => new Set(JSON.parse(psql(db, `select coalesce(json_agg(k), '[]') from (${avatars.columns.map((c) => `select ${c} as k from ${avatars.table} where ${c} is not null`).join(' union ')}) x`)));

  // The bucket, then the names, read after it: a file listed and named since is named here.
  const listedAt = Date.now();
  const objects = await store.list(avatars.bucket);
  const named = namedNow();
  const stale = unnamed(objects, named, listedAt);
  // A database none of whose avatars is in the bucket, beside old files it does not name, is not
  // this bucket's database (a restore, an empty one, another instance's): nothing is taken on its word.
  const listed = new Set(objects.map((o) => o.name));
  if (stale.length && ![...named].some((k) => listed.has(k))) {
    throw new Error(`none of the avatars ${db.named} names is in ${store.named}'s bucket, which holds ${stale.length} file(s) over an hour old that it does not name: is this the instance's own database? Nothing was removed.`);
  }

  // The originals 0025 listed: no profile names one, so each goes now, whatever its age, and then its row.
  const orphans = JSON.parse(psql(db, `select coalesce(json_agg(key order by key), '[]') from public.avatar_orphans`));
  const gone = orphans.filter((k) => !named.has(k));
  for (let i = 0; i < gone.length; i += CHUNK) {
    const some = gone.slice(i, i + CHUNK);
    await store.remove(avatars.bucket, some);
    psql(db, `delete from public.avatar_orphans where key = any(array[${some.map((k) => `'${k.replace(/'/g, "''")}'`).join(', ')}]::text[]);`);
  }
  console.log(`  originals listed by 0025: ${gone.length} removed`);
  // With no original left in it, the bucket is made public, as 0025 makes one that never held any.
  const opened = psql(db, `update storage.buckets set public = true where id = '${avatars.bucket}' and not public and not exists (select 1 from public.avatar_orphans) returning id;`);
  if (opened) console.log(`  no original is left: the bucket is public`);

  const removed = new Set(gone);
  const rest = stale.filter((k) => !removed.has(k));
  if (rest.length) await store.remove(avatars.bucket, rest);
  console.log(`  files in the bucket: ${objects.length}; named by no profile and written over an hour ago, removed: ${rest.length}`);
}

main().catch(fail);
