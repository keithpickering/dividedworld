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
import { lazy } from 'react';
import type { CardUi } from '../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../engine/rules/types.ts';
import type { GimmickEffect } from '../../../engine/rules/cards.ts';
import stickAroundCanvas from './cards/stick-around/art.webp?url';
import stickAroundMark from './cards/stick-around/mark.svg?url';
import stickAroundArt from './cards/stick-around/art.json';
import whoopsCanvas from './cards/whoops/art.webp?url';
import whoopsMark from './cards/whoops/mark.svg?url';
import whoopsArt from './cards/whoops/art.json';
import cardCollectorCanvas from './cards/card-collector/art.webp?url';
import cardCollectorMark from './cards/card-collector/mark.svg?url';
import cardCollectorArt from './cards/card-collector/art.json';
import forceFieldCanvas from './cards/force-field/art.webp?url';
import forceFieldMark from './cards/force-field/mark.svg?url';
import forceFieldArt from './cards/force-field/art.json';
import glitterBombCanvas from './cards/glitter-bomb/art.webp?url';
import glitterBombMark from './cards/glitter-bomb/mark.svg?url';
import glitterBombArt from './cards/glitter-bomb/art.json';
import mainEventCanvas from './cards/main-event/art.webp?url';
import mainEventMark from './cards/main-event/mark.svg?url';
import mainEventArt from './cards/main-event/art.json';
import autocorrectCanvas from './cards/autocorrect/art.webp?url';
import autocorrectMark from './cards/autocorrect/mark.svg?url';
import autocorrectArt from './cards/autocorrect/art.json';
import feelinFabCanvas from './cards/feelin-fab/art.webp?url';
import feelinFabMark from './cards/feelin-fab/mark.svg?url';
import feelinFabArt from './cards/feelin-fab/art.json';
import hallPassCanvas from './cards/hall-pass/art.webp?url';
import hallPassMark from './cards/hall-pass/mark.svg?url';
import hallPassArt from './cards/hall-pass/art.json';
import belowTheFoldCanvas from './cards/below-the-fold/art.webp?url';
import belowTheFoldMark from './cards/below-the-fold/mark.svg?url';
import belowTheFoldArt from './cards/below-the-fold/art.json';
import youWereSayingCanvas from './cards/you-were-saying/art.webp?url';
import youWereSayingMark from './cards/you-were-saying/mark.svg?url';
import youWereSayingArt from './cards/you-were-saying/art.json';
import { ConfigForm as YouWereSayingConfigForm } from '../cards/you-were-saying/ConfigForm.tsx';
import { mostSteps, youWereSaying } from '../cards/you-were-saying.ts';
import { ConfigForm as AutocorrectConfigForm } from '../cards/autocorrect/ConfigForm.tsx';
import { glitterBomb } from '../cards/glitter-bomb.ts';
import { mainEvent } from '../cards/main-event.ts';
import { forceField } from '../cards/force-field.ts';
import { feelinFab } from '../cards/feelin-fab.ts';
import { belowTheFold } from '../cards/below-the-fold.ts';
import { ConfigForm as CardCollectorConfigForm } from '../cards/card-collector/ConfigForm.tsx';
import { cardCollector } from '../cards/card-collector.ts';
import { publicityTour } from '../cards/publicity-tour.ts';
import { heatMagnet } from '../cards/heat-magnet.ts';
import { classClown } from '../cards/class-clown.ts';
import { goodVibes } from '../cards/good-vibes.ts';
import publicityTourCanvas from './cards/publicity-tour/art.webp?url';
import publicityTourMark from './cards/publicity-tour/mark.svg?url';
import publicityTourArt from './cards/publicity-tour/art.json';
import heatMagnetCanvas from './cards/heat-magnet/art.webp?url';
import heatMagnetMark from './cards/heat-magnet/mark.svg?url';
import heatMagnetArt from './cards/heat-magnet/art.json';
import classClownCanvas from './cards/class-clown/art.webp?url';
import classClownMark from './cards/class-clown/mark.svg?url';
import classClownArt from './cards/class-clown/art.json';
import goodVibesCanvas from './cards/good-vibes/art.webp?url';
import goodVibesMark from './cards/good-vibes/mark.svg?url';
import goodVibesArt from './cards/good-vibes/art.json';
import { ConfigForm as WhoopsConfigForm } from '../cards/whoops/ConfigForm.tsx';
import { rgbOf } from '../cards/whoops/splat.ts';

