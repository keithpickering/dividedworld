/**
 * A character's avatar, as a pure module (the screens' design, section 4): the browser re-encodes
 * one upload as three WebP files (the original, at most 1600 on its long side; a square crop,
 * 256 by 256; a portrait crop, 256 wide and up to twice as tall, or none, when the square fills
 * the tall slot too) and sends them with the frames they were cut at. A portrait is never shorter
 * than it is wide. This reads each file's bytes itself and refuses any that is not a WebP, that
 * carries anything beside its picture, or that is not its size; stores the three under random names
 * through the Storage it is given; and writes them as the character's avatar, as the service, for
 * the player whoami() reads the session as (set_avatar, supabase/migrations/0019_profiles.sql).
 *
 * The bytes are read, not trusted. The browser strips metadata when it re-encodes; this refuses
 * every file that still carries any, by its own reading of the RIFF file of chunks a WebP is:
 * only a picture's own chunks pass (one VP8 or VP8L, an extended header VP8X of exactly its size,
 * and one ALPH, only where the header says alpha and before a lossy picture), each where the
 * format puts it, with zero padding and nothing past the RIFF's own length. EXIF and XMP, where a
 * camera writes a place and a time, are refused by name; a color profile (whose text can name its
 * maker), an animation, the header's flags for any of those, and any chunk this does not know are
 * refused too. A canvas in sRGB, which is what a browser re-encodes into, carries no color
 * profile. What a picture chunk holds past its frame header is not decoded here, so the byte
 * bounds below are what bounds anything a hand-made file could hide inside one; what is stored is
 * exactly what the player's browser made, never stripped by this.
 */
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import type { Storage } from '../_shared/storage.ts';

export type Verdict<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly why: string };
const refuse = (why: string): Verdict<never> => ({ ok: false, why });

/** Each file's size and bytes. A re-encoded WebP at these sizes is far below each bound. */
export const LIMITS = {
  source: { longest: 1600, bytes: 1_500_000 },
  square: { side: 256, bytes: 100_000 },
  portrait: { width: 256, tallest: 512, bytes: 200_000 },
} as const;

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u32 = (b: Uint8Array, at: number) => (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)) + b[at + 3]! * 2 ** 24;
const u24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);

/** The extended header's flags for what an avatar is sent without. */
const FLAGS = { icc: 0x20, exif: 0x08, xmp: 0x04, animation: 0x02 } as const;

