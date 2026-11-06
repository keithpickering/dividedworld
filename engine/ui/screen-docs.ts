/**
 * The loaders of the five board-world routes (the forum-load plan, Task 13; the design, sections 1, 2 and 9): each asks its screen function
 * for the screen's whole document, or, signed out, answers a marker with no request, which the screen draws as the front door (or the
 * sign-in line) as it did before. The composition root puts them in its routes; the screens' tests and stories use them to make the
 * document a route would have loaded.
 *
 * A route's key names the part of its address that names its document: a move that keeps it (a thread's `#post-142` on a page already
 * shown) is the screen's own, as before.
 */
import type { BoardPage, IndexPage, KayfaApi, ProfilePage, RecordPage, ThreadPage } from './data/api.ts';
import { recordKind, type RecordKind } from './profile/record.ts';
import { seqOfHash } from './thread/pages.ts';

/** What a loader answers signed out: no request was made, and the screen draws the front door or the sign-in line. */
export const SIGNED_OUT_DOC = Object.freeze({ signedOut: true as const });
export type SignedOutDoc = typeof SIGNED_OUT_DOC;
export type ScreenDoc<T> = T | SignedOutDoc;

export const isSignedOutDoc = (doc: unknown): doc is SignedOutDoc => typeof doc === 'object' && doc !== null && (doc as { signedOut?: unknown }).signedOut === true;

/** What a loader needs to know of the app, asked when it runs (the session may not be read yet, nor the settings). */
export interface LoadEnv {
  readonly api: KayfaApi;
  /** Whether a player is signed in now: at once once the session is known, else when it is. */
  readonly signedIn: () => boolean | Promise<boolean>;
  /** The instance's posts per page when the first load has read it; null until then, and the server then uses its own. */
  readonly postsPerPage: () => number | null;
  /** The keys of the cards the instance draws an effect for (`effectCards(ui)`). */
  readonly effects: readonly string[];
}

type Query = URLSearchParams;

/** The page a `?page=` asks for: a whole number from 1, else the first. */
export const boardPageAsked = (query: Query): number => {
  const asked = Number.parseInt(query.get('page') ?? '1', 10);
  return Number.isFinite(asked) && asked > 0 ? asked : 1;
};

/** A page number past any real record is read as this one: an offset the server answers plainly. */
const MAX_PAGE = 10_000;
export const recordPageAsked = (query: Query): number => Math.min(MAX_PAGE, Math.max(1, Number.parseInt(query.get('page') ?? '', 10) || 1));

export const boardKey = (slug: string, query: Query): string => `${slug}?page=${boardPageAsked(query)}`;
export const threadKey = (thread: string): string => thread;
export const recordKey = (id: string, query: Query): string => `${id}|${recordKind(query.get('kind'))}|${recordPageAsked(query)}`;

export async function loadIndex(env: LoadEnv): Promise<ScreenDoc<IndexPage>> {
  return (await env.signedIn()) ? env.api.indexPage() : SIGNED_OUT_DOC;
}

export async function loadBoard(env: LoadEnv, slug: string, query: Query): Promise<ScreenDoc<BoardPage> | null> {
  return (await env.signedIn()) ? env.api.boardPage(slug, boardPageAsked(query), env.effects) : SIGNED_OUT_DOC;
}

/** The page and the post an address asks for: `?page=N` and `#post-M` (the post wins). */
export const threadAsked = (query: Query, hash: string): { readonly page: number | null; readonly seq: number | null } => ({
  page: Number.parseInt(query.get('page') ?? '', 10) || null,
  seq: seqOfHash(hash),
});

export async function loadThread(env: LoadEnv, thread: string, query: Query, hash: string): Promise<ScreenDoc<ThreadPage> | null> {
  return (await env.signedIn()) ? env.api.threadPage(thread, threadAsked(query, hash), env.postsPerPage(), env.effects) : SIGNED_OUT_DOC;
}

export async function loadProfile(env: LoadEnv, id: string): Promise<ScreenDoc<ProfilePage> | null> {
  return (await env.signedIn()) ? env.api.profilePage(id) : SIGNED_OUT_DOC;
}

export async function loadRecord(env: LoadEnv, id: string, query: Query): Promise<ScreenDoc<RecordPage> | null> {
  const kind: RecordKind = recordKind(query.get('kind'));
  return (await env.signedIn()) ? env.api.recordPage(id, kind, recordPageAsked(query)) : SIGNED_OUT_DOC;
}
