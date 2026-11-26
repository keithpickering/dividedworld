/**
 * The Mod Bots' concession run (the concession post design; its plan, Task 3): the visits that have no written concession and are not quiz visits (`pending_concessions`, oldest first, at most
 * `CONCESSIONS_PER_RUN`) are each given one by the visit's own Mod, with one light-tier call (duty `concession`, `staff` set, so a ledger row): the post the Mod makes in the thread if it is
 * talked down. A quiz visit's concession comes with its question (quiz.ts), except for an old-voice Mod, which makes it on a completion call from here (`oldVoiceConcession`).
 *
 * **The stock line is the way out of every failure.** A visit whose System is off, whose Mod has left the staff or is not in the roster, whose day's `modBots.concessionsPerDay` is spent (counted from the
 * ledger, `concession_calls_today`, and up as this run calls), whose post cannot be read, whose call failed or was rejected, or whose answer could not be repaired without inventing content
 * (`repairConcession`), is written a `none` row with the reason; the talk-down then posts a line from the persona's own `concessions`. The tick writes the same after `modBots.concessionWriteMinutes`.
 *
 * **The post is read as the quiz run reads it** (core.ts `judgedRead`): as readers see it, a redaction or a veil included. The written body is kept unread in the database until the talk-down posts it, with
 * `{who}` filled there; nothing here sends it anywhere else.
 *
 * **Races.** `write_visit_concession` writes nothing where a row stands or the visit has ended, and says so; the visit is then skipped.
 *
 * **Failures** as the quiz run's: a database error on one visit is recorded and the run goes on; a ledger row that could not be written, or a transport failure to the database, stops the run.
 */
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import { taggedName } from '../../../engine/rules/pronouns.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { CONCESSION_MOST, concessionCompletion, concessionPrompt, repairConcession, type TalkedDownBy } from '../../../engine/system/quiz.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { readContext } from '../_shared/pool-read.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import type { Standing } from '../_shared/mod-groups.ts';
import { judgedRead, said, stopsTheRun } from './core.ts';

/** The most visits one run writes a concession for. */
export const CONCESSIONS_PER_RUN = 10;
const OLD_VOICE_CONCESSION_TOKENS = 120;

/** An open visit as `pending_quizzes` and `pending_concessions` list it. */
export interface PendingVisit {
  readonly visit_act: string;
  readonly staff: string;
  readonly post_act: string;
  readonly thread: string;
  readonly board: string;
  readonly board_name: string;
  readonly charges: readonly { readonly rule?: string; readonly band: string; readonly cause: string }[];
  readonly started_at: string;
}

type Heard = Awaited<ReturnType<typeof judgedRead>>;

/** The day's concession calls: `concession_calls_today` and up as calls are made; a missing or non-whole `concessionsPerDay` is no budget at all. */
export class ConcessionBudget {
  private used: number;
  readonly most: number;
  private constructor(used: number, most: number) { this.used = used; this.most = most; }
  static async of(db: Db, settings: Instance['settings']): Promise<ConcessionBudget> {
    const given: unknown = settings.modBots.concessionsPerDay;
    const most = typeof given === 'number' && Number.isInteger(given) && given >= 0 ? given : 0;
    return new ConcessionBudget(await db.rpc<number>('concession_calls_today', {}), most);
  }
  get spent(): boolean { return this.used >= this.most; }
  take(): void { this.used++; }
}

/** How a Mod of this weakness is talked down. (A quiz Mod is talked down by a right answer, which `concessionCompletion` has no wording for: it is worded as a distraction.) */
export const howTalkedDown = (persona: Persona): TalkedDownBy => (persona.weakness.kind === 'bribe' ? 'paid' : 'distracted');

/** What the concession calls read of a visit's post, as readers see it. */
export function concessionInput(persona: Persona, v: PendingVisit, heard: Heard, post: Heard['read']['posts'][number]) {
  return {
    persona, board: { name: v.board_name }, title: heard.title,
    author: post.pronouns === null ? post.name : taggedName(post.name, post.pronouns),
    body: post.body, lines: [...(post.originLines ?? []), ...(post.before ?? []), ...(post.after ?? [])],
    charges: v.charges.map((c) => ({ rule: c.rule ?? 'a breach of the rules', band: c.band, cause: c.cause })),
  };
}

export type Made = { readonly ok: true; readonly body: string; readonly trims: readonly Trim[] } | { readonly ok: false; readonly why: string };

