/**
 * Jimmy Wails (Sweet, uncommon): an appeal cast on a post, as Minus World's Jimmy Wails spell was, with a drive under it that anyone may give
 * to (docs/plans/2026-11-03-jimmy-wails-design.md). It is a Cast that reaches a post alone.
 *
 * - **Its banner** is one of the plates the server draws at each play (`draws`; the pictures and where the words sit are
 *   ui/jimmy-wails/plates.ts, which a test holds to this list), and its words are the caster's message, which it must have.
 * - **Its drive** is the post's plays of it, up to the stack of three, closing a week after the latest. The first play opens one, the
 *   next two join it, and once it has closed a play opens another (the database's place_cast, supabase/migrations/0150_drives.sql).
 *   The gifts and the overhead The System keeps are economy numbers (settings.ts).
 * - **It lands** by its own count: not the post's plays of it, which `landsOn` counts, but the open drive's, so a closed drive's three
 *   banners never keep a fourth from opening another.
 */
import { landsOn, openDrive, refuse, ok, type CardRules } from '../../../engine/rules/cards.ts';

/** The plate keys, which ui/jimmy-wails/plates.ts draws; a test holds the two lists together (the card module takes no `?url` import, since node loads it). */
const PLATE_KEYS = ['blue-shirt', 'close-up', 'dark-logo'] as const;

const STACK = 3;

export const jimmyWails: CardRules<Record<string, never>> = {
  key: 'jimmy-wails',
  name: 'Jimmy Wails',
  alignment: 'sweet',
  rarity: 'uncommon',
  stack: STACK,
  draws: PLATE_KEYS,
  drive: { lasts: { unit: 'day', count: 7 }, gifts: ['jimmyWails.gift1', 'jimmyWails.gift2', 'jimmyWails.gift3', 'jimmyWails.gift4'], overhead: 'jimmyWails.overhead' },
  // The gifts and the overhead are what the drive's screens show a giver, so the settings validation holds them.
  reads: [
    { key: 'jimmyWails.gift1', whole: true, min: 1 },
    { key: 'jimmyWails.gift2', whole: true, min: 1 },
    { key: 'jimmyWails.gift3', whole: true, min: 1 },
    { key: 'jimmyWails.gift4', whole: true, min: 1 },
    { key: 'jimmyWails.overhead', whole: true, min: 0, max: 100 },
  ],
  needsMessage: 'an appeal needs a sob story',
  playPrice: () => 0,
  canApply: (target, effects, _config, now = new Date()) => {
    // landsOn's reach and kind checks without its stack count, which would count the post's closed drives too: a drive is full by its own plays.
    const lands = landsOn({ key: 'jimmy-wails', reaches: ['post'], stack: Number.MAX_SAFE_INTEGER }, target, effects, now);
    if (!lands.ok) return lands;
    const open = openDrive(effects, 'jimmy-wails', now);
    return open !== undefined && open.plays.length >= STACK ? refuse(`this post's drive already carries ${STACK} appeals`) : lands;
  },
  validateConfig: (config) => {
    const empty = typeof config === 'object' && config !== null && !Array.isArray(config) && Object.keys(config).length === 0;
    return empty ? ok({}) : refuse('Jimmy Wails has nothing to set');
  },
};
