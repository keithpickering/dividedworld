/**
 * What is in the hand's drawer (the HUD opens it; engine/ui/frame/Hud.tsx): the player's cards as
 * postcards, each a button by its name ("Stick Around, Sweet postcard"), and, on the Phone board's
 * sheet, the heading with the count, the line that says what the card in view does, and the
 * Vending Machine link. The Main board's layout shows only the cards, on the arc that rises through
 * the HUD's seam (engine/ui/cards/arc.ts says where each one stands; the hand-arc design, section 2);
 * the sheet's other parts are hidden there by its stylesheet, not left out, so one drawer serves
 * both layouts.
 *
 * On the Main board one card stands for each kind held, however many copies, in the order `handOrder`
 * gives (grouped by how a card is played). A kind held more than once says how many ("Whoops!, Salty
 * postcard, 5 in hand", and a x5 on the card). Rows further back stand lower in the stack and, within a
 * row, a card overlaps the one to its left. The card under the pointer or the focus, and the armed
 * one, stands upright and rises above the rest (frame.css), so any card can be read. The keys are the
 * list's: Left and Right move focus along the cards and stop at the ends, Home and End go to the
 * first and the last, and Tab and Shift+Tab wrap at the ends, so the cards are one place to stand in
 * and Esc, or the hand button, is the way out.
 *
 * The Phone board's sheet draws the same cards, one for each kind held in the same order, on one row that the player
 * swipes sideways, a card standing 66px from the next (`SWIPE_STEP`) so each overlaps its neighbor, half a step more
 * where a group changes (`data-kb-group-start`). The card nearest the row's middle (`data-kb-middle`) is the one being
 * read: it stands up, larger and above the rest, and the others turn and drop the further they stand from it and stand pushed
 * out from it, so that as the middle passes from a card to its neighbor the two are apart when they change which is above
 * (`swipePose`). A card left of the middle says so (`data-kb-side="left"`, and "right" on the other side), because the
 * next card covers its right edge: its count stands at its left there, and at the right on every other card (frame.css).
 * The row brings the nearest card to the middle once a swipe comes to rest (`settle`), and every card can come to it, the first and the
 * last included. The pose follows the scroll continuously: where the browser has view timelines, each card's pose is an animation
 * on one, drawn from the scroll on the frame the scroll is drawn (`animatePoses`); elsewhere it is written as custom properties on
 * the cards within the row's width and two steps beyond it, at most once a frame (`Hand`'s `pose`), and a card that leaves that
 * range gets the edge pose once, so the cost of a scroll does not grow with the hand. A pointer press on a card that is not in the middle
 * brings it there and does nothing else; a press on the middle card, and any click with no pointer (a keyboard or a
 * reader, whose focus has already brought the card there), is the caller's to answer, as on the Main board. Every
 * card's rules in plain words (`CardUi.describe`) are its button's description, and the one in the middle is also
 * written, in a sentence (`CardUi.summary`), in the sheet's line. Left and Right focus the neighbor, Home and End the
 * ends, none wrapping; Tab is the dialog's (Hud.tsx). The HUD keeps the Hand mounted while its drawer is hidden, where nothing has a
 * layout, so the row is measured, the opening card (`opening`, the armed one, else the first) put in the middle at once and the pose
 * written each time `open` becomes true, in a layout effect of the commit that takes `hidden` off; while it is closed nothing is measured.
 *
 * A pack the account holds and has not opened (`api.sealedPacks`; the starter pack design, sections 6 and 7) stands first, before every
 * card group, as a button with the pack's art at a card's size, named "Starter Pack, sealed: open it". It is a place like a card's: on the arc
 * (`placesOf`), in the phone's row where it can reach the middle, and in the list's keys; it cannot be armed and the sheet's count leaves it out.
 * Pressing it opens it (`api.openPack`) and then the reveal (engine/ui/vending/PackOpening.tsx) over the hand, with a fixed pack's no hit; when
 * the reveal closes the hand's cards and packs are read again and focus goes to the first place. A refusal says its words in the sheet's line,
 * on either board, and leaves the pack where it was.
 *
 * A card is a button, and pressing it is the caller's to answer (engine/ui/cards/play.tsx): `armed` is
 * the key of the card that waits to be played, and `onPick` is what pressing a card does. An armed
 * card's name ends ", armed: pick a post", and it carries that as a floating tag and pulses; the sheet's line then says, for Whoops!,
 * "Whoops! is armed. Every post it can land on now shows a dashed + mark beside its date, named Play Whoops! on that post.
 * Press it to play Whoops! there". With neither, pressing a card shows its rules
 * in the sheet's line.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { HeldCard, SealedPack } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import { packHit } from '../../rules/packs.ts';
import { PackArt } from '../vending/PackArt.tsx';
import { PackOpening } from '../vending/PackOpening.tsx';
import { packSize } from '../vending/machine-words.ts';
import { Layers } from '../glass/layer.tsx';
import { useBoard } from '../glass/useBoard.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Postcard, cardLabel } from './Postcard.tsx';
import { plainRefusal, type CardFace } from './faces.ts';
import { useSealedPacks } from './sealed.ts';
import { CalmRegion } from '../glass/Calm.tsx';
import { SWIPE_REACH, SWIPE_STEP, arcSlots, handOrder, placesOf, swipeKeyframes, swipeMiddle, swipePose } from './arc.ts';

/** An armed card's tag, and the end of its name: while it is being played they say where. */
const tagOf = (playing: { readonly seq: number } | null): string => (playing ? `Playing · post #${playing.seq}` : 'Armed · pick a post');
const nameEnd = (playing: { readonly seq: number } | null): string => (playing ? `, playing on post ${playing.seq}` : ', armed: pick a post');

