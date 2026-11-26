/**
 * The art for Divided World's gear and trophy kinds (`InstanceUi.gear`, `InstanceUi.trophies`), by the rules' keys (gear.ts, trophies.ts).
 * Every piece is a placeholder, copied from docs/research/2026-11-04-cosmetics/art.svg; the owner's Minus World art replaces it. A gear is a
 * folder, `gear/<key>/`: a `views.json` (its default view, and for each view shipped its size and its pivot) and a picture for each view.
 * Each entry here is built from the picture's URL and its folder's `views.json`, so no number is typed twice.
 */
import type { GearView } from '../../../engine/rules/cosmetics.ts';
import type { GearViewArt, InstanceUi } from '../../../engine/ui/types.ts';
import baseballCap from './gear/baseball-cap/front.svg?url';
import baseballCapViews from './gear/baseball-cap/views.json';
import mustache from './gear/mustache/front.svg?url';
import mustacheViews from './gear/mustache/views.json';
import shades from './gear/shades/front.svg?url';
import shadesViews from './gear/shades/views.json';
import button from './gear/button/front.svg?url';
import buttonViews from './gear/button/views.json';
import nostalgicHat from './gear/nostalgic-hat/front.svg?url';
import nostalgicHatViews from './gear/nostalgic-hat/views.json';
import seasonChampion from './trophies/season-champion.svg?url';
import seasonRunnerUp from './trophies/season-runner-up.svg?url';
import seasonThird from './trophies/season-third.svg?url';
import bosssPet from './trophies/bosss-pet.svg?url';
import employeeOfTheMonth from './trophies/employee-of-the-month.svg?url';
import metTheBosssDemand from './trophies/met-the-bosss-demand.svg?url';
import hardcoreBelt from './trophies/hardcore-belt.svg?url';

/**
 * One item's entry: its `views.json` and the URL of each view's picture, which must be the views it lists, and its default must be one of them.
 * A disagreement throws: a deliberate build-time failure, caught by index.test.tsx, which imports this file.
 */
export function gearOf(shipped: { readonly default: string; readonly views: Readonly<Record<string, { readonly width: number; readonly height: number; readonly pivot: { readonly x: number; readonly y: number } }>> }, art: Readonly<Record<string, string>>): InstanceUi['gear'][string] {
  if (!Object.hasOwn(shipped.views, shipped.default)) throw new Error(`views.json's default view ${shipped.default} is not a view it lists`);
  for (const view of Object.keys(art)) if (!Object.hasOwn(shipped.views, view)) throw new Error(`a picture is imported for the view ${view} but views.json does not list it`);
  const views: Partial<Record<GearView, GearViewArt>> = {};
  for (const [view, shape] of Object.entries(shipped.views)) {
    const url = art[view];
    if (url === undefined) throw new Error(`views.json lists the view ${view} but no picture of it is imported`);
    views[view as GearView] = { ...shape, art: url };
  }
  return { default: shipped.default as GearView, views };
}

export const gearUi: InstanceUi['gear'] = Object.freeze({
  'baseball-cap': gearOf(baseballCapViews, { front: baseballCap }),
  mustache: gearOf(mustacheViews, { front: mustache }),
  shades: gearOf(shadesViews, { front: shades }),
  button: gearOf(buttonViews, { front: button }),
  'nostalgic-hat': gearOf(nostalgicHatViews, { front: nostalgicHat }),
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
