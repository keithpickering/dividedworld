/**
 * The loaders of the five board-world routes (the forum-load plan, Task 13; the design, sections 1, 2 and 9): each asks its screen function
 * for the screen's whole document, or, signed out, answers a marker with no request, which the screen draws as the front door (or the
 * sign-in line) as it did before. The composition root puts them in its routes; the screens' tests and stories use them to make the
 * document a route would have loaded.
 *
 * A route's key names the part of its address that names its document: a move that keeps it (a thread's `#post-142` on a page already
 * shown) is the screen's own, as before.
 */
import { failureKind } from './data/api.ts';
import type { BoardPage, IndexPage, KayfaApi, PostHit, ProfilePage, RecordPage, SearchPage, ThreadHit, ThreadPage } from './data/api.ts';
import { recordKind, type RecordKind } from './profile/record.ts';
import { seqOfHash } from './thread/pages.ts';
import { isSearching, parseSearch, searchParams, type SearchAsk } from './search/query.ts';

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

/** The `/search` document: what the address asks, the name of the character it filters to, and the page found (none before a search is asked). */
export interface SearchDoc {
  readonly ask: SearchAsk;
  /** The public name of the `author` filter, null where there is none or it names no one the player may see. */
  readonly authorName: string | null;
  readonly posts: SearchPage<PostHit> | null;
  readonly threads: SearchPage<ThreadHit> | null;
  /** The server refused the search (a date or a word it cannot read); the screen says so and the form stays. */
  readonly refused: boolean;
  /** The search never reached the server (offline, or a server error); the screen says so, and the form stays. */
  readonly unreached: boolean;
}

/** The address as a search reads it: unknown values are already their defaults, so two addresses that ask the same share a document. */
export const searchKey = (query: Query): string => String(searchParams(parseSearch(query)));

/**
 * Whether a failed search failed to reach the server rather than being refused by it. The supabase adapter's read throws one fixed sentence
 * ("... could not be read right now; try again") for any error it could not tell apart, and a fetch that never answered is a TypeError; the
 * browser also says when it is offline. Anything else is the server's (or the fake's) own refusal of an argument.
 */
function reachFailure(e: unknown): boolean {
  const kind = failureKind(e);
  return kind === 'offline' || kind === 'silent';
}

export async function loadSearch(env: LoadEnv, query: Query): Promise<ScreenDoc<SearchDoc>> {
  if (!(await env.signedIn())) return SIGNED_OUT_DOC;
  const ask = parseSearch(query);
  const author = ask.query.author;
  const named = author === null ? Promise.resolve([]) : env.api.characters([author]).catch(() => []);
  const none = { posts: null, threads: null, refused: false, unreached: false };
  const found = !isSearching(ask.query)
    ? Promise.resolve(none)
    : (ask.view === 'threads' ? env.api.searchThreads(ask.query, ask.after).then((threads) => ({ ...none, threads })) : env.api.searchPosts(ask.query, ask.after).then((posts) => ({ ...none, posts })))
        .catch((e: unknown) => (reachFailure(e) ? { ...none, unreached: true } : { ...none, refused: true }));
  const [who, result] = await Promise.all([named, found]);
  return { ask, authorName: who[0]?.name ?? null, ...result };
}
