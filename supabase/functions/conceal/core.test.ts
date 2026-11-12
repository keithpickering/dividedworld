import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConceal, STALE_HINT } from './core.ts';
import type { ConcealDb, ConcealRow } from './core.ts';
import { DatabaseError } from '../_shared/rpc.ts';

const H = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

type Recorded = { act: string; hidden: readonly string[]; body: string | null };

function fake(rows: ConcealRow[], refuse: (act: string) => Error | null = () => null) {
  const recorded: Recorded[] = [];
  const db: ConcealDb = {
    due: async (most) => rows.slice(0, most),
    record: async (act, hidden, body) => {
      const e = refuse(act);
      if (e) throw e;
      recorded.push({ act, hidden, body });
    },
  };
  return { db, recorded };
}

test('each due Act is concealed with the engine\'s parser against its own hidden set, and recorded', async () => {
  const { db, recorded } = fake([
    { act: 'a1', hidden: [H], body: `hi [quote=${H}]secret[/quote] and [quote=${S}]shown[/quote]` },
    { act: 'a2', hidden: [], body: `[quote=${H}]kept, nothing is hidden now[/quote]` },
    { act: 'a3', hidden: [S, H, H], body: `[code][quote=${H}]words[/quote][/code][quote=${S}]x[/quote]` },
  ]);
  const out = await runConceal({ db, most: 10 });
  assert.deepEqual(out, { status: 'done', due: 3, recorded: 3, stale: 0, failed: 0 });
  assert.deepEqual(recorded[0], { act: 'a1', hidden: [H], body: `hi [quote=${H}][/quote] and [quote=${S}]shown[/quote]` });
  // nothing hidden: the request is answered with an empty set and no body, never a copy of the words
  assert.deepEqual(recorded[1], { act: 'a2', hidden: [], body: null });
  // the set goes sorted and once; a quote inside code is the post's own words and stays
  assert.deepEqual(recorded[2], { act: 'a3', hidden: [H, S], body: `[code][quote=${H}]words[/quote][/code][quote=${S}][/quote]` });
});

test('the run asks for at most `most` Acts', async () => {
  const rows = Array.from({ length: 5 }, (_, i): ConcealRow => ({ act: `a${i}`, hidden: [H], body: `[quote=${H}]x[/quote]` }));
  const { db, recorded } = fake(rows);
  assert.equal((await runConceal({ db, most: 2 })).due, 2);
  assert.equal(recorded.length, 2);
});

test('a stale answer is skipped and the rest go on; another refusal is counted and logged without the body', async () => {
  const stale = new DatabaseError('stale', 'P0001', 400, 'stale', STALE_HINT);
  const bad = new DatabaseError('bad', '23514', 400, 'a check failed');
  const { db, recorded } = fake(
    [1, 2, 3].map((i) => ({ act: `a${i}`, hidden: [H], body: `[quote=${H}]SECRET${i}[/quote]` })),
    (act) => (act === 'a1' ? stale : act === 'a2' ? bad : null),
  );
  const logged: string[] = [];
  const out = await runConceal({ db, most: 10, log: (l) => logged.push(l) });
  assert.deepEqual(out, { status: 'done', due: 3, recorded: 1, stale: 1, failed: 1 });
  assert.deepEqual(recorded.map((r) => r.act), ['a3']);
  assert.equal(logged.length, 1);
  assert.ok(logged[0]?.includes('a2') && !logged[0].includes('SECRET'));
});

test('a failure that is not the database\'s answer (a transport failure that outlasted its retries) ends the run, and nothing is recorded as done', async () => {
  const { db } = fake([{ act: 'a1', hidden: [H], body: `[quote=${H}]x[/quote]` }], () => new Error('fetch failed'));
  await assert.rejects(runConceal({ db, most: 10 }), /fetch failed/);
});

test('an Act with a hidden set and no words is recorded with an empty body, not a missing one', async () => {
  const { db, recorded } = fake([{ act: 'a1', hidden: [H], body: null }]);
  await runConceal({ db, most: 1 });
  assert.deepEqual(recorded, [{ act: 'a1', hidden: [H], body: '' }]);
});
