/**
 * You Were Saying?'s effect on a post (docs/plans/2026-11-07-you-were-saying-design.md, sections 5, 6, 8 and 14; plan Task 8): the old voice's
 * words as terminal output bleeding in after the author's, in Courier on a green ground (tail.css), typed in with a block cursor each time
 * the post comes into view, and erased by a hold.
 *
 * One block for every play. The engine gives a card's Effect all of its plays on the post at once (`EffectProps.plays`, and `written` for
 * each), so this is one instance: the block is one run of terminal text after the post's words (`data-kb-tail`, right after `children`), each
 * play's text a span of its own in play order, one cursor at the end, one focusable control. A play whose first generation failed was
 * refunded and is over: it is no part of the chain, and a post whose every play failed (or was cleared) draws nothing, not even a cursor.
 * A play's text still being written (`waiting`) is the cursor typing nothing: the texts that exist, then the cursor at the end.
 *
 * The clock. What shows is one number of characters across the chained texts, from erase.ts's pure clock: typing in (on the post's coming
 * into view; a screen at rest has no timer), erasing from the end under a hold, and typing back in after a release. A timer runs only while
 * the clock is moving and the post is in view, and stops with either. A tail the post's author erases entirely is saved as `{ cleared:
 * <version> }` on every play still live on the post (once each); any other reader's clear is their screen's alone, until a refresh. A saved
 * clear is for the version drawn: an edit makes a new version, which has none, so the tail comes back. A tail is never part of the author's
 * words: nothing here changes what the author wrote.
 *
 * The hold is the same for every way to give it ("an accessible path costs what the obstacle costs"): a pointer held on the block (mouse, pen
 * or finger) or Backspace held while it has focus, through one set of holders, so a pointer and a key together are one hold. Auto-repeat of
 * the key is ignored: the clock sets the speed. On touch the page still scrolls from the tail (`touch-action`, tail.css), and a scroll the
 * browser takes over ends the hold (pointer cancel). Reduced motion changes how it looks and never what it costs: the words show at once, no
 * tear, the cursor holds still, the hold erases at the same rate and the wait to come back is the same, but it comes back at once.
 *
 * Screen readers. The block is a button named "Continued by You Were Saying?: <the text>. Hold to erase. It comes back if you stop.", from the
 * whole text and never from what has typed so far. A polite status after it says the start of an erase and its end, and nothing between;
 * when a held key clears the tail, focus moves to that status so the reader is not dropped.
 *
 * In a play's moment or a version of the post (`still`: History, As it landed) the text is drawn whole from `written`, minus each play whose
 * snapshot says this version was cleared, with no typing, no input, no focus and a cursor that does not blink; its `show` words (the frame
 * puts the card's name before them) say how many characters it added, or that it was erased.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { FULL, lapse, look, press, release, typeIn, type Erase, type EraseSettings } from './erase.ts';
import './tail.css';

/** The settings' own numbers, used where the screen settings do not hold one (the instance's `cardSettings`). */
const ERASE_CPS = 6;
const RETYPE_MS = 2000;
const TYPE_CPS = 40;
/** How often the clock is read while it moves, in milliseconds: 40 times a second is smooth at 40 characters a second. */
const TICK_MS = 25;
const STARTED = 'Erasing. Keep holding to erase all of it.';
const ERASING = 'Erasing.';
const STOPPED = 'Stopped. It\'s coming back.';
const ERASED = 'Erased.';
const ERASED_READER = 'Erased on your screen. It comes back when the page reloads.';
const UNSAVED = 'It\'s erased on your screen, but it didn\'t save. Hold to try again.';
const STILL_WRITING = 'You Were Saying? is still writing.';
const NAME = 'You Were Saying?';

/** `toggle` is the erase an activation starts and a second one stops: it runs by itself, at the same rate, for those who cannot hold. */
type Holder = 'pointer' | 'key' | 'toggle';

/** Whether a play's saved state says this version of the post was cleared. */
const clearedFor = (state: unknown, version: string | undefined): boolean =>
  version !== undefined && typeof state === 'object' && state !== null && (state as { cleared?: unknown }).cleared === version;

