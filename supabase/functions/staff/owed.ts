/**
 * The owed lines, as a job of the filing run (the persona-lines design, sections 1.4 and 1.5; the apology judge is its twin). Edge Function staff/index.ts chains it after
 * the apologies, with no function, cron or schedule of its own. The engine's side (the prompt, the old voice's document, the repair) is engine/system/owed.ts; the database's
 * is `owed_lines_due()` and `pay_owed_line()`, and the tick's grace pass pays what this run does not reach.
 *
 * For each open line, oldest first and at most `owedLines.perRun`: the speaker is asked for the one post, with one light-tier call (chat, or raw completion for a persona on the
 * old voice, as a filing is), ledgered with `staff` set, and `pay_owed_line(id, line)` posts it. **Anything that leaves no line pays the speaker's stock**
 * (`pay_owed_line(id, null)`): a speaker not on the roster, a day that has reached `owedLines.perDay` voiced calls (counted from the ledger, as `filing_calls_today` counts filings),
 * a call that failed, an answer rejected, a blank line. With The System off nothing is done and nothing is paid: the tick's grace pays `unsaid`.
 *
 * Retries: a transport failure is retried inside models.chat; here one call is made. A transport or ledger failure stops the run (stopsTheRun); a database error on one line is
 * recorded and the run goes on, the line staying open for the next run or the tick's grace.
 *
 * Masks: the facts are what `lines_owed` carries (move words, the asker's name, the predecessor); never an owner. A staff key in a fact is shown as the persona's name.
 *
 * Cost does not grow with the instance: one call per line, at most `perRun` a run and `perDay` a day.
 */
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { owedLineCompletion, owedLinePrompt, repairOwedLine, type Owed } from '../../../engine/system/owed.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import type { PostingOffice } from '../../../engine/system/pool.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import { said, stopsTheRun } from './core.ts';

/** What `owed_lines_due` returns for a line: the speaker, the key, where it goes, the facts, the speaker's office now, and the act its call is recorded against (null when the debt has none). */
interface Due {
  readonly id: number;
  readonly staff: string;
  readonly line_key: Owed['key'];
  readonly thread: string | null;
  readonly facts: Record<string, unknown>;
  readonly office: string | null;
  readonly cause_act?: string | null;
}

export type OwedStatus = 'voiced' | 'stock' | 'failed' | 'already';
export interface OwedRecord { readonly owed: number; readonly staff: string; readonly status: OwedStatus; readonly why?: string; readonly trims: readonly Trim[] }
export type OwedOutcome = { readonly status: 'off' } | { readonly status: 'ok'; readonly lines: readonly OwedRecord[] };

/** The most tokens an old voice's owed line may take (a post of 280 characters). */
const OLD_VOICE_OWED_TOKENS = 120;

/** The run after the filings, as the Edge Function calls it: a failure that stops the run is rethrown so the invocation answers 500 as the filings do. */
export async function runOwedLinesAfterFilings(db: Db, models: Models, instance: Instance, slot: string): Promise<OwedOutcome | { readonly status: 'failed' }> {
  try {
    return await runOwedLines(db, models, instance);
  } catch (e) {
    console.error('owed lines failed', slot, e instanceof Error ? e.message : 'unknown');
    // The lines stay open (a database error) for the next run and the tick's grace; a ledger or transport failure is rethrown, as the filings' is.
    if (stopsTheRun(e)) throw e;
    return { status: 'failed' };
  }
}

