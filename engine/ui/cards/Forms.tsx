/**
 * The report form and the appeal form (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/03-report.png): each one tab of the Lens's glass panel, opened from
 * "Report" in a post's foot links and from "Appeal" in a filed visit's tab (Post.tsx, Visit.tsx's `AppealCtx`).
 *
 * The words are the glass's own, plain and true, out of character: who judges, what the verdicts are, what it costs and what comes back. What the Mod says in answer is quoted as
 * its words (it may bluff); what the screen says about what was done is not. The answer lands in a status region, and a refusal in the server's words as an alert, with what was
 * typed kept.
 *
 * "A response never proves a private fact": nothing here is computed from who owns a character. The report goes through the HUD's mask, which the reader's own screen knows;
 * "N reports left today" is asked for that mask alone, in the player's own session, and shown only to them; an appeal goes through the infraction's own character, which the tab
 * offered Appeal to only where it is the HUD's mask.
 */
import { useContext, useId, useRef, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id, MyBan, Visit } from '../data/api.ts';
import { dayAndTime } from '../characters/format.ts';
import { GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { PREPARED_FAILED, usePrepared, useRest, type Prepared } from '../glass/prepared.ts';
import { FieldCount } from '../glass/FieldCount.tsx';
import { usePlayer } from '../player.tsx';
import { ThreadCtx } from '../thread/context.ts';
import { auraWords, appealTerms, modRole, pointsPlain, rulingWords, shortDate, topCharge, markedAs } from './visit.ts';
import { Layers } from '../glass/layer.tsx';
import './visit.css';
import './forms.css';

/** The Lens tab kinds the forms take: pseudo-kinds like a visit's, which no card key can be. */
export const REPORT_KIND = 'report';
export const APPEAL_KIND = 'appeal';

/** What a form is open for: a post's report, or an appeal of an infraction (with the post's visit, for the rule's words and the Mod that hears it). */
export type LensForm =
  | { readonly kind: typeof REPORT_KIND; readonly post: Id; readonly seq: number }
  | { readonly kind: typeof APPEAL_KIND; readonly infraction: Id; readonly visit: Visit | undefined };

/** The tab's name. */
export const formTabName = (f: LensForm): string => (f.kind === REPORT_KIND ? `Report post #${f.seq}` : 'Appeal');

const REASON_MAX = 280;
const PLEA_MAX = 1000;

/** A ban's ruling in a plain clause (open_appeal's, close_appeal's rules: overturned ends it, reduced halves it, increased runs it half again). */
export function banRulingWords(verdict: string): string {
  switch (verdict) {
    case 'overturned': return 'overturned it, so the ban has ended';
    case 'upheld': return 'upheld it, so nothing changed';
    case 'reduced': return 'reduced it to half its length';
    case 'increased': return 'increased it, so it runs half its length longer';
    default: return 'ruled on it';
  }
}

/** The terms of an appeal of a ban, in the glass's plain words: the Boss hears it. */
export const banAppealTerms = (days: number): string =>
  `The Boss hears it. It is refunded if overturned. It may be upheld, cut to half of its ${days === 1 ? '1 day' : `${days} days`}, or lengthened by half. One appeal per ban, and your plea is public.`;

/** The Mod's own words, quoted. */
const quoted = (line: string) => (line.trim() === '' ? null : <span className="kb-visit-said">“{line}”</span>);

/** What the report tab reads before it shows: the mask's reports left today and who judges on this board's beat. Neither read can stop the tab; a failed one is left out. */
export interface ReportRead {
  readonly left: number | null;
  readonly judge: { readonly mod: string; readonly board: string } | null;
}

/** The report tab's read, asked of the HUD's mask in this player's own session. */
export function useReportRead(): Prepared<ReportRead> {
  const { api } = useKayfa();
  const maskId = usePlayer().hudCharacter?.id ?? null;
  const board = useContext(ThreadCtx)?.summary.board ?? null;
  return usePrepared<ReportRead>(async () => {
    const [left, judge] = await Promise.all([
      maskId === null ? null : Promise.resolve(api.reportsLeft(maskId)).catch(() => null),
      board === null ? null : Promise.resolve(api.beatMod(board)).catch(() => null),
    ]);
    return { left, judge };
  }, () => `${maskId ?? ''}:${board ?? ''}`);
}

export function ReportForm({ post, seq, ready }: { readonly post: Id; readonly seq: number; readonly ready: ReportRead }) {
  const { api, instance, ui } = useKayfa();
  const player = usePlayer();
  const mask = player.hudCharacter;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<{ readonly verdict: string; readonly line: string } | null>(null);
  const [left, setLeft] = useState<number | null>(ready.left);
  const judge = ready.judge;
  const ids = useId();
  const price = instance.settings.modBots.reportPrice;
  const role = modRole(ui.copy);

  if (!mask) {
    return <div className="kb-visit"><p className="kb-visit-terms">None of your characters can report yet.</p></div>;
  }
  const over = [...reason].length > REASON_MAX;
  const blank = reason.trim() === '';
  const spent = left !== null && left <= 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || blank || over || spent) return;
    setBusy(true);
    setRefusal(null);
    try {
      const a = await api.fileReport(mask.id, post, reason);
      if (!a.ok) { setRefusal(a.error); return; }
      setResult({ verdict: a.value.verdict ?? 'heard', line: a.value.line });
      setReason('');
      void player.refresh();
      const again = await Promise.resolve(api.reportsLeft(mask.id)).catch(() => null);
      setLeft(again);
    } catch {
      setRefusal('That could not be sent. Check your connection and look at the thread before you report again.');
    } finally {
      setBusy(false);
    }
  };

  const said = result === null ? null : {
    visit: <>Your report was heard: a visit is on its way to post #{seq}. Your {auraWords(price)} is spent.</>,
    dismissed: <>Your report was heard and dismissed. Your {auraWords(price)} is spent.</>,
    backfire: <>Your report backfired: a visit is on its way to {mask.name}&apos;s latest post, for wasting the staff&apos;s time. Your {auraWords(price)} is spent.</>,
    heard: <>Your report was made, and it is public. Its answer will be in the thread.</>,
  }[result.verdict] ?? null;

  return (
    <form className="kb-visit kb-mod-form" onSubmit={(e) => void submit(e)} aria-label={`Report post #${seq}`}>
      <div className="kb-lens-section kb-visit-state">
        <p className="kb-visit-facts">
          Your report is public: it names {mask.name}, and anyone can react to it. {judge ? <>{judge.mod}, on {judge.board}&apos;s beat, judges it now:</> : <>{role} on this board&apos;s beat judges it now:</>} a visit, dismissed, or it backfires onto {mask.name}&apos;s latest post.
          If the Mod cannot judge it, your Aura comes back.
        </p>
      </div>
      <div className="kb-lens-section kb-mod-field">
        <h3 className="kb-visit-heading"><label htmlFor={`${ids}-reason`}>Why (shown with your report)</label></h3>
        <textarea
          id={`${ids}-reason`} className="kb-mod-textarea" rows={3} value={reason} aria-describedby={`${ids}-count`} aria-invalid={over ? 'true' : undefined}
          onChange={(e) => { setReason(e.target.value); if (refusal) setRefusal(null); }}
        />
        <FieldCount id={`${ids}-count`} text={reason} max={REASON_MAX} />
        {over && <p role="alert" className="kb-notice" data-kb-tone="refusal">A reason is at most {REASON_MAX} characters.</p>}
      </div>
      <div className="kb-lens-section kb-visit-appeal-section">
        <GlassButton type="submit" kind="secondary" className="kb-visit-appeal" busy={busy} aria-disabled={blank || over || spent ? 'true' : undefined}>Report · {auraWords(price)}</GlassButton>
        {left !== null && (
          <p className="kb-visit-terms">{mask.name} has {left} {left === 1 ? 'report' : 'reports'} left today.{spent ? ' Reports open again after midnight UTC.' : ''}</p>
        )}
      </div>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
      <p role="status" className="kb-visit-result">
        {said}
        {result !== null && result.line.trim() !== '' && <> {role} said: {quoted(result.line)}</>}
      </p>
    </form>
  );
}

