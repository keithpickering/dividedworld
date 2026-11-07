/**
 * The reveal after a pack is bought (docs/plans/2026-11-04-booster-packs-design.md, section 5 and its amendments of 2026-11-07; boards 02, 03 and 04 in
 * docs/research/2026-11-07-booster-packs/): a modal over the machine that shows what the purchase's answer says the pack held, five cards in pull order,
 * face down, turned one at a time. It shows the `cards` it is given and rolls nothing: the cards were in the hand from the moment of purchase, so a
 * reload or reduced motion never changes what was bought, and closing early loses nothing ("These five are already in your hand.").
 *
 *  - The emptied pack is parked at the top, past the screen's edge with its foot in view, and "N OF 5 TURNED OVER" is under it.
 *  - The cards lie in a row at the fan's size. The card last turned is shown above the row at the sheet's size (the spotlight), so each is read large
 *    as it is turned; before the first, it holds the first card's back. Only the next card is a button.
 *  - A card is turned by a click or a tap on the next card, "Turn the next card", or Space. "Turn all" turns the rest. The hit (the last card) has a gold
 *    back and, once turned, a gold tag naming its rarity and card, with a glow and a few sparks.
 *  - On a phone the cards are a pile at the sheet's size: a tap on the pile or a swipe across it turns the next card, and a row of five outlines counts down.
 *  - A screen reader hears each card as it is turned, and the whole pack once all are, from one live region (the count line, which holds both). A face-down card is named with no word of what it is.
 *
 * Motion (the design's amendment "The reveal's motion"; plan Task 10): the beats are the presets of engine/ui/glass/motion.ts on the feel's tokens, and this
 * file holds no duration of its own. It starts nothing before its mount, which is the purchase's answer (a refusal never opens it), and reads nothing but
 * the cards it was given, which only the buyer's own stored pack says, so nobody else can watch it.
 *
 *  - Entrance: the dim (E1, `backdrop`); the pack rises from its slot's rect to the middle (E2); its crimped top tears away (E3); the five backs rise out of
 *    the opening (E4) and are dealt into the row while the emptied pack parks at the top (E5, `deal`); the head and buttons land (E6, `staggerItem`); the
 *    first back lifts into the spotlight (E7, `lift`). The cards are not drawn until the tear, and lie behind the pack's body until they clear it.
 *  - A turn: the card shown settles back into its slot as the next lifts out of its own (T1, a shared layout: one element per pull, one `layoutId` each);
 *    the card turns on its vertical axis (T2, `turn`). The hit pulses first (`beat`), and once turned its halo, sparks and tag land. Turn all turns the backs
 *    left where they lie, staggered, and the hit lifts last with its beat.
 *  - Input never waits: a turn, Turn all, Done or Esc pressed while a beat runs finishes every running beat at once (Motion's `animate` to the target in no
 *    time) and goes on from there. During the entrance, a turn finishes the entrance and turns. The imperative beats are snapped and the next layout lift is
 *    instant; a layout lift (the shared layout between the row and the spotlight) already in flight when the input arrives is not snapped, since Motion's layout
 *    animation has no `complete()`, and finishes within `enter`.
 *  - Exit: the words, buttons, tag and sparks fade, the parked pack slides on up out of view, and the cards fly to the Your hand link along one arc each
 *    (`toHand`), staggered at twice the step; the link pulses and the dim lifts. The layer is `inert` from the exit's first frame and focus is back on the
 *    slot at once (`useLayer`, `useModalLayer`); only the picture is still playing.
 *  - On a phone the entrance is the 1440's (the pack rises from its slot, or from the window's edge nearest it, tears, and lets the five out, not drawn until the
 *    tear), but the deal stacks the five into the pile (`deal` toward the stage's place) and not into a row. The exit and turns below follow.
 *  - On a phone the cards are a pile: a turned card is sent off toward the swipe's side (a drag follows the finger and commits past a third of the card's
 *    width) as the next is flipped, and the exit flies the card on top toward the hand link, or the window's top edge where the link is out of view.
 *  - Under Off nothing moves: no wrapper, no rotation, no second piece of the pack. Each beat's end state is drawn at once.
 *
 * The modal is the glass's layer (`useModalLayer`): focus moves inside when it opens and is held there, Esc closes it, and focus goes back to where
 * `returnFocusTo` says (the pack's slot).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { animate, motion, useInstantTransition, usePresence } from 'motion/react';
import { PostcardBack, Postcard } from '../cards/Postcard.tsx';
import { playWord, rarityName, type CardFace } from '../cards/faces.ts';
import type { CardArt } from '../cards/types.ts';
import { useKayfa } from '../context.tsx';
import { withArticle } from '../characters/format.ts';
import { GlassButton } from '../glass/Button.tsx';
import { beat, deal, eased, landing, lift, pulse, stagger, staggerItem, tilt, toHand, turn, useFeel, type ActiveFeel, type MotionProps, type Rect } from '../glass/motion.ts';
import { useLayer } from '../glass/layer.tsx';
import { useModalLayer } from '../modal.tsx';
import { PackArt } from './PackArt.tsx';
import { countWord } from './machine-words.ts';
import './opening.css';

export interface PackOpeningProps {
  /** The pack's name, as the instance gave it ("Booster"). */
  readonly name: string;
  readonly art?: Pick<CardArt, 'color' | 'ink'> & Partial<Pick<CardArt, 'canvas' | 'mark'>>;
  /** The cards the purchase's answer gave, in pull order; the last is the hit's. */
  readonly cards: readonly CardFace[];
  /** A plain sentence about the hit after all are turned ("Main Event isn't sold on its own; this is one of the ways to get it."), or none. */
  readonly note: string | null;
  readonly onClose: () => void;
  readonly returnFocusTo?: () => HTMLElement | null;
  /** The machine's Your hand link, measured when the exit starts: the cards fly to it, and it pulses as they land. None: they fly to the window's top edge. */
  readonly handLink?: () => HTMLElement | null;
}

