/**
 * A player's appeal of a punishment, as a pure module (the Mod Bots design, section 7; its plan, Task 10). It is the report's twin (report.ts), through the same door
 * (door.ts): it takes the player's `Db` (the player's own session), the service's `Db`, a way to build the `Models` (its tiers are a service read, so it is asked for only
 * after the appeal is taken) and the instance, and answers the request. supabase/functions/staff/index.ts is the thin Edge Function around it; this file is what Node tests
 * (appeal.test.ts) and Deno both run. The engine's side of the call (the prompt, the shape of the answer, its repair) is engine/system/judgment.ts.
 *
 *   1. The request is read (a character, a punishment, a plea). Nothing is done as the service before the database has taken the appeal as the player: `open_appeal` verifies the
 *      session, that the caller plays the character, that the punishment is that character's and has not been appealed, the daily judgment budget, and then spends the price
 *      and writes the public Act. It does not refuse a banned character: a ban is appealed by the banned. Its refusals are the database's words, passed on as they are; a
 *      session it does not take is a 401.
 *   2. From here the appeal is paid, and it is either ruled on or refunded. The staff member the database names hears it (the Mod that filed an infraction; the Boss for a ban;
 *      if the filer has left, the Mod on the board's beat, or the Boss): its one light-tier call (duty `appeal`, with `staff` set so it is a ledger row) is told the punishment, the
 *      post, the thread, the board's premise, the rules in force, the appellant's public name and plea, and the persona's `persuadedBy`. Nothing about who owns anything.
 *   3. The answer is repaired (repairAppeal): a verdict that is none of the four cannot be repaired without inventing one, a line is cut to 280. The call's record is kept
 *      (`record_staff_call`, cause the appeal), then `close_appeal` writes the ruling and its effect. **The model's words are only ever a pick from the list**: how much a
 *      reduction or an increase is, and what an overturned ban does, are the database's, bounded there; no amount, move or days in the answer is read.
 *   4. **A failed judgment refunds it.** A call that failed or was rejected, a verdict that cannot be repaired, a hearer who is not a Mod or the Boss now, a database error before
 *      the ruling is written: `refund_appeal`, which acts once and refuses an appeal that already has a ruling, so a lost answer to `close_appeal` is never a double effect. The
 *      appeal Act stays, with no ruling, and the punishment can be appealed again. An appeal whose function died before it could refund is refunded by the filing run
 *      (`refund_stale_appeals`), so no player is left out of pocket.
 *
 * Nothing private reaches the model: the punishment, the post, the thread and the rules are public play, the board's premise is the game's, the plea and the appellant's name
 * are a public Act's, and the hearer's order, memory, career and notes are a staff character's. No owner, class or reactor is read, and the appellant's character id is not even
 * told to the model.
 *
 * **Cost does not grow with the instance.** One light-tier call per appeal, bounded by the daily judgment budget the database checks before the appeal is paid.
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { APPEAL_RULE, appealPrompt, repairAppeal, type AppealPunishment, type RuleLine } from '../../../engine/system/judgment.ts';
import { phaseAt, type SeasonSpan } from '../../../engine/system/phases.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, sessionRefused, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected } from '../_shared/models/index.ts';
import { learnMod, said } from './core.ts';
import { playerDoor, type DoorAnswer, type DoorDeps } from './door.ts';

export type AppealAnswer = DoorAnswer;

/** The hint every refusal the player-facing SQL functions raise carries, so their words alone reach a player (the act function's REFUSAL_HINT). */
const REFUSAL_HINT = 'kayfabb.refusal';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Opened {
  readonly appeal: string;
  readonly punishment: string;
  /** The post the punishment is about; null for a group move, which is about none. */
  readonly post: string | null;
  readonly thread: string;
  /** Who hears it: the staff member the database names now. */
  readonly staff: string;
  readonly plea: string;
  readonly kind: 'infraction' | 'ban' | 'move';
  /** An infraction or ban: its band, points and rule. A group move: the group by name, the board it bars (null: none), its length in days and end (null: none), and whether an apology ends it. */
  readonly details: {
    readonly band?: string; readonly points?: number; readonly rule?: string; readonly filed_by: string; readonly days?: number | null; readonly until?: string | null;
    readonly group?: string; readonly bars?: string | null; readonly apology?: boolean;
  };
  readonly board: { readonly id: string; readonly name: string; readonly premise: string };
  readonly appellant: { readonly id: string; readonly name: string };
}

interface ThreadRead {
  readonly title: string;
  readonly posts: readonly { readonly act: string; readonly name: string; readonly body: string }[];
}

interface Closed {
  readonly closed: boolean;
  readonly refunded?: boolean;
  readonly existing?: boolean;
  readonly verdict?: string;
  readonly ruling_act?: string;
  readonly line?: string;
  readonly points_delta?: number;
  readonly refunded_amount?: number;
  readonly until?: string;
  readonly expired?: boolean;
  readonly reason?: string;
}

