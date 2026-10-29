/**
 * The app: the backend, the instance, its look and words, and the screens, put together. This and
 * web/src/data/ are the only places the engine's screens and an instance meet.
 */
import { useEffect, useState } from 'react';
import type { KayfaApi, ScreenSettings } from '../../engine/ui/data/api.ts';
import { applyAppearance } from '../../engine/ui/appearance.ts';
import { KayfaProvider } from '../../engine/ui/context.tsx';
import { BoardScreen } from '../../engine/ui/board/Board.tsx';
import { Frame } from '../../engine/ui/frame/Frame.tsx';
import { IndexScreen } from '../../engine/ui/index/Index.tsx';
import { PlayerProvider, usePlayer } from '../../engine/ui/player.tsx';
import { RouterProvider } from '../../engine/ui/router.tsx';
import { Routes, type Route } from '../../engine/ui/routes.tsx';
import { ThreadScreen } from '../../engine/ui/thread/Thread.tsx';
import { instance } from '../../instances/divided-world/index.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';

const LINKS = [{ to: '/', label: 'Index' }];

const ROUTES: readonly Route[] = [
  { path: '/', render: () => <IndexScreen /> },
  { path: '/b/:slug', render: ({ slug }) => <BoardScreen slug={slug!} /> },
  { path: '/t/:thread', render: ({ thread }) => <ThreadScreen thread={thread!} /> },
];

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

export function App({ api }: { readonly api: KayfaApi }) {
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
          <Frame links={LINKS}>
            <Routes routes={ROUTES} />
          </Frame>
        </PlayerProvider>
      </KayfaProvider>
    </RouterProvider>
  );
}
