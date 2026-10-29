/**
 * The avatars bucket as the migrations leave it (supabase/migrations/0019_profiles.sql): private
 * until #13 is answered, since Storage answers a public file's read with when it was written,
 * which would date each mask's avatar; WebP alone; and no larger than the avatar function's
 * largest file (supabase/functions/avatar/core.ts), read here from LIMITS rather than restated.
 * Run by tools/test-sql.mjs, on the harness's stand-in for Storage (supabase/tests/setup/auth-shim.sql).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from './psql-db.ts';
import { LIMITS } from '../../functions/avatar/core.ts';

test('the avatars bucket is private, takes WebP alone, and no file larger than the avatar function stores', () => {
  const bucket = JSON.parse(sql(`select coalesce((select to_jsonb(b) from storage.buckets b where id = 'avatars'), 'null')`));
  assert.ok(bucket, 'the migrations make the avatars bucket where Storage is installed');
  assert.equal(bucket.public, false, 'no reader fetches an avatar file, or its write time, until #13 is answered');
  assert.deepEqual(bucket.allowed_mime_types, ['image/webp']);
  assert.equal(bucket.file_size_limit, Math.max(...Object.values(LIMITS).map((l) => l.bytes)));
});
