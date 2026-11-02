/**
 * How Divided World's cards look and read to the engine's screens (`InstanceUi.cards`): each
 * card's face, and its rules in plain words for the Vending Machine and the hand. A card's rules
 * themselves are `instances/divided-world/cards/`, whose settings these read, so a number said
 * here is the one the instance runs on. Stick Around's hold is drawn (ui/stick-around/Effect.tsx),
 * and Whoops!'s ink: its effect, its ink form, and each play's tag, which takes its own ink for its border and glow.
 *
 * The faces' colors are the Cards board's: Sweet is the cyan, Salty the pink, each with the dark
 * ink the board sets on it (docs/research/2026-10-29-two-worlds/05-cards.html).
 */
import type { CardUi } from '../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../engine/rules/types.ts';
import { StickAroundEffect } from './stick-around/Effect.tsx';
import stickAroundFace from './cards/stick-around.svg?url';
import stickAroundMark from './cards/stick-around-mark.svg?url';
import whoopsFace from './cards/whoops.svg?url';
import whoopsMark from './cards/whoops-mark.svg?url';
import trapCardFace from './cards/trap-card.svg?url';
import trapCardMark from './cards/trap-card-mark.svg?url';
import forceFieldFace from './cards/force-field.svg?url';
import forceFieldMark from './cards/force-field-mark.svg?url';
import bluffFace from './cards/bluff.svg?url';
import bluffMark from './cards/bluff-mark.svg?url';
import glitterBombFace from './cards/glitter-bomb.svg?url';
import glitterBombMark from './cards/glitter-bomb-mark.svg?url';
import mainEventFace from './cards/main-event.svg?url';
import mainEventMark from './cards/main-event-mark.svg?url';
import feelinFabFace from './cards/feelin-fab.svg?url';
import feelinFabMark from './cards/feelin-fab-mark.svg?url';
import { FeelinFabEffect } from './feelin-fab/Effect.tsx';
import { GlitterBombEffect } from './glitter-bomb/Effect.tsx';
import { glitterBomb } from '../cards/glitter-bomb.ts';
import { mainEvent } from '../cards/main-event.ts';
import { forceField } from '../cards/force-field.ts';

/** A span in words: "a week", "3 days". */
const spanWords = (s: { readonly unit: string; readonly count: number }) => (s.unit === 'day' && s.count === 7 ? 'a week' : s.count === 1 ? `a ${s.unit}` : `${s.count} ${s.unit}s`);
import { ConfigForm as WhoopsConfigForm } from '../cards/whoops/ConfigForm.tsx';
import { Effect as WhoopsEffect } from '../cards/whoops/Effect.tsx';
import { luminance } from '../cards/whoops/splat.ts';

/** A price of a whole number of hundredths, as the shop says it: "1.00". */
const orbs = (hundredths: number) => (hundredths / 100).toFixed(2);

