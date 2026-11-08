/**
 * The carousel: one row of cards, as many as fit at the theme's card width, the next peeking under
 * a fade, with arrows and a count ("1–4 of 6") while the row overflows. How many show comes from
 * the width, never from how many items there are. The row scrolls the chosen card whole into view,
 * gliding, or at once under reduced motion. A card scrolled out of view is never hidden or inert,
 * so a screen reader reaches every one (docs/plans/2026-11-04-glass-polish-design.md, section 4).
 *
 * It has two roles. As a `radiogroup` it is the class cards' row: a fieldset named by its legend
 * whose items are radios the caller draws (they carry their own change and focus; the arrow keys
 * are the browser's). As a `tablist` it is My characters' roster: each item is a `role="tab"` with
 * `aria-selected` and `aria-controls`, one tab stop (a roving tabindex), and the arrow keys move
 * and select, wrapping, Home and End going to the first and last (WAI-ARIA tabs, automatic
 * activation). The caller draws the tabpanel directly after the row, `role="tabpanel"` with
 * `id={carouselPanelId(id)}` and an `aria-labelledby` naming the selected tab, or the part of it that is the item's name
 * (a tab is named by its visible words, WCAG 2.5.3, so a card that shows more than a name names its panel by the name inside it).
 *
 * `after` is a card drawn last that is no item (New character): in a tablist it stands beside the
 * tablist, never inside it, since a link is not a tab. The count and the arrows sit after the cards
 * in the page's order, so a dialog's first focus is still the first card; the stylesheet puts them
 * on the legend's line (radiogroup) or above the row (tablist). The arrows' own focus never leaves:
 * an arrow pressed to its end is disabled under focus, and focus goes to the other one.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { motionReduced } from '../appearance.ts';
import { peeks, shownRange } from '../characters/carousel.ts';
import { CalmRegion } from './Calm.tsx';

/** The ids a tablist's tabs and its panel carry, from the `id` the caller gave the carousel. */
export const carouselTabId = (id: string, key: string) => `${id}-tab-${key}`;
export const carouselPanelId = (id: string) => `${id}-panel`;

/** What the carousel hands each item to spread on its card's root element. */
export type ItemProps = HTMLAttributes<HTMLElement> & { 'data-kb-item': string };

export interface CarouselProps<T extends { readonly key: string }> {
  readonly role: 'radiogroup' | 'tablist';
  /** The radiogroup's legend, or the tablist's accessible name. */
  readonly label: string;
  readonly items: readonly T[];
  readonly value: string | null;
  readonly onChange: (key: string) => void;
  /** Draws one card. `props` go on its root element; `selected` says whether it is the value. */
  readonly renderItem: (item: T, ctx: { readonly selected: boolean; readonly props: ItemProps; readonly follow: (key: string) => void }) => ReactNode;
  /** A card drawn last that is no item. */
  readonly after?: ReactNode;
  /** The base of a tablist's tab and panel ids. */
  readonly id?: string;
  readonly className?: string;
}

/**
 * Where the row stands: whether it overflows, the cards it shows whole, whether cards lie before or
 * past it (the arrows), and how much of a card only peeks in at each edge (the fades, drawn over
 * that much and no more, so a card shown whole is never faded). The row's inline padding is the
 * glow's room (characters.css, `--kb-class-glow`): the cards are counted whole, and peek, in the column
 * inside it, and the stylesheet hides the room at an end with cards past it, as `before` and `after`
 * say (docs/plans/2026-11-07-carousel-edges-design.md, section 1).
 */
interface RowState { readonly overflow: boolean; readonly first: number; readonly last: number; readonly before: boolean; readonly after: boolean; readonly peekBefore: number; readonly peekAfter: number }
const STILL: RowState = { overflow: false, first: 0, last: 0, before: false, after: false, peekBefore: 0, peekAfter: 0 };

/**
 * The row's cards, its card width, the gap and the step from one card's start to the next, as laid out now, in the
 * row's own CSS pixels (the units of its `scrollLeft` and `clientWidth`). The width is the computed one,
 * never `offsetWidth`: a card's width is often a fraction (a phone's `calc(100% - 64px)` is 291.375px), and
 * a rounded width puts every card after the first off by its rounding. Nor is it a bounding box, which is
 * in viewport pixels and so is scaled by the Turn dialog's `zoom`. Where layout reports no width (a test's
 * DOM), `offsetWidth` stands in.
 */
function measure(row: HTMLElement): { cards: HTMLElement[]; card: number; gap: number; step: number; room: number } {
  const cards = [...row.querySelectorAll<HTMLElement>('[data-kb-item]')];
  const style = getComputedStyle(row);
  const columnGap = parseFloat(style.columnGap);
  const padding = parseFloat(style.paddingLeft);
  const laid = cards[0] ? parseFloat(getComputedStyle(cards[0]).width) : 0;
  const card = Number.isFinite(laid) ? laid : cards[0]?.offsetWidth ?? 0;
  const gap = Number.isFinite(columnGap) ? columnGap : 0;
  /* The glow's room, the same at both ends. */
  const room = Number.isFinite(padding) ? padding : 0;
  return { cards, card, gap, step: card + gap, room };
}

function read(row: HTMLElement): RowState {
  const { cards, card, gap, room } = measure(row);
  const { scrollLeft, clientWidth, scrollWidth } = row;
  if (scrollWidth <= clientWidth + 1 || card <= 0) return STILL;
  /* The column the cards are counted in is the row's box less the room at each end; scrolled by `scrollLeft`, the first card stands at its start. */
  const column = clientWidth - 2 * room;
  const { first, last } = shownRange(scrollLeft, column, card, gap, cards.length);
  const { before: peekBefore, after: peekAfter } = peeks(scrollLeft, column, card, gap, cards.length);
  return { overflow: true, first, last, before: scrollLeft > 1, after: scrollLeft + clientWidth < scrollWidth - 1, peekBefore, peekAfter };
}

