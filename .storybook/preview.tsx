/**
 * Storybook's composition root: the engine's base stylesheet and an instance's house theme, as
 * web/ loads them, and for a story that asks for one (`parameters.world`, engine/ui/story.tsx) an
 * in-memory world on the fake backend with the app's providers around it. Stories in engine/ui/
 * never import an instance; this file hands them one.
 */
import type { Decorator, Preview } from '@storybook/react-vite';
import { useMemo } from 'react';
import '../engine/ui/base.css';
import '../instances/divided-world/ui/theme.css';
import { createFake } from '../engine/ui/data/fake.ts';
import { KayfaProvider } from '../engine/ui/context.tsx';
import { PlayerProvider } from '../engine/ui/player.tsx';
import { RouterProvider } from '../engine/ui/router.tsx';
import type { WorldParameters } from '../engine/ui/story.tsx';
import { instance } from '../instances/divided-world/index.ts';
import { instanceUi } from '../instances/divided-world/ui/index.ts';
import { fallbackSettings } from '../web/src/data/settings.ts';

const withWorld: Decorator = (Story, context) => {
  const { world, path } = context.parameters as WorldParameters;
  const api = useMemo(() => {
    if (!world) return null;
    const fake = createFake({ instance, settings: fallbackSettings });
    world(fake, instance);
    return fake;
  }, [world]);
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
