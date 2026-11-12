/**
 * The Boss's meeting, as a pure module: it takes a `Db`, the `Models`, the instance, the slot the schedule fired for, a clock and a
 * `fetch`, and does the run the system plan's Task 9 lists. supabase/functions/meet/index.ts is the thin Edge Function around it;
 * this file is what Node tests (core.test.ts) and Deno both run. The engine's side of the call (the prompt, the rule, the repair)
 * is engine/system/meeting.ts; this file moves data between the database, the model and it.
 *
 * **The meeting's row is opened at its start and closed once** (supabase/migrations/0047_meeting.sql). Every model call's ledger
 * row names its meeting, so the row exists before the first call. `begin_meeting(slot)` opens it, or says the slot was already
 * met (closed: nothing to do), or hands back the row of a run that began and never closed (a crash: the retry reuses it).
 * Everything the meeting keeps is written by one SQL function, `apply_meeting`, in one transaction that closes the row, so a
 * retry cannot queue a move twice: the second apply finds the meeting closed and writes nothing.
 *
 * **A failure is a closed row, not a lost run.** A model that fails or whose answer cannot be repaired closes the meeting `failed`
 * or `rejected` with the error; memory, profile, moves and the bank stay as they were (the ledger already holds the call). A
 * database error is thrown after the row is closed `failed` with its error (best effort) and rethrown, so the error survives
 * on the row; only when that close fails too is the row left open, and then the next run of the slot resumes it (`resumed`) and
 * a row never closed is closed `failed` by the next slot's `begin_meeting`. A model's transport failures are retried inside `models()`, on the request itself; this
 * file never retries a whole meeting ("Three unrelated timeouts are not a poison pill").
 *
 * **The window.** The digest runs from where the previous meeting's window ended (its slot) to this slot, so no play falls
 * between two meetings: the previous meeting's finish time would skip what happened between its slot and its close.
 *
 * **Cost does not grow with the instance.** One strong-tier call per part of the meeting (moves, bundle, staff, self; one cached prefix), a digest bounded by the settings' ceilings
 * (engine/system/digest.ts), a memory bounded by its caps, and one fetch per configured feed with a short timeout. Nothing here reads a row per player, character or Act.
 *
 * Nothing private reaches the model: the digest is built by a role that reads public relations only, and the characters the
 * model names are checked against `characters_public`.
 */
import type { Instance } from '../../../engine/rules/types.ts';
import { shownBeats, type ArcRead } from '../../../engine/system/beats.ts';
import type { Career } from '../../../engine/system/career.ts';
import { DIGEST_MOST, renderDigest, withPronouns, type RawDigest } from '../../../engine/system/digest.ts';
import { ENGINE_DEFAULT_PRONOUNS, pronounsOr, taggedName } from '../../../engine/rules/pronouns.ts';
import { DUTY_SPECS } from '../../../engine/system/duties.ts';
import { feedTitles } from '../../../engine/system/feed.ts';
import type { Memory } from '../../../engine/system/memory.ts';
import {
  MEETING_PARTS,
  REFERENCE_MOST,
  SUCCESSOR_WINDOW_MS,
  farewellFactsText,
  inFarewellWindow,
  inheritedText,
  meetingSystemPrompt,
  namedCharacters,
  predecessorText,
  referenceText,
  partRule,
  partSchema,
  repairAnswer,
  type HandoffFacts,
  type InheritedMove,
  type MachineSlotFacts,
  type ModFacts,
  type PlannedMove,
} from '../../../engine/system/meeting.ts';
import type { TrophyFacts } from '../../../engine/system/moves.ts';
import type { RuleInForce } from '../../../engine/rules/predicates.ts';
import type { Models } from '../../../engine/system/model.ts';
import { phaseAt } from '../../../engine/system/phases.ts';
import { type Trim } from '../../../engine/system/validate.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { AnswerRejected, LedgerWriteFailed, SchemaRefused } from '../_shared/models/index.ts';

