/**
 * Putting an instance's glass on the page: its key's tokens as `--kb-glass-*` properties on a
 * root, and its fonts as @font-face rules. The engine knows the token names (tokens.css) and
 * reads the values from `InstanceUi.glass`; it names no color and no family itself.
 *
 * A key is the standard values or the high-contrast ones; both name the same tokens
 * (tools/check-glass-contrast.mjs holds that), so swapping the key re-colors the glass and
 * moves nothing. `applyGlass` marks the key on the root (`data-kb-glass-key`) for the stylesheet.
 */
import type { GlassTheme } from '../types.ts';

export type GlassKeyName = 'standard' | 'high';

/**
 * Every property a key sets: its tokens, each size step in px, and the calm's opacity and feather.
 * Then the instance's own colors, which are its data and not tokens (the glass plan, section 4):
 * each orb's three stops by its place in the row (`--kb-glass-orb-<n>-highlight`, `-color`,
 * `-shade`) and the orb's body (`--kb-glass-orb-body-from`, `-to`), and each class's fill, ink and
 * large text by the class's key (`--kb-glass-class-<key>-fill`, `-ink`, `-large`). The engine
 * reads those names and never a value; an orb or a class the instance does not give is unset.
 */
export function glassVars(glass: GlassTheme, key: GlassKeyName): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, token] of Object.entries(glass.keys[key])) out[name] = token.value;
  for (const [name, size] of Object.entries(glass.sizes)) out[`--kb-glass-size-${name}`] = `${size.px}px`;
  out['--kb-glass-calm-opacity'] = String(glass.calm.opacity);
  out['--kb-glass-calm-feather'] = `${glass.calm.feather}px`;
  glass.orbs.gradients.forEach((g, i) => {
    out[`--kb-glass-orb-${i + 1}-highlight`] = g.highlight;
    out[`--kb-glass-orb-${i + 1}-color`] = g.color;
    out[`--kb-glass-orb-${i + 1}-shade`] = g.shade;
  });
  if (glass.orbs.body.from) out['--kb-glass-orb-body-from'] = glass.orbs.body.from;
  if (glass.orbs.body.to) out['--kb-glass-orb-body-to'] = glass.orbs.body.to;
  for (const [cls, c] of Object.entries(glass.classes)) {
    out[`--kb-glass-class-${cls}-fill`] = c.fill;
    out[`--kb-glass-class-${cls}-ink`] = c.ink;
    out[`--kb-glass-class-${cls}-large`] = c.large;
  }
  return out;
}

/** Sets the glass's properties on `root` and marks the key. */
export function applyGlass(root: HTMLElement, glass: GlassTheme, key: GlassKeyName): void {
  for (const [name, value] of Object.entries(glassVars(glass, key))) root.style.setProperty(name, value);
  root.setAttribute('data-kb-glass-key', key);
}

/** One @font-face per font file, `font-display: swap` so text shows in the fallback while a font loads. */
export function fontFaceCss(glass: GlassTheme): string {
  return glass.fonts
    .map((f) => [
      '@font-face {',
      `  font-family: ${JSON.stringify(f.family)};`,
      `  src: url(${JSON.stringify(f.file)}) format("woff2");`,
      `  font-weight: ${f.weight};`,
      `  font-style: ${f.style};`,
      '  font-display: swap;',
      '}',
    ].join('\n'))
    .join('\n');
}

/** Puts the glass's @font-face rules in one `<style id="kb-glass-fonts">`, replacing it if it is there. */
export function installGlassFonts(doc: Document, glass: GlassTheme): void {
  let style = doc.getElementById('kb-glass-fonts');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'kb-glass-fonts';
    doc.head.append(style);
  }
  const css = fontFaceCss(glass);
  if (style.textContent !== css) style.textContent = css;
}
