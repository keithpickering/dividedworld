/**
 * The read of the player's rows after a write that landed, bounded: the write is done whatever the read does, so a read that
 * never answers must not hold a dialog (Cancel and Escape are off while it is busy). It answers false after the router's own
 * load limit, and the dialog ends with its done line and `STALE_PAGE`.
 */
import { LOAD_LIMIT_MS } from '../router.tsx';

export const STALE_PAGE = ' This page may be out of date until you reload it.';

export function readBack(refresh: () => Promise<boolean>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), LOAD_LIMIT_MS);
    void refresh().then(
      (fresh) => { clearTimeout(timer); resolve(fresh); },
      () => { clearTimeout(timer); resolve(false); },
    );
  });
}