export interface SkippedFeed {
  readonly name: string;
  readonly why: string;
}

export type MeetingOutcome =
  | { readonly status: 'already met'; readonly slot: string; readonly meeting: number }
  | { readonly status: 'already applied'; readonly meeting: number }
  | { readonly status: 'off'; readonly meeting: number }
  | { readonly status: 'failed' | 'rejected'; readonly meeting: number; readonly error: string }
  | {
    readonly status: 'ok';
    readonly meeting: number;
    readonly boss: string;
    readonly phase: string;
    readonly queued: number;
    /** The beats the database played (a bundle it skipped is not among them). */
    readonly beatsPlayed: readonly string[];
    /** Every bound the meeting cut or move it dropped, beside the model-level trims the call's ledger row holds. */
    readonly trims: readonly Trim[];
    /** Things the run did that a reader of the result should know (a stock description stood in). */
    readonly notes: readonly string[];
    readonly feedsSkipped: readonly SkippedFeed[];
    readonly inherited: readonly { readonly move_act: string; readonly decision: 'keep' | 'end' }[];
    readonly successor: { readonly boss: string; readonly why: string } | null;
    readonly bankBefore?: number;
    readonly bankAfter?: number;
  };

interface Context {
  readonly season: { readonly startsAt: number; readonly endsAt: number } | null;
  readonly boss: string | null;
  /** The slot of the last meeting that closed ok or failed: where this window starts. Null before the first. */
  readonly lastSlot: string | null;
  readonly boards: readonly { readonly id: string; readonly name: string }[];
  /** The keys a nomination may name (0082): the roster's unretired personas that are not benched, waiting ones included, without the Boss. */
  readonly successors?: readonly string[];
  /** The moves of an earlier Boss, still in force and shaping a board, that this Boss has neither kept nor ended (0051); absent from an older database. */
  readonly inheritanceDue?: readonly InheritedMove[];
  /** The Mod Bots on staff (0103): each one's latest order, and the allowance it has not spent (which returns to the Boss's bank before the meeting counts it). Absent from an older database. */
  readonly mods?: readonly { readonly key: string; readonly allowance: number; readonly granted: number | null; readonly boards: readonly string[]; readonly order: string | null }[];
  /** The rules in force (0103), so a rule that would leave no compliant post is dropped here; absent from an older database. */
  readonly rules?: readonly RuleInForce[];
  /**
   * The machine's slots in grid order (0140): the admin's price and availability (hidden ones too, for a flash sale), whether a pull could land, and the Boss's
   * move in force on each. Nothing about a purchase or a buyer. Absent from an older database, where the Boss has no machine to move.
   */
  readonly machine?: readonly MachineSlotFacts[];
  /** The Boss's arc as the database reads it (0334, over arc_for_meeting): the beats unlocked and not yet played, with whether each is due, and the kinds held back. Absent from an older database, which holds nothing back. */
  readonly arc?: ArcRead;
  /**
   * What the code knows of the open season (0337), handed over only to a meeting within farewellWindowHours of the season's end, to write its handoff from; null or absent otherwise, and from an
   * older database, which keeps no handoff.
   */
  readonly handoffFacts?: HandoffFacts | null;
  /** What a new Boss is handed for inheritanceGraceDays after the handover (0337): the outgoing Boss, the facts of the season it led and its note (null where its last meeting failed). Null or absent otherwise. */
  readonly predecessor?: { readonly staff: string; readonly season: number; readonly note: string | null; readonly facts: HandoffFacts } | null;
  /**
   * The groups (0131): the conferred catalog, and the characters no move may name now (capped at the punishment cap, or held by a group move in force or queued), each with the
   * group it is in now. Absent from an older database, which confers none.
   */
  readonly groups?: {
    readonly conferred: readonly { readonly key: string; readonly name: string; readonly tone: 'punishment' | 'favor' }[];
    readonly characters: readonly { readonly id: string; readonly capped: boolean; readonly held: boolean }[];
  };
}

