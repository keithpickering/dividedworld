/**
 * Whoops!'s saved state read as strokes: pure, so the screens and the staff's read of a play (`seen`, whoops.ts) read it alike.
 */
import { decodePoints } from './points.ts';
import type { Stroke } from './scrub.ts';

/**
 * A play's saved state, read defensively: the server checked it, but a state is data from outside. Points are packed (points.ts). A stroke saved before strokes kept
 * their proportions (no `aspect`), in the old array shape, or with a point that does not decode, is dropped, as a malformed one is.
 */
export function savedOf(saved: unknown): { strokes: Stroke[]; clean: boolean } {
  const state = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : undefined;
  const raw = state?.strokes;
  const strokes: Stroke[] = [];
  if (Array.isArray(raw)) {
    for (const s of raw as Record<string, unknown>[]) {
      if (typeof s !== 'object' || s === null || typeof s.width !== 'number' || !(s.width > 0) || typeof s.aspect !== 'number' || !(s.aspect > 0) || !Number.isFinite(s.aspect)) continue;
      const points = typeof s.points === 'string' ? decodePoints(s.points) : null;
      if (!points) continue;
      const before = strokes[strokes.length - 1];
      const start = points[0]!;
      /* A piece is joined to the one kept before it only where that one is the line it continues (a dropped stroke between them leaves it a line of its own). */
      const joins = s.continues === true && before !== undefined && before.tool === s.tool && before.width === s.width && before.aspect === s.aspect
        && (s.tool !== 'ink' || (before.tool === 'ink' && before.color === s.color))
        && before.points[before.points.length - 1]![0] === start[0] && before.points[before.points.length - 1]![1] === start[1]
        /* Only a line's last piece throws drops (the card refuses a piece that goes on after them), so a piece after drops starts a line of its own. */
        && !(before.tool === 'ink' && before.drops !== undefined);
      const more = joins ? { continues: true as const } : null;
      if (s.tool === 'wash') strokes.push({ tool: 'wash', width: s.width, aspect: s.aspect, points, ...more });
      else if (s.tool === 'ink' && typeof s.color === 'string') strokes.push({ tool: 'ink', color: s.color, width: s.width, aspect: s.aspect, points, ...more, ...(s.drops === 0 || s.drops === 1 || s.drops === 2 || s.drops === 3 ? { drops: s.drops } : null) });
    }
  }
  return { strokes, clean: state?.clean === true };
}
