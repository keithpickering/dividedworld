/**
 * What an ORIGIN box draws for a report, a Mod's verdict, an appeal or a ruling (docs/plans/2026-11-23-spin-mod-answers-design.md, section 1): the exchange. The ask's
 * byline and date over the reason or plea, quoted; then the staff member's byline, with the role, over the line it wrote (which may bluff, being in character); then the
 * plain line of what the verdict or ruling did (`answerWords`, which is true, and names no Aura and never why a visit did not open); then Go to post where the place has a
 * post. An ask no one has answered says "Not answered yet." in place of the answer and the line.
 *
 * It stands in the box's content area as a post's words do, and adds no effect and no bordered box of its own. It is read once when drawn (`api.exchange`), with no
 * subscription: a spun exchange is a moment, and one answered after the spin shows on the next opening. The names are the place's, which the server computes as
 * `acts_public` shows the ask's character (a stand-in under a veil), never read from `characters` with its owner; a failed read says so and offers Try again.
 */
import { useEffect, useRef, useState } from 'react';
import { modRole } from '../cards/visit.ts';
import { useKayfa } from '../context.tsx';
import type { AnswerPlace, Character, Exchange as ExchangeRead, Id } from '../data/api.ts';
import { Byline } from '../mini.tsx';
import { Link } from '../router.tsx';
import { when } from '../thread/lines.tsx';
import { pageOf, threadHref } from '../thread/pages.ts';
import { answerWords } from './exchange.ts';
import type { Act } from '../data/api.ts';

type Read = { readonly status: 'loading' } | { readonly status: 'failed' } | { readonly status: 'read'; readonly exchange: ExchangeRead; readonly cast: ReadonlyMap<Id, Character> };

const words = (act: Act, key: string): string => (typeof act.payload[key] === 'string' ? (act.payload[key] as string) : '');

export function Exchange({ origin, place, perPage, nameOf }: {
  readonly origin: Act;
  readonly place: AnswerPlace | null;
  readonly perPage: number;
  /** The name of a character as the box's cast shows it, for where the place names none. */
  readonly nameOf: (id: Id | null) => string;
}) {
  const { api, ui } = useKayfa();
  const [read, setRead] = useState<Read>({ status: 'loading' });
  const [tries, setTries] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setRead({ status: 'loading' });
    void (async () => {
      try {
        const exchange = await api.exchange(origin.id);
        /* The avatars of the two characters as the Acts show them; a read that fails leaves them as initials. */
        const ids = [exchange.ask.character, exchange.answer?.character].filter((id): id is Id => typeof id === 'string');
        const cast = new Map<Id, Character>();
        if (ids.length > 0) { try { for (const c of await api.characters(ids)) cast.set(c.id, c); } catch { /* shown as initials */ } }
        if (live) setRead({ status: 'read', exchange, cast });
      } catch {
        if (live) setRead({ status: 'failed' });
      }
    })();
    return () => { live = false; };
  }, [api, origin.id, tries]);

  if (read.status === 'loading') return <p className="kb-small kb-muted">Loading…</p>;
  if (read.status === 'failed') {
    return (
      <div ref={box} tabIndex={-1} className="kb-exchange">
        <p className="kb-small kb-muted">The exchange did not load.</p>
        <button type="button" className="kb-exchange-retry" onClick={() => { box.current?.focus(); setTries((n) => n + 1); }}>Try again</button>
      </div>
    );
  }
  const { ask, answer, punishment } = read.exchange;
  const asking = ask.kind === 'report' ? 'reason' : 'plea';
  const askName = place?.asker.name ?? nameOf(ask.character);
  const staffName = answer === null ? '' : place?.staff?.name ?? nameOf(answer.character);
  const role = answer !== null && answer.kind === 'appeal_ruling' && answer.payload.office === 'boss' ? ui.copy.roleWord : modRole(ui.copy);
  const kind = punishment?.kind === 'infraction' || punishment?.kind === 'ban' || punishment?.kind === 'move' ? punishment.kind : place?.punishment ?? null;
  const on = place?.on ?? null;
  const said = words(ask, asking);
  return (
    <div className="kb-exchange">
      <p className="kb-exchange-by kb-small kb-muted">
        {ask.character !== null ? <Byline character={read.cast.get(ask.character)} name={askName} link id={ask.character} /> : <b>{askName}</b>} · <time dateTime={ask.createdAt}>{when(ask.createdAt)}</time>
      </p>
      <p className="kb-exchange-said">“{said}”</p>
      {answer === null ? <p className="kb-small kb-muted">Not answered yet.</p> : (
        <>
          <p className="kb-exchange-by kb-small kb-muted">
            {answer.character !== null ? <Byline character={read.cast.get(answer.character)} name={staffName} link id={answer.character} /> : <b>{staffName}</b>} · {role} · <time dateTime={answer.createdAt}>{when(answer.createdAt)}</time>
          </p>
          <p className="kb-exchange-said">{words(answer, 'line')}</p>
          <p className="kb-small">{answerWords(answer, kind, staffName, askName, api.now())}</p>
        </>
      )}
      {on !== null && <p className="kb-small"><Link to={threadHref(on.thread, pageOf(on.seq, perPage), on.seq)}>Go to post #{on.seq}</Link></p>}
    </div>
  );
}
