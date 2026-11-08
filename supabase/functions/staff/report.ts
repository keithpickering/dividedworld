/**
 * A player's report of a post, as a pure module (the Mod Bots design, section 7; its plan, Task 8): it takes the player's `Db` (the player's own session, as
 * supabase/functions/act/ is called), the service's `Db`, a way to build the `Models` (its tiers are a service read, so it is asked for only after the report is taken) and the instance, and answers the request. supabase/functions/staff/index.ts is the thin Edge
 * Function around it; this file is what Node tests (report.test.ts) and Deno both run. The engine's side of the call (the prompt, the shape of the answer, its repair)
 * is engine/system/judgment.ts.
 *
 *   1. The request is read (a character, a post, a reason). Nothing is done as the service before the database has taken the report as the player: `open_report` verifies the
 *      session, that the caller plays the character, that it is not banned, the daily judgment budget, the character's quota, and then spends the price and writes the
 *      public Act. Its refusals are the database's words, passed on as they are; a session it does not take is a 401.
 *   2. From here the report is paid, and it is either answered or refunded. The beat Mod's one light-tier call (duty `reportJudge`, with `staff` set so it is a ledger
 *      row) is told the post, the thread, the board's premise, the rules in force, the reporter's public name and reason, and nothing about who owns anything.
 *   3. The answer is repaired (repairReport): a verdict that is none of the three, a charge naming no rule in force (the premise at the minor band), a line cut to
 *      280, the Mod's one move held to its office. The call's record is kept (`record_staff_call`, cause the report), then `close_report` writes the verdict and the
 *      visit, then the Mod's move is queued (`apply_mod_move`, caused by the report; a move the database refuses costs the verdict nothing).
 *   4. **A failed judgment refunds it.** A call that failed or was rejected, a verdict that cannot be repaired, a Mod who is not a Mod now, a database error before the
 *      verdict is written: `refund_report`, which acts once and refuses a report that already has a verdict, so a lost answer to `close_report` is never a double effect.
 *      The report Act stays, with no verdict, and the player can make it again. A report whose function died before it could refund is refunded by the filing run
 *      (`refund_stale_reports`), so no player is left out of pocket.
 *
 * An old-voice persona is asked in structure too: a verdict is a choice from a fixed list, and a choice is not something raw completion can be held to.
 *
 * Nothing private reaches the model: the post, the thread and the rules are public play, the board's premise and the Mod's order are the game's, the reporter's name and
 * reason are a public Act's, and the Mod's memory, career and notes are a staff character's. No owner, class or reactor is read, and the reporter's character id is not
 * even told to the model.
 *
 * **Cost does not grow with the instance.** One light-tier call per report, bounded by the daily judgment budget the database checks before the report is paid.
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { REPORT_RULE, repairReport, reportPrompt, type RuleLine } from '../../../engine/system/judgment.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, sessionRefused, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import { instanceSet, learnMod, postFor, pronounsOfCharacter, readModGroups, said, threadFor, type ThreadRead } from './core.ts';
import { playerDoor, type DoorAnswer, type DoorDeps } from './door.ts';

export type ReportAnswer = DoorAnswer;

/** The hint every refusal the player-facing SQL functions raise carries, so their words alone reach a player (the act function's REFUSAL_HINT). */
const REFUSAL_HINT = 'kayfabb.refusal';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Opened {
  readonly report: string;
  readonly post: string;
  readonly thread: string;
  readonly staff: string;
  readonly reason: string;
  readonly board: { readonly id: string; readonly name: string; readonly premise: string };
  readonly reporter: { readonly id: string; readonly name: string };
}

interface Closed {
  readonly closed: boolean;
  readonly refunded?: boolean;
  readonly existing?: boolean;
  readonly verdict?: string;
  readonly verdict_act?: string;
  readonly visit?: string | null;
  readonly line?: string;
}

const answer = (status: number, body: Record<string, unknown>): ReportAnswer => ({ status, body });

export async function runReport(dbs: { player: Db; service: Db }, getModels: () => Promise<Models>, instance: Instance, request: unknown): Promise<ReportAnswer> {
  const req = request as { through?: unknown; post?: unknown; reason?: unknown } | null;
  if (typeof req !== 'object' || req === null) return answer(400, { error: 'a report names the character reporting, the post and a reason' });
  if (typeof req.through !== 'string' || !UUID.test(req.through)) return answer(400, { field: 'through', error: 'a report is made through one of your characters' });
  if (typeof req.post !== 'string' || !UUID.test(req.post)) return answer(400, { field: 'post', error: 'a report names the post' });
  if (typeof req.reason !== 'string') return answer(400, { field: 'reason', error: 'say why you are reporting this post' });

  // The database takes the report as the player, or says why not. Nothing before this is done as the service.
  let opened: Opened;
  try {
    opened = await dbs.player.rpc<Opened>('open_report', { through: req.through, post: req.post, reason: req.reason });
  } catch (e) {
    if (sessionRefused(e)) return answer(401, { error: 'sign in to report' });
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) return answer(e.status >= 400 && e.status < 500 ? e.status : 400, { error: e.reason, code: e.code });
    // The answer was lost, and the report may be open and paid: said so, never "it failed". A report with no verdict is refunded by the filing run.
    if (e instanceof TransportError) return answer(503, { error: 'no answer came back, so this may have gone through: look before you try again. If your report is open with no answer, your Aura comes back by itself.' });
    console.error('report failed', e instanceof Error ? e.message : 'unknown');
    return answer(500, { error: 'the report could not be made; try again' });
  }

  // The report is paid. From here it is answered or refunded.
  try {
    return await judge(dbs.service, getModels, instance, opened);
  } catch (e) {
    console.error('a report was not judged', opened.report, e instanceof Error ? e.message : 'unknown');
    return await refund(dbs.service, opened);
  }
}