/** The (trophy, character) pairs the answer's awardTrophy moves name, for the one read of what stands (`trophy_award_facts`). A pair that is not a string and a uuid is left for the repair to refuse. */
function namedAwards(raw: unknown): { trophy: string; character: string }[] {
  const moves = (raw as { moves?: unknown } | null)?.moves;
  if (!Array.isArray(moves)) return [];
  const out: { trophy: string; character: string }[] = [];
  for (const m of moves as { kind?: unknown; params?: { trophy?: unknown; character?: unknown } }[]) {
    const { trophy, character } = m?.params ?? {};
    if (m?.kind === 'awardTrophy' && typeof trophy === 'string' && typeof character === 'string' && /^[0-9a-f-]{36}$/i.test(character)) out.push({ trophy, character: character.toLowerCase() });
  }
  return out.slice(0, 40);
}

/** How long one feed may take: outside material is a garnish, not a dependency. */
export const FEED_TIMEOUT_MS = 5_000;
/** The most of a feed's body that is read. */
const FEED_BYTES = 400_000;

const DAY = 86_400_000;
const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
/** One part's result: a part that was not kept always says why. */
type PartResult = { part: string; outcome: 'ok' } | { part: string; outcome: 'rejected' | 'failed'; error: string };

const said = (e: unknown): string => clip(e instanceof Error ? e.message : String(e), 500);

/** The most tokens each part of the meeting may answer with, by the part's key (the moves are the long one). */
const PART_TOKENS = { moves: 6_000, bundle: 4_000, staff: 3_000, self: 4_500 } as const;

/** Errors that are facts about the database or the ledger, never about the model: thrown at once, after the row is closed failed. */
const isInfrastructure = (e: unknown): boolean => e instanceof DatabaseError || e instanceof TransportError || e instanceof LedgerWriteFailed;

