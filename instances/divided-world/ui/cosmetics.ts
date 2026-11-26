/**
 * The art for Divided World's gear and trophy kinds (`InstanceUi.gear`, `InstanceUi.trophies`), by the rules' keys (gear.ts, trophies.ts).
 * The two caps and their colors are the owner's renders, five views each, made from a model by `gear/rig.py`; the four other pieces are
 * placeholders, copied from docs/research/2026-11-04-cosmetics/art.svg, which the owner's Minus World art replaces. A gear is a folder,
 * `gear/<key>/`: a `views.json` (its default view, and for each view shipped its size and its pivot) and a picture for each view, a
 * `<view>.webp` or a `<view>.svg`. Every folder is read by a glob, so a new item needs no line here; each entry is built from its pictures'
 * URLs and its folder's `views.json` by `gearOf`, which throws when they disagree, so no number is typed twice.
 */
import type { GearView } from '../../../engine/rules/cosmetics.ts';
import type { GearViewArt, InstanceUi } from '../../../engine/ui/types.ts';
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

type Shipped = Parameters<typeof gearOf>[0];
const pictures = import.meta.glob<string>('./gear/*/*.{webp,svg}', { eager: true, query: '?url', import: 'default' });
const shipped = import.meta.glob<Shipped>('./gear/*/views.json', { eager: true, import: 'default' });

/** Every item folder's entry, keyed by the folder's name: its pictures by view name (the file's name less its extension), and its views.json. */
function gearFolders(): InstanceUi['gear'] {
  const art: Record<string, Record<string, string>> = {};
  for (const [file, url] of Object.entries(pictures)) {
    const [, key, name] = /^\.\/gear\/([^/]+)\/([^/]+)\.(?:webp|svg)$/u.exec(file)!;
    (art[key!] ??= {})[name!] = url;
  }
  const out: Record<string, InstanceUi['gear'][string]> = {};
  for (const [file, views] of Object.entries(shipped)) out[/^\.\/gear\/([^/]+)\//u.exec(file)![1]!] = gearOf(views, art[/^\.\/gear\/([^/]+)\//u.exec(file)![1]!] ?? {});
  for (const key of Object.keys(art)) if (!Object.hasOwn(out, key)) throw new Error(`gear/${key} holds pictures but no views.json`);
  return out;
}

export const gearUi: InstanceUi['gear'] = Object.freeze(gearFolders());

export const trophiesUi: InstanceUi['trophies'] = Object.freeze({
  'season-champion': { art: seasonChampion },
  'season-runner-up': { art: seasonRunnerUp },
  'season-third': { art: seasonThird },
  'bosss-pet': { art: bosssPet },
  'employee-of-the-month': { art: employeeOfTheMonth },
  'met-the-bosss-demand': { art: metTheBosssDemand },
  'hardcore-belt': { art: hardcoreBelt },
});
