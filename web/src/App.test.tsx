import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createFake } from '../../engine/ui/data/fake.ts';
import { instance } from '../../instances/divided-world/index.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';
import { App, ESTIMATE_WAIT_MS, NO_MENU } from './App.tsx';
import { startLoad } from '../../engine/ui/log/Settlement.tsx';
import { seedDemo } from './demo.ts';
import { seedMoves } from '../../engine/ui/board/move-world.ts';
import { fallbackSettings } from './data/settings.ts';
import { light } from '../../engine/ui/shine/light.ts';
import { resetTilt, tiltState } from '../../engine/ui/shine/tilt.ts';

/* The demo keeps a player's preferences in session storage (web/src/demo.ts): one test's must not be the next one's account's. */
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); window.history.pushState(null, '', '/'); });
afterEach(() => { vi.restoreAllMocks(); });

/*
 * A glass screen loads on first use, inside the glass page that is already drawn (its menu bar and smoke). Until it lands the page
 * says it is loading: a reader is told, and nothing reads the empty page as the screen. First in this file, so the screen's chunk
 * has not been loaded by an earlier test.
 */
test('a glass screen that has not landed yet leaves its page marked busy', async () => {
  window.history.pushState(null, '', '/updates');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  const bare: string[] = [];
  const watch = new MutationObserver(() => {
    const menu = document.querySelector('nav[aria-label="Menu"]');
    if (menu && !document.querySelector('main h1') && !document.querySelector('[aria-busy="true"]')) bare.push(document.body.innerHTML.slice(0, 200));
  });
  watch.observe(document.body, { childList: true, subtree: true, attributes: true });
  render(<App api={fake} />);
  await screen.findByRole('heading', { level: 1, name: /Updates/u });
  watch.disconnect();
  expect(bare).toEqual([]);
});

test('the app runs on the demo world: the frame, the HUD with its character and orbs', async () => {
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const hud = await screen.findByRole('region', { name: 'Game HUD' });
  await waitFor(() => expect(within(hud).getByRole('combobox', { name: 'Swap mask' })).toBeInTheDocument());
  await waitFor(() => expect(within(hud).getByRole('img', { name: /^Wallet 2\.40 of 6 orbs, 0\.85 pending/ })).toBeInTheDocument());
  expect(screen.getByRole('banner')).toHaveTextContent('Divided World');
});

test('signing out puts the page back to the device\'s look', async () => {
  document.documentElement.removeAttribute('data-kb-mode');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  await fake.setPreferences({ theme: 'dark' });
  render(<App api={fake} />);
  await waitFor(() => expect(document.documentElement.getAttribute('data-kb-mode')).toBe('dark'));
  await fake.signOut();
  await waitFor(() => expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false));
  expect(await within(await screen.findByRole('region', { name: 'Game HUD' })).findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
});

/*
 * A device shared by two players: the session changes under an open screen (another tab signed the
 * other in), and nothing the last account typed or was told stays on the screen for the next one.
 * Each signed-in screen starts afresh for the account signed in now.
 */
test('another account signing in starts the open screen afresh: the last account\'s draft is not left for the next', async () => {
  window.history.pushState(null, '', '/characters/new');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const field = await screen.findByRole('textbox', { name: /name/iu });
  await userEvent.click(field);
  await userEvent.paste('Zzyzx the Draft');
  expect(field).toHaveValue('Zzyzx the Draft');
  fake.signInAs(fake.seed.account('next'));
  await waitFor(() => expect(screen.getByRole('textbox', { name: /name/iu })).not.toHaveValue('Zzyzx the Draft'));
  expect(screen.queryByDisplayValue('Zzyzx the Draft')).toBeNull();
}, 15_000);

test('another account signing in starts the open screen afresh: the last account\'s flash is not left for the next', async () => {
  window.history.pushState(null, '', '/characters');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  const pipe = (await fake.myCharacters()).find((c) => c.name === 'Pipewrench')!;
  await fake.turn(pipe.id, instance.classes.find((c) => c.key !== pipe.class)!.key, 'announced', false, false);
  render(<App api={fake} />);
  await userEvent.click(await screen.findByRole('tab', { name: /^Pipewrench/u }));
  await userEvent.click(await screen.findByRole('button', { name: 'Withdraw Pipewrench\'s Turn' }));
  expect(await screen.findByText('Pipewrench\'s Turn is withdrawn.')).toBeInTheDocument();
  fake.signInAs(fake.seed.account('next'));
  /* The next account's roster loaded and settled: the flash is gone then, not only for a commit. */
  await screen.findByRole('heading', { level: 1, name: /^Your characters/u });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText('Pipewrench\'s Turn is withdrawn.')).toBeNull();
}, 15_000);

