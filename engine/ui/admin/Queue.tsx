/**
 * The admin queue, a glass page at /admin/queue (the system plan, Task 12; mock-s3-admin-queue.html B), reached from the ADMIN tab of
 * the pause menu, which only an admin sees. The Boss's moves are not signed by a person, so what bounds The System in play is that
 * an admin sees a structural move coming, can hold it before it lands, and can reverse any move after it lands. Three groups, by
 * what an admin can do with them (and, above them, a To do group, below):
 *
 *   To do             a handover that changed the Boss (the staff roster design, section 11): "Season 4 opens with Comptroller", the handover's
 *                     plain facts, and a link to Write an update with those facts filled in. It is the admin's to write, and no model writes any
 *                     of it. It goes away when an update is posted after the handover, or when an admin dismisses it.
 *   Waiting to land   queued moves, soonest first: the countdown and time, the full proposal (the move in the engine's words, its new
 *                     subject, its demand, the description in the Boss's old voice) and the Boss's own `why`, quoted as its words;
 *                     a move the tick could not land says why. HOLD, on these and nowhere else.
 *   In force          landed moves with no end: since and until, the demand with a progress bar and its why. REVERSE, on these
 *                     and nowhere else.
 *   Ended             folded; the last 30 days, with how each ended: its demand met, run out, reversed, or held (never landed).
 *
 * Above the groups stands How players reach you (AdminContact.tsx): the links the public Reach a person page shows, which only an admin sets.
 *
 * Plain text throughout. The glass never speaks as the Boss: what it says of a move is the engine's catalog (engine/system/moves.ts,
 * demands.ts), and what the Boss wrote (`why`, the description) is quoted and named as its words.
 *
 * HOLD and REVERSE ask first, in a glass overlay as the Turn and the Reveal do: it names the move, says what the act does and that
 * a hold cannot be taken back, and a refusal comes back in the server's words in the dialog. Either way the queue is read again, so
 * a stale row never stays. Focus then goes to the heading of the group the move left, since its button is gone.
 *
 * Cost: one read, capped on the server (100 a group, `more` says a group was cut), with the in-force moves' progress read from what the
 * tick stored (so each says when it was counted, or that it has not been) and none counted by the read itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { demandAsk, demandKind, demandWords } from '../../system/demands.ts';
import { MoveSentence } from '../board/MoveSentence.tsx';
import { demandNeeds } from '../board/move-words.ts';
import { dayAndTime } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { AdminQueue, BoardName, HandoverTodo, MoveEnded, MoveInForce, QueuedMove } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { shortDate } from '../postbit/dates.ts';
import { todoFacts, todoSentence } from './handover-words.ts';
import { AdminContact } from './AdminContact.tsx';
import './queue.css';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "IN 17 HOURS": how far off a time is, in the biggest whole unit, in capitals; a time that has come is said so. */
export function countdown(at: string, now: number): string {
  const ms = Date.parse(at) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms < MINUTE) return 'ANY MINUTE NOW';
  const plural = (n: number, unit: string) => `IN ${n} ${unit}${n === 1 ? '' : 'S'}`;
  if (ms < HOUR) return plural(Math.round(ms / MINUTE), 'MINUTE');
  if (ms < 48 * HOUR) return plural(Math.round(ms / HOUR), 'HOUR');
  return plural(Math.round(ms / (24 * HOUR)), 'DAY');
}

/** A Boss of the roster: its staff key and its name. */
type Roster = { readonly staff: string; readonly name: string };

type Asked = { readonly kind: 'hold'; readonly row: QueuedMove } | { readonly kind: 'reverse'; readonly row: MoveInForce };

