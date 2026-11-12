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

/** The points as the card keeps them, each held to the box and to a ten-thousandth. */
export function encodePoints(points: readonly Pt[]): string {
  const bytes = Buffer.alloc(points.length * 4);
  let ax = 0, ay = 0;
  points.forEach(([x, y], i) => {
    const px = Math.min(UNIT, Math.max(0, Math.round(x * UNIT))), py = Math.min(UNIT, Math.max(0, Math.round(y * UNIT)));
    if (i === 0) { bytes.writeUInt16LE(px, 0); bytes.writeUInt16LE(py, 2); } else { bytes.writeInt16LE(px - ax, i * 4); bytes.writeInt16LE(py - ay, i * 4 + 2); }
    ax = px; ay = py;
  });
  return bytes.toString('base64url');
}

/** The points a string keeps, or null when it is not what `encodePoints` writes (a bad character, a length that is not whole points, a point outside the box, no points). */
export function decodePoints(s: string): Pt[] | null {
  if (typeof s !== 'string' || s.length === 0 || !BASE64URL.test(s) || s.length % 4 === 1) return null;
  const bytes = Buffer.from(s, 'base64url');
  if (bytes.length === 0 || bytes.length % 4 !== 0) return null;
  /* A length that decodes to whole points writes back to the same string: this refuses stray trailing bits. */
  if (bytes.toString('base64url') !== s) return null;
  const out: Pt[] = [];
  let ax = 0, ay = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (i === 0) { ax = bytes.readUInt16LE(0); ay = bytes.readUInt16LE(2); } else { ax += bytes.readInt16LE(i); ay += bytes.readInt16LE(i + 2); }
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
    ? { tool: 'ink', color: s.color, width: s.width, aspect: s.aspect, points, ...more, ...(s.drops !== undefined ? { drops: s.drops as 0 | 1 | 2 | 3 } : null) }
    : { tool: 'wash', width: s.width, aspect: s.aspect, points, ...more };
}
