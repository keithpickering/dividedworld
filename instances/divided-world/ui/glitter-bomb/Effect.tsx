/**
 * Glitter Bomb's effect (docs/plans/2026-11-01-card-mechanic-design.md, section 8): every post of the character it was cast on
 * sparkles while it is up, a week at most, then stops by itself. It is decoration, never an obstacle: the words are drawn above the
 * sparkle, untouched, and nothing a reader presses is covered. So its accessible path is reduced motion alone ("An accessible path costs
 * what the obstacle costs"), which holds the glints still, by the player's setting or the device's.
 *
 * The glints are placed from the play's own id, so every reader sees the same sparkle on the same post, and two posts of one
 * character sparkle differently. The glints are drawn solid in one layer, and the layer as a whole at GLITTER_ALPHA, so overlapping
 * glints never stack: the most any spot of the page under the words is covered is one ink at GLITTER_ALPHA, which the effect's test
 * holds to the house style's text contrast in every mode. The player's reduced motion is read live, so a change holds the glints still
 * on the posts already drawn.
 */
import { useMemo, type CSSProperties } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import './glitter.css';

/** The glints' inks: Pepperoni's warm gold, a pink and a cyan, each drawn at most at GLITTER_ALPHA behind the words. */
export const GLITTER_INKS: readonly string[] = Object.freeze(['#ffd23f', '#ff6bd6', '#5fe3ff']);
/** The most a glint covers the page under the words; the contrast test reads it. */
export const GLITTER_ALPHA = 0.28;
/** How many glints one post carries. */
const GLINTS = 22;

/** A small seeded sequence from a play's id: the same id draws the same glints on every screen. */
function seeded(id: string, post: string): () => number {
  let h = 2166136261;
  for (const ch of `${id}:${post}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function GlitterBombEffect({ post, plays, children }: EffectProps) {
  const moving = !useMotionReduced();
  const play = plays[0]!;
  const glints = useMemo(() => {
    const next = seeded(play.id, post.id);
    return Array.from({ length: GLINTS }, (_, i) => ({
      left: `${(next() * 96 + 2).toFixed(1)}%`,
      top: `${(next() * 90 + 5).toFixed(1)}%`,
      size: `${(next() * 0.8 + 0.8).toFixed(2)}em`,
      ink: GLITTER_INKS[i % GLITTER_INKS.length]!,
      delay: `${(next() * 2.4).toFixed(2)}s`,
    }));
  }, [play.id, post.id]);
  return (
    <div className="dw-glitter" data-kb-glitter="" data-kb-moving={moving ? 'true' : 'false'}>
      <span className="dw-glitter-sparkle" aria-hidden="true" style={{ opacity: GLITTER_ALPHA }}>
        {glints.map((g, i) => (
          <span
            key={i} className="dw-glint"
            style={{ left: g.left, top: g.top, width: g.size, height: g.size, '--dw-glint-ink': g.ink, animationName: moving ? 'dw-twinkle' : 'none', animationDelay: g.delay } as CSSProperties}
          />
        ))}
      </span>
      <div className="dw-glitter-words">{children}</div>
    </div>
  );
}
