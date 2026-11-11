import { expect, type Page } from '@playwright/test';
import type { Fake } from '../engine/ui/data/fake.ts';
import type { Demo } from '../web/src/demo.ts';
import { loadFaces } from './fonts.ts';

/**
 * Every screen the glass is measured on, shared by the specs that visit them all
 * (e2e/glass-text.spec.ts reads their text, e2e/glass-layout.spec.ts their layout): the glass
 * pages, the overlays, the stories, and `open`, which brings one up ready to read. Each `Screen` names the board it is held to
 * (e2e/boards.spec.ts checks that the id is a board's) or says why it has none; `open` takes a `Probe`, the part of a screen it needs,
 * so a spec's own one-off page needs no board.
 */
export type E2eWindow = typeof globalThis & { readonly __kbFake: Fake; readonly __kbDemo: Demo };

/** Where a screen opens and how it is brought up: all `open` needs. A spec's own probe of a screen no board holds is one. */
export interface Probe {
  readonly name: string;
  /** Where it opens: a route, a moment of the boards' fixture, or a board story. */
  readonly path: string;
  /** What a player does there to bring it up, once the page is ready. */
  readonly then?: (page: Page) => Promise<void>;
  /** It is read signed out, as a player reaches it. */
  readonly signedOut?: boolean;
  /** It is read as an admin: the demo's player is made one in the app (a load starts the demo over), then the page is moved to. */
  readonly asAdmin?: boolean;
}

/** A glass screen the specs visit, each held to a board or told why not. */
export interface Screen extends Probe {
  /**
   * The board the screen is held to (e2e/boards.spec.ts compares it, or lists it in PENDING until its task builds it), by the board's
   * id; or why it has none, a sentence. A screen held by two boards names the one its manifest compares on (a phone board is its
   * 1440 board's second comparison).
   */
  readonly board: string | { readonly none: string };
}

/**
 * Every glass page: the routes web/src/App.tsx's GLASS map draws on the glass, each read in full
 * (Invites is Settings › Account, where /invites now opens). The HUD is glass on every board page:
 * it is read on the Main board's moment, where it holds the most, signed out, and with a wallet
 * past its cap, the longest its figures get.
 */
