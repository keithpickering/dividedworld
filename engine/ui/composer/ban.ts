/**
 * Whether the HUD's mask is banned now, for the composer (the Mod Bots design, section 5: "a banned character can browse but cannot post"). A ban is a public fact about a
 * character, carried by the player's own characters (`my_characters.banned_until`), so nothing here is computed from who owns it and the composer makes no read of its own. The
 * server refuses a post by a banned character in its own words all the same; this is the screen saying so before a reply is written for nothing, and when the ban ends by itself.
 */
import { useEffect, useState } from 'react';
import type { MyCharacter } from '../data/api.ts';

/** When the character's ban ends (an ISO time), or null while it is not banned; the screen drops it at its time without a read. */
export function useBannedUntil(character: Pick<MyCharacter, 'bannedUntil'> | null): string | null {
  const until = character?.bannedUntil ?? null;
  const [ticks, tick] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const left = Date.parse(until) - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  /* A ban longer than one timer holds (setTimeout's cap) is waited out in as many as it takes: each firing renders again and arms the next. */
  }, [until, ticks]);
  return until !== null && Date.parse(until) > Date.now() ? until : null;
}
