/**
 * The Mod Bots' concession run (the outcome posts design, sections 2, 5 and 6; its plan, Task 3): a talk-down that has no concession post yet (`pending_concessions`, oldest first, at most
 * `CONCESSIONS_PER_RUN`) is given one by the visit's own Mod, with one light-tier call (duty `concession`, `staff` set, so a ledger row): the post the Mod makes in the thread, quoting the visited post, in its own
 * voice. `post_visit_concession` posts it as the Mod, with `{who}` filled there. The quiz run writes the question only; every talk-down, a quiz answered right included, is conceded here.
 *
 * **The stock is the tick's.** A visit whose System is off, whose Mod has left the staff or is not in the roster, whose day's `modBots.concessionsPerDay` is spent (counted from the ledger,
 * `concession_calls_today`, and up as this run calls), whose thread cannot be read, whose call failed or was rejected, or whose answer could not be repaired without inventing content (`repairConcession`), posts
 * nothing here and says why; the database's tick then posts a line from the persona's own `concessions` after `modBots.concessionWriteMinutes`.
 *
 * **The thread is read as the quiz run reads it** (core.ts `judgedRead`): as readers see it, a redaction or a veil included, the visited post the judged one. The Mod is learned as a filing's Mod is (`learnMod`): its
 * career, memory, notes and rules in force. The talker-down's name is the visit's own (`interceptor_name`), told with the instance's default pronouns: the row carries no other.
 *
 * **Races.** `post_visit_concession` posts nothing where the concession stands or the visit owes none, and says so; the visit is then `existing`.
 *
 * **Failures** as the quiz run's: a database error on one visit is recorded and the run goes on; a ledger row that could not be written, or a transport failure to the database, stops the run.
 */
import type { Instance, Persona } from '../../../engine/rules/types.ts';
import { writeTokensMost } from '../../../engine/rules/cards.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { CHATTER_TOKENS } from '../../../engine/system/chatter.ts';
import { concessionCompletion, concessionPrompt, repairConcession, type ConcessionInput, type TalkDown } from '../../../engine/system/concession.ts';
import { outcomePostMost, type RuleLine } from '../../../engine/system/judgment.ts';
import type { Models } from '../../../engine/system/model.ts';
import { tokenCounter } from '../../../engine/system/tokens.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { readContext } from '../_shared/pool-read.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import { instanceSet, judgedRead, learnMod, OLD_VOICE_POST_TOKENS, said, stopsTheRun } from './core.ts';

/** The most visits one run writes a concession for. */
export const CONCESSIONS_PER_RUN = 10;

/** A talk-down as `pending_concessions` lists it. */
export interface PendingConcession {
  readonly visit_act: string;
  readonly end_act: string;
  readonly staff: string;
  readonly post_act: string;
  readonly thread: string;
  readonly board: string;
  readonly board_name: string;
  readonly charges: readonly { readonly rule?: string; readonly band: string; readonly cause: string }[];
  readonly interceptor_name: string;
  readonly how: 'answered' | 'paid' | 'distracted';
  readonly question: string | null;
  readonly choices: readonly string[] | null;
  readonly answer: string | null;
  /** In hundredths of an Aura. */
  readonly price: number | null;
  readonly card: string | null;
  readonly owed_at: string;
}

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

/** The facts of a talk-down, as the engine takes them. */
export function talkDownOf(v: PendingConcession): TalkDown {
  if (v.how === 'answered') return { how: 'answered', question: v.question ?? '', choices: v.choices ?? [], answer: v.answer ?? '' };
  if (v.how === 'paid') return { how: 'paid', price: v.price ?? 0 };
  return { how: 'distracted', card: v.card ?? 'a card' };
}

export type Made = { readonly ok: true; readonly body: string; readonly trims: readonly Trim[] } | { readonly ok: false; readonly why: string };

export type ConcessionStatus = 'posted' | 'existing' | 'none' | 'left';
export interface ConcessionRecord {
  readonly visit: string;
  readonly staff: string;
  /** `posted`: this run posted it; `existing`: it stood already or the visit owed none; `none`: nothing posted (the tick's stock follows); `left`: a database error, the visit stays pending. */
  readonly status: ConcessionStatus;
  readonly source?: 'model' | 'none';
  readonly why?: string;
  readonly trims: readonly Trim[];
  readonly calls: number;
}

export type ConcessionOutcome =
  | { readonly status: 'ok'; readonly due: number; readonly concessions: readonly ConcessionRecord[] };

