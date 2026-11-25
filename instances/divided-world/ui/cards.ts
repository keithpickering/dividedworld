/**
 * How Divided World's cards look and read to the engine's screens (`InstanceUi.cards`): each card's face, and its rules in plain words
 * for the Vending Machine and the hand. An entry lives in `ui/cards/<key>/ui.ts`, beside the card's art; this file lists them. A card's
 * rules themselves are `instances/divided-world/cards/`, whose settings these read, so a number said here is the one the instance runs
 * on. The words more than one entry says are `ui/cards/words.ts`.
 *
 * The imports and the list below hold one card per line, sorted by key, with nothing between the lines; a new card takes one line in
 * each, at its place in key order (`cards/index.ts` says how a card is added, and a test holds the order).
 *
 * The faces' colors are the Cards board's: Sweet is the cyan, Salty the pink, each with the dark
 * ink the board sets on it (docs/research/2026-10-29-two-worlds/05-cards.html).
 */
import type { CardUi } from '../../../engine/ui/cards/types.ts';
import { ui as fourDChessUi } from './cards/4d-chess/ui.ts';
import { ui as autocorrectUi } from './cards/autocorrect/ui.ts';
import { ui as belowTheFoldUi } from './cards/below-the-fold/ui.ts';
import { ui as blindStudyUi } from './cards/blind-study/ui.ts';
import { ui as buzzkillUi } from './cards/buzzkill/ui.ts';
import { ui as cardCollectorUi } from './cards/card-collector/ui.ts';
import { ui as cheapShotUi } from './cards/cheap-shot/ui.ts';
import { ui as classClownUi } from './cards/class-clown/ui.ts';
import { ui as feelinFabUi } from './cards/feelin-fab/ui.ts';
import { ui as feelinGlamUi } from './cards/feelin-glam/ui.ts';
import { ui as forceFieldUi } from './cards/force-field/ui.ts';
import { ui as frontRowUi } from './cards/front-row/ui.ts';
import { ui as glitterBombUi } from './cards/glitter-bomb/ui.ts';
import { ui as goodVibesUi } from './cards/good-vibes/ui.ts';
import { ui as graffitiUi } from './cards/graffiti/ui.ts';
import { ui as hallPassUi } from './cards/hall-pass/ui.ts';
import { ui as happyHeartUi } from './cards/happy-heart/ui.ts';
import { ui as heatMagnetUi } from './cards/heat-magnet/ui.ts';
import { ui as hotBoxUi } from './cards/hot-box/ui.ts';
import { ui as hypeUpUi } from './cards/hype-up/ui.ts';
import { ui as itsCurtainsUi } from './cards/its-curtains/ui.ts';
import { ui as jimmyWailsUi } from './cards/jimmy-wails/ui.ts';
import { ui as kickMeUi } from './cards/kick-me/ui.ts';
import { ui as lastWordUi } from './cards/last-word/ui.ts';
import { ui as laughTrackUi } from './cards/laugh-track/ui.ts';
import { ui as lineCutterUi } from './cards/line-cutter/ui.ts';
import { ui as mainEventUi } from './cards/main-event/ui.ts';
import { ui as moochUi } from './cards/mooch/ui.ts';
import { ui as offDayUi } from './cards/off-day/ui.ts';
import { ui as overreactionUi } from './cards/overreaction/ui.ts';
import { ui as payItForwardUi } from './cards/pay-it-forward/ui.ts';
import { ui as popStealUi } from './cards/pop-steal/ui.ts';
import { ui as publicityTourUi } from './cards/publicity-tour/ui.ts';
import { ui as requiredReadingUi } from './cards/required-reading/ui.ts';
import { ui as ropeBreakUi } from './cards/rope-break/ui.ts';
import { ui as soVeryHappyUi } from './cards/so-very-happy/ui.ts';
import { ui as steelChairUi } from './cards/steel-chair/ui.ts';
import { ui as stickAroundUi } from './cards/stick-around/ui.ts';
import { ui as sugarCoatUi } from './cards/sugar-coat/ui.ts';
import { ui as superHappyHeartUi } from './cards/super-happy-heart/ui.ts';
import { ui as sweetHeatUi } from './cards/sweet-heat/ui.ts';
import { ui as takeTheFallUi } from './cards/take-the-fall/ui.ts';
import { ui as tattleTaleUi } from './cards/tattle-tale/ui.ts';
import { ui as thickSkinUi } from './cards/thick-skin/ui.ts';
import { ui as thisUi } from './cards/this/ui.ts';
import { ui as timeMachineUi } from './cards/time-machine/ui.ts';
import { ui as tollUi } from './cards/toll/ui.ts';
import { ui as ultraHappyHeartUi } from './cards/ultra-happy-heart/ui.ts';
import { ui as whodunnitUi } from './cards/whodunnit/ui.ts';
import { ui as whoopeeCushionUi } from './cards/whoopee-cushion/ui.ts';
import { ui as whoopsUi } from './cards/whoops/ui.ts';
import { ui as youWereSayingUi } from './cards/you-were-saying/ui.ts';

export { spanWords } from './cards/words.ts';

export const cardsUi: readonly CardUi[] = Object.freeze([
  fourDChessUi,
  autocorrectUi,
  belowTheFoldUi,
  blindStudyUi,
  buzzkillUi,
  cardCollectorUi,
  cheapShotUi,
  classClownUi,
  feelinFabUi,
  feelinGlamUi,
  forceFieldUi,
  frontRowUi,
  glitterBombUi,
  goodVibesUi,
  graffitiUi,
  hallPassUi,
  happyHeartUi,
  heatMagnetUi,
  hotBoxUi,
  hypeUpUi,
  itsCurtainsUi,
  jimmyWailsUi,
  kickMeUi,
  lastWordUi,
  laughTrackUi,
  lineCutterUi,
  mainEventUi,
  moochUi,
  offDayUi,
  overreactionUi,
  payItForwardUi,
  popStealUi,
  publicityTourUi,
  requiredReadingUi,
  ropeBreakUi,
  soVeryHappyUi,
  steelChairUi,
  stickAroundUi,
  sugarCoatUi,
  superHappyHeartUi,
  sweetHeatUi,
  takeTheFallUi,
  tattleTaleUi,
  thickSkinUi,
  thisUi,
  timeMachineUi,
  tollUi,
  ultraHappyHeartUi,
  whodunnitUi,
  whoopeeCushionUi,
  whoopsUi,
  youWereSayingUi,
] satisfies CardUi[]);
