/**
 * Overreaction's setting in the play form (card notes Part 3, Task 11): the emoji the caster adds to one post, and the kind of reaction it
 * scores as. What it gives the form is `{ emoji, quadrant }`, which `overreaction.validateConfig` takes (`localReaction`); a key the player has
 * not given is left out, and the play form waits until both are accepted. The quadrants are the instance's own words, from the engine's
 * context, in the picker's order. The rules' refusal of the emoji (more than one, one the forum already has) shows under the field in their
 * words, once the player has typed something; the quadrant is the radios' own, never refused before they are touched.
 */
import { useId } from 'react';
import { QUADRANTS, type Quadrant } from '../../../../engine/rules/types.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { plainRefusal } from '../../../../engine/ui/cards/faces.ts';
import { overreaction } from '../../cards/overreaction.ts';
import { QuadrantPick } from '../../cards/quadrant-pick/QuadrantPick.tsx';
import './form.css';

export function OverreactionForm({ config, onChange, id }: ConfigFormProps) {
  const { ui } = useKayfa();
  const own = useId();
  const typed = typeof config?.emoji === 'string' ? config.emoji : '';
  const quadrant = QUADRANTS.find((q) => q === config?.quadrant) as Quadrant | undefined;
  /* The emoji alone is asked of the rules, with a quadrant they will take, so what comes back is a word about the emoji. */
  const asked = typed.trim() === '' ? null : overreaction.validateConfig({ emoji: typed, quadrant: 'excitedPositive' });
  const refusal = asked !== null && !asked.ok ? plainRefusal(asked.why) : '';
  const chosen = asked !== null && asked.ok && quadrant !== undefined ? { emoji: asked.value.emoji, label: ui.quadrantLabels[quadrant] } : null;
  const put = (next: { emoji?: string; quadrant?: Quadrant }) => {
    const emoji = 'emoji' in next ? next.emoji : config?.emoji;
    const q = 'quadrant' in next ? next.quadrant : quadrant;
    onChange({ ...(emoji !== undefined ? { emoji } : {}), ...(q !== undefined ? { quadrant: q } : {}) });
  };
  return (
    <div className="dw-overreaction-form">
      <div className="dw-overreaction-field">
        <label htmlFor={`${own}-emoji`} className="dw-overreaction-label">Emoji</label>
        <input
          id={`${own}-emoji`} type="text" className="dw-overreaction-input" inputMode="text" autoComplete="off" value={typed}
          aria-invalid={refusal !== '' ? true : undefined} aria-describedby={`${own}-help${refusal !== '' ? ` ${own}-why` : ''}`}
          onChange={(e) => put({ emoji: e.target.value })}
        />
        <p id={`${own}-help`} className="dw-overreaction-help">One emoji. Your keyboard's emoji picker works here.</p>
        {refusal !== '' && <p id={`${own}-why`} className="dw-overreaction-why" role="alert">{refusal}</p>}
      </div>
      <QuadrantPick legend="Scores as" id={id} value={quadrant} onChange={(picked) => put({ quadrant: picked.quadrant })} />
      {chosen !== null && <p className="dw-overreaction-say">{chosen.emoji} will score as {chosen.label} on this post.</p>}
    </div>
  );
}
