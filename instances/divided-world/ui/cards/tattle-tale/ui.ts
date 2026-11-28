/** Tattle-Tale's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { tattleTale } from '../../../cards/tattle-tale.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import tattleTaleCanvas from './art.webp?url';
import tattleTaleMark from './mark.svg?url';
import tattleTaleArt from './art.json';
import { spanWords, weighted } from '../words.ts';

export const ui: CardUi = {
  key: 'tattle-tale',
  art: { color: '#ff3d7f', ink: '#14030a', canvas: tattleTaleCanvas, mark: tattleTaleMark, credit: tattleTaleArt.credit, tagline: 'Point the Mod Bots at someone.' },
  summary: `Cast on a character. For ${spanWords(tattleTale.lasts!)}, Mod Bot patrols weigh that character's posts ${weighted(tattleTale)} when picking what to look at.`,
  status: 'Told on to the Mod Bots',
  hint: `A Tattle-Tale: Mod Bot patrols weigh this character's posts ${weighted(tattleTale)}.`,
  describe: (_settings: Settings) =>
    `A Salty card, ${tattleTale.rarity}, cast from any post by the character it lands on. For ${spanWords(tattleTale.lasts!)}, when a Mod Bot's patrol picks which recent posts to look at, that character's posts count ${weighted(tattleTale)} in the draw, so they are more likely to be picked. It makes a look likelier, never a ruling: the Mod Bot still judges each post against the rules. One fits on a character at a time, and it ends by itself. It is always cast face up. It costs nothing more to play.`,
};
