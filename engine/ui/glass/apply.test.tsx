/**
 * The glass's applier and its font-face builder: the instance's keys become `--kb-glass-*`
 * properties on a root, and each font file becomes an @font-face with `font-display: swap`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GlassTheme } from '../types.ts';
import { applyGlass, fontFaceCss, glassVars, installGlassFonts } from './apply.ts';

const glass = {
  keys: {
    standard: { '--kb-glass-ground': { value: '#07050d' }, '--kb-glass-text': { value: '#f1ecff', tags: ['body'] } },
    high: { '--kb-glass-ground': { value: '#000000' }, '--kb-glass-text': { value: '#ffffff', tags: ['body'] } },
  },
  smoke: { recipes: {}, surfaces: {} },
  calm: { opacity: 0.85, feather: 32 },
  sizes: { body: { px: 21, family: 'Barlow Condensed', weight: 600 }, 'display-xl': { px: 96, family: 'Anton', weight: 400 } },
  fonts: [
    { family: 'Anton', file: '/assets/Anton-Regular.woff2', weight: 400, style: 'normal', ink: 0.99 },
    { family: 'Barlow Condensed', file: '/assets/BarlowCondensed-BoldItalic.woff2', weight: 700, style: 'italic', ink: 0.9 },
  ],
  classes: {}, orbs: { gradients: [], body: { from: '', to: '' } },
} as unknown as GlassTheme;

afterEach(() => {
  document.getElementById('kb-glass-fonts')?.remove();
});

describe('glassVars', () => {
  it('names each token of the chosen key by its own name', () => {
    const v = glassVars(glass, 'standard');
    expect(v['--kb-glass-ground']).toBe('#07050d');
    expect(v['--kb-glass-text']).toBe('#f1ecff');
  });

  it('takes the high key\'s values when asked', () => {
    expect(glassVars(glass, 'high')['--kb-glass-ground']).toBe('#000000');
  });

  it('sets each size step in px and the calm\'s opacity and feather', () => {
    const v = glassVars(glass, 'standard');
    expect(v['--kb-glass-size-body']).toBe('21px');
    expect(v['--kb-glass-size-display-xl']).toBe('96px');
    expect(v['--kb-glass-calm-opacity']).toBe('0.85');
    expect(v['--kb-glass-calm-feather']).toBe('32px');
  });
});

describe('the instance\'s own colors as properties', () => {
  /* The orbs and the classes are the instance's data, not tokens (the glass plan, section 4): the engine reads them by position and by key. */
  const colored = {
    ...glass,
    classes: { heel: { fill: '#ff3d57', ink: '#14030a', large: '#ff8a96' } },
    orbs: { gradients: [{ highlight: '#ead6ff', color: '#b46cff', shade: '#3d1475' }, { highlight: '#d6e9ff', color: '#3d9bff', shade: '#0c3275' }], body: { from: '#1c1533', to: '#07060c' } },
  } as unknown as GlassTheme;

  it('gives each orb its three stops, by its place in the row, and the orb\'s body', () => {
    const v = glassVars(colored, 'standard');
    expect(v['--kb-glass-orb-1-highlight']).toBe('#ead6ff');
    expect(v['--kb-glass-orb-1-color']).toBe('#b46cff');
    expect(v['--kb-glass-orb-2-shade']).toBe('#0c3275');
    expect(v['--kb-glass-orb-body-from']).toBe('#1c1533');
    expect(v['--kb-glass-orb-body-to']).toBe('#07060c');
  });

  it('gives each class its fill, its ink and its large text, by the class\'s key', () => {
    const v = glassVars(colored, 'standard');
    expect(v['--kb-glass-class-heel-fill']).toBe('#ff3d57');
    expect(v['--kb-glass-class-heel-ink']).toBe('#14030a');
    expect(v['--kb-glass-class-heel-large']).toBe('#ff8a96');
  });
});

describe('applyGlass', () => {
  it('sets the properties on the root and marks the key', () => {
    const el = document.createElement('div');
    applyGlass(el, glass, 'standard');
    expect(el.style.getPropertyValue('--kb-glass-text')).toBe('#f1ecff');
    expect(el.getAttribute('data-kb-glass-key')).toBe('standard');
  });

  it('swapping to the high key replaces the values', () => {
    const el = document.createElement('div');
    applyGlass(el, glass, 'standard');
    applyGlass(el, glass, 'high');
    expect(el.style.getPropertyValue('--kb-glass-text')).toBe('#ffffff');
    expect(el.getAttribute('data-kb-glass-key')).toBe('high');
  });
});

describe('fontFaceCss', () => {
  const css = fontFaceCss(glass);

  it('writes one @font-face per font file', () => {
    expect(css.match(/@font-face/g)).toHaveLength(2);
  });

  it('names the family, the file as woff2, the weight and the style', () => {
    expect(css).toContain('font-family: "Anton"');
    expect(css).toContain('src: url("/assets/Anton-Regular.woff2") format("woff2")');
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-style: italic');
  });

  it('swaps: text shows in the fallback while a font loads', () => {
    expect(css.match(/font-display: swap/g)).toHaveLength(2);
  });

  it('says nothing for a glass with no fonts', () => {
    expect(fontFaceCss({ ...glass, fonts: [] } as unknown as GlassTheme)).toBe('');
  });
});

describe('installGlassFonts', () => {
  it('adds one style element, and replaces it rather than adding another', () => {
    installGlassFonts(document, glass);
    installGlassFonts(document, glass);
    const styles = document.querySelectorAll('style#kb-glass-fonts');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain('Anton-Regular.woff2');
  });
});
