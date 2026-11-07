/**
 * The app: the backend, the instance, its look and words, and the screens, put together. This and
 * web/src/data/ are the only places the engine's screens and an instance meet.
 */
import { AnimatePresence, useIsPresent } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BoardPage, Boot, Estimate, IndexPage, KayfaApi, ProfilePage, RecordPage, ScreenSettings, Session, ThreadPage } from '../../engine/ui/data/api.ts';
import { fallbackSettings } from './data/settings.ts';
import { BootProvider } from '../../engine/ui/boot.tsx';
import { CannotDisplay } from '../../engine/ui/frame/Unavailable.tsx';
import { applyAppearance } from '../../engine/ui/appearance.ts';
import { setTiltPreference } from '../../engine/ui/shine/tilt.ts';
import { KayfaProvider } from '../../engine/ui/context.tsx';
import { BoardScreen } from '../../engine/ui/board/Board.tsx';
import { AccountGate } from '../../engine/ui/account/OpenAccount.tsx';
import { ProfileScreen } from '../../engine/ui/profile/Profile.tsx';
import { RecordScreen } from '../../engine/ui/profile/Record.tsx';
import { Frame } from '../../engine/ui/frame/Frame.tsx';
import { keepBoardPlace } from '../../engine/ui/glass/back.ts';
import { Leaving, useRest } from '../../engine/ui/glass/Held.tsx';
import { crossingPinned, useFeel, type PinnedExit } from '../../engine/ui/glass/motion.ts';
import { hudTabRect } from '../../engine/ui/frame/hud-tab.ts';
import { applyGlass, installGlassFonts, type GlassSurface } from '../../engine/ui/glass/index.ts';
import { Page as GlassPage } from '../../engine/ui/glass/Page.tsx';
import { IndexScreen } from '../../engine/ui/index/Index.tsx';
import { PlayerProvider, usePlayer, type PlayerInitial } from '../../engine/ui/player.tsx';
import { seasonAt } from '../../engine/ui/season/Season.tsx';
import { SendToWelcome } from '../../engine/ui/welcome/Welcome.tsx';
import { SettlementOnLoad } from '../../engine/ui/log/Settlement.tsx';
import { match, RouterProvider, useLocation, useNavigate, useRouterAccount, useRouterInternals } from '../../engine/ui/router.tsx';
import { effectCards } from '../../engine/ui/cards/plays.ts';
import { boardKey, loadBoard, loadIndex, loadProfile, loadRecord, loadThread, recordKey, threadKey, type LoadEnv, type ScreenDoc } from '../../engine/ui/screen-docs.ts';
import { Routes, type Route } from '../../engine/ui/routes.tsx';
import { ThreadScreen } from '../../engine/ui/thread/Thread.tsx';
import { instance } from '../../instances/divided-world/index.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';

/*
 * The glass screens, the admin queue and the vending machine load on first use, so the board's first script is the board's
 * (the forum-load plan, Task 15). Each glass route is drawn inside a Suspense whose fallback is an empty block marked
 * aria-busy: the glass page's own `main` is already on screen around it, and says it is loading until the screen lands, as a
 * screen that reads its data does (My characters until the player is read). What lands can move the page (the roster scrolls
 * to the chosen character), so nothing should read the empty page as the screen.
 */