/** A WebP's width and height, or why it is refused. */
export function readWebp(bytes: Uint8Array): Verdict<{ width: number; height: number }> {
  if (bytes.length < 20 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return refuse('is not a WebP');
  if (u32(bytes, 4) + 8 !== bytes.length) return refuse('has bytes outside its picture');
  let at = 12;
  let header: { width: number; height: number; alpha: boolean } | null = null;
  let alpha = false;
  let picture: { width: number; height: number } | null = null;
  while (at < bytes.length) {
    if (at + 8 > bytes.length) return refuse('has bytes outside its picture');
    const kind = fourcc(bytes, at);
    const size = u32(bytes, at + 4);
    const data = at + 8;
    const next = data + size + (size % 2);
    if (next > bytes.length) return refuse('is not a WebP');
    if (size % 2 && bytes[data + size] !== 0) return refuse('has bytes outside its picture');
    if (kind === 'EXIF' || kind === 'XMP ') return refuse(`carries metadata (${kind.trim()}), which an avatar is sent without`);
    if (kind === 'VP8X') {
      if (at !== 12 || size !== 10) return refuse('is not a WebP');
      const flags = bytes[data]!;
      if (flags & (FLAGS.exif | FLAGS.xmp)) return refuse(`carries metadata (${flags & FLAGS.exif ? 'EXIF' : 'XMP'}), which an avatar is sent without`);
      if (flags & FLAGS.animation) return refuse('is animated');
      if (flags & FLAGS.icc) return refuse('carries a part an avatar does not need (ICCP)');
      header = { width: u24(bytes, data + 4) + 1, height: u24(bytes, data + 7) + 1, alpha: (flags & 0x10) !== 0 };
    } else if (kind === 'ALPH') {
      if (!header?.alpha || alpha || picture || size === 0) return refuse('is not a WebP');
      alpha = true;
    } else if (kind === 'VP8 ' || kind === 'VP8L') {
      if (picture) return refuse('holds more than one picture');
      if (kind === 'VP8 ') {
        // A key frame (the tag's low bit clear), then its start code.
        if (size < 10 || (bytes[data]! & 1) !== 0 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return refuse('is not a WebP');
        picture = { width: (bytes[data + 6]! | (bytes[data + 7]! << 8)) & 0x3fff, height: (bytes[data + 8]! | (bytes[data + 9]! << 8)) & 0x3fff };
      } else {
        if (size < 5 || bytes[data] !== 0x2f || alpha) return refuse('is not a WebP');
        const bits = u32(bytes, data + 1);
        // Version 0, the only one there is.
        if (Math.floor(bits / 2 ** 29) !== 0) return refuse('is not a WebP');
        picture = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
    } else {
      return refuse(`carries a part an avatar does not need (${kind.trim()})`);
    }
    at = next;
  }
  if (!picture) return refuse('is not a WebP');
  if (header && (header.width !== picture.width || header.height !== picture.height)) return refuse('says two sizes');
  return { ok: true, value: picture };
}

export interface Frame { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface AvatarRequest {
  readonly character: string;
  /** The portrait's frame is null with no portrait. */
  readonly frames: { readonly square: Frame; readonly portrait: Frame | null };
  /** The re-encoded original; null for a recrop of the one already kept. */
  readonly source: Uint8Array | null;
  readonly square: Uint8Array;
  /** Null for an avatar that is a square alone, which fills the tall slot too. */
  readonly portrait: Uint8Array | null;
}

export interface AvatarAnswer { readonly status: number; readonly body: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused = (field: string, error: string): AvatarAnswer => ({ status: 400, body: { field, error } });

/** Whether a file is its size, by its own bytes. */
function check(field: 'source' | 'square' | 'portrait', bytes: Uint8Array): string | null {
  const read = readWebp(bytes);
  if (!read.ok) return read.why;
  const { width, height } = read.value;
  if (field === 'square' && (width !== LIMITS.square.side || height !== LIMITS.square.side)) return 'is 256 by 256';
  if (field === 'portrait' && (width !== LIMITS.portrait.width || height < LIMITS.portrait.width || height > LIMITS.portrait.tallest)) return 'is 256 wide and from 256 to 512 tall';
  if (field === 'source' && Math.max(width, height) > LIMITS.source.longest) return 'is at most 1600 on its long side';
  if (bytes.length > LIMITS[field].bytes) return `is at most ${LIMITS[field].bytes} bytes`;
  return null;
}

/** The hint the SQL functions raise a player's refusal with. */
const REFUSAL_HINT = 'kayfabb.refusal';

export async function runAvatar(dbs: { player: Db; service: Db }, storage: Storage, request: AvatarRequest, newName: () => string = () => `${crypto.randomUUID()}.webp`): Promise<AvatarAnswer> {
  if (typeof request.character !== 'string' || !UUID.test(request.character)) return refused('character', 'is not an id');
  if (!request.frames || typeof request.frames.square !== 'object' || request.frames.square === null || typeof request.frames.portrait !== 'object'
      || (request.frames.portrait === null) !== (request.portrait === null)) return refused('frames', 'are a square and a portrait frame');
  for (const field of ['source', 'square', 'portrait'] as const) {
    const bytes = request[field];
    if (bytes === null && field !== 'square') continue;
    if (!(bytes instanceof Uint8Array)) return refused(field, `the ${field} is a file`);
    const why = check(field, bytes);
    if (why) return refused(field, `the ${field} ${why}`);
  }
  const stored: string[] = [];
  try {
    const who = await dbs.player.rpc<string | null>('whoami', {});
    if (!who) return { status: 401, body: { error: 'sign in to set an avatar' } };
    const names = { source: request.source ? newName() : null, square: newName(), portrait: request.portrait ? newName() : null };
    for (const field of ['source', 'square', 'portrait'] as const) {
      const name = names[field];
      if (name === null) continue;
      await storage.put(name, request[field]!, 'image/webp');
      stored.push(name);
    }
    const written = await dbs.service.rpc<{ profile: unknown; replaced: string[] }>('set_avatar', {
      who, through: request.character, source: names.source, square: names.square, portrait: names.portrait,
      square_frame: request.frames.square, portrait_frame: request.frames.portrait,
    });
    stored.length = 0;
    // What the new avatar replaced is the player's own to lose; a removal that fails leaves a file nobody names, logged.
    await storage.remove(written.replaced ?? []).catch((e) => console.error('avatar: could not remove replaced files', e));
    return { status: 200, body: written.profile };
  } catch (e) {
    // A write whose answer was lost may have committed and now name these files: they are kept,
    // since a file nobody names is harmless and a name with no file is a broken avatar.
    if (e instanceof TransportError) return { status: 503, body: { error: 'no answer came back, so this may have gone through: look before you try again' } };
    await storage.remove(stored).catch((x) => console.error('avatar: could not remove files a failed write stored', x));
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) return { status: e.status >= 400 && e.status < 500 ? e.status : 400, body: { error: e.reason } };
    console.error('avatar failed', e);
    return { status: 500, body: { error: 'the avatar could not be saved; try again' } };
  }
}
