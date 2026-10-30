/**
 * Putting an instance's glass on the page: its key's tokens as `--kb-glass-*` properties on a
 * root, and its fonts as faces in the document's font set. The engine knows the token names
 * (tokens.css) and reads the values from `InstanceUi.glass`; it names no color and no family itself.
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
 * `-shade`) and the orb's body (`--kb-glass-orb-body-core`, `-edge`), and each class's fill, ink and
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
  if (glass.orbs.body.core) out['--kb-glass-orb-body-core'] = glass.orbs.body.core;
  if (glass.orbs.body.edge) out['--kb-glass-orb-body-edge'] = glass.orbs.body.edge;
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

/** The faces put in each document, by file, weight and style, so a second call adds none. */
const installed = new WeakMap<object, Set<string>>();

/**
 * Puts each of the glass's font files in the document's font set as a FontFace, with `display:
 * swap` so text shows in the fallback while a font loads. A face added this way is fetched under
 * the site's font-src, where an injected `<style>` of @font-face rules would be refused by its
 * style-src (web/headers.ts; e2e/csp.spec.ts holds it). Each face is added once per document,
 * however often this is called; a document with no font set (a test's) is left alone. A face whose
 * file fails to load goes to `error` in the font set and its text keeps the fallback stack, so
 * nothing throws.
 */
export function installGlassFonts(doc: Document, glass: GlassTheme): void {
  const Face = doc.defaultView?.FontFace;
  if (!doc.fonts || !Face) return;
  let done = installed.get(doc);
  if (!done) installed.set(doc, (done = new Set()));
  for (const f of glass.fonts) {
    const face = `${f.file} ${f.weight} ${f.style}`;
    if (done.has(face)) continue;
    done.add(face);
    doc.fonts.add(new Face(f.family, `url(${JSON.stringify(f.file)}) format("woff2")`, { weight: String(f.weight), style: f.style, display: 'swap' }));
  }
}
