/**
 * The trophies bucket as the migrations leave it (supabase/migrations/0154_trophies.sql): public by URL, since a trophy's picture is shown on a postbit and proves nothing
 * private; listed by nobody, so a file is found only through a key a trophy gives; WebP alone; and no larger than the trophy-art function stores (supabase/functions/trophy-art/core.ts),
 * read here from LIMITS rather than restated. Run by tools/test-sql.mjs, on the harness's stand-in for Storage (supabase/tests/setup/auth-shim.sql), as 0006 holds avatars.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './psql-db.ts';
import { LIMITS } from '../../functions/trophy-art/core.ts';

test('the trophies bucket is public by URL, listed by nobody, takes WebP alone, and no file larger than the trophy-art function stores', () => {
  const bucket = JSON.parse(sql(`select coalesce((select to_jsonb(b) from storage.buckets b where id = 'trophies'), 'null')`));
  assert.ok(bucket, 'the migrations make the trophies bucket where Storage is installed');
  assert.equal(bucket.public, true, 'a trophy\'s picture is served by its URL');
  assert.deepEqual(bucket.allowed_mime_types, ['image/webp']);
  assert.equal(bucket.file_size_limit, LIMITS.bytes);
  const listing = JSON.parse(sql(`select coalesce(jsonb_agg(policyname), '[]') from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL') and roles && array['public', 'anon', 'authenticated']::name[]`));
  assert.deepEqual(listing, [], 'no policy lets anyone list storage.objects');
});
