/**
 * Alerts at /alerts (the alerts plan, Task 9; the alerts design, sections 2, 4, 9 and 12; board docs/research/2026-11-02-alerts/02-alerts.html): a glass
 * page under the menu bar for the player's own alerts and the two kinds every player gets (an update, season news), newest first. Filters: All and one
 * per character, as My log has them. A divider at the account's mark ("new since you last looked") with what arrived after it above and Earlier below;
 * the divider is drawn at the mark as it stood when the page opened, and stays there while the page is open though opening moves the mark. Each row is
 * an icon in its kind's ink, the line, its link or way out, the character it concerns (or whose it is) and when (UTC). Cards played on one target among
 * the new rows are one row. Older reads the next page.
 *
 * A followed thread's row offers Unfollow, the way out of a follow ("No player is ever stuck"); the thread page offers the same. An alert is a nudge and
 * not a state: the list is a read, and what is new falls away by opening it.
 *
 * Plain and true ("The fiction may lie; the log never does"): the words are words.ts's, and nothing here names a caster or a reactor, or says anything the
 * board does not. Which filter is open is the page's own state, never the address: an address that named one of the player's characters would say whose
 * they are to anyone it reached.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Alert, AlertKind, Id } from '../data/api.ts';
import { utcWhen } from '../log/lines.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { rowKey, useAlerts, type AlertsRead } from './useAlerts.ts';
import { batchWords, targetKey, wordsFor, type Part, type Said, type WordsContext } from './words.ts';
import './alerts.css';

/** One line of the list: a single alert, or the cards played on one target among the new. */
interface Item { readonly key: string; readonly rows: readonly Alert[] }

/** The rows in order, with the cards on one target among the new ones (after `mark`) gathered into the place of the newest. */
export function itemsOf(rows: readonly Alert[], ctx: WordsContext, mark: string | null): Item[] {
  const fresh = (r: Alert) => mark === null || Date.parse(r.at) > Date.parse(mark);
  const items: { key: string; rows: Alert[] }[] = [];
  const batches = new Map<string, { key: string; rows: Alert[] }>();
  for (const r of rows) {
    const target = fresh(r) ? targetKey(r, ctx) : null;
    const batch = target === null ? undefined : batches.get(target);
    if (batch) { batch.rows.push(r); continue; }
    const item = { key: rowKey(r), rows: [r] };
    items.push(item);
    if (target !== null) batches.set(target, item);
  }
  return items;
}

const Words = ({ parts }: { readonly parts: readonly Part[] }) => (
  <>{parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : <i key={i}>{p.em}</i>))}</>
);

/** The ink of each kind's icon: followed threads and quotes in the neon, cards, traps and rulings in the salty, settlements and hints in the ready, news in the pale. */
const SHAPES: Readonly<Record<AlertKind, React.ReactNode>> = {
  followed: <><path d="M6 7h20M6 13h20M6 19h13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><circle cx="24" cy="22" r="4" fill="currentColor" stroke="none" /></>,
  quote: <><path d="M6 9h20v12H15l-6 5v-5H6z" fill="none" strokeWidth="2.2" strokeLinejoin="round" /><path d="M11 14h10M11 17.5h6" strokeWidth="2" strokeLinecap="round" /></>,
  cardOnYours: <><rect x="8" y="5" width="16" height="22" rx="2" fill="none" strokeWidth="2.2" /><path d="M12 12l8 8M20 12l-8 8" strokeWidth="2" strokeLinecap="round" /></>,
  trapStruck: <><path d="M7 25h12M10 21h6M13 21V13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><rect x="11" y="4" width="14" height="7" rx="1" transform="rotate(35 18 7.5)" fill="none" strokeWidth="2.2" /></>,
  trapSprang: <><path d="M7 25h12M10 21h6M13 21V13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><rect x="11" y="4" width="14" height="7" rx="1" transform="rotate(35 18 7.5)" fill="none" strokeWidth="2.2" /></>,
  ruling: <><path d="M7 25h12M10 21h6M13 21V13" strokeWidth="2.2" strokeLinecap="round" fill="none" /><rect x="11" y="4" width="14" height="7" rx="1" transform="rotate(35 18 7.5)" fill="none" strokeWidth="2.2" /></>,
  hint: <path d="M16 4c1 5 7 7 7 14a7 7 0 0 1-14 0c0-4 2-6 3-8 1 3 2 4 4 4-1-4-1-7 0-10z" fill="none" strokeWidth="2.2" strokeLinejoin="round" />,
  settlement: <><circle cx="16" cy="16" r="10" fill="none" strokeWidth="2.2" /><path d="M16 10v6l4 3" strokeWidth="2.2" strokeLinecap="round" fill="none" /></>,
  update: <><rect x="5" y="6" width="22" height="20" fill="none" strokeWidth="2.2" /><path d="M5 11h22M10 16h12M10 20h8" strokeWidth="2" strokeLinecap="round" /></>,
  seasonNews: <path d="M9 5h14v6a7 7 0 0 1-14 0zM9 8H5a4 4 0 0 0 4 5M23 8h4a4 4 0 0 1-4 5M16 18v4M11 27h10M13 22h6" fill="none" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />,
};

