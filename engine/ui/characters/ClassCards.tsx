/**
 * The class cards, used by New character and the Turn: one radio per class, each with the
 * instance's plain description of how it earns and what hurts it, and its marks on the reaction
 * map (a plus where it earns, a minus where it is hurt, dotted where it earns by calling), named in
 * words. A card is a game piece, so it carries its class's glass colors, but the words are what a
 * player chooses by: each radio is named by its class alone and described by its words, so a
 * screen reader says the name first and the rest after, then by its marks' words; the marks are
 * an image beside them. On the Turn the class the character holds is drawn too, marked Now, and is
 * no choice (the Turn board draws every class).
 *
 * The cards are one row, a carousel (docs/plans/2026-10-30-technician-design.md, section 3): as
 * many as fit at the theme's card width, the next peeking under a fade, with arrows and a count
 * ("1–4 of 5") while the row overflows. How many show comes from the width, never from how many
 * classes there are. It stays one radiogroup: the arrow keys move the choice through every class,
 * and the row scrolls the chosen card whole into view, gliding, or at once under reduced motion. A
 * card scrolled out of view is never hidden or inert, so a screen reader hears every class. The
 * arrows sit after the cards in the page's order, on the legend's line by the stylesheet, so a
 * dialog's first focus is still the first card.
 *
 * A class's name is drawn in its large color only where the surface draws a class's large text
 * (`large`: the Turn's, engine/ui/glass/apply.ts's `classLargeText`); elsewhere it is in the
 * glass's text, the class's color on the card's edge and marks.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Quadrant } from '../../rules/types.ts';
import { motionReduced } from '../appearance.ts';
import { useKayfa } from '../context.tsx';
import type { ClassMarks } from '../types.ts';
import { classVars } from './ClassChip.tsx';
import { shownRange } from './carousel.ts';

export interface ClassCardsProps {
  readonly legend: string;
  readonly value: string | null;
  readonly onChange: (key: string) => void;
  /** The class the character holds now (a Turn's): drawn, marked Now, and not offered. */
  readonly current?: string;
  /** Names drawn in the class's large color, on a surface that draws class large text. */
  readonly large?: boolean;
}

/** The map's cells in the React picker's order: Heat and Hype on top, Groan and Calm below. */
export const MAP: readonly Quadrant[] = ['excitedNegative', 'excitedPositive', 'boredNegative', 'calmPositive'];

function Marks({ marks, id }: { readonly marks: ClassMarks; readonly id: string }) {
  const cell = (q: Quadrant) => {
    if (marks.earns?.includes(q)) return <span key={q} className="kb-class-mark" data-kb-mark="earns">+</span>;
    if (marks.hurts?.includes(q)) return <span key={q} className="kb-class-mark" data-kb-mark="hurts">−</span>;
    if (marks.calls?.includes(q)) return <span key={q} className="kb-class-mark" data-kb-mark="calls" />;
    return <span key={q} className="kb-class-mark" />;
  };
  /*
   * The marks' words describe the class's radio too. A description read from the image would be its
   * glyphs in some readers (jsdom's among them), so the radio is described by a hidden copy of the
   * words; a description may name a hidden element, and `hidden` keeps the copy from being read twice.
   */
  return (
    <>
      <span className="kb-class-marks" role="img" aria-label={marks.label}>{MAP.map(cell)}</span>
      <span id={id} hidden>{marks.label}</span>
    </>
  );
}

/**
 * Where the row stands: whether it overflows, the cards it shows whole, whether cards lie before or
 * past it (the arrows), and how much of a card only peeks in at each edge (the fades, drawn over
 * that much and no more, so a card shown whole is never faded).
 */
interface RowState { readonly overflow: boolean; readonly first: number; readonly last: number; readonly before: boolean; readonly after: boolean; readonly peekBefore: number; readonly peekAfter: number }
const STILL: RowState = { overflow: false, first: 0, last: 0, before: false, after: false, peekBefore: 0, peekAfter: 0 };

