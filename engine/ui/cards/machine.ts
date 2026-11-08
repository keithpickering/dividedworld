/**
 * The Vending Machine's slots as the server shows them now (`KayfaApi.machine`), for a screen that says a card's buy price or draws the
 * machine. A price is an admin's to tune, so it is read from the live slots and not from what the instance was compiled with; and a card
 * with no on-sale slot has none to say (`saleOf`).
 *
 * What a screen can tell from it: `status` is `loading` until the first read answers (a screen says nothing about empty slots before it
 * knows), `ready` once it has, and `failed` when the read did not answer, in which case `slots` is null and a screen says plainly that the
 * machine cannot be read, never a guessed price. `look` reads the machine again, as a screen does after a refusal that names a price that
 * moved, or a player's retry. Reads may overlap; the answer to the latest request is the one kept, and an older one that lands later is
 * dropped whether it answered or failed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Slot } from '../data/api.ts';

export type MachineStatus = 'loading' | 'ready' | 'failed';

export interface MachineLook {
  /** The slots, null until the first read answers and while the machine cannot be read. */
  readonly slots: readonly Slot[] | null;
  readonly status: MachineStatus;
  readonly look: () => Promise<void>;
}

export function useMachine(): MachineLook {
  const { api } = useKayfa();
  const [seen, setSeen] = useState<{ readonly slots: readonly Slot[] | null; readonly status: MachineStatus }>({ slots: null, status: 'loading' });
  const live = useRef(true);
  /* The number of the latest request: an answer that is not for it is older than what a newer request asked, and is dropped. */
  const latest = useRef(0);
  const look = useCallback(async () => {
    const mine = ++latest.current;
    /* A retry after a failure shows the wait again; a re-read after a refusal keeps what is drawn until the new answer. */
    setSeen((s) => (s.status === 'failed' ? { slots: null, status: 'loading' } : s));
    try {
      const read = await api.machine();
      if (live.current && mine === latest.current) setSeen({ slots: read, status: 'ready' });
    } catch {
      if (live.current && mine === latest.current) setSeen({ slots: null, status: 'failed' });
    }
  }, [api]);
  useEffect(() => {
    live.current = true;
    void look();
    return () => { live.current = false; };
  }, [look]);
  return { slots: seen.slots, status: seen.status, look };
}
