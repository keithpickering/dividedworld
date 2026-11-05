import { expect, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Demo } from '../web/src/demo.ts';

/**
 * Every screen the glass is measured on, shared by the specs that visit them all
 * (e2e/glass-text.spec.ts reads their text, e2e/glass-layout.spec.ts their layout): the glass
 * pages, the overlays, the stories, and `open`, which brings one up ready to read.
 */
export type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo };

export interface Screen {
  readonly name: string;
  /** Where it opens: a route, a moment of the boards' fixture, or a board story. */
  readonly path: string;
  /** What a player does there to bring it up, once the page is ready. */
  readonly then?: (page: Page) => Promise<void>;
  /** It is read signed out, as a player reaches it. */
  readonly signedOut?: boolean;
}

/**
 * Every glass page: the routes web/src/App.tsx's GLASS map draws on the glass, each read in full
 * (Invites is Settings › Account, where /invites now opens). The HUD is glass on every board page:
 * it is read on the Main board's moment, where it holds the most, signed out, and with a wallet
 * past its cap, the longest its figures get.
 */
export const PAGES: readonly Screen[] = [
  { name: 'My characters', path: '/characters' },
  { name: 'New character', path: '/characters/new' },
  { name: 'Edit profile', path: '/characters/edit' },
  { name: 'Rankings', path: '/season?tab=rankings' },
  { name: 'Season news', path: '/season?tab=news' },
  { name: 'Alerts', path: '/alerts' },
  { name: 'Updates', path: '/updates' },
  { name: 'Strategy Guide', path: '/guide' },
  /* Reach a person is read signed out, as the player who cannot sign in reaches it; the demo world sets its links. */
  { name: 'Reach a person', path: '/contact', signedOut: true },
  { name: 'Welcome', path: '/welcome' },
  { name: 'My log, before anything has settled', path: '/log' },
  { name: 'The Vending Machine', path: '/vending' },
  { name: 'The hand, open', path: '/b/general', then: async (page) => { await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click(); } },
  /* The armed card, with its floating tag where the layout keeps the hand open to show it. */
  {
    name: 'The hand, with a card armed',
    path: '/b/general',
    then: async (page) => {
      await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click();
      await page.getByRole('button', { name: /^Whoops!, Salty\b/ }).first().click();
    },
  },
  { name: 'Settings', path: '/settings' },
  { name: 'Settings › Account, with the invites', path: '/settings?section=account' },
  { name: 'Sign in', path: '/sign-in', signedOut: true },
  { name: 'Register', path: '/register?invite=ab12cd34', signedOut: true },
  { name: 'The HUD, on the Main board\'s moment', path: '/?fixture=boards&moment=01-main' },
  { name: 'The HUD, signed out', path: '/b/general', signedOut: true },
  {
    name: 'The HUD, with a wallet past its cap',
    path: '/b/general',
    then: async (page) => {
      /* A full wallet puts the demo's estimate wholly past the cap; the HUD reads the wallet when the account changes, out and back in. */
      await page.waitForFunction(() => '__kbFake' in globalThis);
      await page.evaluate(() => {
        const w = globalThis as E2eWindow;
        w.__kbFake.seed.wallet(w.__kbDemo.me, 600);
        w.__kbFake.signInAs(null);
      });
      await expect(page.locator('.kb-hud-orbs')).toHaveCount(0);
      await page.evaluate(() => { const w = globalThis as E2eWindow; w.__kbFake.signInAs(w.__kbDemo.me); });
      await expect(page.locator('.kb-hud-orbs .kb-orbs-over')).toHaveText(/^\+\d\.\d\d past the cap$/u);
    },
  },
];

/** A new character waits to debut; its two debut dialogs open from its panel. */
const debut = (button: string, dialog: string) => async (page: Page) => {
  await page.getByLabel(/name/iu).first().fill('Waiting Wanda');
  await page.getByRole('radio').first().check();
  /* Drop now is the default (the onboarding plan's Task 1), so a character that waits chooses the settlement. */
  await page.getByRole('radio', { name: 'Debut at the settlement' }).check();
  await page.getByRole('button', { name: 'Make the character' }).click();
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByRole('dialog', { name: dialog })).toBeVisible();
};

