/**
 * Tests for the guard in tools/check-web-reads.mjs.
 *
 *   node tools/test-web-reads.mjs
 *
 * The guard holds the web app to the public projections and the player's own rows. A read of a
 * private table (who reacted, a character's class history, who owns a mask) changes no screen a
 * test looks at; it simply puts a private fact in a browser, where any player can read it in the
 * network panel. So each way the app can name a table (`.from()`, `.rpc()`, a REST path) is
 * planted here with a private name and must fire, each allowed name must stay clean, and the last
 * case runs the guard over the real tree, so a guard that has gone quiet over nothing fails here.
 */
import { readFaults, treeFiles, ALLOWED_READS, ALLOWED_RPCS } from './check-web-reads.mjs';

let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

const DATA = 'web/src/data/supabase.ts';
const fires = (text, file = DATA) => readFaults({ [file]: text });

/* ---- the plan's poisons ---- */
{
  const r = fires(`const { data } = await client.from('reactions').select('*');`);
  check('.from(\'reactions\') fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, the line and the table', r[0]?.file === DATA && r[0]?.line === 1 && r[0]?.name === 'reactions', JSON.stringify(r));
}
check('.from(\'class_history\') fires', fires(`await client.from('class_history').select('class_key');`).length === 1);
check('.from(\'characters\').select(\'owner\') fires', fires(`await client.from('characters').select('owner');`).length === 1);

/* ---- every private table, and every way to name one ---- */
for (const t of ['characters', 'class_history', 'reactions', 'ledger', 'wallet_events', 'wallets', 'pending_turns', 'effect_state_writes', 'settings', 'invites', 'thread_reads', 'acts', 'accounts', 'card_ledger', 'estimates']) {
  check(`.from('${t}') fires`, fires(`client.from('${t}').select('*');`).length === 1);
}
check('a template literal table name fires', fires('client.from(`reactions`).select();').length === 1);
check('a table name the guard cannot read fires, since it could be anything', fires(`const t = 'reactions'; client.from(t).select();`).length === 1);
check('a schema-qualified read fires', fires(`client.schema('public').from('ledger').select();`).length === 1);
check('an rpc outside the allowlist fires', fires(`client.rpc('estimate_input', { who });`).length === 1);
check('a service-only rpc fires', fires(`client.rpc('instance_settings');`).length === 1);
check('an rpc whose name the guard cannot read fires', fires(`client.rpc(name);`).length === 1);
check('a REST path to a private table fires', fires(`fetch(url + '/rest/v1/reactions?select=*');`).length === 1);
check('a REST rpc path outside the allowlist fires', fires('fetch(`${url}/rest/v1/rpc/settlement_input`);').length === 1);
check('a write to an allowed view still names the view, and a write is not a read the guard allows', fires(`client.from('acts_public').insert({});`).length === 1);
check('an upsert, update or delete fires', fires(`client.from('reading').upsert({}); client.from('reading').update({}); client.from('reading').delete();`).length === 3);

/* ---- a Supabase client only in web/src/data/ ---- */
check('supabase-js imported in a screen fires', fires(`import { createClient } from '@supabase/supabase-js';`, 'engine/ui/thread/Thread.tsx').length === 1);
check('supabase-js imported in the web app outside its data layer fires', fires(`import { createClient } from '@supabase/supabase-js';`, 'web/src/App.tsx').length === 1);
check('supabase-js imported in an instance fires', fires(`import type { SupabaseClient } from '@supabase/supabase-js';`, 'instances/divided-world/ui/index.ts').length === 1);
check('supabase-js imported in web/src/data/ is clean', fires(`import { createClient } from '@supabase/supabase-js';`).length === 0);

/* ---- what is allowed ---- */
for (const t of ALLOWED_READS) check(`.from('${t}').select() is clean`, fires(`client.from('${t}').select('*').eq('x', 1);`).length === 0);
for (const f of ALLOWED_RPCS) check(`.rpc('${f}') is clean`, fires(`client.rpc('${f}', {});`).length === 0);
check('a REST path to an allowed view is clean', fires(`fetch(url + '/rest/v1/acts_public?select=*');`).length === 0);
check('a function call (act, account, estimate, avatar) is clean', fires(`client.functions.invoke('act', { body }); fetch(url + '/functions/v1/estimate');`).length === 0);
check('a .from() on something that is not a client chain, an Array.from, is clean', fires(`const xs = Array.from(set); const b = Buffer.from('reactions');`).length === 0);
check('a comment naming a private table is clean', fires(`// client.from('reactions')\nexport const a = 1;`).length === 0);
check('a screen file is read too, and a clean one passes', fires(`export const T = () => null;`, 'engine/ui/thread/Thread.tsx').length === 0);

/* ---- the real tree ---- */
{
  const files = treeFiles();
  const r = readFaults(files);
  check('the real tree is clean', r.length === 0, JSON.stringify(r));
}

console.log(`\n  web-reads: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-web-reads: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