const SignInScreen = lazy(() => import('../../engine/ui/account/SignIn.tsx').then((m) => ({ default: m.SignInScreen })));
const Characters = lazy(() => import('../../engine/ui/characters/Characters.tsx').then((m) => ({ default: m.Characters })));
const NewCharacter = lazy(() => import('../../engine/ui/characters/NewCharacter.tsx').then((m) => ({ default: m.NewCharacter })));
const ProfileEdit = lazy(() => import('../../engine/ui/profile-edit/ProfileEdit.tsx').then((m) => ({ default: m.ProfileEdit })));
const SettingsScreen = lazy(() => import('../../engine/ui/account/Settings.tsx').then((m) => ({ default: m.SettingsScreen })));
const SeasonScreen = lazy(() => import('../../engine/ui/season/Season.tsx').then((m) => ({ default: m.SeasonScreen })));
const Vending = lazy(() => import('../../engine/ui/vending/Vending.tsx').then((m) => ({ default: m.Vending })));
const AlertsScreen = lazy(() => import('../../engine/ui/alerts/Alerts.tsx').then((m) => ({ default: m.AlertsScreen })));
const UpdatesScreen = lazy(() => import('../../engine/ui/updates/Updates.tsx').then((m) => ({ default: m.UpdatesScreen })));
const GuideScreen = lazy(() => import('../../engine/ui/guide/Guide.tsx').then((m) => ({ default: m.GuideScreen })));
const ContactScreen = lazy(() => import('../../engine/ui/contact/Contact.tsx').then((m) => ({ default: m.ContactScreen })));
const WelcomeScreen = lazy(() => import('../../engine/ui/welcome/Welcome.tsx').then((m) => ({ default: m.WelcomeScreen })));
const QueueScreen = lazy(() => import('../../engine/ui/admin/Queue.tsx').then((m) => ({ default: m.QueueScreen })));
const LogScreen = lazy(() => import('../../engine/ui/log/Log.tsx').then((m) => ({ default: m.LogScreen })));
const SettlementScreen = lazy(() => import('../../engine/ui/log/Settlement.tsx').then((m) => ({ default: m.SettlementScreen })));

/**
 * The routes. The five board-world routes load their screen's whole document before they move (the forum-load plan, Task 13), signed out
 * answering a marker with no request; the rest render as they always did. `env` is what a loader needs of the app, read when it runs.
 */
function routesFor(env: LoadEnv): readonly Route[] {
  return [
    { path: '/', load: () => loadIndex(env), render: (_, doc) => <IndexScreen doc={doc as ScreenDoc<IndexPage>} /> },
    {
      path: '/b/:slug', load: ({ params, query }) => loadBoard(env, params.slug!, query), key: (params, query) => boardKey(params.slug!, query),
      render: ({ slug }, doc) => <BoardScreen slug={slug!} doc={doc as ScreenDoc<BoardPage>} />,
    },
    { path: '/characters', render: () => <Characters /> },
    { path: '/characters/new', render: () => <NewCharacter /> },
    { path: '/characters/edit', render: () => <ProfileEdit /> },
    { path: '/season', render: () => <SeasonScreen /> },
    /* The standings and the rankings are the season page's Rankings tab (the alerts design, section 7); `?page=` goes with them. */
    { path: '/standings', render: () => <MovedToRankings /> },
    { path: '/rankings', render: () => <MovedToRankings /> },
    { path: '/vending', render: () => <Vending /> },
    { path: '/alerts', render: () => <AlertsScreen /> },
    { path: '/updates', render: () => <UpdatesScreen /> },
    { path: '/guide', render: () => <GuideScreen /> },
    { path: '/contact', render: () => <ContactScreen /> },
    { path: '/welcome', render: () => <WelcomeScreen /> },
    { path: '/admin/queue', render: () => <QueueScreen /> },
    { path: '/log', render: () => <LogScreen /> },
    { path: '/log/settlement', render: () => <SettlementScreen /> },
    { path: '/c/:id', load: ({ params }) => loadProfile(env, params.id!), render: ({ id }, doc) => <ProfileScreen id={id!} doc={doc as ScreenDoc<ProfilePage>} /> },
    {
      path: '/c/:id/record', load: ({ params, query }) => loadRecord(env, params.id!, query), key: (params, query) => recordKey(params.id!, query),
      render: ({ id }, doc) => <RecordScreen id={id!} doc={doc as ScreenDoc<RecordPage>} />,
    },
    { path: '/sign-in', render: () => <SignInScreen mode="sign-in" /> },
    { path: '/register', render: () => <SignInScreen mode="register" /> },
    /* Invites live in Settings › Account (the glass build's Task 2.4); the old address opens it, so a link to it still works. */
    { path: '/invites', render: () => <Moved to={INVITES} /> },
    { path: '/settings', render: () => <SettingsScreen /> },
    { path: '/t/:thread', load: ({ params, query, hash }) => loadThread(env, params.thread!, query, hash), key: (params) => threadKey(params.thread!), render: ({ thread }, doc) => <ThreadScreen thread={thread!} doc={doc as ScreenDoc<ThreadPage>} /> },
  ];
}

