/**
 * What the card keeps of a stroke's points (the ink field design, section 4): packed into one base64url string, 4 bytes a
 * point. The first point is two unsigned 16-bit integers (ten-thousandths of the box, across then down); each next point is
 * its difference from the one before as two signed 16-bit integers; all little-endian, no padding. A stroke of 500 points
 * is about 2,700 characters where the pairs of numbers it replaces were about 8,000.
 */
import type { SavedStroke } from '../whoops.ts';
import type { Pt, Stroke } from './scrub.ts';

const UNIT = 10_000;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

/* base64url without padding, over bytes: the browser has no Node `Buffer`, and this runs there. */
function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** The bytes a base64url string (already checked to be that alphabet, with no padding, and a length that is not 1 mod 4) holds; stray trailing bits are dropped, and the caller's re-encode refuses them. */
function fromBase64Url(s: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor((s.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (INDEX.get(s[i]!)! << 18) | (INDEX.get(s[i + 1]!)! << 12) | ((INDEX.get(s[i + 2] ?? 'A') ?? 0) << 6) | (INDEX.get(s[i + 3] ?? 'A') ?? 0);
    bytes[at++] = (n >> 16) & 255;
    if (i + 2 < s.length) bytes[at++] = (n >> 8) & 255;
    if (i + 3 < s.length) bytes[at++] = n & 255;
  }
  return bytes;
}

/** The points as the card keeps them, each held to the box and to a ten-thousandth. */
export function encodePoints(points: readonly Pt[]): string {
  const bytes = new Uint8Array(points.length * 4);
  const view = new DataView(bytes.buffer);
  let ax = 0, ay = 0;
  points.forEach(([x, y], i) => {
    const px = Math.min(UNIT, Math.max(0, Math.round(x * UNIT))), py = Math.min(UNIT, Math.max(0, Math.round(y * UNIT)));
    if (i === 0) { view.setUint16(0, px, true); view.setUint16(2, py, true); } else { view.setInt16(i * 4, px - ax, true); view.setInt16(i * 4 + 2, py - ay, true); }
    ax = px; ay = py;
  });
  return toBase64Url(bytes);
}

/** The points a string keeps, or null when it is not what `encodePoints` writes (a bad character, a length that is not whole points, a point outside the box, no points). */
export function decodePoints(s: string): Pt[] | null {
  if (typeof s !== 'string' || s.length === 0 || !BASE64URL.test(s) || s.length % 4 === 1) return null;
  const bytes = fromBase64Url(s);
  if (bytes.length === 0 || bytes.length % 4 !== 0) return null;
  /* A length that decodes to whole points writes back to the same string: this refuses stray trailing bits. */
  if (toBase64Url(bytes) !== s) return null;
  const view = new DataView(bytes.buffer);
  const out: Pt[] = [];
  let ax = 0, ay = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (i === 0) { ax = view.getUint16(0, true); ay = view.getUint16(2, true); } else { ax += view.getInt16(i, true); ay += view.getInt16(i + 2, true); }
    if (ax < 0 || ax > UNIT || ay < 0 || ay > UNIT) return null;
    out.push([ax / UNIT, ay / UNIT]);
  }
  return out;
}

/** A stroke as the card saves it: the same stroke with its points packed. Nothing writes the array shape. */
export function packStroke(s: Stroke): SavedStroke {
  const points = encodePoints(s.points);
  const more = s.continues ? { continues: true as const } : null;
  return s.tool === 'ink'
    ? { tool: 'ink', color: s.color, width: s.width, aspect: s.aspect, points, ...more, ...(s.drops !== undefined ? { drops: s.drops } : null) }
    : { tool: 'wash', width: s.width, aspect: s.aspect, points, ...more };
}