export const PAGES: readonly Screen[] = [
  { name: 'My characters', board: '10-roster', path: '/characters' },
  { name: 'New character', board: '2026-11-05-backfill/23-new-character', path: '/characters/new' },
  { name: 'Edit profile', board: '2026-11-05-backfill/26-edit-profile', path: '/characters/edit' },
  { name: 'Rankings', board: '13-rankings', path: '/season?tab=rankings' },
  { name: 'Season news', board: '04-season-news', path: '/season?tab=news' },
  { name: 'Alerts', board: '02-alerts', path: '/alerts' },
  { name: 'Updates', board: '03-updates', path: '/updates' },
  { name: 'Strategy Guide', board: '2026-11-05-backfill/20-guide', path: '/guide' },
  /* Reach a person is read signed out, as the player who cannot sign in reaches it; the demo world sets its links. */
  { name: 'Reach a person', board: '2026-11-05-backfill/16-contact', path: '/contact', signedOut: true },
  { name: 'Welcome', board: '2026-11-05-backfill/19-welcome', path: '/welcome' },
  { name: 'My log, before anything has settled', board: '2026-11-05-backfill/30-log-empty', path: '/log' },
  { name: 'The wardrobe', board: '2026-11-04-cosmetics/02-dressup', path: '/wardrobe' },
  { name: 'The Vending Machine', board: '07-vending', path: '/vending' },
  { name: 'The hand, open', board: '05-cards', path: '/b/general', then: async (page) => { await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click(); } },
  /* The armed card, with its floating tag where the layout keeps the hand open to show it. */
  {
    name: 'The hand, with a card armed',
    board: '05-cards',
    path: '/b/general',
    then: async (page) => {
      await page.getByRole('button', { name: /^Hand, \d+ postcards?$/ }).click();
      await page.getByRole('button', { name: /^Whoops!, Salty\b/ }).first().click();
    },
  },
  { name: 'Settings', board: '11-settings', path: '/settings' },
  /* The admin queue, with the form for how players reach the admins (AdminContact), read as an admin. */
  { name: 'The admin queue', board: '2026-11-05-backfill/37-admin-queue', path: '/admin/queue', asAdmin: true },
  /* The machine's admin page, read as an admin: the strip under its lead, the slots, one Save changes. */
  { name: 'The machine\'s admin page', board: '2026-11-07-booster-packs/05-admin', path: '/admin/machine', asAdmin: true },
  /* The trophies and gear admin page, read as an admin: the strip, the three forms, the recent awards and the failures. Its board is still pending (the cosmetics plan, Task 11 builds the page; the manifest follows). */
  { name: 'The trophies admin page', board: '2026-11-04-cosmetics/05-admin', path: '/admin/trophies', asAdmin: true },
  /* Updates as an admin with Write an update open, and its preview of what everyone will see. */
  {
    name: 'Updates, with Write an update open', board: '2026-11-05-backfill/38-write-update', path: '/updates', asAdmin: true,
    then: async (page) => { await page.getByRole('button', { name: 'Write an update' }).click(); await expect(page.getByRole('form', { name: 'Write an update' })).toBeVisible(); },
  },
  { name: 'Settings › The board', board: '2026-11-06-board-look/19-theme-picker', path: '/settings?section=board' },
  { name: 'Settings › Account, with the invites', board: '2026-11-05-backfill/33-settings-account', path: '/settings?section=account' },
  { name: 'Sign in', board: '2026-11-05-backfill/14-sign-in', path: '/sign-in', signedOut: true },
  { name: 'Register', board: '2026-11-05-backfill/15-register', path: '/register?invite=ab12cd34', signedOut: true },
  { name: 'The HUD, on the Main board\'s moment', board: '01-main', path: '/?fixture=boards&moment=01-main' },
  { name: 'The HUD, signed out', board: '2026-11-05-backfill/17-front-door', path: '/b/general', signedOut: true },
  {
    name: 'The HUD, with a wallet past its cap',
    board: '2026-11-05-backfill/35-hud-cap',
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
      await expect(page.locator('.kb-hud-orbs .kb-orbs-over')).toHaveText(/^\+\d\.\d\d est\. past the cap$/u);
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
    board: '03-react',
    path: '/b/general',
    then: async (page) => {
      await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
      await page.locator('#post-3').getByRole('button', { name: 'React' }).click();
      await expect(page.getByRole('dialog', { name: /^React to / })).toBeVisible();
    },
  },
  {
    name: 'The Turn modal, from My characters',
    board: '06-turn',
    path: '/characters',
    then: async (page) => {
      await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
      await page.getByRole('button', { name: 'Turn Pipewrench' }).click();
      await expect(page.getByRole('dialog', { name: 'Turn Pipewrench' })).toBeVisible();
    },
  },
  {
    name: 'The Reveal modal, from My characters',
    board: '2026-11-05-backfill/25-reveal',
    path: '/characters',
    then: async (page) => {
      await page.getByRole('tablist', { name: /^Roster, /u }).getByRole('tab', { name: /^Pipewrench/u }).click();
      await page.getByRole('button', { name: "Reveal Pipewrench's class" }).click();
      await expect(page.getByRole('dialog', { name: "Reveal Pipewrench's class" })).toBeVisible();
    },
  },
  {
    name: 'The Vending Machine\'s card info, from a slot',
    board: '2026-11-05-backfill/34-vending-info',
    path: '/vending',
    then: async (page) => {
      await page.getByRole('button', { name: 'About Whoops!' }).click();
      await expect(page.getByRole('dialog', { name: 'Whoops!' })).toBeVisible();
    },
  },
  { name: 'The Debut dialog, dropping now', board: '2026-11-05-backfill/40-debut-now', path: '/characters/new', then: debut('Drop Waiting Wanda now', 'Drop Waiting Wanda now') },
  { name: 'The Debut dialog, choosing how', board: '2026-11-05-backfill/24-debut', path: '/characters/new', then: debut('Change how Waiting Wanda debuts', 'How Waiting Wanda debuts') },
];

/**
 * An overlay that opens on its own on the boards' fixture, whose account is the fixture's and not the demo world's: read in
 * the first run only, as the stories are (the runs below sign in as the demo's player, which this fixture has no use for).
 */
