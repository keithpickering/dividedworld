// The collector: reads a finished run back, as the superuser, into a RehearsalLog (engine/rehearsal/report.ts) for the report and the JSON.
// Column names are from the migrations: meetings, staff_memory (0044), queued_moves (0046), staff_orders (0103), visits and infractions
// as Acts (0104, 0105), patrols (0110), apologies (0129). A move's end is its `move_end` Act (0046), a visit's its `visit_end` (0105).
// The calls Task 5 kept (prompt and answer) join to a meeting by the id on the request, and to a day by the simulated time they were made.
import { DAY_MS } from "../../engine/rehearsal/generate.ts";
import type { LogApology, LogChatter, LogCost, LogDay, LogInfraction, LogMeeting, LogMove, LogOrder, LogPatrol, LogSkip, LogTrim, LogVisit, RehearsalLog } from "../../engine/rehearsal/report.ts";
import type { ChatRequest } from "../../engine/system/model.ts";
import type { RunContext } from "./run.ts";

const iso = (ms: unknown): string => new Date(Number(ms)).toISOString();
const isoOrNull = (ms: unknown): string | null => (ms === null || ms === undefined ? null : iso(ms));
const ms = (col: string): string => `(extract(epoch from ${col}) * 1000)::float8`;

export async function collect(ctx: RunContext): Promise<RehearsalLog> {
  const { conn, scenario, timeline, calls, jobs, dispatched, filler } = ctx;
  const day1 = timeline.day1;
  const end = day1 + scenario.days * DAY_MS;
  const dayOf = (at: number): number => Math.floor((at - day1) / DAY_MS) + 1;
  const within = (at: number): boolean => at >= day1 && at < end;
  const days: { [d: number]: { -readonly [K in keyof LogDay]: LogDay[K] extends readonly (infer T)[] ? T[] : LogDay[K] } } = {};
  for (let d = 1; d <= scenario.days; d++) {
    days[d] = { day: d, date: iso(day1 + (d - 1) * DAY_MS).slice(0, 10), meetings: [], moves: [], orders: [], visits: [], infractions: [], patrols: [], apologies: [], chatter: [], trims: [], costByJob: [], skips: [], filler: { through: 0, refused: 0 } };
  }
  const put = (at: number): (typeof days)[number] | undefined => (within(at) ? days[dayOf(at)] : undefined);
  const params = [day1, end];
  const range = (col: string): string => `${col} >= to_timestamp($1 / 1000.0) and ${col} < to_timestamp($2 / 1000.0)`;

  // Meetings, with the Boss's memory before and after and the call that answered.
  const memories = await conn.sql(`select id, staff, meeting, ${ms("at")} as ms, body from staff_memory order by staff, id`);
  const meetings = await conn.sql(`select id, ${ms("started_at")} as started, ${ms("finished_at")} as finished, outcome, error, bank_before::float8 as bank_before, bank_after::float8 as bank_after from meetings where ${range("started_at")} order by id`, params);
  for (const m of meetings) {
    const id = Number(m.id);
    const mine = memories.filter((r) => Number(r.meeting) === id);
    const after = mine[0];
    const before = after ? memories.filter((r) => r.staff === after.staff && Number(r.id) < Number(after.id)).at(-1) : undefined;
    const call = calls.filter((c) => c.duty === "meeting" && c.request.meeting === id).at(-1);
    const request = call?.request as ChatRequest | undefined;
    const row: LogMeeting = {
      id, startedAt: iso(m.started), finishedAt: iso(m.finished), outcome: String(m.outcome), error: m.error === null ? null : String(m.error),
      bankBefore: m.bank_before === null ? null : Number(m.bank_before), bankAfter: m.bank_after === null ? null : Number(m.bank_after),
      sent: request ? { system: request.system, messages: request.messages.map((x) => ({ role: x.role, content: x.content })) } : null,
      answer: call?.value ?? (call?.error ? { rejected: call.error } : null),
      memoryBefore: before?.body ?? null, memoryAfter: after?.body ?? null, replayed: call ? call.replayed : null,
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
    const row: LogVisit = { at: iso(v.ms), staff: String(v.staff), line: String(v.line ?? ""), outcome: v.outcome === null ? null : String(v.outcome) };
    put(Number(v.ms))?.visits.push(row);
  }
  const filings = await conn.sql(`select ${ms("created_at")} as ms, kind, payload from acts where kind in ('infraction', 'ban') and ${range("created_at")} order by created_at, id`, params);
  for (const f of filings) {
    const row: LogInfraction = { at: iso(f.ms), kind: String(f.kind), payload: f.payload };
    put(Number(f.ms))?.infractions.push(row);
  }
  const patrols = await conn.sql(`select meeting, n, staff, ${ms("at")} as ms, ${ms("ran_at")} as ran, cardinality(sampled) as sampled, dropped, outcome from patrols where ${range("at")} order by id`, params);
  for (const p of patrols) {
    const row: LogPatrol = { meeting: Number(p.meeting), n: Number(p.n), staff: String(p.staff), at: iso(p.ms), ranAt: isoOrNull(p.ran), sampled: Number(p.sampled), dropped: p.dropped, outcome: p.outcome };
    put(Number(p.ms))?.patrols.push(row);
  }
  const apologies = await conn.sql(`select ${ms("a.created_at")} as ms, c.name, a.state from apologies a join characters c on c.id = a.character where ${range("a.created_at")} order by a.id`, params);
  for (const a of apologies) {
    const row: LogApology = { at: iso(a.ms), character: String(a.name), state: String(a.state) };
    put(Number(a.ms))?.apologies.push(row);
  }

  // Chatter: posts by staff characters.
  const chatter = await conn.sql(
    `select ${ms("a.created_at")} as ms, c.staff, c.name, a.payload ->> 'body' as body from acts a join characters c on c.id = a.character ` +
      `where c.staff is not null and a.kind in ('post', 'spin') and ${range("a.created_at")} order by a.created_at, a.id`, params,
  );
  for (const c of chatter) {
    const row: LogChatter = { at: iso(c.ms), staff: String(c.staff), character: String(c.name), body: String(c.body ?? "") };
    put(Number(c.ms))?.chatter.push(row);
  }

  // The calls: trims and rejected answers, and cost by job.
  const byJob = new Map<number, Map<string, { calls: number; live: number; replayed: number }>>();
  for (const c of calls) {
    const day = put(c.at);
    if (!day) continue;
    const where = c.request.meeting === undefined ? c.duty : `${c.duty}, meeting ${c.request.meeting}`;
    for (const t of c.trims) day.trims.push({ where, path: t.path, predicate: t.predicate, before: t.before, after: t.after } satisfies LogTrim);
    if (c.error) day.skips.push({ at: iso(c.at), what: where, why: `answer dropped (${c.error.predicate}): ${c.error.message}` });
    const jobs2 = byJob.get(day.day) ?? new Map();
    byJob.set(day.day, jobs2);
    const j = jobs2.get(c.duty) ?? { calls: 0, live: 0, replayed: 0 };
    j.calls++;
    if (c.replayed) j.replayed += c.cost; else j.live += c.cost;
    jobs2.set(c.duty, j);
  }
  for (const [d, jobs2] of byJob) for (const [job, j] of jobs2) days[d]!.costByJob.push({ job, calls: j.calls, liveMicrodollars: j.live, replayedMicrodollars: j.replayed } satisfies LogCost);

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
  for (const c of calls) if (c.replayed) replayed += c.cost; else live += c.cost;
  return {
    scenario: scenario.key, seed: scenario.seed, mode: ctx.mode, daysRun: scenario.days, day1: iso(day1), systemOnAt: isoOrNull(ctx.systemOnAt),
    cost: { liveMicrodollars: live, replayedMicrodollars: replayed, capDollars: scenario.costCapDollars }, notes: [...ctx.notes],
    days: Object.values(days) as LogDay[],
  };
}
