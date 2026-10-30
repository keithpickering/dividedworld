/**
 * Putting an instance's glass on the page: its key's tokens as `--kb-glass-*` properties on a
 * root, and its fonts as faces in the document's font set. The engine knows the token names
 * (tokens.css) and reads the values from `InstanceUi.glass`; it names no color and no family itself.
 *
 * A key is the standard values or the high-contrast ones; both name the same tokens
 * (tools/check-glass-contrast.mjs holds that), so swapping the key re-colors the glass and
 * moves nothing. `applyGlass` marks the key on the root (`data-kb-glass-key`) for the stylesheet.
 */
import type { ClassLargeDraw, GlassSurface, GlassTheme } from '../types.ts';

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

/**
 * What a surface sets on its own element: the calm's opacity, where its recipe has a calm of its
 * own (the glass plan, section 6: "the calm's opacity for this surface, default the theme's"). Every
 * calm on the surface's text reads it there; a surface whose recipe has none inherits the theme's
 * from the root. tools/check-glass-contrast.mjs reads the surface's text at this same number.
 */
export function surfaceCalm(glass: GlassTheme, surface: GlassSurface): Record<string, string> | undefined {
  const calm = glass.smoke.recipes[glass.smoke.surfaces[surface]]?.calm;
  return calm === undefined ? undefined : { '--kb-glass-calm-opacity': String(calm) };
}

/**
 * Where a class's large text is drawn, for every surface: on the full smoke, inside a calm, or not
 * at all (the glass plan, section 6, amended 2026-10-30: the owner's answer "Per screen + 9% lift").
 * Each is read from the boards (docs/research/2026-10-29-two-worlds/), by what the board draws in a
 * class's large colors at large-text size and whether it stands in a calm; a board's gold or red
 * that is the ready-text or the over token, not a class, does not count. The guard
 * (tools/check-glass-contrast.mjs) reads this list from the source, holds each class's large text to
 * 3:1 against the full or the calmed worst of the surface's recipe, and writes a class ceiling only
 * for a surface that draws it, so Part 2's rendered measurement (e2e/glass-text.spec.ts, not yet
 * built) can fail class large text anywhere else; until it lands, review holds a screen that comes to
 * draw a class's large text where this says `none` to change this list first.
 */
export const classLargeText: Readonly<Record<GlassSurface, ClassLargeDraw>> = {
  /* 01 main and 02 phone show the played character's class as a fill-and-ink chip; 04 orbs' bright words are the over and ready-text tokens. */
  hud: 'none',
  /* 05 cards and 02 phone's sheet draw no class's large text in the hand. */
  hand: 'none',
  /* 05 cards' play form draws no class's large text either. */
  play: 'none',
  /* 03 react's quadrant labels are the classes' large colors at 22px Anton on the picker's smoke. */
  react: 'full',
  /* 06 turn's four classes are named at 40px Anton on the modal's smoke, with no calm; Heel's 9% lift is for this. */
  turn: 'full',
  /* 08 hold's BREAK FREE is the ready-text token in the release's calm; the frame, the tag and the panel name no class. */
  effect: 'none',
  /* 07 vending's gold (4 SLOTS EMPTY, AURA IN) is the ready-text token, not Jabroni's. */
  vending: 'none',
  /* 10 roster shows each class as a fill-and-ink chip and "Was: Heel" as body text; NEW CHARACTER's gold is the ready-text token. */
  characters: 'none',
  /* No board draws rankings; the page recipe's boards (11, 12) draw no class's color at all. */
  rankings: 'none',
  /* 12 log names a class only in body text ("Scored as a Heel"). */
  log: 'none',
  /* 11 settings draws no class's color. */
  settings: 'none',
  /* No board draws the account page; it shares the page recipe with 11 and 12, which draw none. */
  account: 'none',
  /* 09 settlement names the new class (FACE, 52px Anton) in the heading's calm, and the recipe's calmAll puts every text node in one. */
  settlement: 'calmed',
};

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
