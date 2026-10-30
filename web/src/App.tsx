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
import { InvitesScreen } from '../../engine/ui/account/Invites.tsx';
import { SettingsScreen } from '../../engine/ui/account/Settings.tsx';
import { SignInScreen } from '../../engine/ui/account/SignIn.tsx';
import { Characters } from '../../engine/ui/characters/Characters.tsx';
import { NewCharacter } from '../../engine/ui/characters/NewCharacter.tsx';
import { ProfileScreen } from '../../engine/ui/profile/Profile.tsx';
import { RecordScreen } from '../../engine/ui/profile/Record.tsx';
import { Frame } from '../../engine/ui/frame/Frame.tsx';
import { applyGlass, installGlassFonts, type GlassSurface } from '../../engine/ui/glass/index.ts';
import { Page as GlassPage } from '../../engine/ui/glass/Page.tsx';
import { IndexScreen } from '../../engine/ui/index/Index.tsx';
import { PlayerProvider, usePlayer } from '../../engine/ui/player.tsx';
import { ProfileEdit } from '../../engine/ui/profile-edit/ProfileEdit.tsx';
import { StandingsScreen } from '../../engine/ui/standings/Standings.tsx';
import { RouterProvider, useLocation } from '../../engine/ui/router.tsx';
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
  { path: '/c/:id', render: ({ id }) => <ProfileScreen id={id!} /> },
  { path: '/c/:id/record', render: ({ id }) => <RecordScreen id={id!} /> },
  { path: '/sign-in', render: () => <SignInScreen mode="sign-in" /> },
  { path: '/register', render: () => <SignInScreen mode="register" /> },
  { path: '/invites', render: () => <InvitesScreen /> },
  { path: '/settings', render: () => <SettingsScreen /> },
  { path: '/t/:thread', render: ({ thread }) => <ThreadScreen thread={thread!} /> },
];

/**
 * The routes that are glass pages (the glass build's Task 1.4), each with the surface whose smoke it
 * stands on. Their content is the board's screen as it was until Part 2 restyles it; every other
 * route is a board page, in the frame with its banner and Game HUD.
 */
const GLASS: Readonly<Record<string, GlassSurface>> = {
  '/characters': 'characters',
  '/characters/new': 'characters',
  '/characters/edit': 'characters',
  '/invites': 'account',
  '/settings': 'settings',
  '/sign-in': 'account',
  '/register': 'account',
};

/** The account's theme and motion, once it is known; the device decides until then. */
function Appearance({ api }: { readonly api: KayfaApi }) {
  const { session } = usePlayer();
  useEffect(() => {
    if (!session.account) { applyAppearance(document, { theme: 'system', motion: 'system' }, instanceUi.themes); return; }
    let live = true;
    void api.preferences().then((p) => { if (live) applyAppearance(document, p, instanceUi.themes); }, () => { /* keep the device's choice */ });
    return () => { live = false; };
  }, [api, session.account]);
  return null;
}

/** A glass page in the glass's shell, every other page in the board's frame. */
function Shell() {
  const { path } = useLocation();
  const surface = GLASS[path];
  const content = (
    <AccountGate>
      <Routes routes={ROUTES} />
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
    <RouterProvider>
      <KayfaProvider value={{ api, instance, ui: instanceUi, settings }}>
        <PlayerProvider api={api}>
          <Appearance api={api} />
          <Shell />
        </PlayerProvider>
      </KayfaProvider>
    </RouterProvider>
  );
}
