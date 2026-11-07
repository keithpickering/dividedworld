/**
 * The plain words the glass says about a move, from the engine's catalogs and never from the Boss: the long label on a move's
 * Act, the short "WAY OUT" segment, how a landed move ended, and a move as one sentence (engine/system/moves.ts, demands.ts).
 * The fiction may lie; the log never does: what a move is called here is what the code did, in the engine's own words, and the
 * Boss's lines are quoted as its own where they appear at all.
 *
 * Pure: no clock, no screen.
 */
import { demandAsk, demandKind } from '../../system/demands.ts';
import { moveKind, type MoveNames, type MoveParts } from '../../system/moves.ts';
import { modRole } from '../cards/visit.ts';
import type { Demand, DemandProgress, MoveEnd, Office } from '../data/api.ts';
import type { UiCopy } from '../types.ts';
import { shortDate } from '../postbit/dates.ts';

/**
 * The long label of a move's Act ("The Boss renamed this board"; the glass draws it in capitals), the catalog's template filled with the
 * actor's role (`UiCopy.roleWord`, or a Mod Bot's own role word when Mod Bots move). A kind the catalog lacks is still said plainly.
 */
export const moveLabel = (kind: string, role: string): string => (moveKind(kind)?.label ?? '{role} made a move').replace('{role}', role);

/**
 * Who made a move, in the instance's words, as a sentence begins ("The Boss", "A Mod"). `office` is the one stamped on the move's Act when it landed (`payload.office`,
 * `moveOffice`), never the persona's office now: a Mod may make some of the Boss's moves, and the persona may hold another office later. `UiCopy.roleWord` is the Boss's; a Mod's is
 * `UiCopy.modRole`, else the engine's "A Mod". A move with no stamp (made before 0128, when only the Boss and the rule-setting Mods moved) is read as the Boss's.
 */
export const officeRole = (copy: Pick<UiCopy, 'roleWord' | 'modRole'>, office: Office | undefined): string => (office === 'mod' ? modRole(copy) : copy.roleWord);

/** The office stamped on a move's Act (`payload.office`), or undefined for a move from before the stamp. */
export const moveOffice = (payload: Readonly<Record<string, unknown>>): 'boss' | 'mod' | undefined => (payload['office'] === 'boss' || payload['office'] === 'mod' ? payload['office'] : undefined);

/**
 * The glass's short segment: "WAY OUT: 7 OF 12 POSTERS". A move that asks nothing ends only by its expiry or an admin; a demand
 * that could not be read (or that this build has no words for) says only that there is a way out, with the details one press away.
 */
export function wayOut(demand: Demand | null, progress: DemandProgress | null, expiresAt: string | null): string {
  const kind = demand ? demandKind(demand.kind) : undefined;
  if (kind && progress && !progress.error && progress.of > 0) return `WAY OUT: ${progress.done} OF ${progress.of} ${progress.of === 1 ? kind.unit.one : kind.unit.many}`;
  if (!demand && expiresAt) return `WAY OUT: RUNS OUT ${shortDate(expiresAt).toUpperCase()}`;
  return 'WAY OUT: DETAILS';
}

/**
 * How a landed move ended, in a few words for a moderation log: "in force", "undone: 12 posted", "ran out Oct 31", "reversed by an admin",
 * "ended at the handover" (a new Boss set it aside, or its review never came). A move a later Boss keeps says so (`keptBy`, that Boss's name).
 */
export function endedWords(end: MoveEnd | null, demand: Demand | null, keptBy?: string | null): string {
  const kept = keptBy ? `, kept by ${keptBy}` : '';
  return `${endedBase(end, demand)}${kept}`;
}

function endedBase(end: MoveEnd | null, demand: Demand | null): string {
  if (end === null) return 'in force';
  if (end.why === 'superseded') return 'ended at the handover';
  if (end.why === 'spent') return 'used up at the handover';
  if (end.why === 'unmet') return 'Stripped: the demand was not met by its check';
  if (end.why === 'overturned') return 'Ended: overturned on appeal';
  if (end.why === 'met' && demand?.kind === 'apologyAccepted') return 'Ended: an apology was accepted';
  if (end.why === 'met') {
    const met = demand ? demandKind(demand.kind)?.met(demand.params) : undefined;
    return met ? `undone: ${met}` : 'undone: its demand was met';
  }
  if (end.why === 'expired') return `ran out ${shortDate(end.at)}`;
  return end.by === 'admin' ? 'reversed by an admin' : 'reversed';
}

/** A move as one short sentence in pieces (see `MoveKind.parts`); a kind the catalog lacks is named, not guessed at. `names` fills the character, group and board a group move names. */
export function moveParts(kind: string, params: Readonly<Record<string, unknown>>, was: string | null, tense: 'done' | 'plan', names?: MoveNames): MoveParts {
  return moveKind(kind)?.parts(params, was, tense, names) ?? [`${tense === 'plan' ? 'Make' : 'Made'} a move this build has no words for (${kind})`];
}

/** What a move asks, without progress: for a move that has not landed. */
export const demandNeeds = (demand: Demand | null, kind?: string): string =>
  demand ? demandAsk(demand) : kind === 'nameSuccessor' ? 'It asks nothing: it ends at the handover, or when an admin reverses it.' : 'It asks nothing: it ends at its expiry, or when an admin reverses it.';
