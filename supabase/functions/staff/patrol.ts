/**
 * The Mod Bots' patrol run, as a pure module (the Mod Bots design, section 8; its plan, Task 11): it takes a `Db`, the `Models`, the instance and a clock, and runs the
 * patrols that are due. supabase/functions/staff/index.ts calls it beside the filing run (core.ts), on the same schedule; this file is what Node tests (patrol.test.ts) and Deno
 * both run. The engine's side of the call (the prompt, the shape of the answer, its repair) is engine/system/judgment.ts.
 *
 *   1. Nothing at all unless `systemEnabled`. A patrol waiting is not lost by that: it stays due.
 *   2. A patrol is a row the Boss's meeting wrote (apply_meeting: a Mod and a time). Each is **claimed in one statement** (`claim_patrol`: ran_at set, skip locked) before it is
 *      judged, so a retry or two runs at once never judge one patrol twice. A run that dies after its claim loses that patrol's sampling and judges nothing a second time.
 *   3. The day's judgment budget (`modBots.judgmentsPerDay`, the same instance-wide count a report is held to: `judgment_load_today`) is read before every claim; a spent day claims
 *      nothing, so the patrol waits for the next one rather than being skipped.
 *   4. A patrol whose Mod has left the staff, or has no beat, or whose beat has no post to look at, is skipped: recorded on the patrol's row, with no call.
 *   5. The sample (`patrol_sample`, owned by the digest role: public play only) is `patrolSample` posts drawn from the newest `patrolPool` posts by players on the Mod's beat, not under a visit: a weighted draw (a Tattle-Tale on a character multiplies its weight), seeded by the patrol's id so a patrol that runs again draws the same posts. One light-tier call
 *      (duty `patrolJudge`, with `staff` set so it is a ledger row) in the Mod's voice judges them against each board's premise and the rules in force there, and answers findings
 *      [{post, charge}] and, optionally, the Mod's one move.
 *   6. The answer is repaired (repairPatrol): a finding naming a post that is not in the sample is dropped and named; a charge naming no rule in force is the premise at the minor
 *      band; findings past the sample's size are cut. The call's record (the trims and drops) is kept in the database against the PATROL (`record_patrol_call`: a patrol has no Act)
 *      before anything that could fail after it.
 *   7. Each finding starts a visit by the Mod (`start_visit`, cause `patrol`, the charge carrying the patrol's id). The database holds the targeting cap: past `cap.punishments` in
 *      `cap.days` for the post's author it answers `capped` and records the drop on the patrol's row itself; nothing is shown to anyone. The Mod's move, if any, is queued after
 *      the first visit that did start, caused by it (`apply_mod_move` finds a move by its cause, so it is never queued twice). A patrol with no visit started has no Act to
 *      cause a move: the move is dropped and the drop named (`noVisit`).
 *
 * **Masks.** Nothing private reaches the model or the database calls: the posts, their threads, the boards' premises and the rules are public play, the Boss's order is the game's,
 * and the memory, career and notes are a staff character's. The run reads no owner, class or reactor, and the targeting cap it meets counts public punishments of one character.
 *
 * **Failures** ("Three unrelated timeouts are not a poison pill"). A model's transport failure is retried on the request itself, inside models(); this file never retries a call. A
 * call that failed or was rejected is recorded and the patrol is over (it is claimed; nothing is invented). A database error on one patrol is recorded and the run goes on; a
 * ledger row that could not be written, or a transport failure to the database, stops the run: an unrecorded call is not trusted.
 *
 * **Cost does not grow with the instance.** One light-tier call per patrol, at most `patrolsPerDay` patrols a day (the meeting cuts them), a sample of `patrolSample` posts drawn from the newest `patrolPool` by
 * a bounded query, and the daily judgment budget above.
 */
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import { predicate } from '../../../engine/rules/predicates.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { PATROL_RULE, patrolPrompt, repairPatrol, type Dropped, type PatrolFinding, type PatrolSamplePost, type RuleLine } from '../../../engine/system/judgment.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import { pronounsOr, type PronounSet } from '../../../engine/rules/pronouns.ts';
import { RUN_BUDGET_MS, instanceSet, learnMod, readModGroups, said, stopsTheRun } from './core.ts';

