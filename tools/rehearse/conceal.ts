// The rehearsal's `conceal` function: the real concealer (supabase/functions/conceal/core.ts, runConceal, with the engine's concealQuotes) against the rehearsal's database. The deployed
// function (supabase/functions/conceal/index.ts) is a Deno.serve file the dispatcher cannot import, so this is its Node twin: the same jobs-key check and the same SQL (conceal_due, record_layer).
import { runConceal, type ConcealDb, type ConcealRow } from "../../supabase/functions/conceal/core.ts";
import { environment, fromTheService, json, notTheService } from "../../supabase/functions/_shared/serve.ts";
import type { JobDeps } from "../../supabase/functions/_shared/handler.ts";

/** The most Acts one run answers, as in the deployed function. */
const MOST = 200;

export async function handle(request: Request, deps: JobDeps): Promise<Response> {
  const env = environment(deps.env);
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, "quotes are concealed by the service");
  try {
    const db = deps.db(env);
    const concealDb: ConcealDb = {
      due: (most) => db.rpc<ConcealRow[]>("conceal_due", { most }),
      record: async (act, hidden, body) => { await db.rpc("record_layer", { act, hidden, body }); },
    };
    return json(200, await runConceal({ db: concealDb, most: MOST }));
  } catch (e) {
    console.error("conceal failed", e instanceof Error ? e.message : "unknown");
    return json(500, { error: "the conceal run failed; the Acts stay due for the next run" });
  }
}