export async function runMeeting(
  db: Db,
  models: Models,
  instance: Instance,
  slot: string,
  clock: () => number,
  fetchFeed: typeof globalThis.fetch,
): Promise<MeetingOutcome> {
  const slotAt = Date.parse(slot);
  if (Number.isNaN(slotAt)) throw new Error(`meet: slot is not a time: ${JSON.stringify(slot)}`);
  const slotIso = new Date(slotAt).toISOString();
  const tuned = await withDatabaseSettings(instance, db);
  const settings = tuned.settings;

  const began = await db.rpc<{ status: 'begun' | 'resumed' | 'already met'; meeting: number }>('begin_meeting', { slot: slotIso });
  if (began.status === 'already met') return { status: 'already met', slot: slotIso, meeting: began.meeting };
  const meeting = began.meeting;

  // The parts run so far, outside the try so that a close after an infrastructure error still carries them.
  const parts: PartResult[] = [];
  // Past this point the row is open: whatever throws is written onto it (best effort) and thrown again, so the error survives the next slot's generic close.
  try {

    const close = async (outcome: 'failed' | 'rejected' | 'off', error: string | null, record: Record<string, unknown> = {}) => {
      await db.rpc('fail_meeting', { meeting, outcome, error, record });
    };

    if (!settings.systemEnabled) {
      await close('off', null);
      return { status: 'off', meeting };
    }

    const context = await db.rpc<Context>('meeting_context', {});
    const bossKey = context.boss;
    if (!context.season || !bossKey) {
      const error = context.season ? 'the open season has no Boss' : 'the instance has no open season';
      await close('failed', error);
      return { status: 'failed', meeting, error };
    }
    const boss = tuned.system.roster.find((b) => b.key === bossKey);
    if (!boss) {
      const error = `the season's Boss "${bossKey}" is not in the instance's roster`;
      await close('failed', error);
      return { status: 'failed', meeting, error };
    }

    // Who a nomination may name is the database's own list (boss_roster), so the prompt, the repair and the guard agree.
    const successors = new Set(context.successors ?? []);

    const now = clock();
    const phase = phaseAt(context.season, now, settings, boss);

    // The window: from where the last meeting's ended (the first meeting: the season's start, or a day back if the season is older).
    const first = Math.max(context.season.startsAt, slotAt - DAY);
    const sinceAt = Math.min(context.lastSlot ? Date.parse(context.lastSlot) : first, slotAt - 60_000);
    // A character with no profile row reads null; it takes the instance's default, else the engine's it-set. A persona's own set is its file's, else the same.
    const instanceSet = pronounsOr(settings.pronouns, ENGINE_DEFAULT_PRONOUNS);
    const personaSet = (own: Parameters<typeof pronounsOr>[0]) => pronounsOr(own, instanceSet);
    const digest = withPronouns(await db.rpc<RawDigest>('system_digest', { since: new Date(sinceAt).toISOString(), until: slotIso }), instanceSet);

    // Its own latest memory; a Boss with none (a new one) reads nothing, or the memory of the Boss its persona inherits.
    let memory = await db.rpc<Memory | null>('staff_memory_latest', { staff: bossKey });
    const hasOwnMemory = memory !== null;
    if (memory === null && boss.inheritsMemoryOf) memory = await db.rpc<Memory | null>('staff_memory_latest', { staff: boss.inheritsMemoryOf });

    const career = await db.rpc<Career>('staff_career', { of_staff: bossKey });

    // Its own notes since its latest memory version (not the last recorded slot: a meeting that failed after its slot was recorded and before its
    // memory was saved would otherwise skip the notes in between; a Boss with no memory of its own reads all it has written), the newest
    // `notesRead`. They are read as its own thoughts and never acted on.
    const memoryAt = hasOwnMemory ? await db.rpc<string | null>('staff_memory_at', { staff: bossKey }) : null;
    const bossNotes = await db.rpc<string[]>('staff_notes_recent', {
      of_staff: bossKey,
      since: memoryAt ? new Date(Date.parse(memoryAt)).toISOString() : null,
      most: settings.pool.notesRead,
    });

    const bankNow = await db.rpc<number>('bank_now', { staff: bossKey, weekly_moves: phase.numbers.weeklyMoves, bank_cap: phase.numbers.bankCap });

    // The Mods on staff. What they did not spend goes back to the Boss's bank when the meeting is applied, before the bank is read, never above the cap: the
    // prompt and the repair work from that bank, so what the Boss is told it holds is what the database will hold.
    const staffMods = context.mods ?? [];
    const bank = Math.min(phase.numbers.bankCap, bankNow + staffMods.reduce((n, m) => n + m.allowance, 0));
    const boardNames = new Map(context.boards.map((b) => [b.id, b.name]));
    const mods: ModFacts[] = [];
    for (const m of staffMods) {
      const persona = tuned.system.roster.find((p) => p.key === m.key);
      const modMemory = await db.rpc<Memory | null>('staff_memory_latest', { staff: m.key });
      const modMemoryAt = modMemory ? await db.rpc<string | null>('staff_memory_at', { staff: m.key }) : null;
      mods.push({
        key: m.key,
        name: persona?.name ?? m.key,
        pronouns: personaSet(persona?.pronouns),
        temperament: persona?.temperament ?? '',
        beats: persona?.beats ?? [],
        petRules: persona?.petRules ?? [],
        career: await db.rpc<Career>('staff_career', { of_staff: m.key }),
        notes: await db.rpc<string[]>('staff_notes_recent', {
          of_staff: m.key,
          since: modMemoryAt ? new Date(Date.parse(modMemoryAt)).toISOString() : null,
          most: settings.pool.notesRead,
        }),
        memory: modMemory,
        granted: m.granted,
        unspent: m.allowance,
        boards: m.boards.filter((id) => boardNames.has(id)).map((id) => ({ id, name: boardNames.get(id)! })),
        order: m.order,
      });
    }

    const { titles, skipped } = await readFeeds(tuned.system.feeds, fetchFeed);

    // Only the beats the database calls unlocked and unplayed reach the prompt, found in the Boss's own file; the kinds it holds back are listed nowhere.
    const beats = shownBeats(boss, context.arc);
    const heldBack = context.arc?.heldBack ?? [];
    const due = context.inheritanceDue ?? [];
    const successorAllowed = phase.phase === 'meltdown' && now >= context.season.endsAt - SUCCESSOR_WINDOW_MS;
    // A meeting within farewellWindowHours of the season's end is told to write a farewell (in character) and a handoff (out of character) and shown the facts to write it from. The window is the clock's
    // and the database's both: a database that handed over no facts (an older one, or one whose clock says otherwise) leaves the meeting outside it, and the apply holds the same line.
    const farewell = context.handoffFacts && inFarewellWindow(context.season.endsAt, now, settings.farewellWindowHours) ? { postMaxLength: settings.postMaxLength } : undefined;
    const system = meetingSystemPrompt({
      boss,
      bossPronouns: personaSet(boss.pronouns),
      system: tuned.system,
      settings,
      phase,
      bank,
      mods,
      // A name for a character a memory mentions: the digest's own names, and 'someone' for any other.
      characterName: (id) => { const c = digest.characters.find((x) => x.id === id); return c ? taggedName(c.name.slice(0, 60), c.pronouns) : 'someone'; },
      successorAllowed,
      groups: { conferred: context.groups?.conferred ?? [] },
      beats,
      heldBack,
      ...(farewell ? { farewell } : {}),
      career,
      notes: bossNotes,
      roster: tuned.system.roster.filter((b) => successors.has(b.key)).map((b) => ({ key: b.key, name: b.name, pronouns: personaSet(b.pronouns) })),
    });
    const notes = skipped.map((f) => `The feed "${f.name}" could not be read today (${f.why}).`);
    // The group each shown character is in now, by name, for the reference list: one read for the ids the list holds.
    const shown = digest.characters.filter((c) => !c.staff).slice(0, REFERENCE_MOST.characters);
    const groupOf = new Map(
      (shown.length ? await db.rpc<{ id: string; group: string }[]>('character_groups', { ids: shown.map((c) => c.id) }) : []).map((g) => [g.id.toLowerCase(), g.group]),
    );
    // The Boss's trophies (0208): the instance's list with each belt's holder now, public facts of a trophy case; no wardrobe and nobody's account.
    const bossList = (await db.rpc<{ key: string; name: string; belt: boolean; holder: { id: string; name: string } | null }[]>('boss_trophies', {})).map((t) => ({
      key: t.key, name: t.name, belt: t.belt, holder: t.holder ? t.holder.id.toLowerCase() : null, holderName: t.holder ? t.holder.name : null,
    }));
    const message = [
      renderDigest(digest, memory, titles),
      ...(due.length ? ['', ...inheritedText(due, settings.inheritanceGraceDays)] : []),
      ...(context.predecessor ? ['', ...predecessorText(context.predecessor)] : []),
      ...(farewell && context.handoffFacts ? ['', ...farewellFactsText(context.handoffFacts)] : []),
      ...(notes.length ? ['', ...notes] : []),
      '',
      referenceText({
        boards: context.boards,
        threads: digest.threads.map((t) => ({ id: t.thread, title: t.title })),
        characters: shown.map((c) => ({ id: c.id, name: c.name, pronouns: c.pronouns, group: groupOf.get(c.id.toLowerCase()) })),
        machine: context.machine,
        trophies: { boss: bossList, barred: new Set(), given: new Set() },
      }, heldBack),
      '',
      // The first part's ask closes the message, so the message is the same in every call and is the cached prefix.
      MEETING_PARTS[0].ask,
    ].join('\n');

    // One call for each part, in order, each shown the earlier answers as prior turns; a part that fails is recorded and the next still runs, shown that it was not kept.
    const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: message }];
    const merged: Record<string, unknown> = {};
    for (const [i, p] of MEETING_PARTS.entries()) {
      if (i > 0) messages.push({ role: 'user', content: p.ask });
      let shown: string;
      try {
        const answered = await models.chat({
          duty: 'meeting',
          tier: DUTY_SPECS.meeting.tier,
          staff: bossKey,
          meeting,
          system,
          messages: [...messages],
          schema: partSchema(p.key),
          rules: partRule(p.key),
          maxTokens: PART_TOKENS[p.key],
          cachePrefix: true,
        });
        // The value is the part's own fields, repaired against its rule by the model layer: that is what is kept and what the next call is shown.
        const value = answered.value !== null && typeof answered.value === 'object' ? (answered.value as Record<string, unknown>) : {};
        const own = Object.fromEntries(p.fields.filter((f) => value[f] !== undefined).map((f) => [f, value[f]]));
        Object.assign(merged, own);
        parts.push({ part: p.key, outcome: 'ok' });
        shown = JSON.stringify(own);
      } catch (e) {
        if (isInfrastructure(e)) {
          // The run stops here, but the closed row keeps the parts already run and this one as failed with its error.
          parts.push({ part: p.key, outcome: 'failed', error: said(e) });
          throw e;
        }
        // A model's TransportFailure (retries exhausted) lands here too: a failed part, and the later parts still run.
        // As the ledger writes it: a refused schema was never asked ('failed'); an answer that could not be used is 'rejected'.
        const outcome = e instanceof AnswerRejected && !(e instanceof SchemaRefused) ? 'rejected' : 'failed';
        const error = said(e);
        parts.push({ part: p.key, outcome, error });
        // The next call is shown only the start of it: an error can carry a provider's response body. The record keeps it whole.
        shown = `(this part was not kept: ${clip(error, 200)})`;
      }
      messages.push({ role: 'assistant', content: shown });
    }
    if (!parts.some((p) => p.outcome === 'ok')) {
      const first = parts[0]!;
      if (first.outcome === 'ok') throw new Error('meet: no part was kept, yet the first is ok');
      await close(first.outcome, first.error, { phase: phase.phase, feedsSkipped: skipped, parts });
      return { status: first.outcome, meeting, error: first.error };
    }
    const raw: unknown = merged;

    // The characters the answer names are checked against who is public now, not against today's digest.
    const named = namedCharacters(raw);
    const publicNow = new Set(named.length ? await db.rpc<string[]>('public_characters', { ids: named }) : []);
    // What stands for the awards the answer names: the characters no award may name (staff, retired) and the non-belt trophies already given this season.
    const awards = namedAwards(raw);
    const standing = awards.length ? await db.rpc<{ barred: string[]; given: string[] }>('trophy_award_facts', { awards }) : { barred: [], given: [] };
    const trophies: TrophyFacts = { boss: bossList, barred: new Set(standing.barred.map((x) => x.toLowerCase())), given: new Set(standing.given.map((x) => x.toLowerCase())) };
    const repaired = repairAnswer(raw, {
      settings,
      system: tuned.system,
      boss: bossKey,
      phase,
      bank,
      mods: new Set(mods.map((m) => m.key)),
      rules: context.rules ?? [],
      groups: {
        conferred: new Map((context.groups?.conferred ?? []).map((g) => [g.key, g.tone])),
        capped: new Set((context.groups?.characters ?? []).filter((x) => x.capped).map((x) => x.id.toLowerCase())),
        held: new Set((context.groups?.characters ?? []).filter((x) => x.held).map((x) => x.id.toLowerCase())),
      },
      now,
      boards: new Set(context.boards.map((b) => b.id)),
      // The threads the model was shown (the reference list is bounded), the only ones a demand may name.
      threads: new Set(digest.threads.slice(0, REFERENCE_MOST.threads).map((t) => t.thread)),
      isPublic: (id) => publicNow.has(id),
      successorAllowed,
      successors,
      inheritable: context.inheritanceDue ? new Set(due.map((m) => m.act.toLowerCase())) : undefined,
      // Only the slots the model was shown (the reference list is bounded) can be named, as with the threads.
      machine: context.machine?.slice(0, REFERENCE_MOST.machine),
      beats,
      heldBack: new Set(heldBack),
      ...(farewell ? { farewell } : {}),
      trophies: { ...trophies, boss: bossList.slice(0, REFERENCE_MOST.trophies) },
    });
    if (!repaired.ok) {
      const error = `the answer failed ${repaired.predicate} at ${repaired.path || 'the top'}`;
      await close('rejected', error, { phase: phase.phase, trims: repaired.trims, parts });
      return { status: 'rejected', meeting, error };
    }

    const trims: Trim[] = [...repaired.trims];
    const moves = repaired.moves.map((m, i) => withDescription(tuned, m, i, notes));

    const record = {
      phase: phase.phase,
      clamps: phase.clamps,
      trims,
      notes,
      feedsSkipped: skipped,
      inherited: repaired.inherited,
      successor: repaired.successor,
      // The patrols the Boss scheduled for the Mods: kept on the record for the patrol run (Task 11).
      patrols: repaired.patrols,
      // The due beats the answer left out, played with their defaults.
      beatsDefaulted: repaired.defaulted,
      // Each part's outcome: a part that was not kept left its fields out of the answer.
      parts,
    };
    const applied = await db.rpc<{ status: 'applied' | 'already applied'; queued?: number; beats_played?: string[]; bank_before?: number; bank_after?: number }>('apply_meeting', {
      meeting,
      payload: {
        boss: bossKey,
        // A part that was not kept leaves these out; the database then writes no new row (the Boss keeps yesterday's).
        ...(repaired.memory ? { memory: repaired.memory } : {}),
        ...(repaired.profile ? { profile: repaired.profile } : {}),
        moves: moves.map((m) => ({
          kind: m.kind,
          params: m.params,
          // A favor has no demand, and the key is left out rather than sent as null (the queue's column takes none or an object).
          ...(m.demand ? { demand: m.demand } : {}),
          go_live_at: new Date(m.goLiveAt).toISOString(),
          expires_in_hours: m.expiresInHours,
          why: m.why,
        })),
        // The bundles: a beat's (authored: named by its beat, at no cost, played with the bundle) and the Boss's own (at one move a part). Parts are in dependency order; a role names an earlier part.
        bundles: repaired.bundles.map((b) => ({
          name: b.name,
          beat: b.beat,
          parts: b.parts.map((p) => ({
            role: p.role,
            kind: p.kind,
            params: p.params,
            ...(p.demand ? { demand: p.demand } : {}),
            go_live_at: new Date(p.goLiveAt).toISOString(),
            expires_in_hours: p.expiresInHours,
            why: p.why,
          })),
        })),
        // The handover's two answers (the database acts on them: a nomination is queued, each inherited move kept or ended, none at the bank's cost).
        successor: repaired.successor,
        inherited: repaired.inherited,
        // The Boss's last words, in character, and its note out of character (0337): present only from a meeting within the farewell window, trimmed, and stored as a row of their own.
        ...(repaired.farewell !== null ? { farewell: repaired.farewell } : {}),
        ...(repaired.handoff !== null ? { handoff: repaired.handoff } : {}),
        // The Mods' orders: each with its beat, its line, its allowance (out of the Boss's bank, which the database charges) and its new memory.
        orders: repaired.orders.map((o) => ({ mod: o.mod, boards: o.boards, order: o.order, allowance: o.allowance, ...(o.memory ? { memory: o.memory } : {}) })),
        // The database computes the bank itself, in the transaction, from these numbers, so a delayed apply debits the true balance.
        weekly_moves: phase.numbers.weeklyMoves,
        bank_cap: phase.numbers.bankCap,
        record,
      },
    });
    if (applied.status === 'already applied') return { status: 'already applied', meeting };
    return {
      status: 'ok',
      meeting,
      boss: bossKey,
      phase: phase.phase,
      // What the database queued and played, not what the answer meant to: it skips a bundle its guard refuses, and the record it wrote says so.
      queued: applied.queued ?? moves.length + repaired.bundles.reduce((n, b) => n + b.parts.length, 0),
      beatsPlayed: applied.beats_played ?? repaired.bundles.flatMap((b) => (b.beat === null ? [] : [b.beat])),
      trims,
      notes,
      feedsSkipped: skipped,
      inherited: repaired.inherited,
      successor: repaired.successor,
      ...(applied.bank_before !== undefined ? { bankBefore: applied.bank_before, bankAfter: applied.bank_after } : {}),
    };
  } catch (e) {
    try {
      await db.rpc('fail_meeting', { meeting, outcome: 'failed', error: said(e), record: parts.length ? { parts } : {} });
    } catch {
      // The close failed too: the original error is the one that matters.
    }
    throw e;
  }
}

