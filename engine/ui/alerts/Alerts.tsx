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
import type { Alert, Id } from '../data/api.ts';
import { utcWhen } from '../log/lines.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { AlertIcon } from './AlertIcon.tsx';
import { rowKey, useAlerts, type AlertsRead } from './useAlerts.ts';
import { batchWords, targetKey, wordsFor, type Part, type Said, type WordsContext } from './words.ts';
import './alerts.css';
import { CalmRegion } from '../glass/Calm.tsx';

/** One line of the list: a single alert, or the cards played on one target among the new. */
interface Item { readonly key: string; readonly rows: readonly Alert[] }

/** The rows in order, with the cards on one target among the new ones (`fresh`) gathered into the place of the newest. */
export function itemsOf(rows: readonly Alert[], ctx: WordsContext, fresh: (row: Alert) => boolean): Item[] {
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
    <li className="kb-alerts-row" tabIndex={-1} data-kb-kind={row.kind} data-kb-new={fresh ? '' : undefined} data-kb-key={item.key}>
      <AlertIcon kind={row.kind} className="kb-alerts-ico" />
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
  /** Unfollows the thread; says whether it was, so focus can move on from the row that left. */
  readonly onUnfollow: (thread: Id) => Promise<boolean>;
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
    instance, ui, acts: data.acts, names: data.names, reading: data.reading, startedBy, perPage: settings.postsPerPage,
    newestSettlement: data.rows.find((r) => r.kind === 'settlement')?.sub ?? null,
  };
  const shown = current === null ? data.rows : data.rows.filter((r) => characterOf(r) === current.id);
  /* Without the mark nothing is new: no divider, and no batching, which is only among the new. An account that has never looked counts
     from when it joined (issue #148), as the HUD's count does (0066). */
  const from = data.mark ?? data.joined;
  const isFresh = (r: Alert) => data.markKnown && (from === null || Date.parse(r.at) > Date.parse(from));
  const items = itemsOf(shown, ctx, isFresh);
  const fresh = items.filter((i) => isFresh(i.rows[0]!));
  const earlier = items.filter((i) => !isFresh(i.rows[0]!));
  const sinceWords = data.mark !== null ? `since you last looked, ${utcWhen(data.mark)} UTC` : data.joined !== null ? `since you joined, ${utcWhen(data.joined)} UTC` : null;

  /*
   * Focus follows what the player did. After Older it goes to the first row that was loaded, so the keyboard is where the new rows begin; after an
   * Unfollow it goes to the first control of the row that took the place of the one that left (else the one before it), or the list when none is
   * left. It is never left on the control that is gone, nor sent to the top of the page.
   */
  const list = useRef<HTMLDivElement>(null);
  const known = useRef<ReadonlySet<string> | null>(null);
  const pending = useRef<{ readonly key: string | null } | null>(null);
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const lis = [...root.querySelectorAll<HTMLElement>('li[data-kb-key]')];
    if (pending.current) {
      const { key } = pending.current;
      pending.current = null;
      const li = key === null ? undefined : lis.find((l) => l.getAttribute('data-kb-key') === key);
      (li?.querySelector<HTMLElement>('a, button') ?? li ?? root).focus();
    } else if (known.current) {
      const before = known.current;
      known.current = null;
      lis.find((l) => !before.has(l.getAttribute('data-kb-key')!))?.focus();
    }
  }, [data.rows]);
  /* A page that could not be read leaves nothing to move focus to, and must not claim a later change of rows. */
  useEffect(() => { if (older === 'failed') known.current = null; }, [older]);
  const unfollow = async (thread: Id) => {
    const order = [...fresh, ...earlier];
    const at = order.findIndex((i) => i.rows[0]!.kind === 'followed' && i.rows[0]!.thread === thread);
    const next = order[at + 1] ?? order[at - 1];
    /* Only a row that is on the page leaves it, so only then is there focus to move on. */
    pending.current = at < 0 ? null : { key: next === undefined ? null : next.key };
    const ok = await onUnfollow(thread);
    if (!ok) pending.current = null;
    return ok;
  };

  const rowsOf = (group: readonly Item[], fresh: boolean) => (
    <ul className="kb-alerts-list">
      {group.map((item) => {
        const first = item.rows[0]!;
        const said = item.rows.length > 1 ? batchWords(item.rows, ctx) : wordsFor(first, ctx);
        return <Row key={item.key} item={item} said={said} fresh={fresh} character={characterOf(first)} note={first.thread === null ? undefined : notes.get(first.thread)} onUnfollow={(t) => void unfollow(t)} />;
      })}
    </ul>
  );

  return (
    <div className="kb-alerts">
      <PageHead
        title="Alerts"
        tabs={mine.length > 1 && (
          <CalmRegion as="nav" aria-label="Whose alerts">
            <ButtonRow>
              <GlassButton kind={current === null ? 'primary' : 'secondary'} aria-pressed={current === null} onClick={() => setPicked(null)}>All</GlassButton>
              {mine.map((c) => (
                <GlassButton key={c.id} kind={current?.id === c.id ? 'primary' : 'secondary'} aria-pressed={current?.id === c.id} onClick={() => setPicked(c.id)}>{c.name}</GlassButton>
              ))}
            </ButtonRow>
          </CalmRegion>
        )}
      />
      <CalmRegion as="p" className="kb-alerts-lede">
        What happened to your characters, and what&apos;s new in the game. Every alert is true, and each one is also in your log or on the board. A thread drops off this list once you&apos;ve read it.
      </CalmRegion>
      <CalmRegion ref={list} role="group" aria-label="Your alerts" className="kb-alerts-board" tabIndex={-1}>
        {data.rows.length === 0 && <p className="kb-alerts-empty">Nothing here yet. When something happens to one of your characters, or the game has news, it shows up here.</p>}
        {data.rows.length > 0 && current !== null && shown.length === 0 && <p className="kb-alerts-empty">Nothing for {current.name} yet. All shows everyone&apos;s.</p>}
        {fresh.length > 0 && (
          <>
            <h2 className="kb-alerts-divider">{sinceWords === null ? 'New since you last looked' : `New ${sinceWords}`}</h2>
            {rowsOf(fresh, true)}
          </>
        )}
        {fresh.length === 0 && shown.length > 0 && data.markKnown && sinceWords !== null && <p className="kb-alerts-nothing">Nothing is new {sinceWords}.</p>}
        {earlier.length > 0 && (
          <>
            {data.markKnown && <h2 className="kb-alerts-divider kb-alerts-earlier">Earlier</h2>}
            {rowsOf(earlier, false)}
          </>
        )}
        {data.more && (
          <p className="kb-alerts-older">
            <GlassButton size="s" onClick={() => { known.current = new Set(items.map((i) => i.key)); onOlder(); }} aria-disabled={older === 'loading' || undefined}>Older</GlassButton>
            {older === 'failed' && <span className="kb-alerts-older-failed" role="alert"> The older alerts could not be read. Try again.</span>}
          </p>
        )}
      </CalmRegion>
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
  const unfollow = async (thread: Id): Promise<boolean> => {
    note(thread, null);
    try {
      const a = await api.follow(thread, false);
      if (a.ok) { dropFollowed(thread); return true; }
      note(thread, a.error);
    } catch { note(thread, 'That did not go through. Try again.'); }
    return false;
  };
  if (signedIn === false) return <div className="kb-alerts"><CalmRegion className="kb-alerts-empty"><SignInPrompt /></CalmRegion></div>;
  if (signedIn === null || state.status === 'loading') return <div className="kb-alerts" role="status"><p className="kb-visually-hidden">Reading your alerts</p></div>;
  if (state.status === 'failed') {
    return (
      <div className="kb-alerts">
        <PageHead title="Alerts" />
        <CalmRegion as="p" className="kb-alerts-empty" role="alert">
          Your alerts could not be read. Nothing is lost; they are still in your log and on the board.{' '}
          <button type="button" className="kb-alerts-unfollow" onClick={retry}>Try again</button>
        </CalmRegion>
      </div>
    );
  }
  return <Alerts data={state.data} older={state.older} onOlder={older} onUnfollow={unfollow} notes={notes} />;
}
