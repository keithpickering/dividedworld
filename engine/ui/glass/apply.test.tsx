/**
 * The glass's applier and its fonts: the instance's keys become `--kb-glass-*` properties on a
 * root, and each font file becomes a FontFace in the document's font set with `display: swap`
 * (a face the site's policy allows under font-src, where an injected style is refused).
 */
import { describe, expect, it } from 'vitest';
import type { GlassTheme } from '../types.ts';
import { applyGlass, glassVars, installGlassFonts } from './apply.ts';

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
  classes: {}, orbs: { gradients: [], body: { core: '', edge: '' } },
} as unknown as GlassTheme;

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
    orbs: { gradients: [{ highlight: '#ead6ff', color: '#b46cff', shade: '#3d1475' }, { highlight: '#d6e9ff', color: '#3d9bff', shade: '#0c3275' }], body: { core: '#1c1533', edge: '#07060c' } },
  } as unknown as GlassTheme;

  it('gives each orb its three stops, by its place in the row, and the orb\'s body', () => {
    const v = glassVars(colored, 'standard');
    expect(v['--kb-glass-orb-1-highlight']).toBe('#ead6ff');
    expect(v['--kb-glass-orb-1-color']).toBe('#b46cff');
    expect(v['--kb-glass-orb-2-shade']).toBe('#0c3275');
    expect(v['--kb-glass-orb-body-core']).toBe('#1c1533');
    expect(v['--kb-glass-orb-body-edge']).toBe('#07060c');
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

/** A document's font set and its FontFace constructor, as far as installGlassFonts reaches; jsdom has neither. */
class FakeFace {
  constructor(readonly family: string, readonly source: string, readonly descriptors: FontFaceDescriptors) {}
}
function fakeDoc() {
  const fonts = new Set<FakeFace>();
  const own = { fonts, defaultView: { FontFace: FakeFace } };
  /* The rest of the document is jsdom's, so a style element put in it would show. */
  return new Proxy(own, {
    get: (target, key) => {
      if (key in target) return target[key as keyof typeof target];
      const value = (document as unknown as Record<PropertyKey, unknown>)[key];
      return typeof value === 'function' ? value.bind(document) : value;
    },
  });
}
const install = (doc: ReturnType<typeof fakeDoc>) => installGlassFonts(doc as unknown as Document, glass);

describe('installGlassFonts', () => {
  it('adds one face per font file to the document, through the font set and never a style element', () => {
    const doc = fakeDoc();
    install(doc);
    const faces = [...doc.fonts];
    expect(faces.map((f) => [f.family, f.source])).toEqual([
      ['Anton', 'url("/assets/Anton-Regular.woff2") format("woff2")'],
      ['Barlow Condensed', 'url("/assets/BarlowCondensed-BoldItalic.woff2") format("woff2")'],
    ]);
    expect(document.getElementById('kb-glass-fonts')).toBeNull();
  });

  it('names the weight and the style, and swaps: text shows in the fallback while a font loads', () => {
    const doc = fakeDoc();
    install(doc);
    expect([...doc.fonts].map((f) => f.descriptors)).toEqual([
      { weight: '400', style: 'normal', display: 'swap' },
      { weight: '700', style: 'italic', display: 'swap' },
    ]);
  });

  it('adds each face once, however often it is called', () => {
    const doc = fakeDoc();
    install(doc);
    install(doc);
    expect(doc.fonts.size).toBe(2);
  });

  it('keeps two faces one file serves at different weights, as a variable font does', () => {
    const doc = fakeDoc();
    const variable = { ...glass, fonts: [
      { family: 'Var', file: '/assets/Var.woff2', weight: 400, style: 'normal' as const, ink: 1 },
      { family: 'Var', file: '/assets/Var.woff2', weight: 700, style: 'normal' as const, ink: 1 },
    ] };
    installGlassFonts(doc as unknown as Document, variable);
    expect([...doc.fonts].map((f) => f.descriptors.weight)).toEqual(['400', '700']);
  });

  it('does nothing where the document has no font set (a test document)', () => {
    expect(() => installGlassFonts(document, glass)).not.toThrow();
  });
});