/** Where the sparks stand round the hit's card, as shares of the spotlight's box. */
const SPARKS = [[-12, 10, 18], [108, 5, 14], [115, 72, 20], [-11, 80, 12], [105, 100, 10], [-7, 43, 9]] as const;

/** A card as it is said when it is turned: "Whoops!, Salty Cast, common". */
export const saidOf = (face: CardFace): string => face.unknown ? face.name : `${face.name}, ${face.tag} ${playWord(face.play)}, ${face.rarity}`;

/** A beat that has been finished by an input: whatever it still had to do is not done. */
class Stop extends Error {}
/** `quiet`: the reveal is leaving, so the finish draws its end state on the elements and leaves what React shows alone (it is not run in a commit). */
interface Run { cancelled: boolean; finish: (quiet: boolean) => void }

type Values = Record<string, unknown>;
type Beat = { readonly transition?: unknown } & Values;
/** The values a target ends on: the last keyframe of each, without its transition. */
const endOf = (t: Beat): Values => Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'transition' && k !== 'transitionEnd').map(([k, v]) => [k, Array.isArray(v) ? v[v.length - 1] : v]));
/** A preset's `animate` as a target and its transition. */
const split = (p: MotionProps): { readonly target: Beat; readonly transition: Beat } => {
  const { transition, ...target } = (p.animate ?? {}) as Beat;
  return { target, transition: (transition ?? {}) as Beat };
};
const NOW = { duration: 0 } as const;
const rect = (r: DOMRect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });
const isPhone = () => document.documentElement.getAttribute('data-kb-layout') === 'phone';
/** The pack's width in the middle of the screen, px: the hero size the pack grows to before it tears. */
const HERO_W = 180;

