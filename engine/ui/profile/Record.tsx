/**
 * A character's full public record at /c/:id/record: its Acts, paged twenty to a page and filtered
 * by kind (?kind=post|spin|card|class, ?page=N; links, not a form). "All" is the character's own
 * Acts (posts, spins, card plays); its reveals and announced Turns are the "Class statements"
 * filter and its past seasons' reveal posts the "Seasons" filter, short lists read whole and paged here. Out of character and plain.
 */
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { ActKind, Id } from '../data/api.ts';
import { Ago, PageLinks, SignInPrompt, useSignedIn } from '../mini.tsx';
import { Link, useLocation } from '../router.tsx';
import { RECORD_KINDS, RECORD_LABELS, RECORD_PAGE, actRow, newest, recordKind, revealRow, seasonRow, turnLinks, turnRow, type RecordKind, type RecordRow, type Words } from './record.ts';
import { useCharacter } from './useCharacter.ts';
import './profile.css';

/** A page number past any real record is read as this one: an offset the server answers plainly. */
const MAX_PAGE = 10_000;

export const recordHref = (id: Id, kind: RecordKind, page = 1): string => {
  const q = new URLSearchParams();
  if (kind !== 'all') q.set('kind', kind);
  if (page > 1) q.set('page', String(page));
  const s = q.toString();
  return `/c/${id}/record${s ? `?${s}` : ''}`;
};

const KINDS: Readonly<Record<Exclude<RecordKind, 'class' | 'seasons'>, readonly ActKind[]>> = { all: ['post', 'spin', 'card'], post: ['post'], spin: ['spin'], card: ['card'] };

type Loaded = { readonly status: 'loading' } | { readonly status: 'failed' } | { readonly status: 'ready'; readonly rows: readonly RecordRow[]; readonly total: number };

export function RecordScreen({ id }: { readonly id: Id }) {
  const { api, instance, settings } = useKayfa();
  const signedIn = useSignedIn(api);
  const { query } = useLocation();
  const kind = recordKind(query.get('kind'));
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(query.get('page') ?? '', 10) || 1));
  const found = useCharacter(api, id);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    if (found.status !== 'ready') return;
    let live = true;
    setLoaded({ status: 'loading' });
    const words: Words = {
      className: (k) => instance.classes.find((c) => c.key === k)?.name ?? k,
      cardName: (k) => instance.cards.find((c) => c.key === k)?.name ?? (k || 'a card'),
      perPage: settings.postsPerPage,
    };
    const offset = (page - 1) * RECORD_PAGE;
    const paged = (all: readonly RecordRow[]) => ({ rows: all.slice(offset, offset + RECORD_PAGE), total: all.length });
    const read = kind === 'class'
      ? Promise.all([api.classReveals([id]), api.turnsAnnounced([id])]).then(async ([r, t]) => {
        const links = await turnLinks(api, t, words.perPage);
        return paged(newest([...r.map((x) => revealRow(x, words)), ...t.map((x) => turnRow(x, words, links))]));
      })
      : kind === 'seasons'
        ? api.characterReveals(id).then((list) => paged(list.map((a) => seasonRow(a, words))))
        : api.characterActs(id, KINDS[kind], { offset, limit: RECORD_PAGE }).then((r) => ({ rows: r.acts.map((a) => actRow(a, words)), total: r.total }));
    read.then((r) => { if (live) setLoaded({ status: 'ready', ...r }); }, () => { if (live) setLoaded({ status: 'failed' }); });
    return () => { live = false; };
  }, [api, id, kind, page, found.status, instance, settings.postsPerPage]);

  if (signedIn === null || found.status === 'loading') return <div className="kb-record" aria-busy="true" />;
  if (!signedIn) return <div className="kb-record"><SignInPrompt /></div>;
  if (found.status === 'failed') return <div className="kb-record"><p className="kb-notice" data-kb-tone="refusal">The record could not be loaded. Reload the page to try again.</p></div>;
  if (found.status === 'missing') return <NotFound />;
  const name = found.character.name;
  return (
    <div className="kb-record">
      <p className="kb-crumb"><Link to="/">Index</Link> › <Link to={`/c/${id}`}>{name}</Link> › Public record</p>
      <h1 className="kb-heading">{name}’s public record</h1>
      <nav className="kb-record-kinds kb-small" aria-label="Kind of row">
        {RECORD_KINDS.map((k) => (k === kind
          ? <span key={k} className="kb-record-kind" aria-current="true">{RECORD_LABELS[k]}</span>
          : <Link key={k} className="kb-record-kind" to={recordHref(id, k)}>{RECORD_LABELS[k]}</Link>))}
      </nav>
      {loaded.status === 'failed' && <p className="kb-notice" data-kb-tone="refusal">The record could not be loaded. Reload the page to try again.</p>}
      {loaded.status === 'loading' && <p className="kb-muted" aria-busy="true">Loading…</p>}
      {loaded.status === 'ready' && <Rows id={id} kind={kind} page={page} rows={loaded.rows} total={loaded.total} />}
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
          <table className="kb-table kb-record-table">
            <caption className="kb-visually-hidden">Public record, newest first</caption>
            <thead><tr><th scope="col">When</th><th scope="col">What</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="kb-small"><Ago at={r.at} /></td>
                  <td>{r.href ? <Link to={r.href}>{r.text}</Link> : r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <PageLinks label="Pages of the record" page={page} pages={pages} href={(p) => recordHref(id, kind, p)} />
    </>
  );
}

export function NotFound() {
  return (
    <div className="kb-record">
      <h1 className="kb-heading">No such character</h1>
      <p>There is no character at this address. <Link to="/">Back to the index</Link>.</p>
    </div>
  );
}
