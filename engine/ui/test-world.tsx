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

/**
 * A glass with one plain recipe for every surface, so a screen that draws smoke (the HUD, a glass
 * page) renders; the smoke's own tests (engine/ui/glass/Smoke.test.tsx) give it real recipes.
 */
export const testGlass = {
  keys: { standard: {}, high: {} },
  smoke: {
    recipes: { plain: { layers: [] } },
    surfaces: Object.fromEntries(['hud', 'hand', 'play', 'react', 'turn', 'effect', 'vending', 'characters', 'rankings', 'log', 'settings', 'account', 'settlement'].map((s) => [s, 'plain'])),
  },
  calm: { opacity: 0.85, feather: 32 },
  /* The smallest of each kind, as Divided World's: the Main board's layout holds from 1440 × 16 / 20 = 1152px. */
  sizes: {
    label: { px: 20, family: 'Body', weight: 700 },
    'phone-small': { px: 16, family: 'Body', weight: 600, phone: true },
  },
  fonts: [],
  classes: {},
  orbs: { gradients: [], body: { core: '', edge: '' } },
} as unknown as Kayfa['ui']['glass'];

const ui = { glass: testGlass, themes: [{ key: 'house', name: 'House', href: '/house.css', modes: 'both' }, { key: 'sepia', name: 'Sepia', href: '/sepia.css', modes: 'light' }], classLooks: { face: { color: 'currentColor', description: 'The crowd favorite: earns from cheers.', marks: { label: 'Earns from hype, hurt by the groan', earns: ['excitedPositive'], hurts: ['boredNegative'] } }, heel: { color: 'currentColor', description: 'Earns heat: boos and tomatoes.', marks: { label: 'Earns from heat, hurt by the calm', earns: ['excitedNegative'], hurts: ['calmPositive'] } } }, quadrantLabels: { excitedNegative: 'Heat', excitedPositive: 'Hype', boredNegative: 'Groan', calmPositive: 'Calm' }, quadrantClasses: { excitedNegative: 'heel', excitedPositive: 'face' }, copy: { siteName: 'Test', siteTagline: 'test', shopName: 'Shop', reducedMotionCard: 'the test card still moves you, only instantly.' }, pips: { default: { full: 'full.svg', empty: 'empty.svg' } }, cards: [] } as unknown as Kayfa['ui'];

export interface WorldOptions {
  /** The address the screen opens at (a path, a query, a fragment). */
  readonly path?: string;
  readonly settings?: Partial<ScreenSettings>;
  /** A different instance for the screen and its backend (a test of a bigger vocabulary); pass the same to `buildWorld`. */
  readonly instance?: Instance;
  /** What the address's history entry carries, as a navigation with state leaves it (Back's return to a thread). */
  readonly state?: unknown;
  /** A different glass than `testGlass` (a recipe with its own calm). */
  readonly glass?: Kayfa['ui']['glass'];
  /** The instance's cards' looks, one `CardUi` per card key (none by default: every play is shown as its tag alone). */
  readonly cards?: Kayfa['ui']['cards'];
}

/** The backend alone, for a test that must do something asynchronous (a spin) before it renders. */
export function buildWorld(settingsOverride?: Partial<ScreenSettings>, instance: Instance = testInstance): Fake {
  return createFake({ instance, settings: settingsOverride });
}

/** Render a screen on a backend made by `buildWorld`. */
export function renderIn(fake: Fake, element: ReactElement, options: WorldOptions = {}) {
  window.history.replaceState(options.state ?? null, '', options.path ?? '/');
  const kayfa: Kayfa = { api: fake, instance: options.instance ?? testInstance, ui: options.glass || options.cards ? { ...ui, ...(options.glass ? { glass: options.glass } : {}), ...(options.cards ? { cards: options.cards } : {}) } : ui, settings: { ...settings, ...options.settings } as unknown as ScreenSettings };
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
  const fake = buildWorld(options.settings, options.instance);
  const seeded = options.seed?.(fake) as T;
  return { ...renderIn(fake, element, options), seeded };
}