/**
 * The routes that are glass pages (the glass build's Task 1.4), each with the surface whose smoke it
 * stands on, its screen drawn on the glass itself; every other route is a board page, in the frame
 * with its banner and Game HUD.
 */
const GLASS: Readonly<Record<string, GlassSurface>> = {
  '/characters': 'characters',
  '/characters/new': 'characters',
  '/characters/edit': 'characters',
  '/invites': 'account',
  '/settings': 'settings',
  '/sign-in': 'account',
  '/register': 'account',
  '/season': 'rankings',
  /* The old addresses are glass too, so a move to the season page stays on the glass. */
  '/rankings': 'rankings',
  '/standings': 'rankings',
  '/vending': 'vending',
  /* Updates stands on the page smoke of Settings, Log and Rankings: no surface of its own, so no instance must name another recipe. */
  '/updates': 'settings',
  /* The Strategy Guide stands on the same page smoke, for the same reason. */
  '/guide': 'settings',
  /* Reach a person stands on the same page smoke, for the same reason, and is readable signed out. */
  '/contact': 'settings',
  /* The welcome stands on the same page smoke, for the same reason. */
  '/welcome': 'settings',
  /* Alerts stands on the same page smoke as Updates, for the same reason: no surface of its own. */
  '/alerts': 'settings',
  '/admin/queue': 'settings',
  '/log': 'log',
  '/log/settlement': 'settlement',
};

/** The glass pages drawn with no menu bar: the settlement's summary, a screen of results whose ways out are its own. */
export const NO_MENU: ReadonlySet<string> = new Set(['/log/settlement']);

const isGlass = (path: string): boolean => Object.hasOwn(GLASS, path);

/** Every move into the glass keeps the board's place for Back, and every move out forgets it (engine/ui/glass/back.ts). */
const keepPlace = keepBoardPlace(isGlass);

/** Where Settings › Account is, which `/invites` now opens. */
const INVITES = '/settings?section=account';

/** An address that moved: it opens the new one in its place, so Back does not return to it. */
function Moved({ to }: { readonly to: string }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(to, { replace: true }); }, [navigate, to]);
  return null;
}

/** `/rankings` and `/standings`: the season page's Rankings tab, keeping the page asked for. */
function MovedToRankings() {
  const { query } = useLocation();
  const page = Number.parseInt(query.get('page') ?? '', 10);
  return <Moved to={seasonAt('rankings', Number.isFinite(page) ? page : undefined)} />;
}

/**
 * The account's preferences, once they are known: the theme and motion, and the glass's smoke,
 * contrast and text size (engine/ui/appearance.ts). The device decides, and the glass is at its
 * defaults, until then and once signed out.
 */
function Appearance({ api, boot }: { readonly api: KayfaApi; readonly boot: Boot | null }) {
  const { session } = usePlayer();
  useEffect(() => {
    /* The device's look first, on every change of account: the last account's never stands for the next. */
    applyAppearance(document, { theme: 'system', motion: 'system' }, instanceUi.themes, instanceUi.glass);
    setTiltPreference('off');
    if (!session.account) return;
    /* Boot's preferences are this account's; a session that changed after boot is read again until boot is. */
    if (boot) { applyAppearance(document, boot.preferences, instanceUi.themes, instanceUi.glass); setTiltPreference(boot.preferences.tilt); return; }
    let live = true;
    void api.preferences().then((p) => { if (live) { applyAppearance(document, p, instanceUi.themes, instanceUi.glass); setTiltPreference(p.tilt); } }, () => { /* keep the device's choice */ });
    return () => { live = false; };
  }, [api, session.account, boot]);
  return null;
}

