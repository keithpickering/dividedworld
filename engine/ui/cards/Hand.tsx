/**
 * What is in the hand's drawer (the HUD opens it; engine/ui/frame/Hud.tsx): the player's cards as
 * postcards, each a button by its name ("Stick Around, Sweet postcard"), and, on the Phone board's
 * sheet, the heading with the count, the line that says what the card in view does, and the
 * Vending Machine link. The Main board's layout shows only the cards, fanned through the HUD's seam
 * at -11, -1 and 10 degrees (the glass plan, section 5); the sheet's other parts are hidden there by
 * its stylesheet, not left out, so one drawer serves both layouts.
 *
 * A card is drawn once for each copy held, up to two copies of a kind; a kind held more than twice
 * is still two faces, the last of them saying how many are in the hand ("Whoops!, Salty postcard,
 * 5 in hand"), so a hand of any size is a hand that fits the HUD. Every card's rules in plain words
 * (`CardUi.describe`) are its button's description, and the one in view is also written, in a
 * sentence (`CardUi.summary`), in the sheet's line.
 *
 * A card is a button, and pressing it is the caller's to answer (engine/ui/cards/play.tsx): `armed` is
 * the key of the card that waits to be played ("Whoops! is armed. Every post it can land on now shows
 * Play Whoops! here"; its name says ", armed: pick a post", and it carries that as a floating tag and
 * pulses), and `onPick` is what pressing a card does. With neither, pressing a card shows its rules
 * in the sheet's line. Opened for a post, the hand is given only the cards that can land there and
 * says whose post it is for (`forPost`).
 */
import { useId, useState, type CSSProperties } from 'react';
import type { HeldCard } from '../data/api.ts';
import { useBoard } from '../glass/useBoard.ts';
import { Link } from '../router.tsx';
import { Postcard } from './Postcard.tsx';
import type { CardFace } from './faces.ts';

/** The most faces drawn for one kind of card. */
const COPIES_SHOWN = 2;

/** One drawn face: the card, which copy it is, and how many of the kind are in the hand if it is the last drawn. */
interface Drawn {
  readonly face: CardFace;
  readonly copy: number;
  readonly total: number | null;
}

/** The faces to draw for what is held, in the order the instance lists its cards. */
export function drawn(held: readonly HeldCard[], faces: readonly CardFace[]): readonly Drawn[] {
  return faces.flatMap((face) => {
    const n = held.find((h) => h.card === face.key)?.held ?? 0;
    const shown = Math.min(n, COPIES_SHOWN);
    return Array.from({ length: shown }, (_, copy): Drawn => ({ face, copy, total: n > COPIES_SHOWN && copy === shown - 1 ? n : null }));
  });
}

/**
 * Where the i-th of n fanned cards stands against the hand button, and how far it turns: the Main
 * board's three exactly (150 by 225 cards at -11, -1 and 10 degrees), other counts spread between
 * the first and the last of those.
 */
export function fanSlot(i: number, n: number): { readonly x: number; readonly y: number; readonly deg: number } {
  if (n === 3) return [{ x: -60, y: -260, deg: -11 }, { x: 10, y: -260, deg: -1 }, { x: 72, y: -250, deg: 10 }][i]!;
  if (n === 1) return { x: 10, y: -260, deg: -1 };
  const t = i / (n - 1);
  return { x: -60 + t * 132, y: -260 + t * 10, deg: -11 + t * 21 };
}

export interface HandProps {
  readonly held: readonly HeldCard[];
  readonly faces: readonly CardFace[];
  /** The key of the card that is armed, if any. */
  readonly armed?: string | null;
  /** What pressing a card does; with none, it shows the card's rules. */
  readonly onPick?: (face: CardFace) => void;
  /** The post the hand was opened for ("Play card"), in words ("Gloomba's post #46"): the cards shown are those that can land there, and the hand says so. */
  readonly forPost?: string;
  readonly onClose: () => void;
  /** Where the Vending Machine is. */
  readonly vendingHref: string;
}

export function Hand({ held, faces, armed = null, onPick, forPost, onClose, vendingHref }: HandProps) {
  const idBase = useId();
  /* The Main board's layout fans full-size cards; the Phone board's sheet holds smaller ones in a row. */
  const { board } = useBoard();
  const cards = drawn(held, faces);
  const count = held.reduce((n, h) => n + h.held, 0);
  const [viewed, setViewed] = useState<string | null>(null);
  const inView = faces.find((f) => f.key === (armed ?? viewed ?? cards[0]?.face.key));
  return (
    <>
      <div className="kb-hand-bar">
        <h2 className="kb-hand-head kb-glass-display">Hand <span className="kb-hand-head-count kb-num kb-calm">· {count}</span></h2>
        <button type="button" className="kb-hand-close" aria-label="Close the hand" onClick={onClose}>
          <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3 L13 13 M13 3 L3 13" /></svg>
        </button>
      </div>
      {cards.length === 0 ? (
        <p className="kb-hand-empty kb-calm">{forPost ? `None of your postcards can land on ${forPost}.` : 'No postcards in your hand. The Vending Machine sells them.'}</p>
      ) : (
        <ul className="kb-hand-cards">
          {cards.map(({ face, copy, total }, i) => {
            const slot = fanSlot(i, cards.length);
            const isArmed = armed === face.key && copy === 0;
            const says = `${idBase}-${face.key}`;
            return (
              <li
                key={`${face.key}-${copy}`}
                className="kb-hand-card"
                data-kb-card={face.key}
                data-armed={isArmed ? '' : undefined}
                style={{ '--kb-fan-x': `${slot.x}px`, '--kb-fan-y': `${slot.y}px`, '--kb-fan-turn': `${slot.deg}deg`, '--kb-fan-z': isArmed ? 8 : 6 + (i % 2) } as CSSProperties}
              >
                <Postcard
                  as="button"
                  type="button"
                  face={face}
                  size={board === 'main' ? 'fan' : 'phone'}
                  armed={isArmed}
                  aria-label={`${face.name}, ${face.tag} postcard${total ? `, ${total} in hand` : ''}${isArmed ? ', armed: pick a post' : ''}`}
                  aria-describedby={says}
                  aria-pressed={onPick ? isArmed : undefined}
                  onClick={() => { setViewed(face.key); onPick?.(face); }}
                />
                {total && <span className="kb-hand-times kb-num" aria-hidden="true">×{total}</span>}
                {isArmed && <span className="kb-hand-armed kb-glass-skew-tag" aria-hidden="true"><span className="kb-glass-upright">Armed · pick a post</span></span>}
                <span id={says} className="kb-visually-hidden">{face.describe}</span>
              </li>
            );
          })}
        </ul>
      )}
      {inView && cards.length > 0 && (
        <p className="kb-hand-says kb-calm">
          {forPost && <>For {forPost}. </>}
          {armed === inView.key
            ? <>{inView.name} is armed. Every post it can land on now shows <b>Play {inView.name} here</b>.</>
            : <><b>{inView.name}.</b> {inView.summary}</>}
        </p>
      )}
      <Link to={vendingHref} className="kb-hand-vending kb-glass-skew"><span className="kb-glass-upright">Vending Machine</span></Link>
    </>
  );
}