/** Every glass overlay (engine/ui/glass/Overlay.tsx), opened from where a player opens it. */
export const OVERLAYS: readonly Screen[] = [
  {
    name: 'The React picker, from a post',
    path: '/b/general',
    then: async (page) => {
      await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
      await page.locator('#post-3').getByRole('button', { name: 'React' }).click();
      await expect(page.getByRole('dialog', { name: /^React to / })).toBeVisible();
    },
  },
  {
    name: 'The Turn modal, from My characters',
    path: '/characters',
    then: async (page) => {
      await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
      await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
      await expect(page.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeVisible();
    },
  },
  {
    name: 'The Reveal modal, from My characters',
    path: '/characters',
    then: async (page) => {
      await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
      await page.getByRole('button', { name: "Reveal Pipewrench's class" }).click();
      await expect(page.getByRole('dialog', { name: "Reveal Pipewrench's class" })).toBeVisible();
    },
  },
  {
    name: 'The Vending Machine\'s card info, from a slot',
    path: '/vending',
    then: async (page) => {
      await page.getByRole('button', { name: 'About Whoops!' }).click();
      await expect(page.getByRole('dialog', { name: 'Whoops!' })).toBeVisible();
    },
  },
  { name: 'The Debut dialog, dropping now', path: '/characters/new', then: debut('Drop Waiting Wanda now', 'Drop Waiting Wanda now') },
  { name: 'The Debut dialog, choosing how', path: '/characters/new', then: debut('Change how Waiting Wanda debuts', 'How Waiting Wanda debuts') },
];

/**
 * An overlay that opens on its own on the boards' fixture, whose account is the fixture's and not the demo world's: read in
 * the first run only, as the stories are (the runs below sign in as the demo's player, which this fixture has no use for).
 */
export const FIXTURE_OVERLAYS: readonly Screen[] = [
  {
    name: 'Stick Around\'s view, taking the reader over on the Hold board\'s moment',
    path: '/?fixture=boards&moment=08-hold',
    then: async (page) => { await expect(page.getByRole('dialog', { name: 'Stick Around' })).toBeVisible({ timeout: 10_000 }); },
  },
  {
    /* The Cards board's moment: the hand, the card armed, then the post's own button, which opens the form on the post. */
    name: 'The play form, on the Cards board\'s moment',
    path: '/?fixture=boards&moment=05-cards',
    then: async (page) => {
      await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click();
      await page.getByRole('button', { name: /^Whoops!, Salty\b/ }).first().click();
      await page.getByRole('button', { name: /^Play Whoops! on post \d+$/u }).last().click();
      await expect(page.getByRole('dialog', { name: 'Whoops!' })).toBeVisible();
    },
  },
];

/**
 * The log and the settlement's summary, at the Log and Settlement boards' moments, where they hold lines (the demo world's
 * log has none), and the log's breakdown open, which no board draws (its story, "12 Log, open"). The summary is the
 * `calmAll` surface: every line on it, large text too, stands in a calm. Read in the first runs only, as the overlays above
 * are. The other board stories are the boards' drawings for the board match, whose screens are read above as the app draws them.
 */
export const SETTLEMENT: Screen = { name: 'The settlement\'s summary, on the Settlement board\'s moment', path: '/?fixture=boards&moment=09-settlement' };
/** A Lens story opens its Lens on its own once the thread is read; the lines are read when it stands. */
const lensOpen = async (page: Page) => { await expect(page.getByRole('dialog', { name: 'Cards on this post' })).toBeVisible({ timeout: 15_000 }); };
export const STORIES: readonly Screen[] = [
  { name: 'My log, on the Log board\'s moment', path: '/?fixture=boards&moment=12-log' },
  SETTLEMENT,
  { name: 'My log with a settlement\'s posts open, in its story', path: '/?fixture=boards&story=boards-12-log--open' },
  /* The Lens, on each tab with Who unfolded, for a reader and for the post's author: glass type over the 2003 post. */
  { name: 'The Lens on Whoops!, Who unfolded, in its story', path: '/?fixture=boards&story=boards-01-lens--lens-whoops-who', then: lensOpen },
  { name: 'The Lens on Stick Around, Who unfolded, in its story', path: '/?fixture=boards&story=boards-01-lens--lens-stick-around-who', then: lensOpen },
  { name: 'The author\'s Lens on Whoops!, in its story', path: '/?fixture=boards&story=boards-01-lens--lens-author-whoops-who', then: lensOpen },
  /*
   * The Lens opened inside Stick Around's view (story `held-inside`) is not read here: the Lens stands over the view's tag and, at a phone,
   * over the checkbox's words, as the mockup's held shot does, and a line it covers is read through the Lens's own pixels. The view's lines are
   * read above with the Lens closed (the Hold board's moment), and the Lens's lines on the post's own page.
   */
];

/** The demo world starts signed in, and starts over on a load: sign out in the app. */
async function signOut(page: Page) {
  await page.goto('/settings?section=account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('region', { name: 'Game HUD' }).getByRole('link', { name: 'Sign in' })).toBeVisible();
}

/** Moves the app to `path` as a link does, without a load, so the signed-out session stays. */
async function goInApp(page: Page, path: string) {
  await page.evaluate((to) => { history.pushState(null, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
}

/** Opens a screen ready to read: a glass page when its menu bar shows, a board page when its HUD does, a story once rendered. */
export async function open(page: Page, s: Screen) {
  if (s.signedOut) await signOut(page);
  if (s.signedOut) await goInApp(page, s.path);
  else await page.goto(s.path);
  const ready = s.path.includes('story=')
    ? page.locator('#root > *').first()
    /* The settlement's summary has no menu bar: its heading says it is drawn. */
    : page.getByRole('navigation', { name: 'Menu' }).or(page.getByRole('region', { name: 'Game HUD' })).or(page.getByRole('heading', { level: 1, name: 'While you were away' })).first();
  await expect(ready).toBeVisible();
  await s.then?.(page);
  await page.evaluate(() => document.fonts.ready);
}

