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
 * The calm feathers inward (docs/plans/2026-11-04-glass-polish-design.md, section 1): the backing is
 * the element's own box, and the element's padding holds its text inside the feather and a pad past
 * it. jsdom loads no stylesheet, so these read calm.css and tokens.css as text, as base.test.tsx does.
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

describe('the calm is drawn inside its element', () => {
  const calm = sheet('calm.css');
  const tokens = sheet('tokens.css');
  const phone = ':where(:root[data-kb-layout=\'phone\'])';

  test('its backing is the element\'s box, not the box grown by the feather', () => {
    expect(declsOf(calm, '.kb-calm::before').inset).toBe('0');
  });
  test('the element\'s padding is the feather plus the pad', () => {
    const d = declsOf(calm, '.kb-calm.kb-calm');
    expect(d['--kb-glass-calm-inset']).toBe('calc(var(--kb-glass-calm-feather) + var(--kb-glass-calm-pad))');
    expect(d.padding).toBe('var(--kb-glass-calm-inset)');
  });
  test('a flush heading takes back the padding in its margin', () => {
    expect(declsOf(calm, ".kb-calm.kb-calm[data-kb-calm='flush']")['margin-inline']).toBe('calc(var(--kb-glass-calm-inset) * -1)');
  });
  test('the main layout\'s pad is 12px; the phone layout\'s feather is 20px and its pad 10px', () => {
    expect(declsOf(tokens, ':root')['--kb-glass-calm-pad']).toBe('12px');
    expect(declsOf(tokens, phone)['--kb-glass-calm-feather']).toMatch(/^20px\b/);
    expect(declsOf(tokens, phone)['--kb-glass-calm-pad']).toBe('10px');
  });
});
