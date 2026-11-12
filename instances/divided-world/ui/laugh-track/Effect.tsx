/**
 * Laugh Track's effect on a post (docs/plans/2026-11-11-laugh-track-design.md, sections 6 and 8; plan Task 13; when a place fires, what marks it and how
 * the keyboard reaches it are docs/plans/2026-11-12-laugh-track-point-design.md, sections 1 to 4, and the plan's Task 4). The audience is heard and captioned
 * when a reader points at a cued phrase; the words stay where they were, and what the reader reads is never sent or saved.
 *
 * Each place (a cue's phrase found by `placesOf`, the engine's one matcher, over the post's visible text) is a `wrap` run of a `TextLayer`,
 * drawn as `span.dw-lt-cue`. 1. Only a gesture fires a place: a mouse that moves onto it, a tap or click, Enter or Space. Scrolling never does,
 * and neither does a place that scrolls under a mouse at rest: a `pointerenter` at the position the mouse last was (one position for the page, shared by every post, and kept by the
 * one document `pointermove` listener) is not a gesture, and neither is an enter or a move when no position is known yet: it records where it was. The next `pointermove` over
 * the place, at a new position, is a gesture. A touch that only brushes a place does nothing. The reaction plays at once and fades in over
 * one already sounding (the mixer's `audience` group); a second gesture on a place inside 300 ms is the same gesture and plays nothing.
 * 2. Nearness marks the place before it is heard: the watcher (watch.ts) tells each unheard place how near the reader is, 0 to 1, and this effect writes
 * that, times `laughTrack.markMost`, to the place's pieces as `--dw-lt-near`, which the CSS reads as the dotted underline's opacity in the sound's ink.
 * Nothing is kept in state for it and nothing draws again. 3. A place that has been heard carries `dw-lt-fired`: the mark at full for the visit, no
 * longer registered with the watcher, so it no longer chitters. Pointing at it again replays it. Each reaction (first or replay) tells the watcher
 * (`quiet`) with the play's own answer, so the page's chitter waits for the reaction and returns over its tail.
 * 4. The keyboard: every place's first piece is a button, named by its own visible words and then "Play the audience's reaction", or once heard "Replay: the
 * audience boos" (WCAG 2.5.3, Label in Name). One of a post's places is its tab stop; the arrows, Home and End move among them, and the focused place
 * is the stop. Focus pins the place's nearness at 1 (the mark shows in full and its chitter plays) and plays nothing; Enter or Space plays the reaction.
 *
 * This effect registers each unheard place with the watcher and hands it the way to make a kind's loop. A take is picked from the play, its seed and the place
 * (`seeded`), so every screen picks the same, and it is one of three.
 *
 * Heard places are this visit's own state: nothing is saved or sent, and nothing here reads who wrote the post or who cast the card
 * (`reader.author` and `reader.caster` are never read), so no sound, caption or timing depends on who owns anything.
 *
 * Under another card's words: the runs are `wrap` runs at z -1, a level under every other card's wrap run at 0 and every replace run. Where
 * the two share a stretch (Autocorrect's tape over a phrase) the tape's run is the one drawn there, whichever card was played first, so the
 * phrase has no place drawn and the underline never shows through the tape; the rest of the cue's places are drawn as usual.
 *
 * `still` (a play's moment in history) is a component of its own that draws the places unmarked and uses no sound, no watcher and no
 * handler; its Lens says how many cues the play holds.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { parse } from '../../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../../engine/bbcode/visible.ts';
import { TextLayer, type TextRun } from '../../../../engine/ui/bbcode/layers.tsx';
import { useSound } from '../../../../engine/ui/audio/sound.ts';
import { useGameSound } from '../../../../engine/ui/audio/useGameSound.ts';
import type { CardPlay, CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import { placesOf, type Cue, type Sound } from '../../cards/laugh-track.ts';
import { seeded } from '../seeded.ts';
import { forgetVoice, quiet, register, type Screen, type Unregister } from './watch.ts';
import './laugh-track.css';

/* Where the mouse last moved on this page, and how many effects are listening: one document `pointermove` listener serves every post, so a post mounted
   later (a navigation, a lazy mount) already knows where the mouse was, and forty posts are not forty listeners. */
