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
import { useEffect, useMemo, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Presence, PresencePlace } from '../data/api.ts';
import { usePlayer } from '../player.tsx';

/** Failed polls in a row after which the box drops out. */
const FAILURES_TO_DROP = 3;

const keyOf = (place: PresencePlace) => (place.kind === 'thread' ? `thread:${place.thread}` : place.kind === 'board' ? `board:${place.board}` : 'index');

/**
 * A page's snapshot of the box (the forum-load design, section 4) with the reader's own mask added, as the first heartbeat would list it: a
 * page that reads the box marks no one present, so the reader's mask is put in on their own screen, at the end of the names while there is
 * room for it (`names` is cut at `presenceNames`, longest present first), else counted among the others. A mask whose presence is
 * hidden is not put in (the box draws it itself, in italics), nor is one the snapshot already lists.
 * `presenceNames` is no screen setting (screen_settings does not hand it out), and the box is cut at it only when there are more names than
 * it holds: a box with others is full, so the mask joins the others; a box with none has room. (A box holding exactly `presenceNames`
 * names and no others draws the mask as a name until the first heartbeat, which counts it among the others.)
 */
export function withReader(snapshot: Presence, hud: { readonly id: string; readonly name: string; readonly presenceHidden: boolean } | null): Presence {
  if (hud === null || hud.presenceHidden || snapshot.names.some((n) => n.id === hud.id)) return snapshot;
  return snapshot.others === 0
    ? { names: [...snapshot.names, { id: hud.id, name: hud.name, staff: false }], others: snapshot.others }
    : { names: snapshot.names, others: snapshot.others + 1 };
}

/**
 * The box for a place. `snapshot` is the page document's read-only copy of it: shown at once, with the reader's mask added, until the first
 * heartbeat answers (and its answers replace it). With none, the box shows nothing until the first answer.
 */
export function usePresence(place: PresencePlace | null, snapshot?: Presence): Presence | null {
  const { api, settings } = useKayfa();
  const player = usePlayer();
  const signedIn = player.session.signedIn;
  const through = player.hudCharacter?.id ?? null;
  const key = place === null || !signedIn ? null : keyOf(place);
  const every = settings.presencePollSeconds * 1000;
  const [held, setHeld] = useState<{ readonly key: string; readonly answer: Presence | null } | null>(null);
  const hud = player.hudCharacter;
  const first = useMemo(
    () => (snapshot && signedIn ? withReader(snapshot, hud ? { id: hud.id, name: hud.name, presenceHidden: hud.presenceHidden } : null) : null),
    [snapshot, signedIn, hud?.id, hud?.name, hud?.presenceHidden], // eslint-disable-line react-hooks/exhaustive-deps
  );

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

  return held !== null && held.key === key ? held.answer : first;
}
