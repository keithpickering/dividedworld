/**
 * An instance exported and imported into a fresh database is the same instance, table by
 * table ("Portable by construction"; plan Task 15): tools/export-instance.mjs and
 * tools/import-instance.mjs, run as an admin would run them, on the scratch database
 * tools/test-sql.mjs made and on a second one made here from the migrations alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scratchUrl, sql } from './psql-db.ts';

/** The tables the migrations fill themselves (tools/instance-files.mjs), held below to what a fresh database holds. */
const files = '../../../tools/instance-files.mjs';
const { MIGRATION_DATA } = (await import(files)) as { MIGRATION_DATA: readonly string[] };

const root = path.resolve(import.meta.dirname, '../../..');
const migrations = path.join(root, 'supabase/migrations');

const psqlOn = (url: string, text: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qtAX', url, '-f', '-'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** Every table of ours and the logins beside them, each as one sorted JSON value. */
const contents = (url: string): Map<string, string> => {
  const tables = psqlOn(url, `select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' union all select 'auth.users' union all select 'auth.identities' where to_regclass('auth.identities') is not null order by 1`).split('\n');
  return new Map(tables.map((t) => [t, psqlOn(url, `select coalesce(jsonb_agg(x order by x::text), '[]')::text from (select to_jsonb(t) x from ${t} t) s`)]));
};

/** The secret key a tool calls Storage with: in its environment, never on its command line, and never printed. */
const STORAGE_KEY = 'sb_secret_sErViCe-kEy-for-storage';
/** A legacy JWT-shaped key, which the tools refuse before any request. */
const LEGACY_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig';
/** A tool, run as an admin runs it; spawned, not run synchronously, so the fake Storage below answers it. */
const run = (tool: string, args: string[], key = STORAGE_KEY) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(process.execPath, [path.join(root, 'tools', tool), ...args], { env: { ...process.env, KAYFABB_STORAGE_KEY: key, KAYFABB_STORAGE_TIMEOUT_MS: '500' } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

/** Supabase Storage's two object endpoints, in memory: each server is one project's buckets. */
async function fakeStorage() {
  const objects = new Map<string, Buffer>();
  const seen: string[] = [];
  /** What the next requests meet first: a 503, or no answer at all. */
  const trouble: ('unavailable' | 'silent')[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      // As the gateway takes a secret key: in apikey, which is the whole of the request's credentials.
      seen.push(`${req.method} ${req.url} ${req.headers.apikey === STORAGE_KEY && req.headers.authorization === undefined ? 'keyed' : 'unkeyed'}`);
      const next = trouble.shift();
      if (next === 'unavailable') { res.writeHead(503).end(); return; }
      if (next === 'silent') return;
      const m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(req.url ?? '');
      if (!m || req.headers.apikey !== STORAGE_KEY) { res.writeHead(403).end(); return; }
      const key = `${m[1]}/${decodeURIComponent(m[2]!)}`;
      if (req.method === 'GET') { const o = objects.get(key); if (!o) { res.writeHead(400).end('{"error":"not_found"}'); return; } res.writeHead(200).end(o); return; }
      if (req.method === 'POST') {
        // As Storage: never over a file unless asked to, and a name taken is a 400 with its word.
        if (req.headers['x-upsert'] !== 'false' || req.headers['content-type'] !== 'image/webp') { res.writeHead(422).end(); return; }
        if (objects.has(key)) { res.writeHead(400).end('{"error":"Duplicate"}'); return; }
        objects.set(key, Buffer.concat(chunks)); res.writeHead(200).end('{}'); return;
      }
      res.writeHead(405).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, objects, seen, trouble, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test('an instance exported and imported into a fresh database is the same instance, table by table', async () => {
  const from = scratchUrl();
  /** The card an admin ends after the cast's last card (0092): its play's id, fixed here so the assertions below name it. */
  const endedPlay = '7d4e2f9a-1c3b-4e8d-9a6f-0b5c2e8d1f37';
  // A cast with every kind of thing in it: players, characters, Acts, reactions, cards and
  // their state, invites, a settlement (e2e/0001 settled), and a reveal.
  sql(`
    do $$
    declare
      ann uuid := tests.account('exp-ann'); bob uuid := tests.account('exp-bob');
      a uuid := tests.character(ann, 'Exported A'); b uuid := tests.character(bob, 'Exported B');
      t uuid := tests.thread('Exported thread');
      p uuid := tests.post(a, t, 'Carried across, with a backslash \\ and a tab' || chr(9) || 'and a line' || chr(10) || 'break.');
      play uuid; move_post uuid; pass_post uuid; cond_post uuid; spr_post uuid; take_post uuid; timed_post uuid; timed_set uuid;
      moved uuid; ended uuid; kept uuid; gen uuid := (select id from boards order by created_at, slug limit 1);
    begin
      perform tests.post(b, t, 'A reply, counted on the thread and on its author');
      insert into reactions (act, reactor_account, reactor_character, kind, slot) values (p, bob, b, 'fire', 1);
      insert into reaction_tallies (act, kind, count) values (p, 'fire', 1);
      insert into wallets (account, balance) values (ann, 0) on conflict (account) do nothing;
      insert into card_ledger (account, card, kind, price) values (ann, 'splat', 'bought', 100);
      -- Gear (0150): a kind, a copy found and a copy granted, and a piece worn, each carried across as it was.
      insert into gear_kinds (key, rarity) values ('expgear', 'uncommon');
      -- Random Events (0152): a gear event and a card event, each with its found row naming it, the account's last roll and the instance's event lines.
      insert into event_lines (key, outcome, text) values ('exp-line', 'line', 'Carried across.'), ('exp-gear-line', 'gear', 'Found a thing.');
      insert into random_events (id, account, character, outcome, item, line) values
        ('00000000-0000-4000-8000-0000000000e2', ann, a, 'gear', 'expgear', 'exp-gear-line'), ('00000000-0000-4000-8000-0000000000e3', ann, a, 'card', 'splat', 'exp-line');
      insert into random_event_rolls (account, rolled_at) values (ann, '2000-01-02T03:04:05Z');
      insert into gear_ledger (account, gear, kind, event) values (ann, 'expgear', 'found', '00000000-0000-4000-8000-0000000000e2');
      insert into card_ledger (account, card, kind, price, event) values (ann, 'splat', 'found', 0, '00000000-0000-4000-8000-0000000000e3');
      insert into gear_ledger (account, gear, kind) values (ann, 'expgear', 'granted');
      insert into gear_worn (character, layer, gear, x, y, w, turn) values (a, 2, 'expgear', 0.25, 0.75, 0.5, -30);
      -- Trophies (0151): an instance's kind with a place, a belt, and a kind an admin made with its picture's key; an award each by an admin, the season and the Boss (naming the post as its move Act),
      -- the admin's taken back, and the Boss's shown on a postbit. Each is carried as it was, and the picture is a file the export fetches from the trophies bucket.
      insert into trophy_kinds (key, name, line, belt, season_place) values ('exptrophy', 'Exported Trophy', 'Carried across.', false, null), ('expbelt', 'Exported Belt', null, true, null);
      insert into trophy_kinds (key, name, made_by, art) values ('made-00000000-0000-4000-8000-0000000000e1', 'Exported Made', ann, 'exp-trophy.webp');
      insert into trophy_awards (id, trophy, character, by, line) values ('00000000-0000-4000-8000-0000000000a1', 'made-00000000-0000-4000-8000-0000000000e1', a, 'admin', 'By hand.');
      insert into trophy_awards (id, trophy, character, by, season) values ('00000000-0000-4000-8000-0000000000a2', 'exptrophy', b, 'season', (select id from seasons order by number limit 1));
      insert into trophy_awards (id, trophy, character, by, act) values ('00000000-0000-4000-8000-0000000000a3', 'expbelt', a, 'boss', p);
      insert into trophy_reversals (award, by) values ('00000000-0000-4000-8000-0000000000a1', ann);
      insert into trophies_shown (character, award, position) values (a, '00000000-0000-4000-8000-0000000000a3', 0);
      insert into trophy_award_failures (move_act, error) values (p, 'a failure kept for an admin (23514)');
      insert into invites (code_hash, inviter) values (invite_hash('exported'), ann);
      insert into acts (character, kind, thread, target_act_id, payload) values (a, 'card', t, p, '{"card": "splat", "config": {"color": "red"}}') returning id into play;
      insert into effect_state (play, state, saved_by) values (play, '{"strokes": []}', b);
      -- A second play over the first (0072): its moment, and the first's save copied into it as a layer, written by the trigger.
      insert into acts (character, kind, thread, target_act_id, payload) values (a, 'card', t, p, '{"card": "sweetie", "config": {}}');
      -- A card that writes (0149): a post carrying three plays, the first with its tail, the second still waiting, the third failed and refunded; the
      -- queue, the texts and the refund are carried as they were, so an imported forum's tails are the same words and never made again.
      declare wp uuid := tests.post(a, t, 'A post that carries a tail.'); w1 uuid; w2 uuid; w3 uuid;
      begin
        insert into card_kinds (key, name, alignment, rarity, play, stack, writes) values ('expwrite', 'Exported Writer', 'salty', 'uncommon', 'cast', 3, true);
        insert into acts (character, kind, thread, target_act_id, payload) values (a, 'card', t, wp, '{"card": "expwrite", "message": "", "config": {}, "layer": 1}') returning id into w1;
        insert into acts (character, kind, thread, target_act_id, payload) values (a, 'card', t, wp, '{"card": "expwrite", "message": "", "config": {}, "layer": 2}') returning id into w2;
        insert into acts (character, kind, thread, target_act_id, payload) values (a, 'card', t, wp, '{"card": "expwrite", "message": "", "config": {}, "layer": 3}') returning id into w3;
        perform finish_card_write(w1, wp, 'A tail, carried across.', null);
        perform finish_card_write(w3, wp, null, 'scrub:word');
        insert into card_write_refunds (play, amount) values (w3, 40) on conflict on constraint card_write_refunds_pkey do update set amount = 40;
      end;
      -- A trap of the export's own (#136 F1): Ann sets a Trap Card naming Blot on her post through set_card, and Bob's Blot cast on it
      -- through play_card is caught, so a face_down row, a spring and a caught card are the cast's own, by their ids, below.
      insert into card_kinds (key, name, alignment, rarity, play, trap) values ('expcatch', 'Exported Catcher', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}');
      insert into card_ledger (account, card, kind, price) values (ann, 'expcatch', 'bought', 0), (bob, 'blot', 'bought', 0);
      perform set_card(ann, 'expcatch', a, p, '{"card": "blot"}', 0, 'blot');
      perform play_card(bob, 'blot', b, p, '{}', 0, '');
      -- A Move set face down with a phrase (0142, Autocorrect's kind): its back holds the phrase and no catch, set on a post of its own.
      -- A Hall Pass set face down on another post (0142): a Mod Bot's visit to that post springs it, and the visit ends (0105, 0110).
      insert into card_kinds (key, name, alignment, rarity, play, trap, reaches)
      values ('expauto', 'Exported Autocorrect', 'pepperoni', 'common', 'cast', null, '{post}'),
             ('exppass', 'Exported Hall Pass', 'sweet', 'uncommon', 'set', '{"trigger": {"on": "visit"}}', '{post}');
      insert into card_ledger (account, card, kind, price) values (ann, 'expauto', 'bought', 0), (ann, 'exppass', 'bought', 0);
      move_post := tests.post(a, t, 'Carried across, and phrased.');
      perform set_card(ann, 'expauto', a, move_post, '{"phrase": "carried across"}', 0, null, 'carried across');
      -- Bob quotes the post through the real post(), with the phrase in his own words: the quote springs the Move onto his post (spring_traps, 0142).
      perform tests.become((select owner from characters where id = b));
      perform post(t, b, 'Carried across, quoted back.', move_post);
      perform tests.unbecome();
      pass_post := tests.post(a, t, 'Under a Hall Pass.');
      perform set_card(ann, 'exppass', a, pass_post, '{}', 0);
      -- Two conditioned Moves (0144, Tasks 4 and 5). One is an Anyone-but Move with a passage, set on a post of its own and left unsprung: its passage and list are in its face_down row, and
      -- it holds no catch. The other is an Only-these Move with a passage, set on a post that Bob quotes with a real quote holding the passage: the quote springs it, and its spring
      -- names the passage it matched and the quoter (its when and for).
      insert into card_kinds (key, name, alignment, rarity, play, trap, reaches)
      values ('expcond', 'Exported Condition', 'pepperoni', 'common', 'cast', null, '{post}'),
             ('expquote', 'Exported Quote Move', 'pepperoni', 'common', 'cast', null, '{post}');
      insert into card_ledger (account, card, kind, price) values (ann, 'expcond', 'bought', 0), (ann, 'expquote', 'bought', 0);
      cond_post := tests.post(a, t, 'Conditioned words, set plainly.');
      perform set_card(ann, 'expcond', a, cond_post, '{}', 0, null, null, 'conditioned words', array[a], true);
      spr_post := tests.post(a, t, 'Passage quoted, and more after it.');
      perform set_card(ann, 'expquote', a, spr_post, '{}', 0, null, null, 'passage quoted', array[b], false);
      perform tests.become((select owner from characters where id = b));
      perform post(t, b, '[quote=' || spr_post || ']Passage quoted[/quote] Bob, quoting.', spr_post);
      perform tests.unbecome();
      -- The card types (0148): a use card whose Gimmick is a ward by flavor and whose time up is a day; a Reversal with a match on its trap.
      insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values
        ('expward', 'Exported Ward', 'salty', 'common', 'use', null, '{post}', interval '1 day', '{"kind": "ward", "flavors": ["salty"]}'),
        ('expmatch', 'Exported Match Reversal', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty"]}}', '{post}', null, null),
        ('exptime', 'Exported Timed Reversal', 'sweet', 'common', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null);
      insert into card_ledger (account, card, kind, price) values (ann, 'expmatch', 'bought', 0), (ann, 'exptime', 'bought', 0);
      -- A Reversal set face down on a post of its own and taken back by its setter (take_back), which writes the take-back Act and the returned row beside it.
      take_post := tests.post(a, t, 'Taken back, under a Reversal.');
      perform set_card(ann, 'expmatch', a, take_post, '{}', 0);
      perform take_back(ann, a, (select f.play from face_down f where f.post = take_post));
      -- A Reversal whose time passed unsprung: its back is a face_down row that ended before now, as place_set writes one with the set Act it names.
      timed_post := tests.post(a, t, 'Left to its time.');
      insert into acts (character, kind, thread, target_act_id, payload) values (a, 'set', t, timed_post, '{}') returning id into timed_set;
      insert into face_down (play, account, card, config, post, thread, round, ends_at) values (timed_set, ann, 'exptime', '{}', timed_post, t, 1, now() - interval '1 hour');
      -- A pack bought from its slot (0139): the pack's kind, its slot, the packs row with the pulls as they stood, and a pulled row per card.
      insert into card_kinds (key, name, alignment, rarity) values ('exppull', 'Exported Pull', 'sweet', 'common');
      insert into pack_kinds (key, pulls, leaves) values ('exppack', '[{"weights": {"common": 1}}, {"weights": {"common": 1}}]', '{}');
      insert into machine_slots (position, pack, availability, price) values (9500, 'exppack', 'onSale', 250);
      update wallets set balance = 250 where account = ann;
      perform buy_pack(ann, (select id from machine_slots where pack = 'exppack'), 250);
      -- One more card, played as the sweetie above is, for an admin to end after the caught one (0092); its id is fixed in the test.
      insert into acts (id, character, kind, thread, target_act_id, payload) values ('${endedPlay}', a, 'card', t, p, '{"card": "sweetie", "config": {}}');
      -- What the screens keep: a release, reading, the mask read through, view counts, preferences, a profile with an
      -- avatar, and an admin.
      insert into effect_releases (account, play) values (bob, play);
      insert into reading (account, thread, furthest_seq, first_character) values (bob, t, 1, b);
      insert into thread_reads (thread, reader) values (t, b);
      -- A follow chosen over the default (0059), an alert written with the Act it is about (0058), and the account's two marks (0057).
      insert into thread_follows (account, thread, follow) values (bob, t, true), (ann, t, false);
      insert into alerts (account, kind, act, character) values (ann, 'quote', p, a);
      -- A hint fired for Ann's post (0065): the pattern it fired once, carried so a hint is not fired again after an import.
      insert into hints_fired (act, pattern) values (p, 'divisive');
      -- Presence: a mask browsing a thread, and a mask hidden from the online lists.
      insert into presence (character, place_kind, place, board, place_since, online_since, seen_at) values (b, 'thread', t, (select board from threads where id = t), now(), now(), now());
      insert into presence_hidden (character) values (a);
      perform count_thread_views();
      -- Tilt turned on (0093), motion snappy (0112) and a mode chosen beside a theme (0115), so values other than the columns' defaults must survive the round trip.
      insert into account_preferences (account, theme, postbit, motion, smoke, contrast, text_size, tilt, effects, mode, cards_met, alerts_seen_at, settlement_seen, toasts, welcomed_at, tips, tips_seen) values (ann, 'dusk', 'stacked', 'snappy', 'low', 'high', 150, 'on', 'bright', 'light', '{whoops,stick-around}', now() - interval '1 hour', now() - interval '2 hours', '{quote,hint}', now() - interval '3 hours', 'off', '{tour-plate,grid}');
      -- A custom pronoun set (0124), not the column's default, so the round trip has to carry it.
      insert into character_profiles (character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pronouns)
      values (a, 'Exported', '[b]sig[/b]', 'exp-sq.webp', 'exp-pt.webp', '{"x": 0, "y": 0, "w": 1, "h": 0.5}', '{"x": 0, "y": 0, "w": 0.5, "h": 1}',
        '{"subject": "xe", "object": "xem", "determiner": "xyr", "possessive": "xyrs", "reflexive": "xemself", "plural": false}');
      -- An original 0025 handed to the sweep: a row the export carries, naming a file it does not.
      insert into avatar_orphans (key) values ('exp-src.webp');
      insert into admins (account) values (ann);
      -- An admin ends that card with reverse_card, as ann, the admin (0092); the play's id is the one planted above.
      perform tests.become(ann);
      perform reverse_card('${endedPlay}');
      perform tests.unbecome();
      -- A kept estimate, a waiting Turn, a standing, and a class's total in e2e/0001's settlement.
      insert into estimates (account, made_at, window_from, answer) values (ann, now(), now(), '{"entries": [], "lines": [], "asOf": null, "freshAfter": null}');
      -- A waiting Turn naming the class it Turns to and from (0028), passed over once by a reveal (its due_at, 0074), a later Turn
      -- that waited before it took effect (class_history.due_at, 0074), and a character's reveal of its class (0027).
      insert into pending_turns (character, class_key, loudness, show_from, show_to, due_at) values (b, 'heel', 'announced', true, true, now() - interval '1 hour');
      insert into class_history (character, class_key, started_at, due_at) values (a, 'heel', now() + interval '1 day', now());
      perform write_unmask(a, t, 'act', now(), 'Exported, and unmasked.');
      insert into standings (character, season, amount) values (a, (select max(id) from seasons), 10) on conflict (season, character) do update set amount = excluded.amount;
      insert into settlement_class_totals (settlement, class_key, amount) select max(id), 'face', 10 from settlements on conflict do nothing;
      -- A share of a ledger line in e2e/0001's settlement (0034), on Ann's post.
      insert into ledger_shares (ledger, act, quadrant, amount) select max(id), p, 'excitedPositive', 10 from ledger;
      -- A ledger line with the numbers its words state (0073), and a settle run's claim on a window long settled.
      insert into ledger (settlement, account, character, reason, amount, params) select max(id), ann, a, 'lurker.postedTooMuch', -10, '{"lurker.postsAllowed": 3}' from settlements;
      insert into settlement_claims (window_start, window_end, claimed_at) values ('2000-01-01T00:00:00Z', '2000-01-02T00:00:00Z', '2000-01-02T00:00:00Z') on conflict do nothing;
      -- The first settlement made with its shares kept (0037): every one here.
      insert into ledger_shares_kept (from_settlement) values (1);
      -- A model call in the ledger (0042): the instance's own bookkeeping, carried across with the rest.
      -- A meeting, the Boss's memory and profile from it, and its move bank (0044); the call above names the meeting.
      insert into meetings (started_at, slot, finished_at, outcome, bank_before, bank_after, record) values (now() - interval '1 minute', now() - interval '1 minute', now(), 'ok', 1, 0, '{"trims": []}');
      perform record_model_call(jsonb_build_object('duty', 'meeting', 'staff', 'director', 'provider', 'anthropic', 'model', 'claude-opus-5-5', 'service_tier', 'standard', 'input_tokens', 1200, 'output_tokens', 300, 'cost_microdollars', 10800, 'outcome', 'rejected', 'predicate', 'atMost(6)', 'trims', '[{"path": "moves", "predicate": "atMost(6)", "before": 7, "after": 6}]'::jsonb, 'retries', 1, 'meeting', (select max(id) from meetings)));
      -- A Boss and a Mod Bot (0043, 0082): personas with no owner, the bot an office row's mod, the Boss named by the season and writing an Act.
      insert into characters (name, staff, staff_kind, debuted_at) values ('Exported Boss', 'exp-boss', 'persona', now()), ('Exported Bot', 'exp-bot', 'persona', now());
      insert into staff_offices (staff, office, cause) values ('exp-bot', 'mod', 'seed');
      update seasons set boss = 'exp-boss' where ends_at is null;
      insert into staff_memory (staff, meeting, body) select 'exp-boss', max(id), '{"opinions": [], "grudges": []}' from meetings;
      insert into staff_profiles (staff, meeting, interests, favorites, mood, signature) select 'exp-boss', max(id), '{pie}', array[a], 'smug', 'It is decided.' from meetings;
      insert into move_bank (staff, balance, as_of) values ('exp-boss', 3.5, now());
      perform write_staff_act('exp-boss', 'post', t, null, '{"body": "Carried across, with no account behind it."}');
      -- A note the Boss wrote with that post (0085).
      insert into staff_notes (staff, act, body) select 'exp-boss', id, 'A thought to itself, carried across.' from acts where character = (select id from characters where staff = 'exp-boss') and kind = 'post' order by created_at desc limit 1;
      -- The day it posted, in the pool's ledger (0089).
      insert into pool_spends (day, staff, trigger, post_act, record) select '2030-01-07', 'exp-boss', 'named', id, '{"trims": []}' from acts where character = (select id from characters where staff = 'exp-boss') and kind = 'post' order by created_at desc limit 1;
      -- A handover's to-do an admin dismissed (0090): the handover is a Boss changing, the season it opened.
      insert into season_handovers (season, outgoing, boss, how) select (select id from seasons where ends_at is null), 'exp-boss', 'exp-bot', 'rotation' on conflict (season) do nothing;
      insert into handover_dismissals (season, admin) select season, ann from season_handovers order by season limit 1;
      -- A run's claim on a day (0089), which the pool's schedule would have taken.
      insert into pool_run_claims (day) values ('2030-01-07');
      -- The developer persona (0062): a staff character of its own kind, its avatar key, the updates thread The System's board never lists (updatesThread),
      -- and an update by it, written as post_update writes one.
      perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
        'developer', jsonb_build_object('name', 'Exported Gabe', 'title', 'Made this. Sorry.', 'avatar', 'gabe')));
      perform set_config('kayfabb.staff_writer', 'on', true);
      perform set_config('kayfabb.update_writer', 'on', true);
      insert into acts (character, kind, thread, payload)
      select c.id, 'update', (select (v.value #>> '{}')::uuid from settings v where v.key = 'updatesThread'),
             '{"title": "Exported update", "body": "Carried across.", "changes": [{"label": "Export", "text": "round-trips."}]}'
      from characters c where c.staff_kind = 'developer';
      perform set_config('kayfabb.staff_writer', '', true);
      perform set_config('kayfabb.update_writer', '', true);
      -- How players reach an admin (0081): the setting adminContact, written as set_admin_contact stores it, carried across with the rest of settings.
      insert into settings (key, value) values ('adminContact', '[{"label": "Exported mail", "href": "mailto:admin@export.invalid"}, {"label": "Exported chat", "href": "https://chat.export.invalid/admin"}]')
      on conflict (key) do update set value = excluded.value;
      -- The moves it can make and the demands it can set (0046, seeded as the engine lists them), a rename ended and one in force with
      -- its queue entry, so that the catalogs, the queue and the moves in force are carried across with the Acts that name them.
      insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do nothing;
      insert into demand_kinds (key) values ('postsOnBoard') on conflict (key) do nothing;
      -- A move kind whose words SQL fills with a derived token (0129), so the column is carried across.
      insert into move_kinds (key, structural, derived) values ('conferGroup', false, '{groupName}') on conflict (key) do update set derived = excluded.derived;
      -- The member groups (0128): a rung and a conferred group, carried across with the rest of the instance's catalogs.
      insert into group_kinds (key, name, color, source, rung, condition, at_least) values ('expPosts', 'Exported Posts', '#7a7a7a', 'ladder', 98, 'posts', 1) on conflict (key) do nothing;
      insert into group_kinds (key, name, color, stripe, source, tone) values ('expTrial', 'Exported Trial', '#d2691e', true, 'conferred', 'punishment') on conflict (key) do nothing;
      moved := (write_staff_act('exp-boss', 'move', t, null, jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.', 'expires_at', now() + interval '2 days',
        'params', jsonb_build_object('board', gen, 'name', 'Exported Old Palace', 'premise', 'p', 'description', 'd'))) ->> 'id')::uuid;
      ended := (end_move(moved, 'expired', 'tick') ->> 'act')::uuid;
      kept := (write_staff_act('exp-boss', 'move', t, null, jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.', 'expires_at', now() + interval '2 days',
        'params', jsonb_build_object('board', gen, 'name', 'Exported Palace', 'premise', 'p', 'description', 'd'),
        'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', gen, 'count', 2)))) ->> 'id')::uuid;
      -- Its cause (0106): the Act that drew a move, carried across with the row.
      insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, landed_act, cause_act)
      select max(m.id), 'exp-boss', 'renameBoard', '{"board": "x", "name": "Exported Palace"}', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', gen, 'count', 2)), 'Because the toast was cold.',
             now() - interval '1 day', now() + interval '2 days', true, kept, p from meetings m;
      -- An apology to the move in force (0129), carried across with the Acts it names.
      insert into apologies (move_act, apology_act, character, state) values (kept, p, b, 'pending');
      -- A Mod's order from that meeting (0103), and a visit by the Mod on the post with its open row (0105), one failed attempt to draw a visit and one to file it, so the
      -- tables the Mod Bots add are carried across with the Acts that name them. The order hands out nothing: an
      -- allowance left unspent here would be returned to the Boss's bank by e2e/0011's meeting, which counts the bank.
      insert into staff_orders (meeting, staff, boards, order_line, allowance) select max(id), 'exp-bot', '{}', 'Watch the boards.', 0 from meetings;
      perform write_staff_act('exp-bot', 'visit', t, p, jsonb_build_object('charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', gen, 'band', 'minor', 'cause', 'rule', 'about_act', p::text)),
        'ends_at', now() + interval '3 hours', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'));
      -- The visit to the Hall Pass's post, started as the Mod Bots start one (start_visit, 0107): its start springs the back, and the visit ends.
      perform start_visit(pass_post, 'exp-bot', jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'patrol',
        'about_act', pass_post, 'predicate', 'noAllCaps', 'rule', 'Rule 1: no all-caps posts'));
      -- The Mod Bots' settings (so the filing run's job exists, 0106) and one judged call's record.
      insert into settings (key, value) values ('modBots', '{"allowanceMost": 3, "ruleDaysMost": 7, "visitHours": {"least": 2, "most": 12}, "patrolsPerDay": 6, "patrolSample": 5, "reportPrice": 25, "reportsPerDay": 3, "judgmentsPerDay": 60, "filingLinesPerDay": 60, "appealPrice": 50, "tailHours": 24, "cap": {"punishments": 3, "days": 7}, "filingCron": "*/5 * * * *", "filingGraceMinutes": 10}')
        on conflict (key) do update set value = excluded.value;
      -- A patrol the Mod made (0110): its meeting, the posts it was shown, a finding dropped at the cap and what came of it, and the record of its call (keyed by the patrol,
      -- which has no Act), carried across with the rows that name them.
      insert into patrols (meeting, n, staff, at, ran_at, sampled, dropped, outcome)
      select max(id), 1, 'exp-bot', now() - interval '1 hour', now() - interval '59 minutes', array[p], jsonb_build_array(jsonb_build_object('post', p, 'why', 'cap', 'staff', 'exp-bot')), '{"findings": 1, "visits": 0, "capped": 1}' from meetings;
      perform record_patrol_call((select max(id) from patrols), 'exp-bot', '{"findings": 1, "trims": [], "dropped": [], "calls": 1}');
      perform record_staff_call(p, 'filing', 'exp-bot', '{"trims": [{"path": "move.expires_in_hours", "predicate": "atMost(168)", "before": 900, "after": 168}], "dropped": [], "calls": 1}');
      -- Two reports of Ann's post by Bob's mask (0107): one answered by the Mod, one refunded, so a report, its verdict, the price paid and returned, and the refund's own
      -- table are carried across with the Acts that name them.
      perform set_config('kayfabb.report_writer', 'on', true);
      insert into acts (character, kind, thread, target_act_id, payload) select b, 'report', t, p, jsonb_build_object('reason', 'Carried across ' || n) from generate_series(1, 2) n;
      perform set_config('kayfabb.report_writer', '', true);
      perform write_staff_act('exp-bot', 'report_verdict', t, r.id, jsonb_build_object('report_act', r.id::text, 'verdict', 'dismissed', 'line', 'Dismissed, and carried across.'))
        from acts r where r.kind = 'report' and r.payload ->> 'reason' = 'Carried across 1';
      insert into wallet_events (account, kind, change, balance_after, ref) select bob, 'report', -25, 0, id from acts where kind = 'report' and payload ->> 'reason' like 'Carried across %';
      insert into report_refunds (report_act, amount) select id, 25 from acts where kind = 'report' and payload ->> 'reason' = 'Carried across 2';
      insert into wallet_events (account, kind, change, balance_after, ref) select bob, 'refund', 25, 25, id from acts where kind = 'report' and payload ->> 'reason' = 'Carried across 2';
      insert into visit_draw_failures (post_act, rule_number, error) values (p, 1, 'planted: carried across');
      insert into visit_file_failures (visit_act, error) select id, 'planted: carried across' from acts where kind = 'visit' and target_act_id = p;
      -- Bob's mask tried that visit and failed, and the tail it left, the visit the tail drew, and a quiz persona's question with its answer (0108): carried across with the
      -- Acts that name them.
      perform set_config('kayfabb.intercept_writer', 'on', true);
      insert into acts (character, kind, thread, target_act_id, payload) select b, 'intercept', t, p, jsonb_build_object('visit_act', v.id, 'kind', 'distraction', 'succeeded', false)
        from acts v where v.kind = 'visit' and v.target_act_id = p;
      perform set_config('kayfabb.intercept_writer', '', true);
      insert into tails (character, staff, intercept_act, until) select b, 'exp-bot', i.id, now() + interval '1 day' from acts i where i.kind = 'intercept' and i.character = b;
      insert into tail_visits (tail, visit_act) select k.id, v.id from tails k, acts v where k.character = b and v.kind = 'visit' and v.target_act_id = p;
      insert into staff_quiz_questions (staff, idx, question, choices, answer) values ('exp-bot', 0, 'Which carries across?', '["The quiz", "Nothing"]', 'The quiz');
      -- An infraction against Ann's mask for her post, her appeal of it, the Mod's ruling, the price paid and returned, and the refund's own table (0109): carried across with the
      -- Acts that name them. (The bar's setting is planted where a database made from the migrations alone has none.)
      insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
      perform infract(a, 'minor', p, 'exp-bot');
      perform set_config('kayfabb.appeal_writer', 'on', true);
      insert into acts (character, kind, thread, target_act_id, payload) select a, 'appeal', t, i.id, '{"plea": "Carried across, and pleading."}' from acts i where i.kind = 'infraction' and i.payload ->> 'character' = a::text;
      perform set_config('kayfabb.appeal_writer', '', true);
      perform write_staff_act('exp-bot', 'appeal_ruling', t, x.id, jsonb_build_object('appeal_act', x.id::text, 'verdict', 'overturned', 'points_delta', -2, 'line', 'Overturned, and carried across.'))
        from acts x where x.kind = 'appeal' and x.character = a;
      insert into wallet_events (account, kind, change, balance_after, ref) select ann, 'appeal', -50, 0, id from acts where kind = 'appeal' and character = a;
      insert into appeal_refunds (appeal_act, amount, why) select id, 50, 'overturned' from acts where kind = 'appeal' and character = a;
      insert into wallet_events (account, kind, change, balance_after, ref) select ann, 'refund', 50, 50, id from acts where kind = 'appeal' and character = a;
      -- The open season revealed at its end, as the settlement of its last window would.
      perform reveal_season((select starts_at from seasons where ends_at is null) + span_interval(setting('seasonLength')));
      -- An earlier season's reveal thread, as the seasons before 0099 wrote them: the season points at its header and the thread is unlisted (0063).
      declare old_thread uuid; old_head uuid;
      begin
        insert into threads (board, title) values (system_board(), 'Season 0: The Reveal') returning id into old_thread;
        insert into acts (character, kind, thread, payload) values (null, 'reveal', old_thread, '{"season": 0, "body": "Every mask.", "characters": 0}') returning id into old_head;
        update seasons set reveal_act = old_head where number = (select max(number) - 1 from seasons);
      end;
    end $$;
    -- A table holding what the instance's own do not yet: a type whose name has a comma, an
    -- array, an astral character. Made here and in the fresh database alike.
    create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);
    insert into public.export_probe values (1, 12.50, array['a,b', 'q"uote', null], 'astral 😀 and \\. alone');`);
  const before = contents(from);
  // The staff roster's tables hold a row in the fixture, so the comparison below carries each (an empty table would round-trip as well, and prove nothing).
  for (const t of ['staff_offices', 'staff_notes', 'pool_spends', 'pool_run_claims', 'handover_dismissals', 'staff_call_records', 'patrols', 'report_refunds', 'appeal_refunds', 'tails', 'tail_visits', 'staff_quiz_questions', 'season_results', 'apologies', 'card_texts', 'card_writes', 'card_write_refunds']) {
    const rows = before.get(`public.${t}`);
    assert.ok(rows !== undefined && rows !== '[]', `${t} holds a row in the fixture (got ${rows === undefined ? 'no such table' : rows})`);
  }
  // The cast's own set, its spring and the card it caught, by their ids, so the round trip is shown to carry a trap's rows
  // whatever else this database holds (#136 F1).
  const trapIds = sql(`select f.play || '|' || s.id || '|' || k.id from face_down f join auth.users u on u.id = f.account and u.email = 'exp-ann@test.invalid'
    join acts s on s.kind = 'spring' and s.payload ->> 'set' = f.play::text join acts k on k.kind = 'card' and k.payload ->> 'caught' = f.play::text`);
  const [setPlay, springAct, caughtAct] = trapIds.split('|');
  assert.ok(setPlay && springAct && caughtAct, `the cast holds a set, its spring and the card it caught: "${trapIds}"`);
  // The Move set with its phrase, the Hall Pass a visit ended and its spring, and the caught card's ledger row, each read as the seed made it (0142).
  const moveSet = sql(`select play from face_down where card = 'expauto'`);
  const passSet = sql(`select play from face_down where card = 'exppass'`);
  assert.ok(moveSet && passSet, 'the Move and the Hall Pass are set face down');
  assert.equal(sql(`select phrase || '|' || coalesce(catches, '-') from face_down where play = '${moveSet}'`), 'carried across|-', 'a Move holds its phrase and no catch');
  assert.equal(sql(`select catches || '|' || coalesce(phrase, '-') from face_down where play = '${setPlay}'`), 'blot|-', 'a Trap Card holds its catch and no phrase');
  assert.equal(sql(`select count(*) from card_ledger l join auth.users u on u.id = l.account and u.email = 'exp-ann@test.invalid' where l.kind = 'caught' and l.card = 'blot'`), '1', 'the caught card is in the setter\'s ledger');
  assert.equal(sql(`select payload ->> 'did' from acts where kind = 'spring' and payload ->> 'set' = '${passSet}'`), 'ended', 'the Hall Pass spring says the visit ended');
  assert.equal(sql(`select payload ->> 'did' from acts where kind = 'spring' and payload ->> 'set' = '${moveSet}'`), 'landed', 'the quote springs the Move');
  assert.equal(sql(`select count(*) from acts where kind = 'card' and payload ->> 'card' = 'expauto' and payload ->> 'spring' is not null`), '1', 'the Move lands as a card Act marked as its spring');
  // The conditioned backs (0144, Tasks 4 and 5): an Anyone-but Move with a passage, set on a post of its own, and an Only-these Move whose quote springs it, with the spring's when and for.
  const condSet = sql(`select play from face_down where card = 'expcond'`);
  const quoteSet = sql(`select play from face_down where card = 'expquote'`);
  const quoteSpring = sql(`select id from acts where kind = 'spring' and payload ->> 'set' = '${quoteSet}'`);
  assert.ok(condSet && quoteSet && quoteSpring, 'the Anyone-but Move is set, and a quote springs the Only-these Move');
  assert.equal(sql(`select passage || '|' || who_except::text || '|' || cardinality(who)::text || '|' || coalesce(catches, '-') from face_down where play = '${condSet}'`), 'conditioned words|true|1|-', 'an Anyone-but Move holds its passage and its list, and no catch');
  assert.equal(sql(`select (payload -> 'when')::text || '|' || (payload ->> 'for' = (select id from characters where name = 'Exported B')::text) from acts where id = '${quoteSpring}'`), '{"passage": "passage quoted"}|true', 'the spring names the passage it matched and the quoter');
  // The take-back (0148): the Reversal is returned to its setter's ledger, and its take-back Act names the back; the timed back is a face_down row whose time passed.
  assert.equal(sql(`select count(*) from card_ledger l join auth.users u on u.id = l.account and u.email = 'exp-ann@test.invalid' where l.kind = 'returned' and l.card = 'expmatch'`), '1', 'the taken-back Reversal is returned to the setter\'s ledger');
  assert.equal(sql(`select count(*) from acts where kind = 'take_back' and payload ->> 'set' in (select f.play::text from face_down f where f.card = 'expmatch')`), '1', 'the take-back Act names the back it takes back');
  assert.equal(sql(`select ends_at <= now() from face_down where card = 'exptime'`), 't', 'a back whose time passed is held as ended');
  // Every table of ours holds a row to carry across, read from the database rather than listed
  // here, so a table a later change adds is seeded or the round trip goes red ("Two lists that
  // must agree are one list"); the migrations' own data is held to a fresh database below.
  const empty = [...before].filter(([t, rows]) => rows === '[]' && !MIGRATION_DATA.includes(t)).map(([t]) => t);
  assert.deepEqual(empty, [], 'each table should hold something to carry across');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-export-'));
  const fresh = new URL(from);
  const name = `${fresh.pathname.slice(1)}_imported`;
  const server = new URL(from);
  server.pathname = '/postgres';
  fresh.pathname = `/${name}`;
  psqlOn(server.toString(), `create database ${name};`);
  // The old project's Storage holds the avatar's two files; the new project's starts empty.
  const oldStore = await fakeStorage();
  const newStore = await fakeStorage();
  const avatar = { 'avatars/exp-sq.webp': Buffer.from('RIFF-sq'), 'avatars/exp-pt.webp': Buffer.from('RIFF-pt') };
  // And the trophy art an admin stored, in the bucket of its own: the files a row of any bucket names are the export's.
  const files = { ...avatar, 'trophies/exp-trophy.webp': Buffer.from('RIFF-trophy') };
  for (const [k, v] of Object.entries(files)) oldStore.objects.set(k, v);
  try {
    // Each tool names the database it touches and refuses one a URL does not name.
    const unnamed = new URL(from);
    unnamed.pathname = '';
    const nowhere = await run('export-instance.mjs', ['--from', unnamed.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(nowhere.status, 0);
    assert.match(nowhere.stderr, /names no database/);
    const steered = await run('export-instance.mjs', ['--from', `${from}?host=elsewhere`, '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(steered.status, 0);
    assert.match(steered.stderr, /host/);
    // A password never reaches the terminal, even one libpq would quote back, nor psql's command line.
    const secret = new URL(from);
    secret.password = 'sEcReT%zz';
    const leaked = await run('export-instance.mjs', ['--from', secret.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(leaked.status, 0);
    assert.doesNotMatch(leaked.stdout + leaked.stderr, /sEcReT/);
    const wrong = new URL(from);
    wrong.password = 'sEcReTwrong';
    wrong.username = 'nobody_here';
    const refusedLogin = await run('export-instance.mjs', ['--from', wrong.toString(), '--to', path.join(dir, 'nowhere')]);
    assert.notEqual(refusedLogin.status, 0);
    assert.doesNotMatch(refusedLogin.stdout + refusedLogin.stderr, /sEcReT/);
    assert.match((await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'back\\slash')])).stderr, /backslash/);
    fs.rmSync(path.join(dir, 'nowhere'), { recursive: true, force: true });

    // An instance holding files is not exported without them.
    const without = await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'without')]);
    assert.notEqual(without.status, 0);
    assert.match(without.stderr, /holds files: give --storage/);
    assert.equal(fs.existsSync(path.join(dir, 'without')), false, 'refused before anything was written');
    // A Storage URL with credentials in it, or one in clear to another machine, is refused.
    assert.match((await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'without'), '--storage', 'https://admin:hunter22@project.test'])).stderr, /carries credentials/);
    assert.match((await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'without'), '--storage', 'http://project.test'])).stderr, /is https, unless it is this machine/);
    // A file a row names that Storage no longer holds says so, and how to go on.
    const kept = oldStore.objects.get('avatars/exp-pt.webp')!;
    oldStore.objects.delete('avatars/exp-pt.webp');
    assert.match((await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'gone'), '--storage', oldStore.url])).stderr, /exp-pt\.webp, which a row names, is not there: it was replaced or removed/);
    oldStore.objects.set('avatars/exp-pt.webp', kept);
    fs.rmSync(path.join(dir, 'gone'), { recursive: true, force: true });
    // The stand-in keys a request by apikey: the key in Authorization alone is refused, as Storage refuses it.
    const byBearer = await fetch(`${oldStore.url}/storage/v1/object/avatars/x.webp`, { headers: { Authorization: `Bearer ${STORAGE_KEY}` } });
    assert.equal(byBearer.status, 403);
    oldStore.seen.length = 0;
    // A legacy key is refused before anything is fetched, by its variable's name, never its value.
    const legacy = await run('export-instance.mjs', ['--from', from, '--to', path.join(dir, 'legacy'), '--storage', oldStore.url], LEGACY_KEY);
    assert.notEqual(legacy.status, 0, 'an export with a legacy key');
    assert.match(legacy.stdout + legacy.stderr, /KAYFABB_STORAGE_KEY is a legacy JWT key; KayfaBB takes the publishable and secret keys/);
    assert.ok(!(legacy.stdout + legacy.stderr).includes(LEGACY_KEY) && !(legacy.stdout + legacy.stderr).includes('eyJ'), 'the output holds no key');
    assert.equal(oldStore.seen.length, 0, `nothing was fetched: ${oldStore.seen.join(', ')}`);
    fs.rmSync(path.join(dir, 'legacy'), { recursive: true, force: true });
    // Storage that is down a moment, and then silent a moment, is asked again.
    oldStore.trouble.push('unavailable', 'silent');
    const exported = await run('export-instance.mjs', ['--from', from, '--to', dir, '--storage', oldStore.url]);
    assert.equal(exported.status, 0, exported.stderr + exported.stdout);
    assert.match(exported.stdout, /exporting from localhost:\d+\/kayfabb_scratch/);
    assert.match(exported.stdout, /the server says it is kayfabb_scratch\w+ on port \d+/);
    assert.match(exported.stdout, /kayfabb_functions_url.*kayfabb_jobs_key/s, 'both Vault secrets are named as not exported');
    assert.match(exported.stdout, /vault\.create_secret\(<the kayfabb_jobs secret key>, 'kayfabb_jobs_key'\)/, 'with how the jobs key is made again');
    assert.doesNotMatch(exported.stdout, /kayfabb_service_key/, 'the old Vault name is read nowhere');
    const again = await run('export-instance.mjs', ['--from', from, '--to', dir, '--storage', oldStore.url]);
    assert.notEqual(again.status, 0, 'an export into a directory that is not empty');
    assert.doesNotMatch(exported.stdout + exported.stderr, /pg@|password/i, 'the export printed a secret');
    assert.ok(!(exported.stdout + exported.stderr).includes(STORAGE_KEY), 'the export printed the Storage key');
    for (const [k, v] of Object.entries(files)) assert.deepEqual(fs.readFileSync(path.join(dir, 'files', k)), v, `${k} is carried`);
    assert.ok(oldStore.seen.every((r) => r.startsWith('GET') && r.endsWith(' keyed')), oldStore.seen.join('\n'));

    // The fresh instance: the shim and the migrations, nothing seeded.
    psqlOn(fresh.toString(), fs.readFileSync(path.join(root, 'supabase/tests/setup/auth-shim.sql'), 'utf8'));
    for (const m of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) psqlOn(fresh.toString(), fs.readFileSync(path.join(migrations, m), 'utf8'));
    // The tables a fresh, migrated database already holds rows in are the ones the export leaves
    // to the migrations (MIGRATION_DATA): one more, and every import would be refused as not empty.
    const filled = psqlOn(fresh.toString(), `select string_agg(name, ',' order by name) from (select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public') t
      where (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %s', name), false, true, '')))[1]::text::bigint > 0`);
    assert.equal(filled, [...MIGRATION_DATA].sort().join(','), 'the tables the migrations fill are MIGRATION_DATA');
    psqlOn(fresh.toString(), 'create table public.export_probe (id integer primary key, amount numeric(10,2), tags text[], said text);');

    // The export is as private as the database: no file in it is readable by anyone else.
    for (const f of fs.readdirSync(dir, { recursive: true }) as string[]) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o077, 0, `${f} is readable by others`);

    // A short file is refused, naming the table, and leaves the database as it was.
    const short = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-short-'));
    fs.cpSync(dir, short, { recursive: true });
    fs.writeFileSync(path.join(short, 'public.invites.jsonl'), '');
    const shorted = await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.notEqual(shorted.status, 0);
    assert.match(shorted.stderr, /public\.invites/);
    // A row whose account is not in the export (a lost line, the manifest's count made to agree) is refused by its foreign key.
    const accounts = fs.readFileSync(path.join(dir, 'public.accounts.jsonl'), 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(path.join(short, 'public.invites.jsonl'), fs.readFileSync(path.join(dir, 'public.invites.jsonl')));
    fs.writeFileSync(path.join(short, 'public.accounts.jsonl'), accounts.slice(1).join('\n') + '\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(short, 'manifest.json'), 'utf8'));
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').rows -= 1;
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    const orphaned = await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.notEqual(orphaned.status, 0);
    assert.match(orphaned.stderr, /references a row the export does not hold/);
    // A file the manifest names outside the export is refused.
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').file = '../elsewhere.jsonl';
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /names a file/);
    // An export made at another release of the name folds is refused: its characters' name keys
    // are that release's (supabase/migrations/0010_name_folds.sql). The folds themselves are the
    // migrations', not the instance's, and are not carried.
    manifest.tables.find((t: { name: string }) => t.name === 'public.accounts').file = 'public.accounts.jsonl';
    assert.ok(manifest.nameFolds?.confusables, 'the export names its release of the name folds');
    assert.ok(!manifest.tables.some((t: { name: string }) => t.name === 'public.name_maps' || t.name === 'public.unicode_data'), 'the name folds are not exported');
    const folds = manifest.nameFolds;
    manifest.nameFolds = { ...folds, confusables: { ...folds.confusables, version: '1.0.0' } };
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /name folds/);
    manifest.nameFolds = { ...folds, confusables: { ...folds.confusables, sha256: '0'.repeat(64) } };
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(manifest));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /name folds/, 'the same release from other files is another release');
    // A character whose carried key is not its name's is refused: an import keys every name again.
    // From a clean copy of the export, but for that one row.
    for (const f of ['manifest.json', 'public.accounts.jsonl']) fs.copyFileSync(path.join(dir, f), path.join(short, f));
    const characters = fs.readFileSync(path.join(dir, 'public.characters.jsonl'), 'utf8').split('\n').filter(Boolean);
    for (const key of ['name_key', 'name_look']) {
      const forged = JSON.parse(characters[0]!);
      forged[key] = 'not its name';
      fs.writeFileSync(path.join(short, 'public.characters.jsonl'), [JSON.stringify(forged), ...characters.slice(1)].join('\n') + '\n');
      assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /edited after it was made/, key);
    }
    // An export from before the folds were carried names none, and is told so plainly.
    const none = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    delete none.nameFolds;
    fs.writeFileSync(path.join(short, 'manifest.json'), JSON.stringify(none));
    assert.match((await run('import-instance.mjs', ['--from', short, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /names no release of the name folds/);
    fs.copyFileSync(path.join(dir, 'manifest.json'), path.join(short, 'manifest.json'));
    fs.writeFileSync(path.join(short, 'public.characters.jsonl'), characters.join('\n') + '\n');
    fs.rmSync(short, { recursive: true, force: true });
    assert.equal(psqlOn(fresh.toString(), 'select count(*) from public.accounts'), '0', 'a refused import left rows behind');

    // A carried file that is not the one exported, and one no row names, are refused before anything is written.
    const tampered = fs.mkdtempSync(path.join(os.tmpdir(), 'kayfabb-tampered-'));
    fs.cpSync(dir, tampered, { recursive: true });
    fs.writeFileSync(path.join(tampered, 'files', 'avatars', 'exp-sq.webp'), 'RIFF-other');
    assert.match((await run('import-instance.mjs', ['--from', tampered, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /exp-sq\.webp is not the file the export made/);
    // A carried file no row names, and a row naming a file the export does not carry.
    fs.writeFileSync(path.join(tampered, 'files', 'avatars', 'exp-sq.webp'), avatar['avatars/exp-sq.webp']);
    const carried = JSON.parse(fs.readFileSync(path.join(tampered, 'manifest.json'), 'utf8'));
    fs.writeFileSync(path.join(tampered, 'files', 'avatars', 'stray.webp'), 'RIFF-stray');
    fs.writeFileSync(path.join(tampered, 'manifest.json'), JSON.stringify({ ...carried, files: [...carried.files, { bucket: 'avatars', name: 'stray.webp', bytes: 10, sha256: 'x' }] }));
    assert.match((await run('import-instance.mjs', ['--from', tampered, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /carries avatars\/stray\.webp, which no row names/);
    fs.writeFileSync(path.join(tampered, 'manifest.json'), JSON.stringify({ ...carried, files: carried.files.filter((f: { name: string }) => f.name !== 'exp-pt.webp') }));
    assert.match((await run('import-instance.mjs', ['--from', tampered, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /a row names avatars\/exp-pt\.webp, which the export does not carry/);
    fs.rmSync(tampered, { recursive: true, force: true });
    // A file already in the new project under a name the export carries, with other bytes, is refused.
    newStore.objects.set('avatars/exp-sq.webp', Buffer.from('RIFF-someone-else'));
    assert.match((await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url])).stderr, /exp-sq\.webp is already there, and is another file/);
    // The refused imports above put some files in already; the same files again are the same files.
    newStore.objects.delete('avatars/exp-sq.webp');
    newStore.trouble.push('unavailable');
    const imported = await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.equal(imported.status, 0, imported.stderr + imported.stdout);
    const after = contents(fresh.toString());
    assert.deepEqual([...after.keys()], [...before.keys()]);
    for (const [t, rows] of before) assert.equal(after.get(t), rows, `${t} differs after the round trip`);
    // A custom pronoun set (0124) is carried as it was chosen, not reset to the column's default.
    const xe = '{"plural": false, "object": "xem", "subject": "xe", "reflexive": "xemself", "determiner": "xyr", "possessive": "xyrs"}';
    const setOf = (url: string) => psqlOn(url, `select p.pronouns::text from character_profiles p join characters c on c.id = p.character where c.name = 'Exported A'`).trim();
    assert.deepEqual(JSON.parse(setOf(fresh.toString())), JSON.parse(xe), 'a custom pronoun set survives the round trip');
    for (const t of ['staff_offices', 'staff_notes', 'pool_spends', 'pool_run_claims', 'handover_dismissals', 'staff_call_records', 'patrols', 'report_refunds', 'appeal_refunds', 'tails', 'tail_visits', 'staff_quiz_questions', 'season_results', 'apologies', 'card_texts', 'card_writes', 'card_write_refunds']) { const rows = after.get(`public.${t}`); assert.ok(rows !== undefined && rows !== '[]', `${t} is in the imported instance (got ${rows === undefined ? 'no such table' : rows})`); }
    // A season's frozen results are carried as they were written, and the import (a replica's write, inserts only) leaves their guard firing always (0099).
    const guards = (url: string) => psqlOn(url, `select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid = 'public.season_results'::regclass and not tgisinternal`);
    assert.equal(guards(fresh.toString()), 'season_results_no_truncate:A,season_results_no_update:A', 'the guards on season_results are still enabled always after the import');
    assert.equal(guards(from), guards(fresh.toString()));
    assert.match(psqlOn(fresh.toString(), `select count(*) from public.season_results`), /^[1-9]/, 'the imported instance holds the season\'s results');
    // The contact an admin set is the same contact in the imported instance, as the page's read answers it (0081).
    const contact = (url: string) => psqlOn(url, `select admin_contact()::text`);
    assert.match(contact(from), /Exported mail/, 'the exported instance holds the contact');
    assert.equal(contact(fresh.toString()), contact(from), 'the contact survives the round trip');
    // The set, its spring and the caught card, each carried as it was.
    const trapRows = (url: string) => psqlOn(url, `select (select to_jsonb(f)::text from face_down f where f.play = '${setPlay}') || '|' ||
      (select to_jsonb(a)::text from acts a where a.id = '${springAct}' and a.kind = 'spring') || '|' || (select to_jsonb(a)::text from acts a where a.id = '${caughtAct}' and a.kind = 'card')`);
    assert.notEqual(trapRows(fresh.toString()), '', 'the set, its spring and the caught card are in the imported instance');
    assert.equal(trapRows(fresh.toString()), trapRows(from));
    // The Move set with its phrase, the Hall Pass and its spring, and the caught card's ledger row, each carried as it was.
    const faceDownRows = (url: string) => psqlOn(url, `select coalesce(string_agg(x, ' | ' order by x), '') from (
      select to_jsonb(f)::text x from face_down f where f.play in ('${moveSet}', '${passSet}')
      union all select to_jsonb(l)::text from card_ledger l where l.kind = 'caught'
      union all select to_jsonb(s)::text from acts s where s.kind = 'spring' and s.payload ->> 'set' in ('${moveSet}', '${passSet}')
      union all select to_jsonb(k)::text from acts k where k.kind = 'card' and k.payload ->> 'card' = 'expauto') q`);
    assert.match(faceDownRows(from), /"phrase": "carried across"/, 'the Move\'s phrase is in the export');
    assert.match(faceDownRows(from), /"kind": "caught"/, 'the caught ledger row is in the export');
    assert.match(faceDownRows(from), /"did": "ended"/, 'the Hall Pass spring is in the export');
    assert.match(faceDownRows(from), /"did": "landed"/, 'the quote\'s spring is in the export');
    assert.match(faceDownRows(from), /"spring": "/, 'the Move\'s card Act is in the export, marked as its spring');
    assert.equal(faceDownRows(fresh.toString()), faceDownRows(from), 'the Move, the Hall Pass, their springs, the card and the caught ledger row survive the round trip');
    // The conditioned Move (its passage and list, in its face_down row) and the spring its quote made (its when and for), each carried as it was.
    const condRows = (url: string) => psqlOn(url, `select (select to_jsonb(f)::text from face_down f where f.play = '${condSet}') || '|' || (select to_jsonb(a)::text from acts a where a.id = '${quoteSpring}' and a.kind = 'spring')`);
    assert.match(condRows(from), /"passage": "conditioned words"/, 'the Anyone-but Move\'s passage is in the export');
    assert.match(condRows(from), /"when": \{"passage": "passage quoted"\}/, 'the spring\'s when is in the export');
    assert.match(condRows(from), /"for": "[0-9a-f-]{36}"/, 'the spring\'s for is in the export');
    assert.equal(condRows(fresh.toString()), condRows(from), 'the conditioned Move and its spring survive the round trip');
    // The card an admin ended (0092): its card_end Act is carried as written, by its id, its target, its kind, and its payload.
    const endAct = sql(`select id from acts where kind = 'card_end' and target_act_id = '${endedPlay}'`);
    assert.ok(endAct, 'the card an admin ended holds a card_end in the exported instance');
    const endRow = (url: string) => psqlOn(url, `select to_jsonb(a)::text from acts a where a.id = '${endAct}' and a.kind = 'card_end' and a.target_act_id = '${endedPlay}' and a.payload = '{"why": "reversed", "by": "admin"}'::jsonb`);
    assert.notEqual(endRow(fresh.toString()), '', 'the card_end is in the imported instance');
    assert.equal(endRow(fresh.toString()), endRow(from));
    // The moments were carried as written, and the import, a replica's write, took none of its own (0072's trigger stayed silent).
    const moments = (url: string) => psqlOn(url, 'select (select count(*) from play_moments) || \'/\' || (select count(*) from play_moment_layers)');
    assert.equal(moments(fresh.toString()), moments(from));
    assert.notEqual(moments(from), '0/0', 'the export carried a moment and a layer');
    // And every file its rows name is in the new project's Storage, byte for byte.
    assert.deepEqual(new Map(newStore.objects), new Map(Object.entries(files)));
    assert.ok(!(imported.stdout + imported.stderr).includes(STORAGE_KEY), 'the import printed the Storage key');

    // Random Events (0152): the events, the last roll and the lines, with a found card and a found gear row naming their events.
    for (const t of ['random_events', 'random_event_rolls', 'event_lines']) assert.notEqual(psqlOn(from, `select count(*) from public.${t}`), '0', `the exported instance holds ${t} rows`);
    const eventRows = (url: string) => psqlOn(url, `select coalesce(string_agg(x, ' | ' order by x), '') from (
      select to_jsonb(e)::text x from random_events e union all select to_jsonb(r)::text from random_event_rolls r union all select to_jsonb(l)::text from event_lines l
      union all select to_jsonb(c)::text from card_ledger c where c.kind = 'found') q`);
    assert.match(eventRows(from), /"kind": "found"/, 'the found card is in the export');
    assert.match(eventRows(from), /2000-01-02T03:04:05/, 'the last roll is in the export');
    assert.equal(eventRows(fresh.toString()), eventRows(from), 'the events, the last roll, the lines and the found card survive the round trip');
    // The gear's three tables are carried as they were: the kind, both ledger rows (the found one naming its event) and the worn piece.
    for (const t of ['gear_kinds', 'gear_ledger', 'gear_worn']) assert.notEqual(psqlOn(from, `select count(*) from public.${t}`), '0', `the exported instance holds ${t} rows`);
    const gearRows = (url: string) => psqlOn(url, `select coalesce(string_agg(x, ' | ' order by x), '') from (
      select to_jsonb(k)::text x from gear_kinds k union all select to_jsonb(l)::text from gear_ledger l union all select to_jsonb(gw)::text from gear_worn gw) q`);
    assert.match(gearRows(from), /"kind": "found"/, 'the found copy is in the export');
    assert.match(gearRows(from), /"turn": -30/, 'the worn piece is in the export');
    assert.equal(gearRows(fresh.toString()), gearRows(from), 'gear_kinds, gear_ledger and gear_worn survive the round trip');

    // The trophies' five tables are carried as they were: the kinds (an instance's with its place, a belt, an admin's with its art), the three awards, the taking back, the shown award and a met demand's failure.
    for (const t of ['trophy_kinds', 'trophy_awards', 'trophy_reversals', 'trophies_shown', 'trophy_award_failures']) assert.notEqual(psqlOn(from, `select count(*) from public.${t}`), '0', `the exported instance holds ${t} rows`);
    const trophyRows = (url: string) => psqlOn(url, `select coalesce(string_agg(x, ' | ' order by x), '') from (
      select to_jsonb(k)::text x from trophy_kinds k union all select to_jsonb(w)::text from trophy_awards w union all select to_jsonb(r)::text from trophy_reversals r
      union all select to_jsonb(sh)::text from trophies_shown sh union all select to_jsonb(f)::text from trophy_award_failures f) q`);
    assert.match(trophyRows(from), /"art": "exp-trophy\.webp"/, 'the admin\'s kind names its picture');
    assert.match(trophyRows(from), /"by": "boss"/, 'the Boss\'s award is in the export');
    assert.equal(trophyRows(fresh.toString()), trophyRows(from), 'the trophies survive the round trip');
    // What the imported instance shows is what the old one did: the admin's taken back, the Boss's belt held and shown.
    const exportedA = sql(`select id from characters where name = 'Exported A'`);
    const shelf = (url: string, who: string) => psqlOn(url, `select (trophies_of('${who}') -> 'awards')::text`);
    assert.equal(shelf(fresh.toString(), exportedA), shelf(from, exportedA), 'a character\'s trophies are the same after the round trip');
    assert.match(shelf(from, exportedA), /"held": true/, 'the belt is held in the exported instance');

    // The imported instance goes on: each identity column's next value is past every row it holds.
    const identities = psqlOn(fresh.toString(), `
      select format('public.%I', c.relname), quote_ident(a.attname), pg_get_serial_sequence(format('public.%I', c.relname), a.attname)
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attidentity <> ''`).split('\n').filter(Boolean).map((l) => l.split('|'));
    assert.ok(identities.length >= 5, 'the identity columns are found');
    const behind = identities.filter(([table, column, sequence]) =>
      psqlOn(fresh.toString(), `select case when (select is_called from ${sequence}) then (select last_value from ${sequence}) else 0 end < coalesce((select max(${column}) from ${table}), 0)`) === 't')
      .map(([table, column]) => `${table}.${column}`).join(', ');
    assert.equal(behind, '', `identity columns behind their rows: ${behind}`);

    // The jobs that run the instance are there, each scheduled from the imported settings: the
    // settlement's, the view count's, the Boss's meeting and the pool's chatter.
    assert.equal(psqlOn(fresh.toString(), `select string_agg(jobname, ',' order by jobname) from cron.job where jobname like 'kayfabb-%'`), 'kayfabb-chatter,kayfabb-meet,kayfabb-search-rebuild,kayfabb-settle,kayfabb-staff,kayfabb-system-tick,kayfabb-view-counts,kayfabb-write');

    // And a second import onto what is no longer a fresh instance is refused, naming why.
    const twice = await run('import-instance.mjs', ['--from', dir, '--to', fresh.toString(), '--storage', newStore.url]);
    assert.notEqual(twice.status, 0);
    assert.match(twice.stderr, /not empty/);
  } finally {
    await oldStore.close();
    await newStore.close();
    psqlOn(server.toString(), `drop database if exists ${name} with (force);`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
