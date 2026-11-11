// The collector: reads a finished run back, as the superuser, into a RehearsalLog (engine/rehearsal/report.ts) for the report and the JSON.
// Column names are from the migrations: meetings, staff_memory (0044), queued_moves (0046), staff_orders (0103), visits and infractions
// as Acts (0104, 0105), patrols (0110), apologies (0129). A move's end is its `move_end` Act (0046), a visit's its `visit_end` (0105).
// The calls Task 5 kept (prompt and answer) join to a meeting by the id on the request, and to a day by the simulated time they were made.
import { DAY_MS } from "../../engine/rehearsal/generate.ts";
import type { LogApology, LogCall, LogChatter, LogCost, LogDay, LogInfraction, LogMeeting, LogMeetingPart, LogMove, LogOrder, LogPatrol, LogSkip, LogTrim, LogVisit, RehearsalLog } from "../../engine/rehearsal/report.ts";
import type { ChatRequest, CompletionRequest } from "../../engine/system/model.ts";
import type { KeptCall } from "./models.ts";
import type { RunContext } from "./run.ts";

const iso = (ms: unknown): string => new Date(Number(ms)).toISOString();
const isoOrNull = (ms: unknown): string | null => (ms === null || ms === undefined ? null : iso(ms));
const ms = (col: string): string => `(extract(epoch from ${col}) * 1000)::float8`;

/** One tick of any job; a call attaches to an Act made within this after it, and a ledger row pairs with a call within it. */
export const BOUND = 2 * 60_000;
/** The database's clock and the process's differ by a hair, so a call may read a hair after the Act it made. */
const SLACK = 1000;

/**
 * The unused call of `duty` (and of `staff`, where the Act has a Mod) that produced the Act made at `at`: the nearest one made at or
 * before it, and within `BOUND`. An Act with no call that close shows none, so a dropped call never attaches to a later Act.
 */
export function takeCall(calls: readonly KeptCall[], used: Set<KeptCall>, duty: string, staff: string | null, at: number): KeptCall | null {
  let best: KeptCall | undefined;
  for (const c of calls) {
    if (used.has(c) || c.duty !== duty || (staff !== null && c.staff !== staff)) continue;
    if (c.at > at + SLACK || at - c.at > BOUND) continue;
    if (!best || Math.abs(c.at - at) < Math.abs(best.at - at)) best = c;
  }
  if (best) used.add(best);
  return best ?? null;
}

export interface LedgerRow { readonly id: unknown; readonly ms: number; readonly duty: string; readonly staff: unknown; readonly meeting: unknown; readonly cost: number }

/**
 * Pairs each ledger row with the kept call of the same duty, Mod and meeting made nearest it, within `BOUND` (the cassette key is not on the
 * ledger row, so those three and the time are what there is to match on). A key whose rows and calls do not all pair is one note.
 */
export function pairLedger(rows: readonly LedgerRow[], calls: readonly KeptCall[]): { pairs: Map<KeptCall, LedgerRow>; unmatched: LedgerRow[]; notes: string[] } {
  const keyOf = (duty: string, staff: unknown, meeting: unknown): string => `${duty}|${staff ?? ""}|${meeting ?? ""}`;
  const label = (k: string): string => { const [duty, staff, meeting] = k.split("|"); return `${duty}${staff ? `, ${staff}` : ""}${meeting ? `, meeting ${meeting}` : ""}`; };
  const keptBy = new Map<string, KeptCall[]>();
  for (const c of calls) keptBy.set(keyOf(c.duty, c.staff, c.request.meeting), [...(keptBy.get(keyOf(c.duty, c.staff, c.request.meeting)) ?? []), c]);
  const pairs = new Map<KeptCall, LedgerRow>();
  const unmatched: LedgerRow[] = [];
  const rowsBy = new Map<string, number>();
  const unmatchedBy = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r.duty, r.staff, r.meeting);
    rowsBy.set(k, (rowsBy.get(k) ?? 0) + 1);
    let best: KeptCall | undefined;
    for (const c of keptBy.get(k) ?? []) {
      if (pairs.has(c) || Math.abs(c.at - r.ms) > BOUND) continue;
      if (!best || Math.abs(c.at - r.ms) < Math.abs(best.at - r.ms)) best = c;
    }
    if (best) pairs.set(best, r);
    else { unmatched.push(r); unmatchedBy.set(k, (unmatchedBy.get(k) ?? 0) + 1); }
  }
  const notes: string[] = [];
  for (const k of new Set([...rowsBy.keys(), ...keptBy.keys()])) {
    const nRows = rowsBy.get(k) ?? 0;
    const nCalls = keptBy.get(k)?.length ?? 0;
    const paired = nRows - (unmatchedBy.get(k) ?? 0);
    if (paired === nRows && paired === nCalls) continue;
    if (nCalls === 0) notes.push(`${label(k)}: ${nRows} ledger rows have no kept call`);
    else if (nRows === 0) notes.push(`${label(k)}: ${nCalls} kept calls have no ledger row`);
    else notes.push(`${label(k)}: ${nRows} ledger rows but ${nCalls} kept calls, ${paired} paired`);
  }
  return { pairs, unmatched, notes };
}

