/**
 * Guard: every instance's glass keeps its text legible over its smoke, before anything renders.
 *
 *   node tools/check-glass-contrast.mjs            check
 *   node tools/check-glass-contrast.mjs --write    check, then regenerate e2e/glass-ceilings.json
 *
 * The glass draws procedural smoke behind its text (engine/ui/glass/Smoke.tsx), and the smoke's
 * brightest pixels are what the text must stand on. jsdom paints nothing and axe cannot read
 * contrast over an SVG filter, so the numbers are worked out here from `instances/<name>/ui/glass.json`
 * (the engine's guard names no instance; it reads every one) by a model, and e2e/glass-text.spec.ts
 * (Part 2) measures the rendered page against the ceilings this file writes.
 *
 * The model. A recipe's layers are composited in order over the opaque ground at *full noise*, the
 * most any pixel can be: each layer's alpha is its rect's opacity (the noise saturates the color
 * matrix's alpha row, which the boards write as `1.8 r - 0.74` and `2 g - 1.0`; a row that evaluates
 * a little under 1 at full noise, `2 b - 1.12`, is taken as 1, which only over-states the worst), its
 * color is the matrix's constant color, and the blur cannot raise a maximum. Only the colors are
 * quantized to 8 bits (the browser rounds a matrix's constant color to a byte); opacities and the calm
 * are not. That is the worst pixel. The calmed worst is the same with each layer's opacity scaled by (1 - calm): a calm is
 * the ground laid over the smoke at the calm's opacity under a text block (engine/ui/glass/calm.css),
 * so the smoke shows through at what is left. The calm's feather sits outside the text's box
 * (calm.css insets the backing by the feather on every side), so the text is in the full-strength
 * region and the calmed worst applies to every pixel under it. A recipe's own `calm` (the glass plan,
 * section 6: "the calm's opacity for this surface, default the theme's") is read in the theme's
 * place, and the screen draws that same number on each surface that uses the recipe (surfaceCalm,
 * engine/ui/glass/apply.ts; engine/ui/glass/calm.test.tsx holds the two equal), so it is held, as
 * the theme's is, to a number in (0, 1]. A recipe's `narrow` layers (below 600px) are held
 * separately, the same way. The numbers this reproduces are the audit's (the glass plan, section 6:
 * the hud recipe 0.216, page 0.230, characters 0.196, turn 0.116, effect 0.103, react 0.087, cards
 * 0.193, vending 0.230, settlement 0.274), and test-glass-contrast.mjs pins them.
 *
 * Read, for each instance's standard key (a token has tags, `GlassTag` in engine/ui/types.ts): a
 * `large` token at 3:1 against the full worst of every recipe, unless the recipe is `calmAll`
 * (every text node on it stands in a calm, so large text is read calmed); a `body` token at 4.5:1
 * and a `waiting` token at 3:1 against the calmed worst; an `ink` at 4.5:1 against each fill it is
 * set on; every text token opaque (a translucent one has no ratio to check); the ground opaque. Each
 * class color: its ink 4.5:1 on its fill, and its large text per screen (the glass plan, section 6,
 * amended 2026-10-30, the owner's "Per screen + 9% lift"). The engine says, for every surface,
 * whether a class's large text is drawn there on the full smoke, in a calm, or not at all
 * (`classLargeText` in engine/ui/glass/apply.ts, read here from its source as `GlassSurface` is); the
 * guard refuses that list when it leaves out a surface the engine lists, names one it does not, or
 * gives a draw other than those three. A class's large text is read at 3:1 against its surface's
 * recipe's full worst where the list says full (calmed where the recipe is `calmAll`, as a large
 * token is), against the calmed worst where it says calmed, the narrow layers' too in each case,
 * and not at all where it says none. Each
 * size step: its px times its face's ink ratio at 18 or more, a phone step at 16px of computed size.
 * Each font has a family, a file, a weight, a style and an ink ratio. Every `GlassSurface` the engine
 * lists (read from engine/ui/types.ts) names a recipe the theme has, and no other surface is named.
 * The high key names exactly the tokens the standard key does, each text token at 7:1 against its own
 * bare ground and each ink at 7:1 on its fill.
 *
 * Writes (with --write) and checks (always) `e2e/glass-ceilings.json`: for each instance, each
 * surface's worst and calmed worst luminance, and for each text token the brightest background
 * luminance it still meets its ratio on, by tag. A surface that draws a class's large text also
 * carries how it is drawn there (`classLarge`) and each class's ceiling at 3:1 (`classes`); one that
 * draws none carries neither, so the rendered measurement has no ceiling to pass it on. The file
 * is committed; the check fails when it no longer matches glass.json, so a change to the smoke is a
 * change to the file Part 2 measures against.
 *
 * Read from git, so an untracked scratch file neither fails the build nor makes it pass. The
 * detection is exported and pure so tools/test-glass-contrast.mjs drives every branch red.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const GLASS_FILE = /^instances\/([^/]+)\/ui\/glass\.json$/;
export const CEILINGS_FILE = 'e2e/glass-ceilings.json';
const TYPES_FILE = 'engine/ui/types.ts';
/** Where the engine says how each surface draws a class's large text (`classLargeText`). */
const CLASS_LARGE_FILE = 'engine/ui/glass/apply.ts';
const CLASS_LARGE_NAME = 'classLargeText';
const CLASS_LARGE_DRAWS = ['full', 'calmed', 'none'];

