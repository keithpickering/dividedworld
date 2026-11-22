/** Kick Me's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { lazy } from 'react';
import { alignmentTag } from '../../../../../engine/ui/cards/faces.ts';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { shareWords } from '../../../../../engine/ui/copy-words.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { kickMe } from '../../../cards/kick-me.ts';
import kickMeCanvas from './art.webp?url';
import kickMeMark from './mark.svg?url';
import kickMeArt from './art.json';
import { spanWords } from '../words.ts';

/* Loaded the first time a post wears it, as every card's effect is (engine/ui/cards/Effects.tsx draws it inside a Suspense). */
const KickMeEffect = lazy(() => import('../../kick-me/Effect.tsx').then((m) => ({ default: m.KickMeEffect })));

/*
 * Kick Me (docs/plans/2026-11-20-refund-outcome-plan.md, task 8): Pepperoni's colors, as Whoopee Cushion's. A Gimmick used on the player's own
 * post. Its effect is the sign taped across the post's top edge (ui/kick-me/Effect.tsx). Every number the words say is the rules': the earn,
 * the refunds and the span.
 */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** A count in words where it has one ("three"), else in digits. */
const count = (n: number) => COUNT_WORDS[n] ?? String(n);
/** The earn, as the end of a sentence: "one vote more", "2 votes more". */
const earn = () => {
  if (kickMe.gimmick?.kind !== 'earn' || !('flat' in kickMe.gimmick)) throw new Error('Kick Me has no flat earn gimmick');
  return `${kickMe.gimmick.flat === 1 ? 'one vote' : shareWords(kickMe.gimmick.flat)} more`;
};
/** The flat earn in digits, for the summary's short line: "1 vote", "2 votes". */
const flatVotes = () => {
  if (kickMe.gimmick?.kind !== 'earn' || !('flat' in kickMe.gimmick)) throw new Error('Kick Me has no flat earn gimmick');
  return `${kickMe.gimmick.flat} vote${kickMe.gimmick.flat === 1 ? '' : 's'}`;
};
const kicks = () => `${count(kickMe.refunds!.count)} ${alignmentTag(kickMe.refunds!.flavors[0]!)} Moves`;

export const ui: CardUi = {
  key: 'kick-me',
  Effect: KickMeEffect,
  art: { color: '#d24a2c', ink: '#0d0301', canvas: kickMeCanvas, mark: kickMeMark, credit: kickMeArt.credit, tagline: 'Earn more when your post bombs.' },
  summary: `Used on your post. For ${spanWords(kickMe.lasts!)}, negative reactions pay ${flatVotes()} more, and the first ${kickMe.refunds!.count} landed ${alignmentTag(kickMe.refunds!.flavors[0]!)} Moves go back to their players.`,
  status: 'Wearing a Kick Me sign',
  describe: (_settings: Settings) =>
    `A ${alignmentTag(kickMe.alignment)} card, ${kickMe.rarity}, used on one of your own posts. For ${spanWords(kickMe.lasts!)} a Kick Me sign is taped on it. Each heat or groan vote on that post, from a player of any class, pays its author ${earn()}. The first ${kicks()} played on that post land as usual, and each card goes back to its player's hand (the card, not any price paid to play it). A Move that a card set face down catches or hands back first, or a Mod Bot's Move, does not count. The sign stays up and keeps paying after the ${count(kickMe.refunds!.count)} are used, until it ends. A post carries one at a time. It costs nothing more to use.`,
  logPlay: () => `Each negative reaction to that post pays ${earn()} until it ends, and the first ${kicks()} played on it go back to their players.`,
};
