/**
 * The concealer, as a pure module: read the Acts that quote a post an admin hid (and so have a request for a layer open), empty the contents of those quotes with the
 * engine's own parser (engine/bbcode/conceal.ts, the one reading of BBCode), and record the result as the Act's layer. supabase/functions/conceal/index.ts is the thin Edge
 * Function around it; this file is what Node tests (core.test.ts) and Deno both run.
 *
 * The database side is the SQL functions `conceal_due(most)` (the Acts with an open request, each with the ids of the hidden posts it quotes now and its own words) and
 * `record_layer(act, hidden, body)`, which refuses a hidden set that is no longer the current one (hint `kayfabb.conceal_stale`): a decision that landed after the read leaves its
 * own request open, so the Act is listed again with the new set, and a stale layer is never stored. Nothing here edits an Act ("The System acts; it never destroys what a player wrote").
 *
 * A transport failure is retried by the database client on the request itself (supabase/functions/_shared/rpc.ts) and, outlasting that, throws: the run ends and everything stays due for
 * the next. A refusal the database gives about one Act (a DatabaseError) is counted and logged, and the rest go on, so one Act cannot stand in front of the others.
 *
 * No vendor client is imported ("Portable by construction"): the database is an interface the edge supplies.
 */
import { concealQuotes } from '../../../engine/bbcode/conceal.ts';
import { DatabaseError } from '../_shared/rpc.ts';

/** The hint `record_layer` raises with when the hidden set it was given is not the current one (0318). */
export const STALE_HINT = 'kayfabb.conceal_stale';

/** One Act that is due (what the SQL `conceal_due(most)` returns). */
export interface ConcealRow {
  readonly act: string;
  /** The ids of the quoted posts, among those the Act's body names, that have a hidden version now: sorted, each once. */
  readonly hidden: readonly string[];
  /** The Act's own words, as written; null for an Act with none. */
  readonly body: string | null;
}

export interface ConcealDb {
  /** At most `most` Acts with an open request, oldest first. */
  due(most: number): Promise<readonly ConcealRow[]>;
  /** Stores the layer: `body` with the contents of the quotes of the `hidden` posts emptied (null when `hidden` is empty). Throws a DatabaseError with STALE_HINT when `hidden` is not current. */
  record(act: string, hidden: readonly string[], body: string | null): Promise<void>;
}

export interface ConcealDeps {
  readonly db: ConcealDb;
  readonly most: number;
  /** For a log line about an Act the database refused; defaults to console.error. Never given a body. */
  readonly log?: (line: string) => void;
}

export interface ConcealOutcome {
  readonly status: 'done';
  readonly due: number;
  readonly recorded: number;
  /** Acts whose hidden set changed under the job; each is listed again by its own new request. */
  readonly stale: number;
  /** Acts the database refused for another reason. */
  readonly failed: number;
}

export async function runConceal(deps: ConcealDeps): Promise<ConcealOutcome> {
  const log = deps.log ?? ((line: string) => console.error(line));
  const rows = await deps.db.due(deps.most);
  let recorded = 0;
  let stale = 0;
  let failed = 0;
  for (const row of rows) {
    const hidden = [...new Set(row.hidden)].sort();
    // With nothing hidden among the Act's quotes there is no layer to make: the answer only closes the request.
    const body = hidden.length === 0 ? null : concealQuotes(row.body ?? '', new Set(hidden));
    try {
      await deps.db.record(row.act, hidden, body);
      recorded++;
    } catch (e) {
      if (!(e instanceof DatabaseError)) throw e;
      if (e.hint === STALE_HINT) { stale++; continue; }
      failed++;
      log(`conceal: the database refused the layer of ${row.act}: ${e.code} ${e.reason.slice(0, 200)}`);
    }
  }
  return { status: 'done', due: rows.length, recorded, stale, failed };
}
