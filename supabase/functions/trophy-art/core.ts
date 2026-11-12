/**
 * A trophy's picture, as a pure module (the cosmetics design; the plan, Task 3): an admin makes a trophy on the admin page and gives it a picture, a small WebP. This
 * checks that the caller is an admin, reads the file's bytes (the same reading an avatar's file gets, _shared/webp.ts: only a picture's own chunks pass, so nothing a
 * camera or an editor wrote rides along), holds it to 48 by 48 pixels and 16 KB, stores it under a random name in the `trophies` bucket through the Storage it is given,
 * and answers the name. The admin then gives that name to make_trophy (supabase/migrations/0206_trophies.sql), which checks the file is there. The bucket is
 * public by URL and listed by nobody, as avatars is, and takes WebP alone at the same size (the migration holds the bucket to LIMITS).
 *
 * Nothing is read of the file (not even the request's body: `request.file` is a function the edge gives, called after the check), or stored, for a caller that is not an admin:
 * is_admin() is asked with the caller's own session, so the database says who they are, and a player is answered the same words whatever they sent.
 */
import { DatabaseError, TransportError, sessionRefused, type Db } from '../_shared/rpc.ts';
import type { Storage } from '../_shared/storage.ts';
import { readWebp } from '../_shared/webp.ts';

/** A trophy's picture: at most this many pixels a side and this many bytes. supabase/migrations/0206_trophies.sql makes the bucket's size limit the same bytes. */
export const LIMITS = { side: 48, bytes: 16 * 1024 } as const;

/** The file is read by `file()` only once the caller is known to be an admin; it answers the bytes, or anything else (nothing, a field that was not a file) for "send a file". */
export interface TrophyArtRequest { readonly file: () => Promise<unknown> }
export interface TrophyArtAnswer { readonly status: number; readonly body: unknown }

const refused = (error: string): TrophyArtAnswer => ({ status: 400, body: { field: 'file', error } });

/** Why a file is not a trophy's picture, in plain words, or null. */
function problem(file: unknown): string | null {
  if (!(file instanceof Uint8Array)) return 'send a file';
  if (file.length > LIMITS.bytes) return `the file is at most ${LIMITS.bytes} bytes`;
  const read = readWebp(file);
  if (!read.ok) return `the file ${read.why}`;
  if (read.value.width > LIMITS.side || read.value.height > LIMITS.side) return `the file is at most ${LIMITS.side} by ${LIMITS.side}`;
  return null;
}

export async function runTrophyArt(dbs: { player: Db }, storage: Storage, request: TrophyArtRequest, newName: () => string = () => `${crypto.randomUUID()}.webp`): Promise<TrophyArtAnswer> {
  try {
    const admin = await dbs.player.rpc<boolean>('is_admin', {}).catch((e) => { if (sessionRefused(e)) return null; throw e; });
    if (admin === null) return { status: 401, body: { error: 'sign in to make trophy art' } };
    if (admin !== true) return { status: 403, body: { error: 'only an admin makes a trophy\'s art' } };
    const file = await request.file();
    const why = problem(file);
    if (why) return refused(why);
    const key = newName();
    await storage.put(key, file as Uint8Array, 'image/webp');
    return { status: 200, body: { key } };
  } catch (e) {
    if (e instanceof TransportError) return { status: 503, body: { error: 'no answer came back, so this may have gone through: look before you try again' } };
    if (e instanceof DatabaseError) { console.error('trophy-art: the database refused', e.code); return { status: 500, body: { error: 'the picture could not be saved; try again' } }; }
    console.error('trophy-art failed', e);
    return { status: 500, body: { error: 'the picture could not be saved; try again' } };
  }
}
