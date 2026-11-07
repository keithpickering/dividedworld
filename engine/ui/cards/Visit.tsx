/**
 * A visit's mark and its Lens tab (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/01-on-a-visit.png and 02-filed-author.png).
 *
 * The mark is the Marks' glass tile in the visit's ink (`--kb-visit-ink`), a stopwatch and the time left as `h:mm`, redrawn each minute while the
 * visit is open, or how it went ("Filed"). It is first in the post's strip and opens the Lens on the visit's tab.
 *
 * The tab is the glass's plain voice, built from the visit's Acts: who is visiting and the charge; "Talk it down" while the visit is open (a
 * quiz's answers as full-width buttons, a bribe's price, or a word that a card cast on the thread talks a distraction-weak Mod down); once it is
 * filed, what landed on whom and when it drops off, and Appeal to the author's current mask alone; and "How it went", each Act as a Lens row. What a
 * Mod said is quoted as its words and never written here. There is no timer on the challenge ("An accessible path costs what the obstacle
 * costs"): every control is a button, a try is one per mask, and the result is in a status region.
 *
 * "A response never proves a private fact": nothing here is computed from who owns a mask. The tab offers a try to the HUD's mask, and Appeal
 * to it when it is the infraction's character, both of which the reader's own screen knows.
 */
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, Visit, VisitEnd, VisitStory } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Reactions } from '../reactions/Reactions.tsx';
import type { Mine } from '../reactions/mine.ts';
import { ThreadCtx } from '../thread/context.ts';
import { dayAndTime } from '../characters/format.ts';
import type { Tallies } from '../thread/tallies.ts';
import {
  VISIT_KIND, appealTerms, auraWords, chargeWords, markLabel, markText, markedAs, modRole, pointsWords, rulingWords, shortDate, stillCounts, topCharge, tryTerms, pointsPlain, visitState,
} from './visit.ts';
import { useMinute } from './minute.ts';
import './visit.css';

/**
 * Opens the appeal form for an infraction (Task 13 builds the form): given the infraction's Act and the button that asked, which the form gives
 * focus back to. Where nothing provides one, Appeal does nothing yet.
 */
export type OpenAppeal = (infraction: Id, opener: HTMLElement) => void;
export const AppealCtx = createContext<OpenAppeal | null>(null);

/** The stopwatch, drawn in the mark's ink. */
function Stopwatch() {
  return (
    <svg className="kb-visit-watch" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="12" cy="14" r="7.5" />
      <path d="M12 14V9.5M9.5 3h5M12 3v3M18.2 7.2l1.4-1.4" />
    </svg>
  );
}

/** The visit's mark: first in the post's strip. */
export const VisitMark = memo(function VisitMark({ visit, mod, expanded, onOpen }: {
  readonly visit: Visit; readonly mod: string; readonly expanded: boolean; readonly onOpen: (kind: string, opener: HTMLElement) => void;
}) {
  const state = visitState(visit);
  const now = useMinute(state === 'open' ? visit.endsAt : null);
  return (
    <button
      type="button" className="kb-mark kb-visit-mark kb-meta-tile" data-kb-card={VISIT_KIND} data-kb-visit={state}
      aria-label={markLabel(mod, state, visit.endsAt, now)} aria-haspopup="dialog" aria-expanded={expanded}
      onClick={(e) => onOpen(VISIT_KIND, e.currentTarget)}
    >
      <span className="kb-meta-tile-in" aria-hidden="true"><Stopwatch /><span className="kb-visit-time">{markText(state, visit.endsAt, now)}</span></span>
    </button>
  );
});

/** A person's name or "someone": a character the thread could not name. */
const said = (s: string | undefined): string => (typeof s === 'string' ? s : '');

interface Row {
  readonly act: Id;
  readonly at: string;
  readonly character: Id | null;
  /** Whether the Act is a Mod's, so the row credits its role. */
  readonly staff?: true;
  /** What the row's Act did, after its character's name (or alone where no character did it). */
  readonly did: string;
  /** The words the Act carries, quoted as its author's. */
  readonly quote: string;
  readonly label: string;
}