/** The failed judgment's refund: once, and never over a verdict that was in fact written. */
async function refund(db: Db, opened: Opened): Promise<ReportAnswer> {
  try {
    const back = await db.rpc<{ refunded: boolean; closed?: boolean; already?: boolean }>('refund_report', { report_act: opened.report });
    if (back.closed) return answer(200, { report: opened.report, answered: true });
    return answer(502, { report: opened.report, error: 'The Mod could not hear this report. Your Aura has been refunded, and you can make it again.' });
  } catch (e) {
    console.error('a report was not refunded', opened.report, e instanceof Error ? e.message : 'unknown');
    return answer(502, { report: opened.report, error: 'The Mod could not hear this report. Your Aura will be refunded shortly, and you can make it again then.' });
  }
}

async function judge(db: Db, getModels: () => Promise<Models>, instance: Instance, opened: Opened): Promise<ReportAnswer> {
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  const mod = await learnMod(db, tuned.system.roster, settings, opened.staff);
  if (!mod.persona || mod.standing?.office !== 'mod' || !mod.career) throw new Error(`${opened.staff} is not a Mod now`);
  const standing = mod.standing;

  const rules = await db.rpc<RuleLine[]>('rules_in_force', { board: opened.board.id });
  const read = await db.rpc<ThreadRead>('pool_thread', { in_thread: opened.thread, most: settings.pool.chatterThreadPosts, chars: settings.digestExcerptChars, also: opened.post });
  const fallback = instanceSet(settings);
  const post = postFor(read, opened.post, fallback, { name: 'a character' });
  const groups = await readModGroups(db, standing);
  const context = {
    allowance: standing.allowance, beat: standing.beat.map((b) => b.id), ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours, rules,
    ...(groups ? { groups: groups.facts } : {}),
  };
  const frame = reportPrompt({
    ...(groups ? { conferred: groups.conferred } : {}),
    persona: mod.persona, pronouns: mod.pronouns, order: standing.order, career: mod.career, memory: mod.memory, notes: mod.notes, rules, allowance: standing.allowance, beat: standing.beat,
    ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours, names: (id) => mod.names[id] ?? 'a character',
    board: opened.board, thread: threadFor(read, fallback), post,
    reporter: { name: opened.reporter.name, pronouns: await pronounsOfCharacter(db, opened.reporter.id, fallback) }, reason: opened.reason,
    limits: { threadPosts: settings.pool.chatterThreadPosts, excerptChars: settings.digestExcerptChars, titleMaxLength: settings.titleMaxLength },
  });

  // The call. A transport failure was retried inside models(); what comes back is an answer, a rejection, or a failure.
  let failed: string | undefined;
  let trims: readonly Trim[] = [];
  let repaired: ReturnType<typeof repairReport> | undefined;
  try {
    const out = await (await getModels()).chat({
      duty: 'reportJudge', tier: DUTY_SPECS.reportJudge.tier, staff: opened.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
      schema: frame.schema, rules: REPORT_RULE, maxTokens: 1_000,
    });
    repaired = repairReport(out.value, context);
    trims = repaired.trims;
  } catch (e) {
    failed = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
  }
  const verdict = repaired?.verdict ?? null;
  if (!failed && verdict === null) failed = 'the verdict could not be repaired';

  // The call was billed, so it has its record (the trims and the drops, with the predicate that failed), before anything that could fail after it.
  await db.rpc('record_staff_call', {
    cause_act: opened.report, duty: 'reportJudge', staff: opened.staff,
    record: { line: repaired?.line == null ? 'stock' : 'model', ...(failed ? { why: failed } : {}), ...(repaired ? { verdict } : {}), trims, dropped: repaired?.dropped ?? [], calls: 1 },
  });
  if (failed || repaired === undefined || verdict === null) throw new Error(failed ?? 'no verdict');

  const closed = await db.rpc<Closed>('close_report', {
    report_act: opened.report, verdict, line: repaired.line, charge: repaired.charge, staff: opened.staff,
  });
  if (!closed.closed && closed.refunded) return answer(409, { report: opened.report, error: 'This report was refunded before the Mod answered it. Make it again if you still want it heard.' });

  // The Mod's one move, after the verdict: the database's guard decides it, and a refusal costs the verdict nothing.
  let move: unknown;
  if (repaired.move && closed.closed) {
    try {
      move = await db.rpc('apply_mod_move', { staff: opened.staff, move: repaired.move, cause_act: opened.report });
    } catch (e) {
      console.warn('a report\'s move was not queued', opened.report, said(e));
    }
  }
  return answer(200, {
    report: opened.report, verdict: closed.verdict ?? verdict, line: closed.line ?? repaired.line, visit: closed.visit ?? null,
    ...(move !== undefined ? { move } : {}),
  });
}


/** A report is a reason of 280 characters, ids and a little more. */
export const MOST_REPORT_BYTES = 8 * 1024;

export type { DoorDeps };

/** The player's door to a report: the shared door (door.ts) with a report's words and run. */
export const reportDoor = (request: Request, d: DoorDeps): Promise<Response> => playerDoor(request, d, runReport, {
  posted: 'reports are posted', signIn: 'sign in to report', tooLong: 'that report is too long', failed: 'the report could not be made; try again', maxBytes: MOST_REPORT_BYTES,
});