const same = (a: RowState, b: RowState) => (Object.keys(a) as (keyof RowState)[]).every((k) => a[k] === b[k]);

export function Carousel<T extends { readonly key: string }>({ role, label, items, value, onChange, renderItem, after, id = '', className }: CarouselProps<T>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState<RowState>(STILL);
  /* The fade eases only once the row has been read: a frame after it first is, so its first fade is drawn at once. */
  const [eased, setEased] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEased(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const update = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const next = read(el);
    setRow((was) => (same(was, next) ? was : next));
  }, []);

  /*
   * Read the row on scroll, and on a resize of the row or of a card (a card's width can change
   * while the row's does not); again if the items change. At ten items this is still one
   * listener and one observer.
   */
  const count = items.length + (after ? 1 : 0);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    const first = el.querySelector('[data-kb-item]');
    if (first) observer?.observe(first);
    return () => { el.removeEventListener('scroll', update); observer?.disconnect(); };
  }, [update, count]);

  /* An arrow pressed to its end is disabled under the player's focus: focus goes to the other arrow, never out of the dialog. */
  const earlier = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!row.before && document.activeElement === earlier.current && row.after) more.current?.focus();
    if (!row.after && document.activeElement === more.current && row.before) earlier.current?.focus();
  }, [row.before, row.after]);

  const cardOf = (key: string) => rowRef.current?.querySelector<HTMLElement>(`[data-kb-item="${CSS.escape(key)}"]`) ?? null;

  /** Scrolls the card of `key` whole into view, gliding unless motion is reduced (or `instant`). */
  const follow = useCallback((key: string, instant = false) => {
    cardOf(key)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: instant || motionReduced() ? 'auto' : 'smooth' });
  }, []);

  /* It opens on the chosen item (a pending Turn's, the page's selection), or else at the start, without motion. */
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
    const { step } = measure(el);
    el.scrollBy({ left: direction * step, behavior: motionReduced() ? 'auto' : 'smooth' });
  };

  /* A tablist's keys: the arrows wrap, Home and End go to the ends; focus moves with the choice. */
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (items.length === 0) return;
    const at = Math.max(0, items.findIndex((i) => i.key === value));
    const to = e.key === 'ArrowRight' ? (at + 1) % items.length : e.key === 'ArrowLeft' ? (at + items.length - 1) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const key = items[to]!.key;
    onChange(key);
    cardOf(key)?.focus();
  };

  const tabs = role === 'tablist';
  const rovingAt = items.some((i) => i.key === value) ? value : items[0]?.key;
  const drawn = items.map((item) => {
    const selected = item.key === value;
    const props: ItemProps = tabs
      ? {
          'data-kb-item': item.key, role: 'tab', id: carouselTabId(id, item.key), 'aria-selected': selected,
          'aria-controls': carouselPanelId(id), tabIndex: item.key === rovingAt ? 0 : -1,
          onClick: () => onChange(item.key), onKeyDown: keys, onFocus: () => follow(item.key),
        }
      : { 'data-kb-item': item.key };
    return renderItem(item, { selected, props, follow });
  });

  const body = (
    <div className="kb-class-rail">
      {/*
        * The row of a radiogroup is a calm of its own: a card that peeks shows its words in the glow's room past the column, outside
        * the page's or the dialog's calm. A tablist's own box is that calm already.
        */}
      <CalmRegion
        ref={rowRef} calm={!tabs} className="kb-class-grid"
        data-kb-peek-before={row.peekBefore > 0 || undefined} data-kb-peek-after={row.peekAfter > 0 || undefined} data-kb-eased={eased || undefined}
        data-kb-before={row.before || undefined} data-kb-after={row.after || undefined}
        style={{
          '--kb-class-peek-before': `${row.peekBefore}px`, '--kb-class-peek-after': `${row.peekAfter}px`,
          /* How many items and cards the row holds, for a stylesheet that lays it as a grid and places the card that is no item in the next slot. */
          '--kb-carousel-items': items.length, '--kb-carousel-count': count,
        } as CSSProperties}
      >
        {/* The tablist holds the tabs and is a box of its own (a link is no tab, so New character stands beside it in the row). */}
        {tabs ? <CalmRegion role="tablist" aria-label={label} className="kb-carousel-tablist">{drawn}</CalmRegion> : drawn}
        {after && <div className="kb-carousel-after" data-kb-item="after">{after}</div>}
      </CalmRegion>
      {row.overflow && (
        <CalmRegion className="kb-class-nav">
          <span className="kb-class-count">{`${row.first}–${row.last} of ${count}`}</span>
          <button ref={earlier} type="button" className="kb-class-arrow" aria-label={tabs ? 'Earlier characters' : 'Earlier classes'} disabled={!row.before} onClick={() => move(-1)}>
            <span aria-hidden="true">‹</span>
          </button>
          <button ref={more} type="button" className="kb-class-arrow" aria-label={tabs ? 'More characters' : 'More classes'} disabled={!row.after} onClick={() => move(1)}>
            <span aria-hidden="true">›</span>
          </button>
        </CalmRegion>
      )}
    </div>
  );

  return tabs ? (
    <div className={['kb-carousel', 'kb-class-cards', className].filter(Boolean).join(' ')} data-kb-role="tablist" data-kb-overflow={row.overflow || undefined}>{body}</div>
  ) : (
    <fieldset className={['kb-class-cards', className].filter(Boolean).join(' ')} data-kb-overflow={row.overflow || undefined}>
      <legend>{label}</legend>
      {body}
    </fieldset>
  );
}
