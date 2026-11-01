/**
 * Who is browsing a place (the staff design, section 2; the presence plan, Task 4): a poll every
 * `presencePollSeconds` that is also the viewer's heartbeat, marking the HUD's mask present and
 * answering the place's box. A poll is sent at once when the place, the HUD's mask or the tab's
 * visibility changes, so a new mask arrives without waiting; none is sent while the tab is hidden,
 * so a tab left in the background (or frozen by a phone's browser) ages out like a closed one.
 *
 * The box is ambient: a failed poll keeps the last answer, and after three in a row the hook answers
 * null and the box drops out quietly, with no notice. The polls go on, so the box comes back with the
 * next answer, as it does on the next page load. Each poll is numbered, and an answer older than one
 * already shown is dropped. Signed out, nothing is polled: here() answers only a signed-in player.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Presence, PresencePlace } from '../data/api.ts';
import { usePlayer } from '../player.tsx';

/** Failed polls in a row after which the box drops out. */
const FAILURES_TO_DROP = 3;

const keyOf = (place: PresencePlace) => (place.kind === 'thread' ? `thread:${place.thread}` : place.kind === 'board' ? `board:${place.board}` : 'index');

export function usePresence(place: PresencePlace | null): Presence | null {
  const { api, settings } = useKayfa();
  const player = usePlayer();
  const signedIn = player.session.signedIn;
  const through = player.hudCharacter?.id ?? null;
  const key = place === null || !signedIn ? null : keyOf(place);
  const every = settings.presencePollSeconds * 1000;
  const [held, setHeld] = useState<{ readonly key: string; readonly answer: Presence | null } | null>(null);

  useEffect(() => {
    if (key === null || place === null) return;
    const at = place;
    let live = true;
    let sent = 0;
    let shown = 0;
    let failures = 0;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = () => {
      const n = ++sent;
      api.here(at, through).then(
        (answer) => {
          if (!live || n < shown) return;
          shown = n;
          failures = 0;
          setHeld({ key, answer });
        },
        () => {
          if (!live) return;
          failures += 1;
          if (failures === FAILURES_TO_DROP) setHeld({ key, answer: null });
        },
      );
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      if (document.visibilityState !== 'visible') return;
      poll();
      timer = setInterval(poll, every);
    };
    const visibility = () => (document.visibilityState === 'visible' ? start() : stop());
    /* A page restored from the back-forward cache may come back visible with no visibilitychange: it polls at once too. */
    const restored = (e: PageTransitionEvent) => { if (e.persisted) start(); };

    start();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', restored);
    return () => {
      live = false;
      stop();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pageshow', restored);
    };
    // `place` is read through its key, so a new object for the same place does not restart the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, through, every]);

  return held !== null && held.key === key ? held.answer : null;
}
