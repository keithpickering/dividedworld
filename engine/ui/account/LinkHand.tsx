/**
 * Draws nothing; lives above the routed screen, which the app starts afresh when the session's account changes, so it sees every
 * move of the address. The emailed link in hand (link.ts) is kept only for the page it came to: a move to any other address drops it.
 */
import { useEffect } from 'react';
import { useLocation } from '../router.tsx';
import { forgetLink, forgetLinkOutside } from './link.ts';

export function LinkHandKeeper(): null {
  const { path } = useLocation();
  useEffect(() => { forgetLinkOutside(path); }, [path]);
  /* Whatever holds the keeper is gone (the page was left for the board, or the app ended): nothing stays held. */
  useEffect(() => forgetLink, []);
  return null;
}
