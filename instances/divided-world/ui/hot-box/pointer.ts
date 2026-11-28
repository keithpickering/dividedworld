/**
 * The reader's pointer over a fog (moved out of `Effect.tsx` unchanged when Steel Chair's puff came to be cleared the way Hot Box's smoke is,
 * docs/plans/2026-11-23-steel-chair-objects-design.md, section 4): a mouse or pen moves the fog aside where it points, a finger where it touches or drags,
 * and each leaves a wake. It keeps only what the effect that uses it gives it a place for (`PointerModel`): the clearings and the trail, in the smoke's box's px, which
 * `smoke.ts` says how open they are and `fog.ts` makes into a field. Nothing is saved, sent or counted.
 */
import { useEffect, useRef } from 'react';
import { SMOKE, extendTrail, openness, type Clearing, type TrailPoint } from './smoke.ts';

/** A pointer that has not moved for this long drags nothing, and its clearing is fog at rest to the painter, ms. */
export const IDLE_MS = 60;

/**
 * What the pointer has done to a fog, in memory only: the mouse's clearing, the last touch's, the clearings left behind and the trail. `moves` is where the pointer last was
 * (three of them, for its speed) and `mover` whose clearing it is moving.
 */
export interface PointerModel {
  mouse: Clearing | null;
  touch: Clearing | null;
  rest: Clearing[];
  trail: TrailPoint[];
  moves: { readonly x: number; readonly y: number; readonly t: number }[];
  mover: 'mouse' | 'touch' | null;
}
export const emptyPointer = (): PointerModel => ({ mouse: null, touch: null, rest: [], trail: [], moves: [], mover: null });

/** A clearing that has closed and rolled out for good. */
export const dead = (c: Clearing, now: number): boolean => c.leftAt !== null && now >= c.leftAt + c.hold + SMOKE.roll;

/** The clearings and trail points that are gone at `now` are dropped. */
export function prunePointer(m: PointerModel, now: number): void {
  m.rest = m.rest.filter((c) => !dead(c, now));
  if (m.touch && dead(m.touch, now)) m.touch = null;
  if (m.trail.length > 0 && now - m.trail[0]!.leftAt >= SMOKE.wake) m.trail = m.trail.filter((p) => now - p.leftAt < SMOKE.wake);
}

/** The clearings the pointer holds that are open at `now`. */
export const openClearings = (m: PointerModel, now: number, reduced: boolean): Clearing[] =>
  [m.mouse, m.touch, ...m.rest].filter((c): c is Clearing => c !== null && openness(c, now, reduced) > 0);

/** How fast the pointer is moving, px a second, over its last moves; nothing once it has been still for `IDLE_MS`. */
export function velocityOf(m: PointerModel, now: number): { x: number; y: number } {
  const a = m.moves[0], b = m.moves[m.moves.length - 1];
  if (!a || !b || a === b || now - b.t > IDLE_MS || b.t <= a.t) return { x: 0, y: 0 };
  const s = (b.t - a.t) / 1000;
  return { x: (b.x - a.x) / s, y: (b.y - a.y) / s };
}

/** What the pointer's owner gives it: the model it fills, the page's clock, a clearing's radius now, whether an event is on something lifted over the fog, and what to do when it changed. */
export interface PointerOptions {
  readonly model: { readonly current: PointerModel };
  readonly now: () => number;
  readonly radius: () => number;
  /**
   * Whatever the engine lifts over the ink inside the area (the reactions row, the ORIGIN box's History) is a way through of its own and not the words: a press on one clears nothing.
   */
  readonly lifted: (e: Event) => boolean;
  /** The reader changed something at `y` of the area: draw it. */
  readonly changed: (y: number) => void;
}

/* ---- the pointer: on the row (the content area where there is none), passive, never prevented, never captured ---- */
export function usePointerClearings(areaEl: HTMLElement | null, options: PointerOptions): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!areaEl) return;
    /* The pointer is read on the row, which the fog fills (the content area where there is no row) (the host where there is none), and placed in its padding box. */
    const area = areaEl;
    const model = { get current() { return latest.current.model.current; } };
    const now = () => latest.current.now();
    const changed = (y: number) => latest.current.changed(y);
    const lifted = (e: Event) => latest.current.lifted(e);
    const at = (e: PointerEvent) => { const r = area.getBoundingClientRect(); return { x: e.clientX - r.left - area.clientLeft, y: e.clientY - r.top - area.clientTop }; };
    /* Where the pointer is now: its clearing moves there, its speed is kept from its last three moves, and the trail takes the point. */
    const track = (who: 'mouse' | 'touch', x: number, y: number, t: number) => {
      const m = model.current;
      if (m.mover !== who) m.moves = [];
      m.mover = who;
      m.moves = [...m.moves.slice(-2), { x, y, t }];
      m.trail = extendTrail(m.trail, x, y, t, latest.current.radius());
    };
    const follow = (e: PointerEvent) => {
      const m = model.current, { x, y } = at(e), t = now();
      m.mouse = { x, y, openedAt: m.mouse?.openedAt ?? t, leftAt: null, hold: 0 };
      track('mouse', x, y, t);
      return y;
    };
    /* The mouse's clearing closes where it is and rolls out, as when the pointer leaves the area. */
    const closeMouse = () => {
      const m = model.current;
      if (!m.mouse) return;
      const y = m.mouse.y;
      m.rest.push({ ...m.mouse, leftAt: now() });
      m.mouse = null;
      if (m.mover === 'mouse') { m.mover = null; m.moves = []; }
      changed(y);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        /* A finger moves only while it is down: its clearing goes with it and holds `touchHold` from where it was last, and its drag leaves a wake. A swipe the browser takes for a scroll sends no move. */
        const m = model.current;
        if (!m.touch || lifted(e)) return;
        const { x, y } = at(e), t = now();
        m.touch = { x, y, openedAt: m.touch.openedAt, leftAt: t, hold: SMOKE.touchHold };
        track('touch', x, y, t);
        changed(y);
        return;
      }
      /* Pointing at a lifted thing ends the clearing, or the words beside it are read for free. */
      if (lifted(e)) { closeMouse(); return; }
      changed(follow(e));
    };
    const onDown = (e: PointerEvent) => {
      if (lifted(e)) { if (e.pointerType !== 'touch') closeMouse(); return; }
      if (e.pointerType === 'touch') {
        /* A finger cannot stay in place and scroll too: its clearing is opened where it lands and holds `touchHold`, replacing the last. */
        const { x, y } = at(e), t = now(), m = model.current;
        m.touch = { x, y, openedAt: t, leftAt: t, hold: SMOKE.touchHold };
        m.mover = 'touch';
        m.moves = [{ x, y, t }];
        changed(y);
      } else changed(follow(e));
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') closeMouse();
    };
    const passive = { passive: true } as const;
    area.addEventListener('pointermove', onMove, passive);
    area.addEventListener('pointerdown', onDown, passive);
    area.addEventListener('pointerleave', onLeave, passive);
    return () => {
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerdown', onDown);
      area.removeEventListener('pointerleave', onLeave);
    };
  }, [areaEl]);
}
