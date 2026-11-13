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
 * read: it stands up, larger and above the rest, and the others turn and drop the further they stand from it
 * (`swipePose`). The row snaps a card to the middle when a swipe ends, and every card can come to it, the first and the
 * last included. The pose follows the scroll continuously, written as custom properties on the cards within the row's
 * width and two steps beyond it, at most once a frame (`Hand`'s `pose`); a card that leaves that range gets the edge pose
 * once, so the cost of a scroll does not grow with the hand. A pointer press on a card that is not in the middle
 * brings it there and does nothing else; a press on the middle card, and any click with no pointer (a keyboard or a
 * reader, whose focus has already brought the card there), is the caller's to answer, as on the Main board. Every
 * card's rules in plain words (`CardUi.describe`) are its button's description, and the one in the middle is also
 * written, in a sentence (`CardUi.summary`), in the sheet's line. Left and Right focus the neighbor, Home and End the
 * ends, none wrapping; Tab is the dialog's (Hud.tsx). The HUD keeps the Hand mounted while its drawer is hidden, where nothing has a
 * layout, so the row is measured, the opening card (`opening`, the armed one, else the first) put in the middle at once and the pose
 * written each time `open` becomes true, in a layout effect of the commit that takes `hidden` off; while it is closed nothing is measured.
 *
 * A card is a button, and pressing it is the caller's to answer (engine/ui/cards/play.tsx): `armed` is
 * the key of the card that waits to be played, and `onPick` is what pressing a card does. An armed
 * card's name ends ", armed: pick a post", and it carries that as a floating tag and pulses; the sheet's line then says, for Whoops!,
 * "Whoops! is armed. Every post it can land on now shows a dashed + mark beside its date, named Play Whoops! on that post.
 * Press it to play Whoops! there". With neither, pressing a card shows its rules
 * in the sheet's line.
 */
import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { HeldCard } from '../data/api.ts';
import { useBoard } from '../glass/useBoard.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Postcard, cardLabel } from './Postcard.tsx';
import type { CardFace } from './faces.ts';
import { CalmRegion } from '../glass/Calm.tsx';
import { SWIPE_STEP, arcSlots, handOrder, swipeMiddle, swipePose } from './arc.ts';

/** An armed card's tag, and the end of its name: while it is being played they say where. */
const tagOf = (playing: { readonly seq: number } | null): string => (playing ? `Playing · post #${playing.seq}` : 'Armed · pick a post');
const nameEnd = (playing: { readonly seq: number } | null): string => (playing ? `, playing on post ${playing.seq}` : ', armed: pick a post');

/** Write a card's pose on its element: the row's CSS draws it with the individual transform properties (frame.css). */
function writePose(li: HTMLElement, d: number): void {
  const { y, deg, scale } = swipePose(d);
  li.style.setProperty('--kb-swipe-y', `${y}px`);
  li.style.setProperty('--kb-swipe-turn', `${deg}deg`);
  li.style.setProperty('--kb-swipe-scale', String(scale));
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

export interface HandProps {
  readonly held: readonly HeldCard[];
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

export function Hand({ held, faces, armed = null, playing = null, onPick, onClose, vendingHref, instant = false, opening = null, open = true }: HandProps) {
  const idBase = useId();
  /* The Main board's layout stands full-size cards on the arc; the Phone board's sheet holds smaller ones in a row. */
  const { board } = useBoard();
  const main = board === 'main';
  const arc = handOrder(held, faces);
  const slots = arcSlots(arc.map((c) => c.group));
  const shown = arc.length;
  /* Rows further back stand lower; within a row a card is above the one to its left. */
  const byDepth = arc.map((c, i) => ({ key: c.face.key, i })).sort((p, q) => slots[q.i]!.row - slots[p.i]!.row || p.i - q.i);
  const stack = new Map(byDepth.map(({ key }, z) => [key, z + 1] as const));
  const count = held.reduce((n, h) => n + h.held, 0);
  const [viewed, setViewed] = useState<string | null>(null);
  /* The Phone board's middle card, by key: the one the row's scroll puts nearest its middle (`pose`). */
  const [middle, setMiddle] = useState<string | null>(opening);
  const list = useRef<HTMLUListElement>(null);
  const middleAt = Math.max(0, arc.findIndex((c) => c.face.key === middle));
  const middleKey = arc[middleAt]?.face.key;
  const inView = faces.find((f) => f.key === (main ? armed ?? viewed ?? arc[0]?.face.key : middleKey));

  /* The phone's pose. `centers` is each card's center in the row's own coordinates, measured when the sheet opens, on resize and when
     the cards change while it is open (never from a transformed box, and never while it is hidden, where every box is 0); `posed` is the range of cards that has a live pose. */
  const centers = useRef<readonly number[]>([]);
  const posed = useRef<{ lo: number; hi: number } | null>(null);
  const frame = useRef(0);
  /* The key of the card that was the middle when the pointer press began, for the click that ends it. */
  const pressedMiddle = useRef<string | null>(null);
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
    const key = lis[near]?.dataset.kbCard ?? null;
    setMiddle((was) => (was === key ? was : key));
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
    ul.scrollTo({ left: li.offsetLeft + li.offsetWidth / 2 - ul.clientWidth / 2, behavior: now || instant ? 'instant' : 'smooth' });
  };
  const cardsSignature = arc.map((c) => c.face.key).join('|');
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
    const key = opening && arc.some((c) => c.face.key === opening) ? opening : arc[0]!.face.key;
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

  /* The keys: arrows and Home/End move along the cards and stop at the ends. On the Main board Tab and Shift+Tab wrap at the ends;
     on the phone they are the dialog's own. */
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
        <ul className="kb-hand-cards" ref={list} onKeyDown={onKeys} onScroll={main ? undefined : queue}>
          {arc.map(({ face, held: n, group }, i) => {
            const slot = slots[i]!;
            const isArmed = armed === face.key;
            const says = `${idBase}-${face.key}`;
            const isMiddle = !main && i === middleAt;
            const style = (main
              ? { '--kb-fan-x': `${slot.x}px`, '--kb-fan-y': `${slot.y}px`, '--kb-fan-turn': `${slot.deg}deg`, '--kb-fan-z': stack.get(face.key) }
              /* The middle card above every other, the rest lower the further they stand from it. */
              : { '--kb-fan-z': isMiddle ? arc.length + 1 : arc.length - Math.abs(i - middleAt) }) as CSSProperties;
            return (
              <li
                key={face.key}
                className="kb-hand-card"
                data-kb-card={face.key}
                data-kb-row={main ? slot.row : undefined}
                data-kb-group-start={!main && i > 0 && group !== arc[i - 1]!.group ? '' : undefined}
                data-kb-middle={isMiddle ? '' : undefined}
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
                    /* On the phone a pointer press on a side card only brings it to the middle, judged by what stood in the middle when the press began (its focus moves the row before the click); a keyboard's or a reader's click (no pointer) acts. */
                    if (!main && e.detail !== 0) {
                      const was = pressedMiddle.current ?? middleKey;
                      pressedMiddle.current = null;
                      if (was !== face.key) { center(face.key); return; }
                    }
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
      {inView && shown > 0 && (
        <CalmRegion as="p" className="kb-hand-says">
          {armed === inView.key
            ? <>{inView.name} is armed. Every post it can land on now shows a dashed <b>+ mark</b> beside its date, named Play {inView.name} on that post. Press it to play {inView.name} there.</>
            : <><b>{inView.name}.</b> {inView.summary}</>}
        </CalmRegion>
      )}
      <CalmRegion className="kb-hand-vending"><ButtonRow align="center"><GlassButton to={vendingHref}>Vending Machine</GlassButton></ButtonRow></CalmRegion>
    </>
  );
}
