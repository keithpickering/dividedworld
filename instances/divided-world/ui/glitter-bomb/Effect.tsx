/**
 * Glitter Bomb's effect (docs/plans/2026-11-06-shine-design.md, sections 2, 3, 5 and 6; the card itself,
 * docs/plans/2026-11-01-card-mechanic-design.md, section 8): every post of the character it was cast on glitters while it is up, a
 * week at most, then stops by itself. About 4,200 flakes of a post (one per 70 px squared, thickest around a seeded burst point) are
 * the engine's (engine/ui/shine/flakes.ts); this file is Divided World's inks and the host. It is decoration, never an obstacle: three
 * canvases go around the words, all hidden from assistive tech, none taking the pointer or any room. Under them, the settled flakes
 * unlit (the base, painted only when the board, the size or the settled count changes) and over that what the light changes this
 * frame (the lit flakes, their flares and the loose glitter); over the words, the burst. A canvas the browser re-rasters every frame
 * of a scroll is then the sparse one, never 4,200 flakes, and the words keep their text shadow in the board's ground. Every pixel the engine draws
 * is held inside the readable band the board leaves free of the post's inks (engine/ui/shine/band.ts), so nothing here proves a
 * palette's contrast at run time. The accessible path is reduced motion: no burst, every flake placed at once, the light at rest.
 *
 * Until the post is at least 40% in view it shows 15% of its flakes; the first time it is, the rest fly out of the seeded point
 * and land (a second threshold on the in-view observer, watchInView's `threshold`). The burst fires once per mount: leaving and
 * coming back shows every flake landed. Out of view the flakes object is released and dropped (it is deterministic, so it is built
 * again from its seed when the post returns, at ~4,200 flakes a post this is the memory of a long scroll), and so is the cling
 * registration. The host is `sticky` for cling (a mouse passing over picks glitter up, which lands loose on a post, the reader's own
 * and never saved or sent), and unmounting unregisters it and drops the loose glitter. A play's moment (`still`) draws every flake
 * landed, at rest, once: no burst, no cling, nothing registered that moves.
 *
 * The seed is `${play.id}:${post.id}`, both public, so every reader sees the same glitter on the same post and two posts of one
 * character differ. Nothing here reads who owns a post, who played on it, or any class. The page's one loop (loop.ts) draws the post
 * only while it is in view. The band is read from the tokens the board resolves for this post, after mount, and held: they change
 * only with `data-kb-mode` on the root or the device's color scheme, so it is read in setup (mount and resize) and when either
 * changes, never per draw (a getComputedStyle and a few property reads, ~30 times a second per post). A board that cannot be read
 * draws nothing and leaves the words bare, and is read again at the next setup or board change. That change also asks for one
 * more draw by itself, since a board can change while the loop sleeps.
 *
 * Where. The glitter covers the post, not only its words (2026-11-06: "the card effect should apply to the entire post in all cases"):
 * the three canvases stand on one surface, an element placed inline over the box the effect paints (engine/ui/cards/body.ts): in the
 * thread the post body's padding box (`.kb-act-main`, bar to bar), anywhere else (the ORIGIN box, Stick Around's view) the host's own.
 * The surface is what cling knows, so a flake that falls lands anywhere on the post, in the surface's px. Painting the body, the host
 * marks itself `data-kb-bleed` and glitter.css puts the flakes under everything in the body (its reactions, its signature, an ORIGIN
 * box above the words), not only under the words. The host watches the body's size as well as its own.
 *
 * Units: the box is CSS px (engine/ui/cards/body.ts `bodyBox`, fractions kept); the canvases are sized to round(box x density)
 * with the density the loop returns (at most 2), and their CSS size is the surface's (100%). A resize builds
 * the flakes again and, because sizing the backing stores clears them, repaints the canvases under the words at once with the last light and the
 * band already held.
 *
 * Memory: the over canvas has a backing store only while a burst is in the air (sized when it runs, zeroed when it ends, never
 * sized for `still`); a post out of view zeroes all three. Reduced motion turned on mid-burst lands what is in the air at rest. The
 * 40% watcher stops once the burst has fired.
 */
import { useEffect, useRef } from 'react';
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { bodyBox, bodyOf, placeLayer, sameBox, type BodyBox } from '../../../../engine/ui/cards/body.ts';
import { bandFor, type Band } from '../../../../engine/ui/shine/band.ts';
import { burst, cling, dropLoose, drawBurst, drawLoose, landAll, loose, makeFlakes, release, stepBurst, type Flakes } from '../../../../engine/ui/shine/flakes.ts';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { REST, type Light } from '../../../../engine/ui/shine/light.ts';
import { register, unregister, wake } from '../../../../engine/ui/shine/loop.ts';
import './glitter.css';