let lastPointer: { x: number; y: number } | null = null;
let listeners = 0;
const onDocumentMove = (e: PointerEvent) => { if (e.pointerType === 'mouse') lastPointer = { x: e.clientX, y: e.clientY }; };
const listen = () => { if (listeners++ === 0) document.addEventListener('pointermove', onDocumentMove); };
const unlisten = () => { if (--listeners === 0) document.removeEventListener('pointermove', onDocumentMove); };
/** For tests: forget where the mouse was. */
export const __resetPointer = () => { lastPointer = null; };

/** The numbers the screens read from the card's settings when the instance has not set them (laugh-track.ts `screenReads`). */
export const DEFAULTS = { line: 40, reachRem: 12, murmurMost: 35, fadeMs: 250, markMost: 100 } as const;
/** The loop that builds before each kind of hit, by sound. */
const LOOPS: Readonly<Record<Sound, string>> = { laugh: 'laugh-track.titter', cheer: 'laugh-track.ooh', boo: 'laugh-track.grumble' };
const VERBS: Readonly<Record<Sound, string>> = { laugh: 'laughs', cheer: 'cheers', boo: 'boos' };
/** The events of one gesture (a press focuses a button and then presses it) replay once: a replay within this many ms of another is the same gesture. */
const SAME_GESTURE_MS = 300;
/** Laugh Track's runs lie under every other card's wrap run (see the file's header). */
const Z = -1;

/** One cued place on the post. */
interface Spot {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  readonly sound: Sound;
  /** The take this place plays: one of the sound's three. */
  readonly take: string;
}

const isCue = (c: unknown): c is Cue => typeof c === 'object' && c !== null && typeof (c as Cue).phrase === 'string' && ['laugh', 'cheer', 'boo'].includes((c as Cue).sound);

/** The post's cued places, in the order of the text, for each of the card's plays: those a cue's phrase still finds. */
function spotsOf(text: string, plays: readonly CardPlay[]): Spot[] {
  return plays.flatMap((play) => {
    const { cues, seed } = play.config as { cues?: unknown; seed?: unknown };
    if (play.caught || !Array.isArray(cues) || !cues.every(isCue)) return [];
    return placesOf(text, cues).map((place, i): Spot => {
      const sound = cues[place.cue]!.sound;
      const n = 1 + Math.floor(seeded(`${play.id}:${typeof seed === 'number' ? seed : 0}:${i}`)() * 3);
      return { key: `${play.id}:${i}`, start: place.start, end: place.end, sound, take: `laugh-track.${sound}-${n}` };
    });
  });
}

