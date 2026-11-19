/**
 * The packs the account holds and has not opened (`api.sealedPacks`), read where a screen shows them: the hand draws each first, and the HUD's hand
 * button says how many wait. `refreshKey` is whatever, changing, means the hand may have changed (the player's cards, which an opening changes), and
 * the read is made again; `reload` is the same read at a caller's word, after an opening. A read that fails leaves the last answer, which is empty
 * until one succeeds: a sealed pack is never invented. `enabled` false reads nothing (a caller that is given the packs by its parent).
 */
import { useCallback, useEffect, useState } from 'react';
import type { SealedPack } from '../data/api.ts';
import { useKayfa } from '../context.tsx';

export function useSealedPacks(enabled = true, refreshKey: unknown = null): { readonly sealed: readonly SealedPack[]; readonly reload: () => Promise<void> } {
  const { api } = useKayfa();
  const [sealed, setSealed] = useState<readonly SealedPack[]>([]);
  const reload = useCallback(async () => {
    try { setSealed(await api.sealedPacks()); } catch { /* the last answer stands */ }
  }, [api]);
  useEffect(() => {
    if (!enabled) { setSealed([]); return undefined; }
    let live = true;
    void Promise.resolve().then(() => api.sealedPacks()).then((s) => { if (live) setSealed(s); }, () => {});
    return () => { live = false; };
  }, [api, enabled, refreshKey]);
  return { sealed, reload };
}
