import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, runTrophyArt } from './core.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import type { Storage } from '../_shared/storage.ts';

/* ---- WebP files, built byte by byte (as avatar/core.test.ts builds them) ---- */
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const chunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...u32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
const riff = (chunks: number[][]) => {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body]);
};
const webp = (w: number, h: number, pad = 20) => riff([chunk('VP8L', [0x2f, ...u32((w - 1) | ((h - 1) << 14)), ...Array(pad).fill(0)])]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(40).fill(0)]);

function world(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const stored = new Map<string, number>();
  const player: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push(`${fn}:${JSON.stringify(args)}`);
    const a = answers[fn];
    if (a instanceof Error) throw a;
    return a as T;
  } };
  const storage: Storage = {
    put: async (name, bytes, type) => {
      assert.equal(type, 'image/webp');
      if (answers.putFails) throw new Error('storage: HTTP 500');
      stored.set(name, bytes.length);
    },
    remove: async () => {},
  };
  let n = 0;
  return { dbs: { player }, storage, calls, stored, name: () => `art${++n}.webp` };
}

test('an admin\'s 48 by 48 WebP is stored under a random name, and the name is the answer', async () => {
  const w = world({ is_admin: true });
  assert.deepEqual(await runTrophyArt(w.dbs, w.storage, { file: async () => webp(48, 48) }, w.name), { status: 200, body: { key: 'art1.webp' } });
  assert.deepEqual([...w.stored.keys()], ['art1.webp']);
  assert.equal(w.stored.get('art1.webp'), webp(48, 48).length, 'the file\'s own bytes are stored');
  assert.deepEqual(w.calls, ['is_admin:{}'], 'the caller is asked whether it is an admin, with its own session');
  // Smaller is fine; the sides are each at most 48.
  const small = world({ is_admin: true });
  assert.equal((await runTrophyArt(small.dbs, small.storage, { file: async () => webp(32, 16) }, small.name)).status, 200);
});

test('a player is refused, and nothing is stored or read of the file first', async () => {
  const w = world({ is_admin: false });
  const out = await runTrophyArt(w.dbs, w.storage, { file: async () => webp(48, 48) }, w.name);
  assert.deepEqual(out, { status: 403, body: { error: 'only an admin makes a trophy\'s art' } });
  assert.equal(w.stored.size, 0);
  // The same words for a player whose file is bad: nothing about the file is said to one who may not send it.
  const bad = world({ is_admin: false });
  assert.deepEqual(await runTrophyArt(bad.dbs, bad.storage, { file: async () => png }, bad.name), out);
  // The file is not even fetched for one who may not send it, and a missing or non-file field is plain words for an admin.
  let fetched = 0;
  const never = world({ is_admin: false });
  assert.deepEqual(await runTrophyArt(never.dbs, never.storage, { file: async () => { fetched++; return null; } }, never.name), out);
  assert.equal(fetched, 0);
  const none = world({ is_admin: true });
  assert.deepEqual((await runTrophyArt(none.dbs, none.storage, { file: async () => null }, none.name)).body, { field: 'file', error: 'send a file' });
  // A session the database does not take is nobody.
  const nobody = world({ is_admin: new DatabaseError('is_admin: JWT', 'PGRST301', 401) });
  assert.deepEqual(await runTrophyArt(nobody.dbs, nobody.storage, { file: async () => webp(48, 48) }, nobody.name), { status: 401, body: { error: 'sign in to make trophy art' } });
});

test('a PNG, a 64 by 64 WebP, a file over 16 KB and a file that is no file are refused, and nothing is stored', async () => {
  for (const [file, why] of [
    [png, 'the file is not a WebP'],
    [webp(64, 64), 'the file is at most 48 by 48'],
    [webp(48, 49), 'the file is at most 48 by 48'],
    [webp(48, 48, LIMITS.bytes), `the file is at most ${LIMITS.bytes} bytes`],
    [riff([chunk('VP8L', [0x2f, ...u32(47 | (47 << 14)), ...Array(20).fill(0)]), chunk('EXIF', [1, 2])]), 'the file carries metadata (EXIF), which an avatar is sent without'],
    [riff([chunk('VP8X', [0x02, 0, 0, 0, 47, 0, 0, 47, 0, 0]), chunk('VP8L', [0x2f, ...u32(47 | (47 << 14)), ...Array(20).fill(0)])]), 'the file is animated'],
    [new Uint8Array(LIMITS.bytes + 1), `the file is at most ${LIMITS.bytes} bytes`],
    ['not bytes', 'send a file'],
  ] as const) {
    const w = world({ is_admin: true });
    const out = await runTrophyArt(w.dbs, w.storage, { file: async () => file as Uint8Array }, w.name);
    assert.equal(out.status, 400, why);
    assert.equal((out.body as { field: string }).field, 'file');
    assert.equal((out.body as { error: string }).error, why);
    assert.equal(w.stored.size, 0);
  }
});

test('storage that fails is a 500 that says so; no answer from the database is a 503 that does not guess', async () => {
  const broken = world({ is_admin: true, putFails: true });
  assert.deepEqual(await runTrophyArt(broken.dbs, broken.storage, { file: async () => webp(48, 48) }, broken.name), { status: 500, body: { error: 'the picture could not be saved; try again' } });
  const silent = world({ is_admin: new TransportError('no answer') });
  assert.equal((await runTrophyArt(silent.dbs, silent.storage, { file: async () => webp(48, 48) }, silent.name)).status, 503);
});