export const cardsUi: readonly CardUi[] = Object.freeze([
  {
    key: 'stick-around',
    Effect: StickAroundEffect,
    takeover: true,
    art: { color: '#2ee6ff', ink: '#03141a', image: stickAroundFace, mark: stickAroundMark, tagline: 'Hold a reader on a post.' },
    summary: 'Holds a reader on the post until they check your sentence, or break free.',
    describe: (settings: Settings) =>
      `A Sweet card. Once the post settles in view, whoever reads it is pulled to it and the post fills their screen: they read it there, and get out by checking the caster's sentence to certify they read it, or by scrolling hard past either end of it (or pressing Break free, or Esc) to fill a bar that drains whenever they stop, which frees them for that visit. The post's author and the caster are never held. It costs ${orbs(settings.economy['stickAround.price'] ?? 0)} to buy, and nothing more to play.`,
  },
  {
    key: 'whoops',
    art: { color: '#ff3d7f', ink: '#14030a', image: whoopsFace, mark: whoopsMark, tagline: 'Splat a post in ink.' },
    hint: 'Drag across the ink to scrub it off your screen.',
    summary: 'Splats a post in your ink. Readers scrub it; only the author can wash it.',
    Effect: WhoopsEffect,
    ConfigForm: WhoopsConfigForm,
    /* The play form's name for what a long post adds, said from the rules' own numbers. */
    surcharge: (settings: Settings) => {
      const e = settings.economy;
      return `Long post, +${orbs(e['whoops.perLength'] ?? 0)} per ${e['whoops.lengthStep'] ?? 0} characters`;
    },
    /*
     * Each play's tag and chip takes the color it splatted for its border and glow (the plays-on-a-post design, section 5):
     * the tag on top is the most drawn play, not always the top ink. An ink the card cannot read keeps the alignment's.
     */
    tag: (play) => {
      const ink = play.config.color;
      if (typeof ink !== 'string') return undefined;
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
  /*
   * The card mechanic's first plays (docs/plans/2026-11-01-card-mechanic-design.md, section 6). Bluff is Pepperoni's color, the
   * board's --kb-pepperoni, with the dark ink the other faces set on theirs.
   */
  {
    key: 'trap-card',
    art: { color: '#ff3d7f', ink: '#14030a', image: trapCardFace, mark: trapCardMark, tagline: 'Catch the next card cast on your post.' },
    summary: 'Set face down on your post. Catches the next card cast there, and pays you what it cost.',
    describe: (settings: Settings) =>
      `A Salty card, uncommon, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The next card cast on that post that is uncommon or commoner is caught: it lands as caught and does nothing, its caster has spent it, and your wallet gains what their wallet paid to play it, as far as your wallet's cap allows. A rarer card passes over it. It springs once, or ends by itself after ${settings.setLasts.count} ${settings.setLasts.unit}${settings.setLasts.count === 1 ? '' : 's'}. It costs ${orbs(settings.economy['trapCard.price'] ?? 0)} to buy, and nothing more to set.`,
  },
  {
    key: 'force-field',
    art: { color: '#2ee6ff', ink: '#03141a', image: forceFieldFace, mark: forceFieldMark, tagline: 'Turn away cards from your post.' },
    summary: `Used on your post. Turns away cards up to ${forceField.rarity} for ${spanWords(forceField.lasts!)}.`,
    describe: (settings: Settings) =>
      `A Sweet card, ${forceField.rarity}, used on one of your own posts. For ${spanWords(forceField.lasts!)}, every card cast there that is ${forceField.rarity} or commoner is turned away before it lands, and its caster is told so; a rarer card lands as usual. It never stops a card set face down. It costs ${orbs(settings.economy['forceField.price'] ?? 0)} to buy, and nothing more to use.`,
  },
  {
    key: 'bluff',
    art: { color: '#d24a2c', ink: '#1a0602', image: bluffFace, mark: bluffMark, tagline: 'A card back that does nothing.' },
    summary: 'Set face down on your post. Looks like a trap, and does nothing.',
    describe: (settings: Settings) =>
      `A Pepperoni card, common, set face down on one of your own posts. Everyone sees a card back there, the same as a Trap Card's. It does nothing, and ends by itself after ${settings.setLasts.count} ${settings.setLasts.unit}${settings.setLasts.count === 1 ? '' : 's'} with nothing revealed. It costs ${orbs(settings.economy['bluff.price'] ?? 0)} to buy, and nothing more to set.`,
  },
  /*
   * The first cards beyond a post (docs/plans/2026-11-01-card-mechanic-design.md, section 8). Glitter Bomb is Pepperoni's color, as
   * Bluff is; Main Event is Sweet's, as Force Field is.
   */
  {
    key: 'glitter-bomb',
    Effect: GlitterBombEffect,
    art: { color: '#d24a2c', ink: '#1a0602', image: glitterBombFace, mark: glitterBombMark, tagline: 'Make a character sparkle.' },
    summary: `Cast on a character. Every post of theirs sparkles for ${spanWords(glitterBomb.lasts!)}.`,
    describe: (settings: Settings) =>
      `A Pepperoni card, ${glitterBomb.rarity}, cast on a character from any of their posts. For ${spanWords(glitterBomb.lasts!)}, every post of that character sparkles, wherever it is, and then it stops by itself. It falls on that mask alone. It costs ${orbs(settings.economy['glitterBomb.price'] ?? 0)} to buy, and nothing more to play.`,
  },
  {
    key: 'main-event',
    art: { color: '#2ee6ff', ink: '#03141a', image: mainEventFace, mark: mainEventMark, tagline: 'Pin a thread to the top of its board.' },
    summary: `Cast on a thread. Pins it to the top of its board for ${spanWords(mainEvent.lasts!)}.`,
    describe: (settings: Settings) =>
      `A Sweet card, ${mainEvent.rarity}, cast on a thread from its title. For ${spanWords(mainEvent.lasts!)}, the thread is pinned above the first page of its board's list, and then it drops back to its place by itself. It takes no other thread's place on the page. It costs ${orbs(settings.economy['mainEvent.price'] ?? 0)} to buy, and nothing more to play.`,
  },
  /*
   * The onboarding's first card (docs/plans/2026-11-02-onboarding-design.md, section 5), the Face's own: Sweet's cyan, as Force Field is.
   * Its rainbow grows with each Feelin' Fab on the post, up to three.
   */
  {
    key: 'feelin-fab',
    Effect: FeelinFabEffect,
    art: { color: '#2ee6ff', ink: '#03141a', image: feelinFabFace, mark: feelinFabMark, tagline: 'Give a post a rainbow.' },
    hint: "A Feelin' Fab: the more of them on a post, the more it glows.",
    summary: 'Gives a post a rainbow behind its words. Up to three can stack, and each makes it grander.',
    describe: (settings: Settings) =>
      `A Sweet card, common. It gives a post a rainbow behind its words, which stay as readable as ever. One makes the whole post's background drift slowly through the rainbow; two make it an animated rainbow band; three make it an animated radial rainbow, with the colors spreading out from the middle. A few twinkles come with it. Up to three can be on one post, and it stays as long as the post does. It costs ${orbs(settings.economy['feelinFab.price'] ?? 0)} to buy, and nothing more to play.`,
  },
] satisfies CardUi[]);
