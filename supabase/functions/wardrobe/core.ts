/**
 * What a player does with the cosmetics the service alone may write, as a pure module (the cosmetics design; the plan, Task 6): saving what a character wears
 * (set_outfit, supabase/migrations/0150_gear.sql), choosing which of its trophies its postbit shows (show_trophies, 0151) and rolling a Random Event for it
 * (random_event, 0152). Each is a SQL function that only the service role may call and that takes `who`, the account, as an argument, so none could be called
 * from a browser without being told whose account to act for. This reads that account from the caller's own session (whoami()), as avatar and act do, and calls the
 * function as the service for it; played_by in each function refuses a character the account does not play, in the same words whoever owns it.
 *
 * Nothing is done as the service before whoami() names an account: a session the database does not take is answered 401, in the same words whatever was asked.
 * What each function answers is passed on as it is, so the words of a refusal are the database's.
 */
import { DatabaseError, TransportError, sessionRefused, type Db } from '../_shared/rpc.ts';

export type WardrobeRequest =
  | { readonly action: 'setOutfit'; readonly character: string; readonly pieces: unknown }
  | { readonly action: 'showTrophies'; readonly character: string; readonly awards: unknown }
  | { readonly action: 'randomEvent'; readonly character: string };

export interface WardrobeAnswer { readonly status: number; readonly body: unknown }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSAL_HINT = 'kayfabb.refusal';
const refused = (field: string, error: string): WardrobeAnswer => ({ status: 400, body: { field, error } });

/** The most pieces or awards a request may carry before it is read further: the settings bound each far lower, and the database holds them. */
const MOST_ITEMS = 200;

export async function runWardrobe(dbs: { player: Db; service: Db }, request: WardrobeRequest): Promise<WardrobeAnswer> {
  const r = request as { action?: unknown; character?: unknown; pieces?: unknown; awards?: unknown };
  if (r.action !== 'setOutfit' && r.action !== 'showTrophies' && r.action !== 'randomEvent') return refused('action', 'is not something the wardrobe does');
  if (typeof r.character !== 'string' || !UUID.test(r.character)) return refused('character', 'is not an id');
  if (r.action === 'setOutfit' && (!Array.isArray(r.pieces) || r.pieces.length > MOST_ITEMS)) return refused('pieces', 'an outfit is a list of pieces');
  if (r.action === 'showTrophies' && (!Array.isArray(r.awards) || r.awards.length > MOST_ITEMS || !r.awards.every((a) => typeof a === 'string' && UUID.test(a)))) return refused('awards', 'the awards shown are a list of ids');
  try {
    const who = await dbs.player.rpc<string | null>('whoami', {}).catch((e) => { if (sessionRefused(e)) return null; throw e; });
    if (!who) return { status: 401, body: { error: 'sign in first' } };
    if (r.action === 'setOutfit') return { status: 200, body: await dbs.service.rpc('set_outfit', { who, through: r.character, pieces: r.pieces }) };
    if (r.action === 'showTrophies') return { status: 200, body: await dbs.service.rpc('show_trophies', { who, through: r.character, awards: r.awards }) };
    // A roll that finds nothing answers null; the page needs an object, so the answer carries it under `event`.
    return { status: 200, body: { event: (await dbs.service.rpc<unknown>('random_event', { who, through: r.character })) ?? null } };
  } catch (e) {
    if (e instanceof TransportError) return { status: 503, body: { error: 'no answer came back, so this may have gone through: look before you try again' } };
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) return { status: e.status >= 400 && e.status < 500 ? e.status : 400, body: { error: e.reason } };
    console.error('wardrobe failed', r.action, e instanceof DatabaseError ? e.code : e);
    return { status: 500, body: { error: 'that could not be saved; try again' } };
  }
}
