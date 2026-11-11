/**
 * A character's avatar, as a pure module (the screens' design, section 4; the clues design,
 * section 5): two crops, both public, and nothing else. The browser cuts a portrait from the
 * player's own picture (256 to 512 wide, and 1 to 2 times as tall as it is wide, stored larger than
 * the postbit draws it so a square that zooms into it stays sharp) and a square from inside the
 * portrait (256 by 256, a small file of its own so lists load no portraits), re-encodes each as a
 * WebP, and sends them with the frames they were cut at: the portrait's in the player's picture,
 * the square's in the portrait. A recrop sends a new square and its frame alone, cut in the browser
 * from the public portrait, and the portrait is kept. The original is never sent, and a request
 * carrying one is refused: what a player cropped away is stored nowhere. This reads each file's
 * bytes itself and refuses any that is not a WebP, that carries anything beside its picture, or
 * that is not its size; stores them under random names through the Storage it is given; and
 * writes them as the character's avatar, as the service, for the player whoami() reads the session
 * as (set_avatar, supabase/migrations/0025_avatars.sql).
 *
 * The bytes are read, not trusted. The browser strips metadata when it re-encodes; this refuses
 * every file that still carries any, by its own reading of the RIFF file of chunks a WebP is:
 * only a picture's own chunks pass (one VP8 or VP8L, an extended header VP8X of exactly its size,
 * and one ALPH, only where the header says alpha and before a lossy picture), each where the
 * format puts it, with zero padding and nothing past the RIFF's own length. EXIF and XMP, where a
 * camera writes a place and a time, are refused by name; a color profile (whose text can name its
 * maker), an animation, the header's flags for any of those, and any chunk this does not know are
 * refused too. Chromium's canvas does write an sRGB ICCP chunk into the WebP it encodes; the
 * screens drop that chunk and its header flag before sending (engine/ui/profile-edit/webp.ts),
 * which changes no pixel, since an untagged picture is read as sRGB. What a picture chunk holds past its frame header is not decoded here, so the byte
 * bounds below are what bounds anything a hand-made file could hide inside one; what is stored is
 * exactly what the player's browser made, never stripped by this.
 */
import { DatabaseError, TransportError, sessionRefused, type Db } from '../_shared/rpc.ts';
import type { Storage } from '../_shared/storage.ts';
import { readWebp, type Verdict } from '../_shared/webp.ts';

// The reading of a WebP lives in _shared/webp.ts, which trophy-art uses too; it is re-exported here, where it was.
export { readWebp };

export type { Verdict };

/** Each file's size and bytes. A re-encoded WebP at these sizes is far below each bound. */
export const LIMITS = {
  square: { side: 256, bytes: 100_000 },
  /** From 256 to 512 wide, and from 1 to 2 times as tall as it is wide. */
  portrait: { width: [256, 512], ratio: [1, 2], bytes: 400_000 },
} as const;

export interface Frame { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface AvatarRequest {
  readonly character: string;
  /** The square's in the portrait; the portrait's in the player's own picture, null for a recrop. */
  readonly frames: { readonly square: Frame; readonly portrait: Frame | null };
  readonly square: Uint8Array;
  /** Null for a recrop, which keeps the stored portrait. */
  readonly portrait: Uint8Array | null;
  /** Never sent: a request carrying an original is refused. */
  readonly source?: unknown;
}

export interface AvatarAnswer { readonly status: number; readonly body: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refused = (field: string, error: string): AvatarAnswer => ({ status: 400, body: { field, error } });

/** Whether a file is its size, by its own bytes. */
function check(field: 'square' | 'portrait', bytes: Uint8Array): string | null {
  const read = readWebp(bytes);
  if (!read.ok) return read.why;
  const { width, height } = read.value;
  if (field === 'square' && (width !== LIMITS.square.side || height !== LIMITS.square.side)) return 'is 256 by 256';
  const { width: [narrowest, widest], ratio: [least, most] } = LIMITS.portrait;
  if (field === 'portrait' && (width < narrowest || width > widest || height < least * width || height > most * width)) return 'is from 256 to 512 wide, and from 1 to 2 times as tall as it is wide';
  if (bytes.length > LIMITS[field].bytes) return `is at most ${LIMITS[field].bytes} bytes`;
  return null;
}

/** A frame inside its picture, in fractions of its width and height, as set_avatar's frame_holds reads it. */
const inside = (f: unknown): boolean => {
  if (typeof f !== 'object' || f === null || Object.keys(f).length !== 4) return false;
  const { x, y, w, h } = f as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const [fx, fy, fw, fh] = [x, y, w, h] as number[];
  return fx! >= 0 && fy! >= 0 && fw! > 0 && fh! > 0 && fx! + fw! <= 1 && fy! + fh! <= 1;
};

/** The hint the SQL functions raise a player's refusal with. */
const REFUSAL_HINT = 'kayfabb.refusal';

export async function runAvatar(dbs: { player: Db; service: Db }, storage: Storage, request: AvatarRequest, newName: () => string = () => `${crypto.randomUUID()}.webp`): Promise<AvatarAnswer> {
  if (typeof request.character !== 'string' || !UUID.test(request.character)) return refused('character', 'is not an id');
  if (request.source !== undefined && request.source !== null) return refused('source', 'an avatar is two crops; the original stays with you');
  if (!request.frames || typeof request.frames.square !== 'object' || request.frames.square === null || typeof request.frames.portrait !== 'object'
      || (request.frames.portrait === null) !== (request.portrait === null)) return refused('frames', 'are a square and a portrait frame');
  if (!inside(request.frames.square)) return refused('frames', 'the square is cut from inside the portrait');
  if (request.frames.portrait !== null && !inside(request.frames.portrait)) return refused('frames', 'the portrait is cut from inside your picture');
  for (const field of ['square', 'portrait'] as const) {
    const bytes = request[field];
    if (bytes === null && field === 'portrait') continue;
    if (!(bytes instanceof Uint8Array)) return refused(field, `the ${field} is a file`);
    const why = check(field, bytes);
    if (why) return refused(field, `the ${field} ${why}`);
  }
  // How tall the portrait is as a multiple of its width, from its own bytes (set_avatar, 0162); a recrop sends no portrait and keeps the stored one.
  let tallness: number | null = null;
  if (request.portrait) {
    const read = readWebp(request.portrait);
    if (read.ok) tallness = read.value.height / read.value.width;
  }
  const stored: string[] = [];
  try {
    const who = await dbs.player.rpc<string | null>('whoami', {}).catch((e) => { if (sessionRefused(e)) return null; throw e; });
    if (!who) return { status: 401, body: { error: 'sign in to set an avatar' } };
    const names = { square: newName(), portrait: request.portrait ? newName() : null };
    for (const field of ['square', 'portrait'] as const) {
      const name = names[field];
      if (name === null) continue;
      await storage.put(name, request[field]!, 'image/webp');
      stored.push(name);
    }
    const written = await dbs.service.rpc<{ profile: unknown; replaced: string[] }>('set_avatar', {
      who, through: request.character, square: names.square, portrait: names.portrait,
      square_frame: request.frames.square, portrait_frame: request.frames.portrait, portrait_tallness: tallness,
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
