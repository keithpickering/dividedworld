/**
 * A character's full public record at /c/:id/record: its Acts, paged twenty to a page and filtered
 * by kind (?kind=post|spin|card|class, ?page=N; links, not a form). "All" is the character's own
 * Acts (posts, spins, card plays); its reveals and announced Turns are the "Class statements"
 * filter and its past seasons the "Seasons" filter, short lists read whole and paged here. Out of character and plain.
 */
import { useMemo } from 'react';
import { useKayfa } from '../context.tsx';
import type { ActKind, CharacterCounts, Id, RecordPage } from '../data/api.ts';
import { Ago, PageLinks } from '../mini.tsx';
import { FrontDoor } from '../front-door/FrontDoor.tsx';
import { Link } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { RECORD_KINDS, RECORD_LABELS, RECORD_PAGE, SEASONS_SHOWN, actRow, mergeWindow, newest, playLinksFrom, revealRow, seasonRow, turnLinksFrom, turnRow, type RecordKind, type RecordRow, type Words } from './record.ts';
import './profile.css';

export const recordHref = (id: Id, kind: RecordKind, page = 1): string => {
  const q = new URLSearchParams();
  if (kind !== 'all') q.set('kind', kind);
  if (page > 1) q.set('page', String(page));
  const s = q.toString();
  return `/c/${id}/record${s ? `?${s}` : ''}`;
};

/** The rows of a record page and how many the kind has, from its document: the extras (reveals, Turns, seasons) merged with the window of Acts the server read. */
function rowsOfPage(doc: RecordPage, words: Words): { readonly rows: readonly RecordRow[]; readonly total: number } {
  const { kind, page, windowFrom } = doc;
  const offset = (page - 1) * RECORD_PAGE;
  const links = turnLinksFrom(doc.targets, words.perPage);
  const plays = playLinksFrom(doc.targets, doc.acts, words.perPage);
  /* A kind's total is the character's counters, one row, never a count of its Acts. */
  const totalOf = (counts: CharacterCounts) => (kind === 'all' ? counts.posts + counts.spins + counts.cards : kind === 'post' ? counts.posts : kind === 'spin' ? counts.spins : counts.cards);
  const paged = (all: readonly RecordRow[]) => ({ rows: all.slice(offset, offset + RECORD_PAGE), total: all.length });
  const reveals = doc.reveals.map((x) => revealRow(x, words));
  const turns = doc.turns.map((x) => turnRow(x, words, links));
  if (kind === 'class') return paged(newest([...reveals, ...turns]));
  if (kind === 'seasons') return paged(doc.seasons.slice(0, SEASONS_SHOWN).map((a) => seasonRow(a, doc.character.id, words)));
  const acts = doc.acts.map((a) => actRow(a, words, plays));
  if (kind === 'all') {
    const more = newest([...reveals, ...turns, ...doc.seasons.map((a) => seasonRow(a, doc.character.id, words))]);
    return { rows: mergeWindow(more, acts, windowFrom, offset, RECORD_PAGE), total: totalOf(doc.counts) + more.length };
  }
  return { rows: acts, total: totalOf(doc.counts) };
}

/** The record draws its document (the forum-load plan, Task 13): whole on the first frame; a page or a kind is another document, reached by a navigation. Signed out, the marker is the front door. */
export function RecordScreen({ id, doc }: { readonly id: Id; readonly doc: ScreenDoc<RecordPage> }) {
  if (isSignedOutDoc(doc)) return <FrontDoor />;
  return <Record id={id} doc={doc} />;
}

function Record({ id, doc }: { readonly id: Id; readonly doc: RecordPage }) {
  const { instance, settings } = useKayfa();
  const { kind, page } = doc;
  const loaded = useMemo(() => rowsOfPage(doc, {
    className: (k) => instance.classes.find((c) => c.key === k)?.name ?? k,
    cardName: (k) => instance.cards.find((c) => c.key === k)?.name ?? (k || 'a card'),
    perPage: settings.postsPerPage,
  }), [doc, instance, settings.postsPerPage]);
  const name = doc.character.name;
  return (
    <div className="kb-record">
      <p className="kb-crumb"><Link to="/">Index</Link> › <Link to={`/c/${id}`}>{name}</Link> › Public record</p>
      <h1 className="kb-heading">{name}’s public record</h1>
      <nav aria-label="Kind of row">
        <ul className="kb-record-kinds">
          {RECORD_KINDS.map((k) => (
            <li key={k}>
              {k === kind
                ? <span className="kb-button kb-record-kind" data-kb-size="small" aria-current="page">{RECORD_LABELS[k]}</span>
                : <Link className="kb-button kb-record-kind" data-kb-size="small" to={recordHref(id, k)}>{RECORD_LABELS[k]}</Link>}
            </li>
          ))}
        </ul>
      </nav>
      {kind === 'seasons' && <p className="kb-small kb-muted">The latest {SEASONS_SHOWN} seasons.</p>}
      {kind === 'all' && <p className="kb-small kb-muted">Its Acts with its reveals, announced Turns and past seasons, newest first.</p>}
      <Rows id={id} kind={kind} page={page} rows={loaded.rows} total={loaded.total} />
    </div>
  );
}

function Rows({ id, kind, page, rows, total }: { readonly id: Id; readonly kind: RecordKind; readonly page: number; readonly rows: readonly RecordRow[]; readonly total: number }) {
  const pages = Math.max(1, Math.ceil(total / RECORD_PAGE));
  return (
    <>
      {rows.length === 0
        ? <p>{total === 0 ? 'Nothing yet.' : 'Nothing on this page.'}</p>
        : (
          <table className="kb-table kb-record-table" role="table">
            <caption className="kb-visually-hidden">Public record, newest first</caption>
            <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">When</th><th role="columnheader" scope="col">What</th></tr></thead>
            <tbody role="rowgroup">
              {rows.map((r) => (
                <tr key={r.key} role="row">
                  <td role="cell" className="kb-small"><Ago at={r.at} /></td>
                  <td role="cell">{r.href ? <Link to={r.href}>{r.text}</Link> : r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <PageLinks label="Pages of the record" page={page} pages={pages} href={(p) => recordHref(id, kind, p)} />
    </>
  );
}