/** The size floor: ink of at least 18px, and 16px of computed size on a phone (the web plan's brief, item 7). */
const INK_FLOOR = 18;
const PHONE_FLOOR = 16;
/** A smoke layer's color: six hex digits, the only form engine/ui/glass/Smoke.tsx reads. */
const LAYER_COLOR = /^#[0-9a-f]{6}$/i;
const TEXT_TAGS = ['body', 'large', 'waiting', 'ink'];
/** The ratio each tag asks of the standard key; the high key asks HIGH of every text token and ink, on its bare ground. */
const HIGH = 7;
const NEED = { standard: { body: 4.5, large: 3, waiting: 3, ink: 4.5 }, high: { ink: HIGH } };

/** The engine's closed list of surfaces, read from the `GlassSurface` union in engine/ui/types.ts. */
function readSurfaces() {
  const file = path.join(repoRoot, TYPES_FILE);
  if (!fs.existsSync(file)) return [];
  const source = ts.createSourceFile(TYPES_FILE, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out = [];
  for (const st of source.statements) {
    if (ts.isTypeAliasDeclaration(st) && st.name.text === 'GlassSurface' && ts.isUnionTypeNode(st.type)) {
      for (const t of st.type.types) if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) out.push(t.literal.text);
    }
  }
  return out;
}
export const SURFACES = readSurfaces();

/**
 * The engine's list of how each surface draws a class's large text, read from the source text of
 * engine/ui/glass/apply.ts: `{ entries, unreadable }`, where `entries` maps each surface named to its
 * draw and `unreadable` describes each property the guard cannot read as a plain name and a string
 * (a spread, a computed name, a value that is not a literal). Null when the source has no such
 * list. The type check holds the list to every `GlassSurface`; the guard holds it again, because
 * it is what the guard reads.
 */
export function readClassLarge(text) {
  const source = ts.createSourceFile(CLASS_LARGE_FILE, text, ts.ScriptTarget.Latest, true);
  for (const st of source.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== CLASS_LARGE_NAME || !d.initializer) continue;
      let init = d.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (!ts.isObjectLiteralExpression(init)) return { entries: {}, unreadable: [`${CLASS_LARGE_NAME} is not an object literal`] };
      const entries = {};
      const unreadable = [];
      for (const p of init.properties) {
        if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) || !ts.isStringLiteral(p.initializer)) { unreadable.push(p.getText(source)); continue; }
        const name = p.name.text;
        if (name in entries) unreadable.push(`${name} is named twice`);
        entries[name] = p.initializer.text;
      }
      return { entries, unreadable };
    }
  }
  return null;
}
function readClassLargeFile() {
  const file = path.join(repoRoot, CLASS_LARGE_FILE);
  return fs.existsSync(file) ? readClassLarge(fs.readFileSync(file, 'utf8')) : null;
}
export const CLASS_LARGE = readClassLargeFile();

