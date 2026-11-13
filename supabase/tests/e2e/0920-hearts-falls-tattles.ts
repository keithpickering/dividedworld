/**
 * End to end: a day of hearts, a fall and a tattle (the card notes, Part 5; docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 10), across the act function's own path
 * (supabase/functions/act/core.ts: the engine's refusals and the play), the filing and appeal runs (supabase/functions/staff/{core,appeal}.ts), the patrol run
 * (supabase/functions/staff/patrol.ts) and the export and import tools (tools/export-instance.mjs, tools/import-instance.mjs), against the real migrations on the scratch
 * database, the instance's REAL cards seeded (Happy Heart, Super Happy Heart, Ultra Happy Heart, Take the Fall and Tattle-Tale) and the real model adapters over a fake `fetch`.
 *
 * The day: a post breaks a rule and a visit opens; the author's own fall on it is refused, a second character casts Take the Fall on it, and a third's second fall is refused as the stack's;
 * the filing run files it and the points are on the caster, none on the author, the post keeping its notice; the caster appeals (the author cannot). A third character plays Happy
 * Heart on the caster (2 off), then Super Happy Heart (the rest): the bar after each; a heart on an empty bar is refused. A full bar bans the caster; an Ultra on a character not banned
 * is refused; another mask of the caster's own account plays Ultra Happy Heart on it, and it posts again. A Tattle-Tale lands on it (a second is refused) and a patrol with a seeded pool
 * samples, the fake judge finding nothing. After each refusal the caster's hand and wallet are as they were. Each player's own log says what the day did to them (`log_page`), a
 * stranger's says none of it, and the instance's export imports again to the same forum, `warn_reliefs` and `ban_lifts` included.
 *
 * What the patrol step proves: the patrol run asked `patrol_sample` for the patrol's pool (`modBots.patrolPool`) with the patrol's id as the seed; the sample the patrol recorded is the
 * function's own draw for that pool and seed (the same call, asked again); and the draw reads the weight, shown by drawing over 300 seeds with the watch up and counting how often the
 * watched character's two posts are drawn against how often the others' are. What it does not prove: that one particular seed draws the watched character (a draw is a chance), nor that
 * the fake judge's "nothing found" says anything of a weight; and the weight itself is public plays only, so nothing here reads an owner.
 *
 * Stepped over, as 0012, 0015 and 0017 step over theirs: the visits' end times (a state row is moved to a minute ago so the filing run may file), the Mod's office (written as the
 * office log's seed row if an earlier file did not), the season's Boss, and the players' wallets and hands (a purchase is another function's: `wallets` and `card_ledger` are written
 * directly, as 0002 and 0020 do). Every board, account and character is this file's own and every assertion is about its ids, since the files before leave committed rows.
 *
 * Order: a high number, so it runs after the others (tools/test-sql.mjs sorts the files). It relies on nothing a file before it commits except what any file of the stage leaves: the
 * export's Storage is a fake that serves any object a row names (the files before this one leave avatar rows), and the imported database is told of the `export_probe` table 0003 commits,
 * if it is there. It leaves its own committed rows behind and drops the database it imports into.
 * Reads only the scratch database tools/test-sql.mjs made (scratchUrl refuses any other); run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firstMessageOf, partOf, partAnswer } from './meeting-fake.ts';
import { psqlDb, sql, scratchSeed, scratchUrl } from './psql-db.ts';
import { handleAction } from '../../functions/act/core.ts';
import { runMeeting } from '../../functions/meet/core.ts';
import { runFilings } from '../../functions/staff/core.ts';
import { runPatrols } from '../../functions/staff/patrol.ts';
import { runAppeal } from '../../functions/staff/appeal.ts';
import { instance as realInstance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';
import type { Db } from '../../functions/_shared/rpc.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const instance = realInstance;
const quiet: Instance = { ...instance, system: { ...instance.system, feeds: [] } };
const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const roster = instance.system.roster;
const BOSS = instance.system.firstBoss;
const MOD = instance.system.firstStaff[0]!;

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

const STORAGE_KEY = 'sb_secret_sErViCe-kEy-for-hearts';
/** The tool, run as an admin runs it; spawned, not run synchronously, so the fake Storage below answers it. The key is in its environment, never on its command line. */
const run = (tool: string, args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'tools', tool), ...args], { env: { ...process.env, KAYFABB_STORAGE_KEY: STORAGE_KEY, KAYFABB_STORAGE_TIMEOUT_MS: '2000' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
/**
 * Supabase Storage's two object endpoints, in memory, as 0003's stand-in answers them but for one thing: the project it stands for holds whatever object a row of this database names (the
 * files before this one leave rows naming avatars and trophies), each with bytes made of its own key, so the export fetches them and the import carries them. Writes are kept as 0003 keeps them.
 */
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

test('a fall lands on the caster, hearts take points and a ban off, a tattle weighs a patrol; each refusal spends nothing; each log is true; the export imports again', { timeout: 540_000 }, async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  assert.equal(sql(`select count(*) from card_kinds where key in ('happy-heart', 'super-happy-heart', 'ultra-happy-heart', 'take-the-fall', 'tattle-tale') and discipline is not null`), '5', 'the instance\'s five discipline cards are in the catalog');

  // ---- The staff as this day starts: the Boss of the open season, and the Mod. ----
  sql(`update seasons set boss = '${BOSS}' where ends_at is null`);
  sql(`update characters set debuted_at = coalesce(debuted_at, now() - interval '30 days') where staff in ('${BOSS}', '${MOD}')`);
  if (sql(`select office from staff_office_now where staff = '${MOD}'`) !== 'mod') sql(`insert into staff_offices (staff, office, cause) values ('${MOD}', 'mod', 'seed')`);
  sql(`insert into move_bank (staff, balance, as_of) values ('${BOSS}', 6, now()) on conflict (staff) do update set balance = 6, as_of = now()`);
  const warnBar = json<{ size: number; bands: Record<string, number> }>(sql(`select coalesce((select value::text from settings where key = 'warnBar'), '${JSON.stringify(instance.settings.warnBar)}')`));
  const LIGHTEST = Math.min(...Object.values(warnBar.bands));

  // ---- A board of this file's own with a main thread; the players. The Taker has two masks on one account (the burner). ----
  sql(`insert into boards (slug, name, description) values ('hearts-day', '000 Hearts Day', 'Where the day of hearts is played.') on conflict (slug) do nothing`);
  const board = sql(`select id from boards where slug = 'hearts-day'`);
  const mainThread = sql(`insert into threads (board, title) values ('${board}', 'Hearts day: the main thread') returning id`);
  const banThread = sql(`insert into threads (board, title) values ('${board}', 'Hearts day: the filed posts') returning id`);
  const names = ['Hearts Author', 'Hearts Taker', 'Hearts Healer', 'Hearts Stranger'] as const;
  type Who = (typeof names)[number] | 'Hearts Taker Mask';
  const accounts: Record<string, string> = json(sql(`
    with u as (insert into auth.users (email) values ${names.map((_, i) => `('e2e-hearts-${i}@test.invalid')`).join(', ')} returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(email, id) from u`));
  const accountOf: Record<Who, string> = {
    'Hearts Author': accounts['e2e-hearts-0@test.invalid']!, 'Hearts Taker': accounts['e2e-hearts-1@test.invalid']!, 'Hearts Taker Mask': accounts['e2e-hearts-1@test.invalid']!,
    'Hearts Healer': accounts['e2e-hearts-2@test.invalid']!, 'Hearts Stranger': accounts['e2e-hearts-3@test.invalid']!,
  };
  const everyone = Object.keys(accountOf) as Who[];
  const chars: Record<string, string> = json(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${everyone.map((n) => `('${accountOf[n]}', '${n}', now() - interval '1 day', now() - interval '1 day')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '1 day' from c returning 1)
    select json_object_agg(name, id) from c`));
  const account = (n: Who) => accountOf[n];
  const char = (n: Who) => chars[n]!;
  const as = (n: Who) => psqlDb(account(n));
  const say = async (n: Who, thread: string, body: string): Promise<string> => (await as(n).rpc<{ id: string }>('post', { in_thread: thread, through: char(n), body })).id;
  const fund = (n: Who, balance: number) => sql(`insert into wallets (account, balance) values ('${account(n)}', ${balance}) on conflict (account) do update set balance = ${balance}`);
  for (const n of names) fund(n, 100);
  const give = (n: Who, card: string, copies = 1) => sql(`insert into card_ledger (account, card, kind, price) select '${account(n)}', '${card}', 'bought', 0 from generate_series(1, ${copies})`);
  give('Hearts Author', 'take-the-fall');
  give('Hearts Taker', 'take-the-fall');
  give('Hearts Healer', 'take-the-fall');
  give('Hearts Healer', 'happy-heart');
  give('Hearts Healer', 'super-happy-heart');
  give('Hearts Healer', 'tattle-tale', 2);
  give('Hearts Taker Mask', 'ultra-happy-heart');
  give('Hearts Author', 'happy-heart');
  const warn = (n: Who) => Number(sql(`select warn_points('${char(n)}')`));
  const untilOf = (n: Who) => sql(`select coalesce(banned_until('${char(n)}')::text, '')`);
  const FIVE = ['take-the-fall', 'happy-heart', 'super-happy-heart', 'ultra-happy-heart', 'tattle-tale'];
  /** What a caster's player holds: the wallet, the five cards in hand, and the card Acts the caster has played. */
  const snap = (n: Who) => JSON.stringify([
    Number(sql(`select coalesce((select balance from wallets where account = '${account(n)}'), 0)`)),
    FIVE.map((k) => Number(sql(`select card_held('${account(n)}', '${k}')`))),
    Number(sql(`select count(*) from acts where kind = 'card' and character = '${char(n)}'`)),
    Number(sql(`select count(*) from card_ledger where account = '${account(n)}'`)),
  ]);
  const visitsOn = (post: string) => rows(`select v.id, e.payload as ended from acts v left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id where v.kind = 'visit' and v.target_act_id = '${post}' order by v.created_at`);
  const over = (...visits: string[]) => sql(`update visits_open set ends_at = now() - interval '1 minute' where visit_act in (${visits.map((v) => `'${v}'`).join(', ')})`);
  const openVisit = async (post: string, band: string, why: string): Promise<string> => {
    const r = await db.rpc<{ visit: string | null }>('start_visit', { post_act: post, staff: MOD, charge: { rule_number: null, band, cause: 'rule', rule: why } });
    assert.ok(r.visit, `a visit opens on the post: ${JSON.stringify(r)}`);
    return r.visit;
  };

  // ---- The fake model: every call is logged, and answered by what the scenario has set for it. ----
  const log: { duty: string; staff: string }[] = [];
  const scene: { meeting: unknown; verdict: string } = { meeting: null, verdict: 'upheld' };
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(String(url).includes('anthropic'), `the day asks for no completion: ${url}`);
    const text = JSON.stringify(body);
    const asked = firstMessageOf(body);
    const part = partOf(body);
    const who = roster.find((p) => text.includes(JSON.stringify(p.selfPrompt).slice(1, -1)))?.key ?? '';
    const last = asked.trim().split('\n').pop()!;
    let duty: string;
    let reply: unknown;
    if (part) { duty = 'meeting'; reply = partAnswer(scene.meeting as Record<string, unknown>, part); }
    else if (last === 'Write the line you file.') { duty = 'filing'; reply = { words: 'Filed, as the post broke the rule.' }; }
    else if (last === 'Give your ruling.') { duty = 'appeal'; reply = { verdict: scene.verdict, line: 'The filing stands.' }; }
    else if (last === 'Give your findings.') { duty = 'patrolJudge'; reply = { findings: [] }; }
    else throw new Error(`the fake model does not know this call: ${last}`);
    log.push({ duty, staff: who });
    return new Response(JSON.stringify({ model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 1500, output_tokens: 80, service_tier: 'standard' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const real = models((name) => ({ ANTHROPIC_API_KEY: 'test-key' } as Record<string, string>)[name], ledgerWriter(db), { tiers, fetch: fake });

  // ---- The act path as the edge wires it, and the same play asked of the database directly. ----
  const act = (n: Who, body: Record<string, unknown>) => handleAction({ dbs: { player: as(n), service: db }, instance, body, send: async () => undefined, drain: async () => undefined, after: () => undefined });
  const cast = async (n: Who, card: string, target: string, from?: string) => {
    const out = await act(n, { action: 'playCard', card, character: char(n), target, config: {}, message: '', ...(from ? { reach: 'character', post: from } : {}) });
    assert.equal(out.status, 200, `${n} plays ${card}: ${JSON.stringify(out.body)}`);
    return out.body as { id: string; payload: Record<string, any> };
  };
  /** A play the rules refuse, asked twice (through the act path, which decides it with the engine's words, and straight at play_card, which decides it again): both refuse, the words match, and nothing is spent either time. */
  const refused = async (n: Who, card: string, target: string, words: RegExp, from?: string) => {
    const before = snap(n);
    const out = await act(n, { action: 'playCard', card, character: char(n), target, config: {}, message: '', ...(from ? { reach: 'character', post: from } : {}) });
    assert.ok(out.status >= 400 && out.status < 500 && words.test(String((out.body as { error?: string }).error)), `${n}'s ${card} is refused by the engine as ${words}: ${JSON.stringify(out)}`);
    assert.equal(snap(n), before, `${n}'s hand and wallet are as they were after the engine's refusal`);
    await assert.rejects(db.rpc('play_card', { who: account(n), card, through: char(n), target, config: {}, price: 0, message: '', reach: from ? 'character' : 'post', from_post: from ?? null }), words, `${n}'s ${card} is refused by the database as ${words}`);
    assert.equal(snap(n), before, `${n}'s hand and wallet are as they were after the database's refusal`);
  };

  // ---- 1. A post breaks a rule and a visit opens. Its author's own fall on it is refused; the Taker's lands; a second fall is refused as the stack's. ----
  const authorPost = await say('Hearts Author', mainThread, 'A post that breaks a rule on the day of hearts.');
  const v1 = await openVisit(authorPost, 'moderate', 'Rule hearts one');
  await refused('Hearts Author', 'take-the-fall', authorPost, /is played on another character's post/);
  const fall = await cast('Hearts Taker', 'take-the-fall', authorPost);
  assert.equal(sql(`select (payload ? 'ends')::text || (payload ? 'instant')::text from acts where id = '${fall.id}'`), 'falsefalse', 'a fall carries no time up and is not instant');
  assert.equal(sql(`select count(*) from play_reach where play = '${fall.id}'`), '0', 'a fall on a post is no play on a character');
  await refused('Hearts Healer', 'take-the-fall', authorPost, /already carries/);

  // ---- 2. The filing run files the visit: the points are on the Taker, none on the Author, and the post keeps its notice. ----
  sql(`insert into settings (key, value) values ('systemEnabled', 'true') on conflict (key) do update set value = 'true'`);
  over(v1);
  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 11 * 24 * 3_600_000).toISOString();
  const filedRun = await runFilings(db, real, quiet, slot);
  assert.equal(filedRun.status, 'ok');
  assert.ok(filedRun.status === 'ok' && filedRun.filings.some((f) => f.visit === v1 && f.status === 'filed'), 'the filing run filed the visit');
  const infraction = row(`select to_jsonb(i) from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = '${v1}'`);
  assert.deepEqual([infraction.payload.character, infraction.payload.about_act, infraction.payload.fall_play, infraction.payload.points], [char('Hearts Taker'), authorPost, fall.id, warnBar.bands['moderate']], 'the infraction is the Taker\'s, about the Author\'s post, naming the play');
  assert.deepEqual([warn('Hearts Taker'), warn('Hearts Author')], [warnBar.bands['moderate'], 0], 'the points are on the Taker and none on the Author');
  assert.equal(sql(`select count(*) from acts where kind = 'infraction' and payload ->> 'character' = '${char('Hearts Author')}'`), '0');
  assert.equal(visitsOn(authorPost)[0]!.ended.outcome, 'filed', 'the post keeps its notice: the visit ended filed on it');

  // ---- 3. The Taker appeals the filing; the Author cannot. ----
  const takerWallet = snap('Hearts Taker');
  const authorWallet = snap('Hearts Author');
  const appealed = await runAppeal({ player: as('Hearts Taker'), service: db }, async () => real, quiet, { through: char('Hearts Taker'), punishment: infraction.id, plea: 'I took the fall, and I would like it looked at again.' });
  assert.equal(appealed.status, 200, JSON.stringify(appealed.body));
  assert.equal(appealed.body['verdict'], 'upheld');
  assert.equal(sql(`select count(*) from acts where kind = 'appeal' and target_act_id = '${infraction.id}'`), '1', 'the Taker\'s appeal is on the record');
  assert.notEqual(snap('Hearts Taker'), takerWallet, 'an appeal costs what it costs');
  const byAuthor = await runAppeal({ player: as('Hearts Author'), service: db }, async () => real, quiet, { through: char('Hearts Author'), punishment: infraction.id, plea: 'It was my post, so I will appeal it too.' });
  assert.ok(byAuthor.status >= 400 && byAuthor.status < 500, `the Author cannot appeal the Taker's filing: ${JSON.stringify(byAuthor)}`);
  assert.equal(snap('Hearts Author'), authorWallet, 'and it cost the Author nothing');
  assert.equal(sql(`select count(*) from acts where kind = 'appeal' and target_act_id = '${infraction.id}'`), '1', 'and wrote nothing');
  assert.equal(warn('Hearts Taker'), warnBar.bands['moderate'], 'the filing stands');

  // ---- 4. Hearts: the Healer plays Happy Heart on the Taker, then Super Happy Heart. A heart on an empty bar is refused. ----
  const takerPost = await say('Hearts Taker', mainThread, 'Taking the fall is its own kind of post.');
  const authorLater = await say('Hearts Author', mainThread, 'A clean post by a clean bar.');
  await refused('Hearts Author', 'happy-heart', char('Hearts Author'), /warn bar is empty/, authorLater);
  await refused('Hearts Healer', 'happy-heart', char('Hearts Author'), /warn bar is empty/, authorLater);
  await refused('Hearts Healer', 'super-happy-heart', char('Hearts Author'), /warn bar is empty/, authorLater);
  const healerBefore = snap('Hearts Healer');
  const happy = await cast('Hearts Healer', 'happy-heart', char('Hearts Taker'), takerPost);
  assert.equal(happy.payload.took, LIGHTEST, 'Happy Heart takes the lightest band off');
  assert.equal(warn('Hearts Taker'), warnBar.bands['moderate']! - LIGHTEST, 'the bar after Happy Heart');
  assert.equal(sql(`select count(*) from play_reach where play = '${happy.id}'`), '0', 'a heart leaves no play on the character');
  assert.equal(sql(`select coalesce(sum(points), 0) from warn_reliefs where play = '${happy.id}' and infraction = '${infraction.id}'`), String(LIGHTEST), 'the relief row is the infraction\'s');
  assert.equal(sql(`select card_relief('${infraction.id}')`), String(LIGHTEST));
  assert.notEqual(snap('Hearts Healer'), healerBefore);
  const superHeart = await cast('Hearts Healer', 'super-happy-heart', char('Hearts Taker'), takerPost);
  assert.equal(superHeart.payload.took, warnBar.bands['moderate']! - LIGHTEST, 'Super Happy Heart takes what is left');
  assert.equal(warn('Hearts Taker'), 0, 'the bar after Super Happy Heart');
  assert.equal(sql(`select card_relief('${infraction.id}')`), String(warnBar.bands['moderate']), 'the infraction is relieved of every point');
  assert.equal(sql(`select count(*) from acts where id = '${infraction.id}'`), '1', 'the filing stays on the record');

  // ---- 5. A full bar bans the Taker. An Ultra on a character not banned is refused; the Taker's other mask plays it; the Taker posts again. ----
  await refused('Hearts Taker Mask', 'ultra-happy-heart', char('Hearts Taker'), /is not banned/, takerPost);
  const fillA = await say('Hearts Taker', banThread, 'A post that breaks a severe rule.');
  const fillB = await say('Hearts Taker', banThread, 'A post that breaks a moderate rule.');
  const vA = await openVisit(fillA, 'severe', 'Rule hearts two');
  const vB = await openVisit(fillB, 'moderate', 'Rule hearts three');
  over(vA, vB);
  const banRun = await runFilings(db, real, quiet, slot);
  assert.ok(banRun.status === 'ok' && [vA, vB].every((v) => banRun.filings.some((f) => f.visit === v && f.status === 'filed')), 'both visits are filed');
  const ban = row(`select to_jsonb(b) from acts b where b.kind = 'ban' and b.payload ->> 'character' = '${char('Hearts Taker')}'`);
  assert.notEqual(untilOf('Hearts Taker'), '', 'a full bar bans the Taker');
  await assert.rejects(say('Hearts Taker', mainThread, 'let me back in'), /banned until/);
  const maskBefore = snap('Hearts Taker Mask');
  const ultra = await cast('Hearts Taker Mask', 'ultra-happy-heart', char('Hearts Taker'), takerPost);
  assert.equal(ultra.payload.lifted?.length, 1, 'one ban was lifted');
  assert.equal(ultra.payload.lifted[0].ban, ban.id);
  assert.equal(untilOf('Hearts Taker'), '', 'the ban is over at once');
  assert.equal(sql(`select count(*) from ban_lifts where play = '${ultra.id}' and ban = '${ban.id}'`), '1');
  assert.notEqual(snap('Hearts Taker Mask'), maskBefore);
  const afterBan = await say('Hearts Taker', mainThread, 'Back, and posting, thanks to a heart.');
  assert.ok(afterBan, 'the Taker posts after the Ultra');
  assert.equal(sql(`select count(*) from acts where kind = 'ban' and payload ->> 'character' = '${char('Hearts Taker')}'`), '1', 'the ban stays on the record');

  // ---- 6. A Tattle-Tale lands on the Taker; a second is refused as the stack's. ----
  const tattle = await cast('Hearts Healer', 'tattle-tale', char('Hearts Taker'), afterBan);
  assert.equal(sql(`select count(*) from play_reach where play = '${tattle.id}' and character = '${char('Hearts Taker')}' and ends_at > now()`), '1', 'the tattle is a live play on the Taker');
  assert.equal(sql(`select weight from watched_characters where character = '${char('Hearts Taker')}'`), '2', 'the Taker is watched at weight 2');
  await refused('Hearts Healer', 'tattle-tale', char('Hearts Taker'), /already carries/, afterBan);

  // ---- 7. A patrol with a seeded pool samples: thirteen more posts, each in a thread of its own, are on the board with the Taker's and the others'. ----
  const extra = json<string[]>(sql(`
    with u as (insert into auth.users (email) select 'e2e-hearts-x' || g || '@test.invalid' from generate_series(1, 13) g returning id),
    a as (insert into accounts (id) select id from u returning id),
    c as (insert into characters (owner, name, created_at, debuted_at) select id, 'Hearts Extra ' || row_number() over (order by id), now() - interval '1 day', now() - interval '1 day' from u returning id),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '1 day' from c returning 1)
    select json_agg(id) from c`));
  for (const [i, c] of extra.entries()) {
    const t = sql(`insert into threads (board, title) values ('${board}', 'Hearts extra ${i}') returning id`);
    sql(`insert into acts (character, kind, thread, payload) values ('${c}', 'post', '${t}', '{"body": "An ordinary post to be drawn from."}')`);
  }
  const memory = { hobby: { name: 'rule books', since: 'today', from: 'a drawer' }, opinions: [], grudges: [], wheelhouse: ['order'], realWorld: [], marks: [] };
  const profile = { interests: ['order'], favorites: [], mood: 'tidy', signature: 'It is filed.' };
  scene.meeting = {
    memory, profile, moves: [],
    orders: [{ mod: MOD, boards: [board], order: 'Walk the board of hearts.', allowance: 1 }],
    patrols: [{ mod: MOD, at: new Date().toISOString() }],
  };
  const met = await runMeeting(db, real, quiet, new Date(Date.parse(slot) + 24 * 3_600_000).toISOString(), Date.now, fake);
  assert.equal(met.status, 'ok', JSON.stringify(met));
  const meeting = (met as { meeting: number }).meeting;
  const patrolId = Number(sql(`select id from patrols where meeting = ${meeting}`));
  const asks: { boards: string[]; most: number; pool: number; seed: number }[] = [];
  const spy: Db = { rpc: async (fn, args) => { if (fn === 'patrol_sample') asks.push(args as (typeof asks)[number]); return db.rpc(fn, args); } };
  const patrolled = await runPatrols(spy, real, quiet);
  assert.equal(patrolled.status, 'ok');
  const mine = patrolled.status === 'ok' ? patrolled.patrols.filter((p) => p.patrol === patrolId) : [];
  assert.equal(mine.length, 1, JSON.stringify(patrolled));
  assert.deepEqual([mine[0]!.status, mine[0]!.findings, mine[0]!.visits], ['judged', 0, 0], 'the fake judge finds nothing');
  const ask = asks.find((a) => Number(a.seed) === patrolId);
  assert.ok(ask, `the patrol asked patrol_sample with its own id as the seed: ${JSON.stringify(asks)}`);
  assert.deepEqual([ask.pool, ask.most, ask.boards.includes(board)], [instance.settings.modBots.patrolPool, instance.settings.modBots.patrolSample, true], 'with the settings\' pool and sample, over a beat holding the board');
  const sampled = json<string[]>(sql(`select to_jsonb(sampled) from patrols where id = ${patrolId}`));
  assert.equal(sampled.length, instance.settings.modBots.patrolSample, 'the patrol sampled the settings\' count of posts');
  const again = rows(`select x ->> 'act' as act from jsonb_array_elements(patrol_sample('{${ask.boards.join(',')}}'::uuid[], ${ask.most}, ${ask.pool}, ${patrolId})) x`).map((r) => r.act as string);
  assert.deepEqual([...sampled].sort(), [...again].sort(), 'the recorded sample is the draw for that pool and seed, asked again');
  // The weight is read: over 300 seeds, the watched character's two unvisited posts are drawn more often per post than the others'.
  const tally = row(`with drawn as (
      select s, (x ->> 'act')::uuid as act from generate_series(1, 300) s, lateral jsonb_array_elements(patrol_sample('{${ask.boards.join(',')}}'::uuid[], ${ask.most}, ${ask.pool}, s)) x),
    seen as (select d.act, a.character from drawn d join acts a on a.id = d.act)
    select jsonb_build_object(
      'watched', (select count(*) from seen where character = '${char('Hearts Taker')}'), 'watchedPosts', (select count(distinct act) from seen where character = '${char('Hearts Taker')}'),
      'others', (select count(*) from seen where character <> '${char('Hearts Taker')}'), 'otherPosts', (select count(distinct act) from seen where character <> '${char('Hearts Taker')}'))`);
  const perPost = (n: number, posts: number) => n / Math.max(posts, 1);
  const ratio = perPost(tally.watched, tally.watchedPosts) / perPost(tally.others, tally.otherPosts);
  assert.ok(ratio >= 1.25, `the watched character's posts are drawn at least 1.25 times as often per post as the others' (got ${ratio.toFixed(2)}: ${JSON.stringify(tally)})`);

  // ---- 8. Each player's own log says what the day did, plainly; a stranger's says none of it. ----
  const logOf = async (n: Who) => (await as(n).rpc<{ sources: { infractions: Record<string, any>[]; bans: Record<string, any>[]; falls: Record<string, any>[] } }>('log_page', { in_before: null })).sources;
  const taker = await logOf('Hearts Taker');
  const takerMask = await logOf('Hearts Taker Mask');
  assert.deepEqual(taker.infractions.map((i) => i.infraction).sort(), takerMask.infractions.map((i) => i.infraction).sort(), 'a player\'s log is the player\'s, whichever mask it is read through');
  const takenRow = taker.infractions.find((i) => i.infraction === infraction.id);
  assert.equal(takenRow?.fall_play, fall.id, 'the taker\'s infraction row carries the fall play');
  assert.equal(takenRow?.card_relief, warnBar.bands['moderate'], 'and the hearts\' relief');
  assert.deepEqual(taker.infractions.filter((i) => i.infraction !== infraction.id).map((i) => i.fall_play ?? null), [null, null], 'the infractions of its own posts name no fall');
  const liftedBan = taker.bans.find((b) => b.ban === ban.id);
  assert.ok(liftedBan?.lifted_at, 'the lifted ban carries when it was lifted');
  assert.equal(liftedBan?.lifted_card, 'ultra-happy-heart', 'and by which card');
  assert.deepEqual(taker.falls, [], 'the taker is shown no fall taken for it: it took it');
  const author = await logOf('Hearts Author');
  assert.equal(author.falls.length, 1, 'the author\'s log has the fall taken for its post');
  assert.deepEqual([author.falls[0]!.infraction, author.falls[0]!.taker_name, author.falls[0]!.post], [infraction.id, 'Hearts Taker', authorPost], 'naming the taker by its public name');
  assert.deepEqual([author.infractions, author.bans], [[], []], 'the author has no infraction or ban of its own');
  for (const n of ['Hearts Stranger', 'Hearts Healer'] as Who[]) {
    const s = await logOf(n);
    assert.deepEqual([s.infractions, s.bans, s.falls], [[], [], []], `${n}'s log holds none of it`);
  }

  // ---- 9. The export of the instance imports again to the same forum, the two new tables included. ----
  const from = scratchUrl();
  for (const t of ['warn_reliefs', 'ban_lifts']) assert.notEqual(sql(`select count(*) from ${t}`), '0', `${t} holds rows to carry across`);
  const before = contents(from);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-hearts-'));
  const fresh = new URL(from);
  const name = `${fresh.pathname.slice(1)}_hearts_imported`;
  const server = new URL(from);
  server.pathname = '/postgres';
  fresh.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  const oldStore = await fakeStorage(true);
  const newStore = await fakeStorage(false);
  try {
    const exported = await run('export-instance.mjs', ['--from', from, '--to', dir, '--storage', oldStore.url]);
    assert.equal(exported.status, 0, exported.stderr + exported.stdout);
    for (const t of ['warn_reliefs', 'ban_lifts']) assert.ok(fs.existsSync(path.join(dir, `public.${t}.jsonl`)), `the export holds ${t}`);
    psqlOn(fresh.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    const migrations = path.join(root, 'supabase/migrations');
    for (const m of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) psqlOn(fresh.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    // A table an earlier file committed outside the migrations (0003's probe) is made in the fresh database too, as 0003 makes it.
    if (psqlOn(from, `select to_regclass('public.export_probe') is not null`) === 't') psqlOn(fresh.toString(), 'create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);');
    const imported = await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.equal(imported.status, 0, imported.stderr + imported.stdout);
    const after = contents(fresh.toString());
    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [t, rows] of before) assert.equal(after.get(t), rows, `${t} differs after the round trip`);
    for (const t of ['public.warn_reliefs', 'public.ban_lifts']) assert.ok(after.get(t) && after.get(t) !== '[]', `${t} is in the imported instance`);
    // The imported forum reads the same: the Taker's bar, its ban, and the relief of the filing.
    const reads = (url: string) => psqlOn(url, `select warn_points('${char('Hearts Taker')}') || '|' || coalesce(banned_until('${char('Hearts Taker')}')::text, '-') || '|' || card_relief('${infraction.id}') || '|' || ban_ends('${ban.id}')::text`);
    assert.equal(reads(fresh.toString()), reads(from), 'the imported forum reads the same bar, ban and relief');
  } finally {
    await oldStore.close();
    await newStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
    try { psqlOn(server.toString(), `drop database if exists ${name} with (force);`); } catch { /* the harness drops the scratch database's own */ }
  }
});
