import type { KayfaApi } from '../../../../engine/ui/data/api.ts';

/**
 * The page's own clock stands in for the fake's `now` where the fake is the page's backend (the demo, the boards fixture): the screens
 * read one clock, and in the browser it is the page's `Date`, which a board match or a test pins (`context.clock.setFixedTime`) to
 * what the words should say. The api is changed in place, so what holds the fake holds this one. The fake keeps its own clock for what it writes and seeds, as the real backend has the database's.
 */
export function onPageClock<T extends KayfaApi>(api: T): T {
  (api as { now: () => number }).now = () => Date.now();
  return api;
}
