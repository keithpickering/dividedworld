/**
 * How Divided World's two cards look and read to the engine's screens (`InstanceUi.cards`): each
 * card's face, and its rules in plain words for the Vending Machine and the hand. A card's rules
 * themselves are `instances/divided-world/cards/`, whose settings these read, so a number said
 * here is the one the instance runs on. Stick Around's hold is drawn (ui/stick-around/Effect.tsx),
 * and Whoops!'s ink: its effect, its ink form, and the tag of its top layer, which takes the layer's ink for its border and glow.
 *
 * The faces' colors are the Cards board's: Sweet is the cyan, Salty the pink, each with the dark
 * ink the board sets on it (docs/research/2026-10-29-two-worlds/05-cards.html).
 */
import type { CardUi } from '../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../engine/rules/types.ts';
import { StickAroundEffect } from './stick-around/Effect.tsx';
import stickAroundFace from './cards/stick-around.svg?url';
import whoopsFace from './cards/whoops.svg?url';
import { ConfigForm as WhoopsConfigForm } from '../cards/whoops/ConfigForm.tsx';
import { Effect as WhoopsEffect } from '../cards/whoops/Effect.tsx';
import { luminance } from '../cards/whoops/splat.ts';

/** A price of a whole number of hundredths, as the shop says it: "1.00". */
const orbs = (hundredths: number) => (hundredths / 100).toFixed(2);

export const cardsUi: readonly CardUi[] = Object.freeze([
  {
    key: 'stick-around',
    Effect: StickAroundEffect,
    art: { color: '#2ee6ff', ink: '#03141a', image: stickAroundFace, tagline: 'Hold a reader on a post.' },
    summary: 'Holds a reader on the post until they check your sentence, or break free.',
    describe: (settings: Settings) =>
      `A Sweet card. Once the post settles in view, whoever reads it is pulled to it and the post fills their screen: they read it there, and get out by checking the caster's sentence to certify they read it, or by scrolling hard past either end of it (or pressing Break free, or Esc) to fill a bar that drains whenever they stop, which frees them for that visit. The post's author and the caster are never held. It costs ${orbs(settings.economy['stickAround.price'] ?? 0)} to buy, and nothing more to play.`,
  },
  {
    key: 'whoops',
    art: { color: '#ff3d7f', ink: '#14030a', image: whoopsFace, tagline: 'Splat a post in ink.' },
    summary: 'Splats a post in your ink. Readers scrub it; only the author can wash it.',
    Effect: WhoopsEffect,
    ConfigForm: WhoopsConfigForm,
    /* The play form's name for what a long post adds, said from the rules' own numbers. */
    surcharge: (settings: Settings) => {
      const e = settings.economy;
      return `Long post, +${orbs(e['whoops.perLength'] ?? 0)} per ${e['whoops.lengthStep'] ?? 0} characters`;
    },
    /* The top layer's tag takes the color it splatted for its border and glow; the layers under keep their alignment's. */
    tag: (play, plays) => {
      const ink = play.config.color;
      if (play !== plays[plays.length - 1] || typeof ink !== 'string') return undefined;
      try {
        luminance(ink);
      } catch {
        return undefined;
      }
      return ink;
    },
    describe: (settings: Settings) => {
      const e = settings.economy;
      return `A Salty card. It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone. Up to three can stack on one post, each in its own ink. It costs ${orbs(e['whoops.price'] ?? 0)} to buy, and playing it on a long post costs ${orbs(e['whoops.perLength'] ?? 0)} more for every ${e['whoops.lengthStep'] ?? 0} characters, ${orbs(e['whoops.mostInAll'] ?? 0)} at most in all.`;
    },
    /* The author's save that washes a layer clean (the rules' `clean`, instances/divided-world/cards/whoops.ts) is the one the log names. */
    logSave: (state: unknown) => (typeof state === 'object' && state !== null && (state as { clean?: unknown }).clean === true
      ? { what: 'Washed clean', said: 'The layer is washed clean, for every reader.' }
      : undefined),
  },
] satisfies CardUi[]);