/** Write a card's pose on its element: the row's CSS draws it with the individual transform properties (frame.css). */
function writePose(li: HTMLElement, d: number): void {
  const { x, y, deg, scale } = swipePose(d);
  li.style.setProperty('--kb-swipe-x', `${x}px`);
  li.style.setProperty('--kb-swipe-y', `${y}px`);
  li.style.setProperty('--kb-swipe-turn', `${deg}deg`);
  li.style.setProperty('--kb-swipe-scale', String(scale));
}

/** How long a scroll stands still, with no finger on the row, before the row settles on a card, where the browser does not say when a scroll ends (`scrollend`). */
const SETTLE_AFTER = 120;

/** The keyframes of the swipe pose, the same for every card and every row. */
let keyframes: ReturnType<typeof swipeKeyframes> | null = null;

/**
 * Pose each card with an animation on a view timeline of the row, where the browser has them: the browser then draws the pose from
 * the scroll on the frame the scroll is drawn, however fast the row moves, where a pose written from the scroll event lags the
 * row by a frame or more and a fast swipe outruns it. The timeline is the card's passage across the row's middle, from SWIPE_REACH
 * steps right of it to as far left, at any width of the row: its inset is the rest of the row on each side. Returns the animations,
 * or null where the browser has no view timeline or refuses this one, and the pose is then written as the row scrolls (`writePose`).
 */
function animatePoses(lis: readonly HTMLElement[]): Animation[] | null {
  const Timeline = (globalThis as { ViewTimeline?: new (o: { subject: Element; axis: string; inset: string }) => AnimationTimeline }).ViewTimeline;
  if (typeof Timeline !== 'function' || lis.some((li) => typeof li.animate !== 'function')) return null;
  const made: Animation[] = [];
  try {
    for (const li of lis) {
      const timeline = new Timeline({ subject: li, axis: 'inline', inset: `calc(50% - ${SWIPE_REACH * SWIPE_STEP - li.offsetWidth / 2}px)` });
      made.push(li.animate((keyframes ??= swipeKeyframes()), { timeline, fill: 'both' }));
    }
  } catch {
    for (const a of made) a.cancel();
    return null;
  }
  return made;
}

