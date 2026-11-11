/**
 * The rehearsal's report (docs/plans/2026-11-11-system-rehearsal-design.md, section 6): the log the collector reads back from a finished
 * run, and one self-contained page made from it. Pure. The page has inline CSS, no script and no external reference. A model's words and
 * the filler's are data, so every string from the log goes through `esc` before it is written, and nothing else writes into the page.
 */

export interface LogTrim { readonly where: string; readonly path: string; readonly predicate: string; readonly before: number; readonly after: number }
export interface LogMeeting {
  readonly id: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: string;
  readonly error: string | null;
  readonly bankBefore: number | null;
  readonly bankAfter: number | null;
  /** What the Boss was sent: the system prompt and the messages (the digest and its memory are in them). Null when no call was kept. */
  readonly sent: { readonly system: string; readonly messages: readonly { readonly role: string; readonly content: string }[] } | null;
  readonly answer: unknown;
  readonly memoryBefore: unknown;
  readonly memoryAfter: unknown;
  /** Null when no call was kept; true when the call came from the cassette. */
  readonly replayed: boolean | null;
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
export interface LogVisit { readonly at: string; readonly staff: string; readonly line: string; readonly outcome: string | null }
export interface LogInfraction { readonly at: string; readonly kind: string; readonly payload: unknown }
export interface LogPatrol { readonly meeting: number; readonly n: number; readonly staff: string; readonly at: string; readonly ranAt: string | null; readonly sampled: number; readonly dropped: unknown; readonly outcome: unknown }
export interface LogApology { readonly at: string; readonly character: string; readonly state: string }
export interface LogChatter { readonly at: string; readonly staff: string; readonly character: string; readonly body: string }
export interface LogCost { readonly job: string; readonly calls: number; readonly liveMicrodollars: number; readonly replayedMicrodollars: number }
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
  readonly trims: readonly LogTrim[];
  readonly costByJob: readonly LogCost[];
  readonly skips: readonly LogSkip[];
  readonly filler: { readonly through: number; readonly refused: number };
}
export interface RehearsalLog {
  readonly scenario: string;
  readonly seed: number;
  readonly mode: string;
  readonly daysRun: number;
  readonly day1: string;
  readonly systemOnAt: string | null;
  readonly cost: { readonly liveMicrodollars: number; readonly replayedMicrodollars: number; readonly capDollars: number };
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

function table(head: readonly string[], rows: readonly (readonly unknown[])[], empty: string): string {
  if (rows.length === 0) return `<p class="none">${esc(empty)}</p>`;
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function meetingHtml(m: LogMeeting): string {
  const sent = m.sent
    ? `<details><summary>What the Boss was sent (the digest and its memory)</summary>${pre(m.sent.system)}${m.sent.messages.map((x) => `<p class="role">${esc(x.role)}</p>${pre(x.content)}`).join('')}</details>`
    : '<p class="none">No call was kept for this meeting.</p>';
  return `<div class="card"><h3>Meeting ${esc(m.id)}: ${esc(m.outcome)}${m.replayed === null ? '' : m.replayed ? ' (replayed)' : ' (live or stub)'}</h3>
<p>${esc(m.startedAt)} to ${time(m.finishedAt)}. Bank ${esc(m.bankBefore ?? 'none')} to ${esc(m.bankAfter ?? 'none')}.${m.error ? ` Error: ${esc(m.error)}` : ''}</p>
${sent}
<details open><summary>The answer</summary>${pre(m.answer)}</details>
<div class="side"><div><h4>Memory before</h4>${pre(m.memoryBefore)}</div><div><h4>Memory after</h4>${pre(m.memoryAfter)}</div></div></div>`;
}

function dayHtml(d: LogDay): string {
  return `<section><h2>Day ${esc(d.day)}, ${esc(d.date)}</h2>
<p>Filler: ${esc(d.filler.through)} actions through, ${esc(d.filler.refused)} refused.</p>
<h3>Meeting</h3>${d.meetings.length ? d.meetings.map(meetingHtml).join('') : '<p class="none">No meeting.</p>'}
<h3>Moves</h3>${table(['Move', 'Mod', 'Kind', 'Reason', 'Demand', 'Goes live', 'Landed', 'Ended', 'Held', 'Failure'],
    d.moves.map((m) => [m.id, m.staff, m.kind, m.why, json(m.demand), m.goLiveAt, m.landedAt ?? 'not yet', m.endedHow ?? 'standing', m.held ? 'held' : '', m.failure ?? '']), 'No moves.')}
<h3>Orders</h3>${table(['Meeting', 'Mod', 'Order', 'Allowance', 'Boards'], d.orders.map((o) => [o.meeting, o.staff, o.line, o.allowance, o.boards]), 'No orders.')}
<h3>Mod work</h3>${table(['Time', 'Mod', 'Visit', 'Ended'], d.visits.map((v) => [v.at, v.staff, v.line, v.outcome ?? 'open']), 'No visits.')}
${table(['Time', 'Kind', 'What'], d.infractions.map((i) => [i.at, i.kind, json(i.payload)]), 'No filings.')}
${table(['Meeting', 'No.', 'Mod', 'At', 'Ran', 'Posts read', 'Dropped', 'Outcome'], d.patrols.map((p) => [p.meeting, p.n, p.staff, p.at, p.ranAt ?? 'not yet', p.sampled, json(p.dropped), json(p.outcome)]), 'No patrols.')}
${table(['Time', 'Character', 'State'], d.apologies.map((a) => [a.at, a.character, a.state]), 'No apologies.')}
<h3>Chatter</h3>${table(['Time', 'Mod', 'Character', 'Said'], d.chatter.map((c) => [c.at, c.staff, c.character, c.body]), 'No chatter.')}
<h3>Trims and drops</h3>${table(['Where', 'Path', 'Bound', 'Before', 'After'], d.trims.map((t) => [t.where, t.path, t.predicate, t.before, t.after]), 'None.')}
<h3>Cost by job</h3>${table(['Job', 'Calls', 'Live', 'Replayed'], d.costByJob.map((c) => [c.job, c.calls, dollars(c.liveMicrodollars), dollars(c.replayedMicrodollars)]), 'No model calls.')}
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
<p>Cost: ${esc(dollars(log.cost.liveMicrodollars))} live of a $${esc(log.cost.capDollars)} cap, ${esc(dollars(log.cost.replayedMicrodollars))} replayed from the cassette.</p>
${log.notes.length ? `<ul>${log.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rehearsal: ${esc(log.scenario)}</title><style>${CSS}</style></head>
<body>${head}${log.days.map(dayHtml).join('\n')}</body></html>
`;
}