/**
 * The sentence a Move's words gain on setting it (the face-down Moves design, section 3): set face down on your own post, it springs on the
 * next quote of that post and lands, at no further cost, on what quoted it, at the card's own reach (the quoting post, its character, its thread).
 */
const setMoveWords = (lands: string) => `You can also set it face down on one of your own posts: it springs on the next quote of that post and lands on ${lands} at no further cost, using up the card.`;

/** A span in words: "a week", "3 days". */
export const spanWords = (s: { readonly unit: string; readonly count: number }) => (s.unit === 'day' && s.count === 7 ? 'a week' : s.count === 1 ? `${s.unit === 'hour' ? 'an' : 'a'} ${s.unit}` : `${s.count} ${s.unit}s`);

/** What an Earn Gimmick adds to a reaction's count, and what a Price Gimmick adds to a cast, read from the card's own rules: "10%", "0.25". */
const earnBy = (c: { readonly gimmick?: GimmickEffect }) => {
  if (c.gimmick?.kind !== 'earn') throw new Error('card has no earn gimmick');
  return `${Math.round(c.gimmick.by * 100)}%`;
};
const priceAdd = (c: { readonly gimmick?: GimmickEffect }) => {
  if (c.gimmick?.kind !== 'price') throw new Error('card has no price gimmick');
  return orbs(c.gimmick.add);
};

/** A price of a whole number of hundredths, as the shop says it: "1.00". */
const orbs = (hundredths: number) => (hundredths / 100).toFixed(2);

/*
 * Each card's effect loads the first time a post wears it, so the board's first script holds none of them; the engine's effect
 * slot draws one inside a Suspense whose fallback is the post's words (engine/ui/cards/Effects.tsx).
 */
const StickAroundEffect = lazy(() => import('./stick-around/Effect.tsx').then((m) => ({ default: m.StickAroundEffect })));
const AutocorrectEffect = lazy(() => import('../cards/autocorrect/Effect.tsx').then((m) => ({ default: m.AutocorrectEffect })));
const FeelinFabEffect = lazy(() => import('./feelin-fab/Effect.tsx').then((m) => ({ default: m.FeelinFabEffect })));
const GlitterBombEffect = lazy(() => import('./glitter-bomb/Effect.tsx').then((m) => ({ default: m.GlitterBombEffect })));
const BelowTheFoldEffect = lazy(() => import('./below-the-fold/Effect.tsx').then((m) => ({ default: m.BelowTheFoldEffect })));
const YouWereSayingEffect = lazy(() => import('../cards/you-were-saying/Effect.tsx').then((m) => ({ default: m.YouWereSayingEffect })));
const WhoopsEffect = lazy(() => import('../cards/whoops/Effect.tsx').then((m) => ({ default: m.Effect })));

