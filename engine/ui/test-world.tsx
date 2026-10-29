/**
 * A world for a screen's unit test: a small Instance-shaped object (a test in engine/ui may not
 * import an instance), the in-memory backend built from it, and the app's providers around the
 * screen. `renderInWorld(<Screen />, { seed, path })` seeds the backend, opens the address, and
 * renders; it returns the backend and the ids the seed made.
 */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { Instance, Settings } from '../rules/types.ts';
import { KayfaProvider, type Kayfa } from './context.tsx';
import { createFake, type Fake } from './data/fake.ts';
import type { ScreenSettings } from './data/api.ts';
import { PlayerProvider } from './player.tsx';
import { RouterProvider } from './router.tsx';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 },
  postMaxLength: 200, titleMaxLength: 40, postsPerPage: 20, hotReplies: 3, economy: {},
};

const earn = () => [];

export const testInstance: Instance = {
  key: 'test', name: 'Test',
  copy: { turnsThreadTitle: 'Turns {season}', revealTitle: 'Reveal {season}', revealBody: 'All.' },
  classes: [{ key: 'face', name: 'Face', earn }, { key: 'heel', name: 'Heel', earn }],
  cards: [{ key: 'whoops', name: 'Whoops!' } as unknown as Instance['cards'][number]],
  reactions: [
    { key: 'fire', emoji: 'F', quadrant: 'excitedPositive' }, { key: 'tomato', emoji: 'T', quadrant: 'excitedNegative' },
    { key: 'tea', emoji: 'E', quadrant: 'calmPositive' }, { key: 'zzz', emoji: 'Z', quadrant: 'boredNegative' },
  ],
  settings,
  boards: [
    { slug: 'general', name: 'General', description: 'Anything.' },
    { slug: 'off-topic', name: 'Off Topic', description: 'Elsewhere.' },
    { slug: 'the-system', name: 'The System', description: 'Its words.', system: true },
  ],
  ranks: [{ name: 'Jobber', from: 0 }, { name: 'Midcarder', from: 300 }, { name: 'Main Eventer', from: 600 }],
  pipStyles: [{ key: 'default', name: 'Default', full: 'f.svg', empty: 'e.svg' }],
};

const ui = { quadrantLabels: { excitedNegative: 'Heat', excitedPositive: 'Hype', boredNegative: 'Groan', calmPositive: 'Calm' }, copy: { siteName: 'Test', siteTagline: 'test', shopName: 'Shop' }, pips: { default: { full: 'full.svg', empty: 'empty.svg' } } } as unknown as Kayfa['ui'];

export interface WorldOptions {
  /** The address the screen opens at (a path, a query, a fragment). */
  readonly path?: string;
  readonly settings?: Partial<ScreenSettings>;
}

/** The backend alone, for a test that must do something asynchronous (a spin) before it renders. */
export function buildWorld(settingsOverride?: Partial<ScreenSettings>): Fake {
  return createFake({ instance: testInstance, settings: settingsOverride });
}

/** Render a screen on a backend made by `buildWorld`. */
export function renderIn(fake: Fake, element: ReactElement, options: WorldOptions = {}) {
  window.history.replaceState(null, '', options.path ?? '/');
  const kayfa: Kayfa = { api: fake, instance: testInstance, ui, settings: { ...settings, ...options.settings } as unknown as ScreenSettings };
  return {
    fake,
    ...render(
      <RouterProvider>
        <KayfaProvider value={kayfa}>
          <PlayerProvider api={fake}>{element}</PlayerProvider>
        </KayfaProvider>
      </RouterProvider>,
    ),
  };
}

/** Seed a backend, open the address and render: `seeded` is whatever the seed returned. */
export function renderInWorld<T = undefined>(element: ReactElement, options: WorldOptions & { readonly seed?: (fake: Fake) => T } = {}) {
  const fake = buildWorld(options.settings);
  const seeded = options.seed?.(fake) as T;
  return { ...renderIn(fake, element, options), seeded };
}
