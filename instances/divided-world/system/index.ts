/**
 * Divided World's System content: the roster of personas, who does each duty, the stock lines,
 * the outside feeds, the never-amplified subjects, the wheelhouse, and the
 * PPP name style. It reaches the engine as `Instance.system`; the engine never names anything here
 * ("KayfaBB never knows which instance it runs"). The numbers are settings (../settings.ts).
 *
 * The roster holds FanGaME, the first Boss (the FanGaME design), and the placeholder Mod Bot until the Mod roster is
 * written. The three placeholder Bosses are test fixtures (`instances/divided-world/system/fixtures/`), never in the roster.
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
  announcementsTitle: 'Announcements From The System',
  firstStaff: Object.freeze([ontopic.key, qualityControl.key]),
  // The Boss's own duties stay the season's Boss's; a visit's filing, a report's verdict and a patrol's finding are the Mod on the board's beat, and an appeal is
  // the Mod that filed (the Mod Bots plan, Task 7).
  duties: Object.freeze({ meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'filer', chatter: 'boss', filing: 'beat', reportJudge: 'beat', patrolJudge: 'beat', apologyJudge: 'filer' } as const),
  stockLines,
  feeds,
  realWorld,
  scrubWords,
  wheelhouse,
  nameStyle,
  nameStyleBrief,
});
