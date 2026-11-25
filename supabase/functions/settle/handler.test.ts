import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { DEFAULT_ROSTER_COPY } from '../../../engine/system/roster.ts';
import type { JobDeps } from '../_shared/handler.ts';
import { KEY, SLOT, TIERS, fakeDeps, post, refusals } from '../_shared/handler-test-kit.ts';

test('settle: the refusals', () => refusals(handle, 'until', 'the settlement is run by the service'));

test('settle: a good request settles on deps.db and delivers through deps.broadcaster', async () => {
  const made: { url: string; key: string; fetch: unknown }[] = [];
  const delivered: unknown[][] = [];
  let waiting = true;
  const d = fakeDeps((fn) => {
    switch (fn) {
      case 'next_settlement_window': return null;
      case 'due_broadcasts': { if (!waiting) return []; waiting = false; return [{ id: 'b1', topic: 'thread:1', event: 'post', payload: { n: 1 } }]; }
      case 'broadcasts_sent': return null;
      case 'roster_due': return [];
      default: throw new Error(`the fake database has no ${fn}`);
    }
  }, {
    broadcaster: ((o: { url: string; key: string; fetch?: unknown }) => { made.push({ url: o.url, key: o.key, fetch: o.fetch }); return { deliver: async (m: unknown[]) => { delivered.push(m); return 'sent'; }, send: async () => true }; }) as unknown as JobDeps['broadcaster'],
  });
  const res = await handle(post({ until: SLOT }), d.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'nothing to settle', until: SLOT });
  assert.equal(d.dbs.length, 1);
  assert.equal(d.dbs[0]!.env.secret, KEY);
  assert.equal(made.length, 1);
  assert.deepEqual({ url: made[0]!.url, key: made[0]!.key }, { url: 'http://db.test', key: KEY });
  assert.equal(made[0]!.fetch, d.deps.fetch, 'the broadcaster sends through deps.fetch');
  assert.deepEqual(delivered, [[{ topic: 'thread:1', event: 'post', payload: { n: 1 } }]]);
  assert.ok(d.calls.some((c) => c.fn === 'next_settlement_window' && c.args.until === SLOT));
});

test('settle: a throw is a 500 naming the window and nothing else', async () => {
  const d = fakeDeps((fn) => { if (fn === 'next_settlement_window') throw new Error('secret detail'); return null; });
  const res = await handle(post({ until: SLOT }), d.deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'the settlement failed; the window stays unsettled for the next run', until: SLOT });
});

test('settle: the Roster Report\'s models are built from the tiers the database holds, through deps.models, only when an entry has something to report; a failing roster is no 500', async () => {
  const end = '2026-11-02T08:17:00.000Z';
  const d = fakeDeps((fn) => {
    switch (fn) {
      case 'next_settlement_window': return null;
      case 'due_broadcasts': return [];
      case 'roster_due': return [end];
      case 'roster_facts': return { window: { start: '2026-11-01T08:17:00.000Z', end }, season: 1, newcomers: [{ character: 'c1', name: 'Fresh', act: 'a1', thread: 't1', seq: 1 }], announced: [], landed: [], reveals: [] };
      case 'current_boss': return dividedWorld.system.firstBoss;
      case 'write_roster_entry': return { written: true, posts: 1 };
      default: throw new Error(`the fake database has no ${fn}`);
    }
  }, { broadcaster: (() => ({ deliver: async () => 'sent', send: async () => true })) as unknown as JobDeps['broadcaster'] });
  const res = await handle(post({ until: SLOT }), d.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'nothing to settle', until: SLOT }, 'the answer says nothing of the roster');
  // The model is asked (the fake models refuse a chat, which is a failed commentary and the stock heading): built once, with the database's tiers.
  assert.equal(d.built.length, 1);
  assert.deepEqual(d.built[0]!.options.tiers, TIERS);
  assert.equal(d.built[0]!.options.fetch, d.deps.fetch);
  const written = d.calls.find((c) => c.fn === 'write_roster_entry')!;
  assert.equal(written.args.window_end, end);
  assert.match((written.args.record as { commentaryFailed: string }).commentaryFailed, /fake models/);
});

test('settle: the instance\'s roster headings reach the run (rosterCopyOf(instance.system) is roster.copy)', async () => {
  const end = '2026-11-02T08:17:00.000Z';
  const d = fakeDeps((fn) => {
    switch (fn) {
      case 'next_settlement_window': return null;
      case 'due_broadcasts': return [];
      case 'roster_due': return [end];
      case 'roster_facts': return { window: { start: '2026-11-01T08:17:00.000Z', end }, season: 1, newcomers: [{ character: 'c1', name: 'Fresh', act: 'a1', thread: 't1', seq: 1 }], announced: [], landed: [], reveals: [] };
      case 'current_boss': return dividedWorld.system.firstBoss;
      case 'write_roster_entry': return { written: true, posts: 1 };
      default: throw new Error(`the fake database has no ${fn}`);
    }
  }, { broadcaster: (() => ({ deliver: async () => 'sent', send: async () => true })) as unknown as JobDeps['broadcaster'] });
  // Divided World's headings equal the engine's defaults, so the defaults are made different for this test (and put back): the report's bodies carry the instance's words only if the handler passes rosterCopyOf(instance.system).
  const words = dividedWorld.system;
  const saved = { stock: DEFAULT_ROSTER_COPY.stockHeading, headings: { ...DEFAULT_ROSTER_COPY.headings } };
  DEFAULT_ROSTER_COPY.stockHeading = 'ENGINE DEFAULT STOCK';
  for (const k of Object.keys(DEFAULT_ROSTER_COPY.headings) as (keyof typeof saved.headings)[]) DEFAULT_ROSTER_COPY.headings[k] = `ENGINE DEFAULT ${k}`;
  let bodies: string;
  try {
    assert.equal((await handle(post({ until: SLOT }), d.deps)).status, 200);
    bodies = (d.calls.find((c) => c.fn === 'write_roster_entry')!.args.bodies as string[]).join('\n');
  } finally {
    DEFAULT_ROSTER_COPY.stockHeading = saved.stock;
    Object.assign(DEFAULT_ROSTER_COPY.headings, saved.headings);
  }
  assert.ok(bodies.includes(words.rosterStockHeading), `the instance's stock heading is the report's: ${bodies}`);
  assert.ok(bodies.includes(words.rosterHeadings.newcomers), `the instance's newcomers heading is the report's: ${bodies}`);
  assert.ok(!bodies.includes('ENGINE DEFAULT'), `the engine's defaults are not: ${bodies}`);
});

test('settle: with no entry due, no model is built', async () => {
  const d = fakeDeps((fn) => (fn === 'next_settlement_window' ? null : fn === 'due_broadcasts' ? [] : fn === 'roster_due' ? [] : (() => { throw new Error(`the fake database has no ${fn}`); })()), { broadcaster: (() => ({ deliver: async () => 'sent', send: async () => true })) as unknown as JobDeps['broadcaster'] });
  const res = await handle(post({ until: SLOT }), d.deps);
  assert.equal(res.status, 200);
  assert.equal(d.built.length, 0);
});
