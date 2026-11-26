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
  const most = settings.modBots.quizQuestionsPerDay;
  const roster = tuned.system.roster;
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

    if (!settings.systemEnabled) why = 'the System is off';
    else if (!persona) why = 'the persona is not in the roster';
    else if ((await standingOf(v.staff))?.office !== 'mod') why = 'the persona is not a Mod now';
    else if (used >= most) why = 'the day\'s quizQuestionsPerDay is spent';

    if (!why && persona) {
      const heard = await judgedRead(db, settings, v.thread, v.staff, v.post_act, readContext(tuned, clock()));
      const post = heard.read.posts.find((p) => p.marks.answering);
      if (!post) why = 'the post inspected cannot be read';
      else {
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
          if (repaired.ok) { made = repaired; trims.push(...repaired.trims); } else why = `the answer was rejected: ${repaired.why}`;
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
        await record(v, { source: null, why: note, trims, calls });
        return { visit: v.visit_act, staff: v.staff, status: 'left', why: note, trims, calls };
      }
      made = bank;
      source = 'bank';
    }
    const row = await db.rpc<Written>('write_visit_quiz', { visit: v.visit_act, source, question: made.question, choices: made.choices, answer: made.answer });
    // A row that stood first is the standing one: the record says whose it is.
    await record(v, { source: row.source, ...(row.written ? {} : { lost: true }), ...(why ? { why } : {}), trims, calls });
    return { visit: v.visit_act, staff: v.staff, status: row.written ? 'written' : 'lost', source: row.source, ...(why ? { why } : {}), trims, calls };
  }

  function record(v: Pending, record: Record<string, unknown>): Promise<unknown> {
    return db.rpc('record_staff_call', { cause_act: v.visit_act, duty: 'quizQuestion', staff: v.staff, record });
  }
}