const answer = (status: number, body: Record<string, unknown>): AppealAnswer => ({ status, body });

export async function runAppeal(dbs: { player: Db; service: Db }, getModels: () => Promise<Models>, instance: Instance, request: unknown): Promise<AppealAnswer> {
  const req = request as { through?: unknown; punishment?: unknown; plea?: unknown } | null;
  if (typeof req !== 'object' || req === null) return answer(400, { error: 'an appeal names the character appealing, the punishment and a plea' });
  if (typeof req.through !== 'string' || !UUID.test(req.through)) return answer(400, { field: 'through', error: 'an appeal is made through one of your characters' });
  if (typeof req.punishment !== 'string' || !UUID.test(req.punishment)) return answer(400, { field: 'punishment', error: 'an appeal names the punishment' });
  if (typeof req.plea !== 'string') return answer(400, { field: 'plea', error: 'say why this punishment should change' });

  // The database takes the appeal as the player, or says why not. Nothing before this is done as the service.
  let opened: Opened;
  try {
    opened = await dbs.player.rpc<Opened>('open_appeal', { through: req.through, punishment_act: req.punishment, plea: req.plea });
  } catch (e) {
    if (sessionRefused(e)) return answer(401, { error: 'sign in to appeal' });
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) return answer(e.status >= 400 && e.status < 500 ? e.status : 400, { error: e.reason, code: e.code });
    // The answer was lost, and the appeal may be open and paid: said so, never "it failed". An appeal with no ruling is refunded by the filing run.
    if (e instanceof TransportError) return answer(503, { error: 'no answer came back, so this may have gone through: look before you try again. If your appeal is open with no answer, your Aura comes back by itself.' });
    console.error('appeal failed', e instanceof Error ? e.message : 'unknown');
    return answer(500, { error: 'the appeal could not be made; try again' });
  }

  // The appeal is paid. From here it is ruled on or refunded.
  try {
    return await judge(dbs.service, getModels, instance, opened);
  } catch (e) {
    console.error('an appeal was not judged', opened.appeal, e instanceof Error ? e.message : 'unknown');
    return await refund(dbs.service, opened);
  }
}

/** The failed judgment's refund: once, and never over a ruling that was in fact written. */
async function refund(db: Db, opened: Opened): Promise<AppealAnswer> {
  try {
    const back = await db.rpc<{ refunded: boolean; closed?: boolean; already?: boolean }>('refund_appeal', { appeal_act: opened.appeal });
    if (back.closed) return answer(200, { appeal: opened.appeal, answered: true });
    return answer(502, { appeal: opened.appeal, error: 'No one could hear this appeal. Your Aura has been refunded, and you can appeal again.' });
  } catch (e) {
    console.error('an appeal was not refunded', opened.appeal, e instanceof Error ? e.message : 'unknown');
    return answer(502, { appeal: opened.appeal, error: 'No one could hear this appeal. Your Aura will be refunded shortly, and you can appeal again then.' });
  }
}

