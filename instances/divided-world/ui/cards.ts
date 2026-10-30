/**
 * How Divided World's two cards look and read to the engine's screens (`InstanceUi.cards`): each
 * card's face, and its rules in plain words for the Vending Machine and the hand. A card's rules
 * themselves are `instances/divided-world/cards/`, whose settings these read, so a number said
 * here is the one the instance runs on. The two effects (Stick Around's hold, Whoops!'s ink) are
 * drawn by the cards plan's Tasks 4 and 5 and are added to these entries then; until they are, a
 * play of either is shown as its tag on the post.
 *
 * The faces' colors are the Cards board's: Sweet is the cyan, Salty the pink, each with the dark
 * ink the board sets on it (docs/research/2026-10-29-two-worlds/05-cards.html).
 */
import type { CardUi } from '../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../engine/rules/types.ts';

/** A price of a whole number of hundredths, as the shop says it: "1.00". */
const orbs = (hundredths: number) => (hundredths / 100).toFixed(2);

export const cardsUi: readonly CardUi[] = Object.freeze([
  {
    key: 'stick-around',
    art: { color: '#2ee6ff', ink: '#03141a' },
    describe: (settings: Settings) =>
      `A Sweet card. Once the post scrolls into view, whoever reads it is held there: each time they scroll away, the page brings them back, until they tick the caster's sentence to certify they read it, or scroll hard enough the other way to break free for that visit. The post's author and the caster are never held. It costs ${orbs(settings.economy['stickAround.price'] ?? 0)} to buy, and nothing more to play.`,
  },
  {
    key: 'whoops',
    art: { color: '#ff3d7f', ink: '#14030a' },
    describe: (settings: Settings) => {
      const e = settings.economy;
      return `A Salty card. It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone. Up to three can stack on one post, each in its own ink. It costs ${orbs(e['whoops.price'] ?? 0)} to buy, and playing it on a long post costs ${orbs(e['whoops.perLength'] ?? 0)} more for every ${e['whoops.lengthStep'] ?? 0} characters, ${orbs(e['whoops.mostInAll'] ?? 0)} at most in all.`;
    },
  },
] satisfies CardUi[]);
