/**
 * Sweep the avatars bucket: remove every file that no profile names and that was written more than
 * an hour ago (supabase/migrations/0025_avatars.sql; the clues design, section 5). An operator's
 * tool, as the export is, run by hand or on a schedule the operator keeps.
 *
 *   KAYFABB_STORAGE_KEY=<service key> node tools/sweep-avatars.mjs --from postgres://… --storage https://<project>
 *
 * Files no row names come from a replaced avatar whose removal failed, a write whose answer was
 * lost, and the originals profiles held before 0025, which that migration listed in
 * avatar_orphans. Those are removed first, whatever their age, since no profile can name an
 * original again, and their rows with them. Then the bucket is listed, the names the profiles
 * give are read after the listing, and every listed file no profile names and written more than
 * an hour before the listing is removed: an upload stores its files a moment before its profile
 * is written, and the hour keeps the sweep from ever taking one in between.
 *
 * It says which database it reads before it reads it, and never prints the URL's credentials or
 * the service key (instance-files.mjs's scrub). supabase/tests/e2e/0007-avatar-sweep.ts runs it
 * against a scratch database and a stand-in for Storage.
 */
import { BUCKETS, answered, connection, fail, psql, storage, unnamed } from './instance-files.mjs';

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
  console.log(`sweeping avatars named by ${db.named}; the server says it is ${answered(db)}`);
  const avatars = BUCKETS.find((b) => b.bucket === 'avatars');
  const namedNow = () => new Set(JSON.parse(psql(db, `select coalesce(json_agg(k), '[]') from (${avatars.columns.map((c) => `select ${c} as k from ${avatars.table} where ${c} is not null`).join(' union ')}) x`)));

  // The originals 0025 listed: no profile names one, so each goes now, and then its row.
  const orphans = JSON.parse(psql(db, `select coalesce(json_agg(key order by key), '[]') from public.avatar_orphans`));
  const kept = namedNow();
  const gone = orphans.filter((k) => !kept.has(k));
  if (gone.length) {
    await store.remove(avatars.bucket, gone);
    psql(db, `delete from public.avatar_orphans where key = any(array[${gone.map((k) => `'${k.replace(/'/g, "''")}'`).join(', ')}]::text[]);`);
  }
  console.log(`  originals listed by 0025: ${gone.length} removed`);

  // The bucket, then the names, read after it: a file listed and named since is named here.
  const listedAt = Date.now();
  const objects = await store.list(avatars.bucket);
  const stale = unnamed(objects, namedNow(), listedAt);
  if (stale.length) await store.remove(avatars.bucket, stale);
  console.log(`  files in the bucket: ${objects.length}; named by no profile and written over an hour ago, removed: ${stale.length}`);
}

main().catch(fail);
