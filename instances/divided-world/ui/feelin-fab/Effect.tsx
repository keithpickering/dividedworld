/**
 * Feelin' Fab's effect (docs/plans/2026-11-06-shine-design.md, sections 1, 3, 5 and 6): a holographic foil under the post's words,
 * by the count of Feelin' Fabs up on the post, one to three: level 1 is the pearl, level 2 the holo bands, level 3 the prism
 * (engine/ui/shine/foil.ts), each with 4, 8 or 10 starbursts at spots seeded from the post's and the plays' own ids, so every
 * reader sees the same ones. The foil is drawn on a canvas that fills the post and lies under the words, takes no pointer and is
 * hidden from assistive tech; the words keep their text shadow in the board's ground. It is decoration, never an obstacle, and
 * every pixel of it is held inside the readable band (engine/ui/shine/band.ts) that the board leaves free of the post's inks, so
 * nothing here needs to prove a palette's contrast at run time (the engine's check does, over the foil itself).
 *
 * The palettes are the two the board has, pastels for the light board and deep colors for the dark one, chosen per post by the
 * band: the board is dark where its band tops out under 0.5. FAB_STOPS stays in TypeScript as the one list. The band is read from
 * the tokens the board resolves for this post, after mount (it needs the element in the document), and kept: the tokens change only
 * with `data-kb-mode` on the root or the device's color scheme, so the band is read again in setup (mount and resize) and when
 * either changes, never per draw (a draw is ~30 a second per post, a read is a getComputedStyle and a few property reads). A board
 * that cannot be read draws nothing and leaves the words bare, and is read again at the next setup or board change.
 * Because a board can change while the loop sleeps (reduced motion, a post out of view), a change of `data-kb-mode` on the root or of
 * the device's color scheme asks for one more draw by itself.
 *
 * The page's one loop (engine/ui/shine/loop.ts) serves the post: it draws only while the post is in view, when the light moved, and
 * on the idle shimmer's cadence; reduced motion holds the light at rest, so it draws once. The accessible path is that stillness,
 * and it gives the same foil ("An accessible path costs what the obstacle costs"). A play's moment (`still`) is drawn once at
 * the rest light and registers nothing that moves. Nothing here reads who owns a post, who played on it, or any class: the seed is
 * `post.id` and the plays' ids, which are public.
 *
 * Where the browser has a Worker, an OffscreenCanvas and a canvas that can hand over control (`offscreenFoils`), the foil is drawn in a
 * worker (engine/ui/shine/foilClient.ts, issue #272): the render and the full-canvas draw were most of the main thread's work during a
 * busy scroll. The post hands its canvas over once (`adoptFoil`) and the loop's draw callback posts what the draw needs (the foil's
 * spec, the box, the density, the light and band read here on the main thread, the time) instead of painting; the worker makes the
 * same foil and calls the same `foil.draw`, so the look and the motion are the same. The loop still decides when the post draws, eases
 * its light and counts its draws. Everywhere else, where a worker cannot start (the hand-over is refused before anything is
 * transferred), and for a play's moment (`still`, drawn once, so a worker would only add a hop), the post draws on the main thread as
 * it always did. A transferred canvas can never be drawn on from the page again, nor handed over
 * a second time, so the `<canvas>` carries a `key` of level, seed and still: an effect that runs again (a level or a seed change)
 * gets a fresh element. A development build under React's StrictMode would run the effect twice on one element and the second
 * hand-over is refused after the first transferred it (logged, the post bare); the app does not use StrictMode.
 *
 * Where. The foil fills the post, not only its words (2026-11-06: "the card effect should apply to the entire post in all cases"): in
 * the thread the box is the post body's padding box (engine/ui/cards/body.ts, `.kb-act-main`, bar to bar), and the canvas is placed
 * over it from the host, inline; anywhere else (the ORIGIN box, Stick Around's view) it is the host's own box. Painting the body, the
 * host marks itself `data-kb-bleed` and fab.css puts the foil under everything in the body (its reactions, its signature, an ORIGIN
 * box above the words), not only under the words. The host watches the body's size as well as its own.
 *
 * Units: the box is CSS px (engine/ui/cards/body.ts `bodyBox`); the canvas is sized to round(box x density) with the density the
 * loop returns (at most 2), and its CSS size is the box's, set inline. On the page the effect sizes it; in the
 * worker the worker does, in the same task as the draw, whenever the box differs. A resize registers again and, because sizing the
 * backing store clears it, repaints at once with the last light and the band already held, rather than waiting for the loop's next draw.
 *
 * Memory: a post that leaves view frees what it holds, the foil's buffers and the canvas's own backing store (width and height 0;
 * in the worker, `free`); when it returns, the next draw sizes the canvas again and draws fresh. A board change lets the other board's
 * foil go once (on the page, by key in the worker). An unmounted post drops its canvas, and the last drop ends the worker.
 */
