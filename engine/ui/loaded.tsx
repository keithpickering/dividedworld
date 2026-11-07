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
import { NewCharacter } from './characters/NewCharacter.tsx';
import { ProfileEdit } from './profile-edit/ProfileEdit.tsx';
import type { PictureIo } from './profile-edit/crops.ts';
import { SeasonScreen } from './season/Season.tsx';
import { ContactScreen } from './contact/Contact.tsx';
import { SettingsScreen } from './account/Settings.tsx';
import { SignInScreen } from './account/SignIn.tsx';
import { Vending } from './vending/Vending.tsx';
import { GuideScreen } from './guide/Guide.tsx';
import { WelcomeScreen } from './welcome/Welcome.tsx';
import { AlertsScreen } from './alerts/Alerts.tsx';
import { UpdatesScreen } from './updates/Updates.tsx';
import { QueueScreen } from './admin/Queue.tsx';
import { LogScreen } from './log/Log.tsx';
import { SettlementScreen } from './log/Settlement.tsx';
import type { GlassEnv } from './glass-docs.ts';
import { glassRoutes, type GlassScreen, type GlassScreens } from './glass-routes.tsx';
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
 * The glass screens (the glass-load plan, Tasks 11 and 12) are drawn by the router from the document their route loads, so a test or a story that
 * draws one gives it the same route: the app's own table of glass routes (glass-routes.tsx), over the screens imported directly (there is no
 * chunk to wait for) and a router of its own. A refresh after an action (the router's retry of the shown key) is then the real one.
 */
function useGlassEnv(): GlassEnv {
  const { api } = useKayfa();
  return useMemo(() => ({ api, signedIn: async () => (await api.session()).signedIn }), [api]);
}

const direct = <P,>(Component: GlassScreen<P>['Component']): GlassScreen<P> => ({ Component, preload: () => Promise.resolve() });

const SCREENS: GlassScreens = {
  signIn: direct(SignInScreen), characters: direct(Characters), newCharacter: direct(NewCharacter), profileEdit: direct(ProfileEdit),
  settings: direct(SettingsScreen), season: direct(SeasonScreen), vending: direct(Vending), alerts: direct(AlertsScreen), updates: direct(UpdatesScreen),
  guide: direct(GuideScreen), contact: direct(ContactScreen), welcome: direct(WelcomeScreen), queue: direct(QueueScreen), log: direct(LogScreen),
  settlement: direct(SettlementScreen),
};

/** The app's glass routes for `paths`, over a router of its own. `extras` fixes what a test fixes (the picture codec, the clock). */
function Glass({ paths, io, now }: { readonly paths: readonly string[]; readonly io?: PictureIo; readonly now?: number }) {
  const env = useGlassEnv();
  const routes = useMemo<readonly Route[]>(() => glassRoutes(env, SCREENS, { io, now }).filter((r) => paths.includes(r.path)), [env, paths, io, now]);
  return <Routes routes={routes} />;
}

const CHARACTERS = ['/characters', '/characters/edit'];
const SEASON = ['/season'];
const CONTACT = ['/contact'];
const SETTINGS = ['/settings'];
const ALERTS = ['/alerts'];
const UPDATES = ['/updates'];
const QUEUE = ['/admin/queue'];
const LOG = ['/log', '/log/settlement'];

/** My characters at `/characters` and Edit profile at `/characters/edit`, one document: the page opens at the address it is given. */
export function LoadedCharacters({ io }: { readonly io?: PictureIo } = {}) { return <Glass paths={CHARACTERS} io={io} />; }
export function LoadedSeason() { return <Glass paths={SEASON} />; }
export function LoadedContact() { return <Glass paths={CONTACT} />; }
export function LoadedSettings() { return <Glass paths={SETTINGS} />; }
export function LoadedAlerts() { return <Glass paths={ALERTS} />; }
export function LoadedUpdates() { return <Glass paths={UPDATES} />; }
/** The admin queue; `now` fixes the clock the countdowns are read against. */
export function LoadedQueue({ now }: { readonly now?: number } = {}) { return <Glass paths={QUEUE} now={now} />; }
/** My log at `/log` and the settlement summary at `/log/settlement`, one document. */
export function LoadedLog() { return <Glass paths={LOG} />; }