function Icon({ kind }: { readonly kind: AlertKind }) {
  return <svg className="kb-alerts-ico" aria-hidden="true" viewBox="0 0 32 32" stroke="currentColor">{SHAPES[kind]}</svg>;
}

interface RowProps {
  readonly item: Item;
  readonly said: Said;
  readonly fresh: boolean;
  /** The player's character the row is tagged with, or null for a row that is no character's. */
  readonly character: Id | null;
  readonly note: string | undefined;
  readonly onUnfollow: (thread: Id) => void;
}

function Row({ item, said, fresh, character, note, onUnfollow }: RowProps) {
  const row = item.rows[0]!;
  return (
    <li className="kb-alerts-row" data-kb-kind={row.kind} data-kb-new={fresh ? '' : undefined} data-kb-key={item.key}>
      <Icon kind={row.kind} />
      <div>
        <p className="kb-alerts-line"><Words parts={said.line} /></p>
        <p className="kb-alerts-detail">
          <Words parts={said.detail} />
          {said.ways.map((w, i) => (
            <span key={w.to + w.text}>
              {i === 0 && said.detail.length > 0 ? ' ' : i > 0 ? ' · ' : ''}
              <Link to={w.to} state={w.state}>{w.text}</Link>
            </span>
          ))}
          {row.kind === 'followed' && row.thread !== null && (
            <span>{said.ways.length > 0 || said.detail.length > 0 ? ' · ' : ''}<button type="button" className="kb-alerts-unfollow" aria-label={row.title ? `Unfollow \u2018${row.title}\u2019` : 'Unfollow this thread'} onClick={() => onUnfollow(row.thread!)}>Unfollow</button></span>
          )}
        </p>
        {note !== undefined && <p className="kb-alerts-note" role="alert">{note}</p>}
      </div>
      <span className="kb-alerts-who" data-kb-all={character === null ? '' : undefined}>{said.who}</span>
      <time dateTime={row.at}>{utcWhen(row.at)} UTC</time>
    </li>
  );
}

export interface AlertsProps {
  readonly data: AlertsRead;
  readonly older: 'idle' | 'loading' | 'failed';
  readonly onOlder: () => void;
  readonly onUnfollow: (thread: Id) => void;
  /** Why an Unfollow was refused, by the row's thread. */
  readonly notes: ReadonlyMap<Id, string>;
}