/** A move with its params complete: a rename keeps the Boss's own description, or takes the instance's stock one when the Boss gave none. */
function withDescription(instance: Instance, move: PlannedMove, index: number, notes: string[]): PlannedMove {
  if (move.kind !== 'renameBoard') return move;
  if (typeof move.params['description'] === 'string' && move.params['description'] !== '') return move;
  const name = String(move.params['name']);
  const lines = instance.system.stockLines.boardDescription;
  // The same name always draws the same line, so a retried meeting writes what the first would have.
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  notes.push(`moves[${index}]: the Boss gave no description; a stock description stands in.`);
  return { ...move, params: { ...move.params, description: lines[h % lines.length]!.replaceAll('{board}', name) } };
}

/**
 * Each feed's item titles, fetched by plain code with a short timeout and read with a few patterns (engine/system/feed.ts). A feed
 * that fails is skipped and said so; the titles of the rest are taken one from each in turn, up to the digest's ceiling.
 */
async function readFeeds(feeds: Instance['system']['feeds'], fetchFeed: typeof globalThis.fetch): Promise<{ titles: string[]; skipped: SkippedFeed[] }> {
  const read = await Promise.all(
    feeds.map(async (f): Promise<{ name: string; titles: string[] } | SkippedFeed> => {
      try {
        const response = await fetchFeed(f.url, { signal: AbortSignal.timeout(FEED_TIMEOUT_MS), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
        if (!response.ok) {
          await response.body?.cancel();
          return { name: f.name, why: `HTTP ${response.status}` };
        }
        return { name: f.name, titles: feedTitles(await readCapped(response, FEED_BYTES), DIGEST_MOST.feed) };
      } catch (e) {
        return { name: f.name, why: e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : 'unreachable' };
      }
    }),
  );
  const skipped = read.filter((r): r is SkippedFeed => 'why' in r);
  const lists = read.filter((r): r is { name: string; titles: string[] } => 'titles' in r).map((r) => r.titles);
  const titles: string[] = [];
  for (let i = 0; titles.length < DIGEST_MOST.feed && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && titles.length < DIGEST_MOST.feed) titles.push(l[i]!);
  }
  return { titles, skipped };
}

/** A response's body read through its stream and stopped at `max` bytes (the rest cancelled), so a huge feed cannot fill memory. */
async function readCapped(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return clip(await response.text(), max);
  const chunks: Uint8Array[] = [];
  let have = 0;
  try {
    while (have < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(have + value.length > max ? value.subarray(0, max - have) : value);
      have += chunks.at(-1)!.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(have);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}