function useSpots(post: EffectProps['post'], plays: readonly CardPlay[]) {
  const body = typeof post.currentPayload.body === 'string' ? post.currentPayload.body : '';
  const text = useMemo(() => visibleText(parse(body)), [body]);
  /* The plays by content, so a new array of equal plays is not a new set of places. */
  const playsKey = JSON.stringify(plays.map((p) => [p.id, p.caught ?? null, p.config]));
  const spots = useMemo(() => spotsOf(text, plays), [text, playsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return spots;
}

/** A piece of a place, drawn for `run`: the words in a span that the rest of the effect finds by its place's key. */
const pieceOf = (spot: Spot, key: string, text: string, extra?: Record<string, unknown>): ReactNode => (
  <span key={key} data-sound={spot.sound} data-lt-place={spot.key} data-lt-piece={key} {...extra} className={extra?.['className'] as string | undefined ?? 'dw-lt-cue'}>{text}</span>
);

/** A play's moment: the places drawn unmarked, with nothing registered, played or bound. */
function Moment({ post, plays, show, children }: EffectProps) {
  const spots = useSpots(post, plays);
  const runs = useMemo<TextRun[]>(() => spots.map((s) => ({ start: s.start, end: s.end, key: `lt:${s.key}`, z: Z, mode: 'wrap', render: ({ text, key }) => pieceOf(s, key, text) })), [spots]);
  /* The cues the play holds, whatever the version of the post shown finds: a moment says what was played. */
  const held = plays.reduce((n, p) => { const { cues } = p.config as { cues?: unknown }; return n + (!p.caught && Array.isArray(cues) ? cues.filter(isCue).length : 0); }, 0);
  const view: CardView = { progress: null, state: `${held} ${held === 1 ? 'cue' : 'cues'}`, yours: false, controls: [], notes: {} };
  const viewKey = JSON.stringify(view);
  const now = useRef(view);
  now.current = view;
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => { showRef.current(now.current); }, [viewKey]);
  useEffect(() => () => { showRef.current(null); }, []);
  return <div className="dw-lt"><TextLayer runs={runs}>{children}</TextLayer></div>;
}

function Live({ post, plays, show, met, children }: EffectProps) {
  const { settings } = useKayfa();
  const sound = useSound();
  const gameSound = useGameSound();
  const spots = useSpots(post, plays);
  const root = useRef<HTMLDivElement>(null);
  const cards = settings.cardSettings;
  const screen = useMemo<Screen>(() => ({
    line: cards['laughTrack.line'] ?? DEFAULTS.line, reachRem: cards['laughTrack.reachRem'] ?? DEFAULTS.reachRem,
    murmurMost: cards['laughTrack.murmurMost'] ?? DEFAULTS.murmurMost, fadeMs: cards['laughTrack.fadeMs'] ?? DEFAULTS.fadeMs,
  }), [cards]);
  const markMost = cards['laughTrack.markMost'] ?? DEFAULTS.markMost;
  /* The places that have been heard this visit, and the first piece drawn of each place (its button): this screen's own state, never saved or sent. */
  const [fired, setFired] = useState<ReadonlySet<string>>(() => new Set());
  const [first, setFirst] = useState<Readonly<Record<string, string>>>({});
  /* The post's one tab stop: the place last focused, or the first place when that one is gone. */
  const [stop, setStop] = useState<string | null>(null);
  const firedNow = useRef(fired);
  firedNow.current = fired;

  /* What the callbacks below read, so a registration lives as long as its place does and not as long as a render. */
  const now = useRef({ sound, show, met, screen, spots, markMost });
  now.current = { sound, show, met, screen, spots, markMost };
  const metOnce = useRef(false);
  const lastPlay = useRef<Record<string, number>>({});

  /* A gesture on a place: it is marked heard, and its take fades in over the one before it and tails off over its last `fadeMs`. The watcher is told, with the play's own answer (the take's length), so the chitter waits. */
  const fire = useCallback((spot: Spot) => {
    const at = Date.now();
    if (at - (lastPlay.current[spot.key] ?? -Infinity) < SAME_GESTURE_MS) return;
    lastPlay.current[spot.key] = at;
    if (!firedNow.current.has(spot.key)) {
      firedNow.current = new Set(firedNow.current).add(spot.key);
      setFired(firedNow.current);
    }
    const { fadeMs } = now.current.screen;
    quiet(now.current.sound.play(spot.take, { group: 'audience', fadeMs, tailMs: fadeMs }), fadeMs);
    if (!metOnce.current) { metOnce.current = true; now.current.met(); }
  }, []);

  /* A place's nearness becomes the mark's opacity, written to its pieces as they are now: no state, no render. */
  const mark = useCallback((key: string, n: number) => {
    const value = Math.round(n * now.current.markMost) / 100;
    /* A zero is no property at all (the CSS falls back to 0), so the pointer cursor, which follows the property, follows only a showing mark. */
    for (const e of root.current?.querySelectorAll<HTMLElement>(`[data-lt-place="${key}"]`) ?? []) {
      if (value === 0) e.style.removeProperty('--dw-lt-near');
      else e.style.setProperty('--dw-lt-near', String(value));
    }
  }, []);

  /* The page's watcher holds a registration for each place drawn and not yet heard. */
  /* The places the mouse is over and has fired or been refused, until it leaves them. */
  const over = useRef(new Set<string>());
  const registered = useRef(new Map<string, Unregister>());
  const sync = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const drawn = new Set<string>();
    for (const e of el.querySelectorAll('[data-lt-place]')) drawn.add(e.getAttribute('data-lt-place')!);
    /* A place whose pieces are gone has no `pointerleave` coming: the mouse is no longer over it. */
    for (const key of over.current) if (!drawn.has(key)) over.current.delete(key);
    const mine = new Map(now.current.spots.map((s) => [s.key, s]));
    for (const [key, off] of registered.current) {
      if (!drawn.has(key) || !mine.has(key) || firedNow.current.has(key)) { off(); registered.current.delete(key); } else off.refresh();
    }
    for (const spot of mine.values()) {
      if (!drawn.has(spot.key) || firedNow.current.has(spot.key) || registered.current.has(spot.key)) continue;
      registered.current.set(spot.key, register({
        els: () => el.querySelectorAll(`[data-lt-place="${spot.key}"]`),
        kind: spot.sound,
        screen: now.current.screen,
        voice: (kind) => now.current.sound.loop(LOOPS[kind as Sound], { group: 'audience-build', id: `laugh-track:${kind}` }),
        near: (n) => mark(spot.key, n),
      }));
    }
  }, [mark]);
  const spotsKey = spots.map((s) => `${s.key}@${s.start}-${s.end}`).join(',');
  useEffect(() => { sync(); }, [spotsKey, screen, fired, sync]);
  /* A card over this one (a tape peeled, a play ended) draws the words again without drawing this effect: its places are looked for again. */
  useEffect(() => {
    const el = root.current;
    if (!el || typeof MutationObserver !== 'function') return;
    const watch = new MutationObserver(() => { sync(); findFirsts(); });
    watch.observe(el, { childList: true, subtree: true });
    return () => { watch.disconnect(); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  /* Game sounds switched off or on: the mixer ends a loop whose bus went off and its handle does not say so, so the watcher is told to
     let its loop go and make a fresh one at the next near frame (the first render is not a change). */
  const soundOn = useRef(gameSound.on);
  useEffect(() => {
    if (soundOn.current === gameSound.on) return;
    soundOn.current = gameSound.on;
    forgetVoice();
  }, [gameSound.on]);
  /* The post going lets every place go; the watcher stops a kind's loop with its last place, which is how no held caption outlives the post. */
  useEffect(() => () => {
    for (const off of registered.current.values()) off();
    registered.current.clear();
  }, []);

  useEffect(() => { listen(); return unlisten; }, []);
  /* The mouse's position is the page's: a place that mounts or scrolls under a mouse at rest is entered at that position, and that is not a gesture. An enter or
     a move with no position known yet only records where it was (a browser may send either to a place drawn under a still mouse); either way the position is kept, so
     the same-position `pointermove` a browser sends after an enter does not fire. The document's listener is a bubble listener, so it records after these handlers compare. */
  const moved = (e: { clientX: number; clientY: number }) => {
    const was = lastPointer;
    lastPointer = { x: e.clientX, y: e.clientY };
    if (was === null) return false;
    return was.x !== e.clientX || was.y !== e.clientY;
  };

  /* The first piece drawn of each place is its button. */
  const findFirsts = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const found: Record<string, string> = {};
    for (const e of el.querySelectorAll('[data-lt-place]')) {
      const place = e.getAttribute('data-lt-place')!;
      if (!(place in found)) found[place] = e.getAttribute('data-lt-piece')!;
    }
    setFirst((was) => (JSON.stringify(was) === JSON.stringify(found) ? was : found));
  }, []);
  useLayoutEffect(() => { findFirsts(); }, [fired, spotsKey, findFirsts]);
  const firstNow = useRef(first);
  firstNow.current = first;
  const order = Object.keys(first);
  const stopKey = stop !== null && stop in first ? stop : order[0];

  /* The arrows, Home and End among the post's places: the focus goes to the first piece of the place wanted. */
  const goTo = useCallback((from: string, key: string) => {
    const at = Object.keys(firstNow.current);
    const i = at.indexOf(from);
    const to = key === 'Home' ? 0 : key === 'End' ? at.length - 1 : key === 'ArrowRight' || key === 'ArrowDown' ? i + 1 : i - 1;
    const place = at[to];
    if (place === undefined || place === from) return;
    root.current?.querySelector<HTMLElement>(`[data-lt-piece="${firstNow.current[place]}"]`)?.focus();
  }, []);

  const runs = useMemo<TextRun[]>(() => spots.map((spot) => {
    const done = fired.has(spot.key);
    /* A mouse that has moved onto the place fires it once, until it leaves. */
    const gesture = (e: { clientX: number; clientY: number; pointerType: string }) => {
      if (e.pointerType !== 'mouse' || over.current.has(spot.key) || !moved(e)) return;
      over.current.add(spot.key);
      fire(spot);
    };
    return {
      start: spot.start, end: spot.end, key: `lt:${spot.key}`, z: Z, mode: 'wrap',
      render: ({ text, key }) => {
        const isFirst = first[spot.key] === key;
        const press = (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(spot); }
          else if (isFirst && ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); goTo(spot.key, e.key); }
        };
        return pieceOf(spot, key, text, {
          className: done ? 'dw-lt-cue dw-lt-fired' : 'dw-lt-cue',
          onPointerEnter: gesture,
          onPointerMove: gesture,
          onPointerLeave: (e: PointerEvent) => {
            const into = e.relatedTarget;
            if (into instanceof Element && into.closest(`[data-lt-place="${spot.key}"]`)) return;
            over.current.delete(spot.key);
          },
          onClick: () => { fire(spot); },
          onKeyDown: press,
          ...(isFirst ? {
            role: 'button',
            tabIndex: stopKey === spot.key ? 0 : -1,
            'aria-label': done ? `${text}. Replay: the audience ${VERBS[spot.sound]}` : `${text}. Play the audience's reaction`,
            onFocus: () => { setStop(spot.key); registered.current.get(spot.key)?.pin(true); },
            onBlur: () => { registered.current.get(spot.key)?.pin(false); },
          } : null),
        });
      },
    };
  }), [spots, fired, first, stopKey, fire, goTo]);

  /* The Lens's words: how many cues have been heard on this visit, and the toggle for Game sounds. */
  const heard = spots.filter((s) => fired.has(s.key)).length;
  const view: CardView = {
    progress: spots.length ? Math.round((heard / spots.length) * 1000) / 1000 : null,
    state: spots.length ? `${heard} of ${spots.length} cues heard` : 'No cues in this version',
    yours: false,
    controls: [{ kind: 'toggle', label: 'Game sounds', on: gameSound.on, set: gameSound.set }],
    notes: {},
  };
  const viewKey = JSON.stringify({ ...view, controls: view.controls.map((c) => [c.kind, c.label, 'on' in c ? c.on : null]) });
  const latest = useRef(view);
  latest.current = view;
  useEffect(() => { now.current.show(latest.current); }, [viewKey]);
  useEffect(() => () => { now.current.show(null); }, []);

  return <div ref={root} className="dw-lt"><TextLayer runs={runs}>{children}</TextLayer></div>;
}

export function LaughTrackEffect(props: EffectProps) {
  /* `still` is fixed for a post's life, so the two never swap hooks mid-life. */
  return props.still ? <Moment {...props} /> : <Live {...props} />;
}
