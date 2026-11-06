/**
 * The addresses of the season page's tabs, kept apart from the screen so that Rankings and the record can link to a season's row without
 * importing the page that draws them.
 */
import type { Id } from '../data/api.ts';

export type SeasonTab = 'rankings' | 'news';

/**
 * The address of the season page's tab, and of a page of the rankings (its own query on the Rankings tab). `season` opens a finished
 * season's final table, and `character` the page of it that holds that character, highlighted.
 */
export const seasonAt = (tab: SeasonTab, page?: number, season?: number, character?: Id): string => {
  const q = [`tab=${tab}`];
  if (season !== undefined) q.push(`season=${season}`);
  if (character !== undefined) q.push(`character=${encodeURIComponent(character)}`);
  if (page !== undefined && page > 1) q.push(`page=${page}`);
  return `/season?${q.join('&')}`;
};
