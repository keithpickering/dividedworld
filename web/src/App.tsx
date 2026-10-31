/**
 * The app: the backend, the instance, its look and words, and the screens, put together. This and
 * web/src/data/ are the only places the engine's screens and an instance meet.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import type { KayfaApi, ScreenSettings } from '../../engine/ui/data/api.ts';
import { applyAppearance } from '../../engine/ui/appearance.ts';
import { KayfaProvider } from '../../engine/ui/context.tsx';
import { BoardScreen } from '../../engine/ui/board/Board.tsx';
import { AccountGate } from '../../engine/ui/account/OpenAccount.tsx';
import { SettingsScreen } from '../../engine/ui/account/Settings.tsx';
import { SignInScreen } from '../../engine/ui/account/SignIn.tsx';
import { Characters } from '../../engine/ui/characters/Characters.tsx';
import { NewCharacter } from '../../engine/ui/characters/NewCharacter.tsx';
import { ProfileScreen } from '../../engine/ui/profile/Profile.tsx';
import { RecordScreen } from '../../engine/ui/profile/Record.tsx';
import { Frame } from '../../engine/ui/frame/Frame.tsx';
import { keepBoardPlace } from '../../engine/ui/glass/back.ts';
import { applyGlass, installGlassFonts, type GlassSurface } from '../../engine/ui/glass/index.ts';
import { Page as GlassPage } from '../../engine/ui/glass/Page.tsx';
import { IndexScreen } from '../../engine/ui/index/Index.tsx';
import { PlayerProvider, usePlayer } from '../../engine/ui/player.tsx';
import { ProfileEdit } from '../../engine/ui/profile-edit/ProfileEdit.tsx';
import { Vending } from '../../engine/ui/vending/Vending.tsx';
import { RankingsScreen } from '../../engine/ui/rankings/Rankings.tsx';
import { StandingsScreen } from '../../engine/ui/standings/Standings.tsx';
import { RouterProvider, useLocation, useNavigate } from '../../engine/ui/router.tsx';
import { Routes, type Route } from '../../engine/ui/routes.tsx';
import { ThreadScreen } from '../../engine/ui/thread/Thread.tsx';
import { instance } from '../../instances/divided-world/index.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';

const ROUTES: readonly Route[] = [
  { path: '/', render: () => <IndexScreen /> },
  { path: '/b/:slug', render: ({ slug }) => <BoardScreen slug={slug!} /> },
  { path: '/characters', render: () => <Characters /> },
  { path: '/characters/new', render: () => <NewCharacter /> },
  { path: '/characters/edit', render: () => <ProfileEdit /> },
  { path: '/standings', render: () => <StandingsScreen /> },
  { path: '/rankings', render: () => <RankingsScreen /> },
  { path: '/vending', render: () => <Vending /> },
  { path: '/c/:id', render: ({ id }) => <ProfileScreen id={id!} /> },
  { path: '/c/:id/record', render: ({ id }) => <RecordScreen id={id!} /> },
  { path: '/sign-in', render: () => <SignInScreen mode="sign-in" /> },
  { path: '/register', render: () => <SignInScreen mode="register" /> },
  /* Invites live in Settings › Account (the glass build's Task 2.4); the old address opens it, so a link to it still works. */
  { path: '/invites', render: () => <Moved to={INVITES} /> },
  { path: '/settings', render: () => <SettingsScreen /> },
  { path: '/t/:thread', render: ({ thread }) => <ThreadScreen thread={thread!} /> },
];

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
  '/rankings': 'rankings',
  '/vending': 'vending',
};

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

/**
 * The account's preferences, once they are known: the theme and motion, and the glass's smoke,
 * contrast and text size (engine/ui/appearance.ts). The device decides, and the glass is at its
 * defaults, until then and once signed out.
 */
function Appearance({ api }: { readonly api: KayfaApi }) {
  const { session } = usePlayer();
  useEffect(() => {
    /* The device's look first, on every change of account: the last account's never stands for the next. */
    applyAppearance(document, { theme: 'system', motion: 'system' }, instanceUi.themes, instanceUi.glass);
    if (!session.account) return;
    let live = true;
    void api.preferences().then((p) => { if (live) applyAppearance(document, p, instanceUi.themes, instanceUi.glass); }, () => { /* keep the device's choice */ });
    return () => { live = false; };
  }, [api, session.account]);
  return null;
}

/**
 * A glass page in the glass's shell, every other page in the board's frame. A move between a glass
 * route and a board route swaps one shell for the other, so the screen inside remounts: that is on
 * purpose, since the two are different places (the glass is entered and left, not scrolled into),
 * and each shell starts its own page at its top with focus on its main. A move within one shell
 * keeps it mounted and only the routed screen changes.
 */
function Shell() {
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
      <Routes key={mountedFor.n} routes={ROUTES} />
    </AccountGate>
  );
  return surface ? <GlassPage surface={surface}>{content}</GlassPage> : <Frame>{content}</Frame>;
}

/** The instance's glass on the page: its standard key's tokens and colors on the root, and its fonts. */
function useGlass() {
  useLayoutEffect(() => {
    applyGlass(document.documentElement, instanceUi.glass, 'standard');
    installGlassFonts(document, instanceUi.glass);
  }, []);
}

export function App({ api }: { readonly api: KayfaApi }) {
  useGlass();
  const [settings, setSettings] = useState<ScreenSettings | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api.settings().then(setSettings, () => setFailed(true));
  }, [api]);
  if (failed) return <main className="kb-page"><p className="kb-notice" data-kb-tone="refusal">The board could not be reached. Reload the page to try again.</p></main>;
  if (!settings) return <main className="kb-page" aria-busy="true" />;
  return (
    <RouterProvider onMove={keepPlace}>
      <KayfaProvider value={{ api, instance, ui: instanceUi, settings }}>
        <PlayerProvider api={api}>
          <Appearance api={api} />
          <Shell />
        </PlayerProvider>
      </KayfaProvider>
    </RouterProvider>
  );
}
