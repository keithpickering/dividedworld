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
 * Units: the box is CSS px (the host's getBoundingClientRect size); the canvas is sized to round(box x density) with the density the
 * loop returns (at most 2), and its CSS size is the host's through the stylesheet (100%). A resize registers again and, because
 * sizing the backing store clears it, repaints at once with the last light and the band already held, rather than waiting for
 * the loop's next draw.
 *
 * Memory: a post that leaves view frees what it holds, the foil's buffers and the canvas's own backing store (width and height 0);
 * when it returns, the next draw sizes the canvas again and draws fresh. A board change lets the other board's foil go once.
 */
import { useEffect, useRef } from 'react';
import { bandFor, type Band } from '../../../../engine/ui/shine/band.ts';
import { makeFoil, type Foil, type FoilPattern } from '../../../../engine/ui/shine/foil.ts';
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
/** How many starbursts a level carries. */
const TWINKLES = [0, 4, 8, 10] as const;
/** The most Feelin' Fabs that count: the card's stack. */
const MOST = 3;
const PATTERN: readonly (FoilPattern | '')[] = ['', 'pearl', 'bands', 'prism'];

type Board = 'light' | 'dark';

export function FeelinFabEffect({ post, plays, still, children }: EffectProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const level = Math.max(1, Math.min(MOST, plays.length));
  const seed = `${post.id}:${plays.map((p) => p.id).join(',')}`;

  useEffect(() => {
    const el = host.current, cv = canvas.current;
    if (!el || !cv) return;
    const pattern = PATTERN[level] as FoilPattern;
    const foils: Partial<Record<Board, Foil>> = {};
    const release = (): void => { for (const f of Object.values(foils)) f?.release(); };
    let box = { w: 0, h: 0 };
    let density = 1;
    /* The board whose foil is in use; the other is let go once, when this changes, and its reference dropped. */
    let current: Board | null = null;
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
    const paint = (light: Light, now: number, idle: boolean): void => {
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      if (!band) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
      const board: Board = band.hi < 0.5 ? 'dark' : 'light';
      /* A board change lets the other board's foil go, once: only the one in use holds buffers. */
      if (board !== current) {
        const other: Board = board === 'dark' ? 'light' : 'dark';
        foils[other]?.release();
        delete foils[other];
        current = board;
      }
      const foil = (foils[board] ??= makeFoil({ seed, pattern, palette: FAB_STOPS[board], stars: TWINKLES[level]!, glint: FAB_GLINT }));
      foil.draw(ctx, box, density, light, band, now, idle);
    };
    const size = (): void => {
      cv.width = Math.round(box.w * density);
      cv.height = Math.round(box.h * density);
      freed = false;
    };
    /* Out of view: the foil's buffers and the post's own backing store both go; the next draw sizes and draws fresh. */
    const leave = (): void => { release(); cv.width = cv.height = 0; freed = true; };
    const measure = (): { w: number; h: number } => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; };
    const setup = (): void => {
      band = readBand();
      box = measure();
      if (still) {
        density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        size();
        paint(REST, 0, false);
        return;
      }
      density = register(el, cv, box, window.devicePixelRatio || 1, (frame) => {
        if (freed) size();
        last = { light: frame.light, t: frame.t };
        paint(frame.light, frame.t, frame.idle);
        return false;
      }, { hidden: leave });
      /* Resizing the backing store clears it, and the loop's next draw waits for the in-view callback: repaint now, with the
         light and band already held, so the post never shows a bare frame. A freed canvas (out of view) stays freed. */
      if (freed) return;
      size();
      if (last) paint(last.light, last.t, false);
    };
    setup();

    /* A resize registers again at the new size; the loop draws it fresh. */
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const now = measure();
      if (now.w === box.w && now.h === box.h) return;
      setup();
    }) : null;
    resize?.observe(el);

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
      release();
    };
  }, [level, seed, still]);

  return (
    <div ref={host} className="dw-fab" data-kb-fab="" data-kb-level={level}>
      <canvas ref={canvas} className="dw-fab-foil" aria-hidden="true" />
      <div className="dw-fab-words">{children}</div>
    </div>
  );
}