/** The page, handed what was read. */
export function Alerts({ data, older, onOlder, onUnfollow, notes }: AlertsProps) {
  const { instance, ui, settings } = useKayfa();
  const [picked, setPicked] = useState<Id | null>(null);
  /* The filters in the order the characters debuted, then by name, as My log's tabs are. */
  const since = (c: { readonly debutedAt: string | null }) => (c.debutedAt === null ? Infinity : Date.parse(c.debutedAt));
  const mine = [...data.mine].sort((a, b) => since(a) - since(b) || a.name.localeCompare(b.name));
  const current = mine.find((c) => c.id === picked) ?? null;
  /* A followed thread is the character's that started it, where one of the player's did. */
  const startedBy = new Map([...data.started].flatMap(([thread, c]) => { const name = data.mine.find((m) => m.id === c)?.name; return name === undefined ? [] : [[thread, name] as const]; }));
  const characterOf = (r: Alert): Id | null => r.character ?? (r.kind === 'followed' && r.thread !== null ? data.started.get(r.thread) ?? null : null);
  const ctx: WordsContext = {
    instance, ui, acts: data.acts, reading: data.reading, startedBy, perPage: settings.postsPerPage,
    newestSettlement: data.rows.find((r) => r.kind === 'settlement')?.sub ?? null,
  };
  const shown = current === null ? data.rows : data.rows.filter((r) => characterOf(r) === current.id);
  const items = itemsOf(shown, ctx, data.mark);
  const isNew = (i: Item) => data.mark === null || Date.parse(i.rows[0]!.at) > Date.parse(data.mark);
  const fresh = items.filter(isNew);
  const earlier = items.filter((i) => !isNew(i));
  const markAt = data.mark === null ? null : `${utcWhen(data.mark)} UTC`;

  /* Older goes once the last page is read: focus moves to the list it filled, never to the page's top. */
  const list = useRef<HTMLDivElement>(null);
  const reading = useRef(false);
  useEffect(() => {
    if (data.more || !reading.current) return;
    reading.current = false;
    list.current?.focus();
  }, [data.more]);

  const rowsOf = (group: readonly Item[], isFresh: boolean) => (
    <ul className="kb-alerts-list">
      {group.map((item) => {
        const first = item.rows[0]!;
        const said = item.rows.length > 1 ? batchWords(item.rows, ctx) : wordsFor(first, ctx);
        return <Row key={item.key} item={item} said={said} fresh={isFresh} character={characterOf(first)} note={first.thread === null ? undefined : notes.get(first.thread)} onUnfollow={onUnfollow} />;
      })}
    </ul>
  );

  return (
    <div className="kb-alerts">
      <div className="kb-alerts-head">
        <h1 className="kb-alerts-title kb-glass-display">Alerts</h1>
        {mine.length > 1 && (
          <nav aria-label="Whose alerts" className="kb-alerts-tabs kb-calm">
            <button type="button" className="kb-alerts-tab kb-glass-skew" aria-pressed={current === null} onClick={() => setPicked(null)}><span className="kb-glass-upright">All</span></button>
            {mine.map((c) => (
              <button key={c.id} type="button" className="kb-alerts-tab kb-glass-skew" aria-pressed={current?.id === c.id} onClick={() => setPicked(c.id)}><span className="kb-glass-upright">{c.name}</span></button>
            ))}
          </nav>
        )}
      </div>
      <p className="kb-alerts-lede kb-calm">
        What happened to your characters, and what&apos;s new in the game. Every alert is true, and each one is also in your log or on the board. A thread drops off this list once you&apos;ve read it.
      </p>
      {data.rows.length === 0
        ? <p className="kb-alerts-empty kb-calm">Nothing here yet. When something happens to one of your characters, or the game has news, it shows up here.</p>
        : (
          <div ref={list} className="kb-alerts-board kb-calm" tabIndex={-1}>
            {current !== null && shown.length === 0 && <p className="kb-alerts-empty">Nothing for {current.name} yet. All shows everyone&apos;s.</p>}
            {fresh.length > 0 && (
              <>
                <h2 className="kb-alerts-divider">{markAt === null ? 'New since you last looked' : `New since you last looked, ${markAt}`}</h2>
                {rowsOf(fresh, true)}
              </>
            )}
            {fresh.length === 0 && shown.length > 0 && markAt !== null && <p className="kb-alerts-nothing">Nothing is new since you last looked, {markAt}.</p>}
            {earlier.length > 0 && (
              <>
                <h2 className="kb-alerts-divider kb-alerts-earlier">Earlier</h2>
                {rowsOf(earlier, false)}
              </>
            )}
            {data.more && (
              <p className="kb-alerts-older">
                <button type="button" className="kb-alerts-tab kb-glass-skew" onClick={() => { reading.current = true; onOlder(); }} aria-disabled={older === 'loading' || undefined}><span className="kb-glass-upright">Older</span></button>
                {older === 'failed' && <span className="kb-alerts-older-failed"> The older alerts could not be read. Try again.</span>}
              </p>
            )}
          </div>
        )}
    </div>
  );
}

/** Alerts at /alerts: the newest page, with the mark moved to its newest row. */
export function AlertsScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  const { session } = usePlayer();
  const { state, older, dropFollowed, retry } = useAlerts(api, signedIn, session.account);
  const [notes, setNotes] = useState<ReadonlyMap<Id, string>>(new Map());
  const note = (thread: Id, text: string | null) => setNotes((was) => { const next = new Map(was); if (text === null) next.delete(thread); else next.set(thread, text); return next; });
  const unfollow = (thread: Id) => {
    note(thread, null);
    api.follow(thread, false).then(
      (a) => { if (a.ok) dropFollowed(thread); else note(thread, a.error); },
      () => note(thread, 'That did not go through. Try again.'),
    );
  };
  if (signedIn === false) return <div className="kb-alerts"><div className="kb-alerts-empty kb-calm"><SignInPrompt /></div></div>;
  if (signedIn === null || state.status === 'loading') return <div className="kb-alerts" aria-busy="true" />;
  if (state.status === 'failed') {
    return (
      <div className="kb-alerts">
        <h1 className="kb-alerts-title kb-glass-display">Alerts</h1>
        <p className="kb-alerts-empty kb-calm">
          Your alerts could not be read. Nothing is lost; they are still in your log and on the board.{' '}
          <button type="button" className="kb-alerts-unfollow" onClick={retry}>Try again</button>
        </p>
      </div>
    );
  }
  return <Alerts data={state.data} older={state.older} onOlder={older} onUnfollow={unfollow} notes={notes} />;
}