/**
 * Every departure of the engine's class large text list from the surfaces, as `{ where, why }`: no
 * list, a property the guard cannot read, a surface left out, one the engine does not list, a draw
 * that is not `full`, `calmed` or `none`.
 */
export function classLargeFaults(list, surfaces = SURFACES) {
  const where = `class large text list (${CLASS_LARGE_NAME}, ${CLASS_LARGE_FILE})`;
  if (!list) return [{ where, why: 'cannot be found; the engine says, for every surface, whether a class\'s large text is drawn there on the full smoke, in a calm, or not at all' }];
  const out = [];
  for (const u of list.unreadable) out.push({ where, why: `cannot read ${JSON.stringify(u)}; each entry is a surface's name and a string` });
  for (const s of surfaces) if (!(s in list.entries)) out.push({ where: `${where}: surface ${s}`, why: 'leaves out this surface, which the engine lists (GlassSurface in engine/ui/types.ts)' });
  for (const [s, draw] of Object.entries(list.entries)) {
    if (!surfaces.includes(s)) out.push({ where: `${where}: surface ${s}`, why: 'is not one the engine lists (GlassSurface in engine/ui/types.ts)' });
    else if (!CLASS_LARGE_DRAWS.includes(draw)) out.push({ where: `${where}: surface ${s}`, why: `draws class large text ${JSON.stringify(draw)}, which is not full, calmed or none` });
  }
  return out;
}

/* ---- color ---- */

/** A CSS color as `{ r, g, b, a }` (0 to 255, alpha 0 to 1), or null if it is not a hex or an rgb()/rgba(). */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  const hex = s.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (fn) {
    const a = fn[4] === undefined ? 1 : fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : parseFloat(fn[4]);
    return { r: +fn[1], g: +fn[2], b: +fn[3], a };
  }
  return null;
}

/** An `[r, g, b]` triple from a color string or a triple. */
function rgbOf(c) {
  if (Array.isArray(c)) return c;
  const p = parseColor(c);
  return p ? [p.r, p.g, p.b] : [NaN, NaN, NaN];
}

