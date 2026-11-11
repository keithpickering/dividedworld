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
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useMotionReduced } from '../../../../engine/ui/appearance.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { watchInView } from '../../../../engine/ui/shine/inView.ts';
import { FULL, look, press, release, typeIn, type Erase, type EraseSettings } from './erase.ts';
import './tail.css';

/** The settings' own numbers, used where the screen settings do not hold one (the instance's `cardSettings`). */
const ERASE_CPS = 6;
const RETYPE_MS = 2000;
const TYPE_CPS = 40;
/** How often the clock is read while it moves, in milliseconds: 40 times a second is smooth at 40 characters a second. */
const TICK_MS = 25;
const STARTED = 'Erasing. Keep holding to erase all of it.';
const ERASED = 'Erased.';
const NAME = 'You Were Saying?';

type Holder = 'pointer' | 'key';

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
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const inView = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [said, say] = useState('');
  const [cleared, setCleared] = useState(false);
  const l = look(cfg, total, clock.current, Date.now());
  const gone = !still && (cleared || l.cleared);
  const showing = drawn && !gone;
  const box = useRef<HTMLSpanElement>(null);
  const note = useRef<HTMLSpanElement>(null);

  const stop = useCallback(() => { if (timer.current !== null) { clearInterval(timer.current); timer.current = null; } }, []);
  const announce = useCallback((words: string) => say((was) => (was === words ? `${words} ` : words)), []);
  /* The author's clear, saved once on each play still live on the post, for the version drawn; any other reader's clear is only the screen's. */
  const clear = useCallback(() => {
    setCleared(true);
    announce(ERASED);
    if (box.current && box.current.contains(document.activeElement)) note.current?.focus();
    const { reader: who, version: v, live: playsNow, written: textNow, save: send } = latest.current;
    if (!who.author || v === undefined) return;
    for (const p of playsNow) {
      const w = textNow.get(p.id);
      if (w && !('failed' in w)) void Promise.resolve(send(p.id, { cleared: v })).catch(() => { /* the tail is back with the next read, and the author may erase it again */ });
    }
  }, [announce]);
  const step = useCallback(() => {
    const { cfg: c, total: n } = latest.current;
    const l = look(c, n, clock.current!, Date.now());
    if (l.cleared) { stop(); clear(); }
    else if (l.phase === 'full') stop();
    redraw();
  }, [stop, clear]);
  /* The timer runs while the clock moves and the post is in view. */
  const kick = useCallback(() => {
    const { cfg: c, total: n } = latest.current;
    const phase = look(c, n, clock.current!, Date.now()).phase;
    if (timer.current === null && inView.current && phase !== 'full' && phase !== 'cleared') timer.current = setInterval(step, TICK_MS);
    redraw();
  }, [step]);

  const control = !still && total > 0;
  const grab = useCallback((who: Holder) => {
    const { cfg: c, total: n } = latest.current;
    if (holds.current.has(who)) return;
    const was = look(c, n, clock.current!, Date.now());
    holds.current.add(who);
    clock.current = press(c, n, clock.current!, Date.now());
    if (look(c, n, clock.current, Date.now()).phase === 'erasing' && was.phase !== 'erasing') announce(STARTED);
    kick();
  }, [announce, kick]);
  const drop = useCallback((who: Holder) => {
    if (!holds.current.delete(who) || holds.current.size > 0) return;
    const { cfg: c, total: n } = latest.current;
    clock.current = release(c, n, clock.current!, Date.now());
    kick();
  }, [kick]);

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

  useEffect(() => () => { stop(); }, [stop]);

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
    grab('pointer');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== 'Backspace') return;
    e.preventDefault();
    if (!e.repeat) grab('key');
  };
  /*
   * One tree whatever the state, so the status keeps its place (and a focus moved to it when the tail goes) as the block comes and goes: the
   * words, the block (a control, a decoration while only the cursor types, or a still group), and the status.
   */
  const handlers = control ? {
    role: 'button', tabIndex: 0, 'aria-label': `Continued by ${NAME}: ${spoken}. Hold to erase. It comes back if you stop.`,
    onPointerDown, onPointerUp: () => drop('pointer'), onPointerCancel: () => drop('pointer'), onPointerLeave: () => drop('pointer'),
    onContextMenu: (e: { preventDefault: () => void }) => { if (holds.current.size > 0) e.preventDefault(); },
    onKeyDown, onKeyUp: (e: KeyboardEvent<HTMLSpanElement>) => { if (e.key === 'Backspace') drop('key'); }, onBlur: () => drop('key'),
  } : still ? { role: 'group', 'aria-label': 'Continued by You Were Saying?' } : { 'aria-hidden': true };
  return (
    <>
      {children}
      {showing && (
        <span ref={box} className="dw-ywst" data-kb-tail="" {...(typing ? { 'data-kb-typing': '' } : {})} {...handlers}>
          {spans}{cursor}
        </span>
      )}
      {!still && (showing || gone) && <span ref={note} className="kb-visually-hidden" role="status" aria-live="polite" tabIndex={-1} data-kb-report>{said}</span>}
    </>
  );
}
