/**
 * End to end: cards on a spun thread's opening post (docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md, Task 8;
 * design sections 1, 5, 6 and 9). Of the plan's cases C1 to C16 only C1, C3, C5, C10 and C12 run here, as named below.
 * The path is the act function's own (supabase/functions/act/core.ts), the settlement job's core (supabase/functions/settle/core.ts)
 * and the export and import tools (tools/export-instance.mjs, tools/import-instance.mjs), against the real migrations on the
 * scratch database, with the instance's REAL cards seeded (Feelin' Fab, Last Word, Good Vibes, Main Event and Mooch).
 *
 * The day: Ann's character spins a post of Bob's, so the spun thread S opens with Ann's `spin` Act at seq 1, and Bob's
 * character replies once. Then, each through the act function:
 *   C1   Bob casts Feelin' Fab on the opening post: a card Act on the spin, in S (card_target_reach reads the target as a spin).
 *   C5   Ann sets Feelin' Fab face down on the opening post; Bob's quote of it springs the back, a cast of Ann's on the quote.
 *   C3   Ann uses Last Word on the opening post.
 *   C10  Ann uses Good Vibes, a thread Gimmick, on S: written on the opening Act, its `play_reach` row naming the thread.
 *   C12  Bob casts Main Event, a thread Move, on S: the same.
 * Then a skim: a fifth character casts Mooch on the opening post and, as the control, on Bob's reply; two players react Tomato
 * to both; the settlement pays the skim on the opening post as on the plain post, and the opening post's reactions to Ann, the
 * spinner. An admin's `reverse_card` ends Bob's Feelin' Fab (a way out), a player's is refused, and the caster's and the
 * author's `log_page` name the play and the opening post at post #1; a stranger's says none of it. The instance is exported and
 * imported again to the same forum, and the imported forum reads the plays the same.
 *
 * Stepped over, as 0001, 0027 and 0003 step over theirs: the players' wallets and hands (`wallets` and `card_ledger` are
 * written directly), and the clock. The act function writes at the wall clock, but the settlement's window opens where the files
 * before this one left the settlements (ahead of it), and the skim needs the plays inside the window's reach, so this file's
 * own Acts, reactions and threads are carried to just after the window's start, all by one distance (their order and gaps are
 * kept). Every board, account and character is this file's own, and every assertion is about its ids.
 *
 * Order: a high number, so it runs after the others (tools/test-sql.mjs sorts the files). It leaves its own committed rows
 * behind and drops the database it imports into. Reads only the scratch database tools/test-sql.mjs made (scratchUrl
 * refuses any other); run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migratedDatabase, psqlDb, sql, scratchSeed, scratchUrl } from './psql-db.ts';
import { handleAction } from '../../functions/act/core.ts';
import { runSettlement } from '../../functions/settle/core.ts';
import { instance } from '../../functions/_shared/instance.ts';

const json = <T = Record<string, any>>(text: string): T => JSON.parse(text) as T;
const row = (query: string) => json(sql(query));
const rows = (query: string) => json<Record<string, any>[]>(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (${query}) x`));

const root = path.resolve(import.meta.dirname, '../../..');
const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
/** Every table of ours and the logins beside them, each as one sorted JSON value (as 0003 reads them). */
const contents = (url: string): Map<string, string> => {
  const tables = psqlOn(url, `select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' union all select 'auth.users' union all select 'auth.identities' where to_regclass('auth.identities') is not null order by 1`).split('\n');
  return new Map(tables.map((t) => [t, psqlOn(url, `select coalesce(jsonb_agg(x order by x::text), '[]')::text from (select to_jsonb(t) x from ${t} t) s`)]));
};