/** Draws its children only while the tree it is in is present: a world that is leaving (held for its exit) keeps its screen but stops acting. */
function WhilePresent({ children }: { readonly children: ReactNode }) {
  return useIsPresent() ? <>{children}</> : null;
}

/**
 * A glass page in the glass's shell, every other page in the board's frame. A move between a glass
 * route and a board route swaps one shell for the other, so the screen inside remounts: that is on
 * purpose, since the two are different places (the glass is entered and left, not scrolled into),
 * and each shell starts its own page at its top with focus on its main. A move within one shell
 * keeps it mounted and only the routed screen changes.
 */
function Shell({ routes }: { readonly routes: readonly Route[] }) {
  const { path } = useLocation();
  const { session, sessionKnown } = usePlayer();
  const surface = isGlass(path) ? GLASS[path] : undefined;
  /*
   * The routed screen is the signed-in account's: when the session changes under it (another tab
   * signed someone else in, on a device two players share), it starts afresh in the same render, so
   * nothing the last account typed, chose or was told is drawn for the next. The first reading of the
   * session on a load is no change of account: the screen mounted while it was unknown is kept, and
   * asks for nothing twice.
   */
  const [mountedFor, setMountedFor] = useState<{ readonly known: boolean; readonly account: string | null; readonly n: number }>({ known: false, account: null, n: 0 });
  if (sessionKnown && (!mountedFor.known || mountedFor.account !== session.account)) {
    setMountedFor({ known: true, account: session.account, n: mountedFor.known ? mountedFor.n + 1 : mountedFor.n });
  }
  const content = (
    <AccountGate>
      <Suspense fallback={<div aria-busy="true" />}>
        <Routes key={mountedFor.n} routes={routes} />
      </Suspense>
      {/* A world that is leaving moves nobody: what a board page does on its own (below) stops with its exit, not at its end (the crossing, below). */}
      <WhilePresent>
        {/* The first load of a board page after a settlement the device has not seen opens its summary (engine/ui/log/Settlement.tsx). */}
        <SettlementOnLoad active={!surface} />
        {/* A new account, with no character and the welcome unseen, is sent to it from its first board page (engine/ui/welcome/Welcome.tsx). */}
        <SendToWelcome active={!surface} />
      </WhilePresent>
    </AccountGate>
  );
  const world = surface ? 'glass' : 'board';
  /*
   * The crossing (the glass polish design, section 9): the two worlds sit under one AnimatePresence, keyed, so a move from one to the other
   * holds the leaving world for the exit and draws the arriving one at once. The glass opens from the HUD's tab to the window and closes
   * back into it; the board does not move (its hold only keeps it under the glass until the glass has opened). The tab's box is read in
   * the render that changes the world, from the HUD that is still mounted, and an exit uses the box its world last rendered with.
   * Esc or Back mid-crossing flips the keys: the world that was leaving is present again, the same element, and Motion animates both
   * from where they are. Under Off the presets are empty, no element has an exit, and the old world is gone in the same commit.
   *
   * What is subscribed or polled lives below the screens, in the world that leaves; it is held (not unmounted) for the exit, and the
   * arriving world mounts its own as the world always did, so nothing is subscribed twice by the crossing for longer than the exit.
   */
  const feel = useFeel(instanceUi.glass.motion);
  const within = { width: window.innerWidth, height: window.innerHeight };
  const glassMotion = useMemo(
    () => (world === 'glass' ? crossingPinned(feel, { tab: hudTabRect(within), within }) : {}),
    // The window's size is read when the world changes, not on every render: an exit closes into the box it opened from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feel, world],
  );
  /* The board keeps under the glass until the glass has opened, whatever its spring takes; a stalled enter lets go after a while. */
  const opened = useRef(new Set<() => void>());
  const holdBoard = useCallback((release: () => void) => {
    opened.current.add(release);
    const stalled = setTimeout(release, BOARD_HOLD_LIMIT_MS);
    return () => { opened.current.delete(release); clearTimeout(stalled); };
  }, []);
  /* An exit reads the window's scroll as it starts (the leaving world is pinned that far up, Held.tsx) and whether the world had come to rest (motion.ts, header). */
  const { exitRested, onRest } = useRest(world);
  const leave: PinnedExit = { scrollY: window.scrollY, rested: exitRested };
  return (
    <AnimatePresence initial={false} custom={leave}>
      {surface
        ? (
          <Leaving
            key="glass" pin custom={leave} className="kb-world" data-kb-world="glass" {...glassMotion}
            onAnimationComplete={(def) => { if (def === 'open') { onRest(); for (const release of [...opened.current]) release(); } }}
          >
            <GlassPage surface={surface} menu={!NO_MENU.has(path)}>{content}</GlassPage>
          </Leaving>
        )
        : <Leaving key="board" pin holdUntil={feel ? holdBoard : undefined} className="kb-world" data-kb-world="board"><Frame>{content}</Frame></Leaving>}
    </AnimatePresence>
  );
}

