/**
 * End to end: a day of the Mods (the Mod Bots plan, Task 15), across the Boss's meeting (supabase/functions/meet/core.ts), the filing and patrol runs, the report and the
 * appeal (supabase/functions/staff/{core,patrol,report,appeal}.ts), the database's draw of visits on a post, interception, the warn bar and the tick, against the real
 * migrations on the scratch database, with the real model adapters over a fake `fetch`. Every model call of the day goes through that fake and lands in the ledger.
 *
 * The day: a meeting gives two Mods (the quiz Mod and the bribe Mod) beats, orders and allowances, sets a rule on each of their boards and schedules a patrol. A breaking
 * post draws a visit (a quiz on one board, a price on the other). One character fails the quiz and is tailed (its next post draws Obstruction); another bribes and the
 * visit ends. A report is judged into a visit. The visits file and the points land. A filing spends the quiz Mod's allowance on a rule, which lands at the tick; a post that
 * breaks it draws a visit whose filing fills the bar and bans. The banned character appeals to the Boss and the ban is cut; another appeals an infraction and loses half its
 * points. The next meeting returns what the Mods did not spend. A patrol runs once.
 *
 * Stepped over, as 0012 and 0015 step over theirs: the visits' end times (a visit lasts hours, and the filing run files only a visit that is over, so a state row's end is
 * moved to a minute ago, as the SQL suite does); the two Mods' offices and the season's Boss (an earlier file may have handed the season over); the players' wallets
 * (a card-ledger purchase is another Edge Function's). The Boss's two rules and the Mod's rule land through the real tick. Every board and account is this file's own, and
 * every assertion is about its ids, since the files before this one leave committed rows. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runMeeting } from '../../functions/meet/core.ts';
import { runFilings } from '../../functions/staff/core.ts';
import { runPatrols } from '../../functions/staff/patrol.ts';
import { runReport } from '../../functions/staff/report.ts';
import { runAppeal } from '../../functions/staff/appeal.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { models } from '../../functions/_shared/models/index.ts';
import { ledgerWriter } from '../../functions/_shared/models/ledger.ts';
import { COUNT_MOST } from '../../../engine/system/demands.ts';
import type { Instance } from '../../../engine/rules/types.ts';

const quiet: Instance = { ...instance, system: { ...instance.system, feeds: [] } };
const tiers = { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' };
const roster = instance.system.roster;
const MONITOR = instance.system.firstStaff[0]!;
const HYPE = roster.find((p) => p.weakness.kind === 'bribe')!.key;
const BOSS = roster.find((p) => p.key !== MONITOR && p.key !== HYPE && p.weakness.kind === 'distraction')!.key;
const nameOf = (key: string) => roster.find((p) => p.key === key)!.name;

const json = <T = Record<string, any>>(text: string): T => JSON.parse(text) as T;
const row = (query: string) => json(sql(query));
const rows = (query: string) => json<Record<string, any>[]>(sql(`select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (${query}) x`));

test('a meeting orders two Mods; visits are drawn, intercepted, reported and filed; a rule lands; a bar bans; appeals reduce; the allowance returns; a patrol runs once', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  sql(`update settings set value = 'true' where key = 'systemEnabled'`);
  const ledgerBefore = Number(sql(`select coalesce(max(id), 0) from model_calls`));

  // ---- The staff as this day starts: BOSS is the open season's Boss, and MONITOR (a quiz) and HYPE (a bribe) are the Mods. ----
  sql(`update seasons set boss = '${BOSS}' where ends_at is null`);
  sql(`update characters set debuted_at = coalesce(debuted_at, now() - interval '30 days') where staff in ('${BOSS}', '${MONITOR}', '${HYPE}')`);
  for (const mod of [MONITOR, HYPE]) {
    if (sql(`select office from staff_office_now where staff = '${mod}'`) !== 'mod') sql(`insert into staff_offices (staff, office, cause) values ('${mod}', 'mod', 'seed')`);
  }
  sql(`insert into move_bank (staff, balance, as_of) values ('${BOSS}', 6, now()) on conflict (staff) do update set balance = 6, as_of = now()`);

  // ---- Two boards of this file's own (named to sort first, so the meeting's list holds them) with a thread each; five players with a mask each. ----
  sql(`insert into boards (slug, name, description) values ('mods-day-a', '000 Mods Day A', 'Where the quiz Mod walks.'), ('mods-day-b', '000 Mods Day B', 'Where the bribe Mod walks.') on conflict (slug) do nothing`);
  const boardA = sql(`select id from boards where slug = 'mods-day-a'`);
  const boardB = sql(`select id from boards where slug = 'mods-day-b'`);
  const threadA = sql(`insert into threads (board, title) values ('${boardA}', 'Mods day on A') returning id`);
  const threadB = sql(`insert into threads (board, title) values ('${boardB}', 'Mods day on B') returning id`);
  const names = ['Modsday Ann', 'Modsday Bo', 'Modsday Cy', 'Modsday Dee', 'Modsday Eve'] as const;
  type Who = (typeof names)[number];
  const accounts: Record<string, string> = json(sql(`
    with u as (insert into auth.users (email) values ${names.map((_, i) => `('e2e-modsday-${i}@test.invalid')`).join(', ')} returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(email, id) from u`));
  const account = (n: Who) => accounts[`e2e-modsday-${names.indexOf(n)}@test.invalid`]!;
  const chars: Record<string, string> = json(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${names.map((n) => `('${account(n)}', '${n}', now() - interval '1 day', now() - interval '1 day')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', now() - interval '1 day' from c returning 1)
    select json_object_agg(name, id) from c`));
  const char = (n: Who) => chars[n]!;
  const wallet = (n: Who) => Number(sql(`select coalesce((select balance from wallets where account = '${account(n)}'), 0)`));
  const fund = (n: Who, balance: number) => sql(`insert into wallets (account, balance) values ('${account(n)}', ${balance}) on conflict (account) do update set balance = ${balance}`);
  fund('Modsday Ann', 100); fund('Modsday Bo', 200); fund('Modsday Cy', 100); fund('Modsday Dee', 100);
  const as = (n: Who) => psqlDb(account(n));
  const say = async (n: Who, thread: string, body: string): Promise<string> => (await as(n).rpc<{ id: string }>('post', { in_thread: thread, through: char(n), body })).id;
  const visitsOn = (post: string) => rows(`select v.id, v.payload, (select e.payload from acts e where e.kind = 'visit_end' and e.target_act_id = v.id) as ended, c.staff as mod
    from acts v join characters c on c.id = v.character where v.kind = 'visit' and v.target_act_id = '${post}' order by v.created_at, v.id`);
  const infractionsOf = (n: Who) => rows(`select id, payload from acts where kind = 'infraction' and payload ->> 'character' = '${char(n)}' order by created_at`);
  const untilMs = (n: Who) => Number(sql(`select extract(epoch from banned_until('${char(n)}')) * 1000`));
  const warn = (n: Who) => Number(sql(`select warn_points('${char(n)}')`));
  // A visit's time is a state row's, not an Act's: the visit is over a minute ago, so the filing run may file it.
  const over = (...visits: unknown[]) => sql(`update visits_open set ends_at = now() - interval '1 minute' where visit_act in (${visits.map((v) => `'${v}'`).join(', ')})`);

  // ---- The fake model: every call is logged with its duty and its Mod, and answered by what the scenario has set for it. ----
  const log: { duty: string; staff: string }[] = [];
  const scene: { meeting: unknown; patrolPost: string; appealReport: Record<string, unknown> } = { meeting: null, patrolPost: '', appealReport: {} };
  const ruleMove = (board: string, predicate: string, param: unknown, band: string, why: string) => ({
    kind: 'setRule', params: { board, predicate, ...(param === null ? {} : { param }), band }, demand: { kind: 'postsOnBoard', params: { board, count: COUNT_MOST } },
    go_live_at: new Date().toISOString(), expires_in_hours: 72, why,
  });
  const fake = (async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(String(url).includes('anthropic'), `a Mod's day asks for no completion: ${url}`);
    const text = JSON.stringify(body);
    const asked = String(body.messages?.[0]?.content ?? '');
    const who = roster.find((p) => text.includes(JSON.stringify(p.persona).slice(1, -1)))?.key ?? '';
    const last = asked.trim().split('\n').pop()!;
    let duty: string;
    let reply: unknown;
    if (last === 'Hold your meeting.') {
      duty = 'meeting';
      reply = scene.meeting;
    } else if (last === 'Write the line you file.') {
      duty = 'filing';
      const movePossible = who === MONITOR && /Rule 1:/.test(asked) && /severe/.test(asked);
      reply = movePossible
        ? { words: 'Friendly reminder: that is a lot of capital letters.', move: { kind: 'setRule', params: { board: boardA, predicate: 'bannedWord', param: 'frobnicate', band: 'minor' }, expires_in_hours: 48, why: 'The shouting has moved on to a made-up word.' } }
        : { words: `Filed by ${nameOf(who)}.` };
    } else if (last === 'Give your verdict.') {
      duty = 'reportJudge';
      reply = { verdict: 'visit', line: 'I will take a look.', charge: { rule: 'premise', band: 'moderate' } };
    } else if (last === 'Give your ruling.') {
      duty = 'appeal';
      reply = { verdict: 'reduced', line: 'Half of it, and only because I am in a good mood.' };
    } else if (last === 'Give your findings.') {
      duty = 'patrolJudge';
      reply = { findings: [{ post: scene.patrolPost, charge: { rule: 'premise', band: 'minor' } }] };
    } else throw new Error(`the fake model does not know this call: ${last}`);
    log.push({ duty, staff: who });
    return new Response(JSON.stringify({ model: body.model, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 1500, output_tokens: 80, service_tier: 'standard' } }), { status: 200 });
  }) as unknown as typeof fetch;
  const env = (name: string) => ({ ANTHROPIC_API_KEY: 'test-key' } as Record<string, string>)[name];
  const real = models(env, ledgerWriter(db), { tiers, fetch: fake });

  // ---- The first meeting: two rules (the Boss's own moves), an order and an allowance for each Mod, a patrol for the quiz Mod. ----
  const memory = { hobby: { name: 'rule books', since: 'today', from: 'a drawer' }, opinions: [], grudges: [], wheelhouse: ['order'], realWorld: [], marks: [] };
  const profile = { interests: ['order'], favorites: [], mood: 'tidy', signature: 'It is filed.' };
  scene.meeting = {
    memory, profile,
    moves: [ruleMove(boardA, 'noAllCaps', null, 'severe', 'Too much shouting on A.'), ruleMove(boardB, 'noAllCaps', null, 'severe', 'Too much shouting on B.')],
    orders: [
      { mod: MONITOR, boards: [boardA], order: 'Quiz them, then file them. Stay on A.', allowance: 2 },
      { mod: HYPE, boards: [boardB], order: 'Take their money if they offer it.', allowance: 1 },
    ],
    patrols: [{ mod: MONITOR, at: new Date().toISOString() }],
  };
  // Slots of its own, days past the ones 0011 meets at (a slot already met is told so and does nothing).
  const slot = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 5 * 24 * 3_600_000).toISOString();
  const met = await runMeeting(db, real, quiet, slot, Date.now, fake);
  assert.equal(met.status, 'ok', JSON.stringify(met));
  const meeting1 = (met as { meeting: number }).meeting;
  assert.equal(sql(`select count(*) from queued_moves where meeting = ${meeting1} and staff = '${BOSS}' and kind = 'setRule'`), '2', 'the Boss queued its two rules');
  const orderOf = (mod: string) => row(`select to_jsonb(o) from staff_orders o where o.meeting = ${meeting1} and o.staff = '${mod}'`);
  assert.deepEqual([orderOf(MONITOR).boards, orderOf(MONITOR).allowance], [[boardA], 2]);
  assert.deepEqual([orderOf(HYPE).boards, orderOf(HYPE).allowance], [[boardB], 1]);
  assert.equal(sql(`select order_unspent('${MONITOR}') || ',' || order_unspent('${HYPE}')`), '2,1', 'the allowances are handed out');
  assert.equal(sql(`select beat_of('${boardA}') || ',' || beat_of('${boardB}')`), `${MONITOR},${HYPE}`, 'each board is on its Mod\'s beat');
  const patrol = row(`select to_jsonb(p) from patrols p where p.meeting = ${meeting1}`);
  assert.equal(patrol.staff, MONITOR);
  assert.equal(patrol.ran_at, null, 'the patrol waits to be claimed');
  const first = row(`select to_jsonb(m) from meetings m where m.id = ${meeting1}`);
  assert.ok(Math.abs(first.bank_before - first.bank_after - 5) < 0.01, `two rules and three allowances came out of the bank: ${first.bank_before} to ${first.bank_after}`);
  assert.equal(first.record.allowances.handed, 3);

  // The Boss's two rules land at the tick (they go live at once; the tick lands what is due).
  sql(`select system_tick()`);
  assert.equal(sql(`select count(*) from queued_moves where meeting = ${meeting1} and landed_act is not null`), '2', 'both rules landed');
  const ruleA = Number(sql(`select number from rules_now where board = '${boardA}' and predicate = 'noAllCaps'`));
  const ruleB = Number(sql(`select number from rules_now where board = '${boardB}' and predicate = 'noAllCaps'`));
  assert.ok(ruleA >= 1 && ruleB >= 1);

  // ---- Breaking posts draw visits: the quiz Mod's on A, the bribe Mod's on B. A post that breaks nothing draws none. ----
  const annLoud = await say('Modsday Ann', threadA, 'THIS BOARD IS DOOMED AND I WILL SHOUT ABOUT IT');
  const boLoud = await say('Modsday Bo', threadB, 'WHO LET THIS HAPPEN ON MY BOARD');
  const deeQuiet = await say('Modsday Dee', threadB, 'A perfectly ordinary post about turtles and their shells.');
  const eveQuiet = await say('Modsday Eve', threadA, 'A quiet and perfectly nice post about lighthouses.');
  assert.deepEqual(sql(`select count(*) from visit_draw_failures where post_act in ('${annLoud}', '${boLoud}')`), '0');
  const [annV1, ...annMore] = visitsOn(annLoud);
  assert.ok(annV1 && annMore.length === 0, 'one visit on Ann\'s post');
  assert.equal(annV1.mod, MONITOR);
  assert.equal(annV1.payload.challenge.kind, 'quiz');
  assert.deepEqual([annV1.payload.charges[0].rule_number, annV1.payload.charges[0].cause, annV1.payload.charges[0].band], [ruleA, 'rule', 'severe']);
  assert.ok(Date.parse(annV1.payload.ends_at) > Date.now(), 'the visit has not ended');
  const [boV2, ...boMore] = visitsOn(boLoud);
  assert.ok(boV2 && boMore.length === 0);
  assert.equal(boV2.mod, HYPE);
  assert.deepEqual([boV2.payload.challenge.kind, boV2.payload.challenge.price], ['bribe', 150]);
  assert.equal(visitsOn(deeQuiet).length + visitsOn(eveQuiet).length, 0, 'a post that breaks nothing draws no visit');

  // ---- Ann fails the quiz and is tailed; Bo bribes and the visit ends. ----
  const wrong = sql(`select c from staff_quiz_questions q, jsonb_array_elements_text(q.choices) c where q.staff = '${MONITOR}' and q.idx = ${annV1.payload.challenge.question_index} and c <> q.answer order by c limit 1`);
  const failed = await as('Modsday Ann').rpc<{ succeeded: boolean; ended: boolean; tail_until: string }>('intercept', { through: char('Modsday Ann'), visit_act: annV1.id, answer: wrong });
  assert.deepEqual([failed.succeeded, failed.ended], [false, false]);
  assert.equal(sql(`select count(*) from tails where character = '${char('Modsday Ann')}' and staff = '${MONITOR}' and until > now()`), '1', 'Ann is tailed by the quiz Mod');
  const bribed = await as('Modsday Bo').rpc<{ succeeded: boolean; ended: boolean }>('intercept', { through: char('Modsday Bo'), visit_act: boV2.id });
  assert.deepEqual([bribed.succeeded, bribed.ended], [true, true]);
  assert.equal(visitsOn(boLoud)[0]!.ended.outcome, 'intercepted');
  assert.equal(wallet('Modsday Bo'), 50, 'the bribe cost its price');
  assert.equal(sql(`select count(*) from wallet_events where account = '${account('Modsday Bo')}' and kind = 'bribe' and change = -150`), '1');
  assert.equal(warn('Modsday Bo'), 0, 'a bribed visit files nothing');

  // ---- Ann's next post breaks no rule, and draws Obstruction all the same. ----
  const annTail = await say('Modsday Ann', threadA, 'surely that is fair now');
  const [annV1b, ...tailMore] = visitsOn(annTail);
  assert.ok(annV1b && tailMore.length === 0, 'the tail draws one visit');
  assert.deepEqual([annV1b.mod, annV1b.payload.charges[0].cause, annV1b.payload.charges[0].rule, annV1b.payload.charges[0].band], [MONITOR, 'tail', 'Obstruction', 'minor']);
  assert.equal(sql(`select count(*) from tail_visits where visit_act = '${annV1b.id}'`), '1', 'and the visit spends the tail');

  // ---- Cy reports Dee's post; the bribe Mod judges it into a visit. ----
  const reported = await runReport({ player: as('Modsday Cy'), service: db }, async () => real, quiet, { through: char('Modsday Cy'), post: deeQuiet, reason: 'This post is far too reasonable for my taste.' });
  assert.equal(reported.status, 200, JSON.stringify(reported.body));
  assert.equal(reported.body['verdict'], 'visit');
  const deeV3 = visitsOn(deeQuiet)[0]!;
  assert.equal(deeV3.id, reported.body['visit']);
  assert.deepEqual([deeV3.mod, deeV3.payload.charges[0].cause, deeV3.payload.charges[0].band], [HYPE, 'report', 'moderate']);
  assert.equal(wallet('Modsday Cy'), 75, 'the report cost its price');

  // ---- The visits are over; the filing run files them in the Mods' voices. The quiz Mod spends an allowance on a rule while filing the severe visit. ----
  over(annV1.id, annV1b.id, deeV3.id);
  sql(`select system_tick()`);
  assert.equal(sql(`select count(*) from visits_open where visit_act in ('${annV1.id}', '${annV1b.id}', '${deeV3.id}')`), '3', 'the tick leaves a visit within its grace to the run');
  const filed = await runFilings(db, real, quiet, slot);
  assert.equal(filed.status, 'ok');
  const mine = filed.status === 'ok' ? filed.filings.filter((f) => [annV1.id, annV1b.id, deeV3.id].includes(f.visit)) : [];
  assert.equal(mine.length, 3);
  assert.ok(mine.every((f) => f.status === 'filed' && f.line === 'model' && f.calls === 1), JSON.stringify(mine));
  const filingOf = (visit: string) => mine.find((f) => f.visit === visit)!;
  assert.equal(filingOf(annV1.id).move?.queued, true, 'the quiz Mod\'s move was queued');
  assert.equal(filingOf(annV1b.id).move, undefined);
  assert.equal(visitsOn(annLoud)[0]!.ended.line, 'Friendly reminder: that is a lot of capital letters.', 'the filed line is the Mod\'s');
  assert.equal(sql(`select count(*) from staff_call_records where cause_act in ('${annV1.id}', '${annV1b.id}', '${deeV3.id}') and duty = 'filing'`), '3', 'every filing call has its record');
  // The points have landed.
  assert.deepEqual(infractionsOf('Modsday Ann').map((i) => `${i.payload.band}:${i.payload.points}:${i.payload.staff}`).sort(), [`minor:2:${MONITOR}`, `severe:7:${MONITOR}`]);
  assert.equal(warn('Modsday Ann'), 9, 'Ann\'s bar stands one short of full');
  assert.equal(warn('Modsday Dee'), 4);
  assert.equal(sql(`select count(*) from acts where kind = 'ban' and payload ->> 'character' = '${char('Modsday Ann')}'`), '0');
  // The allowance was spent once, and the rule waits to land.
  const modMove = row(`select to_jsonb(q) from queued_moves q where q.staff = '${MONITOR}' and q.cause_act = '${annV1.id}'`);
  assert.deepEqual([modMove.kind, modMove.params.predicate, modMove.params.board, modMove.landed_act !== null], ['setRule', 'bannedWord', boardA, false]);
  assert.equal(sql(`select order_unspent('${MONITOR}')`), '1', 'one of the two allowances is spent');
  assert.equal(sql(`select mod_allowance('${MONITOR}')`), '1');

  // ---- The rule lands at the tick, and a post that breaks it draws a visit whose filing fills the bar. ----
  sql(`select system_tick()`);
  assert.notEqual(sql(`select landed_act from queued_moves where id = ${modMove.id}`), '', 'the Mod\'s rule landed');
  const ruleFrob = Number(sql(`select number from rules_now where board = '${boardA}' and predicate = 'bannedWord'`));
  assert.ok(ruleFrob > ruleA, 'it is the board\'s next rule');
  const annFrob = await say('Modsday Ann', threadA, 'frobnicate is such a lovely word');
  const [annV4, ...frobMore] = visitsOn(annFrob);
  assert.ok(annV4 && frobMore.length === 0);
  assert.deepEqual([annV4.mod, annV4.payload.charges[0].rule_number, annV4.payload.charges[0].band], [MONITOR, ruleFrob, 'minor']);
  over(annV4.id);
  const bannedRun = await runFilings(db, real, quiet, slot);
  assert.equal(bannedRun.status, 'ok');
  assert.equal(bannedRun.status === 'ok' && bannedRun.filings.find((f) => f.visit === annV4.id)?.status, 'filed');
  assert.equal(infractionsOf('Modsday Ann').length, 3);
  const ban = row(`select to_jsonb(b) from acts b where b.kind = 'ban' and b.payload ->> 'character' = '${char('Modsday Ann')}'`);
  assert.equal(ban.payload.days, 1, 'a first ban is a day');
  assert.ok(Math.abs(untilMs('Modsday Ann') - (Date.now() + 86_400_000)) < 120_000, 'banned for a day');
  assert.equal(warn('Modsday Ann'), 0, 'a ban empties the bar');
  await assert.rejects(say('Modsday Ann', threadA, 'let me back in'), /banned until/);

  // ---- Ann appeals the ban to the Boss, who cuts it in half; Dee appeals her infraction to the Mod who filed it, who halves its points. ----
  const appealed = await runAppeal({ player: as('Modsday Ann'), service: db }, async () => real, quiet, { through: char('Modsday Ann'), punishment: ban.id, plea: 'I was only being loud, and I have learned my lesson.' });
  assert.equal(appealed.status, 200, JSON.stringify(appealed.body));
  assert.equal(appealed.body['verdict'], 'reduced');
  const cutUntil = Date.parse(String(appealed.body['until']));
  assert.ok(Math.abs(cutUntil - (Date.parse(ban.created_at) + 12 * 3_600_000)) < 1_000, 'a reduced ban is half its days from its start');
  assert.ok(Math.abs(untilMs('Modsday Ann') - cutUntil) < 1_000, 'the ban now ends then');
  assert.equal(wallet('Modsday Ann'), 50, 'the appeal cost its price');
  const deeInfraction = infractionsOf('Modsday Dee')[0]!;
  const deeAppeal = await runAppeal({ player: as('Modsday Dee'), service: db }, async () => real, quiet, { through: char('Modsday Dee'), punishment: deeInfraction.id, plea: 'Cy simply did not like my turtles.' });
  assert.equal(deeAppeal.status, 200, JSON.stringify(deeAppeal.body));
  assert.deepEqual([deeAppeal.body['verdict'], deeAppeal.body['points_delta']], ['reduced', -2]);
  assert.equal(warn('Modsday Dee'), 2, 'half of Dee\'s four points came off');
  assert.equal(sql(`select r.payload ->> 'verdict' from acts r join acts a on a.id = r.target_act_id where r.kind = 'appeal_ruling' and a.target_act_id = '${deeInfraction.id}'`), 'reduced');
  assert.equal(sql(`select c.staff from acts r join characters c on c.id = r.character where r.kind = 'appeal_ruling' and r.target_act_id = (select a.id from acts a where a.kind = 'appeal' and a.target_act_id = '${deeInfraction.id}')`), HYPE, 'the Mod that filed it heard it');

  // ---- The next meeting takes back what the Mods did not spend, and hands out again. ----
  const unspent = Number(sql(`select order_unspent('${MONITOR}') + order_unspent('${HYPE}')`));
  assert.equal(unspent, 2, 'one allowance each is left');
  scene.meeting = {
    memory, profile, moves: [],
    orders: [
      { mod: MONITOR, boards: [boardA], order: 'Keep them honest.', allowance: 1 },
      { mod: HYPE, boards: [boardB], order: 'Rest.', allowance: 0 },
    ],
    patrols: [],
  };
  const later = new Date(Date.parse(slot) + 24 * 3_600_000).toISOString();
  const second = await runMeeting(db, real, quiet, later, Date.now, fake);
  assert.equal(second.status, 'ok', JSON.stringify(second));
  const meeting2 = (second as { meeting: number }).meeting;
  const m2 = row(`select to_jsonb(m) from meetings m where m.id = ${meeting2}`);
  assert.ok(m2.record.allowances.returned >= unspent, `the unspent allowances went back to the bank: ${JSON.stringify(m2.record.allowances)}`);
  assert.ok(Math.abs(m2.bank_after - (m2.bank_before + m2.record.allowances.returned - m2.record.allowances.handed)) < 0.01, 'the bank holds what came back less what was handed');
  assert.equal(m2.record.allowances.handed, 1);
  assert.equal(sql(`select order_unspent('${MONITOR}') || ',' || order_unspent('${HYPE}')`), '1,0', 'the old orders are spent and the new one stands');
  // The same slot again returns nothing twice.
  const bankNow = sql(`select balance from move_bank where staff = '${BOSS}'`);
  const again = await runMeeting(db, real, quiet, later, Date.now, fake);
  assert.equal(again.status, 'already met');
  assert.equal(sql(`select balance from move_bank where staff = '${BOSS}'`), bankNow);

  // ---- The patrol runs once: it judges Eve's post (the only one on the beat under no visit) and starts a visit on it. ----
  scene.patrolPost = eveQuiet;
  const patrolled = await runPatrols(db, real, quiet);
  assert.equal(patrolled.status, 'ok');
  const mineP = patrolled.status === 'ok' ? patrolled.patrols.filter((p) => p.patrol === patrol.id) : [];
  assert.equal(mineP.length, 1, JSON.stringify(patrolled));
  assert.deepEqual([mineP[0]!.status, mineP[0]!.findings, mineP[0]!.visits], ['judged', 1, 1], JSON.stringify(mineP[0]));
  const [eveV] = visitsOn(eveQuiet);
  assert.ok(eveV);
  assert.deepEqual([eveV.mod, eveV.payload.charges[0].cause], [MONITOR, 'patrol']);
  const patrolRow = row(`select to_jsonb(p) from patrols p where p.id = ${patrol.id}`);
  assert.deepEqual([patrolRow.outcome.findings, patrolRow.outcome.visits, patrolRow.sampled.length], [1, 1, 1], 'the patrol row says what it sampled and started');
  assert.notEqual(sql(`select ran_at from patrols where id = ${patrol.id}`), '', 'the patrol is claimed');
  const patrolCalls = log.filter((c) => c.duty === 'patrolJudge').length;
  const reran = await runPatrols(db, real, quiet);
  assert.equal(reran.status, 'ok');
  assert.equal(reran.status === 'ok' && reran.patrols.filter((p) => p.patrol === patrol.id).length, 0, 'a claimed patrol is not run again');
  assert.equal(log.filter((c) => c.duty === 'patrolJudge').length, patrolCalls, 'and no model is called for it');
  assert.equal(visitsOn(eveQuiet).length, 1);

  // ---- The ledger holds a row for every model call the day made, with its duty and its Mod. ----
  const ledger = rows(`select duty, staff, outcome, model from model_calls where id > ${ledgerBefore} order by id`);
  assert.ok(ledger.every((l) => l.outcome === 'ok'), JSON.stringify(ledger));
  const key = (x: Record<string, any>) => `${x.duty}:${x.staff}`;
  assert.deepEqual(ledger.map(key).sort(), log.map(key).sort(), 'one ledger row for each call the fake model answered');
  const counts = (duty: string) => ledger.filter((l) => l.duty === duty).length;
  assert.deepEqual(['meeting', 'filing', 'reportJudge', 'appeal', 'patrolJudge'].map(counts), [2, 4, 1, 2, 1]);
  assert.deepEqual(ledger.filter((l) => l.duty === 'appeal').map((l) => l.staff).sort(), [BOSS, HYPE].sort(), 'the Boss heard the ban and the Mod the infraction');
  assert.equal(ledger.find((l) => l.duty === 'meeting')!.model, tiers.strong);
  assert.ok(ledger.filter((l) => l.duty !== 'meeting').every((l) => l.model === tiers.light));
  assert.equal(sql(`select count(*) from model_calls where meeting = ${meeting1} and duty = 'meeting'`), '1', 'the meeting\'s row names its meeting');
});