export function PackOpening({ name, art, cards, note, onClose, returnFocusTo, handLink }: PackOpeningProps) {
  const { ui } = useKayfa();
  const feel = useFeel(ui.glass.motion);
  const count = cards.length;
  const id = useId();
  const [turned, setTurned] = useState(0);
  /* With a feel: which card stands in the spotlight (-1: none yet), whether the entrance is over, whether the cards are in front of the pack, the head landed, the hit turned. */
  const [spot, setSpot] = useState(-1);
  const [stage, setStage] = useState<'entering' | 'ready'>(feel ? 'entering' : 'ready');
  const [front, setFront] = useState(feel === null);
  const [headIn, setHeadIn] = useState(feel === null);
  const [hitDone, setHitDone] = useState(false);
  const [present, safeToRemove] = usePresence();
  const { overlay, box } = useModalLayer({ onClose, returnFocusTo });
  const lifted = useLayer({ box, kind: 'modal', overrides: ui.glass.motion });
  const instantly = useInstantTransition();
  const primary = useRef<HTMLButtonElement>(null);
  const delays = useMemo(() => stagger(feel, 4), [feel]);
  const mark = ui.cardBack?.mark;
  const all = turned >= count;
  const hitShown = feel ? hitDone && all && count > 0 : all && count > 0;
  const shownIndex = Math.max(0, turned - 1);
  const shown = cards[shownIndex];
  const phone = isPhone();

  /* The state the beats read, kept where an input that comes in the middle of a beat sees it as it is now. */
  const turnedAt = useRef(0);
  const spotAt = useRef(-1);
  const flipped = useRef(new Set<number>());
  const run = useRef<Run | null>(null);
  const mounted = useRef(true);
  const beats = useRef(new Map<Element, Values>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const entered = useRef(false);
  const feelNow = useRef(feel);
  feelNow.current = feel;

  const node = (sel: string) => box.current?.querySelector<HTMLElement>(sel) ?? null;
  const cardNode = (i: number) => node(`[data-kb-pull="${i}"]`);
  const flipNode = (i: number) => cardNode(i)?.querySelector<HTMLElement>('.kb-opening-flip') ?? null;

  /* ---- the beats ---- */

  /** Plays a beat on `el` and waits for it, unless the run it belongs to has been finished. A beat that is running is kept, so an input can finish it. */
  async function go(r: Run, el: HTMLElement | null, target: Beat, transition: Beat): Promise<void> {
    if (r.cancelled || !mounted.current) throw new Stop();
    if (!el) return;
    beats.current.set(el, endOf(target));
    const c = animate(el, target as never, transition as never);
    await new Promise<void>((resolve) => { void c.then(() => resolve(), () => resolve()); });
    if (beats.current.get(el) === undefined) throw new Stop();
    beats.current.delete(el);
    if (r.cancelled || !mounted.current) throw new Stop();
  }
  /** Waits `ms`, unless the run is finished. */
  function wait(r: Run, ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { timers.current.delete(t); if (r.cancelled || !mounted.current) reject(new Stop()); else resolve(); }, ms);
      timers.current.add(t);
    });
  }
  /** Moves the spotlight to `i` (-1: none): the shared layout carries the cards, or at once where the caller says. */
  function putInSpot(i: number, now = false) {
    spotAt.current = i;
    const apply = () => flushSync(() => setSpot(i));
    if (now) instantly(apply); else apply();
  }
  /** Every beat that is running is brought to its target at once. */
  function settle() {
    for (const t of timers.current) clearTimeout(t);
    timers.current.clear();
    for (const [el, end] of beats.current) animate(el, end as never, NOW);
    beats.current.clear();
  }
  /** An input: the running sequence is finished (its end state drawn, what it still had to do done) and a new one may start. */
  function finishRun(quiet = false) {
    const r = run.current;
    if (!r) return;
    run.current = null;
    r.cancelled = true;
    settle();
    r.finish(quiet);
  }
  function begin(finish: (quiet: boolean) => void): Run {
    const r: Run = { cancelled: false, finish };
    run.current = r;
    return r;
  }
  function play(r: Run, seq: () => Promise<void>) {
    void seq().then(() => { if (run.current === r) run.current = null; }, (e: unknown) => { if (!(e instanceof Stop)) throw e; });
  }

  /** The turn of card `i`, from the moment it stands in the spotlight: the hit pulses first; the card turns; the hit's halo, sparks and tag follow. */
  async function turnOver(r: Run, f: NonNullable<ActiveFeel>, i: number) {
    if (i === count - 1) await go(r, cardNode(i), split(beat(f)).target, split(beat(f)).transition);
    flipped.current.add(i);
    const t = split(turn(f));
    await go(r, flipNode(i), t.target, t.transition);
    if (i === count - 1) { setHitDone(true); }
  }
  /** What a turn that is finished by an input leaves: the card turned and in the spotlight. */
  const turnedFor = (i: number) => (quiet: boolean) => {
    if (spotAt.current !== i && !quiet) putInSpot(i, true);
    flipped.current.add(i);
    const flip = flipNode(i);
    if (flip) animate(flip, { rotateY: 180 }, NOW);
    if (i === count - 1) { setHitDone(true); }
  };

  function turnNext(dir: -1 | 1 = -1) {
    const i = turnedAt.current;
    if (i >= count) return;
    if (!feel) { turnedAt.current = i + 1; setTurned(i + 1); return; }
    const f = feel;
    finishRun();
    const at = Math.min(count, turnedAt.current + 1) - 1;
    turnedAt.current = at + 1;
    /* The counter moves and the reader hears the card when the turn starts, not when it ends. */
    flushSync(() => setTurned(at + 1));
    const r = begin(turnedFor(at));
    play(r, async () => {
      const prev = spotAt.current;
      if (prev !== at) {
        if (isPhone()) {
          /* A turned card on top of the pile is sent off toward the swipe's side. */
          if (prev >= 0 && flipped.current.has(prev)) await go(r, cardNode(prev), { x: dir * window.innerWidth, rotate: dir * 14, opacity: 0 }, eased(f, f.exit) as Beat);
          putInSpot(at);
        } else {
          /* T1: the card shown settles into its slot as this one lifts out of its own. */
          putInSpot(at);
          await wait(r, f.enter);
        }
      }
      await turnOver(r, f, at);
    });
  }

  function turnAll() {
    const from = turnedAt.current;
    if (from >= count) return;
    if (!feel) { turnedAt.current = count; setTurned(count); return; }
    const f = feel;
    finishRun();
    const first = turnedAt.current;
    turnedAt.current = count;
    flushSync(() => setTurned(count));
    const last = count - 1;
    const rest = Array.from({ length: Math.max(0, last - first) }, (_, n) => first + n);
    const r = begin((quiet) => {
      for (const i of rest) { flipped.current.add(i); const flip = flipNode(i); if (flip) animate(flip, { rotateY: 180 }, NOW); }
      turnedFor(last)(quiet);
    });
    play(r, async () => {
      const t = split(turn(f));
      if (isPhone()) {
        for (const i of rest) flipped.current.add(i);
      } else {
        /* The backs left in the row turn where they lie: the one in the spotlight settles into its slot first. */
        if (spotAt.current >= 0 && spotAt.current !== last) { putInSpot(-1); await wait(r, f.enter); }
        const d = stagger(f, rest.length);
        for (const i of rest) flipped.current.add(i);
        await Promise.all(rest.map((i, n) => go(r, flipNode(i), t.target, { ...t.transition, delay: (d[n] ?? 0) * 3 + Number(t.transition.delay ?? 0) })));
      }
      /* The hit lifts last, with its beat. */
      if (spotAt.current !== last) {
        if (isPhone() && spotAt.current >= 0) await go(r, cardNode(spotAt.current), { x: -window.innerWidth, rotate: -14, opacity: 0 }, eased(f, f.exit) as Beat);
        putInSpot(last);
        if (!isPhone()) await wait(r, f.enter);
      }
      await turnOver(r, f, last);
    });
  }

  /* ---- the entrance ---- */

  useLayoutEffect(() => {
    const f = feelNow.current;
    if (!f || entered.current) return;
    entered.current = true;
    const pack = node('.kb-opening-pack');
    const packIn = node('.kb-opening-pack-in');
    const top = node('.kb-opening-pack-top');
    if (!pack || !packIn || !top) { setStage('ready'); setFront(true); setHeadIn(true); return; }
    const phoneNow = isPhone();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const home = rect(pack.getBoundingClientRect());
    const slot = returnFocusTo?.()?.getBoundingClientRect();
    /* The slot's rect; where the slot has scrolled out of view, the window's edge nearest it. */
    const from = slot && slot.width > 0 ? rect(slot) : { x: vw / 2 - 43, y: vh, width: 86, height: 129 };
    const edge = { x: Math.min(Math.max(from.x, 0), vw - from.width), y: Math.min(Math.max(from.y, -from.height / 2), vh - from.height / 2), width: from.width, height: from.height };
    const placeOf = (target: Rect, widthOf = home.width) => ({
      x: target.x + target.width / 2 - (home.x + home.width / 2), y: target.y + target.height / 2 - (home.y + home.height / 2), scale: target.width / widthOf,
    });
    const hero = { x: vw / 2 - HERO_W / 2, y: Math.round(vh * 0.24), width: HERO_W, height: HERO_W * 1.5 };
    const slotAt = placeOf(edge);
    const heroAt = placeOf(hero);
    const cardNodes = Array.from({ length: count }, (_, i) => cardNode(i));
    const homes = cardNodes.map((c) => (c ? rect(c.getBoundingClientRect()) : { x: 0, y: 0, width: 0, height: 0 }));
    const shut = (i: number) => ({ x: hero.x + hero.width / 2 + (i - 2) * 2 - (homes[i]!.x + homes[i]!.width / 2), y: hero.y + hero.height / 2 - (homes[i]!.y + homes[i]!.height / 2), scale: 1, rotate: 0 });
    const fanned = (i: number) => ({
      x: hero.x + hero.width / 2 + (i - 2) * 26 - (homes[i]!.x + homes[i]!.width / 2),
      y: hero.y - hero.height * 0.29 + Math.abs(i - 2) * 10 - (homes[i]!.y + homes[i]!.height / 2),
      scale: 1, rotate: tilt(i, count),
    });
    const pile = node('.kb-opening-stage')?.getBoundingClientRect();
    const pileAt = (i: number) => {
      const h = homes[i]!;
      if (!pile || pile.width === 0 || h.width === 0) return { x: 0, y: 0, scale: 1 };
      return { x: pile.x + pile.width / 2 + (i - 2) * 2 - (h.x + h.width / 2), y: pile.y + pile.height / 2 - (h.y + h.height / 2), scale: pile.width / h.width };
    };
    /* Before the first frame: the pack at its slot, the cards shut inside it and not drawn. */
    animate(pack, { x: slotAt.x, y: slotAt.y, scale: slotAt.scale }, NOW);
    animate(packIn, { opacity: 1, filter: `blur(${f.blur}px)` }, NOW);
    cardNodes.forEach((c, i) => { if (c) animate(c, { ...shut(i), opacity: 0 }, NOW); });

    const r = begin((quiet) => {
      /* Finished: the pack parked, its top gone, the five in the row and the first in the spotlight, the head landed. */
      animate(pack, { x: 0, y: 0, scale: 1 }, NOW);
      animate(packIn, { opacity: 1, filter: 'none' }, NOW);
      animate(top, { opacity: 0 }, NOW);
      cardNodes.forEach((c) => { if (c) animate(c, { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 }, NOW); });
      setFront(true); setHeadIn(true);
      if (!quiet && spotAt.current < 0 && turnedAt.current === 0) putInSpot(0, true);
      setStage('ready');
    });
    play(r, async () => {
      const t = { x: heroAt.x, y: heroAt.y, scale: heroAt.scale };
      /* E1 is the dim, the layer's own (`backdrop`). E2: the pack rises from its slot to the middle, blurring in under Smooth. */
      await Promise.all([
        go(r, pack, t, landing(f, f.screen) as Beat),
        go(r, packIn, { filter: 'blur(0px)' }, eased(f, f.screen) as Beat),
      ]);
      /* E3: the crimped top rips away along the tear, up and to the side, and is gone for good. The cards wait inside. */
      cardNodes.forEach((c) => { if (c) animate(c, { opacity: 1 }, NOW); });
      await go(r, top, { x: [0, 40, 180], y: [0, -60, -340], rotate: [0, 18, 40], opacity: [1, 1, 0] }, { ...eased(f, f.enter * 1.5), times: [0, 0.4, 1] } as Beat);
      /* E4: the five backs rise out of the opening, fanning, the gold hit last; once clear of the pack they pass in front of it. */
      const d = stagger(f, count);
      await Promise.all(cardNodes.map((c, i) => go(r, c, fanned(i), landing(f, f.enter, (d[i] ?? 0) * 1.5) as Beat)));
      setFront(true);
      /* E5: the deal, from the fan into the row, as the emptied pack slides up and parks. E6: the head and the buttons land. */
      setHeadIn(true);
      const parked = go(r, pack, { x: 0, y: 0, scale: 1 }, landing(f, f.screen, (d[2] ?? 0) * 3) as Beat);
      /* On a phone the five are dealt into the pile (the stage's place, at the sheet's size, a little askew) and not into a row. */
      const dealt = cardNodes.map((c, i) => {
        const { target, transition } = split(deal(f, i, d, phoneNow ? pileAt(i) : undefined));
        return go(r, c, { ...target }, transition);
      });
      await Promise.all([parked, ...dealt]);
      /* E7: the first back lifts into the spotlight, waiting to be turned. */
      putInSpot(0);
      await wait(r, f.enter);
      setStage('ready');
    });
    // The entrance starts once, as the purchase's answer arrives (the reveal mounts with it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; for (const t of timers.current) clearTimeout(t); timers.current.clear(); };
  }, []);

  /* ---- the exit ---- */

  useEffect(() => {
    if (present) return;
    const f = feelNow.current;
    if (!f) { safeToRemove?.(); return; }
    finishRun(true);
    const r: Run = { cancelled: false, finish: () => {} };
    run.current = r;
    play(r, async () => {
      const vw = window.innerWidth;
      const link = handLink?.() ?? null;
      const linkRect = link?.getBoundingClientRect();
      /* Where the hand link is when the exit starts; none, or out of the window: toHand takes the window's edge toward it. */
      const to: Rect = linkRect && linkRect.width > 0 ? rect(linkRect) : { x: vw / 2, y: -1, width: 0, height: 0 };
      const d = stagger(f, count);
      const flights = Array.from({ length: count }, (_, i) => {
        const el = cardNode(i);
        const box_ = el?.getBoundingClientRect();
        if (!el || !box_ || box_.width === 0) return Promise.resolve();
        const { target, transition } = split(toHand(f, rect(box_), to, (d[i] ?? 0) * 2));
        return go(r, el, target, transition);
      });
      const pack = node('.kb-opening-pack');
      const packBottom = pack?.getBoundingClientRect().bottom ?? 0;
      /* The words, the buttons, the tag and the sparks fade; the parked pack slides on up out of view and is never faded where it stands. */
      const fades = Array.from(box.current?.querySelectorAll<HTMLElement>('.kb-opening-title, .kb-opening-count, .kb-opening-actions, .kb-opening-hint, .kb-opening-glow, .kb-opening-spark, .kb-opening-tag-drop') ?? [])
        .map((el) => go(r, el, { opacity: 0 }, eased(f, f.exit) as Beat));
      const away = go(r, pack, { y: -(packBottom + 24) }, eased(f, f.exit) as Beat);
      await Promise.all([away, ...fades, ...flights]);
      /* The link pulses once as the cards land, and the dim lifts. */
      if (link) animate(link, split(pulse(f)).target as never, split(pulse(f)).transition as never);
      const layer = overlay.current;
      if (layer) await new Promise<void>((resolve) => { void animate(layer, { opacity: 0 }, eased(f, f.exit) as never).then(() => resolve(), () => resolve()); });
      safeToRemove?.();
    });
    // Once, as the exit starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  /* ---- what a screen reader is told, focus, keys and the pile ---- */

  /* What a screen reader is told as a card turns (when the turn starts), and the whole pack once all are turned. */
  const said = turned === 0
    ? ''
    : all && turned > 1
      ? `All ${countWord(count)} are turned: ${cards.map((c) => c.name).join(', ')}. All ${countWord(count)} are in your hand.`
      : `Card ${turned} of ${count}: ${saidOf(cards[turned - 1]!)}.`;

  /* The control that had focus may be replaced by the turn (the next card becomes a face; Turn all goes): focus stays in the dialog. */
  useEffect(() => {
    const dialog = box.current;
    const at = document.activeElement;
    if (dialog && (!at || at === document.body || !dialog.contains(at))) primary.current?.focus();
  }, [turned, spot, box]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    /* A held Space repeats; only the first press turns a card. */
    if (e.key !== ' ' || e.repeat || e.defaultPrevented) return;
    /* On a button the browser's own click follows a Space; anywhere else Space turns the next card. */
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    turnNext();
  };

  /* On a phone the pile is the control: a tap on it, or a swipe across it, turns the next card (a drag short of a third of the card's width springs back). */
  const drag = useRef<number | null>(null);
  const onPileDown = (e: ReactPointerEvent) => { drag.current = e.clientX; };
  const onPileMove = (e: ReactPointerEvent) => {
    const from = drag.current;
    const top = spotAt.current >= 0 && flipped.current.has(spotAt.current) ? cardNode(spotAt.current) : null;
    if (from === null || !top || !feel || !isPhone()) return;
    const dx = e.clientX - from;
    animate(top, { x: dx, rotate: dx / 20 }, NOW);
  };
  const onPileUp = (e: ReactPointerEvent) => {
    const from = drag.current;
    drag.current = null;
    if (from === null || all || !isPhone()) return;
    const moved = e.clientX - from;
    const width = box.current?.querySelector('.kb-opening-spot')?.getBoundingClientRect().width || 276;
    if (Math.abs(moved) < 10 || Math.abs(moved) >= width / 3) {
      turnNext(moved > 0 ? 1 : -1);
      return;
    }
    const top = spotAt.current >= 0 ? cardNode(spotAt.current) : null;
    if (top && feel) animate(top, { x: 0, rotate: 0 }, landing(feel, feel.enter) as never);
  };

  /* ---- what is drawn ---- */

  const backOf = (i: number, size: 'fan' | 'sheet') => <PostcardBack size={size} hit={i === count - 1} {...(mark ? { mark } : {})} />;
  const faceUp = (c: CardFace, size: 'fan' | 'sheet') => <Postcard face={c} size={size} />;

  /** Under a feel: one element per pull, which stands in its row slot or in the spotlight, moved between them by a shared layout. */
  const cardBox = (i: number, size: 'fan' | 'sheet') => {
    if (!feel) return null;
    const c = cards[i]!;
    const faceShown = i < turned;
    const inner = (
      <motion.div
        className="kb-opening-flip" data-kb-turned={faceShown ? '' : undefined} style={{ transformStyle: 'preserve-3d' }}
        initial={{ rotateY: flipped.current.has(i) ? 180 : 0 }}
      >
        <span className="kb-opening-side kb-opening-side-back">{backOf(i, size)}</span>
        {faceShown && <span className="kb-opening-side kb-opening-side-face"><Postcard as="article" face={c} size={size} aria-label={saidOf(c)} /></span>}
      </motion.div>
    );
    return (
      <motion.div
        key={`${c.key}-${i}`} className="kb-opening-cardbox" data-kb-pull={i} data-kb-size={size}
        {...(phone ? {} : { layoutId: `${id}-${i}`, ...lift(feel) })}
        {...(stage === 'entering' && size === 'fan' ? { initial: { opacity: 0 } } : {})}
      >
        {i === turned
          ? <button type="button" className="kb-opening-turn" aria-label={`Turn card ${i + 1}`} onClick={() => turnNext()}>{inner}</button>
          : inner}
      </motion.div>
    );
  };

  const item = (n: number): MotionProps => {
    const p = staggerItem(feel, delays, n);
    return feel ? { ...p, animate: headIn ? p.animate : p.initial } : p;
  };
  const { exit: _dimExit, ...dim } = lifted.root as Values;

  /* The hit's ring goes gold over `screen` (opening.css transitions the card's shadow by these); under Off they are not set and it switches at once. */
  const ringStyle = (feel ? { '--kb-opening-screen': `${feel.screen}ms`, '--kb-opening-ease': feel.ease } : undefined) as CSSProperties | undefined;
  const packStyle = { '--kb-pack-w': 'var(--kb-parked-w)' } as CSSProperties;

  return createPortal(
    <motion.div ref={overlay} className="kb-opening-layer" {...dim}>
      <motion.div
        ref={box} className="kb-opening" role="dialog" aria-modal="true" aria-label={`Opening ${withArticle(name)}`} tabIndex={-1}
        style={ringStyle}
        data-kb-hit={hitShown ? '' : undefined} data-kb-stage={feel ? stage : undefined} data-kb-stack={feel ? (front ? 'front' : 'behind') : undefined} onKeyDown={onKeyDown}
      >
        {feel === null ? (
          <PackArt className="kb-opening-parked" part="opened" width={180} name={name} count={count} {...(art ? { art } : {})} />
        ) : (
          <motion.div className="kb-opening-pack" aria-hidden="true">
            <motion.div className="kb-opening-pack-in" initial={{ opacity: 0 }}>
              <PackArt className="kb-opening-pack-body" part="opened" name={name} count={count} style={packStyle} {...(art ? { art } : {})} />
              <motion.div className="kb-opening-pack-top" style={{ transformOrigin: '0% 100%' }}>
                <PackArt part="top" name={name} count={count} style={packStyle} {...(art ? { art } : {})} />
              </motion.div>
            </motion.div>
          </motion.div>
        )}
        <div className="kb-opening-head">
          <motion.h2 className="kb-opening-title" {...item(0)}>{name}</motion.h2>
          {/* The one live region: the count and the card said as it turns, in one place, so a turn is heard once. It takes no box of its own. */}
          <div className="kb-opening-live" aria-live="polite" aria-atomic="true">
            <motion.p className="kb-opening-count" {...item(1)}>
              {all ? `${count} of ${count} · all in your hand` : `${turned} of ${count} turned over`}
            </motion.p>
            <span className="kb-visually-hidden">{said}</span>
          </div>
          <ol className="kb-opening-outlines" aria-hidden="true">
            {cards.map((c, i) => <li key={`${c.key}-${i}`} data-kb-turned={i < turned ? '' : undefined} data-kb-hit={i === count - 1 ? '' : undefined} />)}
          </ol>
        </div>

        <div className="kb-opening-stage" onPointerDown={onPileDown} onPointerMove={onPileMove} onPointerUp={onPileUp}>
          {hitShown && (feel ? (
            <>
              <motion.span className="kb-opening-glow" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: eased(feel, feel.screen) }} />
              {SPARKS.map(([x, y, s], i) => (
                <motion.span
                  key={i} className="kb-opening-spark" aria-hidden="true" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s }}
                  initial={{ opacity: 0, scale: 0, rotate: 0 }}
                  animate={{ opacity: 1, scale: [0, 1.4, 1], rotate: 90, transition: { ...eased(feel, feel.enter, (stagger(feel, SPARKS.length)[i] ?? 0)), times: [0, 0.5, 1] } }}
                />
              ))}
              <motion.div className="kb-opening-tag-drop" initial={{ opacity: 0, y: -feel.distance }} animate={{ opacity: 1, y: 0, transition: landing(feel, feel.enter) }}>
                <p className="kb-opening-tag"><b>{shown ? (shown.unknown ? shown.name : `${rarityName(shown.rarity)} · ${shown.name}`) : ''}</b></p>
              </motion.div>
            </>
          ) : (
            <>
              <span className="kb-opening-glow" aria-hidden="true" />
              {SPARKS.map(([x, y, s], i) => <span key={i} className="kb-opening-spark" aria-hidden="true" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s }} />)}
              <p className="kb-opening-tag"><b>{shown ? (shown.unknown ? shown.name : `${rarityName(shown.rarity)} · ${shown.name}`) : ''}</b></p>
            </>
          ))}
          <div className="kb-opening-spot" data-kb-hit={hitShown ? '' : undefined}>
            <span className="kb-opening-next" aria-hidden="true">{turned < count && turned > 0 ? backOf(turned, 'sheet') : null}</span>
            {feel === null
              ? (turned > 0 && shown
                ? <Postcard as="article" face={shown} size="sheet" aria-label={saidOf(shown)} />
                : <PostcardBack size="sheet" hit={count === 1} {...(mark ? { mark } : {})} aria-hidden="true" />)
              : spot >= 0 && cardBox(spot, 'sheet')}
          </div>
        </div>

        <ol className="kb-opening-row" aria-label="The pack, in the order it was pulled">
          {cards.map((c, i) => {
            const hit = i === count - 1;
            if (feel) {
              const label = i < turned ? `Card ${i + 1}: ${saidOf(c)}${i === shownIndex ? ', the card shown' : ''}` : `Card ${i + 1}, face down${hit ? ', the hit' : ''}`;
              const lone = i === turned && spot !== i;
              return (
                <li
                  key={`${c.key}-${i}`} className="kb-opening-card" data-kb-slot="" data-kb-hit={hit ? '' : undefined} data-kb-now={i < turned && i === shownIndex ? '' : undefined}
                  aria-label={lone ? undefined : label}
                  {...(phone && stage === 'entering' ? { style: { zIndex: count - i } } : {})}
                >
                  {spot !== i && cardBox(i, 'fan')}
                </li>
              );
            }
            if (i < turned) {
              return (
                <li key={`${c.key}-${i}`} className="kb-opening-card" data-kb-turned="" data-kb-hit={hit ? '' : undefined} data-kb-now={i === shownIndex ? '' : undefined} aria-label={`Card ${i + 1}: ${saidOf(c)}${i === shownIndex ? ', the card shown' : ''}`}>
                  {faceUp(c, 'fan')}
                </li>
              );
            }
            const label = `Card ${i + 1}, face down${hit ? ', the hit' : ''}`;
            return (
              <li key={`${c.key}-${i}`} className="kb-opening-card" data-kb-hit={hit ? '' : undefined} aria-label={i === turned ? undefined : label}>
                {i === turned
                  ? <button type="button" className="kb-opening-turn" aria-label={`Turn card ${i + 1}`} onClick={() => turnNext()}>{backOf(i, 'fan')}</button>
                  : backOf(i, 'fan')}
              </li>
            );
          })}
        </ol>

        <motion.div className="kb-opening-actions" {...item(2)}>
          <GlassButton ref={primary} kind="primary" className="kb-opening-gold" onClick={all ? onClose : () => turnNext()}>{all ? 'Done' : 'Turn the next card'}</GlassButton>
          {!all && <GlassButton onClick={turnAll}>Turn all</GlassButton>}
          <GlassButton onClick={onClose}>
            <span className="kb-opening-key" aria-hidden="true" data-kb-key="ESC" />
            {all ? 'Back to the machine' : 'Close'}
          </GlassButton>
        </motion.div>
        <motion.p className="kb-opening-hint" {...item(3)}>
          {/* The words for a pointer and a keyboard, and the words for a finger: the layout shows one and the other is not on the page (display: none), so a phone is never told to press Space. */}
          {all ? (
            <>These {countWord(count)} are already in your hand.{note ? ` ${note}` : ''}</>
          ) : (
            <>
              <span className="kb-opening-hint-pointer">Click the next card or press Space to turn it. All {countWord(count)} are already in your hand.</span>
              <span className="kb-opening-hint-touch">Tap the card, or swipe it away, to turn the next one. All {countWord(count)} are already in your hand.</span>
            </>
          )}
        </motion.p>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
