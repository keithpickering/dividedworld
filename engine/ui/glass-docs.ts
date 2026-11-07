/**
 * The loaders of the glass routes that read (the glass-load plan, Task 11; the design, sections 1, 5, 6 and 7), beside the board's
 * (screen-docs.ts): each asks the api for its screen's whole document and awaits the screen's lazy chunk beside it, so a landed route never
 * shows a Suspense fallback. Signed out, a document loader answers the same marker the board's do, with no request, and the screen draws its
 * sign-in line as it did. A glass route with no document (New character, Vending, Guide, Sign-in, Welcome, Settings' other sections) has a
 * loader that is its chunk alone, so its first visit is whole too.
 *
 * Nothing here writes: a loader runs on a hover as well as a press, and a hover is not a visit.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { KayfaApi, Act, AlertsPage, ContactLink, Estimate, Id, LogPage, MyCharactersPage, MyInvite, QueuePage, SeasonPage, UpdatesPage } from './data/api.ts';
import { SIGNED_OUT_DOC, type LoadEnv, type ScreenDoc } from './screen-docs.ts';

/** What a glass loader needs of the app: the api, and whether a player is signed in now. */
export type GlassEnv = Pick<LoadEnv, 'api' | 'signedIn'>;

/** Loads a screen's chunk; the same import the lazy component waits on, so it is fetched once. */
export type Preload = () => Promise<unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a screen of any props: the component keeps its own
export interface LazyScreen<C extends ComponentType<any>> {
  readonly Component: LazyExoticComponent<C>;
  readonly preload: Preload;
}

/**
 * A screen loaded on first use, and the way to load it ahead: `preload` and the component share one import, and an import that failed is
 * tried again by the next preload (a chunk that missed once because the network did is not lost for the session).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
export function lazyScreen<C extends ComponentType<any>>(importer: () => Promise<{ readonly default: C }>): LazyScreen<C> {
  let chunk: Promise<{ readonly default: C }> | null = null;
  const once = () => (chunk ??= importer().catch((error: unknown) => { chunk = null; throw error; }));
  return { Component: lazy(once), preload: () => once() };
}

/** The chunk and the document side by side: the load lands when both have, and fails when either does. */
async function beside<T>(preload: Preload, read: () => Promise<T>): Promise<T> {
  const [, doc] = await Promise.all([preload(), read()]);
  return doc;
}

/** A route with no document: its chunk alone. The router lands any answer but null (which is "can't be found"). */
export async function loadChunk(preload: Preload): Promise<undefined> {
  await preload();
  return undefined;
}

type Query = URLSearchParams;

/** My characters and Edit profile are one document, so a move between them, or to another character, loads nothing. */
export const charactersKey = (): string => '/characters';

export function loadMyCharacters(env: GlassEnv, preload: Preload): Promise<ScreenDoc<MyCharactersPage>> {
  return beside(preload, async () => ((await env.signedIn()) ? env.api.myCharactersPage() : SIGNED_OUT_DOC));
}

/** What `/season`'s address asks: its tab (Rankings unless News), a finished season, the character whose row opens highlighted, and a page. */
export interface SeasonAsked {
  readonly tab: 'rankings' | 'news';
  readonly season: number | null;
  readonly character: Id | null;
  readonly page: number | null;
}

export function seasonAsked(query: Query): SeasonAsked {
  const season = Number.parseInt(query.get('season') ?? '', 10);
  const page = Number.parseInt(query.get('page') ?? '', 10);
  const named = Number.isInteger(season) && season >= 1 ? season : null;
  return {
    tab: query.get('tab') === 'news' ? 'news' : 'rankings',
    season: named,
    /* A character is named for a finished season's row alone. */
    character: named === null ? null : query.get('character'),
    page: Number.isNaN(page) ? null : page,
  };
}

export const seasonKey = (query: Query): string => {
  const a = seasonAsked(query);
  return `${a.tab}|${a.season ?? ''}|${a.character ?? ''}|${a.page ?? ''}`;
};

/** Null is a season that does not exist, which the router shows as the glass's "can't be found". */
export function loadSeason(env: GlassEnv, query: Query, preload: Preload): Promise<ScreenDoc<SeasonPage> | null> {
  const a = seasonAsked(query);
  return beside(preload, async () => ((await env.signedIn()) ? env.api.seasonPage(a.tab, a.season, a.character, a.page) : SIGNED_OUT_DOC));
}

/** Reach a person is readable signed out, and the same for every reader. */
export function loadContact(env: GlassEnv, preload: Preload): Promise<readonly ContactLink[]> {
  return beside(preload, () => env.api.adminContact());
}

export type SettingsSection = 'account' | 'accessibility' | 'notifications';

export const settingsSection = (query: Query): SettingsSection => {
  const asked = query.get('section');
  return asked === 'account' || asked === 'notifications' ? asked : 'accessibility';
};

export const settingsKey = (query: Query): string => settingsSection(query);

/** Settings › Account: the caller's invites, and the address they sign in with (null where it could not be read: the row says so, and the section still opens). */
export interface AccountDoc {
  readonly invites: readonly MyInvite[];
  readonly address: string | null;
}

