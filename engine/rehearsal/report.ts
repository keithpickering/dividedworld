/**
 * The rehearsal's report (docs/plans/2026-11-11-system-rehearsal-design.md, section 6): the log the collector reads back from a finished
 * run, and one self-contained page made from it. Pure. The page has inline CSS, no script and no external reference. A model's words and
 * the filler's are data, so every string from the log goes through `esc` before it is written, and nothing else writes into the page.
 */

export interface LogTrim { readonly where: string; readonly path: string; readonly predicate: string; readonly before: number; readonly after: number }
export interface LogMeetingPart {
  readonly part: string;
  /** ok, rejected or failed: the record's, or from the call's own error where the record has none for this part. */
  readonly outcome: string;
  readonly error: string | null;
  /** What the Boss was sent for this part: the system prompt and the messages. */
  readonly sent: { readonly system: string; readonly messages: readonly { readonly role: string; readonly content: string }[] };
  readonly answer: unknown;
  /** True when the call came from the cassette. */
  readonly replayed: boolean;
}
export interface LogMeeting {
  readonly id: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: string;
  readonly error: string | null;
  readonly bankBefore: number | null;
  readonly bankAfter: number | null;
  /** One per kept call of the meeting, in order (moves, staff, self), each with the outcome the meeting's record holds for that part. Empty when no call was kept. */
  readonly parts: readonly LogMeetingPart[];
  readonly memoryBefore: unknown;
  readonly memoryAfter: unknown;
}
export interface LogMove {
  readonly id: number;
  readonly staff: string;
  readonly kind: string;
  readonly why: string;
  readonly demand: unknown;
  readonly goLiveAt: string;
  readonly expiresAt: string | null;
  readonly held: boolean;
  readonly landedAt: string | null;
  /** The move_end's reason (met, expired, reversed), or null while it stands or never landed. */
  readonly endedHow: string | null;
  readonly failure: string | null;
}
export interface LogOrder { readonly meeting: number; readonly staff: string; readonly line: string; readonly allowance: number; readonly boards: number }
/** One kept model call: what was sent, what came back or why it was dropped, and the trims made. `cost` is from the ledger row when one matched. */
export interface LogCall {
  readonly at: string;
  readonly duty: string;
  readonly staff: string | null;
  readonly replayed: boolean;
  readonly costMicrodollars: number;
  readonly prompt: string;
  readonly answer: unknown;
  readonly error: { readonly message: string; readonly predicate: string } | null;
  readonly trims: readonly LogTrim[];
}
export interface LogVisit { readonly at: string; readonly staff: string; readonly line: string; readonly outcome: string | null; readonly call: LogCall | null }
export interface LogInfraction { readonly at: string; readonly kind: string; readonly payload: unknown; readonly call: LogCall | null }
export interface LogPatrol { readonly meeting: number; readonly n: number; readonly staff: string; readonly at: string; readonly ranAt: string | null; readonly sampled: number; readonly dropped: unknown; readonly outcome: unknown; readonly call: LogCall | null }
export interface LogApology { readonly at: string; readonly character: string; readonly state: string; readonly call: LogCall | null }
export interface LogChatter { readonly at: string; readonly staff: string; readonly character: string; readonly body: string; readonly call: LogCall | null }
export interface LogCost { readonly job: string; readonly calls: number; readonly liveMicrodollars: number; readonly replayedMicrodollars: number; /** Ledger rows no kept call paired with: cost the rehearsal cannot place as live or replayed. */ readonly unmatchedMicrodollars: number }
export interface LogSkip { readonly at: string; readonly what: string; readonly why: string }
export interface LogDay {
  readonly day: number;
  readonly date: string;
  readonly meetings: readonly LogMeeting[];
  readonly moves: readonly LogMove[];
  readonly orders: readonly LogOrder[];
  readonly visits: readonly LogVisit[];
  readonly infractions: readonly LogInfraction[];
  readonly patrols: readonly LogPatrol[];
  readonly apologies: readonly LogApology[];
  readonly chatter: readonly LogChatter[];
  /** Calls that belong to no Act or row above (reports, appeals, a rejected answer, anything unmatched), under their job. */
  readonly calls: readonly LogCall[];
  readonly trims: readonly LogTrim[];
  readonly costByJob: readonly LogCost[];
  readonly skips: readonly LogSkip[];
  readonly filler: { readonly through: number; readonly refused: number };
}
export interface RehearsalLog {
  readonly scenario: string;
  readonly seed: number;
  readonly mode: string;
  /** The model each tier asked for in this run; an empty string is a tier the run found no setting for, and the report says "unset". */
  readonly tiers: { readonly strong: string; readonly light: string };
  readonly daysRun: number;
  readonly day1: string;
  readonly systemOnAt: string | null;
  readonly cost: { readonly liveMicrodollars: number; readonly replayedMicrodollars: number; readonly unmatchedMicrodollars: number; readonly capDollars: number };
  readonly notes: readonly string[];
  readonly days: readonly LogDay[];
}