const STORAGE_KEY = 'sb_secret_sErViCe-kEy-for-spun-cards';
/** The tool, run as an admin runs it; spawned, not run synchronously, so the fake Storage below answers it. The key is in its environment, never on its command line. */
const run = (tool: string, args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'tools', tool), ...args], { env: { ...process.env, KAYFABB_STORAGE_KEY: STORAGE_KEY, KAYFABB_STORAGE_TIMEOUT_MS: '2000' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
/** Supabase Storage's two object endpoints, in memory, as 0027's stand-in answers them: the project it stands for holds whatever object a row of this database names, each with bytes made of its own key. */
async function fakeStorage(serves: boolean) {
  const objects = new Map<string, Buffer>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(req.url ?? '');
      if (!m || req.headers.apikey !== STORAGE_KEY) { res.writeHead(403).end(); return; }
      const key = `${m[1]}/${decodeURIComponent(m[2]!)}`;
      if (req.method === 'GET') { res.writeHead(200).end(objects.get(key) ?? (serves ? Buffer.from(`bytes of ${key}`) : undefined)); return; }
      if (req.method === 'POST') {
        if (req.headers['x-upsert'] !== 'false') { res.writeHead(422).end(); return; }
        if (objects.has(key)) { res.writeHead(400).end('{"error":"Duplicate"}'); return; }
        objects.set(key, Buffer.concat(chunks)); res.writeHead(200).end('{}'); return;
      }
      res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, objects, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test('cards land on a spun thread\'s opening post and on the spun thread, settle as on any post, end by an admin and show in the log; the export imports again', { timeout: 590_000 }, async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  const tag = Math.random().toString(36).slice(2, 7);
  const KEYS = ['feelin-fab', 'last-word', 'good-vibes', 'main-event', 'mooch'];
  assert.equal(sql(`select count(*) from card_kinds where key in (${KEYS.map((k) => `'${k}'`).join(', ')})`), String(KEYS.length), 'the instance\'s five cards are in the catalog');

  // Where the settlements stand: this file's own window opens there (with none yet, at the first season's start, where the settlement's windows begin: a window at now() is past the ones a run settles). Its characters are older than that and than now.
  const start = sql(`select to_jsonb(coalesce(max(ends_at), (select min(starts_at) from seasons)))#>>'{}' from settlements`);
  const early = sql(`select to_jsonb(least(now(), '${start}'::timestamptz) - interval '3 days')#>>'{}'`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();

  // ---- The players: Ann spins, Bob wrote the post she spun and replies; Cat plays the skim; Rae and Sam react; Zed is a stranger; Admin ends a play. ----
  const names = ['Ann', 'Bob', 'Cat', 'Rae', 'Sam', 'Zed'] as const;
  type Who = (typeof names)[number];
  const label = (n: Who) => `Spun ${n} ${tag}`;
  const ids: Record<string, string> = json(sql(`
    with u as (insert into auth.users (email) values ${[...names, 'Admin'].map((n) => `('e2e-spun-${tag}-${n}@test.invalid')`).join(', ')} returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(split_part(email, '@', 1), '-', 4), id) from u`));
  const account = (n: Who | 'Admin') => ids[n]!;
  sql(`insert into admins (account) values ('${account('Admin')}')`);
  const chars: Record<string, string> = json(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${names.map((n) => `('${account(n)}', '${label(n)}', '${early}', '${early}')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at) select id, 'heel', '${early}' from c returning 1)
    select json_object_agg(name, id) from c`));
  const char = (n: Who) => chars[label(n)]!;
  const as = (n: Who | 'Admin') => psqlDb(account(n));
  for (const n of names) sql(`insert into wallets (account, balance) values ('${account(n)}', 100) on conflict (account) do update set balance = 100`);
  const give = (n: Who, card: string, copies = 1) => sql(`insert into card_ledger (account, card, kind, price) select '${account(n)}', '${card}', 'bought', 0 from generate_series(1, ${copies})`);
  give('Bob', 'feelin-fab'); give('Bob', 'main-event');
  give('Ann', 'feelin-fab'); give('Ann', 'last-word'); give('Ann', 'good-vibes');
  give('Cat', 'mooch', 2);

  // ---- The act path as the edge wires it. ----
  const act = (n: Who | 'Admin', body: Record<string, unknown>) => handleAction({ dbs: { player: as(n), service: db }, instance, body, send: async () => undefined, drain: async () => undefined, after: () => undefined });
  const ok = async (n: Who | 'Admin', body: Record<string, unknown>) => {
    const out = await act(n, body);
    assert.equal(out.status, 200, `${n} does ${String(body.action)}${body.card ? ` ${String(body.card)}` : ''}: ${JSON.stringify(out.body)}`);
    return out.body as Record<string, any>;
  };
  const idOf = (b: Record<string, any>): string => (b.act?.id ?? b.id) as string;
  /** A play on the opening post or on the thread: the card Act it wrote, read from the table. */
  const played = (id: string) => row(`select to_jsonb(k) from acts k where k.id = '${id}'`);

  // ---- The spin: Bob's post, and Ann's character spins it. ----
  sql(`insert into boards (slug, name, description) values ('spun-cards', '000 Spun Cards', 'Where the opening post takes its cards.') on conflict (slug) do nothing`);
  const board = sql(`select id from boards where slug = 'spun-cards'`);
  const originThread = sql(`insert into threads (board, title) values ('${board}', 'Spun cards ${tag}: the origin') returning id`);
  const originPost = (await as('Bob').rpc<{ id: string }>('post', { in_thread: originThread, through: char('Bob'), body: 'The post that is spun.' })).id;
  const spun = await ok('Ann', { action: 'spin', origin: originPost, character: char('Ann'), title: `Spun ${tag}`, body: 'Ann\'s opening post.' });
  const open = idOf(spun);
  const opening = row(`select to_jsonb(a) from acts a where a.id = '${open}'`);
  assert.deepEqual([opening.kind, opening.seq, opening.character, opening.target_act_id], ['spin', 1, char('Ann'), originPost], 'the spin is the spun thread\'s opening Act, at seq 1');
  const S: string = opening.thread;
  assert.equal(sql(`select origin_act_id from threads where id = '${S}'`), originPost, 'the spun thread has the post as its origin');
  const reply = (await as('Bob').rpc<{ id: string }>('post', { in_thread: S, through: char('Bob'), body: 'Bob replies in the spun thread.' })).id;
  assert.deepEqual([sql(`select seq from acts where id = '${reply}'`)], ['2'], 'Bob\'s reply is seq 2');

  // What the act function reads of the opening post: the target is a post as the rules see it, and its kind is the spin's.
  const read = await as('Bob').rpc<{ act: string; kind: string } | null>('card_target_reach', { reach: 'post', target: open });
  assert.deepEqual([read?.act, read?.kind], [open, 'spin'], 'card_target_reach reads the opening post as a spin');

  // ---- C1: a post card cast on the opening post by Bob's character lands. ----
  const c1 = await ok('Bob', { action: 'playCard', card: 'feelin-fab', character: char('Bob'), target: open, config: {}, message: '' });
  assert.deepEqual([played(idOf(c1)).kind, played(idOf(c1)).target_act_id, played(idOf(c1)).thread, played(idOf(c1)).character], ['card', open, S, char('Bob')], 'C1: a cast on the opening post is a card Act on it, in the spun thread');
  assert.equal(played(idOf(c1)).payload.card, 'feelin-fab');

  // ---- C5: a card set face down on the opening post by Ann's character lands; Bob's quote of the opening post springs it. ----
  const set = await ok('Ann', { action: 'setCard', card: 'feelin-fab', character: char('Ann'), target: open, config: {} });
  const setAct = played(idOf(set));
  assert.deepEqual([setAct.kind, setAct.target_act_id, setAct.thread], ['set', open, S], 'C5: the set Act is on the opening post');
  assert.equal(sql(`select post from face_down where play = '${setAct.id}'`), open, 'C5: face_down.post is the opening Act');
  const quote = await ok('Bob', { action: 'post', thread: S, character: char('Bob'), body: 'Quoting the opening post.', quote: open });
  const spring = row(`select to_jsonb(s) from acts s where s.kind = 'spring' and s.thread = '${S}' and s.payload ->> 'set' = '${setAct.id}'`);
  assert.equal(spring.target_act_id, open, 'C5: a quote of the opening post springs the back, which names the opening post');
  assert.equal(sql(`select count(*) from acts k where k.kind = 'card' and k.thread = '${S}' and k.target_act_id = '${idOf(quote)}' and k.payload ->> 'spring' = '${spring.id}' and k.payload ->> 'card' = 'feelin-fab' and k.character = '${char('Ann')}'`), '1', 'C5: the sprung card lands on the quoting post, as a cast of Ann\'s');

  // ---- C3: a post Gimmick used on the opening post by Ann's character lands. ----
  const c3 = await ok('Ann', { action: 'useCard', card: 'last-word', character: char('Ann'), target: open, config: {}, message: '' });
  assert.deepEqual([played(idOf(c3)).kind, played(idOf(c3)).target_act_id, played(idOf(c3)).thread], ['card', open, S], 'C3: a Gimmick used on the opening post lands on it');

  // ---- C10: a thread Gimmick used on S by Ann's character lands, written on the opening Act, and its reach row names the thread. ----
  const c10 = await ok('Ann', { action: 'useCard', card: 'good-vibes', character: char('Ann'), target: S, reach: 'thread', config: {}, message: '' });
  assert.deepEqual([played(idOf(c10)).kind, played(idOf(c10)).target_act_id, played(idOf(c10)).thread], ['card', open, S], 'C10: a thread Gimmick is a card Act on the opening Act');
  assert.deepEqual(rows(`select reach, thread from play_reach where play = '${idOf(c10)}'`), [{ reach: 'thread', thread: S }], 'C10: its play_reach row names the thread');

  // ---- C12: a thread Move cast on S by Bob's character lands the same way. ----
  const c12 = await ok('Bob', { action: 'playCard', card: 'main-event', character: char('Bob'), target: S, reach: 'thread', config: {}, message: '' });
  assert.deepEqual([played(idOf(c12)).kind, played(idOf(c12)).target_act_id, played(idOf(c12)).thread], ['card', open, S], 'C12: a thread Move is a card Act on the opening Act');
  assert.deepEqual(rows(`select reach, thread from play_reach where play = '${idOf(c12)}'`), [{ reach: 'thread', thread: S }], 'C12: its play_reach row names the thread');

  // ---- The skim: Cat's Mooch on the opening post and, as the control, on Bob's reply; Rae and Sam react Tomato to both. ----
  const mooch = (target: string) => ok('Cat', { action: 'playCard', card: 'mooch', character: char('Cat'), target, config: { quadrant: 'excitedNegative' }, message: '' });
  const skimOpen = idOf(await mooch(open));
  const skimReply = idOf(await mooch(reply));
  assert.equal(played(skimOpen).target_act_id, open, 'the skim is on the opening post');
  for (const target of [open, reply]) for (const n of ['Rae', 'Sam'] as const) await ok(n, { action: 'react', act: target, character: char(n), kind: 'tomato' });
  assert.equal(sql(`select count(*) from reactions where act in ('${open}', '${reply}')`), '4', 'two players reacted to each');

  // ---- The clock: this file's Acts, reactions and threads are carried to just after the window's start, by one distance. ----
  // No guard-free way exists. Moving only the reactions (as 0012 does) is not enough: settlement also reads the Mooch plays made before
  // the window and still up in it (migration 0370, skim_up: made within the card's week before window_start and ending after it). The act
  // function stamped them at the wall clock, and the window opens wherever the earlier files left the settlements, which can be past that
  // week. Only an update of the Acts' own time puts them inside it, so acts_no_update is off for this one transaction. Replica mode skips the
  // ordinary triggers but not an ALWAYS one (0001_core.sql), hence the alter; it is enabled again, as ALWAYS, before the commit (an error
  // rolls the transaction back, the trigger's state with it).
  const mine = `select a.id from acts a where a.thread in ('${S}', '${originThread}')`;
  sql(`begin;
    set local session_replication_role = replica;
    alter table acts disable trigger acts_no_update;
    do $$ declare d interval; begin
      select '${at(1)}'::timestamptz - min(created_at) into d from acts where thread in ('${S}', '${originThread}');
      update acts set created_at = created_at + d, payload = case when payload ? 'ends' then jsonb_set(payload, '{ends}', to_jsonb(to_char(((payload ->> 'ends')::timestamptz + d) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) else payload end where thread in ('${S}', '${originThread}');
      update reactions set created_at = created_at + d where act in (${mine});
      update threads set created_at = created_at + d where id in ('${S}', '${originThread}');
      -- Replica mode skipped play_post's triggers too, so each play's kept row still holds the unmoved time (play_post_drift names it, and the import's drift check refuses). This is the one writer that moves an Act's time; the rows follow it.
      perform refresh_play_post(a.id) from acts a where a.kind in ('card', 'set') and a.target_act_id is not null and a.thread in ('${S}', '${originThread}');
    end $$;
    alter table acts enable always trigger acts_no_update;
    commit;`);

  // ---- The settlement: the skim is paid on the opening post as on the plain post, and the opening post's reactions go to the spinner. ----
  // The settlement reads every character on the instance, and 0028 (the file before this one) left its fixture committed, its characters in the test
  // fixtures' classes (alpha, beta: supabase/tests/setup/fixtures.sql:47), which the instance has not. The settle engine refuses a held class the instance lacks
  // (engine/rules/settle.ts:208), so the instance this settles with is the real one plus those classes, each earning nothing: the leftover characters are in the
  // input and score nothing, and nothing of theirs is edited or removed. Any file after this one that settles must do the same.
  const held = sql(`select coalesce(string_agg(distinct class_key, ','), '') from class_history`).split(',').filter((k) => k !== '');
  const known = new Set(instance.classes.map((c) => c.key));
  const settling = { ...instance, classes: [...instance.classes, ...held.filter((k) => !known.has(k)).map((k) => ({ key: k, name: k, earn: () => [] }))] };
  const settled = await runSettlement(db, settling, at(48));
  assert.equal(settled.status, 'applied', JSON.stringify(settled));
  const skimShares = rows(`select s.act, sum(s.amount)::int as amount from ledger_shares s join ledger l on l.id = s.ledger where l.reason = 'card.skim' and l.character = '${char('Cat')}' group by s.act`);
  const skimOn = (a: string) => skimShares.find((r) => r.act === a)?.amount;
  assert.equal(skimOn(open), skimOn(reply), 'the skim on the opening post is what it is on a plain post');
  assert.ok(Number(skimOn(open)) > 0, `and it is paid: ${JSON.stringify(skimShares)}`);
  assert.equal(Number(sql(`select coalesce(sum(amount), 0) from ledger where reason = 'card.skim' and character = '${char('Cat')}'`)), Number(skimOn(open)) + Number(skimOn(reply)), 'Cat is paid the two skims and no more');
  const heat = (n: Who) => Number(sql(`select coalesce(sum(amount), 0) from ledger where reason = 'heel.drewHeat' and character = '${char(n)}'`));
  assert.equal(heat('Ann'), 40, 'two votes on the opening post are heat for Ann, who spun it, each two votes\' worth');
  assert.equal(sql(`select coalesce(sum(s.amount), 0) from ledger_shares s join ledger l on l.id = s.ledger where l.reason = 'heel.drewHeat' and l.character = '${char('Ann')}' and s.act = '${open}'`), '40', 'drawn by the opening post itself');
  assert.equal(heat('Bob'), 40, 'and two on the reply are heat for Bob, at the same rate');

  // ---- A way out: an admin ends Bob's Feelin' Fab on the opening post; a player's reversal is refused. ----
  const bobPlay = idOf(c1);
  const refusedEnd = await act('Ann', { action: 'reverseCard', play: bobPlay });
  assert.ok(refusedEnd.status >= 400 && refusedEnd.status < 500, `a player cannot reverse a card: ${JSON.stringify(refusedEnd)}`);
  assert.equal(sql(`select card_ended('${bobPlay}')::text`), 'false', 'and the play stands');
  await ok('Admin', { action: 'reverseCard', play: bobPlay });
  assert.equal(sql(`select card_ended('${bobPlay}')::text`), 'true', 'the admin\'s reversal ends the play on the opening post');
  const ended = row(`select to_jsonb(e) from acts e where e.kind = 'card_end' and e.target_act_id = '${bobPlay}'`);
  assert.equal(ended.thread, S, 'the end is in the spun thread');

  // ---- Each log says it, plainly, naming the play and post #1; a stranger's says none of it. ----
  // log_page's `acts` are rows of acts_public (snake_case keys): the play's row names its target, and the opening Act's row says its place.
  type Page = { sources: { ended: Record<string, any>[]; cards: Record<string, any>[]; playsOnMine: Record<string, any>[] }; acts: Record<string, any>[] };
  const logOf = async (n: Who) => await as(n).rpc<Page>('log_page', { in_before: null });
  const actOf = (page: Page, id: string) => page.acts.find((a) => a.id === id);
  const bob = await logOf('Bob');
  const bobEnded = bob.sources.ended.find((e) => e.play === bobPlay);
  assert.deepEqual([bobEnded?.side, bobEnded?.reach], ['cast', 'post'], 'the caster\'s log has the ended play, as his own');
  assert.equal(actOf(bob, bobPlay)?.target_act_id, open, 'the caster\'s log names the opening post as the ended play\'s target');
  assert.equal(actOf(bob, open)?.seq, 1, 'and that post is #1 of the spun thread');
  const ann = await logOf('Ann');
  const annEnded = ann.sources.ended.find((e) => e.play === bobPlay);
  assert.deepEqual([annEnded?.side, annEnded?.reach], ['onMine', 'post'], 'the author\'s log has it as ended on her post');
  assert.equal(actOf(ann, bobPlay)?.target_act_id, open, 'the author\'s log names the opening post as the ended play\'s target');
  assert.equal(actOf(ann, open)?.seq, 1, 'and that post is #1 of the spun thread');
  const onMine = (id: string) => ann.sources.playsOnMine.find((p) => p.play === id);
  assert.deepEqual([onMine(bobPlay)?.post, onMine(bobPlay)?.reach], [open, 'post'], 'the author\'s log holds the cast on her opening post');
  assert.deepEqual([onMine(idOf(c12))?.post, onMine(idOf(c12))?.reach], [open, 'thread'], 'and the thread Move on her spun thread, written on the opening post');
  assert.ok(bob.sources.cards.some((c) => c.act === bobPlay && c.kind === 'played'), 'the caster\'s log holds his own play');
  const zed = await logOf('Zed');
  assert.deepEqual([zed.sources.ended, zed.sources.playsOnMine, zed.sources.cards], [[], [], []], 'a stranger\'s log holds none of it');

  // ---- The instance, exported and imported again to the same forum, the plays on the opening post included. ----
  const from = scratchUrl();
  assert.notEqual(sql(`select count(*) from acts where kind = 'card' and target_act_id = '${open}'`), '0', 'the opening post holds plays to carry across');
  const before = contents(from);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-spun-cards-'));
  // The fresh instance: a clone of the runner's snapshot of the shim and every migration, nothing seeded.
  const home = migratedDatabase('spun_imported');
  const fresh = new URL(home.url);
  const oldStore = await fakeStorage(true);
  const newStore = await fakeStorage(false);
  try {
    const exported = await run('export-instance.mjs', ['--from', from, '--to', dir, '--storage', oldStore.url]);
    assert.equal(exported.status, 0, exported.stderr + exported.stdout);
    // A table an earlier file committed outside the migrations (0003's probe) is made in the fresh database too, as 0003 makes it.
    if (psqlOn(from, `select to_regclass('public.export_probe') is not null`) === 't') psqlOn(fresh.toString(), 'create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);');
    const imported = await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.equal(imported.status, 0, imported.stderr + imported.stdout);
    const after = contents(fresh.toString());
    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [t, rowsOf] of before) assert.equal(after.get(t), rowsOf, `${t} differs after the round trip`);
    // The imported forum reads the same: the plays on the opening post, the ended one ended, the opening post a post, and the thread plays on the thread.
    const reads = (url: string) => psqlOn(url, `select (select count(*) from acts where kind = 'card' and target_act_id = '${open}')::text || '|' || card_ended('${bobPlay}')::text || '|' || post_kind((select kind from acts where id = '${open}'))::text
      || '|' || (select count(*) from play_reach where thread = '${S}')::text || '|' || (select count(*) from face_down where post = '${open}')::text`);
    assert.equal(reads(fresh.toString()), reads(from), 'the imported forum reads the same plays on the opening post');
    assert.match(reads(from), /^\d+\|true\|true\|2\|1$/, 'and they are the ones this file made');
  } finally {
    await oldStore.close();
    await newStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
    try { home.drop(); } catch { /* the runner drops what is named for its clone */ }
  }
});
