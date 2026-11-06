/**
 * Stock lines: what The System says at each standing order when a model call is out of budget
 * or fails (design, section 2), so cost never grows without bound and nothing stalls. In the
 * board's world, so they may bluff; they carry no fact the glass does not show plainly. Each key
 * may use only the tokens the engine gives it (engine/system/stock.ts): `{move}` a move's plain
 * name, `{boss}` a Boss's name, `{board}` a board's name, `{rule}` a rule's number and words. Several lines a key, so one is not
 * heard every time.
 */
import type { StockLines } from '../../../engine/rules/types.ts';

export const stockLines: StockLines = Object.freeze({
  moveLanded: Object.freeze([
    'It is done: {move}. The System has spoken and does not take questions.',
    'Effective immediately: {move}. Please remain calm and keep posting.',
    'The System has decided on {move}. The System feels good about it.',
  ]),
  moveMet: Object.freeze([
    'You did it. {move} is over. The System is not proud, it is merely satisfied.',
    'The demand was met and {move} is lifted. Do not let it go to your heads.',
    'Fine. {move} ends here. Well performed. Do not get used to it.',
  ]),
  moveExpired: Object.freeze([
    'Nobody did anything, so {move} has run its course. The System is not disappointed. It is a little disappointed.',
    'Time is up: {move} is over. The System was going to do something about that, and now it will not.',
    '{move} has expired. The System has already moved on to something it will like more.',
  ]),
  moveReversed: Object.freeze([
    'A higher power has stepped in and {move} is undone. The System has been overruled and would like that noted.',
    'It turns out {move} was a mistake. The System stands by it, and it is also over.',
    'Management has intervened: {move} is reversed. The System would like a word with Management.',
  ]),
  moveSuperseded: Object.freeze([
    'A new era has begun, and {move} has been filed under things the last Boss did. It is over.',
    'The new Boss has looked at {move} and decided it was somebody else\'s idea. It is set aside.',
    'Regime change: {move} did not survive the handover. The System sends its regards.',
  ]),
  bossFarewell: Object.freeze([
    '{boss} is leaving the building. Please stop clapping.',
    'This season belonged to {boss}. {boss} regrets nothing and will say so at length.',
    '{boss} has cleared out the desk. The stapler, it is said, was not returned.',
  ]),
  bossArrival: Object.freeze([
    '{boss} is your Boss now. Nobody asked you, and nobody will.',
    'Make way for {boss}, who has read the file on every one of you and found it thin.',
    '{boss} has taken the seat. The seat is warm. Nobody wants to talk about why.',
  ]),
  boardDescription: Object.freeze([
    'Welcome to {board}! Posts go here. Posts also go elsewhere. The System has decided this is the better one.',
    '{board}: a board. Please be nice, or at least be interesting.',
    'The System was told to describe {board} and has chosen to give you a feeling instead.',
  ]),
  // A first draft for Task 14 to widen: the line says a rule is set, and the rule is named by the engine's words.
  ruleSet: Object.freeze([
    'New law on {board}. {rule}. The System expects compliance and will notice either way.',
    'Be advised, {board}: {rule}. The System has written it down so nobody can say they were not told.',
    'The System has added to the pile on {board}: {rule}. The System regrets nothing.',
  ]),
  // First drafts for Task 14 to widen: a Mod arriving on a post, and filing it. `{rule}` is the rules charged, in the engine's words.
  visitArrived: Object.freeze([
    '{mod} has taken an interest in this post. {rule}. {mod} will be back.',
    'This post is now under inspection by {mod}: {rule}.',
    '{mod} is looking at this post. The charge is {rule}. {mod} takes a long time over these.',
  ]),
  visitFiled: Object.freeze([
    '{mod} has finished with this post and found it in violation of {rule}.',
    'Inspection over. {mod} files this post under {rule}.',
    '{mod} found this post in violation of {rule}, and has written it down.',
  ]),
});
