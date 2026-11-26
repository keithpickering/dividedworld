/**
 * A poll on a post, drawn as the board draws it (docs/plans/2026-11-20-polls-design.md, section 9; the mockup docs/research/2026-11-20-polls/01-placement.html, option A): a 2003
 * poll table in the post's own ink, under the words and before the last-edited line, the reactions and the signature, the same in every post. It is a fieldset whose legend is the
 * question, with the ballots' kind, the choice and the time left in Courier beside it; one row for each option (a radio for choose one, a checkbox for more, the option, a bar,
 * and a mono count with its percent); and a foot with the form, the voter count and the links. On a public poll the masks that chose an option are named under it (the first
 * eight, then "and N more", which opens the rest), and the Ballots list reads the record; a secret poll names no one and has no list.
 *
 * The form is shown where the HUD's mask can vote. Where it cannot (no mask, a closed poll, a banned or barred mask) there are no inputs and one plain line says why, in the
 * words the reply box's refusals use; a refusal from the server stands in the foot as an alert and the form stays. The bars are a picture (`aria-hidden`); every count is text; a
 * ballot that landed is announced politely.
 *
 * The poll's root is `data-kb-over-ink`, as the reactions row is: it stands inside the post's content area and is lifted over an effect's ink, so an ink paints under it and a press
 * inside it starts nothing (cards/body.ts). It adds no border box of its own beyond the table's.
 *
 * Where the poll's data comes from is a `Polls` store (store.ts), the thread screen's, which the page fills from what it reads and what it hears live.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { pickRefusal, percent } from '../../rules/polls.ts';
import { useBar } from '../composer/BarredNote.tsx';
import { useBannedUntil } from '../composer/ban.ts';
import { dayAndTime } from '../characters/format.ts';
import { useKayfa } from '../context.tsx';
import type { Id, PollBallot } from '../data/api.ts';
import { useIsAdmin } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { SpinForm, useSpinDrafts } from '../spin/SpinForm.tsx';
import { SpunInto } from '../spin/SpunInto.tsx';
import { BannedNote } from '../composer/BannedNote.tsx';
import { ThreadCtx } from '../thread/context.ts';
import { usePoll, type PollView, type Polls } from './store.ts';
import { ballotLine, closing } from './words.ts';
import './poll.css';

/** The first names an option lists before "and N more". */
export const NAMES_SHOWN = 8;
/** The names an opened option draws at a time, and each "show more" adds: a busy poll's option can hold thousands. */
export const NAMES_OPENED = 100;
const MOST_MS = 2 ** 31 - 1;

/**
 * `board` is the board whose bars bind a vote on this poll: left out, the thread screen's own board; the ORIGIN box passes null (the poll's board is not the spun thread's, and the
 * server refuses a barred ballot in its own words, shown in the foot).
 */
export function Poll({ post, polls, board }: { readonly post: Id; readonly polls?: Polls | undefined; readonly board?: Id | null }) {
  const thread = useContext(ThreadCtx);
  const store = polls ?? thread?.polls;
  const view = usePoll(store, post);
  if (store === undefined || view === undefined) return null;
  /* A replaced poll is another poll: its form and open lists start over. */
  return <PollBody key={view.poll.act.id} view={view} store={store} board={board} />;
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n) => b.includes(n));

