/**
 * Tests for the guard in tools/check-id-reads.mjs.
 *
 *   node tools/test-id-reads.mjs
 *
 * The guard holds every PostgREST `.in(column, list)` in web/src/data/ to a list that is a chunk of ids, or to a column
 * whose values are a fixed list. A read by id whose list a busy instance grows puts every id in one address, and once
 * that address passes a proxy's bound the page or the gap fill fails (#104). So the read #104 found is planted here
 * verbatim and must fire, each way of passing the list around a chunk must fire, the chunked shapes must stay clean,
 * and the last case runs the guard over the real tree, so a guard gone quiet over nothing fails here.
 */
import { readFaults, treeFiles, BOUNDED_IN } from './check-id-reads.mjs';

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
const faults = (text, file = DATA) => readFaults({ [file]: text });

/* ---- the poison: main's tallies read, verbatim ---- */
{
  const text = [
    '    async tallies(acts) {',
    '      const out: Record<Id, Record<string, number>> = Object.fromEntries(acts.map((a) => [a, {}]));',
    '      if (acts.length === 0) return out;',
    "      for (const r of await list(() => client.from('reaction_tallies').select('act,kind,count').in('act', [...acts]))) {",
    "        (out[r['act']] ??= {})[r['kind']] = num(r['count']);",
    '      }',
    '      return out as Readonly<Record<Id, Tally>>;',
    '    },',
  ].join('\n');
  const r = faults(text);
  check('main\'s tallies read (`.in(\'act\', [...acts])`) fires', r.length === 1, JSON.stringify(r));
  check('and it names the file, line and column', r[0]?.file === DATA && r[0]?.line === 4 && typeof r[0]?.column === 'number' && r[0].column > 1, JSON.stringify(r));
}

/* ---- lists that are not a chunk ---- */
check('`.in(\'id\', ids)` fires', faults(`await client.from('x').select('*').in('id', ids);`).length === 1);
check('`.in(col, part)` with the column a variable fires', faults(`chunks(ids).map((part) => client.from('x').select('*').in(col, part));`).length === 1);
check('a spread fires', faults(`await client.from('x').select('*').in('id', [...ids]);`).length === 1);
check('an array built in place fires', faults(`await client.from('x').select('*').in('id', [a, b]);`).length === 1);
check('a list passed through a variable first fires',
  faults(`chunks(ids).map((part) => { const list = part; return client.from('x').select('*').in('id', list); });`).length === 1);
check('the `ids` in place of `part` inside the map fires', faults(`chunks(ids).map((part) => client.from('x').select('*').in('id', ids));`).length === 1);
check('a `part` from a `.map` on something other than chunks fires', faults(`ids.map((part) => client.from('x').select('*').in('id', part));`).length === 1);
check('a `part` from a `.map` on a call other than chunks fires', faults(`slices(ids).map((part) => client.from('x').select('*').in('id', part));`).length === 1);
check('a `part` that is not the map\'s first parameter fires', faults(`chunks(ids).map((x, part) => client.from('x').select('*').in('id', part));`).length === 1);
check('a `part` shadowed by an inner function fires',
  faults(`chunks(ids).map((part) => [1].map((part) => client.from('x').select('*').in('id', part)));`).length === 1);
check('`.in` reached as `client[\'in\']` fires', faults(`chunks(ids).map((part) => client.from('x').select('*')['in']('id', ids));`).length === 1);
check('`.in` with no list fires', faults(`await client.from('x').select('*').in('id');`).length === 1);
check('a byChunks whose function takes another name for the list, given `ids`, fires', faults(`byChunks(ids, (part) => client.from('x').select('*').in('id', ids));`).length === 1);

check('`.in` taken as a value and called with `.call` fires', faults(`chunks(ids).map((part) => q.in.call(q, 'id', ids));`).length === 1);
check('`.in` taken as a value and called with `.apply` fires', faults(`q.in.apply(q, ['id', ids]);`).length === 1);
check('`.in` taken off a query by destructuring fires', faults(`const { in: f } = q; f('id', ids);`).length === 1);
check('`.in` stored in a variable fires', faults(`const f = q['in']; f('id', ids);`).length === 1);
check('a chunk parameter reassigned in its callback fires', faults(`chunks(ids).map((part) => { part = ids; return q.in('id', part); });`).length === 1);

