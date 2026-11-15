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
 * Part 4 (docs/plans/2026-11-11-card-notes-part-4-plan.md): Sugar Coat turns away Salty and Pepperoni cards, Hype-Up is Publicity Tour's push, doubled, on one post (docs/plans/2026-11-13-hype-up-on-a-post-plan.md), and Last Word stops quotes of a post.
 * Part 3 (docs/plans/2026-11-11-card-notes-part-3-plan.md): Whodunnit? veils a post's author, Blind Study its reaction totals, and Overreaction adds a reaction to one post's picker.
 * Jimmy Wails, the first card with a drive: an appeal cast on a post that anyone may give to (docs/plans/2026-11-03-jimmy-wails-design.md).
 * Laugh Track, an audience that laughs, cheers or boos at the cued words of a post as a reader points at or taps them (docs/plans/2026-11-11-laugh-track-design.md).
 * Graffiti, the first surface: a wall on a post any character may draw on (docs/plans/2026-11-11-graffiti-design.md).
 * Part 2 (docs/plans/2026-11-11-card-notes-part-2-plan.md): Line Cutter posts a reply right under a post, and Feelin' Glam gives a thread's posts one more Feelin' Fab level for a week.
 * Part 5 (docs/plans/2026-11-11-card-notes-part-5-plan.md): the three Happy Hearts take points off a warn bar or end a ban, Take the Fall moves a filing to the caster, and Tattle-Tale makes a Mod Bot patrol likelier to look at a character.
 * THIS, Pepperoni's arrow at a phrase of a post, with a few words after it (docs/plans/2026-11-13-this-design.md).
 */
import { QUADRANTS, type Hundredths } from '../../../engine/rules/types.ts';
import { atOrBelow, castOnPost, type CardRules } from '../../../engine/rules/cards.ts';
import { fourDChess as fourDChessBase, price as fourDChessPrice } from './4d-chess.ts';
import { autocorrect, price as autocorrectPrice } from './autocorrect.ts';
import { blindStudy, price as blindStudyPrice } from './blind-study.ts';
import { belowTheFold, price as belowTheFoldPrice } from './below-the-fold.ts';
import { cardCollector as cardCollectorBase, price as cardCollectorPrice } from './card-collector.ts';
import { classClown, price as classClownPrice } from './class-clown.ts';
import { feelinFab, price as feelinFabPrice } from './feelin-fab.ts';
import { feelinGlam, price as feelinGlamPrice } from './feelin-glam.ts';
import { forceField, price as forceFieldPrice } from './force-field.ts';
import { glitterBomb, price as glitterBombPrice } from './glitter-bomb.ts';
import { graffiti, price as graffitiPrice } from './graffiti.ts';
import { goodVibes, price as goodVibesPrice } from './good-vibes.ts';
import { happyHeart, price as happyHeartPrice } from './happy-heart.ts';
import { hallPass, price as hallPassPrice } from './hall-pass.ts';
import { heatMagnet, price as heatMagnetPrice } from './heat-magnet.ts';
import { hypeUp, price as hypeUpPrice } from './hype-up.ts';
import { jimmyWails, price as jimmyWailsPrice } from './jimmy-wails.ts';
import { laughTrack, price as laughTrackPrice } from './laugh-track.ts';
import { lastWord, price as lastWordPrice } from './last-word.ts';
import { lineCutter, price as lineCutterPrice } from './line-cutter.ts';
import { mainEvent, price as mainEventPrice } from './main-event.ts';
import { mooch, price as moochPrice } from './mooch.ts';
import { offDay, price as offDayPrice } from './off-day.ts';
import { overreaction, price as overreactionPrice } from './overreaction.ts';
import { publicityTour, price as publicityTourPrice } from './publicity-tour.ts';
import { toll, price as tollPrice } from './toll.ts';
import { stickAround, price as stickAroundPrice } from './stick-around.ts';
import { sugarCoat, price as sugarCoatPrice } from './sugar-coat.ts';
import { superHappyHeart, price as superHappyHeartPrice } from './super-happy-heart.ts';
import { thisCard, price as thisCardPrice } from './this.ts';
import { takeTheFall, price as takeTheFallPrice } from './take-the-fall.ts';
import { tattleTale, price as tattleTalePrice } from './tattle-tale.ts';
import { ultraHappyHeart, price as ultraHappyHeartPrice } from './ultra-happy-heart.ts';
import { whodunnit, price as whodunnitPrice } from './whodunnit.ts';
import { whoops, price as whoopsPrice } from './whoops.ts';
import { youWereSaying, price as youWereSayingPrice } from './you-were-saying.ts';

const listed: readonly (readonly [CardRules, Hundredths])[] = [[stickAround as CardRules, stickAroundPrice], [whoops as CardRules, whoopsPrice], [cardCollectorBase as CardRules, cardCollectorPrice], [hallPass as CardRules, hallPassPrice], [forceField as CardRules, forceFieldPrice], [publicityTour as CardRules, publicityTourPrice], [heatMagnet as CardRules, heatMagnetPrice], [classClown as CardRules, classClownPrice], [goodVibes as CardRules, goodVibesPrice], [glitterBomb as CardRules, glitterBombPrice], [mainEvent as CardRules, mainEventPrice], [feelinFab as CardRules, feelinFabPrice], [autocorrect as CardRules, autocorrectPrice], [youWereSaying as CardRules, youWereSayingPrice], [belowTheFold as CardRules, belowTheFoldPrice], [mooch as CardRules, moochPrice], [toll as CardRules, tollPrice], [fourDChessBase as CardRules, fourDChessPrice], [offDay as CardRules, offDayPrice], [jimmyWails as CardRules, jimmyWailsPrice], [sugarCoat as CardRules, sugarCoatPrice], [hypeUp as CardRules, hypeUpPrice], [lastWord as CardRules, lastWordPrice], [laughTrack as CardRules, laughTrackPrice], [graffiti as CardRules, graffitiPrice], [lineCutter as CardRules, lineCutterPrice], [feelinGlam as CardRules, feelinGlamPrice], [whodunnit as CardRules, whodunnitPrice], [blindStudy as CardRules, blindStudyPrice], [overreaction as CardRules, overreactionPrice], [happyHeart as CardRules, happyHeartPrice], [superHappyHeart as CardRules, superHappyHeartPrice], [ultraHappyHeart as CardRules, ultraHappyHeartPrice], [takeTheFall as CardRules, takeTheFallPrice], [tattleTale as CardRules, tattleTalePrice], [thisCard as CardRules, thisCardPrice]];

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