/** The most patrols one run judges. The meeting schedules at most `patrolsPerDay` (6) a day, so a run rarely meets more than a few; the rest are the next run's. */
export const PATROLS_PER_RUN = 10;

export type PatrolStatus = 'judged' | 'skipped' | 'failed';

export interface PatrolRecord {
  readonly patrol: number;
  readonly staff: string;
  readonly status: PatrolStatus;
  /** Why it was skipped or failed. */
  readonly why?: string;
  /** The posts the Mod was shown. */
  readonly sampled: number;
  readonly findings: number;
  /** Visits that started. */
  readonly visits: number;
  /** Findings the database refused at the targeting cap (it recorded the drop on the patrol's row). */
  readonly capped: number;
  readonly trims: readonly Trim[];
  readonly dropped: readonly Dropped[];
  readonly move?: { readonly move: number | null; readonly queued: boolean; readonly existing?: boolean; readonly reason?: string; readonly trimmed?: unknown };
  readonly calls: number;
}

export type PatrolOutcome =
  | { readonly status: 'off' }
  | { readonly status: 'ok'; readonly patrols: readonly PatrolRecord[]; /** The day's judgment budget was spent: the rest wait for tomorrow. */ readonly budgetSpent?: boolean };

interface Claimed { readonly id: number; readonly meeting: number; readonly staff: string; readonly at: string }

/** A charge as `start_visit` takes it: a rule in force with the rule's own band, else the board's premise at the band repaired. */
function visitCharge(f: PatrolFinding, rules: readonly RuleLine[], boardName: string, patrol: number): Record<string, unknown> {
  const rule = f.charge.rule_number === null ? undefined : rules.find((r) => r.number === f.charge.rule_number && (f.charge.house ? r.board === null : r.board !== null));
  if (rule) {
    const plain = predicate(rule.predicate)?.plain(rule.param) ?? rule.predicate;
    return {
      rule_number: rule.number, board: f.board, band: rule.band, cause: 'patrol', about_act: f.post, predicate: rule.predicate,
      rule: `${rule.board === null ? 'House Rule' : 'Rule'} ${rule.number}: ${plain}`, patrol_id: patrol,
    };
  }
  return { rule_number: null, board: f.board, band: f.charge.band, cause: 'patrol', about_act: f.post, rule: `the premise of ${boardName}`, patrol_id: patrol };
}

/**
 * The patrol run beside the filings, as the Edge Function calls it: a patrol's own failure is logged and answered as `failed` (it costs the filings, already done, nothing), but an
 * error that stops the run (a ledger row that could not be written, a transport failure to the database) is rethrown so the invocation answers 500 as the filings do.
 */
export async function runPatrolsAfterFilings(db: Db, models: Models, instance: Instance, clock: () => number, started: number, slot: string): Promise<PatrolOutcome | { readonly status: 'failed' }> {
  try {
    return await runPatrols(db, models, instance, clock, started);
  } catch (e) {
    if (stopsTheRun(e)) throw e;
    console.error('patrols failed', slot, e instanceof Error ? e.message : 'unknown');
    return { status: 'failed' };
  }
}

