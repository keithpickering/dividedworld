/**
 * Divided World's System content: the roster of personas, who does each duty, the stock lines,
 * the outside feeds, the never-amplified subjects, the wheelhouse, and the
 * PPP name style. It reaches the engine as `Instance.system`; the engine never names anything here
 * ("KayfaBB never knows which instance it runs"). The numbers are settings (../settings.ts).
 *
 * The roster holds FanGaME, the first Boss (the FanGaME design), then ONTOPIC 5.0 and QC-1000, the first staff. Its
 * order is the succession's: seed_instance keeps it as `bossRoster` (docs/plans/2026-11-13-launch-design.md, section 4).
 * The placeholder Bosses and the placeholder Mod Bot are test fixtures (`instances/divided-world/system/fixtures/`),
 * never in the roster.
 */
import type { SystemContent } from '../../../engine/rules/types.ts';
import { deepFreeze } from '../../../engine/rules/instance.ts';
import { fangame } from './personas/fangame.ts';
import { ontopic } from './personas/ontopic.ts';
import { qualityControl } from './personas/quality-control.ts';
import { feeds } from './feeds.ts';
import { stockLines } from './lines.ts';
import { nameStyle, nameStyleBrief } from './name-style.ts';
import { offices } from './persona.ts';
import { realWorld } from './real-world.ts';
import { scrubWords } from './scrub-words.ts';
import { wheelhouse } from './wheelhouse.ts';

export const system: SystemContent = Object.freeze({
  roster: deepFreeze([fangame, ontopic, qualityControl]),
  firstBoss: fangame.key,
  offices,
  // The title of each staff thread a landed move opens, by kind (0437); a kind not named is titled by its plain words.
  threadTitles: Object.freeze({
    renameBoard: '{board} is now {name}', nameSuccessor: 'On the matter of succession', setRule: 'New rule in {board}', conferGroup: 'Welcome to {groupName}',
    pullSlot: 'Machine notice: a card is pulled', repriceSlot: 'Machine notice: new prices', flashSale: 'Flash sale!', createBoard: 'New board: {name}',
    moveThread: 'A thread moves to {board}', mergeBoard: '{board} is closing', awardTrophy: '{trophyName} goes to {characterName}',
  }),
  handoverThreadTitle: '{boss} takes the chair',
  rosterHeadings: Object.freeze({ newcomers: 'New faces', announced: 'Turns announced', landed: 'Turns taking effect', reveals: 'Reveals' }),
  rosterStockHeading: 'The roster, as of the last settlement.',
  firstStaff: Object.freeze([ontopic.key, qualityControl.key]),
  // The Boss's own duties stay the season's Boss's; a visit's filing, a report's verdict and a patrol's finding are the Mod on the board's beat, and an appeal is
  // the Mod that filed (the Mod Bots plan, Task 7).
  duties: Object.freeze({ meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'filer', chatter: 'boss', filing: 'beat', reportJudge: 'beat', patrolJudge: 'beat', apologyJudge: 'filer', conversation: 'boss', roster: 'boss' } as const),
  stockLines,
  feeds,
  realWorld,
  scrubWords,
  wheelhouse,
  nameStyle,
  nameStyleBrief,
});
