/** Graffiti's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { createElement, lazy, Suspense } from 'react';
import type { CardUi, ComposeProps } from '../../../../../engine/ui/cards/types.ts';
import { graffiti } from '../../../cards/graffiti.ts';
import { LOG_DRAW as GRAFFITI_LOG_DRAW, LOG_WASH as GRAFFITI_LOG_WASH, describeDraw as describeGraffitiDraw } from '../../../cards/graffiti/words.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import graffitiCanvas from './art.webp?url';
import graffitiMark from './mark.svg?url';
import graffitiArt from './art.json';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const GraffitiEffect = lazy(() => import('../../../cards/graffiti/Effect.tsx').then((m) => ({ default: m.Effect })));
const GraffitiComposeLoaded = lazy(() => import('../../../cards/graffiti/Compose.tsx').then((m) => ({ default: m.Compose })));
/* The engine mounts a `Compose` with no Suspense of its own, as it does an effect: until the drawing's code arrives the post's words stand in. */
const GraffitiCompose = (props: ComposeProps) => createElement(Suspense, { fallback: props.children }, createElement(GraffitiComposeLoaded, props));

/*
 * Graffiti (docs/plans/2026-11-11-graffiti-design.md): Pepperoni's color. A wall on a post, drawn under every splat (`beneath`). Its effect draws
 * the spray, a reader's scrub and the author's wash (graffiti/Effect.tsx); it is played on the post itself (`Compose`, graffiti/Compose.tsx: the
 * drawing, the toolbar and the stencils), and the Draw tile of its effect draws the same on a wall already there. Its words about a drawing
 * (`describeDraw`, `logDraw`, `logWash`) are graffiti/words.ts.
 */
export const ui: CardUi = {
  key: 'graffiti',
  Effect: GraffitiEffect,
  Compose: GraffitiCompose,
  describeDraw: describeGraffitiDraw,
  logDraw: GRAFFITI_LOG_DRAW,
  logWash: GRAFFITI_LOG_WASH,
  beneath: true,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: graffitiCanvas, mark: graffitiMark, credit: graffitiArt.credit, tagline: 'Turn a post into a wall.' },
  summary: 'Turn a post into a wall anyone can tag. The author can wash it off; anyone can tag it again.',
  status: 'A wall anyone can tag',
  hint: 'Press Draw to tag this wall. Scrub it away on your screen any time.',
  describe: (settings: Settings) =>
    `A Pepperoni card, ${graffiti.rarity}. It turns a post into a wall. Any character can tag it with spray cans, drawing freehand or placing a stencil, and the wall holds up to ${settings.cardSettings['graffiti.limit'] ?? 40}% of the post, counting each tag's own paint, even where it covers another tag. A reader can scrub the paint off on their own screen, which lasts until they leave the page. The post's author can wash it off for everyone, a coat at a pass, and anyone can tag it again. A Whoops! splat on the same post always covers the wall. It costs nothing more to play.`,
};
