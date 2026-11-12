/**
 * Divided World's cards: two Casts (Stick Around, Whoops!), and the card mechanic's first plays (Card Collector, Force Field; the
 * card mechanic's design, section 6), and the first cards beyond a post: Glitter Bomb on a character and Main Event on a thread (section 8).
 * Feelin' Fab, the Face's rainbow, is the first card of the onboarding (docs/plans/2026-11-02-onboarding-design.md, section 5).
 * Autocorrect, the Minus World signature and the Jabroni's starter (docs/plans/2026-11-03-autocorrect-design.md).
 * The Reversals, cards set face down that spring on something: Card Collector (a named card cast there) and Hall Pass (a Mod Bot's visit).
 * The Gimmicks (docs/plans/2026-11-11-card-types-design.md): Force Field, Publicity Tour, Heat Magnet, Class Clown and Good Vibes.
 * You Were Saying?, the one card that writes, a Move only ever cast face up: the old voice finishes the post (docs/plans/2026-11-07-you-were-saying-design.md).
 * Below the Fold, Salty's bar over a post (docs/plans/2026-11-11-card-notes-design.md, section 2).
 * Part 6 (docs/plans/2026-11-11-card-notes-part-6-plan.md): Mooch, Toll and 4D Chess pay a share of a vote, and Off Day scores a character as a class.
 * Part 4 (docs/plans/2026-11-11-card-notes-part-4-plan.md): Sugar Coat turns away Salty and Pepperoni cards, Hype-Up is Publicity Tour's push on another's mask, and Last Word stops quotes of a post.
 * Jimmy Wails, the first card with a drive: an appeal cast on a post that anyone may give to (docs/plans/2026-11-03-jimmy-wails-design.md).
 * Laugh Track, an audience that laughs, cheers or boos at the cued words of a post as a reader reaches them (docs/plans/2026-11-11-laugh-track-design.md).
 * Graffiti, the first surface: a wall on a post any character may draw on (docs/plans/2026-11-11-graffiti-design.md).
 */
import { QUADRANTS } from '../../../engine/rules/types.ts';
import { atOrBelow, castOnPost, type CardRules } from '../../../engine/rules/cards.ts';
import { fourDChess as fourDChessBase } from './4d-chess.ts';
import { autocorrect } from './autocorrect.ts';
import { belowTheFold } from './below-the-fold.ts';
import { cardCollector as cardCollectorBase } from './card-collector.ts';
import { classClown } from './class-clown.ts';
import { feelinFab } from './feelin-fab.ts';
import { forceField } from './force-field.ts';
import { glitterBomb } from './glitter-bomb.ts';
import { graffiti } from './graffiti.ts';
import { goodVibes } from './good-vibes.ts';
import { hallPass } from './hall-pass.ts';
import { heatMagnet } from './heat-magnet.ts';
import { hypeUp } from './hype-up.ts';
import { jimmyWails } from './jimmy-wails.ts';
import { laughTrack } from './laugh-track.ts';
import { lastWord } from './last-word.ts';
import { mainEvent } from './main-event.ts';
import { mooch } from './mooch.ts';
import { offDay } from './off-day.ts';
import { publicityTour } from './publicity-tour.ts';
import { toll } from './toll.ts';
import { stickAround } from './stick-around.ts';
import { sugarCoat } from './sugar-coat.ts';
import { whoops } from './whoops.ts';
import { youWereSaying } from './you-were-saying.ts';

const listed: readonly CardRules[] = [stickAround as CardRules, whoops as CardRules, cardCollectorBase as CardRules, hallPass as CardRules, forceField as CardRules, publicityTour as CardRules, heatMagnet as CardRules, classClown as CardRules, goodVibes as CardRules, glitterBomb as CardRules, mainEvent as CardRules, feelinFab as CardRules, autocorrect as CardRules, youWereSaying as CardRules, belowTheFold as CardRules, mooch as CardRules, toll as CardRules, fourDChessBase as CardRules, offDay as CardRules, jimmyWails as CardRules, sugarCoat as CardRules, hypeUp as CardRules, lastWord as CardRules, laughTrack as CardRules, graffiti as CardRules];

/**
 * Card Collector, with the card a persona may name as an enum of the instance's cards cast on a post at or below its own rarity (the only
 * ones `decideSet` lets it name): built here so card-collector.ts imports no other card.
 */
const cardCollector = {
  ...cardCollectorBase,
  staffOptions: {
    prompt: 'Choose the card this Card Collector catches: the first play of it on this post is caught.',
    schema: { type: 'object', properties: { card: { type: 'string', enum: listed.filter((c) => castOnPost(c) && atOrBelow(c.rarity, cardCollectorBase.rarity)).map((c) => c.key) } }, required: ['card'], additionalProperties: false },
  },
} as CardRules;

/** 4D Chess, with the Move a persona may name as an enum of the instance's cards cast on a post up to uncommon, and the quadrant it pays on. */
const fourDChess = {
  ...fourDChessBase,
  staffOptions: {
    prompt: 'Choose the Move this 4D Chess waits for and the reactions it pays on: the first play of it on this post pays you for votes in that quadrant.',
    schema: {
      type: 'object',
      properties: {
        card: { type: 'string', enum: listed.filter((c) => castOnPost(c) && atOrBelow(c.rarity, fourDChessBase.rarity)).map((c) => c.key) },
        quadrant: { type: 'string', enum: [...QUADRANTS] },
      },
      required: ['card', 'quadrant'],
      additionalProperties: false,
    },
  },
} as CardRules;

const staffed = new Map([cardCollector, fourDChess].map((c) => [c.key, c]));

export const cards: readonly CardRules[] = Object.freeze(listed.map((c) => staffed.get(c.key) ?? c));
