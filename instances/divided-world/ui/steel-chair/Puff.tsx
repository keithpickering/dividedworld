/**
 * The extinguisher's puff (docs/plans/2026-11-23-steel-chair-objects-design.md, section 4, and its addendum of 2026-11-25): white smoke jets from the spout, billows
 * to fill the post's content area border to border, holds, and fades, in about 5 s (`puff.ts` says when and how far; the owner approved its numbers on the bench,
 * docs/research/2026-11-23-steel-chair-objects/01-puff.html). It is drawn with Hot Box's machinery and nothing of Hot Box's effect: the fog of `hot-box/fog.ts` (a field that
 * starts empty, `emptyField`, and is stepped over the whole content area while it runs, `whole`, filling in fast inside the front, `fill`, with a jet from the spout),
 * painted in the engine's tiles (`makeTileLayer`) as Hot Box paints its smoke, and cleared by the reader's pointer as Hot Box's is (`hot-box/pointer.ts`, with Hot Box's own
 * figures: the same radius, the same clearing, the same wake).
 *
 * It is not an obstacle. It is gone within about 5 s, so the words are never made inert, no control waits on it, no live region is set and the Lens gains nothing; a canvas
 * takes no pointer (the layer sets `pointer-events: none`), so a press on a link under it is the link's. The pointer's clearing is play and no way through. Waiting a few
 * seconds costs every reader the same (CLAUDE.md, "An accessible path costs what the obstacle costs"). It fills the content area border to border, the box the layer finds
 * (`bodyOf`, `bodyBox`), in a thread and in a spun thread's ORIGIN box alike (CLAUDE.md, "An effect fills the post, border to border").
 *
 * Reduced motion has no flight and no puff, and forced colors cannot draw fog in system colors and the puff hides nothing for long: both draw nothing and make no layer.
 *
 * Cost. A puff steps the whole content area for its 5 s, where Hot Box steps only what is disturbed, so it takes its rungs from the page's one ladder (`hot-box/ladder.ts`) and
 * gives it its time with every smoked post's: over the budget it is the first to step down (it is `transient`), so a smoked post never goes down a rung for a puff that is
 * gone in 5 s, and a puff that steps down is cheaper for the rest of its life (bigger cells, fewer rounds, then drawn from the model with no field). Only the rows of the tiles the
 * layer holds are stepped and stored (the field's `view`), and only those rows are drawn, so a tall post costs what is seen and a held tile outside them is left clear. The rung a puff steps down
 * to is kept on the page's ladder (`ladder.transientLevel`) and the next puff starts there, so a slow device is over the budget for the first judgment of one puff and not of every one; the last two rungs
 * scale the cells with the bilinear filter, where the rungs the owner approved use the cubic one. At a busy instance's scale a page holds at most one puff for each post in view that
 * has an extinguisher thrown, and at 2% of plays that is rarely two.
 *
 * It reads the page's clock, `api.now()`, for the puff's own time and the reader's clearings, and the painter's cost is a duration on the page's timer (`performance.now`),
 * as Hot Box's is.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { bodyOf, liftedOver, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import { makeTileLayer, type TileDraw, type TileLayer } from '../../../../engine/ui/cards/tiles.ts';
import type { EffectPlace } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { rgbOf } from '../../cards/whoops/splat.ts';
import { FOG, coverageOf, emptyField, pageCloud, paintFog, rowsOf, cellOrigin, stepField, makeField, type FogClearing, type FogField } from '../hot-box/fog.ts';
import { FOG_LEVEL_MOST, RUNGS, forcedFogLevel, ladder, nextPainterId, spend, type Rung } from '../hot-box/ladder.ts';
import { forgetScratch, scratchFor, useForcedColors } from '../hot-box/paint.ts';
import { emptyPointer, openClearings, prunePointer, usePointerClearings, velocityOf } from '../hot-box/pointer.ts';
import { holeRadius } from '../hot-box/smoke.ts';
import { PUFF, puffAlpha, puffDone, puffFront, puffTarget } from './puff.ts';

export { forgetScratch };

/** How long fog takes to fill in inside the front, ms: the bench's "Fill lag" of 8, which is 0.08 s (the puff's fog is made fast; Hot Box's wake is `SMOKE.wake`, 1.5 s). */
export const FILL_MS = 80;
/** The jet's push at its start, px a second, falling to nothing over `PUFF.jetMs` (the bench's `JET_PX_S`). */
const JET_PX_S = 900;

