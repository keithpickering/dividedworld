/**
 * Divided World's trophy kinds (`Instance.trophies`): the season's three places, two the Boss gives, the one every counted
 * character gets when a move's demand is met, and the Hardcore Belt, which one character holds at a time. Admin-made kinds live in the
 * database only. The badges are `ui/trophies/` (`InstanceUi.trophies`), placeholders.
 */
import type { TrophyCatalog } from '../../engine/rules/cosmetics.ts';
import { deepFreeze } from '../../engine/rules/instance.ts';

export const trophies: TrophyCatalog = deepFreeze<TrophyCatalog>({
  kinds: [
    { key: 'season-champion', name: 'Season Champion', line: 'First place at the end of a season.' },
    { key: 'season-runner-up', name: 'Season Runner-Up', line: 'Second place at the end of a season.' },
    { key: 'season-third', name: 'Season Third', line: 'Third place at the end of a season.' },
    { key: 'bosss-pet', name: 'Boss\'s Pet', line: 'The Boss is fond of this one, for now.' },
    { key: 'employee-of-the-month', name: 'Employee of the Month', line: 'Noticed, and told so.' },
    { key: 'met-the-bosss-demand', name: 'Met the Boss\'s Demand', line: 'The Boss asked. This character did it.' },
    { key: 'hardcore-belt', name: 'The Hardcore Belt', line: 'Held by one character at a time.', belt: true },
  ],
  seasonPlaces: ['season-champion', 'season-runner-up', 'season-third'],
  boss: ['bosss-pet', 'employee-of-the-month', 'hardcore-belt'],
  demandMet: 'met-the-bosss-demand',
});