/** The first index in the ascending `xs` that is at least `x`. */
function firstAtLeast(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A card the instance no longer has, as the reveal shows it: its name alone, claiming no rarity or alignment. */
const unknownFace = (key: string, like: CardFace | undefined): CardFace => ({
  key, name: 'A card this machine no longer has', alignment: 'sweet', tag: '', extra: 0, stack: 1, tagline: '', summary: '', describe: '',
  art: like?.art ?? { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)' }, rarity: 'common', play: like?.play ?? 'set', kind: '', unknown: true,
});

/** A sealed pack's place is keyed apart from every card's. */
const packKey = (p: SealedPack): string => `pack:${p.pack}`;

/** A sealed pack that is being opened: the pack, the cards its answer gave in pull order, and the button it was pressed on, which the reveal rises from. */
interface Opened { readonly pack: SealedPack; readonly contents: readonly string[] }

export interface HandProps {
  readonly held: readonly HeldCard[];
  /** The sealed packs to draw; with none given the hand reads them itself and reads them again whenever `held` changes. */
  readonly sealed?: readonly SealedPack[];
  /** The caller's reads of the player's rows again, once a pack's reveal closes (the hand's cards, the HUD's count of packs). */
  readonly onOpened?: () => Promise<unknown>;
  /** The HUD's hand button, which the opened cards fly to. */
  readonly handLink?: () => HTMLElement | null;
  readonly faces: readonly CardFace[];
  /** The key of the card that is armed, if any. */
  readonly armed?: string | null;
  /** The post the armed card is being played on, while a compose is open on one: its tag and its name say so in place of "pick a post". */
  readonly playing?: { readonly seq: number } | null;
  /** What pressing a card does; with none, it shows the card's rules. */
  readonly onPick?: (face: CardFace) => void;
  readonly onClose: () => void;
  /** Where the Vending Machine is. */
  readonly vendingHref: string;
  /** On the Phone board: true under Off, where bringing a card to the middle is at once. */
  readonly instant?: boolean;
  /** On the Phone board: the key of the card to stand in the middle when the sheet opens (the armed one); none is the first card. Read at the moment `open` becomes true. */
  readonly opening?: string | null;
  /** Whether the sheet is shown. The HUD keeps the Hand mounted while its drawer is hidden, where nothing has a layout, so the phone measures, centers and poses when this becomes true. A Hand rendered alone is open. */
  readonly open?: boolean;
}

export function Hand({ held, sealed: given, onOpened, handLink, faces, armed = null, playing = null, onPick, onClose, vendingHref, instant = false, opening = null, open = true }: HandProps) {
  const idBase = useId();
  /* The Main board's layout stands full-size cards on the arc; the Phone board's sheet holds smaller ones in a row. */
  const { board } = useBoard();
  const main = board === 'main';
  const { api, instance, ui } = useKayfa();
  const own = useSealedPacks(given === undefined, held);
  const sealed = given ?? own.sealed;
  const arc = handOrder(held, faces);
  /* The places in order: each sealed pack, then each card's kind. */
  const np = sealed.length;
  const groups = placesOf(np, arc.map((c) => c.group));
  const order = [...sealed.map(packKey), ...arc.map((c) => c.face.key)];
  const slots = arcSlots(groups);
  const shown = order.length;
  /* Rows further back stand lower; within a row a card is above the one to its left. */
  const byDepth = order.map((key, i) => ({ key, i })).sort((p, q) => slots[q.i]!.row - slots[p.i]!.row || p.i - q.i);
  const stack = new Map(byDepth.map(({ key }, z) => [key, z + 1] as const));
  const count = held.reduce((n, h) => n + h.held, 0);
  const [viewed, setViewed] = useState<string | null>(null);
  /* A pack that was opened and whose reveal is showing; the refusal an open met, in plain words, until the next press; the pressed button. */
  const [opened, setOpened] = useState<Opened | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const pressed = useRef<HTMLElement | null>(null);
  /* A refusal is not kept past the sheet: it goes when the sheet closes. */
  useEffect(() => { if (!open) setRefusal(null); }, [open]);
  const opening$ = useRef(false);
  /* The Phone board's middle card, by key: the one the row's scroll puts nearest its middle (`pose`). */
  const [middle, setMiddle] = useState<string | null>(opening);
  const list = useRef<HTMLUListElement>(null);
  const middleAt = Math.max(0, order.indexOf(middle ?? ''));
  const middleKey = order[middleAt];
  const inView = faces.find((f) => f.key === (main ? armed ?? viewed ?? arc[0]?.face.key : middleKey));
  /* The pack in the middle of the phone's row, whose words the sheet's line says in a card's place. */
  const packInView = main ? undefined : sealed.find((p) => packKey(p) === middleKey);
  const lookOf = (p: SealedPack) => ui.packs?.[p.kind];
  const nameOf = (p: SealedPack) => lookOf(p)?.name ?? p.kind;
  const rulesOf = (p: SealedPack) => instance.packs.find((r) => r.key === p.kind);

  /* The phone's pose. `centers` is each card's center in the row's own coordinates, measured when the sheet opens, on resize and when
     the cards change while it is open (never from a transformed box, and never while it is hidden, where every box is 0); `posed` is the range of cards that has a live pose. */
  const centers = useRef<readonly number[]>([]);
  const posed = useRef<{ lo: number; hi: number } | null>(null);
  const frame = useRef(0);
  /* The key of the card that was the middle when the pointer press began, for the click that ends it. */
  const pressedMiddle = useRef<string | null>(null);
  /* The cards' pose animations, where the browser draws the pose from a view timeline (`animatePoses`); null while the pose is written as the row scrolls. */
  const animated = useRef<Animation[] | null>(null);
  /* Whether a finger is on the row, so it is not settled under it; the timer that settles it once a scroll stands still; and the
     scrollLeft the row was last sent to (a card a tap or the focus brought, or the settle's own), which a settle keeps to until a touch or a wheel frees the row. */
  const touching = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aim = useRef<number | null>(null);
  /* The cards' elements, listed with the centers (`measure`), so a scroll frame does not query or build a list of the whole hand. */
  const items = useRef<readonly HTMLLIElement[]>([]);
  const cardsOf = () => [...(list.current?.querySelectorAll<HTMLLIElement>('li.kb-hand-card') ?? [])];
  const measure = useCallback(() => {
    items.current = cardsOf();
    centers.current = items.current.map((li) => li.offsetLeft + li.offsetWidth / 2);
  }, []);
  const pose = useCallback(() => {
    const ul = list.current;
    const xs = centers.current;
    if (!ul || xs.length === 0) return;
    const lis = items.current;
    const mid = ul.scrollLeft + ul.clientWidth / 2;
    const reach = 2 * SWIPE_STEP;
    /* The visible cards and two steps beyond, found by search, so a scroll costs the cards in view and not the hand. */
    const lo = firstAtLeast(xs, ul.scrollLeft - reach);
    const hi = firstAtLeast(xs, ul.scrollLeft + ul.clientWidth + reach + 1e-6) - 1;
    if (hi < lo) return;
    const near = lo + swipeMiddle(xs.slice(lo, hi + 1), mid);
    const key = lis[near]?.dataset.kbCard ?? null;
    setMiddle((was) => (was === key ? was : key));
    /* Where the browser draws the pose from the scroll, only the middle is the Hand's. */
    if (animated.current) return;
    for (let i = lo; i <= hi; i++) writePose(lis[i]!, (xs[i]! - mid) / SWIPE_STEP);
    /* A card that leaves the range gets the edge pose, once; the first pass gives it to everything outside. */
    const before = posed.current;
    const edge = (i: number) => { if (lis[i]) writePose(lis[i]!, i < lo ? -5 : 5); };
    if (!before) { for (let i = 0; i < lo; i++) edge(i); for (let i = hi + 1; i < lis.length; i++) edge(i); }
    else {
      /* The span from the old range to the new: a card in it outside the new range was in the old one or was jumped over. */
      const to = Math.max(before.hi, hi);
      for (let i = Math.min(before.lo, lo); i <= to; i++) if (i < lo || i > hi) edge(i);
    }
    posed.current = { lo, hi };
  }, []);
  /* At most once a frame, however many scroll events the frame brings. */
  const queue = () => {
    if (frame.current) return;
    const next = globalThis.requestAnimationFrame ?? ((f: FrameRequestCallback) => globalThis.setTimeout(f, 16) as unknown as number);
    frame.current = next(() => { frame.current = 0; pose(); });
  };
  /* Bring a card to the middle: instantly under Off or when asked, else eased. */
  const center = (key: string, now = false) => {
    const ul = list.current;
    const li = cardsOf().find((c) => c.dataset.kbCard === key);
    if (!ul || !li || typeof ul.scrollTo !== 'function') return;
    const left = li.offsetLeft + li.offsetWidth / 2 - ul.clientWidth / 2;
    const at = now || instant;
    /* An eased scroll is on its way there until it lands; an instant one is there already. */
    aim.current = at ? null : left;
    ul.scrollTo({ left, behavior: at ? 'instant' : 'smooth' });
  };
  /*
   * Bring the card nearest the middle there once a scroll has come to rest, eased (at once under Off), and nothing while a finger is on
   * the row. The row has no CSS snap: WebKit on iOS slows the swipe of any scroller with snap points to UIKit's fast deceleration, so
   * a hard flick carried a few cards, and the browsers' own snap is not needed for a row whose stops the Hand knows. A row on its way
   * to a card (`aim`) keeps to it: a scroll that ends short of it goes on there, and is not turned back to a nearer card.
   */
  const settle = () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    const ul = list.current;
    const xs = centers.current;
    if (touching.current || !ul || xs.length === 0 || typeof ul.scrollTo !== 'function') return;
    const mid = ul.scrollLeft + ul.clientWidth / 2;
    const left = aim.current ?? xs[swipeMiddle(xs, mid)]! - ul.clientWidth / 2;
    if (Math.abs(ul.scrollLeft - left) < 1) { aim.current = null; return; }
    aim.current = instant ? null : left;
    ul.scrollTo({ left, behavior: instant ? 'instant' : 'smooth' });
  };
  /* A scroll frame: the pose and the middle at the next frame, and the settle once the scroll has stood still for SETTLE_AFTER. */
  const onScroll = () => {
    queue();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = touching.current ? null : setTimeout(settle, SETTLE_AFTER);
  };
  /* A finger on the row, or a wheel, takes it from wherever it was going; lifting the finger lets it settle. */
  const free = () => { aim.current = null; };
  const onTouchStart = () => { touching.current = true; free(); if (settleTimer.current) clearTimeout(settleTimer.current); settleTimer.current = null; };
  const onTouchEnd = () => { touching.current = false; if (settleTimer.current) clearTimeout(settleTimer.current); settleTimer.current = setTimeout(settle, SETTLE_AFTER); };
  /* The handlers the row's listeners call, the latest render's (they read `instant`). */
  const settleNow = useRef(settle);
  settleNow.current = settle;
  const cardsSignature = order.join('|');
  /* Measure and pose when the cards change while the sheet is open (closed, it has no layout; the opening below does it). */
  useLayoutEffect(() => {
    if (main || !open || shown === 0) return;
    posed.current = null;
    measure();
    pose();
  }, [main, cardsSignature]);
  /* Each time the sheet opens, with the layout the same commit's removal of `hidden` gave it: measure, put the opening card (read now; none is the first card)
     in the middle at once, then pose. A change of the opening or of the cards while it stays open leaves the row where it is. */
  useLayoutEffect(() => {
    if (main || !open || shown === 0) return;
    posed.current = null;
    measure();
    const key = opening && order.includes(opening) ? opening : order[0]!;
    center(key, true);
    pose();
    // The opening and the cards are read at the open, not followed.
  }, [main, open]);
  /* The row is measured again when the window resizes while the sheet is open. */
  useLayoutEffect(() => {
    if (main || !open) return;
    const onResize = () => { measure(); posed.current = null; queue(); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (frame.current) (globalThis.cancelAnimationFrame ?? globalThis.clearTimeout)(frame.current);
      frame.current = 0;
    };
  }, [main, open]);

  /* The pose animations, made each time the sheet opens or its cards change while it is open, and ended when it closes or goes. */
  useLayoutEffect(() => {
    if (main || !open || shown === 0) return;
    const made = animatePoses(cardsOf());
    animated.current = made;
    if (made) for (const li of cardsOf()) for (const p of ['--kb-swipe-x', '--kb-swipe-y', '--kb-swipe-turn', '--kb-swipe-scale']) li.style.removeProperty(p);
    return () => {
      for (const a of made ?? []) a.cancel();
      animated.current = null;
    };
  }, [main, open, cardsSignature]);
  /* The browser's word that a scroll has ended, where it gives one, settles at once; and the settle's timer goes with the sheet. */
  useLayoutEffect(() => {
    const ul = list.current;
    if (main || !open || !ul) return;
    const onEnd = () => settleNow.current();
    ul.addEventListener('scrollend', onEnd);
    ul.addEventListener('wheel', free, { passive: true });
    return () => {
      ul.removeEventListener('scrollend', onEnd);
      ul.removeEventListener('wheel', free);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
      touching.current = false;
      aim.current = null;
    };
  }, [main, open, shown === 0]);

  /* The keys: arrows and Home/End move along the cards and stop at the ends. On the Main board Tab and Shift+Tab wrap at the ends;
     on the phone they are the dialog's own. */
  /* On the phone a pointer press on a side place only brings it to the middle, judged by what stood in the middle when the press began (its focus moves the row before the click); a keyboard's or a reader's click (no pointer) acts. True: the press was only that. */
  const onlyCenters = (e: { readonly detail: number }, key: string): boolean => {
    if (main || e.detail === 0) return false;
    const was = pressedMiddle.current ?? middleKey;
    pressedMiddle.current = null;
    if (was === key) return false;
    center(key);
    return true;
  };
  /* Open a sealed pack, then show its reveal. A refusal leaves it where it was and says why; a lost answer is read for, since the pack may be open. */
  const openIt = async (p: SealedPack, el: HTMLElement) => {
    if (opening$.current) return;
    opening$.current = true;
    pressed.current = el;
    try {
      const answer = await api.openPack(p.pack);
      if (!answer.ok) {
        /* Whatever the refusal, the rows are read again: a pack opened in another tab goes with its message. */
        setRefusal(plainRefusal(answer.error));
        await settleRows();
        return;
      }
      setRefusal(null);
      setOpened({ pack: p, contents: answer.value.contents });
    } catch {
      setRefusal('The pack could not be opened. Try again.');
    } finally {
      opening$.current = false;
    }
  };
  /* The rows read again after an opening: the caller's (the cards, the HUD's packs), and this hand's own packs where it reads them. */
  const settleRows = async () => {
    await onOpened?.();
    if (given === undefined) await own.reload();
  };
  /* The reveal closed: read the rows again, then focus the first place (the pack that held it is gone). */
  const closeReveal = () => {
    setOpened(null);
    void settleRows().then(() => setTimeout(() => list.current?.querySelector<HTMLElement>('li.kb-hand-card > button')?.focus({ preventScroll: true }), 0));
  };
  const onKeys = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('li.kb-hand-card > button') ?? [])];
    const from = (e.target as HTMLElement).closest('button');
    const at = from ? buttons.indexOf(from) : -1;
    if (at < 0) return;
    const to = e.key === 'ArrowRight' ? Math.min(at + 1, buttons.length - 1)
      : e.key === 'ArrowLeft' ? Math.max(at - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : main && e.key === 'Tab' && !e.shiftKey && at === buttons.length - 1 ? 0
      : main && e.key === 'Tab' && e.shiftKey && at === 0 ? buttons.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    /* On the phone `center()` scrolls the row; on the Main board the browser brings an off-screen card into view. */
    if (main) buttons[to]!.focus(); else buttons[to]!.focus({ preventScroll: true });
  };
  return (
    <>
      <div className="kb-hand-bar">
        <h2 className="kb-hand-head kb-glass-display">Hand <CalmRegion as="span" className="kb-hand-head-count kb-num">· {count}</CalmRegion></h2>
        <button type="button" className="kb-hand-close" aria-label="Close the hand" onClick={onClose}>
          <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3 L13 13 M13 3 L3 13" /></svg>
        </button>
      </div>
      {shown === 0 ? (
        <CalmRegion as="p" className="kb-hand-empty">No postcards in your hand. The Vending Machine sells them.</CalmRegion>
      ) : (
        <ul
          className="kb-hand-cards"
          ref={list}
          onKeyDown={onKeys}
          onScroll={main ? undefined : onScroll}
          onTouchStart={main ? undefined : onTouchStart}
          onTouchEnd={main ? undefined : onTouchEnd}
          onTouchCancel={main ? undefined : onTouchEnd}
        >
          {sealed.map((p, i) => {
            const key = packKey(p);
            const slot = slots[i]!;
            const says = `${idBase}-${key}`;
            const isMiddle = !main && i === middleAt;
            const name = nameOf(p);
            const rules = rulesOf(p);
            const style = main
              ? ({ '--kb-fan-x': `${slot.x}px`, '--kb-fan-y': `${slot.y}px`, '--kb-fan-turn': `${slot.deg}deg`, '--kb-fan-z': stack.get(key) } as CSSProperties)
              : ({ '--kb-fan-z': isMiddle ? order.length + 1 : order.length - Math.abs(i - middleAt) } as CSSProperties);
            const look = lookOf(p);
            return (
              <li
                key={key}
                className="kb-hand-card kb-hand-pack"
                data-kb-card={key}
                data-kb-pack=""
                data-kb-row={main ? slot.row : undefined}
                data-kb-group-start={!main && i > 0 && groups[i] !== groups[i - 1] ? '' : undefined}
                data-kb-middle={isMiddle ? '' : undefined}
                data-kb-side={main ? undefined : i < middleAt ? 'left' : i > middleAt ? 'right' : undefined}
                style={style}
              >
                <button
                  type="button"
                  className="kb-hand-pack-button"
                  aria-label={`${name}, sealed: open it`}
                  aria-describedby={says}
                  onFocus={main ? undefined : () => center(key)}
                  onPointerDown={main ? undefined : () => { pressedMiddle.current = middleKey ?? null; }}
                  onPointerCancel={main ? undefined : () => { pressedMiddle.current = null; }}
                  onClick={(e) => {
                    if (onlyCenters(e, key)) return;
                    void openIt(p, e.currentTarget);
                  }}
                >
                  <PackArt name={name} count={rules ? packSize(rules) : 0} {...(look?.art ? { art: look.art } : {})} width={main ? 150 : 104} />
                </button>
                <span id={says} className="kb-visually-hidden">A sealed {name}. Press it to open it{rules ? `: ${packSize(rules)} cards go into your hand` : ''}.</span>
              </li>
            );
          })}
          {arc.map(({ face, held: n }, i) => {
            const slot = slots[np + i]!;
            const at = np + i;
            const isArmed = armed === face.key;
            const says = `${idBase}-${face.key}`;
            const isMiddle = !main && at === middleAt;
            const style = main
              ? ({ '--kb-fan-x': `${slot.x}px`, '--kb-fan-y': `${slot.y}px`, '--kb-fan-turn': `${slot.deg}deg`, '--kb-fan-z': stack.get(face.key) } as CSSProperties)
              /* The middle card above every other, the rest lower the further they stand from it. */
              : ({ '--kb-fan-z': isMiddle ? order.length + 1 : order.length - Math.abs(at - middleAt) } as CSSProperties);
            return (
              <li
                key={face.key}
                className="kb-hand-card"
                data-kb-card={face.key}
                data-kb-row={main ? slot.row : undefined}
                data-kb-group-start={!main && at > 0 && groups[at] !== groups[at - 1] ? '' : undefined}
                data-kb-middle={isMiddle ? '' : undefined}
                data-kb-side={main ? undefined : at < middleAt ? 'left' : at > middleAt ? 'right' : undefined}
                data-armed={isArmed ? '' : undefined}
                style={style}
              >
                <Postcard
                  as="button"
                  type="button"
                  face={face}
                  size={main ? 'fan' : 'phone'}
                  armed={isArmed}
                  aria-label={`${cardLabel(face, main ? 'fan' : 'phone')}${n > 1 ? `, ${n} in hand` : ''}${isArmed ? nameEnd(playing) : ''}`}
                  aria-describedby={says}
                  aria-pressed={onPick ? isArmed : undefined}
                  onFocus={main ? undefined : () => center(face.key)}
                  onPointerDown={main ? undefined : () => { pressedMiddle.current = middleKey ?? null; }}
                  /* A canceled press (a swipe takes it) has no click of its own to clear this. A pointer leaving the card must not clear it: a touch pointer leaves when the finger lifts, before the tap's click. */
                  onPointerCancel={main ? undefined : () => { pressedMiddle.current = null; }}
                  onClick={(e) => {
                    if (onlyCenters(e, face.key)) return;
                    setRefusal(null);
                    setViewed(face.key);
                    onPick?.(face);
                  }}
                />
                {n > 1 && <span className="kb-hand-times kb-num" aria-hidden="true">×{n}</span>}
                {isArmed && <span className="kb-hand-armed kb-glass-skew-tag" aria-hidden="true"><span className="kb-glass-upright">{tagOf(playing)}</span></span>}
                <span id={says} className="kb-visually-hidden">{face.describe}</span>
              </li>
            );
          })}
        </ul>
      )}
      {shown > 0 && (refusal !== null || inView || packInView) && (
        <CalmRegion as="p" className="kb-hand-says" {...(refusal !== null ? { role: 'alert', 'data-kb-refusal': '' } : {})}>
          {refusal !== null
            ? refusal
            : packInView
              ? <><b>{nameOf(packInView)}.</b> Sealed. Press it to open it{rulesOf(packInView) ? `: its ${packSize(rulesOf(packInView)!)} cards go into your hand` : ''}.</>
              : inView && armed === inView.key
                ? <>{inView.name} is armed. Every post it can land on now shows a dashed <b>+ mark</b> beside its date, named Play {inView.name} on that post. Press it to play {inView.name} there.</>
                : inView ? <><b>{inView.name}.</b> {inView.summary}</> : null}
        </CalmRegion>
      )}
      <CalmRegion className="kb-hand-vending"><ButtonRow align="center"><GlassButton to={vendingHref}>Vending Machine</GlassButton></ButtonRow></CalmRegion>
      {opened && (
        /* The reveal is a layer of its own; the drawer's keys (the phone's Tab trap) are not its. */
        <div style={{ display: 'contents' }} onKeyDown={(e) => e.stopPropagation()}>
          <Layers>
            <PackOpening
              hit={((r) => (r ? packHit(r) : false))(rulesOf(opened.pack))}
              name={nameOf(opened.pack)}
              {...(lookOf(opened.pack)?.art ? { art: lookOf(opened.pack)!.art } : {})}
              note={null}
              cards={opened.contents.map((k) => faces.find((f) => f.key === k) ?? unknownFace(k, faces[0]))}
              riseFrom={() => pressed.current}
              {...(handLink ? { handLink } : {})}
              returnFocusTo={() => pressed.current}
              onClose={closeReveal}
            />
          </Layers>
        </div>
      )}
    </>
  );
}