/**
 * The rung a puff starts at, where Hot Box starts at 0: a puff steps the whole of what is drawn for 5 s (Hot Box steps only what is disturbed), and it is gone before the ladder's
 * first judgment (8 frames, then a step a judgment) has taken it to the rung its cost needs, so a puff that began at rung 0 spent a fifth of its life over the budget on every
 * page that drew it. Rung 2 draws it in 10 px cells (the fog's own texture is finer than that and scaled up smooth), with the flow, the jet and the pointer's clearing as ever;
 * the ladder lowers it further, and never raises it.
 */
const START_LEVEL = 2;
/** How far past the window's top and bottom the field is stepped, CSS px: a few frames of a fast scroll, so a row is stepped before it is seen. */
export const STEP_MARGIN = 96;
/** The first rung whose cells are scaled up with the bilinear filter (`imageSmoothingQuality` 'low') and not the cubic one: the rungs from which the puff is on a device too slow for the look. */
const LOW_FILTER_LEVEL = 3;

/** The spout, in the content area's px. */
export interface PuffSpout { readonly x: number; readonly y: number }

export interface PuffProps {
  /** The element the layer is made on: the effect's own, where the box is found from. */
  readonly host: HTMLElement;
  readonly place: EffectPlace;
  readonly spout: PuffSpout;
  /** Told once when the puff is over, after its layer is gone. */
  readonly done?: () => void;
}

/** What the painter keeps between frames: the field, the rung, when it last stepped, which tiles it has painted in the frame it is in, and the ladder's count of frames at its last paint. */
interface Painter { field: FogField | null; level: number; view: { top: number; bottom: number } | null; steppedAt: number; stamp: number | null; seen: Set<number>; paintedIn: number }

/**
 * The rows (the box's px) a frame's step is for: what the window shows of the tiles the layer holds, and `STEP_MARGIN` more each side. The layer holds the tiles within 256 px of the window, which
 * is twice the window's rows on a phone and a third more on a desktop, and a row that is not seen costs a step as a row that is. A row outside it is resting fog until the window nears it, and is seeded
 * from the puff's front when it is stepped first (`field.seed`), as a row the layer has not held is. Where no held tile is near the window, all of the held tiles' rows.
 */
function stepRows(layer: TileLayer | null): { top: number; bottom: number } | null {
  let top = Number.POSITIVE_INFINITY, bottom = Number.NEGATIVE_INFINITY, from = top, to = bottom;
  const vh = window.innerHeight;
  for (const tile of layer?.held() ?? []) {
    from = Math.min(from, tile.top); to = Math.max(to, tile.top + tile.h);
    const r = tile.sheets[0]?.getBoundingClientRect();
    if (!r || r.height <= 0) continue;
    /* The tile's rows that lie in the window (and its margin), in the box's px. */
    const a = Math.max(tile.top, tile.top + (-STEP_MARGIN - r.top)), b = Math.min(tile.top + tile.h, tile.top + (vh + STEP_MARGIN - r.top));
    if (b > a) { top = Math.min(top, a); bottom = Math.max(bottom, b); }
  }
  if (bottom > top) return { top, bottom };
  return to > from ? { top: from, bottom: to } : null;
}

const a4 = (n: number): number => Number(n.toFixed(4));
const COLOR = rgbOf(PUFF.color);

