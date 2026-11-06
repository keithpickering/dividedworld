/**
 * Feelin' Fab's effect (docs/plans/2026-11-02-onboarding-design.md, sections 5 and 6): a rainbow under the post's words, by the
 * count of Feelin' Fabs up on the post, one to three. Level 1 cycles the rainbow's stops slowly; level 2 is an animated linear
 * rainbow; level 3 an animated radial one; each with twinkles at spots placed from the plays' own ids, so every reader sees the
 * same ones, and more of them on the higher levels. It is decoration, never an obstacle: the words are drawn above the rainbow
 * with a text shadow in the board's ground, and every stop holds the theme's post text, links, visited links and muted words (a
 * quote's byline) at 4.5:1 (`stopsAreReadable`, which the effect's test drives red). So its accessible path is reduced motion
 * alone ("An accessible path costs what the obstacle costs"): level 1 sits on one stop, chosen at random on each load in the
 * reader's own browser and never stored or sent; levels 2 and 3 stay gradients; the twinkles stay where they are. The player's
 * reduced motion is read live. The animation runs only while the post is in view (inView.ts), as a sliding pre-painted layer
 * and twinkling shapes (transform and opacity on the compositor), never layout or repaint.
 *
 * The palettes are the two the board has: pastels under black text on the light board, deep colors under white text on the dark
 * one. FAB_STOPS and FAB_TWINKLE stay in TypeScript as the one list, because the contrast test reads them against the theme's
 * tokens. They reach the stylesheet as custom properties in the post's style prop, from one frozen object built once at module load
 * (`PALETTE`), not as a style element: the site's CSP is `style-src 'self'` (web/headers.ts, netlify.toml), which blocks inline
 * style elements but allows the CSSOM that React's style prop writes through. fab.css picks the pair for the mode.
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { ratio, type Mode, type Tokens } from '../../../../engine/ui/contrast.ts';
import { POST_INK } from '../../../../engine/ui/shine/band.ts';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { seeded } from '../seeded.ts';
import { useInView } from './inView.ts';
import './fab.css';

/** The rainbow's stops, red to violet, for each board: pastels under black text, deep colors under white. */
export const FAB_STOPS: { readonly light: readonly string[]; readonly dark: readonly string[] } = Object.freeze({
  light: Object.freeze(['#ffb9be', '#ffc09f', '#fff2a0', '#a8e6a1', '#9fd3ff', '#d8c0ff']),
  dark: Object.freeze(['#7f0c1e', '#682d06', '#4a3d00', '#0d471e', '#133b84', '#522191']),
});
/** The twinkles' ink on each board: white on the pastels, black on the deep colors, so a twinkle never lessens the text's
 * contrast. */
export const FAB_TWINKLE = Object.freeze({ light: '#ffffff', dark: '#000000' });
/** How many twinkles a level carries. */
const TWINKLES = [0, 4, 8, 10] as const;
/** The most Feelin' Fabs that count: the card's stack. */
const MOST = 3;
const SHAPE = ['', 'cycle', 'linear', 'radial'] as const;

/** The palettes as custom properties, built once from FAB_STOPS and FAB_TWINKLE and shared by every post's style prop. */
const PALETTE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries([
    ['--dw-fab-twinkle-light', FAB_TWINKLE.light],
    ['--dw-fab-twinkle-dark', FAB_TWINKLE.dark],
    ...FAB_STOPS.light.map((c, i) => [`--dw-fab-light-${i + 1}`, c]),
    ...FAB_STOPS.dark.map((c, i) => [`--dw-fab-dark-${i + 1}`, c]),
  ]),
);

/** Every stop and twinkle that fails 4.5:1 against any text color inside a post on its board, in words; none when all hold. */
export function stopsAreReadable(
  tokens: Readonly<Record<Mode, Tokens>>,
  stops: { readonly light: readonly string[]; readonly dark: readonly string[] },
  twinkle: { readonly light: string; readonly dark: string },
): string[] {
  const failures: string[] = [];
  const boards = [['light', ['light', 'light (chosen)']], ['dark', ['dark', 'dark (device)']]] as const;
  for (const [board, modes] of boards) {
    for (const ink of [...stops[board], twinkle[board]]) {
      for (const mode of modes) {
        for (const token of POST_INK) {
          const r = ratio(tokens[mode][token]!, ink);
          if (r < 4.5) {
            failures.push(`${board} palette: ${ink} is ${r.toFixed(2)}:1 against ${token} in ${mode}, under 4.5:1`);
          }
        }
      }
    }
  }
  return failures;
}

export function FeelinFabEffect({ post, plays, children }: EffectProps) {
  /* A play's moment (`still`) draws it as live: the level is the count of plays the moment caught, and the rainbow's motion is
     decoration that changes no state, so it runs there too. Reduced motion holds it in a moment as it does on a live post. */
  const moving = !useMotionReduced();
  const box = useRef<HTMLDivElement>(null);
  const running = useInView(box);
  const level = Math.max(1, Math.min(MOST, plays.length));
  /* Chosen in this browser on each load, never stored or sent; read only when level 1 is held still. */
  const [stop] = useState(() => 1 + Math.floor(Math.random() * FAB_STOPS.light.length));
  const seed = `${post.id}:${plays.map((p) => p.id).join(',')}`;
  const twinkles = useMemo(() => {
    const next = seeded(seed);
    return Array.from({ length: TWINKLES[level]! }, () => ({
      left: `${(next() * 94 + 3).toFixed(1)}%`,
      top: `${(next() * 88 + 6).toFixed(1)}%`,
      size: `${(next() * 0.6 + 0.7).toFixed(2)}em`,
      delay: `${(next() * 3).toFixed(2)}s`,
    }));
  }, [seed, level]);
  const held = !moving && level === 1;
  return (
    <div
      ref={box} className={`dw-fab dw-fab-${SHAPE[level]}`} data-kb-fab="" data-kb-level={level}
      data-kb-moving={moving ? 'true' : 'false'} data-kb-running={running ? 'true' : 'false'}
      data-kb-still={held ? stop : undefined}
      style={(held ? { ...PALETTE, '--dw-fab-still': String(stop) } : PALETTE) as CSSProperties}
    >
      <span className="dw-fab-ground" aria-hidden="true">
        <span className="dw-fab-layer" />
        {twinkles.map((t, i) => (
          <svg
            key={i} className="dw-fab-twinkle" viewBox="0 0 100 100" focusable="false"
            style={{ left: t.left, top: t.top, width: t.size, height: t.size, animationDelay: t.delay }}
          >
            <polygon points="50,0 62,38 100,50 62,62 50,100 38,62 0,50 38,38" />
          </svg>
        ))}
      </span>
      <div className="dw-fab-words">{children}</div>
    </div>
  );
}