/** WCAG 2.x relative luminance of a color string or `[r, g, b]` (0 to 255). */
export function luminance(c) {
  const [r, g, b] = rgbOf(c).map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two colors (strings or triples), lighter over darker. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A ratio for a message: two places, but three where two would round up to the threshold it fails. */
function fmt(ratio, need) {
  const two = ratio.toFixed(2);
  return `${parseFloat(two) >= need && ratio < need ? ratio.toFixed(3) : two}:1`;
}

const rgbText = (rgb) => `rgb(${rgb.map((v) => Math.round(v)).join(',')})`;

/* ---- the smoke ---- */

/** The composite of a recipe's layers at full noise over the ground, each layer's opacity scaled by `k`. */
function composite(layers, ground, k) {
  let c = [...ground];
  for (const layer of layers) {
    const col = parseColor(layer.color);
    if (!col) continue;
    const a = Math.min(1, Math.max(0, layer.opacity * k));
    c = [a * col.r + (1 - a) * c[0], a * col.g + (1 - a) * c[1], a * col.b + (1 - a) * c[2]];
  }
  return c;
}

const measure = (rgb) => ({ rgb, luminance: luminance(rgb) });

/** The ground of a glass as a triple: its standard key's `--kb-glass-ground`, or black if that is not a color. */
function groundOf(glass) {
  const p = parseColor(glass.keys?.standard?.['--kb-glass-ground']?.value);
  return p ? [p.r, p.g, p.b] : [0, 0, 0];
}

/** A recipe's calm opacity: its own, else the theme's. */
export const calmOf = (glass, recipe) => recipe.calm ?? glass.calm?.opacity ?? 0;

/**
 * The worst pixel of each recipe: `{ full, calmed }` and, for a recipe with `narrow` layers,
 * `narrow: { full, calmed }`, each `{ rgb, luminance }`.
 */
export function recipeWorsts(glass) {
  const ground = groundOf(glass);
  const out = {};
  for (const [name, recipe] of Object.entries(glass.smoke?.recipes ?? {})) {
    const k = 1 - calmOf(glass, recipe);
    out[name] = { full: measure(composite(recipe.layers ?? [], ground, 1)), calmed: measure(composite(recipe.layers ?? [], ground, k)) };
    if (recipe.narrow) out[name].narrow = { full: measure(composite(recipe.narrow, ground, 1)), calmed: measure(composite(recipe.narrow, ground, k)) };
  }
  return out;
}

/* ---- the faults ---- */

const textTags = (token) => (token?.tags ?? []).filter((t) => TEXT_TAGS.includes(t));
const isText = (token) => textTags(token).length > 0;

/** The fonts of a glass that a size's face names (family, weight, upright). */
const fontFor = (glass, size) => (glass.fonts ?? []).find((f) => f.family === size.family && f.weight === size.weight && f.style === 'normal');

/**
 * Every departure of one glass from the contract, as `{ where, why }`; [] is clean. `classLarge`
 * is the engine's list of how each surface draws a class's large text (its entries; the list itself
 * is held by classLargeFaults).
 * `glass` is the parsed glass.json (a GlassTheme); it is left untyped here because naming the type
 * would pull the rules' sources into the tools' type check.
 */
export function glassFaults(glass, classLarge = CLASS_LARGE?.entries ?? {}) {
  const out = [];
  const fault = (where, why) => out.push({ where, why });
  const standard = glass.keys?.standard ?? {};
  const high = glass.keys?.high ?? {};
  const recipes = glass.smoke?.recipes ?? {};
  const surfaces = glass.smoke?.surfaces ?? {};

  /* The surfaces: the engine's closed list, each naming a recipe the theme has. */
  for (const s of SURFACES) {
    if (!(s in surfaces)) fault(`surface ${s}`, 'is not named; the engine lists it, so the theme names a recipe for it');
    else if (!(surfaces[s] in recipes)) fault(`surface ${s}`, `names recipe ${surfaces[s]}, which the theme does not define`);
  }
  for (const s of Object.keys(surfaces)) if (!SURFACES.includes(s)) fault(`surface ${s}`, 'is not one the engine lists (GlassSurface in engine/ui/types.ts)');

  /* The calm. */
  const calm = glass.calm;
  if (!calm || !(calm.opacity > 0 && calm.opacity <= 1) || !(calm.feather >= 0)) fault('calm', 'needs an opacity above 0 and at most 1, and a feather of 0 or more');

  /* Each recipe's layers are what the model reads. */
  for (const [name, recipe] of Object.entries(recipes)) {
    /* A recipe's own calm is drawn on its surface as the calm's opacity (surfaceCalm, engine/ui/glass/apply.ts), so it is held as the theme's is. */
    if (recipe.calm !== undefined && !(typeof recipe.calm === 'number' && recipe.calm > 0 && recipe.calm <= 1)) {
      fault(`recipe ${name}`, `its own calm ${JSON.stringify(recipe.calm)} needs to be a number above 0 and at most 1: the screen draws it as the calm's opacity on the surface`);
    }
    for (const [which, layers] of [['layers', recipe.layers], ['narrow layers', recipe.narrow]]) {
      if (layers === undefined && which === 'narrow layers') continue;
      if (!Array.isArray(layers) || layers.length === 0) { fault(`recipe ${name}`, `has no ${which}`); continue; }
      layers.forEach((l, i) => {
        const bad = !LAYER_COLOR.test(l.color) || !(l.opacity > 0 && l.opacity <= 1) || !Array.isArray(l.alpha) || l.alpha.length !== 5
          || !Array.isArray(l.frequency) || l.frequency.length !== 2 || !(l.octaves >= 1) || !Number.isFinite(l.seed) || !(l.blur >= 0);
        if (bad) fault(`recipe ${name}`, `${which} ${i + 1} is not a six-digit #rrggbb color (the only form Smoke reads), an opacity in (0, 1], an alpha row of five, two frequencies, octaves, a seed and a blur`);
      });
    }
  }

  /* Tokens: the ground is opaque; a text token is a color and opaque; an ink names fills the key has. */
  const ground = parseColor(standard['--kb-glass-ground']?.value);
  if (!ground || ground.a !== 1) fault('--kb-glass-ground', 'is not an opaque color: the smoke is composited over it');
  for (const [keyName, key] of [['standard', standard], ['high', high]]) {
    for (const [name, token] of Object.entries(key)) {
      if (!isText(token)) continue;
      const c = parseColor(token.value);
      if (!c) fault(name, `${keyName} key: ${JSON.stringify(token.value)} is not a color the guard can read`);
      else if (c.a !== 1) fault(name, `${keyName} key: ${token.value} is not opaque; a translucent text color has no ratio to check`);
    }
  }

  /* The ink on its fills (standard 4.5:1, high 7:1). */
  for (const [keyName, key] of [['standard', standard], ['high', high]]) {
    for (const [name, token] of Object.entries(key)) {
      if (!textTags(token).includes('ink')) continue;
      const ink = parseColor(token.value);
      for (const on of token.on ?? []) {
        const fill = parseColor(key[on]?.value);
        if (!key[on]) fault(name, `${keyName} key: ink is set on ${on}, which is not in the key`);
        else if (!ink || !fill) continue;
        else {
          const r = contrastRatio([ink.r, ink.g, ink.b], [fill.r, fill.g, fill.b]);
          const need = NEED[keyName].ink;
          if (r < need) fault(`ink ${name}`, `${keyName} key: ${token.value} on ${on} ${key[on].value} is ${fmt(r, need)}, needs ${need}:1`);
        }
      }
      if (!(token.on?.length)) fault(name, `${keyName} key: an ink names the fills it is set on`);
    }
  }

  /* Each recipe against every text token of the standard key. */
  const worsts = recipeWorsts(glass);
  for (const [name, recipe] of Object.entries(recipes)) {
    const w = worsts[name];
    const sets = [['', w.full, w.calmed]];
    if (w.narrow) sets.push([' (narrow)', w.narrow.full, w.narrow.calmed]);
    for (const [suffix, full, calmed] of sets) {
      for (const [token, def] of Object.entries(standard)) {
        const c = parseColor(def.value);
        if (!c || c.a !== 1) continue;
        const fg = [c.r, c.g, c.b];
        for (const tag of textTags(def)) {
          if (tag === 'ink') continue;
          const calmedRead = tag !== 'large' || recipe.calmAll === true;
          const bg = calmedRead ? calmed : full;
          const need = NEED.standard[tag];
          const r = contrastRatio(fg, bg.rgb);
          if (r < need) fault(`recipe ${name}${suffix}`, `${token} (${tag}) ${def.value} on the ${calmedRead ? 'calmed' : 'full'} worst ${rgbText(bg.rgb)} is ${fmt(r, need)}, needs ${need}:1`);
        }
      }
    }
  }

  /*
   * Class colors: the ink on the fill, and the large text on each surface that draws it, against
   * the full worst where the engine's list says it stands on the full smoke and the calmed worst
   * where it says it stands in a calm (and a recipe that is calmAll reads it calmed, as it does a
   * large token), the narrow layers' too. A surface that draws none is not read.
   */
  for (const [key, look] of Object.entries(glass.classes ?? {})) {
    const fill = parseColor(look.fill);
    const ink = parseColor(look.ink);
    const large = parseColor(look.large);
    if (!fill || !ink || !large) { fault(`class ${key}`, 'needs a fill, an ink and a large text color, each a color the guard can read'); continue; }
    const r = contrastRatio([ink.r, ink.g, ink.b], [fill.r, fill.g, fill.b]);
    if (r < 4.5) fault(`class ${key}`, `ink ${look.ink} on its fill ${look.fill} is ${fmt(r, 4.5)}, needs 4.5:1`);
    for (const s of SURFACES) {
      const draw = classLarge[s];
      const name = surfaces[s];
      const w = worsts[name];
      if ((draw !== 'full' && draw !== 'calmed') || !w) continue;
      const calmedRead = draw === 'calmed' || recipes[name].calmAll === true;
      const which = calmedRead ? 'calmed' : 'full';
      for (const [label, bg] of [[which, w[which]], ...(w.narrow ? [[`narrow ${which}`, w.narrow[which]]] : [])]) {
        const lr = contrastRatio([large.r, large.g, large.b], bg.rgb);
        if (lr < 3) fault(`class ${key}`, `large ${look.large} on surface ${s} (recipe ${name}), its ${label} worst ${rgbText(bg.rgb)}, is ${fmt(lr, 3)}, needs 3:1`);
      }
    }
  }

  /* Fonts, and each size in its face. */
  for (const f of glass.fonts ?? []) {
    const where = `font ${f.file ?? '(no file)'}`;
    if (!f.family || !f.file || !Number.isFinite(f.weight) || (f.style !== 'normal' && f.style !== 'italic')) fault(where, 'needs a family, a file, a weight and a style (normal or italic)');
    if (!(typeof f.ink === 'number' && f.ink > 0 && f.ink <= 1)) fault(where, 'has no ink ratio (the share of its em the face inks, above 0 and at most 1)');
  }
  for (const [name, size] of Object.entries(glass.sizes ?? {})) {
    const where = `size ${name}`;
    if (!(size.px > 0)) { fault(where, `${size.px}px is not a size`); continue; }
    if (size.phone) {
      if (size.px < PHONE_FLOOR) fault(where, `${size.px}px is under ${PHONE_FLOOR}px, the floor for a phone's computed size`);
      continue;
    }
    const font = fontFor(glass, size);
    if (!font || typeof font.ink !== 'number') { fault(where, `${size.family} ${size.weight} is not in the instance's fonts with an ink ratio, so its ink cannot be worked out`); continue; }
    const ink = size.px * font.ink;
    if (ink < INK_FLOOR) fault(where, `${size.px}px in ${size.family} ${size.weight} inks ${ink.toFixed(1)}px (${font.ink} of its em), needs ${INK_FLOOR}px`);
  }

  /* The high key: the standard key's tokens and tags, and 7:1 on its own bare ground. */
  const highGround = parseColor(high['--kb-glass-ground']?.value);
  for (const name of Object.keys(standard)) if (!(name in high)) fault(name, 'high key lacks this token, which the standard key has');
  for (const name of Object.keys(high)) if (!(name in standard)) fault(name, 'high key names this token, which the standard key lacks');
  for (const [name, def] of Object.entries(standard)) {
    const h = high[name];
    if (!h) continue;
    if (textTags(def).join() !== textTags(h).join()) fault(name, `high key tags ${textTags(h).join('/') || 'none'} where the standard key tags ${textTags(def).join('/') || 'none'}`);
  }
  if (!highGround || highGround.a !== 1) fault('--kb-glass-ground', 'high key: not an opaque color; high contrast stands on bare ground');
  else {
    for (const [name, def] of Object.entries(high)) {
      const tags = textTags(def).filter((t) => t !== 'ink');
      const c = parseColor(def.value);
      if (!tags.length || !c || c.a !== 1) continue;
      const r = contrastRatio([c.r, c.g, c.b], [highGround.r, highGround.g, highGround.b]);
      if (r < HIGH) fault(name, `high key: ${def.value} on the bare ground ${high['--kb-glass-ground'].value} is ${fmt(r, HIGH)}, needs ${HIGH}:1 under high contrast`);
    }
  }
  return out;
}

/* ---- the ceilings ---- */

const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * The numbers the rendered measurement holds the page to: for each surface its recipe's worst and
 * calmed worst luminance (the phone's too, where the recipe has narrow layers) and, for each text
 * token of the standard key, the brightest background luminance it still meets its ratio on, by tag.
 * Where the engine's list says the surface draws a class's large text, how it is drawn there
 * (`classLarge`, full or calmed) and each class's ceiling at 3:1 (`classes`); a surface that draws
 * none carries neither, so the rendered measurement has no ceiling to pass class large text on.
 */
export function glassCeilings(glass, classLarge = CLASS_LARGE?.entries ?? {}) {
  const worsts = recipeWorsts(glass);
  const surfaces = {};
  for (const s of SURFACES) {
    const recipeName = glass.smoke?.surfaces?.[s];
    const recipe = glass.smoke?.recipes?.[recipeName];
    const w = worsts[recipeName];
    if (!recipe || !w) continue;
    const tokens = {};
    for (const [token, def] of Object.entries(glass.keys?.standard ?? {})) {
      const c = parseColor(def.value);
      const tags = textTags(def).filter((t) => t !== 'ink');
      if (!c || !tags.length) continue;
      const lum = luminance([c.r, c.g, c.b]);
      tokens[token] = Object.fromEntries(tags.map((t) => [t, round4((lum + 0.05) / NEED.standard[t] - 0.05)]));
    }
    const draw = classLarge[s];
    const drawn = draw === 'full' || draw === 'calmed';
    const classes = {};
    if (drawn) {
      for (const [key, look] of Object.entries(glass.classes ?? {})) {
        const c = parseColor(look.large);
        if (c) classes[key] = { large: round4((luminance([c.r, c.g, c.b]) + 0.05) / NEED.standard.large - 0.05) };
      }
    }
    surfaces[s] = {
      recipe: recipeName,
      calmAll: recipe.calmAll === true,
      worst: round4(w.full.luminance),
      calmedWorst: round4(w.calmed.luminance),
      ...(w.narrow ? { narrowWorst: round4(w.narrow.full.luminance), narrowCalmedWorst: round4(w.narrow.calmed.luminance) } : {}),
      tokens,
      ...(drawn ? { classLarge: draw, classes } : {}),
    };
  }
  return { surfaces };
}

/** The ceilings file's text, for each instance by name. */
export function ceilingsFile(byInstance) {
  return `${JSON.stringify(byInstance, null, 2)}\n`;
}

/** Whether the file on disk (null if there is none) differs from the text the glass computes. */
export function ceilingsStale(expected, actual) {
  return actual === null || actual === undefined || actual !== expected;
}

/* ---- the tree ---- */

/** The tracked glass.json of each instance, parsed, by repository path. */
export function treeGlass() {
  const tree = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', cwd: repoRoot }).split('\0').filter(Boolean);
  /** @type {Record<string, any>} */
  const out = {};
  for (const p of tree) if (GLASS_FILE.test(p) && fs.existsSync(path.join(repoRoot, p))) out[p] = JSON.parse(fs.readFileSync(path.join(repoRoot, p), 'utf8'));
  return out;
}

function main() {
  const all = treeGlass();
  const files = Object.keys(all);
  /* A guard reading nothing would pass; the engine's own instance always has a glass, so an empty read is a broken read. */
  if (files.length === 0 || SURFACES.length === 0) {
    console.error(`  glass-contrast: read ${files.length} glass.json file(s) and ${SURFACES.length} engine surface(s), which cannot be right; refusing to report a pass on nothing`);
    process.exit(1);
  }
  let faults = 0;
  /* The engine's list is the engine's, read once whatever the instances. */
  for (const f of classLargeFaults(CLASS_LARGE)) {
    if (faults++ === 0) console.error('  glass-contrast: the glass fails its contrast:');
    console.error(`    engine: ${f.where}: ${f.why}`);
  }
  const byInstance = {};
  for (const file of files) {
    const instance = file.match(GLASS_FILE)[1];
    for (const f of glassFaults(all[file])) {
      if (faults++ === 0) console.error('  glass-contrast: the glass fails its contrast:');
      console.error(`    ${instance}: ${f.where}: ${f.why}`);
    }
    byInstance[instance] = glassCeilings(all[file]);
  }
  if (faults) process.exit(1);
  const expected = ceilingsFile(byInstance);
  const target = path.join(repoRoot, CEILINGS_FILE);
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, expected);
    console.log(`  glass-contrast: wrote ${CEILINGS_FILE}`);
    return;
  }
  const actual = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (ceilingsStale(expected, actual)) {
    console.error(`  glass-contrast: ${CEILINGS_FILE} ${actual === null ? 'does not exist' : 'no longer matches the glass'}; run  node tools/check-glass-contrast.mjs --write  and commit it`);
    process.exit(1);
  }
  console.log(`  glass-contrast: ${files.length} glass(es), ${Object.values(byInstance).reduce((n, c) => n + Object.keys(c.surfaces).length, 0)} surface(s), every token over its smoke at its ratio; ${CEILINGS_FILE} is current`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

