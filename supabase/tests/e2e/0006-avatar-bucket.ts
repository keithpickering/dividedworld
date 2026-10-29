/**
 * The avatars bucket as the migrations leave it on an instance holding no original from before
 * 0025 (supabase/migrations/0025_avatars.sql, after 0019_profiles.sql; one holding originals stays
 * private until the sweep removes them, e2e/0007): public by URL, since an avatar file's write time is a clue and not proof
 * (the clues design, sections 1 and 5); listed by nobody, so a file is found only through a name a
 * profile gives or a player shares; WebP alone; and no larger than the avatar function's largest
 * file (supabase/functions/avatar/core.ts), read here from LIMITS rather than restated. Run by
 * tools/test-sql.mjs, on the harness's stand-in for Storage (supabase/tests/setup/auth-shim.sql).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './psql-db.ts';
import { LIMITS } from '../../functions/avatar/core.ts';

test('the avatars bucket is public by URL, listed by nobody, takes WebP alone, and no file larger than the avatar function stores', () => {
  const bucket = JSON.parse(sql(`select coalesce((select to_jsonb(b) from storage.buckets b where id = 'avatars'), 'null')`));
  assert.ok(bucket, 'the migrations make the avatars bucket where Storage is installed');
  assert.equal(bucket.public, true, 'an avatar is served by its URL');
  assert.deepEqual(bucket.allowed_mime_types, ['image/webp']);
  assert.equal(bucket.file_size_limit, Math.max(...Object.values(LIMITS).map((l) => l.bytes)));
  // Listing a bucket is a select on storage.objects: no policy, old or new, lets a reader make one.
  const listing = JSON.parse(sql(`select coalesce(jsonb_agg(policyname), '[]') from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL') and roles && array['public', 'anon', 'authenticated']::name[]`));
  assert.deepEqual(listing, [], 'no policy lets anyone list storage.objects');
});
