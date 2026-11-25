/**
 * What a Mod's call reads of its standing and of the groups it may confer: `mod_standing`'s answer (`Standing`) and `mod_group_context` (`readModGroups`). Shared by the Mods' filings, reports, patrols and appeals
 * (supabase/functions/staff) and by the chatter's turns, which offer a Mod's ruling the same catalog, so the chatter does not import the staff module to read it.
 */
import type { ConferredGroup } from '../../../engine/system/meeting.ts';
import type { ModMoveContext } from '../../../engine/system/judgment.ts';
import { DatabaseError, TransportError, type Db } from './rpc.ts';
import { LedgerWriteFailed } from './models/index.ts';

/** What a Mod's call is told about groups (`mod_group_context`): the catalog for the prompt, and the same catalog and the characters no group move may name for the repair. */
export interface ModGroups {
  readonly conferred: readonly ConferredGroup[];
  readonly facts: NonNullable<ModMoveContext['groups']>;
}

/**
 * The groups a Mod's call may confer, read for a call that has a move to make (an allowance and a beat); none otherwise, so a call with nothing to spend reads nothing.
 * A read the database cannot answer costs the call its group move only: the Mod's setRule still stands.
 */
export async function readModGroups(db: Db, standing: Pick<Standing, 'allowance' | 'beat'>): Promise<ModGroups | null> {
  if (!(standing.allowance >= 1) || standing.beat.length === 0) return null;
  try {
    const read = await db.rpc<{ conferred: ConferredGroup[]; characters: { id: string; capped: boolean; held: boolean }[] }>('mod_group_context', {});
    const characters = read.characters ?? [];
    return {
      conferred: read.conferred ?? [],
      facts: {
        conferred: new Map((read.conferred ?? []).map((g) => [g.key, g.tone])),
        capped: new Set(characters.filter((c) => c.capped).map((c) => c.id.toLowerCase())),
        held: new Set(characters.filter((c) => c.held).map((c) => c.id.toLowerCase())),
      },
    };
  } catch (e) {
    if (e instanceof LedgerWriteFailed || e instanceof TransportError || !(e instanceof DatabaseError)) throw e;
    return null;
  }
}

export interface Standing {
  readonly office: string | null;
  allowance: number;
  readonly order: string | null;
  readonly beat: readonly { readonly id: string; readonly name: string }[];
}
