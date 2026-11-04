/**
 * The calm the screen draws on a surface is the one the contrast guard reads it at
 * (tools/check-glass-contrast.mjs, `calmOf`): a recipe's own calm where it has one (the glass plan,
 * section 6: "the calm's opacity for this surface, default the theme's"), the theme's otherwise. A
 * guard that read a calm the screen never drew would pass text the player cannot read, so each
 * surface's text is held here to the guard's own number.
 *
 * What is drawn under a text block is `--kb-glass-calm-opacity` as calm.css reads it: the nearest
 * element that sets it, else the root, where applyGlass puts the theme's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { calmOf } from '../../../tools/check-glass-contrast.mjs';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { renderInWorld, testGlass } from '../test-world.tsx';
import type { GlassSurface, GlassTheme } from '../types.ts';
import { surfaceCalm } from './apply.ts';
import { Overlay } from './Overlay.tsx';
import { Page } from './Page.tsx';

/** testGlass with a recipe of its own calm, 0.6 against the theme's 0.85, on some surfaces and not others. */
const glass = {
  ...testGlass,
  smoke: {
    recipes: { plain: { layers: [] }, own: { layers: [], calm: 0.6 } },
    surfaces: { ...testGlass.smoke.surfaces, characters: 'own', react: 'own', hud: 'own', hand: 'own' },
  },
} as unknown as GlassTheme;

const recipeOf = (surface: GlassSurface) => glass.smoke.recipes[glass.smoke.surfaces[surface]]!;
/** What the guard reads the surface's text at. */
const guarded = (surface: GlassSurface): number => calmOf(glass, recipeOf(surface));

/** The calm's opacity calm.css draws under `el`: the nearest that sets it, else the theme's on the root. */
function drawn(el: Element): number {
  for (let at: Element | null = el; at; at = at.parentElement) {
    const v = (at as HTMLElement).style?.getPropertyValue('--kb-glass-calm-opacity');
    if (v) return Number(v);
  }
  return glass.calm.opacity;
}

const signedIn = (fake: Fake) => fake.signInAs(fake.seed.account('me'));


describe('the calm drawn on a surface is the calm the guard reads it at', { timeout: 15_000 }, () => {
  test('a recipe with its own calm sets it on its surface; one without leaves the theme\'s', () => {
    expect(surfaceCalm(glass, 'characters')).toEqual({ '--kb-glass-calm-opacity': '0.6' });
    expect(surfaceCalm(glass, 'settings')).toBeUndefined();
  });
  for (const surface of ['characters', 'settings'] as const) {
    test(`a glass page on the ${surface} surface`, async () => {
      renderInWorld(<Page surface={surface}><p className="kb-calm">words</p></Page>, { path: '/settings', seed: signedIn, glass });
      expect(guarded(surface)).toBe(surface === 'characters' ? 0.6 : 0.85);
      expect(drawn(await screen.findByText('words'))).toBe(guarded(surface));
    });
  }
  test('an overlay on its own surface, though it is drawn outside the page that opened it', async () => {
    renderInWorld(
      <Page surface="settings"><Overlay title="React" surface="react" onClose={() => {}}><p className="kb-calm">in the overlay</p></Overlay></Page>,
      { path: '/settings', seed: signedIn, glass },
    );
    expect(drawn(await screen.findByText('in the overlay'))).toBe(guarded('react'));
  });
  test('the Game HUD and the hand, each on its own', async () => {
    const { container } = renderInWorld(<Frame><p>page</p></Frame>, { path: '/', seed: signedIn, glass });
    await waitFor(() => expect(document.querySelector('.kb-hand-bar')).not.toBeNull());
    expect(drawn(container.querySelector('.kb-hud-bar')!)).toBe(guarded('hud'));
    expect(drawn(document.querySelector('.kb-hand-bar')!)).toBe(guarded('hand'));
    /* The board's page is no glass surface: its calm, if it draws one, is the theme's. */
    expect(drawn(screen.getByText('page'))).toBe(glass.calm.opacity);
  });
});

/*
 * The calm feathers outward: the backing reaches the feather past the element's box, and the element
 * adds no padding of its own. jsdom loads no stylesheet, so these read calm.css as text, as
 * base.test.tsx does.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const sheet = (name: string) => fs.readFileSync(path.join(here, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The declarations of the rules whose selector list contains exactly `selector`, whitespace squashed. */
function declsOf(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1]!.split(',').map(squash).includes(selector)) continue;
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = squash(d.slice(i + 1));
    }
  }
  return out;
}

describe('the calm is drawn outside its element', () => {
  const calm = sheet('calm.css');

  test('its backing reaches the feather past the element\'s box', () => {
    /* (The rule inside `@supports not (mask-image)` sets inset 0 on the same selector: no feather to reach there.) */
    expect(squash(calm)).toContain('inset: calc(var(--kb-calm-feather) * -1);');
  });
  test('the element adds no padding of its own', () => {
    for (const sel of ['.kb-calm', '.kb-calm.kb-calm']) expect(declsOf(calm, sel).padding).toBeUndefined();
  });
  test('the mask ramps over the same feather the backing reaches', () => {
    expect(calm).toMatch(/var\(--kb-calm-feather\),/);
    expect(calm).not.toMatch(/currentColor var\(--kb-glass-calm-feather\)/);
  });
  test('a calm in a framed panel (the HUD, a dialog, the hand, the class rail) keeps the soft feather: no override', () => {
    /* Without a backing the panels' words fail their ceilings, and a hard box shows as a rectangle; the layout check exempts a panel's own content instead. */
    for (const sel of ['.kb-hud', '.kb-hand-drawer', '.kb-class-rail']) expect(calm).not.toContain(`${sel} .kb-calm`);
    /* (A dialog on the phone has the 12px its padding gives, below: a fix for a cut at the window, not a harder edge.) */
  });
  test('a calm in a dialog has a 12px feather, so it stays inside a dialog that stands against the window\'s or the overlay\'s edge', () => {
    expect(declsOf(calm, '.kb-glass-dialog .kb-calm')['--kb-calm-feather']).toBe('min(var(--kb-glass-calm-feather), 12px)');
    expect(declsOf(calm, ":where(:root[data-kb-layout='phone']) .kb-glass-dialog .kb-calm")['--kb-calm-feather']).toBe('min(var(--kb-glass-calm-feather), 12px)');
  });
  test('each calm resolves its feather from the theme\'s, and on the phone the smaller of it and the column\'s gutter', () => {
    const phone = ':where(:root[data-kb-layout=\'phone\'])';
    expect(declsOf(calm, '.kb-calm')['--kb-calm-feather']).toBe('var(--kb-glass-calm-feather)');
    expect(declsOf(calm, `${phone} .kb-calm`)['--kb-calm-feather']).toBe('min(var(--kb-glass-calm-feather), var(--kb-glass-gutter, 32px))');
  });
});
