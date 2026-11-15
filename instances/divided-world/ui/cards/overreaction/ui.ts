/** Overreaction's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { OverreactionForm } from '../../overreaction/ConfigForm.tsx';
import { overreaction } from '../../../cards/overreaction.ts';
import overreactionCanvas from './art.webp?url';
import overreactionMark from './mark.svg?url';
import overreactionArt from './art.json';
import { quadrantNames, quadrantOf, setMoveWords } from '../words.ts';

export const ui: CardUi = {
  key: 'overreaction',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: overreactionCanvas, mark: overreactionMark, credit: overreactionArt.credit, tagline: 'Bring your own emoji.' },
  summary: "Adds an emoji of your choosing to one post's reactions, scored the way you say.",
  status: (plays) => `${plays.length} of ${overreaction.stack} added`,
  hint: 'This post has an extra reaction. Its label says how it scores.',
  ConfigForm: OverreactionForm,
  describe: () =>
    `A Pepperoni card, ${overreaction.rarity}. It adds one emoji you choose to this post's reactions, and you say whether it scores as ${quadrantNames()}. Anyone can then leave it, here and nowhere else; it does not react for you. It can be any single emoji the forum does not already use. Up to three fit on a post. It does not end. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  logPlay: (config) => {
    const emoji = typeof config.emoji === 'string' ? config.emoji : undefined;
    const label = quadrantOf(config);
    return emoji === undefined || label === undefined ? undefined : `It adds ${emoji} to the post's reactions, scored as ${label}.`;
  },
};
