/**
 * Draws nothing; lives above the routed screen, which the app starts afresh when the session's account changes, so it sees every
 * move of the address. The emailed link in hand (link.ts) is kept only for the page it came to: a move to any other address drops it.
 */
import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from '../router.tsx';
import { forgetLinkOutside, keepLink } from './link.ts';

export function LinkHandKeeper(): null {
  const { path } = useLocation();
  /* On while this renders, so a screen rendered in the same pass (the keeper mounting with it) already finds keeping on; the effect below turns it off at unmount and back on if a simulated remount ran it. */
  keepLink(true);
  useEffect(() => { forgetLinkOutside(path); }, [path]);
  /* Keeping is on before any screen's effects run; when the keeper is gone (the app ended) it is off, and the next read forgets what was held. */
  useLayoutEffect(() => { keepLink(true); return () => keepLink(false); }, []);
  return null;
}
