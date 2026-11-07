/**
 * What the email assets are made from, shared by tools/make-mail-assets.mjs (which writes the record)
 * and tools/check-mail.mjs (which reads it against the committed files).
 *
 * The design is docs/plans/2026-11-07-glass-mail-design.md. An instance's baked email images depend on
 * a slice of its `glass.json` (the field's layers, the `page` recipe and three colors), the coin vector
 * and four fonts. `sourceSlices` names each as canonical JSON text, so the record hashes the same bytes
 * whichever order the file's keys are written in; a change to the slice, and nothing else in
 * `glass.json`, changes the hash.
 */
import crypto from 'node:crypto';

/** The three standard-key colors the corners and the ground are drawn in. */
export const COLOR_TOKENS = ['--kb-glass-ground', '--kb-glass-field', '--kb-glass-neon'];

/** SHA-256, hex. */
export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** JSON with every object's keys sorted, recursively, and no whitespace; arrays keep their order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** One standard-key color, or a throw naming the token. */
export function glassColor(glass, token) {
  const v = glass?.keys?.standard?.[token]?.value;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`glass.json ${token}: missing or not a 6-digit hex color`);
  return v;
}

/**
 * The parts of a parsed `glass.json` the images are made from, as canonical JSON text keyed by the
 * name the record uses. Throws, naming the part, where one is missing.
 * @returns {Record<string, string>}
 */
export function sourceSlices(glass) {
  const layers = glass?.smoke?.field?.layers;
  if (!Array.isArray(layers) || layers.length === 0) throw new Error('glass.json smoke.field.layers: missing or empty');
  const page = glass?.smoke?.recipes?.page;
  if (!page || !Array.isArray(page.colors)) throw new Error('glass.json smoke.recipes.page: missing');
  const out = { 'glass.json#smoke.field.layers': canonicalJson(layers), 'glass.json#smoke.recipes.page': canonicalJson(page) };
  for (const t of COLOR_TOKENS) out[`glass.json#keys.standard.${t}`] = canonicalJson(glassColor(glass, t));
  return out;
}

/** An object with its keys sorted, so the record's text does not depend on the order written. */
export const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));

/** The size of each image, shared with the check. */
export const SMOKE = { width: 1200, height: 360, maxBytes: 60 * 1024 };
export const CORNER = 24;
export const COIN = 80;
