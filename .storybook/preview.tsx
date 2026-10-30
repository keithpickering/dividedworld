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
import { boardSwitch } from '../engine/ui/glass/board.ts';
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

/* Where the Main board's layout becomes the Phone board's, worked out from the instance's sizes (engine/ui/glass/board.ts). */
const SWITCH = boardSwitch(instanceUi.glass);
const ABOVE = SWITCH + 8;
const BELOW = SWITCH - 8;

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
  parameters: {
    a11y: { test: 'error' },
    /*
     * The widths the owner reviews the glass at, named for what they show: the glass plan's Phone
     * board (a 390 by 844 phone), and a window 8px either side of the width where the Main board's
     * layout, scaled with the window, becomes the Phone board's.
     */
    viewport: {
      options: {
        glassPhone390: { name: 'Phone board, 390 × 844', styles: { width: '390px', height: '844px' }, type: 'mobile' },
        boardAboveSwitch: { name: `Main board scaled, just above the switch, ${ABOVE} × 900`, styles: { width: `${ABOVE}px`, height: '900px' }, type: 'desktop' },
        boardBelowSwitch: { name: `Phone board, just below the switch, ${BELOW} × 900`, styles: { width: `${BELOW}px`, height: '900px' }, type: 'desktop' },
      },
    },
  },
};

export default preview;