export function YouWereSayingEffect({ plays, states, written, version, reader, still, save, show, children }: EffectProps) {
  const { settings } = useKayfa();
  const reduced = useMotionReduced();
  const cfg: EraseSettings = {
    eraseCps: settings.cardSettings['youWereSaying.eraseCps'] ?? ERASE_CPS,
    retypeMs: settings.cardSettings['youWereSaying.retypeMs'] ?? RETYPE_MS,
    typeCps: settings.cardSettings['youWereSaying.typeCps'] ?? TYPE_CPS,
    reduced,
  };

  /* The chain: each play on the post that has words and was not cleared for this version, in play order; and the plays still live, which a clear is saved on. */
  const live = plays.filter((p) => !clearedFor(states[p.id]?.state, version));
  const texts = live.flatMap((p) => { const w = written.get(p.id); return w && 'text' in w && w.text !== '' ? [{ play: p, chars: Array.from(w.text) }] : []; });
  const waiting = live.some((p) => { const w = written.get(p.id); return w !== undefined && 'waiting' in w; });
  const total = texts.reduce((n, t) => n + t.chars.length, 0);
  const whole = texts.map((t) => t.chars.join('')).join('');
  /* The name's own: the words trimmed, and with no stop of theirs doubled by the sentence's ("mostly.. Hold to erase"). */
  const spoken = whole.trim().replace(/\.$/u, '');
  const drawn = texts.length > 0 || (!still && waiting);

  const latest = useRef({ cfg, total, live, written, version, reader, save, still });
  latest.current = { cfg, total, live, written, version, reader, save, still };

  /* The clock, kept outside the render and read by it: a snapshot, and the holds on it. Until the post is seen it has typed nothing. */
  const clock = useRef<Erase | null>(null);
  clock.current ??= reduced || still ? FULL : typeIn(cfg, 0, Date.now());
  const holds = useRef(new Set<Holder>());
  const lastRead = useRef(Date.now());
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const inView = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [said, say] = useState('');
  const [cleared, setCleared] = useState(false);
  /* What shows is read as `lapse` would leave it, so a page that was away never draws time it did not hold. */
  const l = look(cfg, total, lapse(cfg, total, clock.current, lastRead.current, Date.now()), Date.now());
  const gone = !still && (cleared || l.cleared);
  const showing = drawn && !gone;
  const box = useRef<HTMLSpanElement>(null);
  const unsaved = said.trim() === UNSAVED;
  /* The tail going while it has focus, by any means (a clear saved elsewhere, a new version): focus goes to the status and not to the page. */
  const lostFocus = useRef(false);
  if (!showing && box.current?.isConnected && box.current.contains(document.activeElement)) lostFocus.current = true;
  const note = useRef<HTMLSpanElement>(null);

  const control = !still && total > 0;
  const stop = useCallback(() => { if (timer.current !== null) { clearInterval(timer.current); timer.current = null; } }, []);
  const announce = useCallback((words: string) => say((was) => (was === words ? `${words} ` : words)), []);
  /*
   * A clear. A reader's is the screen's own. The author's is saved once on each play still live on the post, for the version drawn, and only
   * when every save has landed is it announced as done; a save that fails (or a version not known) is said plainly and the tail comes back,
   * so the author can hold again: the way out of an erase that did not keep.
   */
  const clear = useCallback(() => {
    setCleared(true);
    if (box.current && box.current.contains(document.activeElement)) note.current?.focus();
    const { reader: who, version: v, live: playsNow, written: textNow, save: send } = latest.current;
    if (!who.author) { announce(ERASED_READER); return; }
    const back = () => { clock.current = FULL; setCleared(false); announce(UNSAVED); redraw(); };
    if (v === undefined) { back(); return; }
    const saves = playsNow.filter((p) => { const w = textNow.get(p.id); return w && !('failed' in w); })
      .map(async (p) => (await send(p.id, { cleared: v })) as { ok?: boolean });
    void Promise.allSettled(saves).then((results) => {
      if (latest.current.version !== v) return;
      if (results.every((r) => r.status === 'fulfilled' && r.value.ok !== false)) announce(ERASED); else back();
    });
  }, [announce]);
  /* A hold across a gap in the ticks is credited only up to the last reading and then ends (a hidden or throttled page's timer): the clock's `lapse`. */
  const lapsed = useCallback(() => {
    const { cfg: c, total: n } = latest.current;
    const was = clock.current!;
    const next = lapse(c, n, was, lastRead.current, Date.now());
    if (next === was) return;
    clock.current = next;
    const ran = holds.current.has('toggle');
    holds.current.clear();
    if (ran) announce(STOPPED);
  }, [announce]);
  const step = useCallback(() => {
    lapsed();
    lastRead.current = Date.now();
    const { cfg: c, total: n } = latest.current;
    const l = look(c, n, clock.current!, Date.now());
    if (l.cleared) { stop(); clear(); }
    else if (l.phase === 'full') stop();
    redraw();
  }, [stop, clear, lapsed]);
  /* The timer runs while the clock moves and the post is in view. */
  const kick = useCallback(() => {
    const { cfg: c, total: n } = latest.current;
    const phase = look(c, n, clock.current!, Date.now()).phase;
    if (timer.current === null && inView.current && phase !== 'full' && phase !== 'cleared') timer.current = setInterval(step, TICK_MS);
    redraw();
  }, [step]);

  const grab = useCallback((who: Holder) => {
    if (holds.current.has(who)) return;
    lapsed();
    const { cfg: c, total: n } = latest.current;
    const now = Date.now();
    const was = look(c, n, clock.current!, now);
    holds.current.add(who);
    lastRead.current = now;
    clock.current = press(c, n, clock.current!, now);
    if (look(c, n, clock.current, now).phase === 'erasing') {
      if (who === 'toggle') { if (was.phase !== 'erasing' && was.phase !== 'waiting') announce(ERASING); }
      else if (was.phase !== 'erasing') announce(STARTED);
    }
    kick();
  }, [announce, kick, lapsed]);
  const letGo = useCallback((who: readonly Holder[]) => {
    lapsed();
    const had = holds.current.has('toggle');
    let any = false;
    for (const h of who) any = holds.current.delete(h) || any;
    if (!any || holds.current.size > 0) return;
    const { cfg: c, total: n } = latest.current;
    clock.current = release(c, n, clock.current!, Date.now());
    if (had && !holds.current.has('toggle') && who.includes('toggle') && look(c, n, clock.current, Date.now()).phase === 'waiting') announce(STOPPED);
    kick();
  }, [announce, kick, lapsed]);
  const drop = useCallback((who: Holder) => letGo([who]), [letGo]);
  /* Every way of holding ends together: the pointer, the key and a running erase. */
  const dropAll = useCallback(() => letGo(['pointer', 'key', 'toggle']), [letGo]);
  /* A running erase is started by one activation and stopped by the next. */
  const activate = useCallback(() => { if (holds.current.has('toggle')) drop('toggle'); else grab('toggle'); }, [grab, drop]);

  /* A hold can outlive its pointer (Alt-Tab, another tab, a window losing focus send no pointerup): all of them end with the page's attention. */
  useEffect(() => {
    if (!control) return;
    const hidden = () => { if (document.visibilityState === 'hidden') dropAll(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', dropAll);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', dropAll); };
  }, [control, dropAll]);

  /* Seen: types in from the start, each time it comes into view. Not seen: at rest, whole, with no timer and no hold. */
  useEffect(() => {
    const el = box.current;
    if (still || !el) return;
    const stopWatching = watchInView(el, (showing) => {
      inView.current = showing;
      holds.current.clear();
      const { cfg: c } = latest.current;
      if (!look(c, latest.current.total, clock.current!, Date.now()).cleared) clock.current = showing ? typeIn(c, 0, Date.now()) : FULL;
      stop();
      if (showing) kick(); else redraw();
    });
    return () => { stopWatching(); inView.current = false; stop(); };
  }, [showing, still, stop, kick]);

  /* Words that arrive while the post is in view type in after the ones before; a new version (an edit) types in whole, and is not the old one's clear. */
  const before = useRef({ total, version });
  useLayoutEffect(() => {
    const was = before.current;
    before.current = { total, version };
    if (still) return;
    const now = Date.now();
    if (was.version !== version) {
      setCleared(false);
      holds.current.clear();
      clock.current = typeIn(cfg, 0, now);
      if (inView.current) kick();
    } else if (total > was.total && inView.current && look(cfg, was.total, clock.current!, now).phase === 'full') {
      clock.current = typeIn(cfg, was.total, now);
      kick();
    }
    // The settings are read as of this render: only a change of the words or the version moves the clock.
  }, [total, version]);

  useLayoutEffect(() => { if (lostFocus.current) { lostFocus.current = false; note.current?.focus(); } });
  useEffect(() => () => { stop(); }, [stop]);

  /* A tail still being written is not hidden from a screen reader: it is said once, and the line goes when the words come. */
  const writing = !still && texts.length === 0 && waiting && !gone;
  useEffect(() => { say((was) => (writing ? STILL_WRITING : was === STILL_WRITING ? '' : was)); }, [writing]);

  /* In a moment or a version: what it added, for the frame's words. */
  const hadText = plays.some((p) => { const w = written.get(p.id); return w !== undefined && 'text' in w && w.text !== ''; });
  const added = !still ? null : texts.length > 0 ? `${total} ${total === 1 ? 'character' : 'characters'} added` : hadText ? 'erased' : null;
  useEffect(() => {
    if (!still) return;
    const view: CardView | null = added === null ? null : { progress: null, state: added, yours: false, controls: [], notes: {} };
    show(view);
  }, [still, added, show]);

  /* The characters shown, taken from the first play's text on, so an erase takes the last play's first. */
  let left = still ? total : l.shown;
  const spans = texts.map((t) => {
    const mine = t.chars.slice(0, Math.max(0, left)).join('');
    left -= t.chars.length;
    return <span key={t.play.id} data-play={t.play.id}>{mine}</span>;
  });
  const cursor = <span className="dw-ywst-cursor" data-kb-cursor aria-hidden="true" {...(still || reduced ? { 'data-kb-still': '' } : {})} />;
  const typing = !still && !reduced && l.phase === 'typing';

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button > 0) return;
    /* No text selection, and no compatibility mouse events, from a press that is a hold. */
    e.preventDefault();
    /* The pointer is captured, so its release is heard wherever it happens, and a capture lost is a release. */
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    grab('pointer');
  };
  const onPointerUp = (e: PointerEvent<HTMLSpanElement>) => {
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
    drop('pointer');
  };
  /* A click that is not the end of a pointer hold (detail 0: a screen reader's activate, a switch) starts or stops the running erase. */
  const onClick = (e: MouseEvent<HTMLSpanElement>) => { if (e.detail === 0) activate(); };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Backspace') { e.preventDefault(); if (!e.repeat) grab('key'); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) activate(); return; }
    if (e.key === 'Escape' && holds.current.has('toggle')) { e.preventDefault(); drop('toggle'); }
  };
  /*
   * One tree whatever the state, so the status keeps its place (and a focus moved to it when the tail goes) as the block comes and goes: the
   * words, the block (a control, a decoration while only the cursor types, or a still group), and the status.
   */
  const handlers = control ? {
    role: 'button', tabIndex: 0, 'aria-label': `Continued by ${NAME}: ${spoken}. Hold to erase, or press Enter to start erasing and Enter again to stop. It comes back if you stop.`,
    onPointerDown, onPointerUp, onPointerCancel: dropAll, onLostPointerCapture: dropAll, onPointerLeave: () => drop('pointer'), onClick,
    onContextMenu: (e: { preventDefault: () => void }) => { if (holds.current.size > 0) e.preventDefault(); },
    onKeyDown, onKeyUp: (e: KeyboardEvent<HTMLSpanElement>) => { if (e.key === 'Backspace') drop('key'); }, onBlur: dropAll,
  } : still ? { role: 'group', 'aria-label': 'Continued by You Were Saying?' } : { 'aria-hidden': true };
  return (
    <>
      {children}
      {showing && (
        <span ref={box} className="dw-ywst" data-kb-tail="" {...(typing ? { 'data-kb-typing': '' } : {})} {...handlers}>
          {spans}{cursor}
        </span>
      )}
      {!still && <span ref={note} className={unsaved ? 'dw-ywst-note' : 'kb-visually-hidden'} role="status" aria-live="polite" tabIndex={-1} data-kb-report>{said}</span>}
    </>
  );
}