/** The puff: nothing drawn but its layer's tiles. Renders no element. */
export function Puff({ host, place, spout, done }: PuffProps): null {
  const { api } = useKayfa();
  const reduced = useMotionReduced();
  const forced = useForcedColors();
  const on = !reduced && !forced;
  const layerRef = useRef<TileLayer | null>(null);
  const model = useRef(emptyPointer());
  const startedAt = useRef(api.now());
  const own = useMemo(() => nextPainterId(), []);
  const painter = useRef<Painter>({ field: null, level: Math.max(START_LEVEL, ladder.transientLevel), view: null, steppedAt: api.now(), stamp: null, seen: new Set(), paintedIn: Number.NEGATIVE_INFINITY });
  const [areaEl, setAreaEl] = useState<HTMLElement | null>(null);
  const latest = useRef({ spout, done, box: { w: 0, h: 0 } });
  latest.current = { spout, done, box: latest.current.box };
  const finished = useRef(false);

  /* The box the layer found: the content area (a post's body, or an ORIGIN box's area), or the host where there is none. The pointer is read on it. */
  const take = useCallback((b: BodyBox, found: HTMLElement | null) => {
    latest.current.box = { w: b.w, h: b.h };
    setAreaEl(found ?? host);
  }, [host]);

  /** The puff is over: its layer is gone and it is told, once. */
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    layerRef.current?.stop();
    layerRef.current = null;
    painter.current.field = null;
    latest.current.done?.();
  }, []);

  /* A frame has turned: the pointer's model is caught up and the field is stepped once (never once a tile), over the whole box, with the puff's front as its floor. */
  const turn = useCallback((t: number, ms: number, field: FogField, radius: number, direct: boolean, rounds: number) => {
    const m = model.current, p = painter.current, layer = layerRef.current;
    prunePointer(m, t);
    const dt = t - p.steppedAt;
    p.steppedAt = t;
    /* The rows this frame is for: what is stepped, and so all that is drawn (a row outside it has not moved since it was last in it). */
    const view = stepRows(layer);
    p.view = view;
    if (direct) return;
    const box = latest.current.box, at = latest.current.spout;
    const clearings = openClearings(m, t, false);
    const v = velocityOf(m, t), mover = m.mover === 'mouse' ? m.mouse : m.mover === 'touch' ? m.touch : null;
    const fog: FogClearing[] = clearings.map((c) => ({
      x: c.x, y: c.y,
      ...(c === mover ? { vx: v.x, vy: v.y } : {}),
      burst: c === m.touch && t - c.openedAt < FOG.burst.ms,
    }));
    const floor = puffTarget(at, { width: box.w, height: box.h }, ms), cover = coverageOf(clearings, radius, t, false, m.trail);
    field.seed = floor;
    stepField(field, dt, {
      clearings: fog, trail: m.trail, radius, rounds, whole: true, fill: FILL_MS,
      ...(view ? { view } : {}),
      /* The puff's front is the floor, the reader's clearing cuts it: the least of the two, as the bench's. */
      target: (x, y) => Math.min(floor(x, y), cover(x, y)),
      ...(ms < PUFF.jetMs ? { jet: { x: at.x, y: at.y, speed: (1 - ms / PUFF.jetMs) * JET_PX_S, reach: Math.max(radius * FOG.reach, puffFront(at, { width: box.w, height: box.h }, ms)) } } : {}),
    });
  }, []);

  const paintTile = useCallback((draw: TileDraw) => {
    const { ctx, box } = draw, p = painter.current;
    const { w, h } = box;
    if (w <= 0 || h <= 0 || finished.current) return;
    const began = performance.now();
    const t = api.now(), ms = t - startedAt.current;
    if (puffDone(ms)) return;
    /* The layer paints its first tiles in the commit that makes it, outside a frame, before the puff has any fog to show. */
    if (draw.frame === null && ms < PUFF.billowMs) return;
    const rung = RUNGS[forcedFogLevel() ?? p.level]!;
    const direct = rung.direct, at = latest.current.spout, size = { width: w, height: h };
    if (!p.field || p.field.width !== w || p.field.height !== h || p.field.cell !== rung.cell) {
      /* Made from the puff as it stands, so a field made again at a new rung (or a new size) is not empty in the middle of the puff. A field with no store is all that a direct rung needs. */
      const front = puffTarget(at, size, ms);
      p.field = direct ? makeField(w, h, rung.cell) : emptyField(w, h, rung.cell, { seed: front, view: stepRows(layerRef.current) ?? { top: draw.top, bottom: draw.top + draw.h } });
    }
    const field = p.field, radius = holeRadius(w);
    if (draw.frame !== null && (draw.frame !== p.stamp || p.seen.has(draw.index))) {
      p.stamp = draw.frame;
      p.seen.clear();
      turn(t, ms, field, radius, direct, rung.rounds);
    }
    p.seen.add(draw.index);
    const alpha = puffAlpha(ms);
    /* Only the rows that were stepped are drawn: a tile the layer holds that lies outside them (it is held out to 256 px from the window, the step goes 96 px past it) is left clear, as a row is at rest where it is not seen. */
    const seen = draw.frame === null ? stepRows(layerRef.current) : p.view;
    const from = seen ? Math.max(draw.top, seen.top) : draw.top, to = seen ? Math.min(draw.top + draw.h, seen.bottom) : draw.top + draw.h;
    if (to <= from) {
      spend(`${own}:${draw.index}`, draw.frame, performance.now() - began, true);
      if (draw.frame !== null) p.paintedIn = ladder.frames;
      return;
    }
    const rows = rowsOf(field, from, to), n = rows.y1 - rows.y0;
    const sc = scratchFor(field.gw, n);
    if (!sc) {
      /* No scratch canvas: the front as a flat disc, so the puff is still seen filling the box. */
      ctx.fillStyle = `rgba(${COLOR[0]}, ${COLOR[1]}, ${COLOR[2]}, ${a4(alpha)})`;
      ctx.beginPath();
      ctx.arc(at.x, at.y, puffFront(at, size, ms), 0, Math.PI * 2);
      ctx.fill();
    } else {
      const m = model.current, cuts = openClearings(m, t, false);
      const floor = puffTarget(at, size, ms), cover = coverageOf(cuts, radius, t, false, m.trail);
      paintFog(field, pageCloud(), sc.img.data, rows, {
        color: COLOR, alpha, t: ms, phase: { x: 1301, y: 2477 },
        ...(direct ? { direct: { target: (x: number, y: number) => Math.min(floor(x, y), cover(x, y)), reach: { left: 0, top: 0, right: w, bottom: h } } } : {}),
      });
      sc.ctx.putImageData(sc.img, 0, 0);
      const o = cellOrigin(field, 0, rows.y0);
      ctx.imageSmoothingEnabled = true;
      /* The owner-approved look is the cubic filter, at the rungs the puff starts on; the last two rungs are for a device the first could not keep up on, and scale the cells with the bilinear one, which halves a frame's cost there. */
      ctx.imageSmoothingQuality = (forcedFogLevel() ?? p.level) >= LOW_FILTER_LEVEL ? 'low' : 'high';
      ctx.drawImage(sc.canvas, 0, 0, field.gw, n, o.x, o.y, field.gw * field.cell, n * field.cell);
    }
    spend(`${own}:${draw.index}`, draw.frame, performance.now() - began, true);
    if (draw.frame !== null) p.paintedIn = ladder.frames;
  }, [api, own, turn]);

  /* The layer is made in the commit that mounts the puff. Its tiles are drawn every frame: the whole box is moving for as long as the puff lasts. */
  useLayoutEffect(() => {
    if (!on) return;
    const layer = makeTileLayer(host, { place, density: 1, className: 'dw-chair-puff', paint: paintTile, onBox: take });
    layerRef.current = layer;
    layer.loop(true);
    return () => { layer.stop(); if (layerRef.current === layer) layerRef.current = null; painter.current.field = null; };
  }, [on, host, place, paintTile, take]);

  /* Gone at `puffDone`: a timer for the end, set again if it fires early (a page clock that is not the timer's), so no frame is needed to end it. */
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (): void => {
      const left = PUFF.billowMs + PUFF.holdMs + PUFF.fadeMs - (api.now() - startedAt.current);
      if (puffDone(api.now() - startedAt.current)) finish();
      else timer = setTimeout(check, Math.max(1, Math.ceil(left)));
    };
    check();
    return () => clearTimeout(timer);
  }, [on, api, finish]);
  /* Under reduced motion or forced colors it is over at once: nothing was made. */
  useEffect(() => { if (!on) finish(); }, [on, finish]);

  /* The ladder: the puff's own rung, a transient one that steps down first. */
  useEffect(() => {
    if (!on) return;
    const rung: Rung = {
      transient: true,
      level: () => painter.current.level,
      pointed: () => model.current.mouse !== null || model.current.touch !== null,
      paintedIn: () => painter.current.paintedIn,
      lower: (to) => {
        painter.current.level = Math.min(FOG_LEVEL_MOST, Math.max(painter.current.level + 1, to));
        ladder.transientLevel = Math.max(ladder.transientLevel, painter.current.level);
      },
    };
    ladder.rungs.add(rung);
    return () => { ladder.rungs.delete(rung); };
  }, [on]);

  /* The pointer clears it as it clears Hot Box's smoke, on the content area, passive, never prevented, never captured. */
  usePointerClearings(on ? areaEl : null, {
    model,
    now: () => api.now(),
    radius: () => holeRadius(latest.current.box.w),
    lifted: (e) => liftedOver(e.target, bodyOf(host)),
    /* The layer paints every frame, so a change reaches the screen in the next one. */
    changed: () => { prunePointer(model.current, api.now()); },
  });
  return null;
}