import { useEffect, useRef } from 'react';
import { bandFor, type Band } from '../../../../engine/ui/shine/band.ts';
import { makeFoil, type Foil, type FoilPattern } from '../../../../engine/ui/shine/foil.ts';
import { adoptFoil, isTransferred, offscreenFoils, type FoilHandle } from '../../../../engine/ui/shine/foilClient.ts';
import type { FoilSpec } from '../../../../engine/ui/shine/foilProtocol.ts';
import { bodyBox, bodyOf, paintScale, placeLayer, sameBox, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import { REST, type Light } from '../../../../engine/ui/shine/light.ts';
import { register, unregister, wake } from '../../../../engine/ui/shine/loop.ts';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import './fab.css';

/** The rainbow's stops, red to violet, for each board: pastels for the light board, deep colors for the dark one. */
export const FAB_STOPS: { readonly light: readonly string[]; readonly dark: readonly string[] } = Object.freeze({
  light: Object.freeze(['#ffb9be', '#ffc09f', '#fff2a0', '#a8e6a1', '#9fd3ff', '#d8c0ff']),
  dark: Object.freeze(['#7f0c1e', '#682d06', '#4a3d00', '#0d471e', '#133b84', '#522191']),
});
/** The starbursts' highlight, in every grade on both boards (the engine names no color; this is Divided World's). It only lightens, inside the band. */
export const FAB_GLINT = '#ffffff';
/** The foil's cell in CSS px on a box no bigger than the words (engine/ui/shine/foil.ts's default). */
const CELL = 3;
/** How many starbursts a level carries. */
const TWINKLES = [0, 4, 8, 10] as const;
/** The most Feelin' Fabs that count: the card's stack. */
const MOST = 3;
const PATTERN: readonly (FoilPattern | '')[] = ['', 'pearl', 'bands', 'prism'];

type Board = 'light' | 'dark';

export function FeelinFabEffect({ post, plays, place, still, children }: EffectProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const level = Math.max(1, Math.min(MOST, plays.length));
  const seed = `${post.id}:${plays.map((p) => p.id).join(',')}`;

  useEffect(() => {
    const el = host.current, cv = canvas.current;
    if (!el || !cv) return;
    const pattern = PATTERN[level] as FoilPattern;
    /* In a worker, unless this is a play's moment: the canvas is handed over now and cannot be drawn on from here again. */
    let remote: FoilHandle | null = null;
    if (!still && offscreenFoils()) {
      try { remote = adoptFoil(cv); } catch (err) {
        console.error(err);
        /* Refused before the canvas was handed over (no worker could start): the post draws on the page. Handed over already: it cannot be drawn on, and stays bare. */
        if (isTransferred(cv)) return;
      }
    }
    /* By board and cell (`${board}:${cell}`): a board change or a resize that coarsens the cell makes the foil afresh. */
    const specs = new Map<string, FoilSpec>();
    const foils = new Map<string, Foil>();
    const release = (): void => { for (const f of foils.values()) f.release(); };
    /* The foil's cell, coarser on a body bigger than the words, so the foil works as many cells as the words' box had (body.ts `paintScale`). */
    let cell = CELL;
    /* The size painted (what the loop and the drawing are handed) and where it stands from the host (the layer's placement). */
    let box = { w: 0, h: 0 };
    let placed: BodyBox = { left: 0, top: 0, w: 0, h: 0 };
    let density = 1;
    /* The board and cell whose foil is in use; the others are let go once, when this changes, and their references dropped. */
    let current: string | null = null;
    /* True while the backing store is freed (out of view); the next draw sizes it again. */
    let freed = false;
    /* The last light and time drawn, for a synchronous repaint after a resize cleared the canvas. */
    let last: { light: Light; t: number } | null = null;

    /* The band where this post sits, or null when the board's tokens cannot be read (nothing is drawn then). */
    const readBand = (): Band | null => {
      try { return bandFor(el); } catch (err) { console.error(err); return null; }
    };
    /* The band as last read; null until read, and again after a board that could not be read. Draws use it and never read. */
    let band: Band | null = null;
    /* In the worker: the draw is posted, with the band read here (a null band clears the canvas there). */
    const post = (handle: FoilHandle, light: Light, now: number, idle: boolean): void => {
      const board: Board = band && band.hi < 0.5 ? 'dark' : 'light';
      const key = `${board}:${cell}`;
      let spec = specs.get(key);
      if (!spec) { spec = { seed, pattern, palette: FAB_STOPS[board], stars: TWINKLES[level]!, glint: FAB_GLINT, cell }; specs.set(key, spec); }
      handle.draw(spec, key, box, density, light, band, now, idle);
    };
    const paint = (light: Light, now: number, idle: boolean): void => {
      if (remote) { post(remote, light, now, idle); return; }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      if (!band) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
      const board: Board = band.hi < 0.5 ? 'dark' : 'light';
      const key = `${board}:${cell}`;
      /* A board or cell change lets the other foils go, once: only the one in use holds buffers. */
      if (key !== current) {
        for (const [k, f] of [...foils]) if (k !== key) { f.release(); foils.delete(k); }
        current = key;
      }
      let foil = foils.get(key);
      if (!foil) { foil = makeFoil({ seed, pattern, palette: FAB_STOPS[board], stars: TWINKLES[level]!, glint: FAB_GLINT, cell }); foils.set(key, foil); }
      foil.draw(ctx, box, density, light, band, now, idle);
    };
    const size = (): void => {
      cv.width = Math.round(box.w * density);
      cv.height = Math.round(box.h * density);
      freed = false;
    };
    /* Out of view: the foil's buffers and the post's own backing store both go; the next draw sizes and draws fresh. */
    const leave = (): void => {
      if (remote) remote.free(); else { release(); cv.width = cv.height = 0; }
      freed = true;
    };
    /* The body this paints, found again at each measure (a takeover moves the words), and watched for its size as the host is. */
    let body: HTMLElement | null = null;
    const measure = (): BodyBox => {
      const now = bodyOf(el, place);
      if (now !== body) {
        if (body) resize?.unobserve(body);
        if (now) resize?.observe(now);
        body = now;
        el.toggleAttribute('data-kb-bleed', body !== null);
      }
      return bodyBox(el, body);
    };
    const setup = (): void => {
      band = readBand();
      placed = measure();
      box = { w: placed.w, h: placed.h };
      placeLayer(cv, placed);
      /* The body is drawn at the share of the density that costs what the words' own box did (engine/ui/cards/body.ts `paintScale`). */
      const own = el.getBoundingClientRect();
      const scale = paintScale(own.width * own.height, box.w * box.h);
      /* In quarter px, so a resize by a pixel or two keeps the foil it has. */
      cell = Math.max(CELL, Math.round((CELL / scale) * 4) / 4);
      if (still) {
        density = Math.min(2, Math.max(1, window.devicePixelRatio || 1)) * scale;
        size();
        paint(REST, 0, false);
        return;
      }
      density = register(el, cv, box, Math.min(2, window.devicePixelRatio || 1) * scale, (frame) => {
        if (freed) { if (!remote) size(); freed = false; }
        last = { light: frame.light, t: frame.t };
        paint(frame.light, frame.t, frame.idle);
        return false;
      }, { hidden: leave });
      /* Resizing the backing store clears it, and the loop's next draw waits for the in-view callback: repaint now, with the
         light and band already held, so the post never shows a bare frame. A freed canvas (out of view) stays freed. */
      if (freed) return;
      if (!remote) size();
      if (last) paint(last.light, last.t, false);
    };

    /* A resize (of the host or of the body it paints) registers again at the new size; the loop draws it fresh. */
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (sameBox(measure(), placed)) return;
      setup();
    }) : null;
    resize?.observe(el);
    setup();

    /* The board switched (the player's choice on the root, or the device's color scheme) while nothing was drawing. */
    const boardChanged = (): void => { band = readBand(); if (still) paint(REST, 0, false); else wake(el); };
    const mode = typeof MutationObserver === 'function' ? new MutationObserver(boardChanged) : null;
    mode?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-mode'] });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener?.('change', boardChanged);

    return () => {
      scheme?.removeEventListener?.('change', boardChanged);
      mode?.disconnect();
      resize?.disconnect();
      if (!still) unregister(el);
      remote?.drop();
      release();
      el.removeAttribute('data-kb-bleed');
    };
  }, [level, seed, still, place]);

  return (
    <div ref={host} className="dw-fab" data-kb-fab="" data-kb-level={level}>
      <canvas key={`${level}:${seed}:${still ? 'still' : 'live'}`} ref={canvas} className="dw-fab-foil" aria-hidden="true" />
      <div className="dw-fab-words">{children}</div>
    </div>
  );
}
