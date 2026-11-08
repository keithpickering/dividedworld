/**
 * A pack's odds, stated plainly (the booster packs design, section 5: "the slot shows its odds plainly, pull by pull, and each card's chance in
 * the hit pull. The machine is glass, and the glass speaks plainly"): one block for the pulls that roll alike ("Cards 1 to 4, each", a row for each
 * rarity and its chance), and one for the hit, the last pull (a row for each card and its chance of that pull). A rarity is drawn as a gem, as the card
 * face draws it, its glyph saying the rarity by shape in a rotated tile, never by color alone. The odds come from the rules (`packOdds`), the same
 * numbers the server rolls with.
 */
import { gemOf } from '../cards/faces.ts';
import { percent, type OddsGroup } from './machine-words.ts';

export function PackOdds({ name, groups }: { readonly name: string; readonly groups: readonly OddsGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <table className="kb-vending-odds">
      <caption>{name} odds</caption>
      {groups.map((g) => (
        <tbody key={g.heading}>
          <tr><th scope="rowgroup" colSpan={2}>{g.heading}</th></tr>
          {g.rows.map((r) => (
            <tr key={r.key}>
              <td><span className="kb-vending-odds-who"><span className="kb-gem" aria-hidden="true" data-kb-rarity={r.rarity} data-kb-gem={gemOf(r.rarity)} />{r.label}</span></td>
              <td>{percent(r.chance)}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
