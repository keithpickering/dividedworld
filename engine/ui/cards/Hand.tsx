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
 * The Phone board's sheet draws a card once for each copy held, up to two copies of a kind; a kind
 * held more than twice is still two faces, the last of them saying how many are in the hand
 * ("Whoops!, Salty postcard, 5 in hand"), so a hand of any size is a sheet that fits. Every card's
 * rules in plain words (`CardUi.describe`) are its button's description, and the one in view is also
 * written, in a sentence (`CardUi.summary`), in the sheet's line.
 *
 * A card is a button, and pressing it is the caller's to answer (engine/ui/cards/play.tsx): `armed` is
 * the key of the card that waits to be played, and `onPick` is what pressing a card does. An armed
 * card's name ends ", armed: pick a post", and it carries that as a floating tag and pulses; the sheet's line then says, for Whoops!,
 * "Whoops! is armed. Every post it can land on now shows a dashed + mark beside its date, named Play Whoops! on that post.
 * Press it to play Whoops! there". With neither, pressing a card shows its rules
 * in the sheet's line.
 */
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { HeldCard } from '../data/api.ts';
import { useBoard } from '../glass/useBoard.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Postcard, cardLabel } from './Postcard.tsx';
import type { CardFace } from './faces.ts';
import { CalmRegion } from '../glass/Calm.tsx';
import { arcSlots, handOrder } from './arc.ts';

/** The most faces drawn for one kind of card. */
const COPIES_SHOWN = 2;

/** An armed card's tag, and the end of its name: while it is being played they say where. */
const tagOf = (playing: { readonly seq: number } | null): string => (playing ? `Playing · post #${playing.seq}` : 'Armed · pick a post');
const nameEnd = (playing: { readonly seq: number } | null): string => (playing ? `, playing on post ${playing.seq}` : ', armed: pick a post');

/** One drawn face: the card, which copy it is, and how many of the kind are in the hand if it is the last drawn. */
interface Drawn {
  readonly face: CardFace;
  readonly copy: number;
  readonly total: number | null;
}

/** The faces the Phone board's sheet draws for what is held, in the order the instance lists its cards. */
export function drawn(held: readonly HeldCard[], faces: readonly CardFace[]): readonly Drawn[] {
  return faces.flatMap((face) => {
    const n = held.find((h) => h.card === face.key)?.held ?? 0;
    const shown = Math.min(n, COPIES_SHOWN);
    return Array.from({ length: shown }, (_, copy): Drawn => ({ face, copy, total: n > COPIES_SHOWN && copy === shown - 1 ? n : null }));
  });
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
}

export function Hand({ held, faces, armed = null, playing = null, onPick, onClose, vendingHref }: HandProps) {
  const idBase = useId();
  /* The Main board's layout stands full-size cards on the arc; the Phone board's sheet holds smaller ones in a row. */
  const { board } = useBoard();
  const main = board === 'main';
  const cards = drawn(held, faces);
  const arc = handOrder(held, faces);
  const slots = arcSlots(arc.map((c) => c.group));
  const shown = main ? arc.length : cards.length;
  /* Rows further back stand lower; within a row a card is above the one to its left. */
  const byDepth = arc.map((c, i) => ({ key: c.face.key, i })).sort((p, q) => slots[q.i]!.row - slots[p.i]!.row || p.i - q.i);
  const stack = new Map(byDepth.map(({ key }, z) => [key, z + 1] as const));
  const count = held.reduce((n, h) => n + h.held, 0);
  const [viewed, setViewed] = useState<string | null>(null);
  const inView = faces.find((f) => f.key === (armed ?? viewed ?? (main ? arc[0] : cards[0])?.face.key));
  const list = useRef<HTMLUListElement>(null);
  /* The Main board's keys: arrows and Home/End move along the cards, Tab and Shift+Tab wrap at the ends. */
  const onKeys = (e: KeyboardEvent<HTMLUListElement>) => {
    if (!main || e.defaultPrevented || e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('li.kb-hand-card > button') ?? [])];
    const from = (e.target as HTMLElement).closest('button');
    const at = from ? buttons.indexOf(from) : -1;
    if (at < 0) return;
    const to = e.key === 'ArrowRight' ? Math.min(at + 1, buttons.length - 1)
      : e.key === 'ArrowLeft' ? Math.max(at - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : e.key === 'Tab' && !e.shiftKey && at === buttons.length - 1 ? 0
      : e.key === 'Tab' && e.shiftKey && at === 0 ? buttons.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    buttons[to]!.focus();
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
      ) : main ? (
        <ul className="kb-hand-cards" ref={list} onKeyDown={onKeys}>
          {arc.map(({ face, held: n }, i) => {
            const slot = slots[i]!;
            const isArmed = armed === face.key;
            const says = `${idBase}-${face.key}`;
            return (
              <li
                key={face.key}
                className="kb-hand-card"
                data-kb-card={face.key}
                data-kb-row={slot.row}
                data-armed={isArmed ? '' : undefined}
                style={{ '--kb-fan-x': `${slot.x}px`, '--kb-fan-y': `${slot.y}px`, '--kb-fan-turn': `${slot.deg}deg`, '--kb-fan-z': stack.get(face.key) } as CSSProperties}
              >
                <Postcard
                  as="button"
                  type="button"
                  face={face}
                  size="fan"
                  armed={isArmed}
                  aria-label={`${cardLabel(face, 'fan')}${n > 1 ? `, ${n} in hand` : ''}${isArmed ? nameEnd(playing) : ''}`}
                  aria-describedby={says}
                  aria-pressed={onPick ? isArmed : undefined}
                  onClick={() => { setViewed(face.key); onPick?.(face); }}
                />
                {n > 1 && <span className="kb-hand-times kb-num" aria-hidden="true">×{n}</span>}
                {isArmed && <span className="kb-hand-armed kb-glass-skew-tag" aria-hidden="true"><span className="kb-glass-upright">{tagOf(playing)}</span></span>}
                <span id={says} className="kb-visually-hidden">{face.describe}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="kb-hand-cards">
          {cards.map(({ face, copy, total }, i) => {
            const isArmed = armed === face.key && copy === 0;
            const says = `${idBase}-${face.key}`;
            return (
              <li
                key={`${face.key}-${copy}`}
                className="kb-hand-card"
                data-kb-card={face.key}
                data-armed={isArmed ? '' : undefined}
                style={{ '--kb-fan-z': isArmed ? 8 : 6 + (i % 2) } as CSSProperties}
              >
                <Postcard
                  as="button"
                  type="button"
                  face={face}
                  size="phone"
                  armed={isArmed}
                  aria-label={`${cardLabel(face, 'phone')}${total ? `, ${total} in hand` : ''}${isArmed ? nameEnd(playing) : ''}`}
                  aria-describedby={says}
                  aria-pressed={onPick ? isArmed : undefined}
                  onClick={() => { setViewed(face.key); onPick?.(face); }}
                />
                {total && <span className="kb-hand-times kb-num" aria-hidden="true">×{total}</span>}
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