async function judge(db: Db, getModels: () => Promise<Models>, instance: Instance, opened: Opened): Promise<AppealAnswer> {
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;
  // The hearer is a Mod, or the Boss (a ban's): either is read for its career, memory and notes the same way.
  const hearer = await learnMod(db, tuned.system.roster, settings, opened.staff, ['mod', 'boss']);
  if (!hearer.persona || hearer.standing === null || !hearer.career || (hearer.standing.office !== 'mod' && hearer.standing.office !== 'boss')) throw new Error(`${opened.staff} is not a Mod or the Boss now`);
  const standing = hearer.standing;

  const rules = await db.rpc<RuleLine[]>('rules_in_force', { board: opened.board.id });
  // A group move is announced in the Announcements thread and is about no post: there is nothing there for the hearer to read.
  const read: ThreadRead = opened.post === null ? { title: '', posts: [] } : await db.rpc<ThreadRead>('pool_thread', { in_thread: opened.thread, most: settings.pool.chatterThreadPosts, chars: settings.digestExcerptChars, also: opened.post });
  const post = read.posts.find((p) => p.act === opened.post) ?? { name: opened.appellant.name, body: '' };
  const d = opened.details;
  const punishment: AppealPunishment = {
    kind: opened.kind,
    ...(d.band !== undefined ? { band: d.band } : {}), ...(d.points !== undefined ? { points: d.points } : {}), ...(d.rule !== undefined ? { rule: d.rule } : {}),
    ...(d.days != null ? { days: d.days } : {}), ...(d.until != null ? { until: d.until } : {}),
    ...(opened.kind === 'move' ? { group: d.group ?? 'a group', ...(d.bars != null ? { bars: d.bars } : {}), apology: d.apology === true } : {}),
  };
  const frame = appealPrompt({
    persona: hearer.persona, persuadedBy: hearer.persona.persuadedBy, order: standing.order, career: hearer.career, memory: hearer.memory, notes: hearer.notes, rules,
    allowance: standing.allowance, beat: standing.beat, ruleDaysMost: settings.modBots.ruleDaysMost, expiryLeastHours: settings.moveExpiryLeastHours,
    names: (id) => hearer.names[id] ?? 'a character',
    board: opened.board, thread: { title: read.title, posts: read.posts.map((p) => ({ name: p.name, body: p.body })) }, post: { name: post.name, body: post.body },
    appellant: { name: opened.appellant.name }, plea: opened.plea, punishment, filedByHearer: opened.details.filed_by === opened.staff,
    limits: { threadPosts: settings.pool.chatterThreadPosts, excerptChars: settings.digestExcerptChars, titleMaxLength: settings.titleMaxLength },
  });

  // The call. A transport failure was retried inside models(); what comes back is an answer, a rejection, or a failure.
  let failed: string | undefined;
  let trims: readonly Trim[] = [];
  let repaired: ReturnType<typeof repairAppeal> | undefined;
  try {
    const out = await (await getModels()).chat({
      duty: 'appeal', tier: DUTY_SPECS.appeal.tier, staff: opened.staff, system: frame.system, messages: [{ role: 'user', content: frame.message }],
      schema: frame.schema, rules: APPEAL_RULE, maxTokens: 600,
    });
    repaired = repairAppeal(out.value);
    trims = repaired.trims;
  } catch (e) {
    failed = (e instanceof AnswerRejected ? 'the answer was rejected: ' : 'the call failed: ') + said(e);
  }
  const verdict = repaired?.verdict ?? null;
  if (!failed && verdict === null) failed = 'the verdict could not be repaired';

  // The call was billed, so it has its record (the trims and the drops, with the predicate that failed), before anything that could fail after it.
  await db.rpc('record_staff_call', {
    cause_act: opened.appeal, duty: 'appeal', staff: opened.staff,
    record: { line: repaired?.line == null ? 'stock' : 'model', ...(failed ? { why: failed } : {}), ...(repaired ? { verdict } : {}), trims, dropped: repaired?.dropped ?? [], calls: 1 },
  });
  if (failed || repaired === undefined || verdict === null) throw new Error(failed ?? 'no verdict');

  // Only the verdict and the line go to the database: what a ruling does is bounded there.
  // A group move's increase (only an increase) is bounded by the phase's most days from its landing: the phase is the engine's (the season, the Boss's overrides), so it is computed here and passed.
  const mostDays = opened.kind === 'move' && verdict === 'increased' ? await phaseMostDays(db, tuned.system.roster, settings) : undefined;
  const closed = await db.rpc<Closed>('close_appeal', { appeal_act: opened.appeal, verdict, line: repaired.line, staff: opened.staff, ...(mostDays !== undefined ? { most_days: mostDays } : {}) });
  // The punishment ran out while the appeal waited: the database ruled on nothing and gave the price back, and says so plainly.
  if (!closed.closed && closed.refunded && closed.expired) return answer(409, { appeal: opened.appeal, expired: true, error: closed.reason ?? 'That punishment had already run out, so nothing was ruled and your Aura is back.' });
  if (!closed.closed && closed.refunded) return answer(409, { appeal: opened.appeal, error: 'This appeal was refunded before it was ruled on. Appeal again if you still want it heard.' });
  return answer(200, {
    appeal: opened.appeal, verdict: closed.verdict ?? verdict, line: closed.line ?? repaired.line, points_delta: closed.points_delta ?? 0,
    ...(closed.refunded_amount ? { refunded: closed.refunded_amount } : {}), ...(closed.until ? { until: closed.until } : {}),
  });
}

/**
 * The phase's `moveExpiryMostDays` now, as the Boss's meeting reads it (the season's phase, with the Boss's own overrides), or undefined where there is no season or Boss to read it
 * from: the database then uses the instance's own most days. Read-only; a failure to read it is no reason to fail a paid ruling.
 */
async function phaseMostDays(db: Db, roster: Instance['system']['roster'], settings: Instance['settings']): Promise<number | undefined> {
  try {
    const context = await db.rpc<{ season: SeasonSpan | null; boss: string | null }>('meeting_context', {});
    if (!context.season || !context.boss) return undefined;
    const boss = roster.find((b) => b.key === context.boss);
    return phaseAt(context.season, Date.now(), settings, boss).numbers.moveExpiryMostDays;
  } catch (e) {
    console.error('the phase could not be read for an appeal', e instanceof Error ? e.message : 'unknown');
    return undefined;
  }
}

/** An appeal is a plea of 1000 characters (a few thousand bytes), ids and a little more. */
export const MOST_APPEAL_BYTES = 12 * 1024;

/** The player's door to an appeal: the shared door (door.ts) with an appeal's words and run. */
export const appealDoor = (request: Request, d: DoorDeps): Promise<Response> => playerDoor(request, d, runAppeal, {
  posted: 'appeals are posted', signIn: 'sign in to appeal', tooLong: 'that appeal is too long', failed: 'the appeal could not be made; try again', maxBytes: MOST_APPEAL_BYTES,
});