/** The row's cards, its card width and the gap between them, as laid out now. */
function measure(row: HTMLElement): { cards: HTMLElement[]; card: number; gap: number } {
  const cards = [...row.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
  const gap = parseFloat(getComputedStyle(row).columnGap);
  return { cards, card: cards[0]?.offsetWidth ?? 0, gap: Number.isFinite(gap) ? gap : 0 };
}

function read(row: HTMLElement): RowState {
  const { cards, card, gap } = measure(row);
  const { scrollLeft, clientWidth, scrollWidth } = row;
  if (scrollWidth <= clientWidth + 1 || card <= 0) return STILL;
  const { first, last } = shownRange(scrollLeft, clientWidth, card, gap, cards.length);
  const step = card + gap;
  /* What of the card before the first whole one shows (its end past the viewport's start), and of the card after the last. */
  const peekBefore = first > 1 ? Math.max(0, Math.round((first - 2) * step + card - scrollLeft)) : 0;
  const peekAfter = last < cards.length ? Math.max(0, Math.round(scrollLeft + clientWidth - last * step)) : 0;
  return { overflow: true, first, last, before: scrollLeft > 1, after: scrollLeft + clientWidth < scrollWidth - 1, peekBefore, peekAfter };
}

const same = (a: RowState, b: RowState) => (Object.keys(a) as (keyof RowState)[]).every((k) => a[k] === b[k]);

export function ClassCards({ legend, value, onChange, current, large = false }: ClassCardsProps) {
  const { instance, ui } = useKayfa();
  const group = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState<RowState>(STILL);
  const update = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const next = read(el);
    setRow((was) => (same(was, next) ? was : next));
  }, []);

  /*
   * Read the row on scroll, and on a resize of the row or of a card (a card's width can change
   * while the row's does not); again if the classes change. At ten classes this is still one
   * listener and one observer.
   */
  const count = instance.classes.length;
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', update); observer?.disconnect(); };
  }, [update, count]);

  /* An arrow pressed to its end is disabled under the player's focus: focus goes to the other arrow, never out of the dialog. */
  const earlier = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!row.before && document.activeElement === earlier.current && row.after) more.current?.focus();
    if (!row.after && document.activeElement === more.current && row.before) earlier.current?.focus();
  }, [row.before, row.after]);

  /** Scrolls the card of class `key` whole into view, gliding unless motion is reduced (or `instant`). */
  const follow = useCallback((key: string, instant = false) => {
    const card = rowRef.current?.querySelector<HTMLElement>(`[data-kb-class="${CSS.escape(key)}"]`);
    card?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: instant || motionReduced() ? 'auto' : 'smooth' });
  }, []);

  /* It opens on the chosen class (a pending Turn's), or else at the start, without motion. */
  const opened = useRef(false);
  useLayoutEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (value) follow(value, true);
  }, [value, follow]);

  /* An arrow moves the row by one card and its gap. */
  const move = (direction: 1 | -1) => {
    const el = rowRef.current;
    if (!el) return;
    const { card, gap } = measure(el);
    el.scrollBy({ left: direction * (card + gap), behavior: motionReduced() ? 'auto' : 'smooth' });
  };

  return (
    <fieldset className="kb-class-cards" data-kb-overflow={row.overflow || undefined}>
      <legend>{legend}</legend>
      <div className="kb-class-rail">
      <div
        ref={rowRef} className="kb-class-grid"
        data-kb-peek-before={row.peekBefore > 0 || undefined} data-kb-peek-after={row.peekAfter > 0 || undefined}
        style={{ '--kb-class-peek-before': `${row.peekBefore}px`, '--kb-class-peek-after': `${row.peekAfter}px` } as CSSProperties}
      >
        {instance.classes.map((c) => {
          const look = ui.classLooks?.[c.key];
          const ids = { name: `${group}-${c.key}-name`, words: `${group}-${c.key}-words`, marks: `${group}-${c.key}-marks` };
          const described = [look?.description && ids.words, look?.marks && ids.marks].filter(Boolean).join(' ') || undefined;
          const inside = (
            <>
              <span className="kb-class-title kb-calm">
                <b id={ids.name} className="kb-class-name" data-kb-large={large || undefined} style={{ '--kb-class-name-length': c.name.length } as CSSProperties}>{c.name}</b>
                {c.key === current && <span className="kb-class-now">Now</span>}
              </span>
              {look?.marks && <Marks marks={look.marks} id={ids.marks} />}
              {look?.description && <span id={ids.words} className="kb-class-description">{look.description}</span>}
            </>
          );
          if (c.key === current) {
            return <div key={c.key} className="kb-class-card" data-kb-class={c.key} data-kb-now="" style={classVars(c.key)}>{inside}</div>;
          }
          return (
            <label key={c.key} className="kb-class-card" data-kb-class={c.key} data-kb-chosen={value === c.key || undefined} style={classVars(c.key)}>
              <input
                type="radio" name={group} value={c.key} checked={value === c.key}
                onChange={() => { onChange(c.key); follow(c.key); }}
                onFocus={() => follow(c.key)}
                aria-labelledby={ids.name} aria-describedby={described}
              />
              {inside}
            </label>
          );
        })}
      </div>
      {row.overflow && (
        <div className="kb-class-nav">
          <span className="kb-class-count">{`${row.first}\u2013${row.last} of ${count}`}</span>
          <button ref={earlier} type="button" className="kb-class-arrow" aria-label="Earlier classes" disabled={!row.before} onClick={() => move(-1)}>
            <span aria-hidden="true">‹</span>
          </button>
          <button ref={more} type="button" className="kb-class-arrow" aria-label="More classes" disabled={!row.after} onClick={() => move(1)}>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}
      </div>
    </fieldset>
  );
}
