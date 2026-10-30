/**
 * Storybook's composition root: the engine's base stylesheet, an instance's house theme and its
 * glass (the glass's stylesheets, its tokens on the root and its fonts), as web/ loads them, and for a story that asks for one (`parameters.world`, engine/ui/story.tsx) an
 * in-memory world on the fake backend with the app's providers around it. Stories in engine/ui/
 * never import an instance; this file hands them one.
 */
import type { Decorator, Preview } from '@storybook/react-vite';
import { useMemo } from 'react';
import '../engine/ui/base.css';
import '../instances/divided-world/ui/theme.css';
import '../engine/ui/glass/tokens.css';
import '../engine/ui/glass/base.css';
import '../engine/ui/glass/calm.css';
import { applyGlass, installGlassFonts } from '../engine/ui/glass/index.ts';
import { createFake } from '../engine/ui/data/fake.ts';
import { KayfaProvider } from '../engine/ui/context.tsx';
import { PlayerProvider } from '../engine/ui/player.tsx';
import { RouterProvider } from '../engine/ui/router.tsx';
import type { WorldParameters } from '../engine/ui/story.tsx';
import { instance } from '../instances/divided-world/index.ts';
import { instanceUi } from '../instances/divided-world/ui/index.ts';
import { fallbackSettings } from '../web/src/data/settings.ts';

/* The instance's glass, as the app puts it on the page. */
applyGlass(document.documentElement, instanceUi.glass, 'standard');
installGlassFonts(document, instanceUi.glass);

const withWorld: Decorator = (Story, context) => {
  const { world, path } = context.parameters as WorldParameters;
  const api = useMemo(() => {
    if (!world && !path) return null;
    const fake = createFake({ instance, settings: fallbackSettings });
    world?.(fake, instance);
    return fake;
  }, [world, path]);
  if (!api) return <Story />;
  if (path) window.history.replaceState(null, '', path);
  return (
    <RouterProvider>
      <KayfaProvider value={{ api, instance, ui: instanceUi, settings: fallbackSettings }}>
        <PlayerProvider api={api}>
          <Story />
        </PlayerProvider>
      </KayfaProvider>
    </RouterProvider>
  );
};

const preview: Preview = {
  decorators: [withWorld],
  parameters: { a11y: { test: 'error' } },
};

export default preview;
