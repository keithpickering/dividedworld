/** Mooch's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { ConfigForm as MoochConfigForm } from '../../../cards/mooch/ConfigForm.tsx';
import { mooch } from '../../../cards/mooch.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import moochCanvas from './art.webp?url';
import moochMark from './mark.svg?url';
import moochArt from './art.json';
import { quadrantOf, setMoveWords, skimShare, spanWords } from '../words.ts';

/*
 * The payout cards (docs/plans/2026-11-11-card-notes-part-6-plan.md, "The cards"): Mooch, 4D Chess and Off Day are Salty's pink; Toll is Pepperoni's color.
 * Each says what it pays from its own rules (`skimShare`, `tollShare`, `rideShare`), and Off Day names a class and when from the play's own record.
 */
export const ui: CardUi = {
  key: 'mooch',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: moochCanvas, mark: moochMark, credit: moochArt.credit, tagline: 'Ride a post\'s reactions.' },
  summary: `Names one kind of reaction on a post. For ${spanWords(mooch.lasts!)}, each new vote the post draws there pays you a little, and costs its author nothing.`,
  /* A play's configuration is the quadrant it names; the status is checked on plays that name none, so it never assumes one. */
  status: (plays) => (plays.length === 1 ? `Mooching ${quadrantOf(plays[0]!.config) ?? 'reactions'} off this post` : `${plays.length} Mooches on this post`),
  hint: 'A Mooch pays its caster when this post draws the reactions it named.',
  ConfigForm: MoochConfigForm,
  describe: (settings: Settings) =>
    `A Salty card, ${mooch.rarity}. You name one of the four kinds of reaction. For ${spanWords(mooch.lasts!)}, each vote the post draws there, from a player who had not reacted to the post before, pays you ${skimShare()}, whatever the author's class. It takes nothing from the author, and it pays nothing on a post of your own. A post holds one Mooch for each kind of reaction. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  logPlay: (config) => {
    const l = quadrantOf(config);
    return l === undefined ? undefined : `It names ${l}: for ${spanWords(mooch.lasts!)}, each new vote of ${l} this post draws pays its caster ${skimShare()}. The post's author loses nothing.`;
  },
};
