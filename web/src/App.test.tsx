import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createFake } from '../../engine/ui/data/fake.ts';
import { instance } from '../../instances/divided-world/index.ts';
import { instanceUi } from '../../instances/divided-world/ui/index.ts';
import { App } from './App.tsx';
import { seedDemo } from './demo.ts';
import { fallbackSettings } from './data/settings.ts';

beforeEach(() => { localStorage.clear(); window.history.pushState(null, '', '/'); });

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
  await userEvent.click(await screen.findByRole('button', { name: /^Pipewrench/u }));
  await userEvent.click(await screen.findByRole('button', { name: 'Withdraw Pipewrench\'s Turn' }));
  expect(await screen.findByText('Pipewrench\'s Turn is withdrawn.')).toBeInTheDocument();
  fake.signInAs(fake.seed.account('next'));
  await waitFor(() => expect(screen.queryByText('Pipewrench\'s Turn is withdrawn.')).toBeNull());
}, 15_000);

/*
 * What the player's provider holds is the account's it was read for: in the very commit the account
 * becomes known, or changes, nothing read for another account (or for none) shows, so a signed-in
 * load never flashes the empty roster, and the next player never sees the last one's HUD.
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

test('another account signing in: no commit shows the last account\'s HUD character or wallet', async () => {
  window.history.pushState(null, '', '/b/general');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const hud = await screen.findByRole('region', { name: 'Game HUD' });
  await waitFor(() => expect(within(hud).getByRole('img', { name: /^Wallet 2\.40 of 6 orbs/u })).toBeInTheDocument());
  const name = (await fake.myCharacters())[0]!.name;
  /* Every value the HUD's wallet label and its mask picker took while the next account signs in, the passing ones too. */
  const stale: string[] = [];
  const look = (v: string | null | undefined) => { if (v && (/^Wallet 2\.40 of 6/u.test(v) || v === name || v.includes(`>${name}<`))) stale.push(v); };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (!(r.target instanceof Node) || !hud.contains(r.target)) continue;
      if (r.type === 'attributes') { look(r.oldValue); look((r.target as Element).getAttribute(r.attributeName!)); }
      r.addedNodes.forEach((n) => { look(n.textContent); if (n instanceof Element) { look(n.getAttribute('aria-label')); n.querySelectorAll('[aria-label]').forEach((e) => look(e.getAttribute('aria-label'))); look(n.outerHTML); } });
    }
  });
  const next = fake.seed.account('next');
  fake.seed.character(next, 'Nextling', instance.classes[0]!.key);
  observer.observe(hud, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['aria-label'], characterData: true });
  fake.signInAs(next);
  await waitFor(() => expect(within(hud).queryByRole('img', { name: /^Wallet 2\.40 of 6/u })).toBeNull());
  await new Promise((r) => setTimeout(r, 50));
  observer.takeRecords();
  observer.disconnect();
  expect(stale).toEqual([]);
}, 15_000);

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
  ['/rankings', () => screen.getByRole('heading', { level: 1, name: 'Rankings' })],
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

test('/rankings is drawn on the glass with no board panel, and its menu bar tab is the current page', async () => {
  window.history.pushState(null, '', '/rankings');
  const fake = createFake({ instance, settings: fallbackSettings });
  seedDemo(fake);
  render(<App api={fake} />);
  const bar = await screen.findByRole('navigation', { name: 'Menu' });
  await screen.findByRole('heading', { level: 1, name: 'Rankings' });
  expect(screen.getByRole('main').querySelector('.kb-glass-content-panel')).toBeNull();
  expect(screen.getByRole('main').closest('[data-kb-surface]')).toHaveAttribute('data-kb-surface', 'rankings');
  expect(within(bar).getByRole('link', { name: 'Rankings' })).toHaveAttribute('aria-current', 'page');
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
