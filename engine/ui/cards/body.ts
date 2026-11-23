/**
 * The box a card's effect paints over (the owner, 2026-11-06: "the card effect should apply to the entire post in all cases"). That box
 * is a content area: whatever element carries `data-kb-content-area` (docs/plans/2026-11-15-origin-box-effects-design.md, section 2).
 * A post's body in a thread and on the front door is one (`.kb-act-main`, border to border and bar to bar: engine/ui/thread/thread.css),
 * and the ORIGIN box's area is another, so that an effect on a post painted in either fills the bordered box it is shown in, wherever
 * among the words the effect's own element sits: a post holding one line of words is painted whole, its reactions, its signature and the
 * room below them too. The nearest area is the effect's own, so an effect in the ORIGIN box finds the box's area and never the opening
 * post's body around it. Where there is none (Stick Around's view lifts the words out of every area) the box is the effect's own
 * element. A play's moment drawn in the thread (As it landed) is inside the body, so it is painted as the live post is.
 *
 * The box is in CSS px from the element's own top-left corner, so a layer placed absolutely in the element (a positioned element) with
 * these numbers covers the body, however the words inside it are laid out. Whoops! measures the same box its own way
 * (instances/divided-world/cards/whoops/Effect.tsx), and the shine effects (Feelin' Fab, Glitter Bomb) use this.
 *
 * An effect that paints the body on a canvas does it through the tile layer (engine/ui/cards/tiles.ts), which finds and measures this box
 * itself, cuts it into tiles and holds a canvas only for the tiles near the viewport: Hot Box is the first, and the others move onto it
 * step by step (docs/plans/2026-11-16-effect-tiles-design.md, section 7). `paintScale` and `paintShare` below remain the shine effects'
 * until step 4 re-weighs them, since a tile near the view costs what it costs whatever the body's height.
 */

/** A painted box: its offset from the effect's element, and its size, in CSS px. */
export interface BodyBox {
  readonly left: number;
  readonly top: number;
  readonly w: number;
  readonly h: number;
}

/** The content area an effect paints: the nearest element above `host` (or `host` itself) that carries the marker, or null where it paints only its own element. Found afresh each time: a takeover may move the element. */
export function bodyOf(host: Element): HTMLElement | null {
  return host.closest<HTMLElement>('[data-kb-content-area]');
}

/**
 * Whether a press at `target` landed on something the engine lifts over a post's ink (`data-kb-over-ink`) that is inside `body`, the
 * content area an effect found: a press there is the lifted thing's, and starts nothing of the effect's. The nearest lifted ancestor is
 * the one that counts, and it must be in the body. A lifted thing that holds the body (the ORIGIN box, lifted over the opening post's
 * ink) is not in it, so a press in the box's words is the box's own effect's, while the same press is not the opening post's, whose
 * body holds the box. A null `body` (an effect painting only its host) counts any lifted ancestor. A text node counts as its parent; a
 * target that is no element is not lifted. A body that is itself lifted counts (a node contains itself), though no place marks its own
 * content area lifted.
 */
export function liftedOver(target: unknown, body: Element | null): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const lift = el?.closest('[data-kb-over-ink]');
  return !!lift && (body === null || body.contains(lift));
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

/**
 * Asks for (or gives up) the bright ink on a post body (docs/plans/2026-11-08-brighter-effects-design.md, section 2): an effect that
 * draws a bright look under the words marks the body, and engine/ui/thread/thread.css reads the mark, with the instance's two custom
 * properties `--kb-bright-ink` and `--kb-bright-outline`. A null body (an effect painting only its host) is nothing to mark. The mark is single-owner: one effect marks a body, and
 * gives it up when it stops painting it; two effects marking one body would clear each other's.
 */
export function markBrightInk(body: HTMLElement | null, on: boolean): void {
  body?.toggleAttribute('data-kb-bright-ink', on);
}

/**
 * The attribute of the words box: the one plain block the engine draws a post's words in (cards/Effects.tsx), which an effect
 * that bends the words filters.
 */
export const WORDS_BOX = 'data-kb-words-box';

/** The attribute a layer that fills a content area carries to be bent with the area (engine/ui/thread/thread.css reads it). */
export const BEND_LAYER = 'data-kb-bend';

/**
 * A bend (docs/plans/2026-11-23-dent-bend-design.md, section 2.3): each a CSS `filter` value, such as `url("#id")`. `area` is in
 * the content area's coordinates, `words` in the words box's.
 */
export interface Bend {
  readonly area: string;
  readonly words: string;
}

/**
 * Bends (or stops bending) a post's body: sets `--kb-bend` and `--kb-bend-words` inline on the content area `area`, which every
 * layer marked `BEND_LAYER` and the words box inherit (engine/ui/thread/thread.css). Where there is no area (Stick Around's view
 * lifts the words out of every area) only `--kb-bend-words` is set, on `host`, the effect's own element, and no layer bends. A
 * null `bend` removes what was set. Single-owner, as `markBrightInk` is: one effect bends an area, and gives the bend up with the
 * same `area` and `host` it set it on (an effect whose area changes gives the old one up first).
 */
export function setBend(area: HTMLElement | null, host: HTMLElement, bend: Bend | null): void {
  const set = (el: HTMLElement, name: string, value: string | undefined) => (value === undefined ? el.style.removeProperty(name) : el.style.setProperty(name, value));
  if (area) set(area, '--kb-bend', bend?.area);
  set(area ?? host, '--kb-bend-words', bend?.words);
}

/**
 * The words box of the content area `host`: the first one inside it whose nearest content area is `host`'s own, so a box inside
 * a nested area (an ORIGIN box) is never taken.
 */
export function wordsBoxOf(host: HTMLElement): HTMLElement | null {
  const own = bodyOf(host);
  for (const box of host.querySelectorAll<HTMLElement>(`[${WORDS_BOX}]`)) if (bodyOf(box) === own) return box;
  return null;
}
