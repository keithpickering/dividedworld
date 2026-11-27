/**
 * The Banlist's entries, as a job of the staff run (the outcome posts design, section 8; its plan, Task 3). A ban is posted to its season's Banlist thread by `post_ban_entry`: a code line the database fills from the
 * ban, and under it one short line in the voice of the Mod whose infraction filled the bar. This run writes that line. The engine's side (the prompt, the old voice's document, the repair) is engine/system/banlist.ts;
 * the database's is `pending_ban_entries()` and `post_ban_entry()`, and the tick's grace posts the stock for what this run does not reach. The handler runs it after the filings (a filing that bans in this run owes its
 * entry by then) and before the patrols, on its own terms: its failure costs the filings nothing.
 *
 * For each ban that owes an entry, oldest first and at most `owedLines.perRun`: the Mod is asked for the one line, with one light-tier call (chat, or raw completion for a persona on the old voice, as a filing is),
 * ledgered with `staff` set, recorded against the ban (duty `banEntry`), and `post_ban_entry(ban, line, 'model')` posts it. **Anything that leaves no line posts the stock at once** (`post_ban_entry(ban, null, 'stock')`):
 * a Mod not on the roster or no longer a Mod, a day that has reached `owedLines.perDay` (shared with the owed lines: a ban's entry is a line owed for an act that has happened, counted from the same ledger,
 * `standing_order_line_calls_today`), a thread that cannot be read, a call that failed, an answer rejected, a blank line. With The System off nothing is done: the tick's grace posts the stock.
 *
 * The thread is the post that tipped the bar's, read as the filing run reads it (`judgedRead`, that post the judged one), and the Mod is learned as a filing's is (`learnMod`). The banned character's name is the
 * ban's own, told with their own pronouns from `character_faces` (the instance's default where they have no profile row); the board's premise is the row's.
 *
 * Retries: a transport failure is retried inside models.chat; here one call is made. A transport or ledger failure stops the run (stopsTheRun); a database error on one entry is recorded and the run goes on, the
 * entry staying owed for the next run or the tick's grace.
 *
 * Masks: the facts are the ban's own, a public Act: the character, the days, the rule's words and the season. Never an owner, a class or another of the player's characters.
 *
 * Cost does not grow with the instance: one call per ban, at most `perRun` a run and `perDay` a day with the owed lines.
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { writeTokensMost } from '../../../engine/rules/cards.ts';
import { BAN_LINE_MOST, banEntryCompletion, banEntryPrompt, repairBanLine } from '../../../engine/system/banlist.ts';
import { CHATTER_TOKENS } from '../../../engine/system/chatter.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import type { RuleLine } from '../../../engine/system/judgment.ts';
import type { Models } from '../../../engine/system/model.ts';
import { tokenCounter } from '../../../engine/system/tokens.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { readContext } from '../_shared/pool-read.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import { instanceSet, judgedRead, learnMod, OLD_VOICE_LINE_TOKENS, pronounsOfCharacter, said, stopsTheRun, type Known } from './core.ts';

/** A ban that owes an entry, as `pending_ban_entries` lists it. */
export interface PendingBan {
  readonly ban_act: string;
  readonly staff: string;
  /** The banned character's id: their pronouns are read from `character_faces`. */
  readonly banned_id: string;
  readonly banned: string;
  readonly days: number;
  readonly rule: string;
  readonly season: number;
  readonly post_act: string;
  readonly thread: string;
  readonly board: string;
  readonly board_name: string;
  readonly board_premise: string | null;
  readonly owed_at: string;
}

export type BanEntryStatus = 'posted' | 'existing' | 'none' | 'failed';
export interface BanEntryRecord {
  readonly ban: string;
  readonly staff: string;
  /** `posted`: this run posted it; `existing`: it stood already or the ban owed none; `none`: `post_ban_entry` posted nothing (the instance's words are missing); `failed`: a database error, the ban stays owed. */
  readonly status: BanEntryStatus;
  readonly source?: 'model' | 'stock';
  readonly why?: string;
  readonly trims: readonly Trim[];
  readonly calls: number;
}
export type BanEntryOutcome = { readonly status: 'off' } | { readonly status: 'ok'; readonly due: number; readonly entries: readonly BanEntryRecord[] };

/** The run after the filings, as the Edge Function calls it: a failure that stops the run is rethrown so the invocation answers 500 as the filings do; any other failure costs the run nothing else. */
export async function runBanEntriesAfterFilings(db: Db, models: Models, instance: Instance, slot: string, clock: () => number = Date.now): Promise<BanEntryOutcome | { readonly status: 'failed' }> {
  try {
    return await runBanEntries(db, models, instance, slot, clock);
  } catch (e) {
    console.error('ban entries failed', slot, e instanceof Error ? e.message : 'unknown');
    if (stopsTheRun(e)) throw e;
    return { status: 'failed' };
  }
}

