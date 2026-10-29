/**
 * The class cards, used by New character and the Turn: one radio per class, each with the
 * instance's plain description of how it earns and what hurts it. A card is a game piece, so it
 * carries its class's color and pattern (a swatch, for those who cannot tell colors apart), but the
 * words are what a player chooses by.
 */
import { useId, type CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';

export interface ClassCardsProps {
  readonly legend: string;
  readonly value: string | null;
  readonly onChange: (key: string) => void;
  /** Classes left out (the one a character holds, for a Turn). */
  readonly exclude?: readonly string[];
}

export function ClassCards({ legend, value, onChange, exclude = [] }: ClassCardsProps) {
  const { instance, ui } = useKayfa();
  const group = useId();
  return (
    <fieldset className="kb-class-cards">
      <legend>{legend}</legend>
      <div className="kb-class-grid">
        {instance.classes.filter((c) => !exclude.includes(c.key)).map((c) => {
          const look = ui.classLooks?.[c.key];
          const swatch: CSSProperties | undefined = look ? { backgroundColor: look.color, backgroundImage: look.pattern } : undefined;
          return (
            <label key={c.key} className="kb-class-card" data-kb-class={c.key} data-kb-chosen={value === c.key || undefined}>
              <input type="radio" name={group} value={c.key} checked={value === c.key} onChange={() => onChange(c.key)} />
              <span className="kb-class-swatch" style={swatch} aria-hidden="true" />
              <span className="kb-class-text">
                <b className="kb-class-name">{c.name}</b>
                {look?.description && <span className="kb-class-description kb-small">{look.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
