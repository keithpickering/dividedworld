/**
 * The Mod Bots' quiz run (the written quiz design; its plan, Task 3): the visits that are asking a question and have none yet (`pending_quizzes`, oldest first, at most
 * `QUIZZES_PER_RUN`) are each given one by the visit's own Mod, with one light-tier call (duty `quizQuestion`, `staff` set, so a ledger row). It is a sibling of core.ts's filing run
 * and the handler calls it first: a question is wanted sooner than a filing line, because a character is waiting on it (`intercept` refuses until a row stands).
 *
 * **The bank question is the way out of every failure.** A visit whose System is off, whose Mod has left the staff or is not in the roster, whose day's `modBots.quizQuestionsPerDay`
 * is spent (counted from the ledger, `quiz_calls_today`, and up as this run calls), whose post cannot be read, whose call failed or was rejected, or whose answer could not be repaired
 * without inventing content (`repairQuiz`), is written the Mod's bank question (`bank_quiz_for`). The tick writes the same after `modBots.quizWriteMinutes` whatever this run does.
 *
 * **The post is read as every other duty reads it** (core.ts `judgedRead`: `pool_read`, then `readOf`): the post's own words, an admin-hidden version blanked, a veil's stand-in author,
 * and each play's `seen` line and a rewind line as the read renders them. This file adds no layer-hiding of its own.
 *
 * **Races.** `write_visit_quiz` writes nothing where a row stands and answers the standing one; the record then says whose it is. Two runs overlapping cost a second call, never a second row.
 *
 * **Failures** ("Three unrelated timeouts are not a poison pill"). A transport failure to the model was retried inside models(); this file never retries a call. A database error on one
 * visit is recorded and the run goes on (the visit stays pending for the next run, or the tick); a ledger row that could not be written, or a transport failure to the database, stops the run.
 *
 * **The concession rides with the question** (the concession post design, Task 3): the quiz call's answer carries the post the Mod makes if it is talked down, and `write_visit_concession` writes it beside the
 * question, `model` when `repairQuiz` kept one (also where the question was rejected), else `none` with the predicate; where a bank question is written the concession is `none` with the same reason. A Mod on the
 * old voice asks its question on this chat call as before and makes its concession on a completion of its own (duty `concession`, concession.ts), counted under `modBots.concessionsPerDay`.
 *
 * Nothing private reaches the model: the post, its thread, the board and the rules are public play, and the read names no owner, class or reactor.
 */
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import { taggedName } from '../../../engine/rules/pronouns.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { quizPrompt, repairQuiz } from '../../../engine/system/quiz.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { readContext } from '../_shared/pool-read.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import type { Standing } from '../_shared/mod-groups.ts';
import { judgedRead, said, stopsTheRun } from './core.ts';
import { callConcession, ConcessionBudget, concessionInput } from './concession.ts';

/** The most visits one run writes a question for. A busy instance's rest is the next run's (every five minutes), or the tick's bank question. */
export const QUIZZES_PER_RUN = 10;

interface Pending {
  readonly visit_act: string;
  readonly staff: string;
  readonly post_act: string;
  readonly thread: string;
  readonly board: string;
  readonly board_name: string;
  readonly charges: readonly { readonly rule?: string; readonly band: string; readonly cause: string }[];
  readonly started_at: string;
}

interface Written { readonly written: boolean; readonly source: 'model' | 'bank'; readonly question: string; readonly choices: readonly string[]; readonly answer: string }
interface Bank { readonly question: string; readonly choices: readonly string[]; readonly answer: string }

/** What one visit's question came to. `written` says this run wrote it; `source` is whose the standing row is. `left` is a visit left pending (no bank question, or a database error). */
export interface QuizRecord {
  readonly visit: string;
  readonly staff: string;
  readonly status: 'written' | 'lost' | 'left';
  readonly source?: 'model' | 'bank';
  readonly why?: string;
  readonly trims: readonly Trim[];
  readonly calls: number;
  /** What the visit's concession came to: `model` (written by this visit's call), or `none` and why. */
  readonly concession?: { readonly source: 'model' | 'none'; readonly why?: string };
}

