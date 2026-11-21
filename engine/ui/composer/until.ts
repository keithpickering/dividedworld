/**
 * Whether a time is still ahead, drawn again when it passes: the one hook every state that ends by itself at a time uses (a ban's note, a lockout's note and stamp, the postbit's stamps), so the screen drops it
 * at its time without a read. A time longer than one timer holds (setTimeout's cap) is waited out in as many as it takes: each firing renders again and arms the next.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';

export function useAhead(until: string | null | undefined): boolean {
  const { api } = useKayfa();
  const [ticks, tick] = useState(0);
  useEffect(() => {
    if (until === null || until === undefined) return;
    const left = Date.parse(until) - api.now();
    if (left <= 0) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [api, until, ticks]);
  return until !== null && until !== undefined && Date.parse(until) > api.now();
}
