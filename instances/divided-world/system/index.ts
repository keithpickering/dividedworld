/**
 * Divided World's System content: the roster of personas, who does each duty, the stock lines,
 * the outside feeds, the never-amplified subjects, the wheelhouse, and the
 * PPP name style. It reaches the engine as `Instance.system`; the engine never names anything here
 * ("KayfaBB never knows which instance it runs"). The numbers are settings (../settings.ts).
 *
 * The roster is four PLACEHOLDER personas: three that serve as Bosses and one as a Mod Bot. The real roster is written
 * with the owner; the three Bosses contrast on purpose so one digest can be run through each and
 * the system prompt's effect on personality compared.
 */
import type { SystemContent } from '../../../engine/rules/types.ts';
import { deepFreeze } from '../../../engine/rules/instance.ts';
import { theClerk } from './personas/the-clerk.ts';
import { hypeMan } from './personas/hype-man.ts';
import { sighbot } from './personas/sighbot.ts';
import { placeholderMonitor } from './personas/placeholder-monitor.ts';
import { feeds } from './feeds.ts';
import { stockLines } from './lines.ts';
import { nameStyle, nameStyleBrief } from './name-style.ts';
import { realWorld } from './real-world.ts';
import { wheelhouse } from './wheelhouse.ts';

export const system: SystemContent = Object.freeze({
  roster: deepFreeze([theClerk, hypeMan, sighbot, placeholderMonitor]),
  staffGroup: Object.freeze({ name: 'Personality Cores' }),
  firstBoss: hypeMan.key,
  announcementsTitle: 'Announcements From The System',
  firstStaff: Object.freeze([placeholderMonitor.key]),
  // The Boss's own duties stay the season's Boss's; a visit's filing, a report's verdict and a patrol's finding are the Mod on the board's beat, and an appeal is
  // the Mod that filed (the Mod Bots plan, Task 7).
  duties: Object.freeze({ meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'filer', chatter: 'boss', filing: 'beat', reportJudge: 'beat', patrolJudge: 'beat' } as const),
  stockLines,
  feeds,
  realWorld,
  wheelhouse,
  nameStyle,
  nameStyleBrief,
});