export type QuizOutcome =
  | { readonly status: 'ok'; readonly due: number; readonly quizzes: readonly QuizRecord[] };

export async function runQuizzes(db: Db, models: Models, instance: Instance, slot: string, clock: () => number = Date.now): Promise<QuizOutcome> {
  if (Number.isNaN(Date.parse(slot))) throw new Error(`staff: slot is not a time: ${JSON.stringify(slot)}`);
  const pending = await db.rpc<Pending[]>('pending_quizzes', { most: QUIZZES_PER_RUN });
  const records: QuizRecord[] = [];
  if (pending.length === 0) return { status: 'ok', due: 0, quizzes: records };
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  let used = await db.rpc<number>('quiz_calls_today', {});
  // A missing or non-whole day's count is no budget at all (the bank always), never an unbounded one.
  const given: unknown = settings.modBots.quizQuestionsPerDay;
  const most = typeof given === 'number' && Number.isInteger(given) && given >= 0 ? given : 0;
  const roster = tuned.system.roster;
  let concessionBudget: ConcessionBudget | null = null;
  const concessionsLeft = async (): Promise<ConcessionBudget> => (concessionBudget ??= await ConcessionBudget.of(db, settings));
  const standings = new Map<string, Standing | null>();
  const standingOf = async (staff: string): Promise<Standing | null> => {
    if (!standings.has(staff)) standings.set(staff, roster.some((p) => p.key === staff) ? await db.rpc<Standing>('mod_standing', { staff }) : null);
    return standings.get(staff) ?? null;
  };

  for (const v of pending) {
    try {
      records.push(await oneQuiz(v));
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      if (e instanceof DatabaseError) { records.push({ visit: v.visit_act, staff: v.staff, status: 'left', why: said(e), trims: [], calls: 0 }); continue; }
      throw e;
    }
  }
  return { status: 'ok', due: pending.length, quizzes: records };

  async function oneQuiz(v: Pending): Promise<QuizRecord> {
    const persona: Persona | undefined = roster.find((p) => p.key === v.staff);
    const trims: Trim[] = [];
    let calls = 0;
    let why: string | undefined;
    let made: { question: string; choices: readonly string[]; answer: string } | null = null;
    let asked: ReturnType<typeof concessionInput> | null = null;
    let concession: { source: 'model'; body: string } | { source: 'none'; why: string } | null = null;

    if (!settings.systemEnabled) why = 'the System is off';
    else if (!persona) why = 'the persona is not in the roster';
    else if ((await standingOf(v.staff))?.office !== 'mod') why = 'the persona is not a Mod now';
    else if (used >= most) why = 'the day\'s quizQuestionsPerDay is spent';

    if (!why && persona) {
      let heard: Awaited<ReturnType<typeof judgedRead>> | null = null;
      try {
        heard = await judgedRead(db, settings, v.thread, v.staff, v.post_act, readContext(tuned, clock()));
      } catch (e) {
        if (stopsTheRun(e) || !(e instanceof DatabaseError)) throw e;
        why = `the read failed: ${said(e)}`;
      }
      const post = heard?.read.posts.find((p) => p.marks.answering);
      if (!heard) { /* the bank row, with the read's failure on the record */ }
      else if (!post) why = 'the post inspected cannot be read';
      else {
        asked = concessionInput(persona, v, heard, post);
        const input = asked;
        const brief = persona.weakness.kind === 'quiz' ? persona.weakness.quizBrief ?? null : null;
        const frame = quizPrompt({
          persona, brief, board: { name: v.board_name }, title: heard.title,
          author: post.pronouns === null ? post.name : taggedName(post.name, post.pronouns),
          body: post.body, lines: [...(post.originLines ?? []), ...(post.before ?? []), ...(post.after ?? [])],
          charges: v.charges.map((c) => ({ rule: c.rule ?? 'a breach of the rules', band: c.band, cause: c.cause })),
        });
        try {
          used++; calls++;
          const out = await models.chat({
            duty: 'quizQuestion', tier: DUTY_SPECS.quizQuestion.tier, staff: v.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
            schema: frame.schema, maxTokens: 600,
          });
          const repaired = repairQuiz(out.value);
          trims.push(...repaired.trims);
          if (repaired.ok) made = repaired; else why = `the answer was rejected: ${repaired.why}`;
          // The old voice's concession is its own call, below; the chat answer's is the chat voice's.
          if (persona.voice !== 'oldVoice') {
            const broken = repaired.trims.find((t) => t.path === 'concession' && repaired.concession === null);
            concession = repaired.concession !== null ? { source: 'model', body: repaired.concession } : { source: 'none', why: `concession: ${broken?.predicate ?? 'missing'}` };
          }
        } catch (e) {
          if (stopsTheRun(e)) throw e;
          why = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
        }
      }
    }

    let source: 'model' | 'bank' = 'model';
    if (!made) {
      const bank = await db.rpc<Bank | null>('bank_quiz_for', { visit: v.visit_act });
      if (!bank) {
        const note = `${why ?? 'no model question'}; the persona has no bank question for this visit`;
        // An old-voice Mod's concession waits for its question: a `none` row now would stand in the way of the call it is owed.
        const left = persona?.voice === 'oldVoice' ? undefined : await writeConcession(v, concession ?? { source: 'none', why: why ?? 'no model concession' });
        await record(v, { source: null, why: note, trims, calls, ...(left ? { concession: left } : {}) });
        return { visit: v.visit_act, staff: v.staff, status: 'left', why: note, trims, calls, ...(left ? { concession: left } : {}) };
      }
      made = bank;
      source = 'bank';
    }
    const row = await db.rpc<Written>('write_visit_quiz', { visit: v.visit_act, source, question: made.question, choices: made.choices, answer: made.answer });
    // The old voice's concession is its own call, made once its question stands: a visit left pending is retried, and must not pay for it each time.
    if (persona?.voice === 'oldVoice' && asked && row.written) {
      const budget = await concessionsLeft();
      if (budget.spent) concession = { source: 'none', why: 'the day\'s concessionsPerDay is spent' };
      else {
        budget.take(); calls++;
        const c = await callConcession(models, persona, asked);
        if (c.ok) { concession = { source: 'model', body: c.body }; trims.push(...c.trims); } else concession = { source: 'none', why: c.why };
      }
    }
    // The concession beside it: the model's where the answer carried one, else none with the reason (a bank question's included).
    const written = await writeConcession(v, concession ?? { source: 'none', why: why ?? 'no model concession' });
    // A row that stood first is the standing one: the record says whose it is.
    await record(v, { source: row.source, ...(row.written ? {} : { lost: true }), ...(why ? { why } : {}), trims, calls, concession: written });
    return { visit: v.visit_act, staff: v.staff, status: row.written ? 'written' : 'lost', source: row.source, ...(why ? { why } : {}), trims, calls, concession: written };
  }

  /** A concession's write is best effort beside the question: a database error on it is on the record, never lost with the question's. */
  async function writeConcession(v: Pending, c: { source: 'model'; body: string } | { source: 'none'; why: string }): Promise<{ source: 'model' | 'none'; why?: string }> {
    try {
      await db.rpc('write_visit_concession', { visit: v.visit_act, source: c.source, body: c.source === 'model' ? c.body : null, why: c.source === 'none' ? c.why : null });
      return c.source === 'model' ? { source: 'model' } : { source: 'none', why: c.why };
    } catch (e) {
      if (stopsTheRun(e) || !(e instanceof DatabaseError)) throw e;
      return { source: c.source, why: `the concession could not be written: ${said(e)}` };
    }
  }

  function record(v: Pending, record: Record<string, unknown>): Promise<unknown> {
    return db.rpc('record_staff_call', { cause_act: v.visit_act, duty: 'quizQuestion', staff: v.staff, record });
  }
}