export const FIXTURE_OVERLAYS: readonly Screen[] = [
  {
    name: 'Stick Around\'s view, taking the reader over on the Hold board\'s moment',
    board: '08-hold',
    path: '/?fixture=boards&moment=08-hold',
    then: async (page) => { await expect(page.getByRole('dialog', { name: 'Stick Around' })).toBeVisible({ timeout: 10_000 }); },
  },
  {
    /* The Cards board's moment: the hand, the card armed, then the post's own button, which opens the form on the post. */
    name: 'The play form, on the Cards board\'s moment',
    board: '05-cards',
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
export const SETTLEMENT: Screen = { name: 'The settlement\'s summary, on the Settlement board\'s moment', board: '09-settlement', path: '/?fixture=boards&moment=09-settlement' };
/** A Lens story opens its Lens on its own once the thread is read; the lines are read when it stands. */
/* The Lens opens over a post whose card effects load on first use (instances/divided-world/ui/cards.ts); its text is read once they have landed, as the page behind it is then what the reader sees. */
const lensOpen = async (page: Page) => { await expect(page.getByRole('dialog', { name: 'Cards on this post' })).toBeVisible({ timeout: 15_000 }); await page.waitForLoadState('networkidle'); };
export const STORIES: readonly Screen[] = [
  { name: 'My log, on the Log board\'s moment', board: '12-log', path: '/?fixture=boards&moment=12-log' },
  SETTLEMENT,
  { name: 'My log before anything has settled, in its story', board: '2026-11-05-backfill/30-log-empty', path: '/?fixture=boards&story=boards-12-log--empty' },
  { name: 'My log with a settlement\'s posts open, in its story', board: '2026-11-05-backfill/31-log-open', path: '/?fixture=boards&story=boards-12-log--open' },
  /* The booster packs boards' story (engine/ui/vending/Packs.board.stories.tsx): the machine with the Booster picked. The reveal is not read here: it is a window-wide dark layer over the machine with no smoke under its words, and these read glass text on smoke; the board match and a11y read it. */
  { name: 'The machine with a Booster picked, in its story', board: '2026-11-07-booster-packs/01-machine', path: '/?fixture=boards&story=boards-booster-packs--machine', then: async (page) => { await page.getByRole('button', { name: /^Buy Booster, / }).click(); } },
  /* The Lens, on each tab with Who unfolded, for a reader and for the post's author: glass type over the 2003 post. */
  { name: 'The Lens on Whoops!, Who unfolded, in its story', board: '2026-11-05-backfill/28-lens', path: '/?fixture=boards&story=boards-01-lens--lens-whoops-who', then: lensOpen },
  /* Five kinds on the post (Whoops!, Stick Around, Glitter Bomb, Autocorrect, Force Field): the tab strip scrolls, and board 28's manifest holds it. */
  { name: 'The Lens with five kinds, its tabs one row that scrolls, in its story', board: '2026-11-05-backfill/28-lens', path: '/?fixture=boards&story=boards-01-lens--five-kinds', then: lensOpen },
  { name: 'The Lens on Stick Around, Who unfolded, in its story', board: '2026-11-05-backfill/29-lens-states', path: '/?fixture=boards&story=boards-01-lens--lens-stick-around-who', then: lensOpen },
  { name: 'The author\'s Lens on Whoops!, in its story', board: '2026-11-05-backfill/29-lens-states', path: '/?fixture=boards&story=boards-01-lens--lens-author-whoops-who', then: lensOpen },
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

/** The demo world's player becomes an admin, in the app, from a page the admin does not need (the queue itself is moved to after). */
async function makeAdmin(page: Page) {
  await page.goto('/settings');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  await page.evaluate(() => { const w = globalThis as E2eWindow; w.__kbFake.seed.admin(w.__kbDemo.me, true); });
  /* Boot (and with it the admin flag every screen and the menu take from it) was read before the flag was seeded, and is read once per account
     (engine/ui/boot.tsx): out and back in as the same player reads it afresh, as the HUD's wallet screen does. */
  await page.evaluate(() => { const w = globalThis as E2eWindow; w.__kbFake.signInAs(null); });
  await expect(page.getByRole('main').getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.evaluate(() => { const w = globalThis as E2eWindow; w.__kbFake.signInAs(w.__kbDemo.me); });
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
}

/** Opens a screen ready to read: a glass page when its menu bar shows, a board page when its HUD does, a story once rendered. */
export async function open(page: Page, s: Probe) {
  if (s.signedOut) await signOut(page);
  if (s.asAdmin) await makeAdmin(page);
  if (s.signedOut || s.asAdmin) await goInApp(page, s.path);
  else await page.goto(s.path);
  const ready = s.path.includes('story=')
    ? page.locator('#root > *').first()
    /* The settlement's summary has no menu bar: its heading says it is drawn. */
    : page.getByRole('navigation', { name: 'Menu' }).or(page.getByRole('region', { name: 'Game HUD' })).or(page.getByRole('heading', { level: 1, name: 'While you were away' })).first();
  await expect(ready).toBeVisible();
  await s.then?.(page);
  /*
   * The screen is drawn, not only its frame: a glass screen loads on first use (web/src/App.tsx), and one that reads its data says
   * so with aria-busy until it lands (My characters, until the player is read). What lands can move the page: the roster opens on
   * the chosen character and scrolls it into view, 343px down at 200% text on a phone, under a measure that had already begun.
   */
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await loadFaces(page);
}