export function QueueScreen({ now }: { readonly now?: number }) {
  const { api } = useKayfa();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [boards, setBoards] = useState<readonly BoardName[]>([]);
  const [bosses, setBosses] = useState<readonly Roster[]>([]);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState<Asked | null>(null);
  const clock = now ?? Date.now();

  const load = useCallback(async () => {
    try {
      /* The roster's names make a nomination read as a name; a roster that cannot be read leaves keys, and the replacing choice empty. */
      const [q, names, roster] = await Promise.all([api.adminQueue(), api.boardNames(), api.bosses().catch((): readonly Roster[] => [])]);
      setQueue(q);
      setBoards(names);
      setBosses(roster);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [api]);

  useEffect(() => {
    let live = true;
    void api.isAdmin().then((a) => { if (live) setAdmin(a); }, () => { if (live) setAdmin(false); });
    return () => { live = false; };
  }, [api]);
  useEffect(() => { if (admin) void load(); }, [admin, load]);

  const heading = (id: string) => () => document.getElementById(id);

  if (admin === null) return <div className="kb-queue" aria-busy="true" />;
  return (
    <div className="kb-queue">
      <PageHead title="The System's moves" />
      {!admin
        ? <p className="kb-queue-lead kb-calm">The admin queue is for admins.</p>
        : (
          <>
            <p className="kb-queue-lead kb-calm">
              Moves that reshape a board wait here before they land, and land unless you hold them. Anything in force can be reversed. Players never see a held move.
            </p>
            <AdminContact />
            {failed && <p className="kb-queue-note kb-calm" role="alert">The queue could not be read. Reload the page to try again.</p>}
            {queue && (
              <>
                <Todos rows={queue.todos} onDismissed={load} />
                <Waiting rows={queue.waiting} more={queue.more.waiting} boards={boards} bosses={bosses} roster={queue.roster} now={clock} onHold={(row) => setAsked({ kind: 'hold', row })} onReplaced={load} />
                <InForce rows={queue.inForce} more={queue.more.inForce} boards={boards} bosses={bosses} onReverse={(row) => setAsked({ kind: 'reverse', row })} />
                <Ended rows={queue.ended} more={queue.more.ended} boards={boards} bosses={bosses} />
              </>
            )}
          </>
        )}
      {asked && (
        <Confirm
          asked={asked} boards={boards} bosses={bosses}
          returnFocusTo={heading(asked.kind === 'hold' ? 'queue-waiting' : 'queue-in-force')}
          onClose={() => setAsked(null)}
          onDone={async () => { await load(); setAsked(null); document.getElementById(asked.kind === 'hold' ? 'queue-waiting' : 'queue-in-force')?.focus(); }}
          onRefused={load}
        />
      )}
    </div>
  );
}

function GroupHead({ id, title, count, more }: { readonly id: string; readonly title: string; readonly count: number; readonly more: boolean }) {
  return (
    <h2 id={id} tabIndex={-1} className="kb-queue-group-head kb-glass-display">
      {title} <span className="kb-queue-count" aria-label={more ? `${count} or more` : `${count}`}>{count}{more ? '+' : ''}</span>
    </h2>
  );
}

/**
 * A waiting nomination's other choice: an admin may put another Boss of the roster in its place (any but the Boss that wrote it and the
 * one it names). The server holds the same line and answers in its own words if the nomination landed or was held meanwhile.
 */
function Replace({ row, roster, bosses, onReplaced }: { readonly row: QueuedMove; readonly roster: readonly Roster[]; readonly bosses: readonly Roster[]; readonly onReplaced: () => Promise<void> }) {
  const { api } = useKayfa();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const choices = roster.filter((b) => b.staff !== row.staff && b.staff !== row.params['boss']);
  if (choices.length === 0) return null;
  const submit = async () => {
    if (!pick || busy) return;
    setBusy(true);
    setRefusal(null);
    setDone(null);
    try {
      const answer = await api.replaceSuccessor(row.id, pick);
      if (!answer.ok) { setRefusal(answer.error); await onReplaced(); return; }
      /* What was chosen is done: the pick empties, so the button waits for another choice rather than offering the same replacement again. */
      setDone(`Replaced. ${choices.find((b) => b.staff === pick)?.name ?? 'The new Boss'} will follow.`);
      setPick('');
      await onReplaced();
    } catch {
      setRefusal('That could not be sent. Check your connection and look at the queue before you try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kb-queue-replace">
      <label htmlFor={`queue-replace-${row.id}`}>Put another Boss in its place</label>
      <select id={`queue-replace-${row.id}`} className="kb-queue-select" value={pick} onChange={(e) => setPick(e.target.value)}>
        <option value="">Choose a Boss</option>
        {choices.map((b) => <option key={b.staff} value={b.staff}>{b.name}</option>)}
      </select>
      <ButtonRow><GlassButton size="s" disabled={!pick || busy} aria-label={`Replace the nominated Boss, ${bosses.find((b) => b.staff === row.params['boss'])?.name ?? 'the Boss it names'}`} onClick={() => void submit()}>REPLACE</GlassButton></ButtonRow>
      {refusal && <p role="alert" className="kb-queue-failure">{refusal}</p>}
      {done && <p role="status" className="kb-small kb-muted">{done}</p>}
    </div>
  );
}

/** The handovers waiting for an announcement. Dismiss is not asked twice: it only puts a reminder away, and the form stays open to any admin. */
function Todos({ rows, onDismissed }: { readonly rows: readonly HandoverTodo[]; readonly onDismissed: () => Promise<void> }) {
  const { api } = useKayfa();
  const [busy, setBusy] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const dismiss = async (season: number) => {
    if (busy !== null) return;
    setBusy(season);
    setRefusal(null);
    try {
      const answer = await api.dismissHandoverTodo(season);
      if (!answer.ok) setRefusal(answer.error);
      await onDismissed();
      document.getElementById('queue-todo')?.focus();
    } catch {
      setRefusal('That could not be sent. Check your connection and look at the queue before you try again.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="kb-queue-group" aria-labelledby="queue-todo" data-kb-group="todo">
      <GroupHead id="queue-todo" title="To do" count={rows.length} more={false} />
      {rows.length === 0 && <p className="kb-queue-empty kb-calm">Nothing to do.</p>}
      {refusal && <p role="alert" className="kb-queue-failure">{refusal}</p>}
      {rows.map((t) => (
        <article key={t.season} className="kb-queue-move kb-calm" data-kb-state="todo">
          <div className="kb-queue-when">
            <p className="kb-queue-countdown">SINCE {shortDate(t.landedAt).toUpperCase()}</p>
          </div>
          <div className="kb-queue-body">
            <h3 className="kb-queue-sentence">{todoSentence(t)}</h3>
            {todoFacts(t).map((line) => <p key={line}>{line}</p>)}
            <p>The announcement is yours to write; no model writes it. This goes away when an update is posted after the handover, or when you dismiss it.</p>
          </div>
          <div className="kb-queue-act">
            <ButtonRow>
              <GlassButton to={`/updates?write=handover&season=${t.season}`} aria-label={`Write the announcement for season ${t.season}`}>Write the announcement</GlassButton>
              <GlassButton disabled={busy !== null} aria-label={`Dismiss the season ${t.season} to-do`} onClick={() => void dismiss(t.season)}>DISMISS</GlassButton>
            </ButtonRow>
          </div>
        </article>
      ))}
    </section>
  );
}

function Waiting({ rows, more, boards, bosses, roster, now, onHold, onReplaced }: { readonly rows: readonly QueuedMove[]; readonly more: boolean; readonly boards: readonly BoardName[]; readonly bosses: readonly Roster[]; readonly roster: readonly Roster[]; readonly now: number; readonly onHold: (row: QueuedMove) => void; readonly onReplaced: () => Promise<void> }) {
  return (
    <section className="kb-queue-group" aria-labelledby="queue-waiting" data-kb-group="waiting">
      <GroupHead id="queue-waiting" title="Waiting to land" count={rows.length} more={more} />
      {rows.length === 0 && <p className="kb-queue-empty kb-calm">Nothing is waiting.</p>}
      {rows.map((q) => {
        const description = typeof q.params['description'] === 'string' ? q.params['description'] : '';
        const premise = typeof q.params['premise'] === 'string' ? q.params['premise'] : '';
        return (
          <article key={q.id} className="kb-queue-move kb-calm" data-kb-state="waiting">
            <div className="kb-queue-when">
              <p className="kb-queue-countdown">{countdown(q.goLiveAt, now)}</p>
              <p className="kb-queue-time">{dayAndTime(q.goLiveAt)}</p>
            </div>
            <div className="kb-queue-body">
              <h3 className="kb-queue-sentence"><MoveSentence kind={q.kind} params={q.params} boards={boards} bosses={bosses} tense="plan" was={q.boardName} /></h3>
              {premise && <p>New subject: {premise}</p>}
              <p>{demandNeeds(q.demand, q.kind)}{q.expiresAt && <> If that never happens, it ends on its own on {shortDate(q.expiresAt)}.</>}</p>
              {q.kind === 'nameSuccessor' && <p>If it lands and is not held or reversed, the Boss it names takes the seat when the season rolls over. Otherwise the roster&apos;s rotation chooses.</p>}
              {q.replacedAt && <p>An admin put this Boss in the nomination&apos;s place on {dayAndTime(q.replacedAt)}.</p>}
              {description && <p className="kb-queue-quote">Description: “{description}”</p>}
              {q.why && <p className="kb-queue-quote">Why, in {q.boss ?? 'the Boss'}&apos;s words: “{q.why}”</p>}
              {q.failedAt && (
                <p className="kb-queue-failure" role="note">
                  It could not land at {dayAndTime(q.failedAt)}: {q.failure}. It stays in line and is tried again; hold it if it should not land.
                </p>
              )}
            </div>
            <div className="kb-queue-act">
              <ButtonRow><GlassButton aria-label={`Hold: ${q.params['name'] ?? (q.kind === 'nameSuccessor' ? 'the naming of a successor' : 'this move')}`} onClick={() => onHold(q)}>HOLD</GlassButton></ButtonRow>
              {q.kind === 'nameSuccessor' && <Replace row={q} roster={roster} bosses={bosses} onReplaced={onReplaced} />}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function InForce({ rows, more, boards, bosses, onReverse }: { readonly rows: readonly MoveInForce[]; readonly more: boolean; readonly boards: readonly BoardName[]; readonly bosses: readonly Roster[]; readonly onReverse: (row: MoveInForce) => void }) {
  return (
    <section className="kb-queue-group" aria-labelledby="queue-in-force" data-kb-group="in-force">
      <GroupHead id="queue-in-force" title="In force" count={rows.length} more={more} />
      {rows.length === 0 && <p className="kb-queue-empty kb-calm">Nothing is in force.</p>}
      {rows.map((m) => {
        const ok = m.progress.of > 0 && !m.progress.error;
        const known = m.demand !== null && demandKind(m.demand.kind) !== undefined;
        return (
          <article key={m.act} className="kb-queue-move kb-calm" data-kb-state="in-force">
            <div className="kb-queue-when">
              <p className="kb-queue-countdown">SINCE {shortDate(m.landedAt).toUpperCase()}</p>
              {m.expiresAt && <p className="kb-queue-time">ends {shortDate(m.expiresAt)}</p>}
            </div>
            <div className="kb-queue-body">
              <h3 className="kb-queue-sentence"><MoveSentence kind={m.kind} params={m.params} boards={boards} bosses={bosses} tense="done" /></h3>
              {m.demand === null && <p>{demandNeeds(null, m.kind)}</p>}
              {m.demand !== null && (known ? <p>{(ok ? demandWords(m.demand, m.progress) : demandAsk(m.demand))}</p> : <p>It asks for something this page has no words for.</p>)}
              {ok && (
                <div className="kb-queue-bar" role="progressbar" aria-label="Progress toward the way out" aria-valuemin={0} aria-valuemax={m.progress.of} aria-valuenow={m.progress.done} aria-valuetext={`${m.progress.done} of ${m.progress.of}`}>
                  <i style={{ width: `${Math.round((100 * m.progress.done) / m.progress.of)}%` }} />
                </div>
              )}
              {ok && m.progress.checkedAt !== null && <p className="kb-queue-time">{m.progress.done} of {m.progress.of}, counted {dayAndTime(m.progress.checkedAt)}</p>}
              {m.demand !== null && m.progress.checkedAt === null && <p className="kb-queue-time">Not counted yet.</p>}
              {m.why && <p className="kb-queue-quote">Why, in {m.boss ?? 'the Boss'}&apos;s words: “{m.why}”</p>}
            </div>
            <div className="kb-queue-act">
              <ButtonRow><GlassButton aria-label={`Reverse: ${m.params['name'] ?? 'this move'}`} onClick={() => onReverse(m)}>REVERSE</GlassButton></ButtonRow>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function endedLine(e: MoveEnded): string {
  switch (e.how) {
    case 'held': return `Held by an admin on ${shortDate(e.at)}. It never landed.`;
    case 'met': return `${e.landedAt ? `${shortDate(e.landedAt)} to ${shortDate(e.at)}. ` : ''}Undone when its demand was met.`;
    case 'expired': return `${e.landedAt ? `${shortDate(e.landedAt)} to ${shortDate(e.at)}. ` : ''}Ran out on its own.`;
    case 'superseded': return `${e.landedAt ? `${shortDate(e.landedAt)} to ${shortDate(e.at)}. ` : ''}${e.by === 'boss' ? 'Ended by the new Boss at the handover.' : 'Ended at the handover: the new Boss did not review it in time.'}`;
    case 'spent': return `${e.landedAt ? `${shortDate(e.landedAt)} to ${shortDate(e.at)}. ` : ''}Used up at the handover.`;
    default: return `${e.landedAt ? `${shortDate(e.landedAt)} to ${shortDate(e.at)}. ` : ''}${e.by === 'admin' ? 'Reversed by an admin.' : 'Reversed.'}`;
  }
}

function Ended({ rows, more, boards, bosses }: { readonly rows: readonly MoveEnded[]; readonly more: boolean; readonly boards: readonly BoardName[]; readonly bosses: readonly Roster[] }) {
  return (
    <section className="kb-queue-group" aria-labelledby="queue-ended" data-kb-group="ended">
      <details className="kb-queue-ended">
        <summary className="kb-queue-group-head kb-glass-display" id="queue-ended" tabIndex={-1}>
          Ended <span className="kb-queue-count">{rows.length}{more ? '+' : ''}</span> <span className="kb-queue-fold">· the last 30 days, with how each ended ›</span>
        </summary>
        {rows.length === 0 && <p className="kb-queue-empty kb-calm">Nothing has ended in the last 30 days.</p>}
        {rows.map((e) => (
          <article key={`${e.act ?? 'q'}${e.id ?? ''}${e.at}`} className="kb-queue-move kb-calm" data-kb-state="ended" data-kb-how={e.how}>
            <div className="kb-queue-body">
              <h3 className="kb-queue-sentence"><MoveSentence kind={e.kind} params={e.params} boards={boards} bosses={bosses} tense={e.how === 'held' ? 'plan' : 'done'} /></h3>
              <p>{endedLine(e)}</p>
            </div>
          </article>
        ))}
      </details>
    </section>
  );
}

function Confirm({ asked, boards, bosses, onClose, onDone, onRefused, returnFocusTo }: {
  readonly asked: Asked; readonly boards: readonly BoardName[]; readonly bosses: readonly Roster[];
  readonly onClose: () => void; readonly onDone: () => Promise<void>; readonly onRefused: () => Promise<void>;
  readonly returnFocusTo: () => HTMLElement | null;
}) {
  const { api } = useKayfa();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const hold = asked.kind === 'hold';
  const row = asked.row;
  const once = useRef(false);
  const submit = async () => {
    if (busy || once.current) return;
    once.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = asked.kind === 'hold' ? await api.holdMove(asked.row.id) : await api.reverseMove(asked.row.act);
      if (!answer.ok) { setRefusal(answer.error); once.current = false; await onRefused(); return; }
      await onDone();
    } catch {
      setRefusal('That could not be sent. Check your connection and look at the queue before you try again.');
      once.current = false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Overlay title={hold ? 'Hold this move?' : 'Reverse this move?'} kicker="The System's moves" surface="settings" className="kb-queue-dialog" onClose={onClose} returnFocusTo={returnFocusTo}>
      <div className="kb-queue-confirm">
        <p className="kb-queue-sentence"><MoveSentence kind={row.kind} params={row.params} boards={boards} bosses={bosses} tense={hold ? 'plan' : 'done'} was={hold ? (row as QueuedMove).boardName : undefined} /></p>
        <p>
          {hold
            ? 'It will never land, and no player will see it. A hold cannot be taken back. The Boss chooses its next move at its next meeting, and learns of the hold only then.'
            : row.kind === 'nameSuccessor'
              ? 'It ends now, as reversed by an admin, and the roster\'s rotation chooses the next Boss at the handover. The Boss says so in the move\'s thread, and learns of it at its next meeting.'
              : 'It ends now, as reversed by an admin, and the old name returns at once. The Boss says so in the move\'s thread, and learns of it at its next meeting.'}
        </p>
        {refusal && <p role="alert" className="kb-queue-failure">{refusal}</p>}
        <ButtonRow align="end">
          <GlassButton onClick={onClose}>Cancel</GlassButton>
          <GlassButton kind="primary" disabled={busy} onClick={() => void submit()}>{hold ? 'Hold it' : 'Reverse it'}</GlassButton>
        </ButtonRow>
      </div>
    </Overlay>
  );
}
