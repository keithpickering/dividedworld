/**
 * The five board screens, and the glass screens that read, given the document their route would load, for the places that render a screen without a route: a screen's test and
 * a story (the forum-load plan, Task 13). The app itself never uses these: its routes load (web/src/App.tsx), and the router draws the screen
 * from the document. Each reads what a first load reads (the session, the document, boot), draws nothing until they have landed, and
 * reads the document again when the address names another (a board's page), as a route does; a screen with no such document is "cannot find".
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BootProvider } from './boot.tsx';
import { useKayfa } from './context.tsx';
import type { Boot, BoardPage, IndexPage, ProfilePage, RecordPage, ThreadPage } from './data/api.ts';
import { CannotFind } from './frame/Unavailable.tsx';
import { BoardScreen } from './board/Board.tsx';
import { IndexScreen } from './index/Index.tsx';
import { ProfileScreen } from './profile/Profile.tsx';
import { RecordScreen } from './profile/Record.tsx';
import { effectCards } from './cards/plays.ts';
import { usePlayer } from './player.tsx';
import { addressOf, useLocation } from './router.tsx';
import { boardKey, loadBoard, loadIndex, loadProfile, loadRecord, loadThread, recordKey, threadKey, type LoadEnv, type ScreenDoc } from './screen-docs.ts';
import { ThreadScreen } from './thread/Thread.tsx';
import { Characters } from './characters/Characters.tsx';
import { ProfileEdit } from './profile-edit/ProfileEdit.tsx';
import type { PictureIo } from './profile-edit/crops.ts';
import { SeasonScreen } from './season/Season.tsx';
import { ContactScreen } from './contact/Contact.tsx';
import { SettingsScreen } from './account/Settings.tsx';
import { charactersKey, loadContact, loadMyCharacters, loadSeason, loadSettings, seasonKey, settingsKey, type GlassEnv } from './glass-docs.ts';
import { Routes, type Route } from './routes.tsx';

function Loaded<T>({ keyed, load, children }: { readonly keyed: string; readonly load: (env: LoadEnv) => Promise<ScreenDoc<T> | null>; readonly children: (doc: ScreenDoc<T>) => ReactNode }) {
  const { api, ui, settings } = useKayfa();
  const location = useLocation();
  const player = usePlayer();
  const [held, setHeld] = useState<{ readonly key: string; readonly doc: ScreenDoc<T> | null; readonly boot: Boot | null } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const session = await api.session();
      const env: LoadEnv = { api, signedIn: () => session.signedIn, postsPerPage: () => settings.postsPerPage, effects: [...effectCards(ui)] };
      const [doc, boot] = await Promise.all([load(env), session.signedIn ? api.boot().catch((): Boot | null => null) : Promise.resolve(null)]);
      if (live) setHeld({ key: keyed, doc, boot });
    })().catch(() => { if (live) setHeld({ key: keyed, doc: null, boot: null }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a document is read again for another key, as the router's is
  }, [api, keyed]);
  /* The app draws a page once boot has brought the player's rows with it: here the provider's own read is waited for. */
  if (held === null || held.key !== keyed || !player.sessionKnown || !player.loaded) return <div aria-busy="true" />;
  if (held.doc === null) return <CannotFind address={addressOf(location)} />;
  return <BootProvider boot={held.boot}>{children(held.doc)}</BootProvider>;
}

export function LoadedIndex() {
  return <Loaded<IndexPage> keyed="/" load={(env) => loadIndex(env)}>{(doc) => <IndexScreen doc={doc} />}</Loaded>;
}

export function LoadedBoard({ slug }: { readonly slug: string }) {
  const { query } = useLocation();
  return <Loaded<BoardPage> keyed={boardKey(slug, query)} load={(env) => loadBoard(env, slug, query)}>{(doc) => <BoardScreen slug={slug} doc={doc} />}</Loaded>;
}

export function LoadedThread({ thread }: { readonly thread: string }) {
  const { query, hash } = useLocation();
  return <Loaded<ThreadPage> keyed={threadKey(thread)} load={(env) => loadThread(env, thread, query, hash)}>{(doc) => <ThreadScreen thread={thread} doc={doc} />}</Loaded>;
}

export function LoadedProfile({ id }: { readonly id: string }) {
  return <Loaded<ProfilePage> keyed={`/c/${id}`} load={(env) => loadProfile(env, id)}>{(doc) => <ProfileScreen id={id} doc={doc} />}</Loaded>;
}

export function LoadedRecord({ id }: { readonly id: string }) {
  const { query } = useLocation();
  return <Loaded<RecordPage> keyed={recordKey(id, query)} load={(env) => loadRecord(env, id, query)}>{(doc) => <RecordScreen id={id} doc={doc} />}</Loaded>;
}

/*
 * The glass screens (the glass-load plan, Task 11) are drawn by the router from the document their route loads, so a test or a story that
 * draws one gives it the same route: the app's loaders and keys (glass-docs.ts), over a router of its own, with no chunk to wait for. A
 * refresh after an action (the router's retry of the shown key) is then the real one.
 */
function useGlassEnv(): GlassEnv {
  const { api } = useKayfa();
  return useMemo(() => ({ api, signedIn: async () => (await api.session()).signedIn }), [api]);
}

const noChunk = () => Promise.resolve();

/** My characters at `/characters` and Edit profile at `/characters/edit`, one document: the page opens at the address it is given. */
export function LoadedCharacters({ io }: { readonly io?: PictureIo } = {}) {
  const env = useGlassEnv();
  const routes = useMemo<readonly Route[]>(() => {
    const load = () => loadMyCharacters(env, noChunk);
    return [
      { path: '/characters', load, key: charactersKey, render: (_, doc) => <Characters doc={doc as Parameters<typeof Characters>[0]['doc']} /> },
      { path: '/characters/edit', load, key: charactersKey, render: (_, doc) => <ProfileEdit doc={doc as Parameters<typeof ProfileEdit>[0]['doc']} io={io} /> },
    ];
  }, [env, io]);
  return <Routes routes={routes} />;
}

export function LoadedSeason() {
  const env = useGlassEnv();
  const routes = useMemo<readonly Route[]>(() => [
    { path: '/season', load: ({ query }) => loadSeason(env, query, noChunk), key: (_, query) => seasonKey(query), render: (_, doc) => <SeasonScreen doc={doc as Parameters<typeof SeasonScreen>[0]['doc']} /> },
  ], [env]);
  return <Routes routes={routes} />;
}

export function LoadedContact() {
  const env = useGlassEnv();
  const routes = useMemo<readonly Route[]>(() => [
    { path: '/contact', load: () => loadContact(env, noChunk), key: () => '/contact', render: (_, doc) => <ContactScreen doc={doc as Parameters<typeof ContactScreen>[0]['doc']} /> },
  ], [env]);
  return <Routes routes={routes} />;
}

export function LoadedSettings() {
  const env = useGlassEnv();
  const routes = useMemo<readonly Route[]>(() => [
    { path: '/settings', load: ({ query }) => loadSettings(env, query, noChunk), key: (_, query) => settingsKey(query), render: (_, doc) => <SettingsScreen doc={doc as Parameters<typeof SettingsScreen>[0]['doc']} /> },
  ], [env]);
  return <Routes routes={routes} />;
}
