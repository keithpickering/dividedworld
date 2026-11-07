/**
 * The Vending Machine's slots as the server shows them now (`KayfaApi.machine`), for a screen that says a card's buy price. A price is
 * an admin's to tune, so it is read from the live slots and not from what the instance was compiled with; and a card with no on-sale
 * slot has none to say (`saleOf`). `slots` is null until the first look, and stays null if the machine cannot be read: a screen shows
 * no price then, never a guessed one. `look` reads the machine again, as a screen does after a refusal that names a price that moved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Slot } from '../data/api.ts';

export function useMachine(): { readonly slots: readonly Slot[] | null; readonly look: () => Promise<void> } {
  const { api } = useKayfa();
  const [slots, setSlots] = useState<readonly Slot[] | null>(null);
  const live = useRef(true);
  const look = useCallback(async () => {
    try {
      const read = await api.machine();
      if (live.current) setSlots(read);
    } catch {
      /* No look at the machine is no price on a screen. */
    }
  }, [api]);
  useEffect(() => {
    live.current = true;
    void look();
    return () => { live.current = false; };
  }, [look]);
  return { slots, look };
}
