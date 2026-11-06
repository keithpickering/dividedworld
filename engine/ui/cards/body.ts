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

/** Places `layer` (absolutely positioned in its effect's element) over `box`. */
export function placeLayer(layer: HTMLElement, box: BodyBox): void {
  layer.style.left = `${box.left}px`;
  layer.style.top = `${box.top}px`;
  layer.style.width = `${box.w}px`;
  layer.style.height = `${box.h}px`;
}