/** The longest the board is held under a glass whose enter has not ended (a tab in the background pauses animation frames). */
const BOARD_HOLD_LIMIT_MS = 2000;

/** The instance's glass on the page: its standard key's tokens and colors on the root, and its fonts. */
function useGlass() {
  useLayoutEffect(() => {
    applyGlass(document.documentElement, instanceUi.glass, 'standard');
    installGlassFonts(document, instanceUi.glass);
  }, []);
}

/** Read once, at load, while the address still names the fixture. At the board match's fixture a screen's chance is fixed (the Vending sign is its first marquee), so a board is compared to the same screen each time. */
const FIXED_CHANCE: { readonly random?: () => number } = new URLSearchParams(window.location.search).get('fixture') === 'boards' ? { random: () => 0 } : {};

/** How long after boot and the first load the estimate is waited for before the page draws without it. */
export const ESTIMATE_WAIT_MS = 600;

/** What the first load read: the session, boot (a session's), the instance's settings, and the estimate if it landed in time. */
interface FirstLoad {
  readonly session: Session;
  readonly boot: Boot | null;
  readonly settings: ScreenSettings;
  readonly estimate: Estimate | null;
  readonly estimateLater?: Promise<Estimate | null>;
}

/**
 * What the first load and the routes' loaders share: the session asked once (a loader and boot both wait on it, then run side by side), the
 * session as the player's provider holds it once the page is drawn (a loader that runs on a later move asks that), and the instance's settings
 * once the first load has read them (until then a loader leaves the thread's page size to the server).
 */
interface Known {
  session: Promise<Session> | null;
  live: Session | null;
  settings: ScreenSettings | null;
}

const sessionOnce = (api: KayfaApi, known: Known): Promise<Session> => (known.session ??= api.session().catch((): Session => ({ signedIn: false, account: null })));

/**
 * The first page draws once (the forum-load plan, Tasks 12 and 13, and the design, section 3): boot and the estimate start together once
 * the session is known, beside the first route's load (which waits on the same session), the page drawn when boot and the load have landed
 * (in `Gate`), the estimate waited for 600 ms more and then left to land on its own. Signed out, `settings()` alone, as before.
 */
async function firstLoad(api: KayfaApi, known: Known): Promise<FirstLoad> {
  const session = await sessionOnce(api, known);
  if (!session.signedIn) return { session, boot: null, settings: await api.settings(), estimate: null };
  const asked = api.estimate().then((e): Estimate | null => e, () => null);
  const boot = await api.boot();
  const estimate = await Promise.race([asked, new Promise<'late'>((r) => setTimeout(() => r('late'), ESTIMATE_WAIT_MS))]);
  return estimate === 'late' ? { session, boot, settings: boot.settings, estimate: null, estimateLater: asked } : { session, boot, settings: boot.settings, estimate };
}

/**
 * Inside the providers: boot for the account signed in now, read again when the session's account changes after the first load (a sign-in,
 * a sign-out, a switch), so the frame and the HUD never show the last account's data, and the router told whose session this is. Signed out,
 * the boot held is dropped, so a sign-in as the same account reads it afresh.
 */
