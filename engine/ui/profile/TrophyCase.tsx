/**
 * A character's trophy case (the cosmetics design, section 4; board 03 and the house theme's 08-profile): every standing award, newest first, each
 * with its picture (the image carries the trophy's name), the words it was given with, and who gave it in plain words ("an admin", "the season",
 * the Boss's name) and when. Never which account: the server's `by` is already the plain phrase. A reversed award is absent, since the server
 * does not send it. Older awards come by "More trophies", from the cursor the last row gives. Under the case, each belt in it has its lineage
 * (`beltLineage`): its holders newest first, each reign's span, a holder a link to its profile.
 *
 * The profile's document carries only the shown few, so the case is read once the page stands. A failed read says so and offers the read again.
 * Out of character and plain.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { BeltReign, Id, TrophyItem } from '../data/api.ts';
import { TrophyBadge } from '../postbit/Trophy.tsx';
import { shortDate } from '../postbit/dates.ts';
import { Link } from '../router.tsx';

type Lineages = Readonly<Record<string, readonly BeltReign[] | 'failed'>>;

export function TrophyCase({ character, name }: { readonly character: Id; readonly name: string }) {
  const { api } = useKayfa();
  const [items, setItems] = useState<readonly TrophyItem[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [paging, setPaging] = useState(false);
  const [lineages, setLineages] = useState<Lineages>({});
  const asked = useRef(new Set<string>());

  const first = useCallback(() => {
    let live = true;
    setState('loading');
    api.trophies(character).then(
      (page) => { if (live) { setItems(page.awards); setMore(page.more); setState('ready'); } },
      () => { if (live) setState('failed'); },
    );
    return () => { live = false; };
  }, [api, character]);
  useEffect(() => {
    asked.current = new Set();
    setLineages({});
    return first();
  }, [first]);

  const older = () => {
    const last = items[items.length - 1];
    if (!last || paging) return;
    setPaging(true);
    api.trophies(character, { before: last.at, beforeId: last.award }).then(
      (page) => { setItems((now) => [...now, ...page.awards]); setMore(page.more); setPaging(false); },
      () => { setPaging(false); },
    );
  };

  /* Each belt in the case, once: its lineage is read when the belt first appears (the first page, or an older one). */
  const belts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of items) if (t.belt && !seen.has(t.trophy)) seen.set(t.trophy, t.name);
    return [...seen];
  }, [items]);
  useEffect(() => {
    let live = true;
    for (const [key] of belts) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      api.beltLineage(key).then(
        (a) => { if (live) setLineages((now) => ({ ...now, [key]: a.ok ? a.value : 'failed' })); },
        () => { if (live) setLineages((now) => ({ ...now, [key]: 'failed' })); },
      );
    }
    return () => { live = false; };
  }, [api, belts]);

  if (state === 'failed') return <section className="kb-profile-trophies" aria-label="Trophy case"><p>The trophy case could not be read. <button type="button" className="kb-link" onClick={() => { first(); }}>Try again</button></p></section>;
  if (state === 'loading' || items.length === 0) return null;
  return (
    <section className="kb-profile-trophies" aria-label="Trophy case">
      <table className="kb-table kb-trophies" role="table">
        <caption className="kb-visually-hidden">{name}'s trophies, newest first</caption>
        <thead role="rowgroup"><tr role="row"><td role="cell" className="kb-bar" colSpan={2}><h2>Trophy case</h2></td></tr></thead>
        <tbody role="rowgroup">
          {items.map((t) => (
            <tr key={t.award} role="row">
              <td role="cell" className="kb-trophy-badge"><TrophyBadge trophy={t} /></td>
              <td role="cell" className="kb-trophy-what">
                <b className="kb-trophy-name">{t.name}</b>{t.line && <> · “{t.line}”</>}
                <br />
                <span className="kb-trophy-by kb-small kb-muted">Given by {t.by}, {shortDate(t.at)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {more && <p className="kb-small kb-profile-all"><button type="button" className="kb-link" disabled={paging} onClick={older}>More trophies</button></p>}
      {belts.map(([key, belt]) => {
        const reigns = lineages[key];
        if (!Array.isArray(reigns)) return null;
        return (
          <table key={key} className="kb-table kb-lineage" role="table">
            <caption className="kb-visually-hidden">The {belt}'s holders, newest first</caption>
            <thead role="rowgroup"><tr role="row"><td role="cell" className="kb-bar" colSpan={2}><h2>The {belt}'s lineage</h2></td></tr></thead>
            <tbody role="rowgroup">
              {[...reigns].reverse().map((r) => (
                <tr key={r.award} role="row">
                  <td role="cell"><Link to={`/c/${encodeURIComponent(r.character)}`}>{r.name}</Link></td>
                  <td role="cell" className="kb-lineage-span kb-small">{shortDate(r.began)} – {r.ended ? shortDate(r.ended) : 'now'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </section>
  );
}