/*
 * What the player's provider holds is the account's it was read for: in the very commit the account
 * becomes known, or changes, nothing read for another account (or for none) shows, so a signed-in
 * load never flashes the empty roster (the next player never seeing the last one's HUD is held in
 * engine/ui/player.test.tsx, where every commit is read).
 */
function watchText(text: RegExp): { seen: () => boolean; stop: () => void } {
  /*
   * Every commit's words, including the ones a later commit took back: a node added and removed
   * again is in its records' removed nodes with its words, and changed words keep their old value,
   * so a commit that showed the words for a moment is seen even when the test's act() ran the next
   * commit before the observer was told.
   */
  let seen = false;
  const has = (t: string | null | undefined) => { if (t && text.test(t)) seen = true; };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => has(n.textContent));
      r.removedNodes.forEach((n) => has(n.textContent));
      has(r.oldValue);
      if (r.type === 'characterData') has(r.target.textContent);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
  return { seen: () => { has(document.body.textContent); observer.takeRecords().forEach((r) => { r.addedNodes.forEach((n) => has(n.textContent)); r.removedNodes.forEach((n) => has(n.textContent)); has(r.oldValue); }); return seen; }, stop: () => observer.disconnect() };
}

for (const path of ['/characters', '/characters/edit']) {
  test(`a signed-in load of ${path} never shows "You have no characters yet"`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    const empty = watchText(/You have no characters yet/u);
    render(<App api={fake} />);
    await screen.findByRole('heading', { level: 1, name: path === '/characters' ? /^Your characters/u : /^Edit /u });
    await new Promise((r) => setTimeout(r, 50));
    empty.stop();
    expect(empty.seen()).toBe(false);
  });
}

test('a signed-in load of /characters asks for the next settlement once', async () => {
  window.history.pushState(null, '', '/characters');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  const asked = vi.spyOn(fake, 'nextSettlementAt');
  render(<App api={fake} />);
  await screen.findByRole('heading', { level: 1, name: /^Your characters/u });
  await waitFor(() => expect(asked).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
  expect(asked).toHaveBeenCalledTimes(1);
});

test('a signed-in page load mounts its screen once: each of its reads is asked once, not again when the session becomes known', async () => {
  window.history.pushState(null, '', '/standings');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  const asked = vi.spyOn(fake, 'standingsPage');
  render(<App api={fake} />);
  await screen.findByRole('heading', { level: 1 });
  await waitFor(() => expect(asked).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 50));
  expect(asked).toHaveBeenCalledTimes(1);
});

test('another account signing in takes the last account\'s look off the page, and keeps the device\'s if its own cannot be read', async () => {
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  await fake.setPreferences({ textSize: 200, contrast: 'high' });
  render(<App api={fake} />);
  await waitFor(() => expect(document.documentElement).toHaveAttribute('data-kb-text-size', '200'));
  fake.preferences = () => Promise.reject(new Error('no answer came back'));
  fake.signInAs(fake.seed.account('next'));
  await waitFor(() => expect(document.documentElement).not.toHaveAttribute('data-kb-text-size'));
  expect(document.documentElement).not.toHaveAttribute('data-kb-contrast');
}, 15_000);

test('the instance\'s glass is on the page: its standard key on the root, and its fonts in the font set', async () => {
  /* jsdom has no font set and no FontFace; the browser's are stood in for, as far as the app reaches. */
  const fonts = new Set<{ family: string }>();
  Object.defineProperty(document, 'fonts', { value: fonts, configurable: true });
  vi.stubGlobal('FontFace', class { constructor(readonly family: string) {} });
  try {
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    await screen.findByRole('region', { name: 'Game HUD' });
    expect(document.documentElement.getAttribute('data-kb-glass-key')).toBe('standard');
    expect(document.documentElement.style.getPropertyValue('--kb-glass-ground')).toBe('#07050d');
    expect([...fonts].map((f) => f.family)).toContain('Anton');
  } finally {
    vi.unstubAllGlobals();
    delete (document as { fonts?: unknown }).fonts;
  }
});

