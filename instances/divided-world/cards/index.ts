/**
 * Divided World's cards: the one list of them, each with the price the Vending Machine sells it for. `cards` and `prices` are both built
 * from it, so the two cannot disagree.
 *
 * A card is added in its own files: its rules and `price` in `cards/<key>.ts`, its tests in `cards/<key>.test.ts`, and its screen entry in
 * `ui/cards/<key>/ui.ts`. Then it takes one line in each of this file's two runs (the imports and the list) and one in each of
 * `ui/cards.ts`'s two runs, at its place in key order. The runs hold one card per line, sorted by key, with nothing between the lines,
 * so two cards built at once touch the same lines only when their keys are neighbors (docs/plans/2026-11-14-base-set-design.md,
 * sections 2 and 4). Keys sort by plain string comparison, so `4d-chess` comes first; a test holds the order.
 */
import { QUADRANTS, type Hundredths } from '../../../engine/rules/types.ts';
import { atOrBelow, castOnPost, type CardRules } from '../../../engine/rules/cards.ts';
import { fourDChess as fourDChessBase, price as fourDChessPrice } from './4d-chess.ts';
import { autocorrect, price as autocorrectPrice } from './autocorrect.ts';
import { belowTheFold, price as belowTheFoldPrice } from './below-the-fold.ts';
import { blindStudy, price as blindStudyPrice } from './blind-study.ts';
import { cardCollector as cardCollectorBase, price as cardCollectorPrice } from './card-collector.ts';
import { classClown, price as classClownPrice } from './class-clown.ts';
import { feelinFab, price as feelinFabPrice } from './feelin-fab.ts';
import { feelinGlam, price as feelinGlamPrice } from './feelin-glam.ts';
import { forceField, price as forceFieldPrice } from './force-field.ts';
import { glitterBomb, price as glitterBombPrice } from './glitter-bomb.ts';
import { goodVibes, price as goodVibesPrice } from './good-vibes.ts';
import { graffiti, price as graffitiPrice } from './graffiti.ts';
import { hallPass, price as hallPassPrice } from './hall-pass.ts';
import { happyHeart, price as happyHeartPrice } from './happy-heart.ts';
import { heatMagnet, price as heatMagnetPrice } from './heat-magnet.ts';
import { hypeUp, price as hypeUpPrice } from './hype-up.ts';
import { jimmyWails, price as jimmyWailsPrice } from './jimmy-wails.ts';
import { lastWord, price as lastWordPrice } from './last-word.ts';
import { laughTrack, price as laughTrackPrice } from './laugh-track.ts';
import { lineCutter, price as lineCutterPrice } from './line-cutter.ts';
import { mainEvent, price as mainEventPrice } from './main-event.ts';
import { mooch, price as moochPrice } from './mooch.ts';
import { offDay, price as offDayPrice } from './off-day.ts';
import { overreaction, price as overreactionPrice } from './overreaction.ts';
import { publicityTour, price as publicityTourPrice } from './publicity-tour.ts';
import { ropeBreak, price as ropeBreakPrice } from './rope-break.ts';
import { stickAround, price as stickAroundPrice } from './stick-around.ts';
import { sugarCoat, price as sugarCoatPrice } from './sugar-coat.ts';
import { superHappyHeart, price as superHappyHeartPrice } from './super-happy-heart.ts';
import { takeTheFall, price as takeTheFallPrice } from './take-the-fall.ts';
import { tattleTale, price as tattleTalePrice } from './tattle-tale.ts';
import { thisCard, price as thisCardPrice } from './this.ts';
import { toll, price as tollPrice } from './toll.ts';
import { ultraHappyHeart, price as ultraHappyHeartPrice } from './ultra-happy-heart.ts';
import { whodunnit, price as whodunnitPrice } from './whodunnit.ts';
import { whoops, price as whoopsPrice } from './whoops.ts';
import { youWereSaying, price as youWereSayingPrice } from './you-were-saying.ts';

const listed: readonly (readonly [CardRules, Hundredths])[] = [
  [fourDChessBase as CardRules, fourDChessPrice],
  [autocorrect as CardRules, autocorrectPrice],
  [belowTheFold as CardRules, belowTheFoldPrice],
  [blindStudy as CardRules, blindStudyPrice],
  [cardCollectorBase as CardRules, cardCollectorPrice],
  [classClown as CardRules, classClownPrice],
  [feelinFab as CardRules, feelinFabPrice],
  [feelinGlam as CardRules, feelinGlamPrice],
  [forceField as CardRules, forceFieldPrice],
  [glitterBomb as CardRules, glitterBombPrice],
  [goodVibes as CardRules, goodVibesPrice],
  [graffiti as CardRules, graffitiPrice],
  [hallPass as CardRules, hallPassPrice],
  [happyHeart as CardRules, happyHeartPrice],
  [heatMagnet as CardRules, heatMagnetPrice],
  [hypeUp as CardRules, hypeUpPrice],
  [jimmyWails as CardRules, jimmyWailsPrice],
  [lastWord as CardRules, lastWordPrice],
  [laughTrack as CardRules, laughTrackPrice],
  [lineCutter as CardRules, lineCutterPrice],
  [mainEvent as CardRules, mainEventPrice],
  [mooch as CardRules, moochPrice],
  [offDay as CardRules, offDayPrice],
  [overreaction as CardRules, overreactionPrice],
  [publicityTour as CardRules, publicityTourPrice],
  [ropeBreak as CardRules, ropeBreakPrice],
  [stickAround as CardRules, stickAroundPrice],
  [sugarCoat as CardRules, sugarCoatPrice],
  [superHappyHeart as CardRules, superHappyHeartPrice],
  [takeTheFall as CardRules, takeTheFallPrice],
  [tattleTale as CardRules, tattleTalePrice],
  [thisCard as CardRules, thisCardPrice],
  [toll as CardRules, tollPrice],
  [ultraHappyHeart as CardRules, ultraHappyHeartPrice],
  [whodunnit as CardRules, whodunnitPrice],
  [whoops as CardRules, whoopsPrice],
  [youWereSaying as CardRules, youWereSayingPrice],
];

/**
 * Card Collector, with the card a persona may name as an enum of the instance's cards cast on a post at or below its own rarity (the only
 * ones `decideSet` lets it name): built here so card-collector.ts imports no other card.
 */
const cardCollector = {
  ...cardCollectorBase,
  staffOptions: {
    prompt: 'Choose the card this Card Collector catches: the first play of it on this post is caught.',
    schema: { type: 'object', properties: { card: { type: 'string', enum: listed.filter(([c]) => castOnPost(c) && atOrBelow(c.rarity, cardCollectorBase.rarity)).map(([c]) => c.key) } }, required: ['card'], additionalProperties: false },
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
        card: { type: 'string', enum: listed.filter(([c]) => castOnPost(c) && atOrBelow(c.rarity, fourDChessBase.rarity)).map(([c]) => c.key) },
        quadrant: { type: 'string', enum: [...QUADRANTS] },
      },
      required: ['card', 'quadrant'],
      additionalProperties: false,
    },
  },
} as CardRules;

const staffed = new Map([cardCollector, fourDChess].map((c) => [c.key, c]));

export const cards: readonly CardRules[] = Object.freeze(listed.map(([c]) => staffed.get(c.key) ?? c));

/** What the Vending Machine sells each card for, from the same list as `cards`, so the two cannot disagree. */
export const prices: ReadonlyMap<string, Hundredths> = new Map(listed.map(([c, p]) => [c.key, p]));