export async function runOwedLines(db: Db, models: Models, instance: Instance): Promise<OwedOutcome> {
  const tuned = await withDatabaseSettings(instance, db);
  if (!tuned.settings.systemEnabled) return { status: 'off' };
  const { perDay, perRun } = tuned.settings.owedLines;
  const due = await db.rpc<Due[]>('owed_lines_due', { most: perRun });
  const records: OwedRecord[] = [];
  if (due.length === 0) return { status: 'ok', lines: records };
  let used = await db.rpc<number>('standing_order_line_calls_today', {});

  const nameOf = (v: unknown): string => {
    const s = typeof v === 'string' ? v : '';
    return tuned.system.roster.find((r) => r.key === s)?.name ?? s;
  };

  for (const d of due) {
    try {
      records.push(await oneLine(d));
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      if (e instanceof DatabaseError) { records.push({ owed: d.id, staff: d.staff, status: 'failed', why: said(e), trims: [] }); continue; }
      throw e;
    }
  }
  return { status: 'ok', lines: records };

  /** One line, from its facts to its payment. Throws only a run-stopping error or a database error, which the caller records. */
  async function oneLine(d: Due): Promise<OwedRecord> {
    const persona = tuned.system.roster.find((r) => r.key === d.staff);
    const stock = async (why: string, trims: readonly Trim[] = []): Promise<OwedRecord> => {
      await db.rpc('pay_owed_line', { owed: d.id, body: null });
      return { owed: d.id, staff: d.staff, status: 'stock', why, trims };
    };
    if (!persona) return stock('the speaker is not on the roster');
    if (used >= perDay) return stock('the day has reached owedLines.perDay');

    const owed = owedOf(d, persona);
    const office: PostingOffice = d.office === 'boss' || d.office === 'mod' ? d.office : 'member';
    let line: string | null = null;
    let trims: readonly Trim[] = [];
    let failed: string | undefined;
    try {
      used++;
      if (persona.voice === 'oldVoice') {
        const frame = owedLineCompletion({ name: persona.name, owed });
        const out = await models.complete({ duty: 'standingOrderLine', staff: d.staff, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens: OLD_VOICE_OWED_TOKENS, maxChars: 280 });
        ({ line, trims } = repairOwedLine(out.value));
      } else {
        const frame = owedLinePrompt(tuned.system, persona, office, owed);
        const out = await models.chat({
          duty: 'standingOrderLine', tier: DUTY_SPECS.standingOrderLine.tier, staff: d.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
          schema: frame.schema, maxTokens: 400,
        });
        ({ line, trims } = repairOwedLine((out.value as { line?: unknown } | null)?.line));
      }
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      failed = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
    }
    if (!failed && line === null) failed = 'the line was blank';
    // The call was billed, so it has its record before anything that could fail after it (when the debt names an act to hang it on).
    // A billed call whose record fails leaves the line open, and the next run may bill it again, bounded by perDay and the grace (as apology accepts).
    if (d.cause_act) {
      await db.rpc('record_staff_call', { cause_act: d.cause_act, duty: 'standingOrderLine', staff: d.staff, record: { ...(failed ? { why: failed } : {}), key: d.line_key, trims, calls: 1 } });
    }
    if (failed || line === null) return stock(failed ?? 'the line was blank', trims);
    // The tick's grace may have paid the line while the call was made: pay_owed_line then writes nothing and answers `already`, so the line was not voiced by this run.
    const paid = await db.rpc<{ already?: boolean } | null>('pay_owed_line', { owed: d.id, body: line });
    return { owed: d.id, staff: d.staff, status: paid?.already === true ? 'already' : 'voiced', trims };
  }

  /** The debt as the engine's prompt takes it: a staff key among the facts is shown as that persona's name, and a maker who is the speaker is left out. */
  function owedOf(d: Due, persona: Persona): Owed {
    const f = d.facts;
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    if (d.line_key === 'requestLapsed') return { key: 'requestLapsed', facts: { asker: nameOf(f.asker), body: str(f.body) } };
    if (d.line_key === 'bossArrival') return { key: 'bossArrival', facts: { predecessor: nameOf(f.predecessor), how: str(f.how) } };
    const maker = typeof f.maker === 'string' && f.maker !== '' && f.maker !== d.staff && nameOf(f.maker) !== persona.name ? nameOf(f.maker) : null;
    return { key: d.line_key, facts: { move: str(f.move), why: str(f.why), ended: str(f.ended), maker } };
  }
}