export async function runConcessions(db: Db, models: Models, instance: Instance, slot: string, clock: () => number = Date.now): Promise<ConcessionOutcome> {
  if (Number.isNaN(Date.parse(slot))) throw new Error(`staff: slot is not a time: ${JSON.stringify(slot)}`);
  const pending = await db.rpc<PendingConcession[]>('pending_concessions', { most: CONCESSIONS_PER_RUN });
  const records: ConcessionRecord[] = [];
  if (pending.length === 0) return { status: 'ok', due: 0, concessions: records };
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  const budget = await ConcessionBudget.of(db, settings);
  const roster = tuned.system.roster;
  const rulesOf = new Map<string, readonly RuleLine[]>();
  const known = new Map<string, Awaited<ReturnType<typeof learnMod>>>();
  const learn = async (staff: string) => {
    const have = known.get(staff);
    if (have) return have;
    const full = await learnMod(db, roster, settings, staff);
    known.set(staff, full);
    return full;
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

  async function oneConcession(v: PendingConcession): Promise<ConcessionRecord> {
    const none = (why: string, trims: readonly Trim[] = [], calls = 0): ConcessionRecord => ({ visit: v.visit_act, staff: v.staff, status: 'none', source: 'none', why, trims, calls });
    if (!settings.systemEnabled) return none('the System is off');
    const mod = await learn(v.staff);
    const persona = mod.persona;
    if (!persona) return none('the persona is not in the roster');
    if (mod.standing?.office !== 'mod' || !mod.career) return none('the persona is not a Mod now');
    if (budget.spent) return none('the day\'s concessionsPerDay is spent');

    let heard: Awaited<ReturnType<typeof judgedRead>>;
    try {
      heard = await judgedRead(db, settings, v.thread, v.staff, v.post_act, readContext(tuned, clock()));
    } catch (e) {
      if (stopsTheRun(e) || !(e instanceof DatabaseError)) throw e;
      return none(`the read failed: ${said(e)}`);
    }
    if (!heard.judged) return none('the post inspected cannot be read');
    const rules = rulesOf.get(v.board) ?? await db.rpc<RuleLine[]>('rules_in_force', { board: v.board });
    rulesOf.set(v.board, rules);

    budget.take();
    const made = await callConcession(models, settings, persona, {
      persona, office: 'mod', offices: tuned.system.offices, pronouns: mod.pronouns, order: mod.standing.order, career: mod.career, memory: mod.memory, notes: mod.notes, rules,
      allowance: mod.standing.allowance, beat: mod.standing.beat, ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours, names: (id) => mod.names[id] ?? 'a character',
      // The row carries the board's name and no premise: the prompt names the board and the thread.
      board: { name: v.board_name, premise: '' }, thread: v.thread, title: heard.title, read: heard.read,
      charges: v.charges.map((c) => ({ rule: c.rule ?? 'a breach of the rules', band: c.band, cause: c.cause })),
      limits: { titleMaxLength: settings.titleMaxLength, postMaxLength: settings.postMaxLength },
      interceptor: { name: v.interceptor_name, pronouns: instanceSet(settings) }, talkDown: talkDownOf(v),
    });
    // The billed call has its record before anything that could fail after it.
    const trims = made.ok ? made.trims : [];
    const why = made.ok ? undefined : made.why;
    await db.rpc('record_staff_call', { cause_act: v.visit_act, duty: 'concession', staff: v.staff, record: { source: made.ok ? 'model' : 'none', ...(why ? { why } : {}), trims, calls: 1 } });
    if (!made.ok) return none(made.why, trims, 1);
    const posted = await db.rpc<{ posted?: boolean; existing?: boolean; owed?: boolean; error?: string }>('post_visit_concession', { visit: v.visit_act, body: made.body });
    if (posted.posted) return { visit: v.visit_act, staff: v.staff, status: 'posted', source: 'model', trims, calls: 1 };
    if (typeof posted.error === 'string') return none(posted.error, trims, 1);
    return { visit: v.visit_act, staff: v.staff, status: 'existing', source: 'model', trims, calls: 1 };
  }
}

/** One concession call, on the chat voice or the old: the answer repaired, or the reason there is none. A failure that stops the run is thrown. */
async function callConcession(models: Models, settings: Instance['settings'], persona: Persona, i: ConcessionInput): Promise<Made> {
  try {
    if (persona.voice === 'oldVoice') {
      const maxTokens = Math.min(OLD_VOICE_POST_TOKENS, writeTokensMost(settings));
      const frame = concessionCompletion({
        name: persona.name, board: i.board.name, title: i.title, read: i.read, charges: i.charges, limits: { titleMaxLength: settings.titleMaxLength },
        fit: { budget: settings.oldVoiceWindow - maxTokens, count: tokenCounter(settings.oldVoiceTokenizer) }, interceptor: i.interceptor.name, talkDown: i.talkDown,
      });
      const out = await models.complete({ duty: 'concession', staff: persona.key, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens, maxChars: outcomePostMost(settings.postMaxLength) });
      return repairConcession(out.value, settings.postMaxLength);
    }
    const frame = concessionPrompt(i);
    const out = await models.chat({
      duty: 'concession', tier: DUTY_SPECS.concession.tier, staff: persona.key, system: frame.system, messages: [{ role: 'user', content: frame.message }], schema: frame.schema, maxTokens: CHATTER_TOKENS,
    });
    return repairConcession((out.value as { concession?: unknown } | null)?.concession, settings.postMaxLength);
  } catch (e) {
    if (stopsTheRun(e)) throw e;
    return { ok: false, why: (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e) };
  }
}
