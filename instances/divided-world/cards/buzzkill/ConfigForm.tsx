/**
 * Buzzkill's setting in the play form: "The Gimmick it ends", one radio per Gimmick up on the target (`gimmicks`, oldest first), each drawn
 * as its card's small face (as `FacePick` draws one) with its name, and `ends <time>` where it has an end. Native radios, so the arrow keys
 * move between them and Space chooses; the chosen one is outlined. What it gives the form is `{ play }`, the key `buzzkill.validateConfig`
 * takes. A card's name and face come from the instance's own cards, read from the context as the play form reads them.
 */
import { useMemo, type CSSProperties } from 'react';
import type { ConfigFormProps } from '../../../../engine/ui/cards/types.ts';
import { faceOf, gemOf, rarityName } from '../../../../engine/ui/cards/faces.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import '../card-collector/card-collector.css';

const when = (iso: string): string => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ConfigForm({ config, onChange, id, gimmicks = [] }: ConfigFormProps) {
  const { instance, ui } = useKayfa();
  const faces = useMemo(
    () => new Map(instance.cards.map((r) => [r.key, faceOf(r, ui.cards.find((c) => c.key === r.key), instance.settings, ui.copy.cardKinds)] as const)),
    [instance.cards, instance.settings, ui.cards, ui.copy.cardKinds],
  );
  const chosen = typeof config?.play === 'string' && gimmicks.some((g) => g.play === config.play) ? config.play : undefined;
  return (
    <fieldset className="kb-trap-pick">
      <legend className="kb-trap-pick-legend">The Gimmick it ends</legend>
      {gimmicks.length === 0 ? (
        <p>Nothing here to end.</p>
      ) : (
        <div className="kb-trap-faces">
          {gimmicks.map((g) => {
            const f = faces.get(g.card);
            return (
              <label key={g.play} className="kb-trap-face" style={f ? ({ '--kb-card-color': f.art.color } as CSSProperties) : undefined}>
                <input type="radio" name={`${id}-gimmick`} value={g.play} checked={chosen === g.play} onChange={() => onChange({ play: g.play })} />
                <span className="kb-trap-face-in">
                  {f?.art.mark ? <img className="kb-trap-face-mark" src={f.art.mark} alt="" draggable={false} /> : <span className="kb-trap-face-mark" aria-hidden="true" />}
                  <span className="kb-trap-face-name">{f?.name ?? g.card}</span>{' '}
                  {f && <span className="kb-trap-face-tag">{f.kind}</span>}{' '}
                  {f && <span className="kb-trap-face-rarity"><span aria-hidden="true">{gemOf(f.rarity)}</span> {rarityName(f.rarity)}</span>}
                  {g.ends && <>{' '}<span className="kb-trap-face-ends">ends <time dateTime={g.ends}>{when(g.ends)}</time></span></>}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
