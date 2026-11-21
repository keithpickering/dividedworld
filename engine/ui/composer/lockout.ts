/**
 * Whether the HUD's mask is locked out of a thread now, for the composer and the play form (the so-very-happy design, section 2.3). A lockout is a public fact about a character in a thread,
 * carried by the player's own characters (`my_characters.lockouts`), so nothing here is computed from who owns it and no read of its own is made. The server refuses a post or a Move by a
 * locked-out character in its own words all the same; this is the screen saying so before a reply is written for nothing, and when the lockout ends by itself.
 */
import { useEffect, useState } from 'react';
import type { Id, MyCharacter } from '../data/api.ts';
import { useKayfa } from '../context.tsx';

/** When the character's lockout from the thread ends (an ISO time), or null while it is not locked out of it; the screen drops it at its time without a read. The latest of its live lockouts there. */
export function useLockedOutUntil(character: Pick<MyCharacter, 'lockouts'> | null, thread: Id | null): string | null {
  const { api } = useKayfa();
  const now = api.now();
  const ahead = thread === null ? [] : (character?.lockouts ?? []).filter((l) => l.thread === thread && Date.parse(l.until) > now);
  const until = ahead.reduce<string | null>((latest, l) => (latest === null || Date.parse(l.until) > Date.parse(latest) ? l.until : latest), null);
  const [ticks, tick] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const left = Date.parse(until) - api.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  /* A lockout longer than one timer holds (setTimeout's cap) is waited out in as many as it takes: each firing renders again and arms the next. */
  }, [api, until, ticks]);
  return until !== null && Date.parse(until) > api.now() ? until : null;
}