/** The visit's Acts as rows, in the order they happened: the report and its verdict, the visit's start, each attempt, the end, the appeal and its ruling. */
function rowsOf(visit: Visit, story: VisitStory, name: (c: Id | null) => string): readonly Row[] {
  const out: Row[] = [];
  const mod = name(visit.mod);
  if (story.report) out.push({ act: story.report.id, at: story.report.createdAt, character: story.report.character, did: 'reported this post', quote: said(story.report.payload['reason'] as string | undefined), label: `${name(story.report.character)}'s report` });
  if (story.verdict) {
    const v = story.verdict.payload['verdict'];
    out.push({
      act: story.verdict.id, at: story.verdict.createdAt, character: story.verdict.character, staff: true, quote: said(story.verdict.payload['line'] as string | undefined), label: `${mod}'s verdict`,
      did: v === 'visit' ? 'judged the report: it sent a visit' : v === 'dismissed' ? 'judged the report: dismissed it' : 'judged the report: it backfired on the reporter',
    });
  }
  out.push({ act: visit.id, at: visit.at, character: visit.mod, staff: true, did: 'began the visit', quote: visit.line, label: `${mod}'s visit` });
  for (const a of story.attempts) {
    const kind = a.payload['kind'];
    const right = a.payload['succeeded'] === true;
    out.push({
      act: a.id, at: a.createdAt, character: a.character, label: `${name(a.character)}'s try`,
      did: kind === 'quiz' ? `tried the quiz and was ${right ? 'right' : 'wrong'}` : kind === 'bribe' ? 'paid the price' : 'cast a card on the thread',
      quote: kind === 'quiz' ? said(a.payload['answer'] as string | undefined) : '',
    });
  }
  const end = story.end ?? visit.end;
  if (end) {
    const by = story.attempts.find((a) => a.id === end.byAct);
    out.push({
      act: end.act, at: end.at, character: end.outcome === 'filed' ? visit.mod : null, ...(end.outcome === 'filed' ? { staff: true as const } : {}), label: `${mod}'s visit ending`,
      did: end.outcome === 'filed' ? 'filed' : end.outcome === 'intercepted' ? `The visit was talked down${by ? ` by ${name(by.character)}` : ''}` : end.outcome === 'trapped' ? 'The visit was ended by a trap set on the post' : 'The visit was ended by an admin',
      quote: end.outcome === 'filed' ? end.line : '',
    });
  }
  if (story.appeal) out.push({ act: story.appeal.id, at: story.appeal.createdAt, character: story.appeal.character, did: 'appealed', quote: said(story.appeal.payload['plea'] as string | undefined), label: `${name(story.appeal.character)}'s appeal` });
  if (story.ruling) {
    out.push({
      act: story.ruling.id, at: story.ruling.createdAt, character: story.ruling.character, staff: true, label: `${mod}'s ruling`,
      did: `ruled on the appeal: ${said(story.ruling.payload['verdict'] as string | undefined)}`, quote: said(story.ruling.payload['line'] as string | undefined),
    });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function HowRow({ row, name, role, tallies, mine, onSpin }: {
  readonly row: Row; readonly name: (c: Id | null) => string; readonly role: string; readonly tallies: Tallies; readonly mine: Mine; readonly onSpin: (act: Id, label: string) => void;
}) {
  return (
    <li className="kb-lens-row" data-kb-act={row.act}>
      <p className="kb-lens-by">
        {row.character !== null && <><span className="kb-lens-who kb-glass-display">{name(row.character)}</span> · </>}
        {row.staff && <>{role} · </>}
        {row.did} <time dateTime={row.at}>{dayAndTime(row.at)}</time>
      </p>
      {row.quote !== '' && <blockquote className="kb-lens-message">“{row.quote}”</blockquote>}
      <div className="kb-lens-row-foot">
        <Reactions act={row.act} author={row.character} authorName={row.character === null ? 'the visit' : name(row.character)} subject={row.label} tallies={tallies} mine={mine} />
        <div className="kb-lens-actions">
          <button type="button" className="kb-kit-tile kb-lens-action" onClick={() => onSpin(row.act, row.label)}><span className="kb-kit-tile-label">Spin thread</span></button>
        </div>
      </div>
    </li>
  );
}

export interface VisitPanelProps {
  readonly visit: Visit;
  readonly thread: Id;
  /** The post's author: whose warn bar the visit's filing lands on. */
  readonly author: Id | null;
  readonly nameOf: (character: Id | null) => string;
  readonly tallies: Tallies;
  readonly mine: Mine;
  /** Spin a thread from one of the visit's Acts: the Lens has closed. */
  readonly onSpin: (act: Id, label: string) => void;
  /** The visit's end, as this panel has read it: the strip's mark and the tab's name follow. */
  readonly onEnded: (end: VisitEnd) => void;
}

/** What the tab says is "a try": a quiz's answers, a bribe's price or a distraction's word, and the result in a status region. */
function Challenge({ visit, mod, mask, spent: tried, picked, onTry, busy }: {
  readonly visit: Visit; readonly mod: string; readonly mask: { readonly id: Id; readonly name: string } | null; readonly spent: boolean; readonly picked: string | null;
  readonly onTry: (answer: string | null) => void; readonly busy: boolean;
}) {
  const { instance } = useKayfa();
  const hours = instance.settings.modBots.tailHours;
  const c = visit.challenge;
  const turn = (answer: string | null) => { if (!busy && !tried) onTry(answer); };
  /* A try spent keeps its buttons where they are, marked, so focus stays on the one pressed (a button that vanished would drop it). */
  const spent = busy || tried;
  const who = mask?.name ?? 'your mask';
  return (
    <div className="kb-lens-section kb-visit-talk">
      <h3 className="kb-visit-heading">Talk it down</h3>
      {c.kind === 'quiz' && (
        <>
          <p className="kb-visit-ask"><span className="kb-lens-who kb-glass-display">{mod}</span> asks: <span className="kb-visit-said">“{c.question}”</span></p>
          <div role="group" aria-label={`Answers to ${mod}'s question`} className="kb-visit-choices">
            {c.choices.map((choice) => (
              <button key={choice} type="button" className="kb-kit-tile kb-visit-choice" aria-disabled={spent || mask === null ? 'true' : undefined} aria-pressed={picked === choice ? 'true' : undefined} onClick={() => turn(choice)}>
                <span className="kb-kit-tile-label">{choice}</span>
              </button>
            ))}
          </div>
          <p className="kb-visit-terms">{tryTerms(mod, who, hours, instance.settings.warnBar.bands.minor)}</p>
        </>
      )}
      {c.kind === 'bribe' && (
        <>
          <p className="kb-visit-terms">{mod} will go for a price, and the price goes nowhere. One try for {who}.</p>
          <button type="button" className="kb-kit-tile kb-visit-choice" aria-disabled={spent || mask === null ? 'true' : undefined} onClick={() => turn(null)}>
            <span className="kb-kit-tile-label">Pay {auraWords(c.price)}</span>
          </button>
        </>
      )}
      {c.kind === 'distraction' && (
        <p className="kb-visit-terms">{mod} is not moved by an answer or a price. Any card cast on this thread talks it down.</p>
      )}
      {mask === null && c.kind !== 'distraction' && <p className="kb-visit-terms">Pick a mask in the HUD to try.</p>}
    </div>
  );
}

export function VisitPanel({ visit, thread, author, nameOf, tallies, mine, onSpin, onEnded }: VisitPanelProps) {
  const { api, instance, ui } = useKayfa();
  const player = usePlayer();
  const know = useContext(ThreadCtx)?.know;
  const openAppeal = useContext(AppealCtx);
  const [story, setStory] = useState<VisitStory | null>(null);
  const [failed, setFailed] = useState(false);
  const [names, setNames] = useState(0);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  /* The tries the server took from this panel, by mask and the answer given: a try is spent here whatever the reread of the story does. */
  const [taken, setTaken] = useState<ReadonlyMap<Id, string | null>>(new Map());
  const [localEnd, setLocalEnd] = useState<VisitEnd | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const foldId = useId();
  const root = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const ended = useRef(onEnded);
  ended.current = onEnded;

  const load = useCallback(async () => {
    try {
      const s = await api.visitStory(thread, visit.id, visit.post);
      if (!live.current) return;
      const ids = [s.report, s.verdict, ...s.attempts, s.appeal, s.ruling].filter((a): a is Act => a !== null).map((a) => a.id);
      if (s.end) ids.push(s.end.act);
      ids.push(visit.id);
      const [counts, mineNow] = await Promise.all([api.tallies(ids), api.myReactions(ids)]).catch(() => [{}, []] as const);
      if (!live.current) return;
      for (const [id, t] of Object.entries(counts)) tallies.merge(id, t);
      for (const m of mineNow) mine.add(m);
      const people = [visit.mod, s.report?.character ?? null, s.appeal?.character ?? null, ...s.attempts.map((a) => a.character), s.ruling?.character ?? null].filter((c): c is Id => c !== null);
      /* A name the thread did not know is read and then drawn: the characters in these Acts may not have a post on the page. */
      if (know) void know(people).then(() => { if (live.current) setNames((n) => n + 1); }).catch(() => undefined);
      setStory(s);
      setFailed(false);
      if (s.end) ended.current(s.end);
    } catch {
      if (live.current) setFailed(true);
    }
  }, [api, thread, visit.id, visit.post, visit.mod, tallies, mine, know]);
  useEffect(() => { void load(); }, [load]);

  const name = useCallback((c: Id | null) => nameOf(c), [nameOf, names]); // eslint-disable-line react-hooks/exhaustive-deps
  const mod = name(visit.mod);
  const authorName = author === null ? 'The author' : name(author);
  const role = modRole(ui.copy);
  const bands = instance.settings.warnBar.bands;
  const end = story?.end ?? visit.end ?? localEnd;
  const state = visitState(visit, end);
  const inf = story?.infraction ?? null;
  const now = useMinute(state === 'open' ? visit.endsAt : null);
  const top = topCharge(visit.charges);
  const topPoints = top ? bands[top.band] : 0;
  const mask = player.hudCharacter && player.hudCharacter.debutedAt !== null && player.hudCharacter.retiredAt === null ? player.hudCharacter : null;
  const tried = mask && story ? story.attempts.find((a) => a.character === mask.id) ?? null : null;
  const earlier = tried === null ? '' : tried.payload['succeeded'] === true ? `${mask!.name} tried this visit and got past ${mod}.` : `${mask!.name} tried this visit and was wrong.`;

  const attempt = async (answer: string | null) => {
    if (!mask || busy) return;
    setBusy(true);
    setResult('');
    try {
      const a = await api.intercept(mask.id, visit.id, answer);
      if (!live.current) return;
      if (!a.ok) { setResult(a.error); return; }
      setTaken((t) => new Map(t).set(mask.id, answer));
      if (a.value.succeeded) {
        /* The visit is over whether or not the story can be read again: the mark and the tab follow from here. */
        const over: VisitEnd = { act: a.value.act, at: new Date().toISOString(), outcome: 'intercepted', byAct: a.value.act, line: '' };
        setLocalEnd(over);
        ended.current(over);
      }
      if (a.value.succeeded) setResult(`${mask.name} got past ${mod}. The visit is over, and nothing landed on ${authorName}.`);
      else setResult(`That was not the answer. ${mod} will visit ${mask.name}'s next post within ${instance.settings.modBots.tailHours} hours.`);
      const had = root.current?.contains(document.activeElement) ?? false;
      await load();
      /* A try that worked ends the visit and takes the challenge from the tab with the control that was pressed: focus goes to the open tab, where the Lens's focus began. */
      if (a.value.succeeded && had) root.current?.closest('[role="dialog"]')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
      if (visit.challenge.kind === 'bribe') void player.refresh();
    } catch {
      if (live.current) setResult('That could not be sent. Check your connection and open this visit again before you try again.');
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const heading: ReactNode = {
    open: <>is on a visit</>,
    filed: <>filed its report</>,
    intercepted: <>was talked down</>,
    trapped: <>was stopped by a trap</>,
    reversed: <>was ended by an admin</>,
  }[state];

  const marked = top ? markedAs(top) : 'a rule';
  const timeIsUp = Date.parse(visit.endsAt) <= now;
  const charges = visit.charges.map((c) => chargeWords(c, bands[c.band])).join('; ');
  const rows = useMemo(() => (story ? rowsOf(visit, story, name) : []), [visit, story, name]);
  const appealable = state === 'filed' && inf !== null && mask !== null && mask.id === inf.character && story?.appeal === null && stillCounts(inf, now);
  const appealWaiting = story?.appeal && !story.ruling;

  return (
    <div className="kb-visit" ref={root} aria-busy={story === null && !failed ? 'true' : undefined}>
      <div className="kb-lens-section kb-lens-state kb-visit-state">
        <h3 className="kb-visit-heading"><span className="kb-lens-who kb-glass-display">{mod}</span> {heading}</h3>
        {state === 'open' && (
          <p className="kb-visit-facts">
            {visit.charges.length === 1 ? 'Charge' : 'Charges'}: {charges}.{' '}
            {timeIsUp
              ? `The time is up, so it files at the next check unless it is talked down first. If it files, ${authorName}'s warn bar gains ${pointsWords(topPoints)} and this post is marked as breaking ${marked}.`
              : `If nobody talks it down by ${dayAndTime(visit.endsAt)}, ${authorName}'s warn bar gains ${pointsWords(topPoints)} and this post is marked as breaking ${marked}.`}
          </p>
        )}
        {state === 'filed' && (
          <p className="kb-visit-facts">
            {inf
              ? `${top ? `${top.rule ?? marked}: a ${inf.band} breach. ` : ''}${authorName}'s warn bar gained ${pointsPlain(inf.points)}; ${stillCounts(inf, now) ? 'they drop off on' : 'they dropped off on'} ${shortDate(inf.expiresAt)}.${stillCounts(inf, now) && story?.warnPoints != null ? ` The bar now stands at ${story.warnPoints} of ${instance.settings.warnBar.size}.` : ''} The post keeps its words under the notice.`
              : 'The visit filed.'}
          </p>
        )}
        {state === 'intercepted' && <p className="kb-visit-facts">The visit ended on {dayAndTime(end!.at)}. Nothing landed on {authorName}.</p>}
        {state === 'trapped' && <p className="kb-visit-facts">A trap set on this post sprang when the visit began, and the visit ended on {dayAndTime(end!.at)}. Nothing landed on {authorName}.</p>}
        {state === 'reversed' && <p className="kb-visit-facts">An admin ended the visit on {dayAndTime(end!.at)}. Nothing landed on {authorName}.</p>}
        {state === 'filed' && story?.ruling && <p className="kb-visit-facts">{mod} heard an appeal of it and {rulingWords(said(story.ruling.payload['verdict'] as string | undefined))}.</p>}
        {state === 'filed' && appealWaiting && <p className="kb-visit-facts">An appeal of it is waiting to be heard. If it cannot be heard, the fee is refunded.</p>}
      </div>
      {/* Drawn from the story, never the page alone: a visit that ended since the page was read offers no try. */}
      {state === 'open' && story !== null && <Challenge visit={visit} mod={mod} mask={mask} spent={tried !== null || (mask !== null && taken.has(mask.id))} picked={mask && taken.has(mask.id) ? taken.get(mask.id) ?? null : typeof tried?.payload['answer'] === 'string' ? tried.payload['answer'] : null} onTry={(a) => void attempt(a)} busy={busy} />}
      {/* One live region for the visit: the result of a try stays when the visit it ended is over, and a region that was there before it spoke is announced. */}
      <p role="status" className="kb-visit-result">{result || (state === 'open' ? earlier : '')}</p>
      {appealable && inf && (
        <div className="kb-lens-section kb-visit-appeal-section">
          <button type="button" className="kb-kit-tile kb-visit-appeal" onClick={(e) => openAppeal?.(inf.act, e.currentTarget)}>
            <span className="kb-kit-tile-label">Appeal · {auraWords(instance.settings.modBots.appealPrice)}</span>
          </button>
          <p className="kb-visit-terms">{appealTerms(mod, inf)}</p>
        </div>
      )}
      {failed && <p className="kb-visit-terms" role="alert">How it went could not be read. Close this and open it again.</p>}
      {rows.length > 0 && (
        <div className="kb-lens-section kb-lens-who-section">
          <button type="button" className="kb-lens-fold" aria-expanded={unfolded} aria-controls={foldId} onClick={() => setUnfolded((u) => !u)}>
            <span className="kb-lens-fold-sign" aria-hidden="true" />
            How it went · {rows.length} {rows.length === 1 ? 'act' : 'acts'}
          </button>
          <ul id={foldId} className="kb-lens-rows" hidden={!unfolded}>
            {unfolded && rows.map((r) => <HowRow key={r.act} row={r} name={name} role={role} tallies={tallies} mine={mine} onSpin={onSpin} />)}
          </ul>
        </div>
      )}
    </div>
  );
}