/* Each glass route and what only its own screen shows, so the wrapped content is that screen's, unchanged. */
const OWN: readonly [string, () => HTMLElement][] = [
  ['/characters', () => screen.getByRole('heading', { level: 1, name: /^Your characters \(/ })],
  ['/characters/new', () => screen.getByRole('button', { name: 'Make the character' })],
  ['/characters/edit', () => screen.getByRole('heading', { level: 1, name: /^Edit / })],
  ['/settings', () => screen.getByRole('radiogroup', { name: 'Smoke' })],
  ['/season', () => screen.getByRole('heading', { level: 1, name: /^Season/u })],
  ['/log', () => screen.getByRole('heading', { level: 1, name: 'My log' })],
];

for (const [path, own] of OWN) {
  test(`${path} is a glass page: the menu bar and no banner or HUD, its own screen's content inside`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    expect(await screen.findByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
    /* A screen may swap its loading content for its own; what holds is that its own is there, in main. */
    await waitFor(() => expect(within(screen.getByRole('main')).getByText((_, el) => el === own())).toBeInTheDocument());
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Game HUD' })).toBeNull();
  });
}

/* The glass build's Tasks 2.2 and 2.4 restyle the characters pages and Settings: drawn on the glass, with no board panel. */
for (const path of ['/characters', '/characters/new', '/characters/edit', '/settings'] as const) {
  test(`${path} is drawn on the glass, with no board panel`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    await screen.findByRole('navigation', { name: 'Menu' });
    expect(document.querySelector('.kb-glass-content-panel')).toBeNull();
  });
}

/* The bar's tabs come once the session is read, which a page drawn signed out (Season) can beat, so a test that reads a tab finds it. */
test('/season is drawn on the glass with no board panel, and its menu bar tab is the current page', async () => {
  window.history.pushState(null, '', '/season');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const bar = await screen.findByRole('navigation', { name: 'Menu' });
  await screen.findByRole('heading', { level: 1, name: /^Season/u });
  expect(screen.getByRole('main').querySelector('.kb-glass-content-panel')).toBeNull();
  expect(screen.getByRole('main').closest('[data-kb-surface]')).toHaveAttribute('data-kb-surface', 'rankings');
  expect(await within(bar).findByRole('link', { name: 'Season' })).toHaveAttribute('aria-current', 'page');
});

