/**
 * The banner's right side: the address the board is at, and the loading meter beside it (the forum-load
 * design, section 7; the spike's placement B). A game piece, the 2003 progress bar: a sunken well of
 * blocks that march in while a page opens and run full when it lands.
 *
 * The meter runs while a click's load is out (`useNavigation().pending`) or a screen has handed a read
 * of its own to `track`. Its value climbs `90 - (90 - p) * 0.82` every 120 ms, so it slows toward 90
 * and never reaches it on its own; a landing sets 100, holds it 250 ms, then empties it. A swap
 * answered at once (a prefetch or the cache) never has a pending phase, so a landing is also read from
 * the location changing while nothing is out, and shows only the full flash. Reduced motion (the
 * device's, or the account's override, engine/ui/appearance.ts) is a CSS matter: the fill steps.
 *
 * The text is the host at rest and `Opening {host}{path}…` while a click's load is out. A path segment
 * that is a UUID is cut to its first eight characters and an ellipsis, and the query and the fragment
 * are never shown. The status is read aloud when a load lands and is empty otherwise.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigation } from '../router.tsx';

const TICK_MS = 120;
const HOLD_MS = 250;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** An address's path for the banner: each UUID segment cut to eight characters and `…`; no query, no fragment. */
export function shortenPath(to: string): string {
  const path = new URL(to, 'http://x.invalid').pathname;
  return path.split('/').map((s) => (UUID.test(s) ? `${s.slice(0, 8)}…` : s)).join('/');
}

export function Loading({ host = globalThis.location?.host ?? '', hostless = false }: { readonly host?: string; /** The meter alone: the banner's search box stands where the host line does. */ readonly hostless?: boolean }) {
  const { pending, tracking, outcome } = useNavigation();
  const { path, query } = useLocation();
  const busy = pending !== null || tracking > 0;
  const [value, setValue] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; hold?: ReturnType<typeof setTimeout> }>({});
  const wasBusy = useRef(false);
  const address = path + String(query);
  const lastAddress = useRef(address);

  const clear = () => { clearInterval(timers.current.tick); clearTimeout(timers.current.hold); timers.current = {}; };
  const land = () => {
    clear();
    setValue(100);
    setLoaded(true);
    timers.current.hold = setTimeout(() => { setValue(0); setLoaded(false); timers.current = {}; }, HOLD_MS);
  };
  /* A load that did not land (stopped, replaced, or failed) empties the meter and says nothing. */
  const drop = () => { clear(); setValue(0); setLoaded(false); };

  /*
   * One effect reads both signals, so a landing is shown once. A load ending is told by `busy` falling and what
   * `outcome` says of it; a swap answered at once has no busy phase and is told by the address changing, unless
   * the last outcome was a failure.
   */
  useEffect(() => {
    const moved = address !== lastAddress.current;
    lastAddress.current = address;
    const was = wasBusy.current;
    wasBusy.current = busy;
    if (busy && !was) {
      clear();
      setLoaded(false);
      setValue(0);
      timers.current.tick = setInterval(() => setValue((p) => 90 - (90 - p) * 0.82), TICK_MS);
    } else if (!busy && was) {
      if (outcome?.kind === 'landed') land(); else drop();
    } else if (!busy && moved && outcome?.kind !== 'failed') {
      land();
    }
  }, [busy, address]);

  useEffect(() => clear, []);

  const opening = pending ? `Opening ${host}${shortenPath(pending.to)}`.replace(/…?$/u, '…') : host;
  return (
    <span className="kb-address">
      {/* With the search box where the host stood, the host line is read aloud only; while a load is out, "Opening ..." shows beside the meter. */}
      <span className={hostless && !pending ? 'kb-address-text kb-visually-hidden' : 'kb-address-text'}>{opening}</span>
      <span className="kb-meter" role="progressbar" aria-label="Loading the page" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)}>
        <span className="kb-meter-fill" style={{ width: `${value}%` }} />
      </span>
      <span className="kb-visually-hidden" role="status">{loaded ? 'Page loaded' : ''}</span>
    </span>
  );
}