/** The infraction's own facts, as its Act carries them. */
export interface Said {
  readonly character: Id;
  readonly band: string;
  readonly points: number;
  readonly expiresAt: string;
  readonly ruleNumber: number | null;
}
function said(act: Act): Said | null {
  const p = act.payload;
  if (act.kind !== 'infraction' || typeof p['character'] !== 'string' || typeof p['points'] !== 'number') return null;
  return {
    character: p['character'], band: String(p['band'] ?? 'minor'), points: p['points'], expiresAt: String(p['expires_at'] ?? ''), ruleNumber: typeof p['rule_number'] === 'number' ? p['rule_number'] : null,
  };
}

/** The appeal tab's read: the infraction's own Act, before the tab shows. An Act that is not an infraction cannot be appealed, so it is a failed read. */
export function useAppealRead(infraction: Id): Prepared<Said> {
  const { api } = useKayfa();
  return usePrepared<Said>(async () => {
    const a = await Promise.resolve(api.act(infraction));
    const facts = a ? said(a) : null;
    if (facts === null) throw new Error('not an infraction');
    return facts;
  }, () => infraction);
}

export function AppealForm({ infraction, visit, nameOf, ban, facts }: { readonly infraction: Id; readonly visit: Visit | undefined; readonly nameOf: (c: Id | null) => string; readonly ban?: MyBan; /** The infraction's facts, read before the tab showed; none for a ban. */ readonly facts?: Said }) {
  const { api, instance, ui } = useKayfa();
  const player = usePlayer();
  const [plea, setPlea] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<{ readonly verdict: string | null; readonly line: string } | null>(null);
  const ids = useId();
  const price = instance.settings.modBots.appealPrice;
  const role = modRole(ui.copy);

  const f: Said | null = facts ?? null;
  const mod = ban ? 'The Boss' : visit ? nameOf(visit.mod) : role;
  const top = visit ? topCharge(visit.charges) : null;
  const rule = top ? top.rule ?? markedAs(top) : f !== null && f.ruleNumber !== null ? `Rule ${f.ruleNumber}` : 'a rule';
  const over = [...plea].length > PLEA_MAX;
  const blank = plea.trim() === '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || blank || over || (f === null && !ban)) return;
    setBusy(true);
    setRefusal(null);
    try {
      const a = await api.fileAppeal(ban ? ban.character : f!.character, ban ? ban.ban : infraction, plea);
      if (!a.ok) { setRefusal(a.error); return; }
      setResult({ verdict: a.value.verdict, line: a.value.line });
      setPlea('');
      void player.refresh();
    } catch {
      setRefusal('That could not be sent. Check your connection and look at the thread before you appeal again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="kb-visit kb-mod-form" onSubmit={(e) => void submit(e)} aria-label="Appeal">
      <div className="kb-lens-section kb-visit-state">
        {ban ? (
          <>
            <p className="kb-visit-facts">The punishment: a ban of {ban.days === 1 ? '1 day' : `${ban.days} days`}{ban.rule ? `, after ${ban.rule}` : ''}. It ends by itself {dayAndTime(ban.until)}.</p>
            <p className="kb-visit-terms">{banAppealTerms(ban.days)}</p>
          </>
        ) : (
          <>
            <p className="kb-visit-facts">
              {f !== null && <>The punishment: {rule}, a {f.band} breach, {pointsPlain(f.points)} on {nameOf(f.character)}&apos;s warn bar
                  {f.expiresAt !== '' ? (Date.parse(f.expiresAt) > Date.now() ? `, dropping off ${shortDate(f.expiresAt)}` : `, dropped off ${shortDate(f.expiresAt)}`) : ''}.</>}
            </p>
            <p className="kb-visit-terms">{appealTerms(mod, { points: f === null ? 0 : f.points })}</p>
          </>
        )}
      </div>
      <div className="kb-lens-section kb-mod-field">
        <h3 className="kb-visit-heading"><label htmlFor={`${ids}-plea`}>Your plea (public)</label></h3>
        <textarea
          id={`${ids}-plea`} className="kb-mod-textarea" rows={4} value={plea} aria-describedby={`${ids}-count`} aria-invalid={over ? 'true' : undefined}
          onChange={(e) => { setPlea(e.target.value); if (refusal) setRefusal(null); }}
        />
        <FieldCount id={`${ids}-count`} text={plea} max={PLEA_MAX} />
        {over && <p role="alert" className="kb-notice" data-kb-tone="refusal">A plea is at most {PLEA_MAX} characters.</p>}
      </div>
      <div className="kb-lens-section kb-visit-appeal-section">
        <GlassButton type="submit" kind="secondary" className="kb-visit-appeal" busy={busy} aria-disabled={blank || over || (f === null && !ban) ? 'true' : undefined}>Appeal · {auraWords(price)}</GlassButton>
      </div>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
      <p role="status" className="kb-visit-result">
        {result !== null && (result.verdict === null
          ? <>Your appeal was made, and it is public. Its ruling will be in the thread.</>
          : <>{mod} heard it and {ban ? banRulingWords(result.verdict) : rulingWords(result.verdict)}.{result.line.trim() !== '' && <> {mod} said: {quoted(result.line)}</>}</>)}
      </p>
    </form>
  );
}

/**
 * "Appeal to the Boss · 0.50 Aura" for a banned character: the way out of a ban beside "it ends by itself" (the composer's note, the ban's line in the log). It opens the appeal form
 * in a ban mode over the page: the Boss hears it, with the ban's end and the terms. The ban's Act is what an appeal names (`my_bans`): `ban` where the caller already holds it (the log's
 * line), else read for `character` when the form opens. Shown only where the screen is the banned character's own player's (the composer, the player's own log).
 */
export function BanAppeal({ character, ban }: { readonly character: Id; readonly ban?: MyBan }) {
  const { api, instance } = useKayfa();
  const opener = useRef<HTMLButtonElement>(null);
  /* The ban is read before the overlay opens (the glass-load design, section 4); a ban the caller holds opens at once. A ban that has ended answers nothing, which is a read that failed. */
  const prepared = usePrepared<MyBan>(async () => {
    if (ban) return ban;
    const b = await Promise.resolve(api.myBan(character));
    if (!b) throw new Error('no ban');
    return b;
  }, () => `${character}:${ban?.ban ?? ''}`);
  const rest = useRest(() => { if (!ban) prepared.early(); });
  const { data: shown, busy, failed, open, cancel } = prepared;
  return (
    <>
      <button
        ref={opener} type="button" className="kb-button kb-ban-appeal" aria-haspopup="dialog" aria-busy={busy ? 'true' : undefined}
        onClick={() => { if (!busy) void open(); }} {...rest}
      >
        Appeal to the Boss · {auraWords(instance.settings.modBots.appealPrice)}
      </button>
      {failed && <span role="alert" className="kb-visit-terms"> {PREPARED_FAILED}</span>}
      <Layers>
      {shown !== null && (
        <Overlay title="Appeal the ban" surface="log" kicker="Appeal to the Boss" onClose={cancel} returnFocusTo={() => opener.current}>
          <AppealForm infraction={shown.ban} visit={undefined} nameOf={() => ''} ban={shown} />
        </Overlay>
      )}
      </Layers>
    </>
  );
}
