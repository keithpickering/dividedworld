/**
 * The box a card's effect paints over (the owner, 2026-11-06: "the card effect should apply to the entire post in all cases"). In a
 * thread post it is the post body's padding box (`.kb-act-main`, border to border and bar to bar: engine/ui/thread/thread.css), wherever
 * among the post's words the effect's own element sits, so a post holding one line of words is painted whole, its reactions, its
 * signature and the room below them too. Anywhere else (the ORIGIN box, Stick Around's view) there is no such body, and the box is the
 * effect's own element. A play's moment drawn in the thread (As it landed) is inside the body, so it is painted as the live post is.
 *
 * The box is in CSS px from the element's own top-left corner, so a layer placed absolutely in the element (a positioned element) with
 * these numbers covers the body, however the words inside it are laid out. Whoops! measures the same box its own way
 * (instances/divided-world/cards/whoops/Effect.tsx), and the shine effects (Feelin' Fab, Glitter Bomb) use this.
 */
import type { EffectPlace } from './types.ts';

/** A painted box: its offset from the effect's element, and its size, in CSS px. */
export interface BodyBox {
  readonly left: number;
  readonly top: number;
  readonly w: number;
  readonly h: number;
}

/** The post body an effect drawn at `place` paints, or null where it paints only its own element. Found afresh each time: a takeover may move the element. */
export function bodyOf(host: Element, place: EffectPlace): HTMLElement | null {
  return place === 'thread' ? host.closest<HTMLElement>('.kb-act-main') : null;
}

/** The box to paint, from `host`'s top-left: the body's padding box when there is a body, else the host's own box. */
export function bodyBox(host: HTMLElement, body: HTMLElement | null): BodyBox {
  const h = host.getBoundingClientRect();
  if (!body) return { left: 0, top: 0, w: h.width, h: h.height };
  const b = body.getBoundingClientRect();
  return { left: b.left + body.clientLeft - h.left, top: b.top + body.clientTop - h.top, w: body.clientWidth, h: body.clientHeight };
}

/** Whether two boxes are the same, to the px's hundredth: a measure that moved nothing changes nothing. */
export function sameBox(a: BodyBox, b: BodyBox): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.01;
  return near(a.left, b.left) && near(a.top, b.top) && near(a.w, b.w) && near(a.h, b.h);
}

/** The least share of the density a painted box is drawn at: a line of words in a tall body is drawn no softer than this. */
const LEAST_SCALE = 0.5;

/**
 * The share of its density a shine effect draws a painted box at, so that painting the whole body costs no more pixels than the
 * words' own box did at full density (`own` and `painted` are areas, in CSS px squared): the square root of their ratio, at most 1.
 * The cost of a canvas grows with its pixels, the loop's and the worker's time with it, and a busy page's frames with that (on CI the
 * whole body at full density doubled both and dropped frames). A post of a line or two in a tall body would be drawn very soft by the
 * ratio alone, so the share stops at half: such a post costs a little more than its words did, never more than its body at half density.
 */
export function paintScale(own: number, painted: number): number {
  if (painted <= 0) return 1;
  return Math.min(1, Math.max(LEAST_SCALE, Math.sqrt(Math.max(0, own) / painted)));
}

/** The least share of the redraw rate a painted box is redrawn at: a line of words in a tall body still shimmers at 15 draws a second. */
const LEAST_SHARE = 0.25;

/**
 * The share of the shine loop's rate a shine effect redraws a painted box at (engine/ui/shine/loop.ts `Options.share`, issue #304), so
 * that painting the whole body changes no more of the screen in a second than the words' own box did at the full rate (`own` and
 * `painted` are areas, in CSS px squared): their ratio, at most 1. Holding the pixels (`paintScale`) holds what a draw costs to
 * raster, but every draw still changes the body's whole area on screen, and a software-composited page pays for the area a frame
 * changes (on CI the whole body at the full rate roughly doubled it, and the busy thread's scroll dropped frames). A post of a line or
 * two in a tall body would shimmer very slowly by the ratio alone, so the share stops at a quarter.
 */
export function paintShare(own: number, painted: number): number {
  if (!(painted > 0) || !Number.isFinite(own)) return 1;
  return Math.min(1, Math.max(LEAST_SHARE, Math.max(0, own) / painted));
}

/** Places `layer` (absolutely positioned in its effect's element) over `box`. */
export function placeLayer(layer: HTMLElement, box: BodyBox): void {
  layer.style.left = `${box.left}px`;
  layer.style.top = `${box.top}px`;
  layer.style.width = `${box.w}px`;
  layer.style.height = `${box.h}px`;
}
