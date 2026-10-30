/**
 * The class cards, used by New character and the Turn: one radio per class, each with the
 * instance's plain description of how it earns and what hurts it, and its marks on the reaction
 * map (a plus where it earns, a minus where it is hurt, dotted where it earns by calling), named in
 * words. A card is a game piece, so it carries its class's glass colors, but the words are what a
 * player chooses by. On the Turn the class the character holds is drawn too, marked Now, and is no
 * choice (the Turn board draws all four).
 *
 * A class's name is drawn in its large color only where the surface draws a class's large text
 * (`large`: the Turn's, engine/ui/glass/apply.ts's `classLargeText`); elsewhere it is in the
 * glass's text, the class's color on the card's edge and marks.
 */
import { useId } from 'react';
import type { Quadrant } from '../../rules/types.ts';
import { useKayfa } from '../context.tsx';
import type { ClassMarks } from '../types.ts';
import { classVars } from './ClassChip.tsx';

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

function Marks({ marks }: { readonly marks: ClassMarks }) {
  const cell = (q: Quadrant) => {
    if (marks.earns?.includes(q)) return <span key={q} className="kb-class-mark" data-kb-mark="earns">+</span>;
    if (marks.hurts?.includes(q)) return <span key={q} className="kb-class-mark" data-kb-mark="hurts">−</span>;
    if (marks.calls?.includes(q)) return <span key={q} className="kb-class-mark" data-kb-mark="calls" />;
    return <span key={q} className="kb-class-mark" />;
  };
  return <span className="kb-class-marks" role="img" aria-label={marks.label}>{MAP.map(cell)}</span>;
}

export function ClassCards({ legend, value, onChange, current, large = false }: ClassCardsProps) {
  const { instance, ui } = useKayfa();
  const group = useId();
  return (
    <fieldset className="kb-class-cards">
      <legend>{legend}</legend>
      <div className="kb-class-grid">
        {instance.classes.map((c) => {
          const look = ui.classLooks?.[c.key];
          const inside = (
            <>
              <span className="kb-class-title">
                <b className="kb-class-name" data-kb-large={large || undefined}>{c.name}</b>
                {c.key === current && <span className="kb-class-now">Now</span>}
              </span>
              {look?.marks && <Marks marks={look.marks} />}
              {look?.description && <span className="kb-class-description">{look.description}</span>}
            </>
          );
          if (c.key === current) {
            return <div key={c.key} className="kb-class-card" data-kb-class={c.key} data-kb-now="" style={classVars(c.key)}>{inside}</div>;
          }
          return (
            <label key={c.key} className="kb-class-card" data-kb-class={c.key} data-kb-chosen={value === c.key || undefined} style={classVars(c.key)}>
              <input type="radio" name={group} value={c.key} checked={value === c.key} onChange={() => onChange(c.key)} />
              {inside}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