/* The old addresses open the season page's Rankings tab in their place (the alerts design, section 7); a page asked for goes with them. */
for (const [from, to] of [['/rankings', '/season?tab=rankings'], ['/standings', '/season?tab=rankings'], ['/rankings?page=2', '/season?tab=rankings&page=2'], ['/standings?page=3', '/season?tab=rankings&page=3']] as const) {
  test(`${from} goes to ${to}, on the glass, and Back does not return to it`, async () => {
    window.history.pushState(null, '', from);
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    render(<App api={fake} />);
    const bar = await screen.findByRole('navigation', { name: 'Menu' });
    await screen.findByRole('heading', { level: 1, name: /^Season/u });
    await waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe(to));
    expect(screen.getByRole('tab', { name: 'Rankings' })).toHaveAttribute('aria-selected', 'true');
    expect(await within(bar).findByRole('link', { name: 'Season' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('banner')).toBeNull();
  });
}

test('/log stands on the log\'s smoke, and its menu bar tab is the current page', async () => {
  window.history.pushState(null, '', '/log');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const bar = await screen.findByRole('navigation', { name: 'Menu' });
  await screen.findByRole('heading', { level: 1, name: 'My log' });
  expect(screen.getByRole('main').closest('[data-kb-surface]')).toHaveAttribute('data-kb-surface', 'log');
  expect(await within(bar).findByRole('link', { name: 'My log' })).toHaveAttribute('aria-current', 'page');
});

/** A demo world with a settlement of the player's own just made, as a board load after it meets it. */
async function settledWorld() {
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  const [mine] = await fake.myCharacters();
  fake.seed.settle({ at: fake.clock.now(), debut: false, turns: false, ledger: [{ character: mine!.id, reason: 'heel.drewHeat', amount: 20 }] });
  return fake;
}

test('the first load of a board page after a settlement opens its summary, a glass page with no menu bar, once', async () => {
  const fake = await settledWorld();
  const view = render(<App api={fake} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'While you were away' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/log/settlement');
  expect(screen.getByRole('main').closest('[data-kb-surface]')).toHaveAttribute('data-kb-surface', 'settlement');
  expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Game HUD' })).toBeNull();
  view.unmount();
  /* A new page load, on the same backend's data: only the device's mark keeps it from opening again. */
  startLoad();
  window.history.pushState(null, '', '/');
  render(<App api={fake} />);
  await screen.findByRole('region', { name: 'Game HUD' });
  await new Promise((r) => setTimeout(r, 30));
  expect(window.location.pathname).toBe('/');
});

test('a load of a glass page after a settlement is not taken over by the summary, nor is a move to the board after it', async () => {
  window.history.pushState(null, '', '/settings');
  const fake = await settledWorld();
  render(<App api={fake} />);
  await screen.findByRole('radiogroup', { name: 'Smoke' });
  await new Promise((r) => setTimeout(r, 30));
  expect(window.location.pathname).toBe('/settings');
  /* Back to the board, in the same load: the summary is the first load's, and this load's was a glass page. */
  await userEvent.click(screen.getByRole('link', { name: 'Back to the board' }));
  await screen.findByRole('region', { name: 'Game HUD' });
  await new Promise((r) => setTimeout(r, 30));
  expect(window.location.pathname).toBe('/');
});

for (const path of ['/sign-in', '/register']) {
  test(`${path}, signed out, is a glass page with Back to the board alone`, async () => {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    render(<App api={fake} />);
    const bar = await screen.findByRole('navigation', { name: 'Menu' });
    await waitFor(() => expect(within(bar).getAllByRole('link').map((a) => a.textContent)).toEqual(['Back to the board']));
    expect(screen.queryByRole('banner')).toBeNull();
  });
}

test('/contact, signed out, is a glass page on the settings smoke that shows the admins\' links', async () => {
  window.history.pushState(null, '', '/contact');
  const fake = createFake({ instance, settings: fallbackSettings });
  fake.seed.contact([{ label: 'Email', href: 'admin@example.test' }]);
  render(<App api={fake} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Reach a person' })).toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'admin@example.test' })).toHaveAttribute('href', 'mailto:admin@example.test');
  expect(screen.queryByRole('banner')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Game HUD' })).toBeNull();
  expect(document.querySelector('.kb-glass-content-panel')).toBeNull();
  await userEvent.click(within(await screen.findByRole('navigation', { name: 'Menu' })).getByRole('link', { name: 'Back to the board' }));
  expect(window.location.pathname).toBe('/');
});

test('/invites opens Settings › Account, where invites now live, and keeps the address working', async () => {
  window.history.pushState(null, '', '/invites');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  expect(await screen.findByRole('heading', { level: 2, name: 'Account' })).toBeInTheDocument();
  expect(window.location.pathname + window.location.search).toBe('/settings?section=account');
  expect(await screen.findByRole('button', { name: 'Make an invite' })).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
});

test('the restyled account screens draw on the glass itself, with no board panel', async () => {
  for (const path of ['/settings', '/sign-in', '/register']) {
    window.history.pushState(null, '', path);
    const fake = createFake({ instance, settings: fallbackSettings });
    if (path === '/settings') seedDemo(fake);
    const view = render(<App api={fake} />);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(document.querySelector('.kb-glass-content-panel'), path).toBeNull();
    view.unmount();
  }
});

test('the account\'s glass preferences are applied as the app loads them: smoke, the high key and the text size', async () => {
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  await fake.setPreferences({ smoke: 'off', contrast: 'high', textSize: 200 });
  render(<App api={fake} />);
  const root = document.documentElement;
  await waitFor(() => expect(root).toHaveAttribute('data-kb-glass-key', 'high'));
  expect(root).toHaveAttribute('data-kb-smoke-level', 'off');
  expect(root).toHaveAttribute('data-kb-contrast', 'high');
  expect(root).toHaveAttribute('data-kb-text-size', '200');
  expect(root.style.getPropertyValue('--kb-glass-text')).toBe(instanceUi.glass.keys.high['--kb-glass-text']!.value);
  /* The Game HUD's own smoke follows the preference: none drawn. */
  const hud = await screen.findByRole('region', { name: 'Game HUD' });
  await waitFor(() => expect(hud.querySelector('[data-kb-smoke]')).toBeNull());
  await fake.signOut();
  await waitFor(() => expect(root).toHaveAttribute('data-kb-glass-key', 'standard'));
  expect(root).not.toHaveAttribute('data-kb-text-size');
});

test('the account\'s tilt choice reaches the light wherever the app is, and goes when the account does', async () => {
  vi.stubGlobal('DeviceOrientationEvent', function DeviceOrientationEvent() {});
  resetTilt();
  try {
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    await fake.setPreferences({ tilt: 'on' });
    expect(tiltState()).toBe('off');
    render(<App api={fake} />);
    await waitFor(() => expect(tiltState()).toBe('on'));
    expect(light.input().tilt).toBe(true);
    await fake.signOut();
    await waitFor(() => expect(tiltState()).toBe('off'));
    expect(light.input().tilt).toBe(false);
  } finally { vi.unstubAllGlobals(); resetTilt(); }
});

/* A glass page has no frame and so no tips provider, whose own read of the preferences would hand the tilt over on the board's pages: here the
 * app's own appearance is what hands it over, from boot when the page loaded with boot. */
test('the account\'s tilt choice reaches the light on a glass page, from boot', async () => {
  vi.stubGlobal('DeviceOrientationEvent', function DeviceOrientationEvent() {});
  resetTilt();
  try {
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    await fake.setPreferences({ tilt: 'on' });
    const boot = vi.spyOn(fake, 'boot');
    window.history.pushState(null, '', '/log');
    render(<App api={fake} />);
    await waitFor(() => expect(boot).toHaveBeenCalled());
    await waitFor(() => expect(tiltState()).toBe('on'));
    expect(light.input().tilt).toBe(true);
  } finally { vi.unstubAllGlobals(); resetTilt(); }
});

/*
 * A page drawn with no menu bar has no bar's Back, and a touch screen has no Esc: every state of every such page carries
 * Back to the board itself (#90). The set is read from the app, so a page added to it is held here too.
 */
const STATES: readonly [string, (fake: ReturnType<typeof createFake>) => void][] = [
  ['loading', (fake) => { seedDemo(fake); vi.spyOn(fake, 'log').mockReturnValue(new Promise(() => {})); }],
  ['failed', (fake) => { seedDemo(fake); vi.spyOn(fake, 'log').mockRejectedValue(new Error('down')); }],
  ['empty', (fake) => { const me = fake.seed.account('me'); fake.seed.character(me, 'Pipewrench', 'heel'); fake.signInAs(me); }],
  ['signed out', () => {}],
];

for (const path of NO_MENU) {
  for (const [state, make] of STATES) {
    test(`${path}, ${state}, has Back to the board`, async () => {
      window.history.pushState(null, '', path);
      const fake = createFake({ instance, settings: fallbackSettings });
      make(fake);
      render(<App api={fake} />);
      await screen.findByRole('main');
      /* Every page passes through loading first: each state is waited for itself, so loading's link cannot answer for it. */
      if (state === 'loading') await waitFor(() => expect(document.querySelector('main [aria-busy="true"]')).not.toBeNull());
      else await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
      const back = await screen.findByRole('link', { name: 'Back to the board' });
      expect(back.closest('[aria-busy="true"]')).toBeNull();
      expect(back).toHaveAttribute('href', '/');
      expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull();
    }, 15_000);
  }
}

test('the admin queue is a glass page at /admin/queue, with the ADMIN tab on the menu, for an admin', async () => {
  window.history.pushState(null, '', '/admin/queue');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedMoves(fake, instance, { signIn: 'admin' });
  render(<App api={fake} />);
  expect(await screen.findByRole('heading', { level: 1, name: 'The System\'s moves' })).toBeInTheDocument();
  expect(await within(screen.getByRole('navigation', { name: 'Menu' })).findByRole('link', { name: 'Admin' })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByRole('region', { name: /^Waiting to land/u })).toBeInTheDocument();
});

test('a player has no ADMIN tab and is told the queue is for admins', async () => {
  window.history.pushState(null, '', '/admin/queue');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedMoves(fake, instance, { signIn: 'player' });
  render(<App api={fake} />);
  expect(await screen.findByText('The admin queue is for admins.')).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Menu' })).queryByRole('link', { name: 'Admin' })).toBeNull();
});

/*
 * The welcome (the onboarding plan's Task 7): the session listener sends a signed-in account with no welcomedAt and no character at all to
 * /welcome from a board page, once; the sign-in pages and the glass pages are let through, and an account with any character is never sent.
 */
describe('the welcome', () => {
  type Fake = ReturnType<typeof createFake>;
  /**
   * Count the reads `SendToWelcome` makes (and the player's own, which come first) as they settle, so a test waits for the answer it is
   * about and then looks at the page, instead of waiting a while and finding nothing. `hold` makes one read wait to be released.
   */
  function watchReads(fake: Fake, how: { readonly characters?: (call: number, real: () => ReturnType<Fake['myCharacters']>) => ReturnType<Fake['myCharacters']>; readonly preferences?: (call: number, real: () => ReturnType<Fake['preferences']>) => ReturnType<Fake['preferences']> } = {}) {
    const seen = { characters: 0, preferences: 0, settledCharacters: 0, settledPreferences: 0 };
    const realCharacters = fake.myCharacters.bind(fake);
    const realPreferences = fake.preferences.bind(fake);
    vi.spyOn(fake, 'myCharacters').mockImplementation(async () => {
      const call = ++seen.characters;
      try { return await (how.characters ? how.characters(call, realCharacters) : realCharacters()); } finally { seen.settledCharacters += 1; }
    });
    vi.spyOn(fake, 'preferences').mockImplementation(async () => {
      const call = ++seen.preferences;
      try { return await (how.preferences ? how.preferences(call, realPreferences) : realPreferences()); } finally { seen.settledPreferences += 1; }
    });
    return seen;
  }
  /** Let what the settled reads set going run to its end: every microtask, then a render. */
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const move = (path: string) => act(() => { window.history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')); });

  /** An account the invite opened just now, on a board page: the state `openAccount` leaves. */
  async function newAccount() {
    const fake = createFake({ instance, settings: { ...fallbackSettings, registrationMode: 'invite' } });
    fake.signInAs(fake.seed.account('host'));
    const invite = await fake.createInvite();
    if (!invite.ok) throw new Error('the host could not invite');
    fake.signInAs(null);
    await fake.requestCode('new@example.test', null);
    await fake.verifyCode('new@example.test', '123456');
    window.history.pushState(null, '', '/');
    return { fake, code: invite.value.code };
  }

  test('a new account lands on /welcome after openAccount, and the page marks the welcome seen', async () => {
    const { fake, code } = await newAccount();
    render(<App api={fake} />);
    expect(await screen.findByRole('heading', { level: 2, name: 'You are signed in, with no account yet' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    await fake.openAccount(code);
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/welcome');
    expect(screen.getByRole('heading', { level: 2, name: 'After nine years of development' })).toBeInTheDocument();
    await waitFor(async () => expect((await fake.preferences()).welcomedAt).not.toBeNull());
  });

  test('changing motion there changes the account\'s preferences, and the button opens New character', async () => {
    const { fake, code } = await newAccount();
    render(<App api={fake} />);
    await screen.findByRole('heading', { level: 2, name: 'You are signed in, with no account yet' });
    await fake.openAccount(code);
    const before = await screen.findByRole('region', { name: 'Before you start' });
    await userEvent.click(await within(before).findByRole('radio', { name: 'Reduced' }));
    await waitFor(async () => expect((await fake.preferences()).motion).toBe('reduce'));
    await userEvent.click(screen.getByRole('link', { name: 'Make your first character' }));
    expect(await screen.findByRole('textbox', { name: /name/iu })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/characters/new');
  });

  test('a second visit to the board goes nowhere: the welcome shows once', async () => {
    const { fake, code } = await newAccount();
    render(<App api={fake} />);
    await screen.findByRole('heading', { level: 2, name: 'You are signed in, with no account yet' });
    await fake.openAccount(code);
    await screen.findByRole('heading', { level: 1, name: 'Welcome' });
    await waitFor(async () => expect((await fake.preferences()).welcomedAt).not.toBeNull());
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('link', { name: 'Back to the board' }));
    await screen.findByRole('region', { name: 'Game HUD' });
    expect(window.location.pathname).not.toBe('/welcome');
    /* It has decided for this account; going to another board page asks nothing and sends nobody. */
    const asked = vi.spyOn(fake, 'preferences');
    await userEvent.click(within(screen.getByRole('banner')).getAllByRole('link')[0]!);
    await screen.findByRole('region', { name: 'Game HUD' });
    await flush();
    expect(asked).not.toHaveBeenCalled();
    expect(window.location.pathname).not.toBe('/welcome');
  });

  test('a load of the board by an account that has seen the welcome and has no character goes nowhere, and asks for nothing but boot', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    fake.signInAs(fake.seed.account('seen'));
    await fake.seeWelcome();
    const seen = watchReads(fake);
    render(<App api={fake} />);
    await screen.findByRole('region', { name: 'Game HUD' });
    await flush();
    expect(window.location.pathname).toBe('/');
    /* The sender decides from boot's preferences and roster: it reads neither again. */
    expect(seen.characters).toBe(0);
    expect(seen.preferences).toBe(0);
  });

  test('a boot that fails sends nobody: the page cannot be displayed, with the way to try again', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    fake.signInAs(fake.seed.account('unread'));
    vi.spyOn(fake, 'boot').mockRejectedValue(new Error('down'));
    render(<App api={fake} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'The page cannot be displayed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await flush();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('heading', { level: 1, name: 'Welcome' })).toBeNull();
  });

  test('a player whose roster boot brought, with a character, is not sent, and the roster is not read again', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    const me = fake.seed.account('veteran');
    fake.seed.character(me, 'Old Hand', 'heel');
    fake.signInAs(me);
    const seen = watchReads(fake);
    render(<App api={fake} />);
    await screen.findByRole('region', { name: 'Game HUD' });
    await flush();
    expect((await fake.preferences()).welcomedAt).toBeNull();
    expect(seen.characters).toBe(0);
    expect(window.location.pathname).toBe('/');
  });

  test('a sign-in on the page, before boot is read again, reads for itself; an answer that arrives after the player opened Settings does not pull them away from it', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    const quick = fake.seed.account('quick');
    /* The page loads signed out (boot is not asked), then the account signs in; boot cannot be read, so the sender reads the roster itself. */
    vi.spyOn(fake, 'boot').mockRejectedValue(new Error('down'));
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => { release = r; });
    const seen = watchReads(fake, { characters: async (call, real) => { if (call >= 2) await held; return real(); } });
    render(<App api={fake} />);
    await screen.findByRole('region', { name: 'Game HUD' });
    act(() => { fake.signInAs(quick); });
    await waitFor(() => expect(seen.characters).toBeGreaterThanOrEqual(2));
    await move('/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    release();
    await waitFor(() => expect(seen.settledCharacters).toBeGreaterThanOrEqual(2));
    await flush();
    expect(window.location.pathname).toBe('/settings');
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });

  test('an account with a character is never sent there, though it has not seen the welcome; one with only a waiting or a retired character is not either', async () => {
    for (const options of [{}, { debuted: false }, { retired: true }]) {
      cleanup();
      window.history.pushState(null, '', '/');
      const fake = createFake({ instance, settings: fallbackSettings });
      const me = fake.seed.account('veteran');
      fake.seed.character(me, 'Old Hand', 'heel', options);
      fake.signInAs(me);
      expect((await fake.preferences()).welcomedAt).toBeNull();
      /* It reads nothing for an account that has a character: boot's roster is the only one. */
      const seen = watchReads(fake);
      render(<App api={fake} />);
      await screen.findByRole('region', { name: 'Game HUD' });
      await flush();
      expect(seen.characters).toBe(0);
      expect(window.location.pathname).toBe('/');
    }
  });

  test('a glass page is let through: an account with no character that opens Settings first is not sent, and is sent from the board after', async () => {
    window.history.pushState(null, '', '/settings');
    const fake = createFake({ instance, settings: fallbackSettings });
    fake.signInAs(fake.seed.account('settings-first'));
    render(<App api={fake} />);
    await screen.findByRole('heading', { level: 1, name: 'Settings' });
    await flush();
    expect(window.location.pathname).toBe('/settings');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('link', { name: 'Back to the board' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/welcome');
  });

  test('the welcome page has the menu, so every tab is a way out', async () => {
    window.history.pushState(null, '', '/welcome');
    const fake = createFake({ instance, settings: fallbackSettings });
    fake.signInAs(fake.seed.account('tabs'));
    render(<App api={fake} />);
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    expect(within(menu).getByRole('link', { name: 'Back to the board' })).toBeInTheDocument();
    for (const tab of ['Alerts', 'Vending Machine', 'My characters', 'Season', 'My log', 'Guide', 'Updates', 'Settings']) expect(await within(menu).findByRole('link', { name: new RegExp(`^${tab}`, 'iu') })).toBeInTheDocument();
  });
});

/*
 * The first page draws once (the forum-load plan, Task 12): the banner's links, the HUD and the screen arrive together, from one `boot`
 * and one `estimate`, with none of the reads the frame and the HUD made one by one.
 */
describe('the first load draws once, from boot', () => {
  /* What the first load of a thread may ask, and how many times; every method not named here is held to zero. */
  const ASKED: Readonly<Record<string, number>> = {
    boot: 1,
    estimate: 1,
    /* The thread draws from its document (Task 13): one read, started with boot and not after it. */
    threadPage: 1,
    /* The live window's catch-up (the thread's summary, one row) after the subscription: the only read the thread makes of its own. */
    thread: 1,
  };
  const HELD_TO_ZERO = ['boards', 'myCharacters', 'wallet', 'myCards', 'alertsUnread', 'nextSettlementAt', 'lastSettledAt', 'log', 'preferences', 'characters', 'acts', 'reading', 'board', 'tallies', 'myReactions', 'cardsOnMany', 'effectsAbove', 'following', 'characterStats', 'standingAmounts', 'classReveals', 'turnsAnnounced'] as const;

  test('/t/<id> asks boot and the estimate once and none of the frame\'s own reads, and the banner and HUD are in the first render after aria-busy clears', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    const demo = seedDemo(fake);
    window.history.pushState(null, '', `/t/${demo.thread}`);
    const firstPost = String((await fake.acts(demo.thread, 1, 1))[0]!.currentPayload.body).replace(/\[[^\]]*\]/gu, '').slice(0, 20);
    const names = [...Object.keys(ASKED), ...HELD_TO_ZERO];
    const counted = new Map<string, number>();
    for (const name of new Set(names)) {
      const real = (fake as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!.bind(fake);
      (fake as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => { counted.set(name, (counted.get(name) ?? 0) + 1); return real(...a); };
    }
    /* The first commit in which the page's main is no longer busy: what stands in the frame at that moment. */
    let first: { banner: string; hud: string; main: string } | null = null;
    const look = () => {
      if (first) return;
      const main = document.querySelector('main');
      if (!main || main.getAttribute('aria-busy') === 'true') return;
      first = { banner: document.querySelector('nav[aria-label="Main"]')?.textContent ?? '', hud: document.querySelector('[aria-label="Game HUD"]')?.textContent ?? '', main: main.textContent ?? '' };
    };
    const observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    render(<App api={fake} />);
    await screen.findByRole('region', { name: 'Game HUD' });
    await new Promise((r) => setTimeout(r, 700));
    observer.disconnect();
    for (const name of new Set(names)) expect({ name, n: counted.get(name) ?? 0 }).toEqual({ name, n: ASKED[name] ?? 0 });
    expect(first).not.toBeNull();
    expect(first!.banner).toContain('General');
    expect(first!.hud).toContain('Pipewrench');
    /* The first post is in the same first render: the thread drew from its document. */
    expect(first!.main).toContain(firstPost);
  });

  test('a switch of account after the first load reads boot again, so the HUD never shows the last account\'s mask', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    const one = fake.seed.account('one');
    fake.seed.character(one, 'First Mask', 'heel');
    const two = fake.seed.account('two');
    fake.seed.character(two, 'Second Mask', 'face');
    fake.signInAs(one);
    const booted = vi.spyOn(fake, 'boot');
    render(<App api={fake} />);
    const hud = await screen.findByRole('region', { name: 'Game HUD' });
    await waitFor(() => expect(hud).toHaveTextContent('First Mask'));
    expect(booted).toHaveBeenCalledTimes(1);
    act(() => { fake.signInAs(two); });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Game HUD' })).toHaveTextContent('Second Mask'));
    expect(screen.getByRole('region', { name: 'Game HUD' })).not.toHaveTextContent('First Mask');
    expect(booted).toHaveBeenCalledTimes(2);
  });
});

/*
 * The first load's rows are an account's own (the forum-load plan, Task 12 review): a sign-out forgets them, so signing in again as the same
 * account reads them afresh; a failed boot can be tried again; an estimate that was late still reaches the HUD.
 */
describe('after the first load', () => {
  test('signing out and in again as the same account reads boot, the wallet and the estimate afresh', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    const demo = seedDemo(fake);
    const booted = vi.spyOn(fake, 'boot');
    const wallet = vi.spyOn(fake, 'wallet');
    const estimate = vi.spyOn(fake, 'estimate');
    render(<App api={fake} />);
    const hud = await screen.findByRole('region', { name: 'Game HUD' });
    await waitFor(() => expect(hud).toHaveTextContent('Pipewrench'));
    expect([booted.mock.calls.length, wallet.mock.calls.length, estimate.mock.calls.length]).toEqual([1, 0, 1]);
    act(() => { fake.signInAs(null); });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Game HUD' })).getByRole('link', { name: 'Sign in' })).toBeInTheDocument());
    act(() => { fake.signInAs(demo.me); });
    await waitFor(() => expect(screen.getByRole('region', { name: 'Game HUD' })).toHaveTextContent('Pipewrench'));
    await waitFor(() => expect(booted).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(wallet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(2));
  });

  test('Try again after a failed boot reads boot again and draws the page', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    const booted = vi.spyOn(fake, 'boot').mockRejectedValueOnce(new Error('down'));
    render(<App api={fake} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'Game HUD' })).toHaveTextContent('Pipewrench');
    expect(booted).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  test('an estimate that lands after the wait reaches the HUD', async () => {
    const fake = createFake({ instance, settings: fallbackSettings });
    seedDemo(fake);
    const real = fake.estimate.bind(fake);
    vi.spyOn(fake, 'estimate').mockImplementation(() => new Promise((done) => { setTimeout(() => done(real()), ESTIMATE_WAIT_MS + 400); }));
    render(<App api={fake} />);
    const hud = await screen.findByRole('region', { name: 'Game HUD' });
    /* The page drew without it... */
    expect(within(hud).queryByRole('img', { name: /0\.85 pending/u })).toBeNull();
    /* ...and it fills in when it lands. */
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Game HUD' })).getByRole('img', { name: /0\.85 pending/u })).toBeInTheDocument(), { timeout: 3000 });
  });
});