export const cardsUi: readonly CardUi[] = Object.freeze([
  {
    key: 'stick-around',
    Effect: StickAroundEffect,
    takeover: true,
    art: { color: '#2ee6ff', ink: '#03141a', canvas: stickAroundCanvas, mark: stickAroundMark, credit: stickAroundArt.credit, tagline: 'Hold a reader on a post.' },
    summary: 'Holds a reader on the post until they check your sentence, or break free.',
    status: 'Holding you on this post',
    describe: (settings: Settings) =>
      `A Sweet card. Once the post settles in view, whoever reads it is pulled to it and the post fills their screen: they read it there, and get out by checking the caster's sentence to certify they read it, or by scrolling hard past either end of it (or pressing Break free, or Esc) to fill a bar that drains whenever they stop, which frees them for that visit. The post's author and the caster are never held. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  },
  {
    key: 'whoops',
    art: { color: '#ff3d7f', ink: '#14030a', canvas: whoopsCanvas, mark: whoopsMark, credit: whoopsArt.credit, tagline: 'Splat a post in ink.' },
    hint: 'Drag across the ink to scrub it off your screen.',
    status: 'Ink on this post',
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
     * A Mod Bot's ink may be a color's name, so the tag is given as the hex the splat draws (the engine reads hex).
     */
    tag: (play) => {
      const ink = play.config.color;
      if (typeof ink !== 'string') return undefined;
      try {
        return `#${rgbOf(ink).map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      } catch {
        return undefined;
      }
    },
    describe: (settings: Settings) => {
      const e = settings.economy;
      return `A Salty card. It splats a post in the ink you choose, and a reader can scrub the ink away on their own screen; the post's author can wash it away for everyone. Up to three can stack on one post, each in its own ink. ${setMoveWords('the quoting post')} Playing it on a long post costs ${orbs(e['whoops.perLength'] ?? 0)} more for every ${e['whoops.lengthStep'] ?? 0} characters, ${orbs(e['whoops.mostAdded'] ?? 0)} at most.`;
    },
    /* The author's save that washes a layer clean (the rules' `clean`, instances/divided-world/cards/whoops.ts) is the one the log names. */
    logSave: (state: unknown) => (typeof state === 'object' && state !== null && (state as { clean?: unknown }).clean === true
      ? { what: 'Washed clean', said: 'The layer is washed clean, for every reader.' }
      : undefined),
  },
  /*
   * Below the Fold (docs/plans/2026-11-11-card-notes-design.md, section 2): Salty's pink. The post is one bar until a reader presses it;
   * the effect draws the bar (ui/below-the-fold/Effect.tsx), and nothing about the fold is saved or sent.
   */
  {
    key: 'below-the-fold',
    Effect: BelowTheFoldEffect,
    art: { color: '#ff3d7f', ink: '#14030a', canvas: belowTheFoldCanvas, mark: belowTheFoldMark, credit: belowTheFoldArt.credit, tagline: 'Fold a post away.' },
    summary: 'Folds a post behind a bar. Any reader opens it with one press.',
    status: 'Folded behind a bar',
    hint: 'Press the bar to read the post.',
    describe: () =>
      `A Salty card, ${belowTheFold.rarity}. It folds a post behind a bar, for every reader alike: the post's words are still there, and anyone opens them with one press of the bar, which lasts until they leave the page. One fold fits on a post. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  },
  /*
   * The card mechanic's first plays (docs/plans/2026-11-01-card-mechanic-design.md, section 6). Pepperoni's color is the
   * board's --kb-pepperoni, with the dark ink the other faces set on theirs.
   */
  {
    key: 'card-collector',
    art: { color: '#ff3d7f', ink: '#14030a', canvas: cardCollectorCanvas, mark: cardCollectorMark, credit: cardCollectorArt.credit, tagline: 'Take a named card off your post.' },
    summary: `Set face down on your post, naming a card up to ${cardCollector.rarity}. Catches that card when it is cast there, and takes it into your hand.`,
    /* Shown only for a play that names this card; a Set is a card back, whose words are the engine's ("Face down on this post"). */
    status: 'Set, face down to everyone else',
    ConfigForm: CardCollectorConfigForm,
    describe: (settings: Settings) =>
      `A Salty card, ${cardCollector.rarity}, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. You name the one card it catches, from the cards cast on a post, ${cardCollector.rarity} or commoner. When that card is cast on your post, it is caught: it lands as caught and does nothing, and you take it into your hand. Any other card passes over it. It springs once, or ends by itself after ${settings.setLasts.count} ${settings.setLasts.unit}${settings.setLasts.count === 1 ? '' : 's'}. It costs nothing more to set.`,
  },
  {
    key: 'force-field',
    art: { color: '#2ee6ff', ink: '#03141a', canvas: forceFieldCanvas, mark: forceFieldMark, credit: forceFieldArt.credit, tagline: 'Turn away cards from your post.' },
    summary: `Used on your post. Turns away cards up to ${forceField.rarity} for ${spanWords(forceField.lasts!)}.`,
    status: `Turning away cards up to ${forceField.rarity}`,
    describe: (settings: Settings) =>
      `A Sweet card, ${forceField.rarity}, used on one of your own posts. For ${spanWords(forceField.lasts!)}, every card cast there that is ${forceField.rarity} or commoner is turned away before it lands, and its caster is told so; a rarer card lands as usual. It never stops a card set face down. It costs nothing more to use.`,
  },
  /*
   * The Gimmicks of the card types design (docs/plans/2026-11-11-card-types-design.md, section 8). Their art is placeholder, in each card's flavor's color.
   */
  {
    key: 'publicity-tour',
    art: { color: '#2ee6ff', ink: '#03141a', canvas: publicityTourCanvas, mark: publicityTourMark, credit: publicityTourArt.credit, tagline: 'Earn more from positive reactions.' },
    summary: `Used on your own character. For ${spanWords(publicityTour.lasts!)}, what it earns from positive reactions is ${earnBy(publicityTour)} higher. A loss is never made worse.`,
    status: 'Earns more from positive reactions',
    describe: (settings: Settings) =>
      `A Sweet card, ${publicityTour.rarity}, used on your own character, the one playing it. For ${spanWords(publicityTour.lasts!)}, whatever that character earns from a positive reaction (excited or calm) to its posts is ${earnBy(publicityTour)} higher, and then it stops by itself. It never makes a loss worse. It costs nothing more to use.`,
    logPlay: () => `What that character earns from positive reactions is ${earnBy(publicityTour)} higher until it ends.`,
  },
  {
    key: 'heat-magnet',
    art: { color: '#ff3d7f', ink: '#14030a', canvas: heatMagnetCanvas, mark: heatMagnetMark, credit: heatMagnetArt.credit, tagline: 'Earn more from negative reactions.' },
    summary: `Used on your own character. For ${spanWords(heatMagnet.lasts!)}, what it earns from negative reactions is ${earnBy(heatMagnet)} higher. A loss is never made worse.`,
    status: 'Earns more from negative reactions',
    describe: (settings: Settings) =>
      `A Salty card, ${heatMagnet.rarity}, used on your own character, the one playing it. For ${spanWords(heatMagnet.lasts!)}, whatever that character earns from a negative reaction (excited or bored) to its posts is ${earnBy(heatMagnet)} higher, and then it stops by itself. It never makes a loss worse. It costs nothing more to use.`,
    logPlay: () => `What that character earns from negative reactions is ${earnBy(heatMagnet)} higher until it ends.`,
  },
  {
    key: 'class-clown',
    art: { color: '#d24a2c', ink: '#1a0602', canvas: classClownCanvas, mark: classClownMark, credit: classClownArt.credit, tagline: 'Earn more from laughs and eye rolls.' },
    summary: `Used on your own character. For ${spanWords(classClown.lasts!)}, what it earns from 😂 and 🙄 is ${earnBy(classClown)} higher. A loss is never made worse.`,
    status: 'Earns more from laughs',
    describe: (settings: Settings) =>
      `A Pepperoni card, ${classClown.rarity}, used on your own character, the one playing it. For ${spanWords(classClown.lasts!)}, whatever that character earns from a 😂 or a 🙄 on its posts is ${earnBy(classClown)} higher, and then it stops by itself. It never makes a loss worse. It costs nothing more to use.`,
    logPlay: () => `What that character earns from 😂 and 🙄 is ${earnBy(classClown)} higher until it ends.`,
  },
  {
    key: 'good-vibes',
    art: { color: '#2ee6ff', ink: '#03141a', canvas: goodVibesCanvas, mark: goodVibesMark, credit: goodVibesArt.credit, tagline: 'Salty cards cost more here.' },
    summary: `Used on a thread your own character started. For ${spanWords(goodVibes.lasts!)}, casting a Salty card there costs ${priceAdd(goodVibes)} more.`,
    status: `Salty cards cost ${priceAdd(goodVibes)} more here`,
    describe: (settings: Settings) =>
      `A Sweet card, ${goodVibes.rarity}, used on a thread your own character started. For ${spanWords(goodVibes.lasts!)}, casting a Salty card in that thread, or on a post in it, costs ${priceAdd(goodVibes)} more, for everyone, and then it stops by itself. It costs nothing more to use.`,
    logPlay: () => `Casting a Salty card in that thread costs ${priceAdd(goodVibes)} more until it ends.`,
  },
  /*
   * Autocorrect (docs/plans/2026-11-03-autocorrect-design.md): Pepperoni's color, as Glitter Bomb is. Its effect is masking
   * tape, written on in marker.
   */
  {
    key: 'autocorrect',
    art: { color: '#d24a2c', ink: '#1a0602', canvas: autocorrectCanvas, mark: autocorrectMark, credit: autocorrectArt.credit, tagline: 'Tape over a word, everywhere.' },
    summary: 'Covers a phrase everywhere it appears in a post with words of your choosing.',
    hint: 'Lift a strip by one end to read what is under it.',
    status: 'Words taped over',
    Effect: AutocorrectEffect,
    ConfigForm: AutocorrectConfigForm,
    surcharge: (settings: Settings) => {
      const e = settings.economy;
      return `Covers a lot, +${orbs(e['autocorrect.perVolume'] ?? 0)} per ${e['autocorrect.volumeStep'] ?? 0} characters covered`;
    },
    describe: (settings: Settings) => {
      const e = settings.economy;
      return `A Pepperoni card, common. You type a phrase and the words to cover it with, and every place the phrase appears in the post's own words, as whole words in any case, gets a strip of tape with your words on it. Any reader can lift a strip by one end to read under it, and it lays back down. Only the post's author can peel strips off, slowly, for everyone, and the author's words are always under the tape and in the post's History. Up to three can stack on one post. ${setMoveWords('the quoting post')} A set one lands only when the quote's own words hold its phrase, and it waits for a quote that does. Playing it costs ${orbs(e['autocorrect.perVolume'] ?? 0)} more for every ${e['autocorrect.volumeStep'] ?? 0} characters it covers, ${orbs(e['autocorrect.mostAdded'] ?? 0)} at most.`;
    },
    logPlay: (config) => (typeof config.phrase === 'string' && typeof config.replacement === 'string' ? `It covers “${config.phrase}” with “${config.replacement}”.` : undefined),
    logSave: (state: unknown) => {
      const { peeled, clean, stuck } = (typeof state === 'object' && state !== null ? state : {}) as { peeled?: unknown; clean?: unknown; stuck?: unknown };
      if (clean === true) return { what: 'Peeled clean', said: 'You peeled every strip it had then. An edit that brings the phrase back brings a strip with it.' };
      const n = Array.isArray(peeled) ? peeled.length : 0;
      const m = typeof stuck === 'object' && stuck !== null && !Array.isArray(stuck) ? Object.keys(stuck).length : 0;
      if (!m) return n ? { what: 'Strips peeled', said: `You peeled ${n} of its strips.` } : undefined;
      if (!n) return { what: 'Strips peeled', said: `You started peeling ${m} of its strips.` };
      return { what: 'Strips peeled', said: `You peeled ${n} of its strips, and started on ${m} more.` };
    },
  },
  /*
   * You Were Saying? (docs/plans/2026-11-07-you-were-saying-design.md): Pepperoni's color. Its face is a terminal with a blinking cursor, and
   * its price is a range: the machine's price at the base length, each step on top of it.
   */
  {
    key: 'you-were-saying',
    art: { color: '#d24a2c', ink: '#1a0602', canvas: youWereSayingCanvas, mark: youWereSayingMark, credit: youWereSayingArt.credit, tagline: 'Let an old chatbot keep going.' },
    summary: 'Hands a post to a chatbot from 2021, which keeps writing after the author stops.',
    /* Up to the rules' `stack` chain on a post, each continuing the last. */
    status: (plays) => `Typing on, ${Math.min(plays.length, youWereSaying.stack!)} of ${youWereSaying.stack} chained`,
    Effect: YouWereSayingEffect,
    ConfigForm: YouWereSayingConfigForm,
    surcharge: (settings: Settings) => {
      const e = settings.economy;
      return `Longer costs more: +${orbs(e['youWereSaying.stepPrice'] ?? 0)} per step, ${orbs(mostSteps(settings) * (e['youWereSaying.stepPrice'] ?? 0))} at most`;
    },
    describe: (settings: Settings) => {
      const e = settings.economy;
      return `A Pepperoni card, ${youWereSaying.rarity}, cast on a post with words of its own. A chatbot from 2021 reads the post and keeps going after the author stops, and its words type themselves in after the post's. You choose how much it writes, from about ${e['youWereSaying.baseTokens'] ?? 0} tokens, a sentence, up to ${e['youWereSaying.mostTokens'] ?? 0}, a rant. The base length costs nothing more to play; each step longer costs ${orbs(e['youWereSaying.stepPrice'] ?? 0)} more. The author can erase it, but all at once, and an edit to the post gets a fresh take. Its words are the chatbot's, never the author's, and the post's own words are always there.`;
    },
    /* The caster's play line says the length the play bought, as the play recorded it (the server wrote it with the play), so it is true after any retune. */
    logPlay: (_config, { tokens }) => (tokens === undefined ? undefined : `It was played for ${tokens} ${tokens === 1 ? 'token' : 'tokens'}.`),
    /* The author's erase is the state `{ cleared }` (the rules' validateState): said as the author's own act. */
    logSave: (state: unknown) => (typeof state === 'object' && state !== null && typeof (state as { cleared?: unknown }).cleared === 'string' ? { what: 'Tail erased', verb: 'erased' } : undefined),
    /* What it did to the author's post: its first text, a new text made for an edit, and a generation that did not come. */
    logWritten: { continued: 'continued it', again: (card: string) => `made its ${card} again`, failed: "didn't take" },
  },
  /*
   * The first cards beyond a post (docs/plans/2026-11-01-card-mechanic-design.md, section 8). Glitter Bomb is Pepperoni's color; Main Event is Sweet's, as Force Field is.
   */
  {
    key: 'glitter-bomb',
    Effect: GlitterBombEffect,
    art: { color: '#d24a2c', ink: '#1a0602', canvas: glitterBombCanvas, mark: glitterBombMark, credit: glitterBombArt.credit, tagline: 'Make a character sparkle.' },
    summary: `Cast on a character. Every post by that character sparkles for ${spanWords(glitterBomb.lasts!)}.`,
    status: 'Sparkling every post by that character',
    describe: (settings: Settings) =>
      `A Pepperoni card, ${glitterBomb.rarity}, cast from any post by the character it lands on. For ${spanWords(glitterBomb.lasts!)}, every one of that character's posts sparkles, wherever it is, and then it stops by itself. It falls on that mask alone. ${setMoveWords("the quoting post's character")} It costs nothing more to play.`,
  },
  {
    key: 'main-event',
    art: { color: '#2ee6ff', ink: '#03141a', canvas: mainEventCanvas, mark: mainEventMark, credit: mainEventArt.credit, tagline: 'Pin a thread to the top of its board.' },
    summary: `Cast on a thread. Pins it to the top of its board for ${spanWords(mainEvent.lasts!)}.`,
    status: "Pinned to its board's top",
    describe: (settings: Settings) =>
      `A Sweet card, ${mainEvent.rarity}, cast on a thread from its title. For ${spanWords(mainEvent.lasts!)}, the thread is pinned above the first page of its board's list, and then it drops back to its place by itself. It takes no other thread's place on the page. ${setMoveWords("the quoting post's thread")} It costs nothing more to play.`,
  },
  /*
   * The onboarding's first card (docs/plans/2026-11-02-onboarding-design.md, section 5), the Face's own: Sweet's cyan, as Force Field is.
   * Its rainbow grows with each Feelin' Fab on the post, up to three.
   */
  {
    key: 'feelin-fab',
    Effect: FeelinFabEffect,
    art: { color: '#2ee6ff', ink: '#03141a', canvas: feelinFabCanvas, mark: feelinFabMark, credit: feelinFabArt.credit, tagline: 'Give a post a rainbow.' },
    /* Up to the rules' `stack` can be on a post; the status counts the plays there. */
    status: (plays) => `${Math.min(plays.length, feelinFab.stack!)} of ${feelinFab.stack} stacked`,
    hint: "A Feelin' Fab: the more of them on a post, the more it glows.",
    summary: 'Gives a post a rainbow behind its words. Up to three can stack, and each makes it grander.',
    describe: (settings: Settings) =>
      `A Sweet card, common. It gives a post a rainbow behind its words, which stay as readable as ever. One makes the whole post's background drift slowly through the rainbow; two make it an animated rainbow band; three make it an animated radial rainbow, with the colors spreading out from the middle. A few twinkles come with it. Up to three can be on one post, and it stays as long as the post does. ${setMoveWords('the quoting post')} It costs nothing more to play.`,
  },
  /*
   * Hall Pass (docs/plans/2026-11-07-face-down-moves-design.md, section 4): Sweet's cyan, as Force Field is. A Gimmick, set face down
   * like Card Collector; what it springs on is a Mod Bot's visit, so it names no card.
   */
  {
    key: 'hall-pass',
    art: { color: '#2ee6ff', ink: '#03141a', canvas: hallPassCanvas, mark: hallPassMark, credit: hallPassArt.credit, tagline: "Wave a Mod Bot's visit away." },
    summary: "Set face down on your post. Ends the next Mod Bot visit to it when the visit starts.",
    /* As Card Collector's: the same words, so none can be told from another. */
    status: 'Set, face down to everyone else',
    describe: (settings: Settings) =>
      `A Sweet card, uncommon, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. The next time a Mod Bot's visit to that post starts, the visit ends there and then, before the Mod Bot does anything to the post; the visit's own posts stay. It springs once, or ends by itself after ${settings.setLasts.count} ${settings.setLasts.unit}${settings.setLasts.count === 1 ? '' : 's'} if no visit comes. It costs nothing more to set.`,
  },
] satisfies CardUi[]);