/** Account reads the invites and the sign-in address, both the caller's own; the other sections read nothing beyond boot, so they are their chunk alone. */
export function loadSettings(env: GlassEnv, query: Query, preload: Preload): Promise<ScreenDoc<AccountDoc> | undefined> {
  if (settingsSection(query) !== 'account') return loadChunk(preload);
  return beside(preload, async () => {
    if (!(await env.signedIn())) return SIGNED_OUT_DOC;
    const [invites, address] = await Promise.all([env.api.invites(), env.api.signInAddress().catch((): string | null => null)]);
    return { invites, address };
  });
}


/** The Alerts page: the newest rows and what their words need. Opening it writes nothing here: the mark moves once the page has landed (`seeAlerts`). */
export const alertsKey = (): string => '/alerts';

export function loadAlerts(env: GlassEnv, preload: Preload): Promise<ScreenDoc<AlertsPage>> {
  return beside(preload, async () => ((await env.signedIn()) ? env.api.alertsPage(null) : SIGNED_OUT_DOC));
}

/** What `/updates`'s address asks: the open update, whether the handover writer is asked for, and its season (only with the writer). */
export interface UpdatesAsked {
  readonly update: Id | null;
  readonly write: string | null;
  readonly season: number | null;
}

export function updatesAsked(query: Query): UpdatesAsked {
  const write = query.get('write');
  const season = Number(query.get('season'));
  return { update: query.get('update'), write, season: write === 'handover' && Number.isInteger(season) && season > 0 ? season : null };
}

export const updatesKey = (query: Query): string => {
  const a = updatesAsked(query);
  return `${a.update ?? ''}|${a.write ?? ''}|${a.season ?? ''}`;
};

export function loadUpdates(env: GlassEnv, query: Query, preload: Preload): Promise<ScreenDoc<UpdatesPage>> {
  const a = updatesAsked(query);
  return beside(preload, async () => ((await env.signedIn()) ? env.api.updatesPage(a.update, null, a.season) : SIGNED_OUT_DOC));
}

/** What the queue's loader answers a caller who is not an admin: the address exists, so the screen says the queue is for admins (not "can't be found"). */
export const NOT_ADMIN_DOC = Object.freeze({ notAdmin: true as const });
export type NotAdminDoc = typeof NOT_ADMIN_DOC;
export const isNotAdminDoc = (doc: unknown): doc is NotAdminDoc => typeof doc === 'object' && doc !== null && (doc as { notAdmin?: unknown }).notAdmin === true;

export const queueKey = (): string => '/admin/queue';

/** The queue's page and the boards with the descriptions they have now. */
export type QueuePageDoc = QueuePage & { readonly boards: Awaited<ReturnType<KayfaApi['boards']>> };

/** Signed out, or signed in and not an admin: the screen draws "The admin queue is for admins." */
export function loadQueue(env: GlassEnv, preload: Preload): Promise<QueuePageDoc | NotAdminDoc | typeof SIGNED_OUT_DOC> {
  return beside(preload, async () => {
    if (!(await env.signedIn())) return SIGNED_OUT_DOC;
    /* The boards are read beside the page (boot's are as the page loaded, and a description saved since would show stale). */
    const [page, boards] = await Promise.all([env.api.queuePage(), env.api.boards()]);
    return page === null ? NOT_ADMIN_DOC : { ...page, boards };
  });
}

/** How long the log's estimate is waited for beside its page before the page draws without it (boot's first load waits the same). */
export const ESTIMATE_WAIT_MS = 600;

/** The log's document: its page, and the live estimate if it landed in time (else `estimateLater`, which settles when it does). */
export interface LogDoc {
  readonly page: LogPage;
  readonly estimate: Estimate | null;
  /** The Acts the estimate's lines name that the page did not (`log_page` does not know the estimate), read with it. */
  readonly estimateActs?: readonly Act[];
  readonly estimateLater?: Promise<Estimate | null>;
}

/** The Acts an estimate's lines name beyond those held. */
export const estimateActIds = (estimate: Estimate, held: ReadonlySet<Id>): Id[] => [...new Set(estimate.lines.flatMap((l) => (l.act && !held.has(l.act) ? [l.act] : [])))];

/** My log and the settlement summary are one document, so a move between them loads nothing. */
export const logKey = (): string => '/log';

export function loadLog(env: GlassEnv, preload: Preload): Promise<ScreenDoc<LogDoc>> {
  return beside(preload, async () => {
    if (!(await env.signedIn())) return SIGNED_OUT_DOC;
    /* The estimate is read beside the page, and only waited for a little: it fills in when it lands. Its Acts (which the page was not asked about)
       are read with it and inside the same bound, so the first frame has their words and a hung read cannot hold the page; a read that fails leaves those lines in plain words. */
    const paged = env.api.logPage(null);
    const withActs = Promise.resolve(env.api.estimate()).then(
      async (estimate): Promise<{ readonly estimate: Estimate; readonly acts: readonly Act[] } | null> => {
        const want = estimateActIds(estimate, new Set((await paged).acts.map((a) => a.id)));
        return { estimate, acts: want.length === 0 ? [] : await env.api.actsById(want).catch((): readonly Act[] => []) };
      },
      () => null,
    ).catch(() => null);
    const page = await paged;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = await Promise.race([withActs, new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), ESTIMATE_WAIT_MS); })]);
    clearTimeout(timer);
    if (waited === 'late') return { page, estimate: null, estimateLater: withActs.then((r) => r?.estimate ?? null) };
    if (waited === null) return { page, estimate: null };
    return { page, estimate: waited.estimate, estimateActs: waited.acts };
  });
}