/** The flakes' inks: the seven rainbow inks (the holographic ones), then silver three times, so a third of the glitter is plain. */
export const GLITTER_INKS: readonly string[] = Object.freeze(['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec']);
/** The index from which inks are plain: the first seven are holographic. */
export const GLITTER_HOLO = 7;
/** The flare and the puff's tint (the engine names no color; this is Divided World's). It only lightens, inside the band. */
export const GLITTER_GLINT = '#ffffff';
/** CSS px squared per flake. */
const AREA = 70;
/** The share of the post that must show for the burst to fire. */
const BURST_AT = 0.4;

export function GlitterBombEffect({ post, plays, place, still, children }: EffectProps) {
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLCanvasElement>(null);
  const flash = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const play = plays[0]!;
  const seed = `${play.id}:${post.id}`;

  useEffect(() => {
    const el = host.current, face = surface.current, below = under.current, lit = flash.current, above = over.current;
    if (!el || !face || !below || !lit || !above) return;
    let flakes: Flakes | null = null;
    let unclung: (() => void) | null = null;
    /* Whether this mount's burst has fired, and whether the post has been 40% in view: both outlive a flakes object. */
    let fired = still;
    let seen = false;
    /* The size painted (what the loop and the drawing are handed) and where it stands from the host (the layer's placement). */
    let box = { w: 0, h: 0 };
    let placed: BodyBox = { left: 0, top: 0, w: 0, h: 0 };
    let density = 1;

    /* The band where this post sits, or null when the board's tokens cannot be read (nothing is drawn then). */
    const readBand = (): Band | null => {
      try { return bandFor(el); } catch (err) { console.error(err); return null; }
    };
    /* The band as last read; null until read, and again after a board that could not be read. Draws use it and never read. */
    let band: Band | null = null;
    /* True while the backing stores are freed (out of view); the next draw sizes the under canvases again. */
    let freed = false;
    /* What the under canvas shows: the flakes object and its `baseKey`; null when it was cleared (sized) or shows nothing. */
    let based: { f: Flakes; key: string } | null = null;
    /* Whether loose flakes were drawn on the lit canvas last time: the next draw clears it whole. */
    let looseShown = false;
    /* The last light and time drawn, for a synchronous repaint after a resize cleared the canvas. */
    let last: { light: Light; t: number } | null = null;
    const unclingNow = (): void => { unclung?.(); unclung = null; };
    /* Lets go of the flakes: what is in the air lands and gives the page-wide cap back, and the cling registration goes. */
    const drop = (): void => {
      unclingNow();
      if (flakes) release(flakes);
      flakes = null;
    };
    const redraw = (): void => { if (still) paint(REST, 0, false); else wake(el); };
    /* The flakes, built from the seed on first use; one built after the burst fired is built landed. */
    const ensure = (): Flakes | null => {
      if (flakes) return flakes;
      if (box.w <= 0 || box.h <= 0) return null;
      flakes = makeFlakes({ seed, box, inks: GLITTER_INKS, holo: GLITTER_HOLO, density: AREA, glint: GLITTER_GLINT });
      if (fired) landAll(flakes);
      if (!still) unclung = cling.register(face, { sticky: true, flakes, landed: redraw });
      return flakes;
    };
    /* The over canvas has a backing store only while a burst is in the air. */
    const sizeOver = (): void => {
      const w = Math.round(box.w * density), h = Math.round(box.h * density);
      if (above.width !== w || above.height !== h) { above.width = w; above.height = h; }
    };
    const freeOver = (): void => { if (above.width !== 0 || above.height !== 0) { above.width = 0; above.height = 0; } };
    const paint = (light: Light, now: number, idle: boolean): boolean => {
      const u = below.getContext('2d'), l = lit.getContext('2d');
      if (!u || !l) return false;
      const f = band ? ensure() : null;
      /* The flakes clear what they drew over the base themselves; loose flakes, which the host draws there, it clears. */
      if (!band || !f || looseShown) { l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, lit.width, lit.height); looseShown = false; }
      if (!band || !f) {
        if (based) { u.setTransform(1, 0, 0, 1, 0, 0); u.clearRect(0, 0, below.width, below.height); based = null; }
        freeOver();
        return false;
      }
      /* Reduced motion has no burst: the flakes are placed at once. Otherwise it waits for the 40%. */
      if (!fired && (seen || motionReduced())) { fired = true; stopWatching(); burst(f, now); }
      /* Reduced motion turned on mid-burst: what is in the air lands where it was headed (release), and the over canvas goes. */
      if (f.flying > 0 && motionReduced()) release(f);
      const busy = fired && !still ? stepBurst(f, now) : false;
      /* The unlit flakes, only when what they depend on changed; what the light changes goes over them, fresh each draw. */
      const key = f.baseKey(band);
      if (based?.f !== f || based.key !== key) {
        u.setTransform(1, 0, 0, 1, 0, 0); u.clearRect(0, 0, below.width, below.height);
        f.drawBase(u, band, density);
        based = { f, key };
      }
      f.drawLit(l, light, band, now, idle, density);
      looseShown = loose(face).length > 0;
      drawLoose(face, l, light, band, now, idle, density);
      if (busy) {
        sizeOver();
        const o = above.getContext('2d');
        if (o) { o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, above.width, above.height); drawBurst(o, f, band, now, density); }
      } else freeOver();
      return busy;
    };
    const size = (): void => {
      below.width = lit.width = Math.round(box.w * density);
      below.height = lit.height = Math.round(box.h * density);
      based = null;
      freeOver();
      freed = false;
    };
    /* Out of view: the flakes and every backing store go; the next draw sizes the under canvases and builds the flakes fresh. */
    const leave = (): void => { drop(); below.width = below.height = lit.width = lit.height = 0; based = null; freeOver(); freed = true; };
    /* The body this paints, found again at each measure (a takeover moves the words), and watched for its size as the host is. */
    let body: HTMLElement | null = null;
    /* A pointer passing over what the glitter covers (the body, else the host: one of them, so a move is read once) may pick some up. */
    const passing = (e: PointerEvent): void => cling.over(e);
    let heard: HTMLElement | null = null;
    const hear = (on: HTMLElement | null): void => {
      if (still || on === heard) return;
      heard?.removeEventListener('pointermove', passing);
      on?.addEventListener('pointermove', passing);
      heard = on;
    };
    let found = false;
    const measure = (): BodyBox => {
      const now = bodyOf(el, place);
      if (now !== body || !found) {
        found = true;
        if (body) resize?.unobserve(body);
        if (now) resize?.observe(now);
        hear(now ?? el);
        body = now;
        el.toggleAttribute('data-kb-bleed', body !== null);
      }
      return bodyBox(el, body);
    };
    const setup = (): void => {
      band = readBand();
      placed = measure();
      box = { w: placed.w, h: placed.h };
      placeLayer(face, placed);
      drop();
      if (still) {
        density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        size();
        paint(REST, 0, false);
        return;
      }
      density = register(el, below, box, window.devicePixelRatio || 1, (frame) => {
        if (freed) size();
        last = { light: frame.light, t: frame.t };
        return paint(frame.light, frame.t, frame.idle);
      }, { hidden: leave });
      /* Resizing the backing store clears it, and the loop's next draw waits for the in-view callback: repaint now, with the
         light and band already held, so the post never shows a bare frame. A freed canvas (out of view) stays freed. */
      if (freed) return;
      size();
      if (last) paint(last.light, last.t, false);
    };
    /* The burst's own watch: the post at least 40% showing, the first time. The loop draws it (it waits for the post to be seen).
       It stops once the burst has fired, so a long scroll past the post handles no more of its threshold callbacks. */
    let stopWatch: () => void = () => {};
    const stopWatching = (): void => { stopWatch(); stopWatch = () => {}; };
    /* A resize (of the host or of the body it paints) builds the flakes again at the new size; the loop draws it fresh. */
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (sameBox(measure(), placed)) return;
      setup();
    }) : null;
    resize?.observe(el);
    setup();
    if (!still && !fired) {
      stopWatch = watchInView(el, (showing) => {
        if (!showing || seen) return;
        seen = true;
        wake(el);
      }, { threshold: BURST_AT });
    }

    /* The board switched (the player's choice on the root, or the device's color scheme) while nothing was drawing. */
    const boardChanged = (): void => { band = readBand(); redraw(); };
    const mode = typeof MutationObserver === 'function' ? new MutationObserver(boardChanged) : null;
    mode?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-mode'] });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener?.('change', boardChanged);

    return () => {
      scheme?.removeEventListener?.('change', boardChanged);
      mode?.disconnect();
      resize?.disconnect();
      stopWatching();
      if (!still) unregister(el);
      drop();
      dropLoose(face);
      hear(null);
      el.removeAttribute('data-kb-bleed');
    };
  }, [seed, still, place]);

  return (
    <div ref={host} className="dw-glitter" data-kb-glitter="">
      <div ref={surface} className="dw-glitter-surface">
        <canvas ref={under} className="dw-glitter-under" aria-hidden="true" />
        <canvas ref={flash} className="dw-glitter-flash" aria-hidden="true" />
        <canvas ref={over} className="dw-glitter-over" aria-hidden="true" />
      </div>
      <div className="dw-glitter-words">{children}</div>
    </div>
  );
}
