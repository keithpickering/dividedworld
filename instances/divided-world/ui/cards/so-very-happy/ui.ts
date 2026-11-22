/** So Very Happy's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import { alignmentTag } from '../../../../../engine/ui/cards/faces.ts';
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ALIGNMENTS, type Settings } from '../../../../../engine/rules/types.ts';
import { soVeryHappy } from '../../../cards/so-very-happy.ts';
import { setLastsWords } from '../words.ts';
import soVeryHappyCanvas from './art.webp?url';
import soVeryHappyMark from './mark.svg?url';
import soVeryHappyArt from './art.json';

/*
 * So Very Happy (docs/plans/2026-11-21-so-very-happy-plan.md, task 7): Salty's colors, as Steel Chair and the other Salty cards. A face-down
 * Reversal that springs on a Move up to a rarity that isn't Sweet, and locks the Move's player out of the post's thread for 24 hours. Its
 * face and sheet are the glass; the lockout is public on the post. It has no effect and no form: a face-down card is drawn as the engine's
 * card back.
 */
/* Read when the words are said, not when this module loads, so they follow the rules. */
const match = () => soVeryHappy.trap!.match!;
/** The alignments the match leaves out, as the words say them ("Sweet"): the Move that springs it is not one of these. */
const notWords = () => ALIGNMENTS.filter((a) => !match().flavors!.includes(a)).map(alignmentTag).join(' or ');
/** The Move that springs it, short enough for the card's face: "non-Sweet Move up to rare"; with more than one flavor left out, "Move up to uncommon that isn't Sweet or Pepperoni". */
const springsOn = () => {
  const left = ALIGNMENTS.filter((a) => !match().flavors!.includes(a));
  return left.length === 1 ? `non-${alignmentTag(left[0]!)} Move up to ${match().upTo}` : `Move up to ${match().upTo} that isn't ${notWords()}`;
};
/** How long the lockout lasts, in the rules' hours ("24 hours"). */
const lockedFor = (): string => {
  const outcome = soVeryHappy.trap?.outcome;
  return outcome?.kind === 'lockout' ? `${outcome.hours} ${outcome.hours === 1 ? 'hour' : 'hours'}` : 'a while';
};

export const ui: CardUi = {
  key: 'so-very-happy',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: soVeryHappyCanvas, mark: soVeryHappyMark, credit: soVeryHappyArt.credit, tagline: 'Play it Sweet or get locked out' },
  /* A getter, so the words are read from the rules when they are said, not when this module loads. */
  get summary() {
    return `Set face down on your post. The first ${springsOn()} lands, and its player is locked out of the thread for ${lockedFor()}.`;
  },
  /* As every Reversal's: the same words, so none can be told from another. */
  status: 'Set, face down to everyone else',
  describe: (settings: Settings) =>
    `A ${alignmentTag(soVeryHappy.alignment)} card, ${soVeryHappy.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The first Move played on that post that isn't ${notWords()}, up to ${match().upTo}, springs it and shows it: that Move lands as usual, and whoever played it is locked out of that post's thread for ${lockedFor()}. A rarer Move passes over it, and a Move your post's ward turns away never reaches it. It springs once, or ends by itself after ${setLastsWords(settings)}. It costs nothing more to set.`,
};
