/**
 * What the card-art and gear-art guards read art files with, held once: the SVG helpers, the safety reading of an SVG
 * (`safetyFaults`), and a WebP header reader (`webpInfo`) that decodes nothing. tools/check-card-art.mjs and
 * tools/check-gear-art.mjs (docs/plans/2026-11-23-rendered-gear-design.md, section 3) each hold their own rules over
 * these; tools/check-theme.mjs reads a theme's inline SVG with `safetyFaults` too. The reading's reasoning is in the
 * header of tools/check-card-art.mjs (rule 6, the hostile cases, and what a WebP reading does not catch), whose
 * self-test, tools/test-card-art.mjs, drives it red; tools/test-gear-art.mjs drives it red again through the gear guard.
 */
import fs from 'node:fs';

/** What a card's or an item's key looks like: lowercase words joined by hyphens. A folder named any other way is a tool's leavings. */
export const KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

/** The file at a path, or null when there is none. */
export function read(file) {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return null;
    throw e;
  }
}

/**
 * Every `name=value` in a text, quoted either way or bare: [name, value] with the name's case kept. A name starts only
 * where the character before it cannot be part of one, so a long run of name characters with no `=` after it (a
 * comment, a title) is tried once, not again from each of its characters: the reading stays linear in the file.
 */
export function attributes(text) {
  const out = [];
  for (const m of text.matchAll(/(?<![^\s=<>"'/])([^\s=<>"'/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gu)) out.push([m[1], m[2] ?? m[3] ?? m[4]]);
  return out;
}

/** The start tags in a text whose name matches `names` (a regex source), read past a `>` inside a quoted value. */
export function tags(text, names) {
  return [...text.matchAll(new RegExp(`<(?:${names})(?![\\w:-])(?:"[^"]*"|'[^']*'|[^>"'])*>`, 'giu'))].map((m) => m[0]);
}

/** The four numbers of a viewBox value, or null. */
export function viewBoxOf(value) {
  const parts = value.trim().split(/\s+/u);
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(p) ? Number(p) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/** Faults of one SVG's root viewBox: [] when `ok(box)` holds. */
export function rootFaults(name, text, what, ok) {
  const root = tags(text.replace(/<!--[\s\S]*?-->/gu, ''), 'svg')[0];
  if (!root) return [`${name}: has no <svg> root, so it has no viewBox; ${what}`];
  const vb = attributes(root).find(([n]) => n === 'viewBox');
  if (!vb) return [`${name}: its root svg has no viewBox; ${what}`];
  const box = viewBoxOf(vb[1]);
  if (!box) return [`${name}: its viewBox "${vb[1]}" is not four numbers; ${what}`];
  return ok(box) ? [] : [`${name}: its viewBox is "${vb[1].trim()}"; ${what}`];
}

/** Faults of an SVG that runs or reaches out (rule 6 and the hostile cases). tools/check-theme.mjs reads a theme's inline SVG with it too. */
export function safetyFaults(name, text) {
  const out = [];
  const lower = text.toLowerCase();
  for (const bad of ['<script', '<foreignobject', '<image', '@import', '<!doctype', '<!entity']) {
    if (!lower.includes(bad)) continue;
    const shown = bad === '<foreignobject' ? '<foreignObject' : bad;
    out.push(`${name}: holds ${shown}; an art file is vector only and runs and fetches nothing${bad === '<!doctype' ? '; delete the DOCTYPE line' : ''}`);
  }
  for (const [n, v] of attributes(text)) {
    const attr = n.toLowerCase();
    if (attr.startsWith('on')) out.push(`${name}: has the event attribute ${n}; an art file runs nothing`);
    if (attr === 'xml:base') out.push(`${name}: has xml:base, which re-bases every relative reference`);
    if (/^(?:[\w-]+:)?href$/u.test(attr) && !v.startsWith('#')) out.push(`${name}: has ${n}="${v.slice(0, 60)}"; an href must start with # (a reference inside the file)`);
    if (/&#/u.test(v)) out.push(`${name}: has a numeric character reference in ${n}="${v.slice(0, 60)}"; write the character itself, since a reference hides it from this reading`);
  }
  for (const m of text.matchAll(/url\(\s*(["']?)\s*([^)]*)/giu)) {
    if (!m[2].startsWith('#')) out.push(`${name}: has url(${m[1]}${m[2].slice(0, 60)}; every url( must start with #`);
  }
  for (const t of tags(text, 'set|animate\\w*')) {
    for (const [n, v] of attributes(t)) {
      if (n.toLowerCase() === 'attributename' && /^\s*(?:(?:[\w-]+:)?href|xml:base)\s*$/iu.test(v)) out.push(`${name}: has a ${t.match(/^<\w+/u)[0]} writing ${v.trim()}, which sets a reference after load`);
    }
  }
  return out;
}

/**
 * A WebP read by its header alone, decoding nothing: `{ width, height, alpha, animated }`, or `{ fault }` with the
 * words after the file's name ("is not a WebP image", "is not a WebP image this guard can read"). `alpha` is the flag
 * byte's bit 4 (value 16) of a `VP8X` file, the alpha hint bit of a `VP8L` file (bit 28 of the value at 21), and false
 * for a `VP8 ` file, which has none. A file shorter than its RIFF size says is a fault (cut short). `animated` is a `VP8X` file's animation flag.
 * @param {Buffer} bytes
 * @returns {{ width: number, height: number, alpha: boolean, animated: boolean } | { fault: string }}
 */
export function webpInfo(bytes) {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return { fault: 'is not a WebP image' };
  const declared = bytes.readUInt32LE(4) + 8;
  if (bytes.length < declared) return { fault: `is cut short: its header says ${declared} bytes, the file has ${bytes.length}` };
  const unreadable = { fault: 'is not a WebP image this guard can read' };
  const tag = bytes.toString('latin1', 12, 16);
  if (tag === 'VP8 ') {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return unreadable;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, alpha: false, animated: false };
  }
  if (tag === 'VP8L') {
    if (bytes[20] !== 0x2f) return unreadable;
    const v = bytes.readUInt32LE(21);
    return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1, alpha: ((v >>> 28) & 1) === 1, animated: false };
  }
  if (tag === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1, alpha: (bytes[20] & 16) !== 0, animated: (bytes[20] & 2) !== 0 };
  return unreadable;
}