/** The one door a string goes through into the page. */
export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const dollars = (micro: number): string => `$${(micro / 1e6).toFixed(2)}`;
const json = (v: unknown): string => (v === null || v === undefined ? 'none' : JSON.stringify(v, null, 2));
const pre = (v: unknown): string => `<pre>${esc(typeof v === 'string' ? v : json(v))}</pre>`;
const time = (iso: string | null): string => (iso ? esc(iso.slice(11, 16)) : 'never');

/** Markup this file made from escaped parts, which a table cell takes as it is. */
class Html {
  readonly html: string;
  constructor(html: string) { this.html = html; }
}

function callHtml(c: LogCall | null): Html {
  if (!c) return new Html('');
  const trims = c.trims.length ? `<p>Trims: ${c.trims.map((t) => esc(`${t.path} ${t.predicate} ${t.before} to ${t.after}`)).join('; ')}</p>` : '';
  const result = c.error ? `<p>Dropped (${esc(c.error.predicate)}): ${esc(c.error.message)}</p>` : `<details><summary>Answer</summary>${pre(c.answer)}</details>`;
  return new Html(`<details><summary>${esc(c.duty)} call${c.replayed ? ' (replayed)' : ''}</summary>${pre(c.prompt)}</details>${result}${trims}`);
}

