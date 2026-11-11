/**
 * A radio group of small card faces, one for every card of the instance in `castable` at or below a rarity: Card Collector's "The card it waits
 * for" and 4D Chess's "The Move it waits for" are this, with their own legend and rarity bound (each read from its own rules). Native radios,
 * so the arrow keys move between the faces and Space chooses; the chosen face is outlined, and its kind tag and rarity are words as well as a shape.
 */
import type { CSSProperties } from 'react';
import { gemOf, rarityName, type CardFace } from '../../../../engine/ui/cards/faces.ts';
import { atOrBelow, type Rarity } from '../../../../engine/rules/cards.ts';
import './card-collector.css';

export interface FacePickProps {
  readonly legend: string;
  /** Unique on the page: the radios' group name. */
  readonly name: string;
  readonly castable: readonly CardFace[];
  /** Faces rarer than this are not offered. */
  readonly upTo: Rarity;
  /** The key chosen now, or undefined before the player has chosen (nothing is checked then). */
  readonly chosen: string | undefined;
  readonly onChoose: (key: string) => void;
}

export function FacePick({ legend, name, castable: all, upTo, chosen, onChoose }: FacePickProps) {
  const castable = all.filter((f) => atOrBelow(f.rarity, upTo));
  const checked = chosen !== undefined && castable.some((f) => f.key === chosen) ? chosen : undefined;
  return (
    <fieldset className="kb-trap-pick">
      <legend className="kb-trap-pick-legend">{legend}</legend>
      <div className="kb-trap-faces">
        {castable.map((f) => (
          <label key={f.key} className="kb-trap-face" style={{ '--kb-card-color': f.art.color } as CSSProperties}>
            <input type="radio" name={name} value={f.key} checked={checked === f.key} onChange={() => onChoose(f.key)} />
            <span className="kb-trap-face-in">
              {f.art.mark ? <img className="kb-trap-face-mark" src={f.art.mark} alt="" draggable={false} /> : <span className="kb-trap-face-mark" aria-hidden="true" />}
              <span className="kb-trap-face-name">{f.name}</span>{' '}
              <span className="kb-trap-face-tag">{f.kind}</span>{' '}
              <span className="kb-trap-face-rarity"><span aria-hidden="true">{gemOf(f.rarity)}</span> {rarityName(f.rarity)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
