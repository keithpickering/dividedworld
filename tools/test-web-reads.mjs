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
import { readFaults, treeFiles, ALLOWED_READS, ALLOWED_RPCS, ALLOWED_COUNTS } from './check-web-reads.mjs';

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

/* ---- ways round the property form ---- */
check('element access .from fires', fires(`client['from']('reactions').select();`).length === 1);
check('element access .rpc fires', fires(`client['rpc']('x');`).length === 1);
check('element access .schema fires', fires(`const s = client['schema']('public');`).length === 1);
check('destructuring from off a client fires', fires(`const { from } = client; from('reactions');`).length >= 1);
check('destructuring rpc off a client fires', fires(`const { rpc } = client;`).length >= 1);
check('a bound from fires', fires(`const f = client.from.bind(client);`).length >= 1);
check('rpc read without a call fires', fires(`const r = client.rpc;`).length >= 1);
check('a .from() result kept in a variable fires', fires(`const q = client.from('reading'); q.insert({});`).length >= 1);
check('a .from() result returned fires', fires(`const q = () => client.from('reading');`).length >= 1);
check('a .from() followed by a read method is clean', fires(`client.from('reading').select('*').eq('a', 1).order('b').limit(3);`).length === 0);
check('a parenthesized cast chain write fires', fires(`(client.from('reading') as any).upsert({});`).length >= 1);
check('a non-null chain write fires', fires(`client.from('reading')!.upsert({});`).length >= 1);
check('a satisfies chain write fires', fires(`(client.from('reading') satisfies unknown).delete();`).length >= 1);
check('a cast client fires on a private table', fires(`(client as any).from('reactions').select();`).length === 1);
check('a REST path built in pieces fires', fires(`const base = url + '/rest/v1/'; fetch(base + name);`).length === 1);
check('a REST path ending at /rest/v1 fires', fires(`const base = url + '/rest/v1';`).length === 1);
check('a REST rpc prefix fires', fires('const base = `${url}/rest/v1/rpc/`;').length === 1);
check('a dynamic import of supabase-js outside the data layer fires', fires(`const m = await import('@supabase/supabase-js');`, 'web/src/App.tsx').length === 1);
check('a require of supabase-js outside the data layer fires', fires(`const m = require('@supabase/supabase-js');`, 'web/src/App.tsx').length === 1);
check('a dynamic import of supabase-js in the data layer is clean', fires(`const m = await import('@supabase/supabase-js');`).length === 0);
check('an export from supabase-js outside the data layer fires', fires(`export { createClient } from '@supabase/supabase-js';`, 'web/src/App.tsx').length === 1);
check('an export from supabase-js in the data layer is clean', fires(`export { createClient } from '@supabase/supabase-js';`).length === 0);
check('the public avatars bucket is clean', fires(`client.storage.from('avatars').getPublicUrl(p);`).length === 0);
check('any other bucket fires', fires(`client.storage.from('private').download(p);`).length === 1);
check('a bucket the guard cannot read fires', fires(`client.storage.from(b).download(p);`).length === 1);
check('globalThis.Array.from is clean', fires(`globalThis.Array.from(x);`).length === 0);
check('window.Array.from is clean', fires(`window.Array.from(x);`).length === 0);
for (const n of ['Array', 'Buffer', 'Object', 'Uint8Array', 'Set', 'Map']) {
  check(`${n}.from(x) is clean`, fires(`${n}.from(x);`).length === 0);
}
check('a screen in TSX with JSX is parsed, and a read in it fires', fires(`export const T = () => { client.from('reactions').select(); return <div className="a">{x}</div>; };`, 'engine/ui/thread/Thread.tsx').length === 1);
check('a TSX file with JSX and no read is clean', fires(`export const T = () => <p>{xs.map((x) => <i key={x}>{x}</i>)}</p>;`, 'engine/ui/thread/Thread.tsx').length === 0);

/* ---- a count of rows is work per view that grows with the table ---- */
{
  const poison = `await client.from('acts_public').select('*', { count: 'exact' }).eq('character', id).range(0, 19);`;
  const r = fires(poison);
  check('{ count: \'exact\' } on characterActs\' read fires', r.length === 1 && r[0]?.name === 'acts_public' && r[0]?.line === 1, JSON.stringify(r));
  check('and says why', /grows with the table/.test(r[0]?.why ?? ''), JSON.stringify(r));
}
check('a head count fires', fires(`await client.from('thread_list').select('id', { count: 'exact', head: true }).eq('board', b);`).length === 1);
check("count: 'planned' fires", fires(`client.from('thread_list').select('*', { count: 'planned' });`).length === 1);
check("count: 'estimated' fires", fires(`client.from('thread_list').select('*', { count: 'estimated' });`).length === 1);
check('a quoted option name fires', fires(`client.from('thread_list').select('*', { 'count': 'exact' });`).length === 1);
check('a count in a screen file fires', fires(`client.from('thread_list').select('*', { count: 'exact' });`, 'engine/ui/board/Board.tsx').length === 1);
check('a count whose kind is a variable fires', fires(`client.from('thread_list').select('*', { count: kind });`).length === 1);
check('a shorthand count fires', fires(`const count = 'exact'; client.from('thread_list').select('*', { count });`).length === 1);
check('select options the guard cannot read fire', fires(`client.from('thread_list').select('*', options);`).length === 1);
check('a spread in select options fires', fires(`client.from('thread_list').select('*', { ...options });`).length === 1);
check('a computed option name fires', fires(`client.from('thread_list').select('*', { [k]: 'exact' });`).length === 1);
check('a count through a cast and parentheses fires', fires(`(client.from('thread_list') as any).select('*', ({ count: 'exact' }) as any);`).length === 1);
check('a select with other options (head alone) is clean', fires(`client.from('thread_list').select('id', { head: true });`).length === 0);
check('a select with no options is clean', fires(`client.from('thread_list').select('*').eq('board', b).range(0, 9);`).length === 0);
{
  const allowed = [{ table: 'standings', count: 'estimated', why: 'a pager that only needs the order of magnitude' }];
  const read = (kind, table = 'standings') => `client.from('${table}').select('*', { count: '${kind}' });`;
  check('an allowlisted count (the table and the kind) is clean', readFaults({ [DATA]: read('estimated') }, allowed).length === 0);
  check('the same table with another kind of count fires', readFaults({ [DATA]: read('exact') }, allowed).length === 1);
  check('the same kind on another table fires', readFaults({ [DATA]: read('estimated', 'thread_list') }, allowed).length === 1);
}
check('every read allowed to count says why, and the list holds no count that has no reason', ALLOWED_COUNTS.every((a) => typeof a.why === 'string' && a.why.trim().length >= 20 && ['exact', 'planned', 'estimated'].includes(a.count) && ALLOWED_READS.includes(a.table)), JSON.stringify(ALLOWED_COUNTS));

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
