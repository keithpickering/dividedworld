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
 * Motion: the layer enters as the glass's modals do (`useLayer`), the head's words and buttons as a screen's head does (`staggerItem`), and the card
 * turns on its vertical axis in the spotlight, on the feel's `enter` token (a spring under Snappy). Under Off (reduced motion) there is no wrapper and no
 * rotation: a card is shown turned. The reveal's remaining beats (the tear, the deal, the flight to the hand) are the presets of the machine's motion task
 * (the plan's Task 10), which this component spreads; it holds no duration of its own.
 *
 * The modal is the glass's layer (`useModalLayer`): focus moves inside when it opens and is held there, Esc closes it, and focus goes back to where
 * `returnFocusTo` says (the pack's slot). Input never waits on a motion: a turn, Turn all and Close act at once.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { PostcardBack, Postcard } from '../cards/Postcard.tsx';
import { playWord, rarityName, type CardFace } from '../cards/faces.ts';
import type { CardArt } from '../cards/types.ts';
import { useKayfa } from '../context.tsx';
import { withArticle } from '../characters/format.ts';
import { GlassButton } from '../glass/Button.tsx';
import { bezier, stagger, staggerItem, useFeel, type ActiveFeel } from '../glass/motion.ts';
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
}

/** Where the sparks stand round the hit's card, as shares of the spotlight's box. */
const SPARKS = [[-12, 10, 18], [108, 5, 14], [115, 72, 20], [-11, 80, 12], [105, 100, 10], [-7, 43, 9]] as const;

/** A card as it is said when it is turned: "Whoops!, Salty Cast, common". */
export const saidOf = (face: CardFace): string => `${face.name}, ${face.tag} ${playWord(face.play)}, ${face.rarity}`;

/** How a turn runs under a feel: the feel's `enter` over its ease, or its spring where it has one. */
function turnTransition(feel: NonNullable<ActiveFeel>) {
  return feel.spring
    ? ({ type: 'spring', stiffness: feel.spring.stiffness, damping: feel.spring.damping } as const)
    : ({ duration: (feel.enter * 1.2) / 1000, ease: bezier(feel.ease) } as const);
}

export function PackOpening({ name, art, cards, note, onClose, returnFocusTo }: PackOpeningProps) {
  const { ui } = useKayfa();
  const feel = useFeel(ui.glass.motion);
  const count = cards.length;
  const [turned, setTurned] = useState(0);
  const { overlay, box } = useModalLayer({ onClose, returnFocusTo });
  const lifted = useLayer({ box, kind: 'modal', overrides: ui.glass.motion });
  const primary = useRef<HTMLButtonElement>(null);
  const delays = useMemo(() => stagger(feel, 4), [feel]);
  const mark = ui.cardBack?.mark;
  const all = turned >= count;
  const hitShown = all && count > 0;
  const shownIndex = Math.max(0, turned - 1);
  const shown = cards[shownIndex];

  const turnNext = () => setTurned((t) => Math.min(count, t + 1));
  const turnAll = () => setTurned(count);

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
  }, [turned, box]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    /* A held Space repeats; only the first press turns a card. */
    if (e.key !== ' ' || e.repeat || e.defaultPrevented) return;
    /* On a button the browser's own click follows a Space; anywhere else Space turns the next card. */
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    turnNext();
  };

  /* On a phone the pile is the control: a tap on it, or a swipe across it, turns the next card (a slight drag is neither). */
  const drag = useRef<number | null>(null);
  const onPileDown = (e: ReactPointerEvent) => { drag.current = e.clientX; };
  const onPileUp = (e: ReactPointerEvent) => {
    const from = drag.current;
    drag.current = null;
    if (from === null || all || document.documentElement.getAttribute('data-kb-layout') !== 'phone') return;
    const moved = Math.abs(e.clientX - from);
    if (moved < 10 || moved >= 40) turnNext();
  };

  const faceUp = (c: CardFace, size: 'fan' | 'sheet') => <Postcard face={c} size={size} />;
  const backOf = (i: number, size: 'fan' | 'sheet') => <PostcardBack size={size} hit={i === count - 1} {...(mark ? { mark } : {})} />;

  return createPortal(
    <motion.div ref={overlay} className="kb-opening-layer" {...lifted.root}>
      <motion.div
        ref={box} className="kb-opening" role="dialog" aria-modal="true" aria-label={`Opening ${withArticle(name)}`} tabIndex={-1}
        data-kb-hit={hitShown ? '' : undefined} onKeyDown={onKeyDown} {...lifted.box}
      >
        <PackArt className="kb-opening-parked" part="opened" width={180} name={name} count={count} {...(art ? { art } : {})} />
        <div className="kb-opening-head">
          <motion.h2 className="kb-opening-title" {...staggerItem(feel, delays, 0)}>{name}</motion.h2>
          {/* The one live region: the count and the card said as it turns, in one place, so a turn is heard once. It takes no box of its own. */}
          <div className="kb-opening-live" aria-live="polite" aria-atomic="true">
            <motion.p className="kb-opening-count" {...staggerItem(feel, delays, 1)}>
              {all ? `${count} of ${count} · all in your hand` : `${turned} of ${count} turned over`}
            </motion.p>
            <span className="kb-visually-hidden">{said}</span>
          </div>
          <ol className="kb-opening-outlines" aria-hidden="true">
            {cards.map((c, i) => <li key={`${c.key}-${i}`} data-kb-turned={i < turned ? '' : undefined} data-kb-hit={i === count - 1 ? '' : undefined} />)}
          </ol>
        </div>

        <div className="kb-opening-stage" onPointerDown={onPileDown} onPointerUp={onPileUp}>
          {hitShown && (
            <>
              <span className="kb-opening-glow" aria-hidden="true" />
              {SPARKS.map(([x, y, s], i) => <span key={i} className="kb-opening-spark" aria-hidden="true" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s }} />)}
              <p className="kb-opening-tag"><b>{shown ? `${rarityName(shown.rarity)} · ${shown.name}` : ''}</b></p>
            </>
          )}
          <div className="kb-opening-spot" data-kb-hit={hitShown ? '' : undefined}>
            <span className="kb-opening-next" aria-hidden="true">{turned < count && turned > 0 ? backOf(turned, 'sheet') : null}</span>
            {feel === null ? (
              turned > 0 && shown
                ? <Postcard as="article" face={shown} size="sheet" aria-label={saidOf(shown)} />
                : <PostcardBack size="sheet" hit={count === 1} {...(mark ? { mark } : {})} aria-hidden="true" />
            ) : (
              <motion.div
                key={shownIndex} className="kb-opening-flip" data-kb-turned={turned > 0 ? '' : undefined}
                initial={{ rotateY: 0 }} animate={{ rotateY: turned > 0 ? 180 : 0, transition: turnTransition(feel) }} style={{ transformStyle: 'preserve-3d' }}
              >
                <span className="kb-opening-side kb-opening-side-back">{backOf(shownIndex, 'sheet')}</span>
                {shown && <span className="kb-opening-side kb-opening-side-face"><Postcard as="article" face={shown} size="sheet" aria-label={saidOf(shown)} /></span>}
              </motion.div>
            )}
          </div>
        </div>

        <ol className="kb-opening-row" aria-label="The pack, in the order it was pulled">
          {cards.map((c, i) => {
            const hit = i === count - 1;
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
                  ? <button type="button" className="kb-opening-turn" aria-label={`Turn card ${i + 1}`} onClick={turnNext}>{backOf(i, 'fan')}</button>
                  : backOf(i, 'fan')}
              </li>
            );
          })}
        </ol>

        <motion.div className="kb-opening-actions" {...staggerItem(feel, delays, 2)}>
          <GlassButton ref={primary} kind="primary" className="kb-opening-gold" onClick={all ? onClose : turnNext}>{all ? 'Done' : 'Turn the next card'}</GlassButton>
          {!all && <GlassButton onClick={turnAll}>Turn all</GlassButton>}
          <GlassButton onClick={onClose}>
            <span className="kb-opening-key" aria-hidden="true" data-kb-key="ESC" />
            {all ? 'Back to the machine' : 'Close'}
          </GlassButton>
        </motion.div>
        <motion.p className="kb-opening-hint" {...staggerItem(feel, delays, 3)}>
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
