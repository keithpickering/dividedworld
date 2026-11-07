/**
 * The judge of apologies, as a job of the filing run (member groups, Task 7; the Mod Bots' runPatrols is its twin). Edge Function staff/index.ts chains it after the filings
 * and the patrols, with no function, cron or schedule of its own. The engine's side (the prompt, the shape of the answer, its repair) is engine/system/apology.ts; the
 * database's is `pending_apologies()` and `rule_apology()` (supabase/migrations/0121_bars_apologies.sql).
 *
 * For each waiting apology: the move's staff member (a Mod, or the Boss whose move it was; duty `apologyJudge` is the instance's `filer`) judges it with one light-tier
 * call, ledgered with `staff` set. The answer is repaired (a verdict outside the list is rejected naming `oneOf`, a ruling over the word bound is trimmed and the trim written
 * on the call's record), then `rule_apology` writes the ruling. **A failed judgment returns the apology** (`rule_apology(id, 'returned', '')`), so the character may apologize
 * again at once: a call that still fails after its retries, an answer rejected, a verdict that cannot be repaired, a staff key not on the roster.
 *
 * Retries: a transport failure is retried inside models.chat; here one call is made. A transport or ledger failure stops the run (stopsTheRun), and a database error is thrown at once.
 *
 * Cost does not grow with the instance: one call per apology, at most `apologyJudgeBatch` a run, and an apology needs a punishment move in force.
 */
import type { Instance, Settings } from '../../../engine/rules/types.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { APOLOGY_RULE, apologyPrompt, repairApology } from '../../../engine/system/apology.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import type { Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import { said, stopsTheRun } from './core.ts';

interface Pending {
  readonly apology: number;
  readonly apology_act: string;
  readonly staff: string;
  /** What the move did, in plain words (the stock line it landed with). */
  readonly line: string;
  readonly body: string;
}

export type ApologyStatus = 'accepted' | 'rejected' | 'returned';
export interface ApologyRecord { readonly apology: number; readonly staff: string; readonly status: ApologyStatus; readonly why?: string; readonly trims: readonly Trim[] }
export type ApologyOutcome = { readonly status: 'off' } | { readonly status: 'ok'; readonly apologies: readonly ApologyRecord[] };

/** The ruling's word bound, under `Settings.apology`. */
const rulingMaxWords = (s: Settings): number => s.apology.apologyRulingMaxWords;

/** The apology run after the filings, as the Edge Function calls it: a failure that stops the run is rethrown so the invocation answers 500 as the filings do. */
export async function runApologiesAfterFilings(db: Db, models: Models, instance: Instance, slot: string): Promise<ApologyOutcome | { readonly status: 'failed' }> {
  try {
    return await runApologies(db, models, instance);
  } catch (e) {
    console.error('apologies failed', slot, e instanceof Error ? e.message : 'unknown');
    // The apologies stay pending (a database error) and the next run hears them; a ledger or transport failure is rethrown, as the filings' is.
    if (stopsTheRun(e)) throw e;
    return { status: 'failed' };
  }
}

export async function runApologies(db: Db, models: Models, instance: Instance): Promise<ApologyOutcome> {
  const tuned = await withDatabaseSettings(instance, db);
  if (!tuned.settings.systemEnabled) return { status: 'off' };
  const maxWords = rulingMaxWords(tuned.settings);
  const pending = await db.rpc<Pending[]>('pending_apologies', {});
  const records: ApologyRecord[] = [];

  for (const p of pending) {
    const persona = tuned.system.roster.find((r) => r.key === p.staff);
    if (!persona) {
      await db.rpc('rule_apology', { in_apology: p.apology, verdict: 'returned', ruling: '' });
      records.push({ apology: p.apology, staff: p.staff, status: 'returned', why: 'the judge is not on the roster', trims: [] });
      continue;
    }
    const frame = apologyPrompt(persona, p.line, p.body, maxWords);
    let failed: string | undefined;
    let repaired: ReturnType<typeof repairApology> | undefined;
    // The call. A transport failure was retried inside models.chat; what comes back is an answer, a rejection, or a failure.
    try {
      const out = await models.chat({
        duty: 'apologyJudge', tier: DUTY_SPECS.apologyJudge.tier, staff: p.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
        schema: frame.schema, rules: APOLOGY_RULE, maxTokens: 600,
      });
      repaired = repairApology(out.value, maxWords);
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      failed = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
    }
    const verdict = repaired?.verdict ?? null;
    if (!failed && verdict === null) failed = 'the answer could not be repaired';
    const trims = repaired?.trims ?? [];
    // The call was billed, so it has its record (the trims and the drops, with the predicate that failed), before anything that could fail after it.
    await db.rpc('record_staff_call', {
      cause_act: p.apology_act, duty: 'apologyJudge', staff: p.staff,
      record: { ...(failed ? { why: failed } : {}), ...(verdict ? { verdict } : {}), trims, dropped: repaired?.dropped ?? [], calls: 1 },
    });
    if (failed || repaired === undefined || verdict === null) {
      await db.rpc('rule_apology', { in_apology: p.apology, verdict: 'returned', ruling: '' });
      records.push({ apology: p.apology, staff: p.staff, status: 'returned', why: failed, trims });
    } else {
      await db.rpc('rule_apology', { in_apology: p.apology, verdict, ruling: repaired.ruling });
      records.push({ apology: p.apology, staff: p.staff, status: verdict, trims });
    }
  }
  return { status: 'ok', apologies: records };
}
