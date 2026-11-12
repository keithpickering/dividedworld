/**
 * The art for Divided World's gear and trophy kinds (`InstanceUi.gear`, `InstanceUi.trophies`), by the rules' keys (gear.ts, trophies.ts).
 * Every piece is a placeholder, copied from docs/research/2026-11-04-cosmetics/art.svg; the owner's Minus World art replaces it. A gear's
 * `aspect` is its art's height over its width, from the SVG's viewBox.
 */
import type { InstanceUi } from '../../../engine/ui/types.ts';
import baseballCap from './gear/baseball-cap.svg?url';
import mustache from './gear/mustache.svg?url';
import shades from './gear/shades.svg?url';
import button from './gear/button.svg?url';
import nostalgicHat from './gear/nostalgic-hat.svg?url';
import seasonChampion from './trophies/season-champion.svg?url';
import seasonRunnerUp from './trophies/season-runner-up.svg?url';
import seasonThird from './trophies/season-third.svg?url';
import bosssPet from './trophies/bosss-pet.svg?url';
import employeeOfTheMonth from './trophies/employee-of-the-month.svg?url';
import metTheBosssDemand from './trophies/met-the-bosss-demand.svg?url';
import hardcoreBelt from './trophies/hardcore-belt.svg?url';

export const gearUi: InstanceUi['gear'] = Object.freeze({
  'baseball-cap': { art: baseballCap, aspect: 60 / 100 },
  mustache: { art: mustache, aspect: 34 / 100 },
  shades: { art: shades, aspect: 30 / 100 },
  button: { art: button, aspect: 1 },
  'nostalgic-hat': { art: nostalgicHat, aspect: 90 / 80 },
});

export const trophiesUi: InstanceUi['trophies'] = Object.freeze({
  'season-champion': { art: seasonChampion },
  'season-runner-up': { art: seasonRunnerUp },
  'season-third': { art: seasonThird },
  'bosss-pet': { art: bosssPet },
  'employee-of-the-month': { art: employeeOfTheMonth },
  'met-the-bosss-demand': { art: metTheBosssDemand },
  'hardcore-belt': { art: hardcoreBelt },
});