/** `started` is when the whole invocation began (one clock for the filings and the patrols), so together they stay inside the function's time. */
export async function runPatrols(db: Db, models: Models, instance: Instance, clock: () => number = Date.now, started: number = clock()): Promise<PatrolOutcome> {
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  if (!settings.systemEnabled) return { status: 'off' };
  const roster = tuned.system.roster;
  const rulesOf = new Map<string, readonly RuleLine[]>();
  const records: PatrolRecord[] = [];
  let budgetSpent = false;

  const rulesFor = async (board: string): Promise<readonly RuleLine[]> => {
    const have = rulesOf.get(board);
    if (have) return have;
    const rules = await db.rpc<RuleLine[]>('rules_in_force', { board });
    rulesOf.set(board, rules);
    return rules;
  };

  for (let n = 0; n < PATROLS_PER_RUN; n++) {
    if (clock() - started > RUN_BUDGET_MS) break;
    // The day's budget, read before each claim: a spent day claims nothing, so the patrol waits and is judged tomorrow.
    if ((await db.rpc<number>('judgment_load_today', {})) >= settings.modBots.judgmentsPerDay) { budgetSpent = true; break; }
    const claimed = await db.rpc<Claimed | null>('claim_patrol', {});
    if (claimed === null) break;
    try {
      records.push(await onePatrol(claimed));
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      if (!(e instanceof DatabaseError)) throw e;
      const why = said(e);
      try { await db.rpc('patrol_record', { patrol: claimed.id, sampled: [], outcome: { failed: why } }); } catch (again) { if (stopsTheRun(again)) throw again; }
      records.push({ patrol: claimed.id, staff: claimed.staff, status: 'failed', why, sampled: 0, findings: 0, visits: 0, capped: 0, trims: [], dropped: [], calls: 0 });
    }
  }
  return { status: 'ok', patrols: records, ...(budgetSpent ? { budgetSpent } : {}) };

  /** One claimed patrol, from its sample to its visits. Throws only a run-stopping error or a database error, which the caller records. */
  async function onePatrol(p: Claimed): Promise<PatrolRecord> {
    const skipped = async (why: string, sampled: readonly string[] = []): Promise<PatrolRecord> => {
      await db.rpc('patrol_record', { patrol: p.id, sampled, outcome: { skipped: why } });
      return { patrol: p.id, staff: p.staff, status: 'skipped', why, sampled: sampled.length, findings: 0, visits: 0, capped: 0, trims: [], dropped: [], calls: 0 };
    };
    const mod = await learnMod(db, roster, settings, p.staff);
    const persona: Persona | undefined = mod.persona;
    const standing = mod.standing;
    if (!persona) return skipped('the persona is not in the roster, so it is not a Mod now');
    if (standing?.office !== 'mod' || !mod.career) return skipped('the persona is not a Mod now');
    if (standing.beat.length === 0) return skipped('the Mod has no beat to patrol');

    // An author with no profile row reads null pronouns; it takes the instance's default, else the engine's it-set.
    const fallback = instanceSet(settings);
    const read = await db.rpc<(Omit<PatrolSamplePost, 'pronouns'> & { pronouns: PronounSet | null })[]>('patrol_sample', { boards: standing.beat.map((b) => b.id), most: settings.modBots.patrolSample, pool: settings.modBots.patrolPool, seed: p.id });
    const sample: PatrolSamplePost[] = read.map((x) => ({ ...x, pronouns: pronounsOr(x.pronouns, fallback) }));
    const ids = sample.map((s) => s.act);
    if (sample.length === 0) return skipped('there was nothing on the beat to patrol', ids);

    // The boards the sample is from, with their premises and the rules in force on each.
    const boardIds = [...new Set(sample.map((s) => s.board))];
    const named = await db.rpc<{ id: string; name: string; premise: string }[]>('board_premises', { boards: boardIds });
    const boards = await Promise.all(boardIds.map(async (id) => {
      const b = named.find((x) => x.id === id);
      return { id, name: b?.name ?? 'a board', premise: b?.premise ?? '', rules: await rulesFor(id) };
    }));
    const groups = await readModGroups(db, standing);
    const frame = patrolPrompt({
      ...(groups ? { conferred: groups.conferred } : {}),
      persona, office: 'mod', offices: tuned.system.offices, pronouns: mod.pronouns, order: standing.order, career: mod.career, memory: mod.memory, notes: mod.notes, rules: [], allowance: standing.allowance, beat: standing.beat,
      ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours, names: (id) => mod.names[id] ?? 'a character',
      boards, sample, limits: { threadPosts: settings.pool.chatterThreadPosts, excerptChars: settings.digestExcerptChars, titleMaxLength: settings.titleMaxLength },
    });
    const context = {
      allowance: standing.allowance, beat: standing.beat.map((b) => b.id), ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours,
      ...(groups ? { groups: groups.facts } : {}),
      sample: sample.map((s) => ({ act: s.act, board: s.board })), rulesOf: (board: string) => boards.find((b) => b.id === board)?.rules ?? [],
    };

    // The call. A transport failure was retried inside models(); what comes back is an answer, a rejection, or a failure.
    let failed: string | undefined;
    let repaired: ReturnType<typeof repairPatrol> | undefined;
    try {
      const out = await models.chat({
        duty: 'patrolJudge', tier: DUTY_SPECS.patrolJudge.tier, staff: p.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
        schema: frame.schema, rules: PATROL_RULE, maxTokens: 1_500,
      });
      repaired = repairPatrol(out.value, context);
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      failed = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
    }
    const trims = repaired?.trims ?? [];
    const dropped: Dropped[] = [...(repaired?.dropped ?? [])];

    // The call was billed, so it has its record (against the patrol), before anything that could fail after it.
    await db.rpc('record_patrol_call', { patrol: p.id, staff: p.staff, record: { ...(failed ? { why: failed } : {}), findings: repaired?.findings.length ?? 0, trims, dropped, calls: 1 } });
    if (failed || repaired === undefined) {
      await db.rpc('patrol_record', { patrol: p.id, sampled: ids, outcome: { failed } });
      return { patrol: p.id, staff: p.staff, status: 'failed', why: failed, sampled: ids.length, findings: 0, visits: 0, capped: 0, trims, dropped, calls: 1 };
    }

    // Each finding is a visit by the Mod. The database holds the cap and records its own drops on the patrol's row.
    let visits = 0;
    let capped = 0;
    let first: string | null = null;
    for (const f of repaired.findings) {
      try {
        const boardName = boards.find((b) => b.id === f.board)?.name ?? 'a board';
        const res = await db.rpc<{ visit: string | null; capped?: boolean }>('start_visit', { post_act: f.post, staff: p.staff, charge: visitCharge(f, context.rulesOf(f.board), boardName, p.id) });
        if (res?.capped) capped++;
        else if (res?.visit) { visits++; first ??= res.visit; }
      } catch (e) {
        if (stopsTheRun(e)) throw e;
        if (!(e instanceof DatabaseError)) throw e;
        dropped.push({ path: `visit(${f.post})`, predicate: `startFailed: ${said(e)}` });
      }
    }

    // The Mod's one move, after the first visit that started: the database's guard decides it, and a refusal costs the visits nothing.
    let queued: PatrolRecord['move'];
    if (repaired.move) {
      if (first === null) dropped.push({ path: 'move', predicate: 'noVisit' });
      else {
        try {
          queued = await db.rpc<NonNullable<PatrolRecord['move']>>('apply_mod_move', { staff: p.staff, move: repaired.move, cause_act: first });
        } catch (e) {
          if (stopsTheRun(e)) throw e;
          if (!(e instanceof DatabaseError)) throw e;
          dropped.push({ path: 'move', predicate: `refused: ${said(e)}` });
        }
      }
    }
    await db.rpc('patrol_record', {
      patrol: p.id, sampled: ids,
      outcome: { findings: repaired.findings.length, visits, capped, ...(queued ? { move: queued } : {}), ...(dropped.length ? { dropped: dropped.length } : {}) },
    });
    return {
      patrol: p.id, staff: p.staff, status: 'judged', sampled: ids.length, findings: repaired.findings.length, visits, capped, trims, dropped, ...(queued ? { move: queued } : {}), calls: 1,
    };
  }
}
