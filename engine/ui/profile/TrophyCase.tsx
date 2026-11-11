/**
 * A character's trophy case (the cosmetics design, section 4; board 03 and the house theme's 08-profile): every standing award, newest first, each
 * with its picture (the image carries the trophy's name), the words it was given with, and who gave it in plain words ("an admin", "the season",
 * the Boss's name) and when. Never which account: the server's `by` is already the plain phrase. A reversed award is absent, since the server
 * does not send it. Older awards come by "More trophies", from the cursor the last row gives. Under the case, each belt in it has its lineage
 * (`beltLineage`): its holders newest first, a page at a time ("Earlier holders"), each reign's span and how it began, a holder a link to its profile. An award links to its
 * move or its season; the last column says which the mask shows on posts, and a held belt says since when.
 *
 * The profile's document carries only the shown few, so the case is read once the page stands. A failed read says so and offers the read again.
 * Out of character and plain.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { BeltReign, Id, TrophyItem } from '../data/api.ts';
import { seasonAt } from '../season/address.ts';
import { TrophyBadge } from '../postbit/Trophy.tsx';
import { shortDate } from '../postbit/dates.ts';
import { Link } from '../router.tsx';

/** A belt's reigns read so far (newest first), whether earlier ones remain, whether a read of them is under way, and whether the last such read failed; or that the first read failed. */
type Lineage = { readonly reigns: readonly BeltReign[]; readonly more: boolean; readonly paging: boolean; readonly error: boolean };
type Lineages = Readonly<Record<string, Lineage | 'failed'>>;

/** Where an award came from, as a link: the Boss's move or a met demand's (the post it stands in), or the season's results; an admin's has none. */
const source = (t: TrophyItem) => {
  if (t.move) return <> · <Link to={`/t/${encodeURIComponent(t.move.thread)}#post-${t.move.seq}`}>{t.by === 'a met demand' ? 'the move' : 'its post'}</Link></>;
  if (t.season !== null) return <> · <Link to={seasonAt('rankings', undefined, t.season)}>season {t.season}</Link></>;
  return null;
};