/** One concession call, on the chat voice or the old: the answer repaired, or the reason there is none. A failure that stops the run is thrown. */
export async function callConcession(models: Models, persona: Persona, input: ReturnType<typeof concessionInput>): Promise<Made> {
  const how = howTalkedDown(persona);
  try {
    if (persona.voice === 'oldVoice') {
      const frame = concessionCompletion({ name: persona.name, board: input.board.name, title: input.title, author: input.author, body: input.body, charges: input.charges, how });
      const out = await models.complete({ duty: 'concession', staff: persona.key, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens: OLD_VOICE_CONCESSION_TOKENS, maxChars: CONCESSION_MOST });
      return repairConcession(out.value);
    }
    const frame = concessionPrompt({ ...input, how });
    const out = await models.chat({
      duty: 'concession', tier: DUTY_SPECS.concession.tier, staff: persona.key, system: frame.system, messages: [{ role: 'user', content: frame.message }], schema: frame.schema, maxTokens: 300,
    });
    return repairConcession((out.value as { concession?: unknown } | null)?.concession);
  } catch (e) {
    if (stopsTheRun(e)) throw e;
    return { ok: false, why: (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e) };
  }
}

export interface ConcessionRecord {
  readonly visit: string;
  readonly staff: string;
  /** `written`: this run wrote the row; `skipped`: a row stood or the visit had ended; `left`: a database error, the visit stays pending. */
  readonly status: 'written' | 'skipped' | 'left';
  readonly source?: 'model' | 'none';
  readonly why?: string;
  readonly trims: readonly Trim[];
  readonly calls: number;
}

export type ConcessionOutcome =
  | { readonly status: 'ok'; readonly due: number; readonly concessions: readonly ConcessionRecord[] };

export async function runConcessions(db: Db, models: Models, instance: Instance, slot: string, clock: () => number = Date.now): Promise<ConcessionOutcome> {
  if (Number.isNaN(Date.parse(slot))) throw new Error(`staff: slot is not a time: ${JSON.stringify(slot)}`);
  const pending = await db.rpc<PendingVisit[]>('pending_concessions', { most: CONCESSIONS_PER_RUN });
  const records: ConcessionRecord[] = [];
  if (pending.length === 0) return { status: 'ok', due: 0, concessions: records };
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  const budget = await ConcessionBudget.of(db, settings);
  const roster = tuned.system.roster;
  const standings = new Map<string, Standing | null>();
  const standingOf = async (staff: string): Promise<Standing | null> => {
    if (!standings.has(staff)) standings.set(staff, roster.some((p) => p.key === staff) ? await db.rpc<Standing>('mod_standing', { staff }) : null);
    return standings.get(staff) ?? null;
  };

  for (const v of pending) {
    try {
      records.push(await oneConcession(v));
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      if (e instanceof DatabaseError) { records.push({ visit: v.visit_act, staff: v.staff, status: 'left', why: said(e), trims: [], calls: 0 }); continue; }
      throw e;
    }
  }
  return { status: 'ok', due: pending.length, concessions: records };

  async function oneConcession(v: PendingVisit): Promise<ConcessionRecord> {
    const persona = roster.find((p) => p.key === v.staff);
    let trims: readonly Trim[] = [];
    let calls = 0;
    let why: string | undefined;
    let body: string | null = null;

    if (!settings.systemEnabled) why = 'the System is off';
    else if (!persona) why = 'the persona is not in the roster';
    else if ((await standingOf(v.staff))?.office !== 'mod') why = 'the persona is not a Mod now';
    else if (budget.spent) why = 'the day\'s concessionsPerDay is spent';

    if (!why && persona) {
      let heard: Heard | null = null;
      try {
        heard = await judgedRead(db, settings, v.thread, v.staff, v.post_act, readContext(tuned, clock()));
      } catch (e) {
        if (stopsTheRun(e) || !(e instanceof DatabaseError)) throw e;
        why = `the read failed: ${said(e)}`;
      }
      const post = heard?.read.posts.find((p) => p.marks.answering);
      if (heard && !post) why = 'the post inspected cannot be read';
      else if (heard && post) {
        budget.take(); calls++;
        const made = await callConcession(models, persona, concessionInput(persona, v, heard, post));
        if (made.ok) { body = made.body; trims = made.trims; } else why = made.why;
      }
    }

    const source = body === null ? 'none' : 'model';
    const row = await db.rpc<{ written: boolean; ended?: boolean }>('write_visit_concession', { visit: v.visit_act, source, body, why: source === 'none' ? why ?? 'no concession was written' : null });
    if (row.written || calls > 0) await db.rpc('record_staff_call', { cause_act: v.visit_act, duty: 'concession', staff: v.staff, record: { source, ...(why ? { why } : {}), ...(row.written ? {} : { skipped: true }), trims, calls } });
    return { visit: v.visit_act, staff: v.staff, status: row.written ? 'written' : 'skipped', source, ...(why ? { why } : {}), trims, calls };
  }
}
