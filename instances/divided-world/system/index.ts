/**
 * Divided World's System content: the Bosses and Mod Bots, who does each duty, the stock lines,
 * the outside feeds, the never-amplified subjects, the wheelhouse, the old voice's frame and the
 * PPP name style. It reaches the engine as `Instance.system`; the engine never names anything here
 * ("KayfaBB never knows which instance it runs"). The numbers are settings (../settings.ts).
 *
 * The roster is three PLACEHOLDER Bosses and one PLACEHOLDER Mod Bot. The real roster is written
 * with the owner; the three Bosses contrast on purpose so one digest can be run through each and
 * the system prompt's effect on personality compared.
 */
import type { SystemContent } from '../../../engine/rules/types.ts';
import { deepFreeze } from '../../../engine/rules/instance.ts';
import { theClerk } from './bosses/the-clerk.ts';
import { hypeMan } from './bosses/hype-man.ts';
import { sighbot } from './bosses/sighbot.ts';
import { placeholderMonitor } from './bots/placeholder-monitor.ts';
import { feeds } from './feeds.ts';
import { stockLines } from './lines.ts';
import { nameStyle, nameStyleBrief } from './name-style.ts';
import { oldVoice } from './old-voice.ts';
import { realWorld } from './real-world.ts';
import { wheelhouse } from './wheelhouse.ts';

export const system: SystemContent = Object.freeze({
  bosses: deepFreeze([theClerk, hypeMan, sighbot]),
  firstBoss: hypeMan.key,
  announcementsTitle: 'Announcements From The System',
  modBots: deepFreeze([placeholderMonitor]),
  firstStaff: Object.freeze([placeholderMonitor.key]),
  // Every duty is the season's Boss's until the Mod Bots session reassigns some (the staff design, section 15).
  duties: Object.freeze({ meeting: 'boss', standingOrderLine: 'boss', microEvent: 'boss', renameJudge: 'boss', appeal: 'boss' } as const),
  stockLines,
  feeds,
  realWorld,
  wheelhouse,
  oldVoice,
  nameStyle,
  nameStyleBrief,
});