function PollBody({ view, store, board }: { readonly view: PollView; readonly store: Polls; readonly board: Id | null | undefined }) {
  const { api } = useKayfa();
  const player = usePlayer();
  const thread = useContext(ThreadCtx);
  const hud = player.hudCharacter;
  const admin = useIsAdmin(api, player.session.signedIn);
  const bannedUntil = useBannedUntil(hud);
  const bar = useBar(hud, board !== undefined ? board : thread?.summary.board ?? null);
  const drafts = useSpinDrafts();
  const { poll } = view;
  const id = poll.act.id;
  const options = Array.isArray(poll.act.payload.options) ? (poll.act.payload.options as readonly string[]) : [];
  const pick = typeof poll.act.payload.pick === 'number' ? poll.act.payload.pick : 1;
  const secret = poll.act.payload.secret === true;
  const by = poll.close === null ? null : poll.close.payload.by === 'admin' ? 'admin' : 'author';

  /* The poll ends by itself at its time: the page draws it closed then, without a read. */
  const [ticks, tick] = useState(0);
  const end = Date.parse(poll.endsAt);
  const now = api.now();
  useEffect(() => {
    const left = end - api.now();
    if (poll.closed || poll.close !== null || !(left > 0)) return;
    const timer = setTimeout(() => tick((n) => n + 1), Math.min(left, MOST_MS));
    return () => clearTimeout(timer);
  /* A time past one timer's reach (setTimeout's cap) is waited out in as many as it takes: each firing renders again and arms the next. */
  }, [api, end, poll.closed, poll.close, ticks]);
  const closed = poll.closed || poll.close !== null || now >= end;

  /* The HUD's mask's counted ballot: its picks start the form, and a withdrawal is none. */
  const mine = hud === null ? undefined : view.mine.find((b) => b.character === hud.id && b.picks.length > 0);
  /* The form starts over when the mask or its counted ballot changes, so a ballot of this mask's from another tab replaces what is picked here: the ballot that counts is the one the poll shows. */
  const formKey = `${hud?.id ?? ''}:${mine?.act ?? ''}`;
  const [seenKey, setSeenKey] = useState(formKey);
  const [sel, setSel] = useState<readonly number[]>(mine?.picks ?? []);
  if (seenKey !== formKey) { setSeenKey(formKey); setSel(mine?.picks ?? []); }

  /* Pressing Vote, Change or Withdraw changes which controls stand (Withdraw goes with the ballot), so focus is kept in the poll: on its fieldset where the pressed control is gone. */
  const fieldset = useRef<HTMLFieldSetElement>(null);
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    if (settled === 0) return;
    const at = document.activeElement;
    if (at === null || at === document.body || !fieldset.current?.contains(at)) fieldset.current?.focus();
  }, [settled]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const send = async (picks: readonly number[]) => {
    if (hud === null || busy) return;
    if (picks.length > pick) { setRefusal(pickRefusal(pick)); return; }
    setBusy(true);
    setRefusal(null);
    setSaid('');
    try {
      const answer = await api.castBallot(id, hud.id, picks);
      if (answer.ok) {
        store.cast(id, hud.id, picks, answer.value);
        setSaid(picks.length === 0 ? `Ballot withdrawn as ${hud.name}` : `Ballot cast as ${hud.name}`);
      } else setRefusal(answer.error);
    } catch {
      setRefusal('The ballot could not be sent. Press the button to try again.');
    } finally {
      setBusy(false);
      setSettled((n) => n + 1);
    }
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = hud !== null && hud.id === poll.act.character ? await api.closePoll(id, hud.id) : await api.closePollAsAdmin(id);
      if (answer.ok) { store.closed(answer.value); setSaid('Poll closed'); } else setRefusal(answer.error);
    } catch {
      setRefusal('The poll could not be closed. Press the button to try again.');
    } finally {
      setBusy(false);
      setSettled((n) => n + 1);
    }
  };
  const canClose = !closed && ((hud !== null && hud.id === poll.act.character) || admin);

  const total = poll.counts.reduce((a, b) => a + b, 0);
  const nameOf = (c: Id) => store.name(c) ?? thread?.nameOf(c) ?? 'A character';

  /* The rest of a public poll's voters, read once from its record when an option's "and N more" is opened. */
  const [open, setOpen] = useState<ReadonlyMap<number, number>>(new Map());
  const [reading, setReading] = useState(false);
  const reads = useRef(false);
  const expand = (option: number) => {
    setOpen((s) => new Map(s).set(option, NAMES_OPENED));
    if (!view.more || reads.current) return;
    reads.current = true;
    setReading(true);
    void (async () => {
      let after: { at: string; act: Id } | undefined;
      try {
        for (;;) {
          const page = await api.pollBallots(id, after);
          if (!page.ok) return;
          store.fill(id, page.value.ballots, !page.value.more);
          const last = page.value.ballots.at(-1);
          if (!page.value.more || last === undefined) return;
          after = { at: last.at, act: last.act };
        }
      } catch { /* the names held stay; the next press reads again */ } finally { reads.current = false; setReading(false); }
    })();
  };

  /* The record. */
  const [history, setHistory] = useState<{ readonly ballots: readonly PollBallot[]; readonly more: boolean } | null>(null);
  const [listing, setListing] = useState(false);
  const [listed, setListed] = useState<'idle' | 'reading' | 'failed'>('idle');
  const readBallots = async (older: boolean) => {
    const last = older ? history?.ballots.at(-1) : undefined;
    setListed('reading');
    try {
      const page = await api.pollBallots(id, last === undefined ? undefined : { at: last.at, act: last.act });
      if (!page.ok) { setListed('failed'); return; }
      store.named(page.value.ballots.map((b) => b.character));
      setHistory((h) => ({ ballots: [...(older ? h?.ballots ?? [] : []), ...page.value.ballots], more: page.value.more }));
      setListed('idle');
    } catch { setListed('failed'); }
  };
  const toggleBallots = () => {
    if (listing) { setListing(false); return; }
    setListing(true);
    void readBallots(false);
  };

  const [spinning, setSpinning] = useState(false);
  /* A ballot of the record being spun from: its Act's id and who it is by, for the form's words. */
  const [spinningBallot, setSpinningBallot] = useState<{ readonly act: Id; readonly name: string } | null>(null);

  const form = !closed && hud !== null && bannedUntil === null && bar === null;
  const voters = view.voters;
  const group = `poll-${id}`;
  const lineOf = (): string | null => {
    if (closed) return 'This poll has closed, so no more ballots can be cast.';
    if (hud === null) return player.session.signedIn ? 'None of your characters can vote yet. Make a character, and vote as it.' : 'Sign in with a character to vote.';
    if (bannedUntil !== null) return null;
    if (bar !== null) return `${hud.name} is barred from this board${bar.expiresAt === null ? '' : ` until ${dayAndTime(bar.expiresAt)}`}, so it cannot vote here.`;
    return null;
  };
  const line = lineOf();

  return (
    <div className="kb-poll-root" data-kb-over-ink="">
      <fieldset ref={fieldset} tabIndex={-1} className="kb-poll" aria-busy={busy || undefined}>
        <legend className="kb-poll-head">
          <b className="kb-poll-question">{String(poll.act.payload.question ?? '')}</b>
          <span className="kb-poll-meta">{secret ? 'secret' : 'public'} ballots · choose {pick} · {closing({ endsAt: poll.endsAt, closed }, by, now)}</span>
        </legend>
        <table className="kb-poll-table">
          <caption className="kb-visually-hidden">The options and their counts</caption>
          <tbody>
            {options.map((option, i) => {
              const count = poll.counts[i] ?? 0;
              const names = secret ? [] : voters.filter((v) => v.picks.includes(i)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.act < b.act ? -1 : 1));
              const limit = open.get(i);
              const shown = names.slice(0, limit ?? NAMES_SHOWN);
              const rest = count - shown.length;
              const input = `${group}-${i}`;
              return (
                <tr key={i}>
                  {form && (
                    <td className="kb-poll-pick">
                      <input
                        id={input} type={pick === 1 ? 'radio' : 'checkbox'} name={group} checked={sel.includes(i)}
                        onChange={(e) => busy ? undefined : setSel((s) => (pick === 1 ? [i] : e.target.checked ? [...s, i].sort((a, b) => a - b) : s.filter((n) => n !== i)))}
                      />
                    </td>
                  )}
                  <td className="kb-poll-name">
                    {form ? <label htmlFor={input}>{option}</label> : <span>{option}</span>}
                    {!secret && names.length > 0 && (
                      <span className="kb-poll-who">
                        {shown.map((v) => nameOf(v.character)).join(', ')}
                        {rest > 0 && limit === undefined && <>{', '}<button type="button" className="kb-link-button" onClick={() => expand(i)}>and {rest} more</button></>}
                        {limit !== undefined && names.length > shown.length && <>{', '}<button type="button" className="kb-link-button" onClick={() => setOpen((m) => new Map(m).set(i, limit + NAMES_OPENED))}>show {Math.min(NAMES_OPENED, names.length - shown.length)} more names</button></>}
                        {limit !== undefined && reading && <span> Reading the rest…</span>}
                      </span>
                    )}
                    {!secret && names.length === 0 && rest > 0 && <span className="kb-poll-who"><button type="button" className="kb-link-button" onClick={() => expand(i)}>and {rest} more</button></span>}
                  </td>
                  <td className="kb-poll-barcell"><span className="kb-poll-bar" aria-hidden="true"><i style={{ width: `${percent(count, total)}%` }} /></span></td>
                  <td className="kb-poll-count">{count} · {percent(count, total)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="kb-poll-foot">
          {form && (
            <>
              <button
                type="button" className="kb-button" data-kb-size="small" data-kb-primary=""
                aria-disabled={busy || sel.length === 0 || (mine !== undefined && same(sel, mine.picks))}
                onClick={(e) => { if (e.currentTarget.getAttribute('aria-disabled') !== 'true') void send(sel); }}
              >{mine === undefined ? 'Vote' : 'Change ballot'} as {hud!.name}</button>
              {mine !== undefined && <button type="button" className="kb-button" data-kb-size="small" aria-disabled={busy} onClick={() => void send([])}>Withdraw</button>}
            </>
          )}
          {closed || hud === null || bannedUntil === null ? null : <BannedNote character={hud} until={bannedUntil} />}
          {line !== null && <span className="kb-poll-line">{line}</span>}
          <span>{poll.voters} {poll.voters === 1 ? 'character' : 'characters'} voted</span>
          <span className="kb-poll-links">
            {!secret && <button type="button" className="kb-link-button" aria-expanded={listing} onClick={toggleBallots}>Ballots</button>}
            <button type="button" className="kb-link-button" aria-expanded={spinning} onClick={() => setSpinning((s) => !s)}>Spin</button>
            {canClose && <button type="button" className="kb-link-button" aria-disabled={busy} onClick={() => void close()}>Close poll</button>}
          </span>
          <SpunInto act={id} here={board !== undefined ? board : thread?.summary.board ?? null} />
          <span className="kb-visually-hidden" role="status" aria-live="polite">{said || (reading ? 'Reading the rest of the voters' : listed === 'reading' ? 'Reading the ballots' : '')}</span>
          {refusal !== null && <p className="kb-poll-refusal" role="alert">{refusal}</p>}
        </div>
        {listing && (
          <div className="kb-poll-record">
            {history !== null && (
              <ol aria-label="Ballots" className="kb-poll-ballots">
                {history.ballots.map((b, i) => {
                  const earlier = history.ballots.slice(i + 1).find((x) => x.character.id === b.character.id);
                  return (
                    <li key={b.act}>
                      {ballotLine(b.character.name, b.picks.map((p) => options[p] ?? ''), earlier === undefined ? (history.more ? null : false) : earlier.picks.length > 0, b.at)}
                      {' '}
                      <button type="button" className="kb-link-button" aria-label={`Spin from ${b.character.name}'s ballot`} aria-expanded={spinningBallot?.act === b.act} onClick={() => { setSpinningBallot((s) => (s?.act === b.act ? null : { act: b.act, name: b.character.name })); }}>Spin</button>
                    </li>
                  );
                })}
              </ol>
            )}
            {history?.ballots.length === 0 && <p className="kb-small">No ballots have been cast.</p>}
            {listed === 'reading' && <p className="kb-small">Reading the ballots…</p>}
            {listed === 'failed' && <p className="kb-small" role="alert">The ballots could not be read. Press Ballots to try again.</p>}
            {history?.more === true && listed !== 'reading' && <button type="button" className="kb-button" data-kb-size="small" onClick={() => void readBallots(true)}>Show older ballots</button>}
          </div>
        )}
      </fieldset>
      {spinningBallot !== null && (
        <SpinForm
          key={spinningBallot.act} origin={spinningBallot.act} label={`${spinningBallot.name}'s ballot`} draft={drafts.get(spinningBallot.act)} onDraft={(d) => drafts.set(spinningBallot.act, d)}
          onClose={() => setSpinningBallot(null)}
        />
      )}
      {spinning && (
        <SpinForm
          origin={id} label="this poll" draft={drafts.get(id)} onDraft={(d) => drafts.set(id, d)}
          onClose={() => setSpinning(false)}
        />
      )}
    </div>
  );
}
