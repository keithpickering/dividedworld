/** Jimmy Wails's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { jimmyWails } from '../../../cards/jimmy-wails.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import jimmyWailsCanvas from './art.webp?url';
import jimmyWailsMark from './mark.svg?url';
import jimmyWailsArt from './art.json';
import { listWords, orbs, spanWords } from '../words.ts';

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const JimmyWailsEffect = lazy(() => import('../../../cards/jimmy-wails/Effect.tsx').then((m) => ({ default: m.JimmyWailsEffect })));
/** The amounts Jimmy Wails's drive takes, from the economy, each once, smallest first (the order the drive's buttons show them in). */
const giftAmounts = (settings: Settings) => {
  const e = settings.economy as Readonly<Record<string, unknown>>;
  return [...new Set(jimmyWails.drive!.gifts.map((k) => e[k]).filter((v): v is number => typeof v === 'number'))].sort((a, b) => a - b).map(orbs);
};
const giftOverhead = (settings: Settings) => (settings.economy as Readonly<Record<string, unknown>>)[jimmyWails.drive!.overhead];

export const ui: CardUi = {
  key: 'jimmy-wails',
  Effect: JimmyWailsEffect,
  art: { color: '#2ee6ff', ink: '#03141a', canvas: jimmyWailsCanvas, mark: jimmyWailsMark, credit: jimmyWailsArt.credit, tagline: 'Put your sob story on a banner.' },
  summary: 'Puts your sob story on a donation banner under a post, so anyone can send its author Aura.',
  /* A hint is one fixed line and is never given the settings, so it names no number an admin can tune (it would go false); describe says the overhead in force. */
  hint: 'Anyone can chip in. A cut of each gift goes to overhead.',
  status: 'A drive on this post',
  describe: (settings: Settings) =>
    `A Sweet card, ${jimmyWails.rarity}, cast on a post, with a message of your own: your sob story, which it must have. It goes on a donation banner under the post. Anyone can give through the banner, in ${listWords(giftAmounts(settings))}, as often as their wallet allows. Each gift loses ${giftOverhead(settings)}% to overhead, and the rest goes to the wallet of the post's author. A wallet that is too full to hold it loses what does not fit. Every gift is public, with who gave it and how much. Up to ${jimmyWails.stack} appeals share one drive, each on its own banner, and it closes by itself ${spanWords(jimmyWails.drive!.lasts)} after the latest one; the next play after that opens a new drive. It costs nothing more to play.`,
  logPlay: (_config, { opened }) => (opened === undefined ? undefined : opened ? 'It opened a drive.' : 'It joined the drive.'),
};