/* A chunk's parameter used as anything but an `.in` list: renamed, reassigned, spread, defaulted or shadowed. */
check('a chunk parameter incremented fires', faults(`chunks(ids).map((part) => { part++; return q.in('id', part); });`).length === 1);
check('a chunk parameter assigned by a for-of fires', faults(`chunks(ids).map((part) => { for (part of [ids]) {} return q.in('id', part); });`).length === 1);
check('a chunk parameter assigned by destructuring fires', faults(`chunks(ids).map((part) => { [part] = [ids]; return q.in('id', part); });`).length === 1);
check('a chunk parameter declared again in the callback fires', faults(`chunks(ids).map((part) => { var part = ids; return q.in('id', part); });`).length === 1);
check('a rest parameter (the chunk, its index and the array) fires', faults(`chunks(ids).map((...part) => q.in('id', part));`).length === 1);
check('a defaulted parameter fires', faults(`chunks(ids).map((part = ids) => q.in('id', part));`).length === 1);
check('a chunk parameter used for anything else in its callback fires (the safe side)', faults(`chunks(ids).map((part) => part.length && q.in('id', part));`).length === 1);
check('a chunk parameter passed into a helper that calls `.in` fires', faults(`const by = (q, xs) => q.in('id', xs); chunks(ids).map((part) => by(q, part));`).length === 1);
/* The callback's place. */
check('a function on chunks other than map or flatMap fires', faults(`chunks(ids).forEach((part) => q.in('id', part));`).length === 1);
check('a function as map\'s second argument fires', faults(`chunks(ids).map(x, (part) => q.in('id', part));`).length === 1);
check('a function as byChunks\' first argument fires', faults(`byChunks((part) => q.in('id', part), ids);`).length === 1);
/* `.in` as a value, and the literals the guard reads. */
check('`.in` taken off a query by a quoted destructuring fires', faults(`const { 'in': f } = q;`).length === 1);
check('`.in` passed as an argument fires', faults(`run(q.in);`).length === 1);
check('`.in` read through a template key and stored fires', faults('const f = q[`in`];').length === 1);
check('a property named in that is not a query\'s still fires (the safe side)', faults(`const n = cfg.in ?? 1;`).length === 1);
check('a template-literal column not in BOUNDED_IN fires', faults('q.in(`id`, ids);').length === 1);
check('a template-literal kind column is clean', faults('q.in(`kind`, kinds);').length === 0);
check('a `.tsx` file in the data layer is read', faults(`q.in('id', ids);`, 'web/src/data/Provider.tsx').length === 1);
check('an `.mjs` file in the data layer is read', faults(`q.in('id', ids);`, 'web/src/data/x.mjs').length === 1);
check('a call reached through a parenthesized callee is still read', faults(`(q.in)('id', ids);`).length === 1);

/* ---- chunked and bounded shapes are clean ---- */
check('`chunks(ids).map((part) => …in(\'id\', part))` is clean', faults(`await Promise.all(chunks(ids).map((part) => client.from('x').select('*').in('id', part)));`).length === 0);
check('`.flatMap` on chunks is clean', faults(`chunks(ids).flatMap((part) => client.from('x').select('*').in('id', part));`).length === 0);
check('a function expression on chunks is clean', faults(`chunks(ids).map(function (part) { return client.from('x').select('*').in('id', part); });`).length === 0);
check('`byChunks(ids, (part) => …in(\'id\', part))` is clean', faults(`await byChunks(ids, (part) => list(() => client.from('x').select('*').in('id', part)));`).length === 0);
check('a chunk read through a cast or parentheses is clean', faults(`byChunks(ids, (part) => client.from('x').select('*').in('id', (part as string[])));`).length === 0);
check('`.in(\'kind\', [...kinds])` is clean, kind being in BOUNDED_IN', faults(`await client.from('acts_public').select('*').in('kind', [...kinds]);`).length === 0);
check('BOUNDED_IN holds only kind, with its bound stated',
  BOUNDED_IN.length === 1 && BOUNDED_IN[0]?.column === 'kind' && typeof BOUNDED_IN[0]?.bound === 'string' && BOUNDED_IN[0].bound.length > 10 && Object.isFrozen(BOUNDED_IN), JSON.stringify(BOUNDED_IN));
check('a `.not(\'kind\', \'in\', …)` filter is not an `.in()` read', faults(`await client.from('x').select('*').not('kind', 'in', '(edit,card)');`).length === 0);
check('an `in` that is not a call is not read', faults(`const ok = 'id' in row;`).length === 0);

check('a parenthesized `.in` called in a chunk is clean', faults(`chunks(ids).map((part) => (q.in)('id', part));`).length === 0);
check('a cast `.in` called in a chunk is clean', faults(`chunks(ids).map((part) => (q.in as F)('id', part));`).length === 0);
check('a parenthesized callback on chunks is clean', faults(`chunks(ids).map(((part) => q.in('id', part)));`).length === 0);
check('a parenthesized chunks is clean', faults(`(chunks)(ids).map((part) => q.in('id', part));`).length === 0);
check('a chunk read through satisfies is clean', faults(`byChunks(ids, (part) => q.in('id', part satisfies string[]));`).length === 0);
check('a chunk used as the list of two reads in its callback is clean', faults(`byChunks(ids, (part) => Promise.all([q.in('id', part), r.in('act', part)]));`).length === 0);
check('chunks and byChunks named through an object fire (only the bare helpers are read)', faults(`u.chunks(ids).map((part) => q.in('id', part)); h.byChunks(ids, (part) => q.in('id', part));`).length === 2);

/* ---- what is read ---- */
check('a test file is not read', faults(`await client.from('x').select('*').in('id', ids);`, 'web/src/data/supabase.test.tsx').length === 0);
check('a file outside web/src/data is not read', faults(`await client.from('x').select('*').in('id', ids);`, 'engine/ui/data/fake.ts').length === 0);

/* ---- the real tree ---- */
{
  const files = treeFiles();
  const names = Object.keys(files);
  check('the tree read holds web/src/data/supabase.ts and no test file', names.includes(DATA) && !names.some((f) => /\.test\./.test(f)), JSON.stringify(names));
  const r = readFaults(files);
  check('the real tree reads clean', r.length === 0, JSON.stringify(r));
  const count = readFaults.count(files);
  check('and the guard counted more than zero `.in()` reads in it', count > 0, String(count));
}

console.log(`\n  ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
