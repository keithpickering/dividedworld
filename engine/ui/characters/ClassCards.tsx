/**
 * The class cards, used by New character and the Turn: one radio per class, each with the
 * instance's plain description of how it earns and, under it in the hurt color, what hurts it (the two are
 * two fields of the class's look, `description` and `hurtsBy`), and its marks on the reaction
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
import { useId, type CSSProperties } from 'react';
import type { Quadrant } from '../../rules/types.ts';
import { useKayfa } from '../context.tsx';
import { MAP, type ClassMarks } from '../types.ts';
import { classVars } from './ClassChip.tsx';
import { Carousel } from '../glass/Carousel.tsx';
import { economyNow } from '../economy.ts';

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
export { MAP };

export function Marks({ marks, id }: { readonly marks: ClassMarks; readonly id: string }) {
  const cell = (q: Quadrant) => {
    if (marks.splits?.includes(q)) {
      /* The pair's left cell (in MAP's order) is filled toward the right, its partner, and the right one toward the left. */
      const toward = MAP.indexOf(q) === Math.min(...marks.splits.map((s) => MAP.indexOf(s))) ? 'right' : 'left';
      return <span key={q} className="kb-class-mark" data-kb-mark="splits" data-kb-toward={toward} />;
    }
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
      <span className="kb-class-marks" role="img" aria-label={marks.label}>{MAP.map(cell)}{marks.splits && <span className="kb-class-split-bar" aria-hidden="true" />}</span>
      <span id={id} hidden>{marks.label}</span>
    </>
  );
}

export function ClassCards({ legend, value, onChange, current, large = false }: ClassCardsProps) {
  const { instance, ui, settings } = useKayfa();
  /* A class's words state the numbers in force (economyNow). */
  const economy = economyNow(instance.settings, settings.economy);
  const group = useId();

  return (
    <Carousel
      role="radiogroup" label={legend} items={instance.classes} value={value} onChange={onChange}
      renderItem={(c, { props, follow }) => {
        const look = ui.classLooks?.[c.key];
        const ids = { name: `${group}-${c.key}-name`, words: `${group}-${c.key}-words`, hurts: `${group}-${c.key}-hurts`, marks: `${group}-${c.key}-marks` };
        /* How the class earns, and under it what hurts it: a class with nothing that hurts it has no second paragraph. */
        const hurts = look?.hurtsBy(economy, settings.settlementLength) ?? '';
        const described = [look?.description && ids.words, hurts && ids.hurts, look?.marks && ids.marks].filter(Boolean).join(' ') || undefined;
        const inside = (
          <>
            <span className="kb-class-title">
              <b id={ids.name} className="kb-class-name" data-kb-large={large || undefined} style={{ '--kb-class-name-length': c.name.length } as CSSProperties}>{c.name}</b>
              {c.key === current && <span className="kb-class-now">Now</span>}
            </span>
            {look?.marks && <Marks marks={look.marks} id={ids.marks} />}
            {look?.description && <span id={ids.words} className="kb-class-description">{look.description(economy, settings.settlementLength)}</span>}
            {hurts && <span id={ids.hurts} className="kb-class-hurt">{hurts}</span>}
          </>
        );
        if (c.key === current) {
          return <div key={c.key} {...props} className="kb-class-card" data-kb-class={c.key} data-kb-now="" style={classVars(c.key)}>{inside}</div>;
        }
        return (
          <label key={c.key} {...props} className="kb-class-card" data-kb-class={c.key} data-kb-chosen={value === c.key || undefined} style={classVars(c.key)}>
            <input
              type="radio" name={group} value={c.key} checked={value === c.key}
              onChange={() => { onChange(c.key); follow(c.key); }}
              onFocus={() => follow(c.key)}
              aria-labelledby={ids.name} aria-describedby={described}
            />
            {inside}
          </label>
        );
      }}
    />
  );
}