export async function collect(ctx: RunContext): Promise<RehearsalLog> {
  const { conn, scenario, timeline, calls, jobs, dispatched, filler } = ctx;
  const day1 = timeline.day1;
  const end = day1 + scenario.days * DAY_MS;
  const dayOf = (at: number): number => Math.floor((at - day1) / DAY_MS) + 1;
  const within = (at: number): boolean => at >= day1 && at < end;
  const days: { [d: number]: { -readonly [K in keyof LogDay]: LogDay[K] extends readonly (infer T)[] ? T[] : LogDay[K] } } = {};
  for (let d = 1; d <= scenario.days; d++) {
    days[d] = { day: d, date: iso(day1 + (d - 1) * DAY_MS).slice(0, 10), meetings: [], moves: [], orders: [], visits: [], infractions: [], patrols: [], apologies: [], chatter: [], calls: [], trims: [], costByJob: [], skips: [], filler: { through: 0, refused: 0 } };
  }
  const put = (at: number): (typeof days)[number] | undefined => (within(at) ? days[dayOf(at)] : undefined);
  const params = [day1, end];
  const range = (col: string): string => `${col} >= to_timestamp($1 / 1000.0) and ${col} < to_timestamp($2 / 1000.0)`;

  // The ledger (model_calls, 0042) is the book of record for cost. Each row pairs with the kept call that made it (pairLedger), which says
  // whether it was replayed; what does not pair is counted as unmatched, never as live, and noted once per key.
  const ledger = (await conn.sql(`select id, ${ms("at")} as ms, duty, staff, meeting, cost_microdollars::float8 as cost from model_calls order by at, id`)).map((r) => ({ id: r.id, ms: Number(r.ms), duty: String(r.duty), staff: r.staff, meeting: r.meeting, cost: Number(r.cost) }));
  const paired = pairLedger(ledger, calls);
  const notes: string[] = [...ctx.notes, ...paired.notes];
  const ledgerCost = new Map<typeof calls[number], number>();
  for (const [c, r] of paired.pairs) ledgerCost.set(c, r.cost);
  const unmatchedRows = new Set(paired.unmatched);
  const outside = ledger.filter((r) => !within(r.ms));
  if (outside.length) notes.push(`${outside.length} ledger rows (${(outside.reduce((n, r) => n + r.cost, 0) / 1e6).toFixed(2)} dollars) fall outside the run's days, before day 1 or after the last`);
  const replayedRows = new Set([...paired.pairs].filter(([c]) => c.replayed).map(([, r]) => r));

  const logCalls = new Map<typeof calls[number], LogCall>();
  const logCall = (c: typeof calls[number]): LogCall => {
    const made = logCalls.get(c);
    if (made) return made;
    const r = c.request as ChatRequest & CompletionRequest;
    const prompt = "prompt" in r && typeof r.prompt === "string" ? r.prompt : `${r.system}\n\n${(r.messages ?? []).map((m) => `[${m.role}] ${m.content}`).join("\n\n")}`;
    const row: LogCall = {
      at: iso(c.at), duty: c.duty, staff: c.staff, replayed: c.replayed, costMicrodollars: ledgerCost.get(c) ?? c.cost, prompt, answer: c.value ?? null, error: c.error ?? null,
      trims: c.trims.map((t) => ({ where: c.duty, path: t.path, predicate: t.predicate, before: t.before, after: t.after })),
    };
    logCalls.set(c, row);
    return row;
  };
  const used = new Set<typeof calls[number]>();
  const take = (duty: string, staff: string | null, at: number): LogCall | null => {
    const c = takeCall(calls, used, duty, staff, at);
    return c ? logCall(c) : null;
  };

  // Meetings, with the Boss's memory before and after and the call that answered.
  const memories = await conn.sql(`select id, staff, meeting, ${ms("at")} as ms, body from staff_memory order by staff, id`);
  const meetings = await conn.sql(`select id, ${ms("started_at")} as started, ${ms("finished_at")} as finished, outcome, error, record, bank_before::float8 as bank_before, bank_after::float8 as bank_after from meetings where ${range("started_at")} order by id`, params);
  for (const m of meetings) {
    const id = Number(m.id);
    const mine = memories.filter((r) => Number(r.meeting) === id);
    const after = mine[0];
    const before = after ? memories.filter((r) => r.staff === after.staff && Number(r.id) < Number(after.id)).at(-1) : undefined;
    // One part per kept call of the meeting, in order; the record's parts (apply_meeting, fail_meeting) give each its outcome, by position.
    const recorded = Array.isArray((m.record as { parts?: unknown } | null)?.parts) ? ((m.record as { parts: { part?: unknown; outcome?: unknown; error?: unknown }[] }).parts) : [];
    const mine2 = calls.filter((c) => c.duty === "meeting" && c.request.meeting === id);
    const parts: LogMeetingPart[] = mine2.map((c, i) => {
      used.add(c);
      const rec = recorded[i];
      const request = c.request as ChatRequest;
      const outcome = typeof rec?.outcome === "string" ? rec.outcome : c.error ? "rejected" : "ok";
      const error = rec?.error != null ? String(rec.error) : c.error ? c.error.message : null;
      return {
        part: typeof rec?.part === "string" ? rec.part : `part ${i + 1}`, outcome, error,
        sent: { system: request.system, messages: request.messages.map((x) => ({ role: x.role, content: x.content })) },
        answer: c.value ?? (c.error ? { rejected: c.error } : null), replayed: c.replayed,
      };
    });
    const row: LogMeeting = {
      id, startedAt: iso(m.started), finishedAt: iso(m.finished), outcome: String(m.outcome), error: m.error === null ? null : String(m.error),
      bankBefore: m.bank_before === null ? null : Number(m.bank_before), bankAfter: m.bank_after === null ? null : Number(m.bank_after),
      parts, memoryBefore: before?.body ?? null, memoryAfter: after?.body ?? null,
    };
    put(Number(m.started))?.meetings.push(row);
  }

  // Moves, with when each landed and how it ended.
  const moves = await conn.sql(
    `select q.id, q.staff, q.kind, q.why, q.demand, ${ms("q.go_live_at")} as go_live, ${ms("q.expires_at")} as expires, q.held_at is not null as held, ${ms("a.created_at")} as landed, e.payload ->> 'why' as ended, q.failure ` +
      `from queued_moves q left join acts a on a.id = q.landed_act left join acts e on e.kind = 'move_end' and e.target_act_id = q.landed_act where ${range("q.go_live_at")} order by q.id`, params,
  );
  for (const q of moves) {
    const row: LogMove = {
      id: Number(q.id), staff: String(q.staff), kind: String(q.kind), why: String(q.why), demand: q.demand, goLiveAt: iso(q.go_live), expiresAt: isoOrNull(q.expires),
      held: q.held === true, landedAt: isoOrNull(q.landed), endedHow: q.ended === null ? null : String(q.ended), failure: q.failure === null ? null : String(q.failure),
    };
    put(Number(q.go_live))?.moves.push(row);
  }

  const orders = await conn.sql(`select o.meeting, o.staff, o.order_line, o.allowance, cardinality(o.boards) as boards, ${ms("o.at")} as ms from staff_orders o where ${range("o.at")} order by o.id`, params);
  for (const o of orders) {
    const row: LogOrder = { meeting: Number(o.meeting), staff: String(o.staff), line: String(o.order_line), allowance: Number(o.allowance), boards: Number(o.boards) };
    put(Number(o.ms))?.orders.push(row);
  }

  // Mod work: visits (Acts) with their end, and the filings (infractions and bans) they came to.
  const visits = await conn.sql(
    `select ${ms("v.created_at")} as ms, c.staff, v.payload ->> 'line' as line, e.payload ->> 'outcome' as outcome from acts v join characters c on c.id = v.character ` +
      `left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id where v.kind = 'visit' and ${range("v.created_at")} order by v.created_at, v.id`, params,
  );
  for (const v of visits) {
    const row: LogVisit = { at: iso(v.ms), staff: String(v.staff), line: String(v.line ?? ""), outcome: v.outcome === null ? null : String(v.outcome), call: null };
    put(Number(v.ms))?.visits.push(row);
  }
  const filings = await conn.sql(`select ${ms("created_at")} as ms, kind, payload from acts where kind in ('infraction', 'ban') and ${range("created_at")} order by created_at, id`, params);
  for (const f of filings) {
    const row: LogInfraction = { at: iso(f.ms), kind: String(f.kind), payload: f.payload, call: take("filing", null, Number(f.ms)) };
    put(Number(f.ms))?.infractions.push(row);
  }
  const patrols = await conn.sql(`select meeting, n, staff, ${ms("at")} as ms, ${ms("ran_at")} as ran, cardinality(sampled) as sampled, dropped, outcome from patrols where ${range("at")} order by id`, params);
  for (const p of patrols) {
    const row: LogPatrol = { meeting: Number(p.meeting), n: Number(p.n), staff: String(p.staff), at: iso(p.ms), ranAt: isoOrNull(p.ran), sampled: Number(p.sampled), dropped: p.dropped, outcome: p.outcome, call: take("patrolJudge", String(p.staff), Number(p.ran ?? p.ms)) };
    put(Number(p.ms))?.patrols.push(row);
  }
  const apologies = await conn.sql(`select ${ms("a.created_at")} as ms, ${ms("r.created_at")} as ruled, c.name, a.state from apologies a join characters c on c.id = a.character left join acts r on r.id = a.ruling_act where ${range("a.created_at")} order by a.id`, params);
  for (const a of apologies) {
    const row: LogApology = { at: iso(a.ms), character: String(a.name), state: String(a.state), call: take("apologyJudge", null, Number(a.ruled ?? a.ms)) };
    put(Number(a.ms))?.apologies.push(row);
  }

  // Chatter: posts by staff characters.
  const chatter = await conn.sql(
    `select ${ms("a.created_at")} as ms, c.staff, c.name, a.payload ->> 'body' as body from acts a join characters c on c.id = a.character ` +
      `where c.staff is not null and a.kind in ('post', 'spin') and ${range("a.created_at")} order by a.created_at, a.id`, params,
  );
  for (const c of chatter) {
    const row: LogChatter = { at: iso(c.ms), staff: String(c.staff), character: String(c.name), body: String(c.body ?? ""), call: take("chatter", String(c.staff), Number(c.ms)) };
    put(Number(c.ms))?.chatter.push(row);
  }

  // The calls that matched no Act or row sit under their job; trims and rejected answers are listed for every call; cost is the ledger's.
  for (const c of calls) {
    const day = put(c.at);
    if (!day) continue;
    const where = c.request.meeting === undefined ? c.duty : `${c.duty}, meeting ${c.request.meeting}`;
    if (!used.has(c)) day.calls.push(logCall(c));
    for (const t of c.trims) day.trims.push({ where, path: t.path, predicate: t.predicate, before: t.before, after: t.after } satisfies LogTrim);
    if (c.error) day.skips.push({ at: iso(c.at), what: where, why: `answer dropped (${c.error.predicate}): ${c.error.message}` });
  }
  const byJob = new Map<number, Map<string, { calls: number; live: number; replayed: number; unmatched: number }>>();
  for (const r of ledger) {
    if (!within(r.ms)) continue;
    const d = dayOf(r.ms);
    const jobs2 = byJob.get(d) ?? new Map();
    byJob.set(d, jobs2);
    const j = jobs2.get(r.duty) ?? { calls: 0, live: 0, replayed: 0, unmatched: 0 };
    j.calls++;
    if (unmatchedRows.has(r)) j.unmatched += r.cost; else if (replayedRows.has(r)) j.replayed += r.cost; else j.live += r.cost;
    jobs2.set(r.duty, j);
  }
  for (const [d, jobs2] of byJob) for (const [job, j] of jobs2) days[d]!.costByJob.push({ job, calls: j.calls, liveMicrodollars: j.live, replayedMicrodollars: j.replayed, unmatchedMicrodollars: j.unmatched } satisfies LogCost);

  // Skips: jobs that failed and requests the cap held back or a function refused.
  for (const j of jobs) if (!j.ok) put(j.at)?.skips.push({ at: iso(j.at), what: `job ${j.job}`, why: j.error ?? "failed" } satisfies LogSkip);
  for (const r of dispatched) {
    if (r.skipped) put(r.at)?.skips.push({ at: iso(r.at), what: r.function, why: r.skipped });
    else if (r.status !== undefined && r.status >= 400) put(r.at)?.skips.push({ at: iso(r.at), what: r.function, why: `answered ${r.status}: ${typeof r.body === "string" ? r.body : JSON.stringify(r.body)}` });
  }
  for (const f of filler) {
    const day = put(f.at);
    if (day) day.filler = f.ok ? { ...day.filler, through: day.filler.through + 1 } : { ...day.filler, refused: day.filler.refused + 1 };
  }

  let live = 0;
  let replayed = 0;
  let unmatched = 0;
  for (const r of ledger) if (unmatchedRows.has(r)) unmatched += r.cost; else if (replayedRows.has(r)) replayed += r.cost; else live += r.cost;
  // The models the run's jobs read: the setting as the rehearsal's own database holds it, after any `--strong` or `--light`.
  const held = (await conn.sql("select value from settings where key = 'modelTiers'"))[0]?.value as { strong?: unknown; light?: unknown } | undefined;
  const tiers = { strong: String(held?.strong ?? ''), light: String(held?.light ?? '') };
  return {
    scenario: scenario.key, seed: scenario.seed, mode: ctx.mode, tiers, daysRun: scenario.days, day1: iso(day1), systemOnAt: isoOrNull(ctx.systemOnAt),
    cost: { liveMicrodollars: live, replayedMicrodollars: replayed, unmatchedMicrodollars: unmatched, capDollars: scenario.costCapDollars }, notes,
    days: Object.values(days) as LogDay[],
  };
}