export function TrophyCase({ character, name }: { readonly character: Id; readonly name: string }) {
  const { api } = useKayfa();
  const [items, setItems] = useState<readonly TrophyItem[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [paging, setPaging] = useState(false);
  const [lineages, setLineages] = useState<Lineages>({});
  const [olderFailed, setOlderFailed] = useState(false);
  const asked = useRef(new Set<string>());
  /* `run` numbers the reads of the first page, `gen` the character the case is for: an answer that is not for the latest of either is dropped, so a re-render never drops a read that is still wanted. */
  const run = useRef(0);
  const gen = useRef(0);
  const reading = useRef(false);

  const first = useCallback(() => {
    const mine = ++run.current;
    reading.current = true;
    setState('loading');
    api.trophies(character).then(
      (page) => { if (run.current === mine) { reading.current = false; setItems(page.awards); setMore(page.more); setOlderFailed(false); setState('ready'); } },
      () => { if (run.current === mine) { reading.current = false; setState('failed'); } },
    );
  }, [api, character]);
  useEffect(() => {
    gen.current += 1;
    asked.current = new Set();
    setLineages({});
    first();
    return () => { run.current += 1; };
  }, [first]);

  const older = () => {
    const last = items[items.length - 1];
    if (!last || paging) return;
    const mine = gen.current;
    setPaging(true);
    setOlderFailed(false);
    api.trophies(character, { before: last.at, beforeId: last.award }).then(
      (page) => { if (gen.current !== mine) return; setItems((now) => [...now, ...page.awards]); setMore(page.more); setPaging(false); },
      () => { if (gen.current !== mine) return; setPaging(false); setOlderFailed(true); },
    );
  };

  /* Each belt in the case, once: its lineage is read when the belt first appears (the first page, or an older one). */
  const belts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of items) if (t.belt && !seen.has(t.trophy)) seen.set(t.trophy, t.name);
    return [...seen];
  }, [items]);
  const readLineage = useCallback((key: string) => {
    const mine = gen.current;
    asked.current.add(key);
    const set = (to: Lineage | 'failed') => { if (gen.current === mine) setLineages((now) => ({ ...now, [key]: to })); };
    api.beltLineage(key).then(
      (a) => { set(a.ok ? { reigns: a.value.reigns, more: a.value.more, paging: false, error: false } : 'failed'); },
      () => { set('failed'); },
    );
  }, [api]);
  useEffect(() => {
    for (const [key] of belts) if (!asked.current.has(key)) readLineage(key);
  }, [belts, readLineage]);

  const retryLineage = (key: string) => {
    if (lineages[key] !== 'failed') return;
    setLineages((now) => { const { [key]: _gone, ...rest } = now; return rest; });
    readLineage(key);
  };

  const earlier = (key: string) => {
    const now = lineages[key];
    const last = now && now !== 'failed' ? now.reigns[now.reigns.length - 1] : undefined;
    if (!now || now === 'failed' || !last || now.paging) return;
    const mine = gen.current;
    setLineages((all) => ({ ...all, [key]: { ...now, paging: true, error: false } }));
    const settle = (to: (cur: Lineage) => Lineage) => { if (gen.current === mine) setLineages((all) => { const cur = all[key]; return !cur || cur === 'failed' ? all : { ...all, [key]: to(cur) }; }); };
    api.beltLineage(key, { before: last.began, beforeId: last.award }).then(
      (a) => { settle((cur) => (a.ok ? { reigns: [...cur.reigns, ...a.value.reigns], more: a.value.more, paging: false, error: false } : { ...cur, paging: false, error: true })); },
      () => { settle((cur) => ({ ...cur, paging: false, error: true })); },
    );
  };

  if (state === 'failed') return <section className="kb-profile-trophies" aria-label="Trophy case"><p>The trophy case could not be read. <button type="button" className="kb-link" onClick={() => { if (!reading.current) first(); }}>Try again</button></p></section>;
  if (state === 'loading' || items.length === 0) return null;
  return (
    <section className="kb-profile-trophies" aria-label="Trophy case">
      <table className="kb-table kb-trophies" role="table">
        <caption className="kb-visually-hidden">{name}'s trophies, newest first</caption>
        <thead role="rowgroup"><tr role="row"><td role="cell" className="kb-bar" colSpan={3}><h2>Trophy case</h2></td></tr></thead>
        <tbody role="rowgroup">
          {items.map((t) => (
            <tr key={t.award} role="row">
              <td role="cell" className="kb-trophy-badge"><TrophyBadge trophy={t} /></td>
              <td role="cell" className="kb-trophy-what">
                <b className="kb-trophy-name">{t.name}</b>{t.line && <> · “{t.line}”</>}{t.belt && t.held && <> · champion since {shortDate(t.at)}</>}
                <br />
                <span className="kb-trophy-by kb-small kb-muted">Given by {t.by}, {shortDate(t.at)}{source(t)}</span>
              </td>
              <td role="cell" className="kb-trophy-shown kb-small">{t.shown || (t.belt && t.held) ? 'On posts' : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {olderFailed
        ? <p className="kb-small kb-profile-all">The earlier trophies could not be read. <button type="button" className="kb-link" onClick={older}>Try again</button></p>
        : more && <p className="kb-small kb-profile-all"><button type="button" className="kb-link" disabled={paging} onClick={older}>More trophies</button></p>}
      {belts.map(([key, belt]) => {
        const lineage = lineages[key];
        if (!lineage) return null;
        if (lineage === 'failed') return <p key={key} className="kb-small kb-profile-all">The {belt}'s lineage could not be read. <button type="button" className="kb-link" onClick={() => { retryLineage(key); }}>Try again</button></p>;
        const reigns = lineage.reigns;
        return (
          <Fragment key={key}>
          <table className="kb-table kb-lineage" role="table">
            <caption className="kb-visually-hidden">The {belt}'s holders, newest first</caption>
            <thead role="rowgroup"><tr role="row"><td role="cell" className="kb-bar" colSpan={3}><h2>The {belt}'s lineage</h2></td></tr></thead>
            <tbody role="rowgroup">
              {reigns.map((r) => (
                <tr key={r.award} role="row">
                  <td role="cell"><Link to={`/c/${encodeURIComponent(r.character)}`}>{r.name}</Link></td>
                  <td role="cell" className="kb-lineage-span kb-small">{shortDate(r.began)} – {r.ended ? shortDate(r.ended) : 'now'}</td>
                  <td role="cell" className="kb-lineage-by kb-small kb-muted">by {r.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lineage.error && <p className="kb-small kb-profile-all">The earlier holders could not be read.</p>}
          {lineage.more && <p className="kb-small kb-profile-all"><button type="button" className="kb-link" disabled={lineage.paging} onClick={() => { earlier(key); }}>{lineage.error ? 'Try again' : 'Earlier holders'}</button></p>}
          </Fragment>
        );
      })}
    </section>
  );
}