export async function runBanEntries(db: Db, models: Models, instance: Instance, slot: string, clock: () => number = Date.now): Promise<BanEntryOutcome> {
  if (Number.isNaN(Date.parse(slot))) throw new Error(`staff: slot is not a time: ${JSON.stringify(slot)}`);
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  if (!settings.systemEnabled) return { status: 'off' };
  const { perDay, perRun } = settings.owedLines;
  const pending = await db.rpc<PendingBan[]>('pending_ban_entries', { most: perRun });
  const records: BanEntryRecord[] = [];
  if (pending.length === 0) return { status: 'ok', due: 0, entries: records };
  let used = await db.rpc<number>('standing_order_line_calls_today', {});
  const roster = tuned.system.roster;
  const known = new Map<string, Known>();
  const rulesOf = new Map<string, readonly RuleLine[]>();

  /** The model calls made for the entry in hand, so a failure after the call is billed still says so. */
  let callsMade = 0;
  for (const b of pending) {
    callsMade = 0;
    try {
      records.push(await oneEntry(b));
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      if (e instanceof DatabaseError) { records.push({ ban: b.ban_act, staff: b.staff, status: 'failed', why: said(e), trims: [], calls: callsMade }); continue; }
      throw e;
    }
  }
  return { status: 'ok', due: pending.length, entries: records };

  /** One ban, from its facts to its post. Throws only a run-stopping error or a database error, which the caller records. */
  async function oneEntry(b: PendingBan): Promise<BanEntryRecord> {
    const posted = async (line: string | null, why: string | undefined, trims: readonly Trim[], calls: number): Promise<BanEntryRecord> => {
      const source = line === null ? 'stock' : 'model';
      const out = await db.rpc<{ posted?: boolean; error?: string } | null>('post_ban_entry', { ban: b.ban_act, line, source });
      const status: BanEntryStatus = out?.posted ? 'posted' : typeof out?.error === 'string' ? 'none' : 'existing';
      const reason = why ?? (status === 'none' ? out?.error : undefined);
      return { ban: b.ban_act, staff: b.staff, status, source, ...(reason ? { why: reason } : {}), trims, calls };
    };
    let mod = known.get(b.staff);
    if (!mod) { mod = await learnMod(db, roster, settings, b.staff); known.set(b.staff, mod); }
    const persona = mod.persona;
    if (!persona) return posted(null, 'the Mod is not on the roster', [], 0);
    if (mod.standing?.office !== 'mod' || !mod.career) return posted(null, 'the persona is not a Mod now', [], 0);
    if (used >= perDay) return posted(null, 'the day has reached owedLines.perDay', [], 0);

    let heard: Awaited<ReturnType<typeof judgedRead>>;
    try {
      heard = await judgedRead(db, settings, b.thread, b.staff, b.post_act, readContext(tuned, clock()));
    } catch (e) {
      if (stopsTheRun(e) || !(e instanceof DatabaseError)) throw e;
      return posted(null, `the read failed: ${said(e)}`, [], 0);
    }
    if (!heard.judged) return posted(null, 'the post that tipped the bar cannot be read', [], 0);
    const rules = rulesOf.get(b.board) ?? await db.rpc<RuleLine[]>('rules_in_force', { board: b.board });
    rulesOf.set(b.board, rules);

    // A character with no profile row reads the instance's default. A database error here is the entry's, before any call is billed.
    const pronouns = await pronounsOfCharacter(db, b.banned_id, instanceSet(settings));

    let line: string | null = null;
    let trims: readonly Trim[] = [];
    let failed: string | undefined;
    try {
      used++;
      callsMade = 1;
      if (persona.voice === 'oldVoice') {
        const maxTokens = Math.min(OLD_VOICE_LINE_TOKENS, writeTokensMost(settings));
        const frame = banEntryCompletion({
          name: persona.name, board: b.board_name, title: heard.title, read: heard.read, limits: { titleMaxLength: settings.titleMaxLength },
          fit: { budget: settings.oldVoiceWindow - maxTokens, count: tokenCounter(settings.oldVoiceTokenizer) }, banned: b.banned, days: b.days, rule: b.rule,
        });
        const out = await models.complete({ duty: 'banEntry', staff: b.staff, prompt: frame.prompt, temperature: 0.9, topP: 0.95, stop: frame.stop, maxTokens, maxChars: BAN_LINE_MOST });
        ({ line, trims } = repairBanLine(out.value));
      } else {
        const frame = banEntryPrompt({
          persona, office: 'mod', offices: tuned.system.offices, pronouns: mod.pronouns, order: mod.standing.order, career: mod.career, memory: mod.memory, notes: mod.notes, rules,
          allowance: mod.standing.allowance, beat: mod.standing.beat, ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours, names: (id) => mod.names[id] ?? 'a character',
          board: { name: b.board_name, premise: b.board_premise ?? '' }, thread: b.thread, title: heard.title, read: heard.read,
          limits: { titleMaxLength: settings.titleMaxLength, postMaxLength: settings.postMaxLength },
          banned: { name: b.banned, pronouns }, days: b.days, rule: b.rule, season: b.season,
        });
        const out = await models.chat({
          duty: 'banEntry', tier: DUTY_SPECS.banEntry.tier, staff: b.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }], schema: frame.schema, maxTokens: CHATTER_TOKENS,
        });
        ({ line, trims } = repairBanLine((out.value as { line?: unknown } | null)?.line));
      }
    } catch (e) {
      if (stopsTheRun(e)) throw e;
      failed = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
    }
    if (!failed && line === null) failed = 'the line was blank';
    const named = trims.map((t) => ({ ...t, path: `banEntry.${t.path}` }));
    // The billed call has its record before anything that could fail after it. A billed call whose record fails leaves the ban owed, and the next run may bill it again, bounded by perDay and the grace.
    await db.rpc('record_staff_call', { cause_act: b.ban_act, duty: 'banEntry', staff: b.staff, record: { source: failed ? 'stock' : 'model', ...(failed ? { why: failed } : {}), trims: named, calls: 1 } });
    return posted(failed ? null : line, failed, named, 1);
  }
}
