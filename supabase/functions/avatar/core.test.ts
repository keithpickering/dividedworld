import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, readWebp, runAvatar, type AvatarRequest } from './core.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import type { Storage } from '../_shared/storage.ts';

/* ---- WebP files, built byte by byte ---- */
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff];
const chunk = (fourcc: string, data: number[]) => [...ascii(fourcc), ...u32(data.length), ...data, ...(data.length % 2 ? [0] : [])];
/** A lossless bitstream's header: the signature, then 14 bits of width - 1 and 14 of height - 1. */
const vp8l = (w: number, h: number, pad = 20) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return chunk('VP8L', [0x2f, ...u32(bits), ...Array(pad).fill(0)]);
};
/** A lossy bitstream's header: a frame tag, the start code, then 14 bits each of width and height. */
const vp8 = (w: number, h: number, pad = 20) => chunk('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, w & 0xff, (w >> 8) & 0x3f, h & 0xff, (h >> 8) & 0x3f, ...Array(pad).fill(0)]);
const vp8x = (w: number, h: number, flags = 0) => chunk('VP8X', [flags, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]);
const riff = (chunks: number[][], { trailing = [] as number[] } = {}) => {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body, ...trailing]);
};
const webp = (w: number, h: number, pad?: number) => riff([vp8l(w, h, pad)]);

test('a WebP is read for its size, from a lossless, a lossy or an extended file', () => {
  assert.deepEqual(readWebp(webp(256, 256)), { ok: true, value: { width: 256, height: 256 } });
  assert.deepEqual(readWebp(riff([vp8(256, 400)])), { ok: true, value: { width: 256, height: 400 } });
  assert.deepEqual(readWebp(riff([vp8x(256, 256, 0x10), chunk('ALPH', [0, 1, 2]), vp8(256, 256)])), { ok: true, value: { width: 256, height: 256 } });
});

test('a file that is not a WebP, or a WebP carrying anything but its picture, is refused', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(40).fill(0)]);
  assert.deepEqual(readWebp(png), { ok: false, why: 'is not a WebP' });
  assert.deepEqual(readWebp(riff([vp8x(256, 256, 0x08), vp8(256, 256), chunk('EXIF', ascii('Exif\0\0GPS'))])), { ok: false, why: 'carries metadata (EXIF), which an avatar is sent without' });
  assert.deepEqual(readWebp(riff([vp8x(256, 256, 0x04), vp8(256, 256), chunk('XMP ', ascii('<x:xmpmeta/>'))])), { ok: false, why: 'carries metadata (XMP), which an avatar is sent without' });
  // Metadata where the chunk check would not read it: a flag with no chunk, an unknown chunk, a colour profile, bytes after the file.
  assert.match(String((readWebp(riff([vp8x(256, 256, 0x08), vp8(256, 256)])) as { why: string }).why), /metadata/);
  assert.deepEqual(readWebp(riff([vp8(256, 256), chunk('NOTE', ascii('hello'))])), { ok: false, why: 'carries a part an avatar does not need (NOTE)' });
  assert.deepEqual(readWebp(riff([vp8x(256, 256, 0x20), chunk('ICCP', ascii('profile desc')), vp8(256, 256)])), { ok: false, why: 'carries a part an avatar does not need (ICCP)' });
  assert.deepEqual(readWebp(riff([vp8(256, 256)], { trailing: ascii('GPS 51.5N') })), { ok: false, why: 'has bytes outside its picture' });
  assert.deepEqual(readWebp(riff([vp8x(256, 256, 0x02), vp8(256, 256)])), { ok: false, why: 'is animated' });
  assert.deepEqual(readWebp(riff([vp8(256, 256), vp8(256, 256)])), { ok: false, why: 'holds more than one picture' });
  assert.deepEqual(readWebp(riff([vp8x(300, 300), vp8(256, 256)])), { ok: false, why: 'says two sizes' });
  assert.deepEqual(readWebp(riff([chunk('VP8 ', [1, 2])])), { ok: false, why: 'is not a WebP' });
});

/* ---- the function ---- */
const me = '11111111-1111-4111-8111-111111111111';
const character = '22222222-2222-4222-8222-222222222222';
const frames = { square: { x: 0, y: 0, w: 0.5, h: 0.5 }, portrait: { x: 0, y: 0, w: 0.5, h: 1 } };

function world(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const stored = new Map<string, number>();
  const removed: string[] = [];
  const make = (who: string): Db => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push(`${who}:${fn}:${JSON.stringify(args)}`);
    const a = answers[fn];
    if (a instanceof Error) throw a;
    return a as T;
  } });
  const storage: Storage = {
    put: async (name, bytes, type) => { assert.equal(type, 'image/webp'); stored.set(name, bytes.length); },
    remove: async (names) => { removed.push(...names); for (const n of names) stored.delete(n); },
  };
  let n = 0;
  return { dbs: { player: make('player'), service: make('service') }, storage, calls, stored, removed, name: () => `k${++n}.webp` };
}
const request = (over: Partial<AvatarRequest> = {}): AvatarRequest => ({ character, frames, source: webp(1200, 900), square: webp(256, 256), portrait: webp(256, 512), ...over });

