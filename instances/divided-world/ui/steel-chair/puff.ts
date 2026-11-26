/**
 * The extinguisher's puff as a model (docs/plans/2026-11-23-steel-chair-objects-design.md, section 4, and its
 * addendum of 2026-11-25: the owner approved these numbers, the bench's starting ones,
 * docs/research/2026-11-23-steel-chair-objects/01-puff.html). White smoke jets from the spout, billows out to fill the post's content area border
 * to border, holds, and fades. Pure: no DOM and no clock; the caller says how many ms have passed since the puff began. The drawing is
 * `hot-box/fog.ts`'s field, which this gives its floor (`puffTarget`) and its opacity (`puffAlpha`) at each moment.
 */

export const PUFF = {
  /** The fog's color, shaded by the field's own lighting. */
  color: '#f2f4f7',
  /** How long the jet from the spout runs before the billow takes over (drawn by the caller; the front itself is `billowMs`'s). */
  jetMs: 250,
  /** From the spout to every corner of the box. */
  billowMs: 600,
  /** Whole, once it has filled. */
  holdMs: 400,
  /** Straight down to nothing. */
  fadeMs: 4000,
  /** The opacity of fog that is whole (0 to 1). */
  full: 0.9,
} as const;

/** The spout, in the box's px. */
export interface PuffPoint { readonly x: number; readonly y: number }
/** The content area the puff fills, in px. */
export interface PuffBox { readonly width: number; readonly height: number }

/** How far past the farthest corner the front goes at `billowMs`, so a corner is inside it and not on it. */
const OVERSHOOT = 1.08;

/** The billow's front, px from the spout: 0 at the start, eased out, past the box's farthest corner at `billowMs`, and there after. */
export function puffFront(spout: PuffPoint, box: PuffBox, ms: number): number {
  const reach = Math.max(
    Math.hypot(spout.x, spout.y), Math.hypot(box.width - spout.x, spout.y),
    Math.hypot(spout.x, box.height - spout.y), Math.hypot(box.width - spout.x, box.height - spout.y),
  ) * OVERSHOOT;
  const t = Math.min(1, Math.max(0, ms / PUFF.billowMs));
  return reach * (1 - (1 - t) * (1 - t) * (1 - t));
}

/** A `FogInput` target: 0 (no fog) for a point outside the front, 1 (all of it) for a point inside. */
export function puffTarget(spout: PuffPoint, box: PuffBox, ms: number): (x: number, y: number) => number {
  const front = puffFront(spout, box, ms), reach = front * front, sx = spout.x, sy = spout.y;
  /* Asked of every cell of the held rows every frame: the squared distance against the squared front, so no root and no `hypot` is taken per cell. */
  return front > 0 ? (x, y) => { const dx = x - sx, dy = y - sy; return dx * dx + dy * dy <= reach ? 1 : 0; } : () => 0;
}

/** The whole fog's opacity: `full` until the hold ends, then a straight line to 0 over `fadeMs`. */
export function puffAlpha(ms: number): number {
  const into = ms - (PUFF.billowMs + PUFF.holdMs);
  return into <= 0 ? PUFF.full : PUFF.full * Math.max(0, 1 - into / PUFF.fadeMs);
}

/** True from the end of the fade. */
export function puffDone(ms: number): boolean {
  return ms >= PUFF.billowMs + PUFF.holdMs + PUFF.fadeMs;
}