function table(head: readonly string[], rows: readonly (readonly unknown[])[], empty: string): string {
  if (rows.length === 0) return `<p class="none">${esc(empty)}</p>`;
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c instanceof Html ? c.html : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function partHtml(p: LogMeetingPart): string {
  const error = p.outcome === 'ok' ? '' : ` Error: ${esc(p.error ?? 'none recorded')}`;
  return `<div class="part"><h4>Part ${esc(p.part)}: ${esc(p.outcome)}${p.replayed ? ' (replayed)' : ''}${error}</h4>
<details><summary>What the Boss was sent</summary>${pre(p.sent.system)}${p.sent.messages.map((x) => `<p class="role">${esc(x.role)}</p>${pre(x.content)}`).join('')}</details>
<details open><summary>The answer</summary>${pre(p.answer)}</details></div>`;
}

function meetingHtml(m: LogMeeting): string {
  const replayed = m.parts.length === 0 ? '' : m.parts.every((p) => p.replayed) ? ' (replayed)' : ' (live or stub)';
  return `<div class="card"><h3>Meeting ${esc(m.id)}: ${esc(m.outcome)}${replayed}</h3>
<p>${esc(m.startedAt)} to ${time(m.finishedAt)}. Bank ${esc(m.bankBefore ?? 'none')} to ${esc(m.bankAfter ?? 'none')}.${m.error ? ` Error: ${esc(m.error)}` : ''}</p>
${m.parts.length ? m.parts.map(partHtml).join('') : '<p class="none">No call was kept for this meeting.</p>'}
<div class="side"><div><h4>Memory before</h4>${pre(m.memoryBefore)}</div><div><h4>Memory after</h4>${pre(m.memoryAfter)}</div></div></div>`;
}

function dayHtml(d: LogDay): string {
  return `<section><h2>Day ${esc(d.day)}, ${esc(d.date)}</h2>
<p>Filler: ${esc(d.filler.through)} actions through, ${esc(d.filler.refused)} refused.</p>
<h3>Meeting</h3>${d.meetings.length ? d.meetings.map(meetingHtml).join('') : '<p class="none">No meeting.</p>'}
<h3>Moves</h3>${table(['Move', 'Mod', 'Kind', 'Reason', 'Demand', 'Goes live', 'Landed', 'Ended', 'Held', 'Failure'],
    d.moves.map((m) => [m.id, m.staff, m.kind, m.why, json(m.demand), m.goLiveAt, m.landedAt ?? 'not yet', m.endedHow ?? 'standing', m.held ? 'held' : '', m.failure ?? '']), 'No moves.')}
<h3>Orders</h3>${table(['Meeting', 'Mod', 'Order', 'Allowance', 'Boards'], d.orders.map((o) => [o.meeting, o.staff, o.line, o.allowance, o.boards]), 'No orders.')}
<h3>Mod work</h3>${table(['Time', 'Mod', 'Visit', 'Ended', 'Call'], d.visits.map((v) => [v.at, v.staff, v.line, v.outcome ?? 'open', callHtml(v.call)]), 'No visits.')}
${table(['Time', 'Kind', 'What', 'Call'], d.infractions.map((i) => [i.at, i.kind, json(i.payload), callHtml(i.call)]), 'No filings.')}
${table(['Meeting', 'No.', 'Mod', 'At', 'Ran', 'Posts read', 'Dropped', 'Outcome', 'Call'], d.patrols.map((p) => [p.meeting, p.n, p.staff, p.at, p.ranAt ?? 'not yet', p.sampled, json(p.dropped), json(p.outcome), callHtml(p.call)]), 'No patrols.')}
${table(['Time', 'Character', 'State', 'Call'], d.apologies.map((a) => [a.at, a.character, a.state, callHtml(a.call)]), 'No apologies.')}
<h3>Chatter</h3>${table(['Time', 'Mod', 'Character', 'Said', 'Call'], d.chatter.map((c) => [c.at, c.staff, c.character, c.body, callHtml(c.call)]), 'No chatter.')}
<h3>Other calls</h3>${table(['Time', 'Job', 'Mod', 'Cost', 'Call'], d.calls.map((c) => [c.at, c.duty, c.staff ?? '', dollars(c.costMicrodollars), callHtml(c)]), 'None.')}
<h3>Trims and drops</h3>${table(['Where', 'Path', 'Bound', 'Before', 'After'], d.trims.map((t) => [t.where, t.path, t.predicate, t.before, t.after]), 'None.')}
<h3>Cost by job</h3>${table(['Job', 'Ledger rows', 'Live', 'Replayed', 'Unmatched'], d.costByJob.map((c) => [c.job, c.calls, dollars(c.liveMicrodollars), dollars(c.replayedMicrodollars), dollars(c.unmatchedMicrodollars)]), 'No model calls.')}
<h3>Skips</h3>${table(['Time', 'What', 'Why'], d.skips.map((s) => [s.at, s.what, s.why]), 'Nothing skipped.')}
</section>`;
}

const CSS = `:root{color-scheme:light dark;--bg:#fafaf7;--fg:#1d1d1b;--mute:#6b6b66;--line:#d8d8d0;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#15161a;--fg:#e8e8e3;--mute:#9a9a94;--line:#33343a;--card:#1d1e24}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;max-width:72rem;padding:1rem}
h1,h2,h3,h4{line-height:1.2}h2{border-top:2px solid var(--line);padding-top:1rem;margin-top:2rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.9rem}th,td{border:1px solid var(--line);padding:.25rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
pre{background:var(--card);border:1px solid var(--line);padding:.5rem;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}
.card{background:var(--card);border:1px solid var(--line);padding:.5rem 1rem;margin:.5rem 0}.none,.role{color:var(--mute)}
.side{display:grid;grid-template-columns:1fr 1fr;gap:1rem}@media (max-width:40rem){.side{grid-template-columns:1fr}}
summary{cursor:pointer}`;

export function reportHtml(log: RehearsalLog): string {
  const head = `<h1>Rehearsal: ${esc(log.scenario)}</h1>
<p>Seed ${esc(log.seed)}, mode ${esc(log.mode)}, ${esc(log.daysRun)} days from ${esc(log.day1)}. The System switched on ${esc(log.systemOnAt ?? 'never')}.</p>
<p>Models: strong ${esc(log.tiers.strong || 'unset')}, light ${esc(log.tiers.light || 'unset')}.</p>
<p>Cost: ${esc(dollars(log.cost.liveMicrodollars))} live of a $${esc(log.cost.capDollars)} cap, ${esc(dollars(log.cost.replayedMicrodollars))} replayed from the cassette, ${esc(dollars(log.cost.unmatchedMicrodollars))} on ledger rows no kept call matched.</p>
${log.notes.length ? `<ul>${log.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rehearsal: ${esc(log.scenario)}</title><style>${CSS}</style></head>
<body>${head}${log.days.map(dayHtml).join('\n')}</body></html>
`;
}
