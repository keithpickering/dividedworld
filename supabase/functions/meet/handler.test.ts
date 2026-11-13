import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { KEY, SLOT, TIERS, fakeDeps, post, refusals } from '../_shared/handler-test-kit.ts';

test('meet: the refusals', () => refusals(handle, 'slot', 'the meeting is run by the service'));

test('meet: a good request runs the meeting on the database deps.db made, with models built with the tiers the database holds, and reads feeds through deps.fetch', async () => {
  const fetched: string[] = [];
  const d = fakeDeps((fn) => {
    switch (fn) {
      case 'begin_meeting': return { status: 'begun', meeting: 7 };
      case 'fail_meeting': return { status: 'closed' };
      case 'meeting_context': return { season: { startsAt: Date.now() - 1e9, endsAt: Date.now() + 1e10 }, boss: dividedWorld.system.firstBoss, lastSlot: null, boards: [], successors: [] };
      case 'system_digest': return { since: SLOT, until: SLOT, threads: [], boards: [], boardDays: 21, standings: [], moves: [], quotes: [], bossReactions: [], excerpts: [], characters: [] };
      case 'staff_memory_latest': return null;
      case 'staff_career': return { led: [], offices: [] };
      case 'staff_notes_recent': return [];
      case 'bank_now': return 5;
      case 'boss_trophies': return [];
      default: throw new Error(`the fake database has no ${fn}`);
    }
  }, { fetch: (async (url: unknown) => { fetched.push(String(url)); throw new Error('feed down'); }) as typeof fetch });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 200);
  // The fake models fail the chat: the meeting closes failed, answered 200 with the outcome, as the deployed function does.
  assert.equal(((await res.json()) as { status: string }).status, 'failed');
  assert.equal(d.dbs.length, 1);
  assert.equal(d.dbs[0]!.env.url, 'http://db.test');
  assert.equal(d.dbs[0]!.env.secret, KEY);
  assert.equal(d.dbs[0]!.safeToRepeat, undefined, 'the meeting asks for the default client');
  assert.equal(d.built.length, 1);
  assert.equal(d.built[0]!.read('SUPABASE_URL'), 'http://db.test', 'the models read their keys through deps.env');
  assert.deepEqual(d.built[0]!.options.tiers, TIERS);
  assert.equal(d.built[0]!.options.fetch, d.deps.fetch);
  assert.ok(d.calls.some((c) => c.fn === 'begin_meeting' && c.args.slot === SLOT));
  assert.ok(fetched.length > 0);
  assert.deepEqual(fetched, dividedWorld.system.feeds.map((f) => f.url), 'the feeds are read through deps.fetch');
});

test('meet: a throw is a 500 naming the slot and nothing else', async () => {
  const d = fakeDeps((fn) => { if (fn === 'begin_meeting') throw new Error('secret detail'); return null; });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'the meeting failed and was closed as failed', slot: SLOT });
});
