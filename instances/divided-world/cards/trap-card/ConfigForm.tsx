/**
 * Trap Card's setting in the play form (the face-down Moves design, section 8): "The card it waits for", a radio group of small card
 * faces, one for every card of the instance that is cast on a post, not only the ones in the setter's hand. The engine hands them over
 * as `castable` (a Use or a Gimmick is never among them, since only a card cast on a post can be caught). What it gives the form is
 * `{ card }`, the key `trapCard.validateConfig` takes (trap-card.ts). The group is native radios, so the arrow keys move between the
 * faces and Space chooses; the chosen face is outlined, and its tag and rarity are words as well as a shape.
 */
import type { CSSProperties } from 'react';
import { gemOf, rarityName } from '../../../../engine/ui/cards/faces.ts';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import './trap-card.css';

export function ConfigForm({ config, onChange, id, castable = [] }: ConfigFormProps) {
  /* Untouched, nothing is chosen: the play form waits for a card, and the player names it. */
  const chosen = typeof config?.card === 'string' && castable.some((f) => f.key === config.card) ? config.card : undefined;

  return (
    <fieldset className="kb-trap-pick">
      <legend className="kb-trap-pick-legend">The card it waits for</legend>
      <div className="kb-trap-faces">
        {castable.map((f) => (
          <label key={f.key} className="kb-trap-face" style={{ '--kb-card-color': f.art.color } as CSSProperties}>
            <input type="radio" name={`${id}-catch`} value={f.key} aria-label={f.name} checked={chosen === f.key} onChange={() => onChange({ card: f.key })} />
            <span className="kb-trap-face-in">
              {f.art.mark ? <img className="kb-trap-face-mark" src={f.art.mark} alt="" draggable={false} /> : <span className="kb-trap-face-mark" aria-hidden="true" />}
              <span className="kb-trap-face-name">{f.name}</span>
              <span className="kb-trap-face-tag">{f.kind}</span>
              <span className="kb-trap-face-rarity"><span aria-hidden="true">{gemOf(f.rarity)}</span> {rarityName(f.rarity)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
