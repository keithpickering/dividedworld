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
import { TIP_KEYS } from './tips/keys.ts';
import type { GuideUi } from './types.ts';
import { RouterProvider } from './router.tsx';
import { systemSettings, testSystem } from '../rules/test-system.ts';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } },
  hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
  postMaxLength: 200, titleMaxLength: 40, postsPerPage: 20, hotReplies: 3, cardSettings: {}, economy: { 'whoops.price': 100 }, ...systemSettings,
};

const earn = () => [];

export const testInstance: Instance = {
  key: 'test', name: 'Test',
  copy: { turnsThreadTitle: 'Turns {season}', revealTitle: 'Reveal {season}', revealBody: 'All.' },
  classes: [{ key: 'face', name: 'Face', earn }, { key: 'heel', name: 'Heel', earn }],
  /* One salty card at 1.00, whose play costs nothing more: enough rules for a screen that prices a card (the HUD's hand, the Vending Machine). */
  cards: [{
    key: 'whoops', name: 'Whoops!', alignment: 'salty', rarity: 'common', priceKey: 'whoops.price', playPrice: () => 0,
    canApply: () => ({ ok: true, value: undefined }), validateConfig: (config) => ({ ok: true, value: config }),
  }],
  reactions: [
    { key: 'fire', emoji: 'F', quadrant: 'excitedPositive' }, { key: 'tomato', emoji: 'T', quadrant: 'excitedNegative' },
    { key: 'tea', emoji: 'E', quadrant: 'calmPositive' }, { key: 'zzz', emoji: 'Z', quadrant: 'boredNegative' },
  ],
  settings,
  system: testSystem,
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

/** A reason's words as an instance gives them: its name, then what it pays for (the log names each by the part before the colon). */
const COUNTS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const REASONS: Readonly<Record<string, string | ((n: Readonly<Record<string, number>>) => string)>> = {
  /* A reason whose words state a tunable number (the core loop design, section 6): said with the numbers it is given. */
  'heel.postedTooMuch': (n) => `Posted too much: a post past ${COUNTS[n['heel.postsAllowed'] ?? 0] ?? n['heel.postsAllowed']} in one day`,
  'heel.drewHeat': 'Drew heat: excited, negative reactions to its posts and cards',
  'heel.stoleThunder': 'Stole the thunder: its Salty card on another\'s post drew more votes than the post this window',
  'heel.shrugged': 'Shrugged off: calm, positive reactions to its posts and cards',
  'face.cheered': 'Cheered: excited, positive reactions to its posts and cards',
};
const reasonWords = (reason: string, params: Readonly<Record<string, number>>) => {
  const w = REASONS[reason];
  return w === undefined ? `Settled under "${reason}"` : typeof w === 'string' ? w : w(params ?? {});
};

const ui = { glass: testGlass, themes: [{ key: 'house', name: 'House', href: '/house.css', modes: 'both' }, { key: 'sepia', name: 'Sepia', href: '/sepia.css', modes: 'light' }], classLooks: { face: { color: 'currentColor', description: () => 'The crowd favorite: earns from cheers.', marks: { label: 'Earns from hype, hurt by the groan', earns: ['excitedPositive'], hurts: ['boredNegative'] } }, heel: { color: 'currentColor', description: () => 'Earns heat: boos and tomatoes.', marks: { label: 'Earns from heat, hurt by the calm', earns: ['excitedNegative'], hurts: ['calmPositive'] } } }, quadrantLabels: { excitedNegative: 'Heat', excitedPositive: 'Hype', boredNegative: 'Groan', calmPositive: 'Calm' }, reasonWords, quadrantClasses: { excitedNegative: 'heel', excitedPositive: 'face' }, copy: { siteName: 'Test', siteTagline: 'test', shopName: 'Shop', reducedMotionCard: 'the test card still moves you, only instantly.' }, pips: { default: { full: 'full.svg', empty: 'empty.svg' } }, cards: [], onboarding: { tips: Object.fromEntries(TIP_KEYS.map((k) => [k, { title: `Title of ${k}`, line: `The line of ${k}.` }])), letter: 'A letter.' }, frontDoor: { title: 'How do we explain this', label: 'Sample thread, made up', cast: [{ key: 'ann', name: 'Ann', rank: 0, posts: 12 }, { key: 'bo', name: 'Bo', title: 'Test Talent', rank: 2, posts: 340, revealed: { class: 'heel', at: '2026-10-03T12:00:00Z' } }], posts: [{ by: 'ann', body: 'Hello there.', reactions: { fire: 2 } }, { by: 'bo', body: 'It plays up to {{setting:charactersPerPlayer}} characters.', reactions: { tea: 1, tomato: 3 }, plays: [{ card: 'whoops', by: 'ann', config: { seed: 7 } }] }], note: 'A note. It is by invite.', prompt: { title: 'Who will you play as?', line: 'A test game.' } }, guide: { markdown: '## Welcome letter\n\n<!-- kayfabb:letter -->\n\n## Classes\n\n<!-- kayfabb:classes -->', hints: { face: 'Get behind the posts you like.', heel: 'Being hated is a living.' } } } as unknown as Kayfa['ui'];

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
  /** Class looks of the test's own, in place of the test world's Face and Heel (a description that reads the settlement span). */
  readonly classLooks?: Kayfa['ui']['classLooks'];
  /** The instance's pictures for its personas, by key (`InstanceUi.avatars`); none by default. */
  readonly avatars?: Readonly<Record<string, string>>;
  /** A different Strategy Guide (its Markdown and hints) than the test world's small one. */
  readonly guide?: GuideUi;
  /** Copy words of the test's own, laid over the test world's (a marquee list). */
  readonly copy?: Partial<Kayfa['ui']['copy']>;
  /** The random function the screens draw from (`Kayfa.random`), fixed by a test that picks. */
  readonly random?: () => number;
}

/** The backend alone, for a test that must do something asynchronous (a spin) before it renders. */
export function buildWorld(settingsOverride?: Partial<ScreenSettings>, instance: Instance = testInstance): Fake {
  return createFake({ instance, settings: settingsOverride });
}

/** Render a screen on a backend made by `buildWorld`. */
export function renderIn(fake: Fake, element: ReactElement, options: WorldOptions = {}) {
  window.history.replaceState(options.state ?? null, '', options.path ?? '/');
  const kayfa: Kayfa = { api: fake, instance: options.instance ?? testInstance, ui: options.glass || options.cards || options.classLooks || options.avatars || options.guide || options.copy ? { ...ui, ...(options.copy ? { copy: { ...ui.copy, ...options.copy } } : {}), ...(options.glass ? { glass: options.glass } : {}), ...(options.cards ? { cards: options.cards } : {}), ...(options.classLooks ? { classLooks: options.classLooks } : {}), ...(options.avatars ? { avatars: options.avatars } : {}), ...(options.guide ? { guide: options.guide } : {}) } : ui, settings: { ...settings, ...options.settings } as unknown as ScreenSettings, ...(options.random ? { random: options.random } : {}) };
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
