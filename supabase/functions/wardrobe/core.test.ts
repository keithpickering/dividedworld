import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWardrobe } from './core.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';

const me = '11111111-1111-4111-8111-111111111111';
const character = '22222222-2222-4222-8222-222222222222';
const award = '33333333-3333-4333-8333-333333333333';
const piece = { gear: 'mustache', x: 0.5, y: 0.5, w: 0.4, turn: 0, layer: 0 };

function world(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const db = (who: string): Db => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push(`${who}:${fn}:${JSON.stringify(args)}`);
    const a = answers[fn];
    if (a instanceof Error) throw a;
    return a as T;
  } });
  return { dbs: { player: db('player'), service: db('service') }, calls };
}

test('an outfit is saved as the service for the account whoami() names, and the answer is the function\'s', async () => {
  const w = world({ whoami: me, set_outfit: { worn: 1 } });
  assert.deepEqual(await runWardrobe(w.dbs, { action: 'setOutfit', character, pieces: [piece] }), { status: 200, body: { worn: 1 } });
  assert.deepEqual(w.calls, ['player:whoami:{}', `service:set_outfit:${JSON.stringify({ who: me, through: character, pieces: [piece] })}`]);
});

test('the shown trophies are saved the same way, and a roll answers its event, or null under `event`', async () => {
  const s = world({ whoami: me, show_trophies: { shown: 1 } });
  assert.deepEqual(await runWardrobe(s.dbs, { action: 'showTrophies', character, awards: [award] }), { status: 200, body: { shown: 1 } });
  assert.deepEqual(s.calls[1], `service:show_trophies:${JSON.stringify({ who: me, through: character, awards: [award] })}`);
  const found = { event: 'found', outcome: 'gear', item: 'mustache', rarity: 'common', line: 'You found a mustache.', character };
  const r = world({ whoami: me, random_event: found });
  assert.deepEqual(await runWardrobe(r.dbs, { action: 'randomEvent', character }), { status: 200, body: { event: found } });
  const none = world({ whoami: me, random_event: null });
  assert.deepEqual(await runWardrobe(none.dbs, { action: 'randomEvent', character }), { status: 200, body: { event: null } });
});

test('a character the caller does not play is refused in the database\'s words, whoever plays it', async () => {
  const refusal = new DatabaseError('set_outfit: you do not play that character', '42501', 403, 'you do not play that character', 'kayfabb.refusal');
  const w = world({ whoami: me, set_outfit: refusal, show_trophies: refusal, random_event: refusal });
  for (const req of [{ action: 'setOutfit', character, pieces: [] }, { action: 'showTrophies', character, awards: [] }, { action: 'randomEvent', character }] as const) {
    assert.deepEqual(await runWardrobe(w.dbs, req), { status: 403, body: { error: 'you do not play that character' } }, req.action);
  }
});

test('a session the database does not take is nobody: 401 at whoami(), and nothing is called as the service', async () => {
  for (const whoami of [null, new DatabaseError('whoami: JWSError', 'PGRST301', 401)]) {
    const w = world({ whoami });
    const out = await runWardrobe(w.dbs, { action: 'setOutfit', character, pieces: [piece] });
    assert.equal(out.status, 401);
    assert.deepEqual(w.calls.map((c) => c.split(':').slice(0, 2).join(':')), ['player:whoami']);
  }
  /* The words are the same whatever was asked. */
  for (const req of [{ action: 'setOutfit', character, pieces: [] }, { action: 'showTrophies', character, awards: [] }, { action: 'randomEvent', character }] as const) {
    assert.deepEqual(await runWardrobe(world({ whoami: null }).dbs, req), { status: 401, body: { error: 'sign in first' } }, req.action);
  }
});

test('a request that is not well formed is refused before anything is called', async () => {
  const w = world({ whoami: me });
  assert.deepEqual(await runWardrobe(w.dbs, { action: 'setOutfit', character: 'x', pieces: [] }), { status: 400, body: { field: 'character', error: 'is not an id' } });
  assert.deepEqual(await runWardrobe(w.dbs, { action: 'setOutfit', character, pieces: 'hat' }), { status: 400, body: { field: 'pieces', error: 'an outfit is a list of pieces' } });
  assert.equal((await runWardrobe(w.dbs, { action: 'showTrophies', character, awards: ['x'] })).status, 400);
  assert.equal((await runWardrobe(w.dbs, { action: 'nothing' } as never)).status, 400);
  assert.equal(w.calls.length, 0);
});

test('a lost answer says it may have gone through; any other failure is plain and leaks nothing', async () => {
  const lost = world({ whoami: me, random_event: new TransportError('random_event: no answer') });
  assert.equal((await runWardrobe(lost.dbs, { action: 'randomEvent', character })).status, 503);
  const broken = world({ whoami: me, set_outfit: new DatabaseError('set_outfit: deadlock detected, row 9', '40P01', 500) });
  assert.deepEqual(await runWardrobe(broken.dbs, { action: 'setOutfit', character, pieces: [] }), { status: 500, body: { error: 'that could not be saved; try again' } });
});