function Booted({ api, known, first, children }: { readonly api: KayfaApi; readonly known: Known; readonly first: Boot | null; readonly children: ReactNode }) {
  const { session } = usePlayer();
  const [boot, setBoot] = useState<Boot | null>(first);
  /* The loaders ask the session as it is now: set before the router is told of an account that changed, which reads the page again. */
  useLayoutEffect(() => { known.live = session; }, [known, session]);
  useRouterAccount(session.account);
  useEffect(() => {
    if (!session.signedIn) { if (boot !== null) setBoot(null); return; }
    if (boot !== null && boot.account === session.account) return;
    let live = true;
    void api.boot().then((b) => { if (live) setBoot(b); }, () => { /* each piece reads for itself until boot can be read */ });
    return () => { live = false; };
  }, [api, session.signedIn, session.account, boot]);
  /* Boot is drawn only for the account it was read for: after a switch it is null until it is read again. */
  const mine = boot !== null && session.signedIn && boot.account === session.account ? boot : null;
  return (
    <BootProvider boot={mine}>
      <Appearance api={api} boot={mine} />
      {children}
    </BootProvider>
  );
}

/**
 * The page waits, empty and busy, for the first load (boot) and for the first route's load: both started together, so the page is as slow as
 * the slower of the two, never the two in a row. The routes are handed to the router at once, which starts the first route's load; a route
 * without a loader needs none.
 */
function Gate({ routes, ready, children }: { readonly routes: readonly Route[]; readonly ready: boolean; readonly children: ReactNode }) {
  const { shown, attach } = useRouterInternals();
  useLayoutEffect(() => { attach(routes); });
  const loads = routes.some((r) => r.load !== undefined && match(r.path, shown.location.path) !== null);
  /* Only the first draw waits for the route: a later load (a move, a switch of account) leaves the frame up and the router holds the old page. */
  const [opened, setOpened] = useState(false);
  const waiting = loads && !shown.ready && !shown.failure;
  if (!opened && ready && !waiting) setOpened(true);
  if (!ready || (!opened && waiting)) return <main className="kb-page" aria-busy="true" />;
  return <>{children}</>;
}

const EFFECTS: readonly string[] = [...effectCards(instanceUi)];

export function App({ api }: { readonly api: KayfaApi }) {
  useGlass();
  const [first, setFirst] = useState<FirstLoad | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const known = useRef<Known>({ session: null, live: null, settings: null });
  const routes = useMemo(() => routesFor({
    api,
    signedIn: () => known.current.live?.signedIn ?? sessionOnce(api, known.current).then((s) => s.signedIn),
    postsPerPage: () => known.current.settings?.postsPerPage ?? null,
    effects: EFFECTS,
  }), [api]);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void firstLoad(api, known.current).then((f) => { if (live) { known.current.settings = f.settings; setFirst(f); } }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api, attempt]);
  const retry = useCallback(() => { known.current.session = null; setFirst(null); setAttempt((n) => n + 1); }, []);
  const initial: PlayerInitial | null = first ? { session: first.session, boot: first.boot, estimate: first.estimate, ...(first.estimateLater ? { estimateLater: first.estimateLater } : {}) } : null;
  return (
    <RouterProvider onMove={keepPlace}>
      {failed
        /* No boot: the bare page, with the instance's own words and the way to try again. */
        ? (
          <KayfaProvider value={{ api, instance, ui: instanceUi, settings: fallbackSettings, ...FIXED_CHANCE }}>
            <main className="kb-page"><CannotDisplay address={window.location.pathname + window.location.search} onRetry={retry} /></main>
          </KayfaProvider>
        )
        : (
          <Gate routes={routes} ready={first !== null}>
            {first && initial && (
              <KayfaProvider value={{ api, instance, ui: instanceUi, settings: first.settings, ...FIXED_CHANCE }}>
                <PlayerProvider api={api} initial={initial}>
                  <Booted api={api} known={known.current} first={first.boot}>
                    <Shell routes={routes} />
                  </Booted>
                </PlayerProvider>
              </KayfaProvider>
            )}
          </Gate>
        )}
    </RouterProvider>
  );
}
