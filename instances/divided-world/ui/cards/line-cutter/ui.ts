/** Line Cutter's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { lineCutter } from '../../../cards/line-cutter.ts';
import lineCutterCanvas from './art.webp?url';
import lineCutterMark from './mark.svg?url';
import lineCutterArt from './art.json';

/*
 * Line Cutter (docs/plans/2026-11-11-card-notes-part-2-plan.md): Pepperoni's color, as Glitter Bomb's. A Move, only ever cast face up: the
 * play form's reply editor writes the reply, and the thread screen draws it under its post. It holds no face-down sentence.
 */
export const ui: CardUi = {
  key: 'line-cutter',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: lineCutterCanvas, mark: lineCutterMark, credit: lineCutterArt.credit, tagline: 'Reply right under a post.' },
  summary: 'Posts your reply right under a post, where it stays however long the thread grows.',
  status: 'A reply cut in under it',
  hint: 'A Line Cutter: the reply under this post was written later and cut in line.',
  describe: () =>
    `A Pepperoni card, ${lineCutter.rarity}. You write a reply with it, and the reply is drawn right under the post you play it on, on that post's page, however many replies come after. It is a post like any other: it can be quoted, reacted to and played on. One fits under a post. It is only ever cast face up. If an admin ends the card, the reply drops back to its own place in the thread. It costs nothing more to play.`,
  logPlay: () => 'It put a reply right under the post.',
};
