/**
 * The player's door to a paid judgment (the Mod Bots design, section 7): a report or an appeal. The edge of staff/index.ts for a request that is not the service's: the method,
 * the session and the size of the body are checked before any connection is made, and nothing is read or done as the service until the database, called with the player's
 * own session (`open_report`, `open_appeal`), has taken the request. A request with no session is a 401 whoever its target is. One door for both, so the rule cannot be kept
 * in one and forgotten in the other (report.ts and appeal.ts give it their words and their run).
 */
import type { Instance } from '../../../engine/rules/types.ts';
import type { Models } from '../../../engine/system/model.ts';
import type { Db } from '../_shared/rpc.ts';
import { CORS, boundedJson } from '../_shared/serve.ts';

export interface DoorAnswer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface DoorDeps {
  readonly instance: Instance;
  /** The two connections for a request: as the player (their session), and as the service. Making them reads nothing. */
  readonly dbs: (session: string) => { player: Db; service: Db };
  /** The models, built from the instance's tiers as the database holds them now (a service read): asked for only once the request has been taken as the player. */
  readonly models: (service: Db) => Promise<Models>;
}

/** What a door says in its own words: a report's or an appeal's. */
export interface DoorWords {
  /** "posted": the 405's sentence, e.g. "reports are posted". */
  readonly posted: string;
  readonly signIn: string;
  readonly tooLong: string;
  readonly failed: string;
  readonly maxBytes: number;
}

export type DoorRun = (dbs: { player: Db; service: Db }, getModels: () => Promise<Models>, instance: Instance, body: unknown) => Promise<DoorAnswer>;

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export async function playerDoor(request: Request, d: DoorDeps, run: DoorRun, words: DoorWords): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return reply(405, { error: words.posted });
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s*/i, '').trim();
  if (!session) return reply(401, { error: words.signIn });
  const { tooLong, body } = await boundedJson(request, words.maxBytes);
  if (tooLong) return reply(413, { error: words.tooLong });
  try {
    const dbs = d.dbs(session);
    const out = await run(dbs, () => d.models(dbs.service), d.instance, body);
    return reply(out.status, out.body);
  } catch (e) {
    console.error(`${words.failed} (door)`, e instanceof Error ? e.message : 'unknown');
    return reply(500, { error: words.failed });
  }
}
