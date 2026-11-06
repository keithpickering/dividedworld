/**
 * Glitter Bomb's effect (docs/plans/2026-11-06-shine-design.md, sections 2, 3, 5 and 6; the card itself,
 * docs/plans/2026-11-01-card-mechanic-design.md, section 8): every post of the character it was cast on glitters while it is up, a
 * week at most, then stops by itself. About 4,200 flakes of a post (one per 70 px squared, thickest around a seeded burst point) are
 * the engine's (engine/ui/shine/flakes.ts); this file is Divided World's inks and the host. It is decoration, never an obstacle: two
 * canvases go around the words, the settled and loose flakes under them and the burst over them, both hidden from assistive tech,
 * neither taking the pointer or any room, and the words keep their text shadow in the board's ground. Every pixel the engine draws
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
 * only while it is in view, and the band is read after mount and on every draw; a board that cannot be read draws nothing and leaves
 * the words bare. A change of `data-kb-mode` on the root or of the device's color scheme asks for one more draw by itself.
 *
 * Units: the box is CSS px (the host's layout size); the canvases are sized to round(box x density) with the density the loop returns
 * (at most 2), and their CSS size is the host's through the stylesheet (100%), so a resize builds the flakes again and draws fresh.
 */
import { useEffect, useRef } from 'react';
import { motionReduced } from '../../../../engine/ui/appearance.ts';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { bandFor, type Band } from '../../../../engine/ui/shine/band.ts';
import { burst, cling, drawBurst, drawLoose, loose, makeFlakes, release, stepBurst, type Flakes } from '../../../../engine/ui/shine/flakes.ts';
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

export function GlitterBombEffect({ post, plays, still, children }: EffectProps) {
  const host = useRef<HTMLDivElement>(null);
  const under = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const play = plays[0]!;
  const seed = `${play.id}:${post.id}`;

  useEffect(() => {
    const el = host.current, below = under.current, above = over.current;
    if (!el || !below || !above) return;
    let flakes: Flakes | null = null;
    let unclung: (() => void) | null = null;
    /* Whether this mount's burst has fired, and whether the post has been 40% in view: both outlive a flakes object. */
    let fired = still;
    let seen = false;
    let box = { w: 0, h: 0 };
    let density = 1;

    const readBand = (): Band | null => {
      try { return bandFor(el); } catch (err) { console.error(err); return null; }
    };
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
      if (fired) { burst(flakes, 0); release(flakes); }
      if (!still) unclung = cling.register(el, { sticky: true, flakes, landed: redraw });
      return flakes;
    };
    const paint = (light: Light, now: number, idle: boolean): boolean => {
      const u = below.getContext('2d'), o = above.getContext('2d');
      if (!u || !o) return false;
      u.setTransform(1, 0, 0, 1, 0, 0); u.clearRect(0, 0, below.width, below.height);
      o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, above.width, above.height);
      const band = readBand();
      const f = band ? ensure() : null;
      if (!band || !f) return false;
      /* Reduced motion has no burst: the flakes are placed at once. Otherwise it waits for the 40%. */
      if (!fired && (seen || motionReduced())) { fired = true; burst(f, now); }
      const busy = fired && !still ? stepBurst(f, now) : false;
      f.draw(u, light, band, now, idle, density);
      drawLoose(el, u, light, band, now, idle, density);
      if (busy) drawBurst(o, f, band, now, density);
      return busy;
    };
    const size = (): void => {
      for (const c of [below, above]) { c.width = Math.round(box.w * density); c.height = Math.round(box.h * density); }
    };
    const setup = (): void => {
      box = { w: el.offsetWidth, h: el.offsetHeight };
      drop();
      if (still) {
        density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
        size();
        paint(REST, 0, false);
        return;
      }
      density = register(el, below, box, window.devicePixelRatio || 1, (frame) => paint(frame.light, frame.t, frame.idle), { hidden: drop });
      size();
    };
    setup();

    /* The burst's own watch: the post at least 40% showing, the first time. The loop draws it (it waits for the post to be seen). */
    const stopWatching = still ? () => {} : watchInView(el, (showing) => {
      if (!showing || seen) return;
      seen = true;
      wake(el);
    }, { threshold: BURST_AT });

    /* A resize builds the flakes again at the new size; the loop draws it fresh. */
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (el.offsetWidth === box.w && el.offsetHeight === box.h) return;
      setup();
    }) : null;
    resize?.observe(el);

    /* The board switched (the player's choice on the root, or the device's color scheme) while nothing was drawing. */
    const mode = typeof MutationObserver === 'function' ? new MutationObserver(redraw) : null;
    mode?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-mode'] });
    const scheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    scheme?.addEventListener?.('change', redraw);

    return () => {
      scheme?.removeEventListener?.('change', redraw);
      mode?.disconnect();
      resize?.disconnect();
      stopWatching();
      if (!still) unregister(el);
      drop();
      loose(el).length = 0;
    };
  }, [seed, still]);

  return (
    <div ref={host} className="dw-glitter" data-kb-glitter="" onPointerMove={still ? undefined : (e) => cling.over(e.nativeEvent)}>
      <canvas ref={under} className="dw-glitter-under" aria-hidden="true" />
      <div className="dw-glitter-words">{children}</div>
      <canvas ref={over} className="dw-glitter-over" aria-hidden="true" />
    </div>
  );
}