test('three checked WebPs are stored under random names and written as the character\'s avatar; the ones they replace are removed', async () => {
  const w = world({ whoami: me, set_avatar: { profile: { character }, replaced: ['old-sq.webp', 'old-pt.webp'] } });
  const out = await runAvatar(w.dbs, w.storage, request(), w.name);
  assert.deepEqual(out, { status: 200, body: { character } });
  assert.deepEqual([...w.stored.keys()], ['k1.webp', 'k2.webp', 'k3.webp']);
  assert.ok(w.calls.includes(`service:set_avatar:${JSON.stringify({ who: me, through: character, source: 'k1.webp', square: 'k2.webp', portrait: 'k3.webp', square_frame: frames.square, portrait_frame: frames.portrait })}`), w.calls.join('\n'));
  assert.deepEqual(w.removed, ['old-sq.webp', 'old-pt.webp']);
});

test('a recrop sends no original: the kept one is cut again', async () => {
  const w = world({ whoami: me, set_avatar: { profile: { character }, replaced: [] } });
  await runAvatar(w.dbs, w.storage, request({ source: null }), w.name);
  assert.ok(w.calls.some((c) => c.includes('"source":null') && c.includes('"square":"k1.webp"')), w.calls.join('\n'));
});

test('each file is held to its size: a square 256 by 256, a portrait 256 wide and at most twice as tall, an original at most 1600 on its long side', async () => {
  for (const [over, field, why] of [
    [{ square: webp(255, 256) }, 'square', 'is 256 by 256'],
    [{ portrait: webp(256, 513) }, 'portrait', 'is 256 wide and from 256 to 512 tall'],
    [{ portrait: webp(256, 200) }, 'portrait', 'is 256 wide and from 256 to 512 tall'],
    [{ source: webp(1601, 900) }, 'source', 'is at most 1600 on its long side'],
    [{ square: webp(256, 256, LIMITS.square.bytes) }, 'square', `is at most ${LIMITS.square.bytes} bytes`],
    [{ square: riff([vp8(256, 256), chunk('EXIF', [1, 2])]) }, 'square', 'carries metadata (EXIF), which an avatar is sent without'],
  ] as const) {
    const w = world({ whoami: me });
    const out = await runAvatar(w.dbs, w.storage, request(over as Partial<AvatarRequest>), w.name);
    assert.deepEqual(out, { status: 400, body: { field, error: `the ${field} ${why}` } }, field);
    assert.equal(w.stored.size, 0, 'nothing stored');
    assert.ok(!w.calls.some((c) => c.includes('set_avatar')));
  }
});

test('a refusal from the database removes what was stored, and is answered in its words; a session with no account is nobody', async () => {
  const w = world({ whoami: me, set_avatar: new DatabaseError('set_avatar: you do not play that character', '42501', 403, 'you do not play that character', 'kayfabb.refusal') });
  const out = await runAvatar(w.dbs, w.storage, request(), w.name);
  assert.deepEqual(out, { status: 403, body: { error: 'you do not play that character' } });
  assert.equal(w.stored.size, 0, 'the stored files are removed');
  const nobody = world({ whoami: null });
  assert.equal((await runAvatar(nobody.dbs, nobody.storage, request(), nobody.name)).status, 401);
  assert.equal(nobody.stored.size, 0);
});

test('a request with no character or no frames is refused before anything is read', async () => {
  const w = world({ whoami: me });
  assert.deepEqual(await runAvatar(w.dbs, w.storage, request({ character: 'x' }), w.name), { status: 400, body: { field: 'character', error: 'is not an id' } });
  assert.deepEqual(await runAvatar(w.dbs, w.storage, request({ frames: { square: frames.square } as AvatarRequest['frames'] }), w.name), { status: 400, body: { field: 'frames', error: 'are a square and a portrait frame' } });
  assert.equal(w.calls.length, 0);
});

test('an avatar with no portrait crop is a square alone, which fills the tall slot', async () => {
  const w = world({ whoami: me, set_avatar: { profile: { character }, replaced: [] } });
  const out = await runAvatar(w.dbs, w.storage, request({ portrait: null, frames: { square: frames.square, portrait: null } }), w.name);
  assert.equal(out.status, 200);
  assert.deepEqual([...w.stored.keys()], ['k1.webp', 'k2.webp']);
  assert.ok(w.calls.some((c) => c.includes('"square":"k2.webp","portrait":null') && c.includes('"portrait_frame":null')), w.calls.join('\n'));
});

test('a write whose answer was lost keeps the files it may now name, and says it may have gone through', async () => {
  const w = world({ whoami: me, set_avatar: new TransportError('set_avatar: no answer') });
  const out = await runAvatar(w.dbs, w.storage, request(), w.name);
  assert.equal(out.status, 503);
  assert.match(String((out.body as { error: string }).error), /may have gone through/);
  assert.equal(w.stored.size, 3, 'no file the profile may name is removed');
});
