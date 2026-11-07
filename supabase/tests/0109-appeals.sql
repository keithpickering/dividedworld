-- Appeals (supabase/migrations/0107_appeals.sql; the Mod Bots design, section 7 and "Ways out"; its plan, Task 10).
--
-- 1. open_appeal: the punished character's door. It spends appealPrice (wallet_events kind 'appeal') and writes a public `appeal` Act on the infraction or ban, in its thread,
--    taking no seq, and answers with what the judgment needs (who hears, the board, the punishment, the appellant's public name) and no account.
-- 2. It refuses, writing and spending nothing: a character the caller does not play, another character's punishment (the same words as a punishment that is none, including the
--    player's own other mask), a blank or over-long plea, a short wallet, a second appeal of the same punishment. A banned character may appeal its ban.
-- 3. Who hears: the Mod that filed an infraction; the beat Mod once it has left staff; a ban goes to the Boss. close_appeal refuses a staff member who is not who hears it now.
-- 4. close_appeal on an infraction: overturned takes all its points off (and refunds), reduced half, upheld none, increased files one more of the same band (a full bar bans).
--    warn_points reads the rulings through infraction_relief; the infraction Act itself is never touched. Once: twice closes once.
-- 5. close_appeal on a ban: overturned ends it at once (and refunds), reduced ends it at half its length from its start, increased runs it half its length longer, upheld none;
--    an overturned ban does not step the season's ladder.
-- 6. refund_appeal refunds once, writes no Act, frees the punishment to be appealed again, refuses an appeal that has a ruling; a refunded appeal cannot be closed;
--    refund_stale_appeals refunds the unjudged and no other, and frees the punishment at most three times. Close and refund wait on one lock per appeal.
-- 7. The judgment budget counts appeals paid and in flight with the reports; one count, the same words for everyone.
-- 8. The doors: close_appeal, refund_appeal and the sweep are the service's, open_appeal the player's, and a client cannot write an appeal or a ruling.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- A player says something through the real post(), as the account that owns the character.
create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

-- A player with a wallet and one character (named 'Ap <label>').
create function pg_temp.player(label text, cash integer default 500) returns uuid language plpgsql as $$
declare a uuid := tests.account('ap-' || label);
begin
  insert into wallets (account, balance) values (a, cash) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Ap ' || label);
end $$;

create function pg_temp.wallet(c uuid) returns integer language sql as $$
  select coalesce((select w.balance from wallets w join characters x on x.owner = w.account where x.id = c), 0)
$$;

-- An infraction of a band against the character, on a post of its own (filed by a Mod, as a visit's filing does).
create function pg_temp.inf(c uuid, t uuid, band text, staff text default 'ap-m1') returns jsonb language plpgsql as $$
declare p uuid := pg_temp.say(c, t, 'A post ' || gen_random_uuid());
begin
  return infract(c, band, p, staff) || jsonb_build_object('post', p);
end $$;

-- An appeal, through the real open_appeal as the account that owns the character.
create function pg_temp.appeal(c uuid, punishment uuid, plea text default 'I did nothing wrong.') returns jsonb language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = c));
  made := open_appeal(c, punishment, plea);
  perform tests.unbecome();
  return made;
end $$;

-- Posts to be filed, made up front (a banned character cannot post).
create function pg_temp.posts(c uuid, t uuid, n integer default 2) returns uuid[] language plpgsql as $$
declare out uuid[] := '{}'; i integer;
begin
  for i in 1..n loop out := out || pg_temp.say(c, t, 'A post ' || gen_random_uuid()); end loop;
  return out;
end $$;

-- A ban for the character: a severe and a moderate infraction, on the two posts, fill a bar of ten.
create function pg_temp.fill(c uuid, two uuid[]) returns uuid language plpgsql as $$
declare hit jsonb;
begin
  perform infract(c, 'severe', two[1], 'ap-m1');
  hit := infract(c, 'moderate', two[2], 'ap-m1');
  if hit ->> 'ban' is null then raise exception 'the bar did not fill: %', hit; end if;
  return (hit ->> 'ban')::uuid;
end $$;

create function pg_temp.banned(c uuid, t uuid) returns uuid language sql as $$ select pg_temp.fill(c, pg_temp.posts(c, t)) $$;

-- ---- 0a. Close and refund wait on one lock per appeal, and two refunds refund once (first: the committed rows must not meet this file's own locks) ----
do $$
declare
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); ap uuid := gen_random_uuid();
  inf uuid; tries integer := 0; said text[];
  ra text; rb text;
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
    insert into auth.users (id, email) values (%1$L, 'ap-race@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into wallets (account, balance) values (%1$L, 50);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Ap Racer', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into threads (id, board, title) select %3$L, b.id, 'Ap race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%4$L, %2$L, 'post', %3$L, '{"body": "A racing post."}');
    do $d$ begin perform infract(%2$L, 'minor', %4$L, 'ap-race-mod'); end $d$;
  $sql$, u, c, t, p));
  inf := (select id from acts where kind = 'infraction' and payload ->> 'character' = c::text);
  perform tests.commit(format($sql$
    set kayfabb.appeal_writer = 'on';
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%1$L, %2$L, 'appeal', %3$L, %4$L, '{"plea": "race"}');
    reset kayfabb.appeal_writer;
    update wallets set balance = 0 where account = %5$L;
    insert into wallet_events (account, kind, change, balance_after, ref) values (%5$L, 'appeal', -50, 0, %1$L);
  $sql$, ap, c, t, inf, u));
  said := tests.race_service(format('select refund_appeal(%L)', ap), format('select refund_appeal(%L)', ap));
  if said[1] is not null or said[2] is not null then raise exception 'a racing refund failed: %', said; end if;
  if (select balance from wallets where account = u) is distinct from 50 then raise exception 'two sessions refunded an appeal into %', (select balance from wallets where account = u); end if;
  if (select count(*) from wallet_events where kind = 'refund' and ref = ap) is distinct from 1::bigint or (select count(*) from appeal_refunds where appeal_act = ap) is distinct from 1::bigint then
    raise exception 'two sessions refunded an appeal twice';
  end if;

  -- A second appeal of the same racer's other punishment, to show the lock itself: one session holds the appeal's lock; a refund and a close both wait behind it.
  ap := gen_random_uuid();
  perform tests.commit(format($sql$
    set kayfabb.appeal_writer = 'on';
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%1$L, %2$L, 'appeal', %3$L, %4$L, '{"plea": "lock"}');
    reset kayfabb.appeal_writer;
    update wallets set balance = 0 where account = %5$L;
    insert into wallet_events (account, kind, change, balance_after, ref) values (%5$L, 'appeal', -50, 0, %1$L);
  $sql$, ap, c, t, inf, u));
  perform extensions.dblink_connect('apl_h', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_connect('apl_a', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_connect('apl_b', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_exec('apl_h', 'begin');
  perform * from extensions.dblink('apl_h', format('select pg_advisory_xact_lock(hashtextextended(%L, 0))', 'kayfabb.appeal.' || ap::text)) as x(n text);
  perform extensions.dblink_send_query('apl_a', format('select /* apl_a */ refund_appeal(%L)', ap));
  perform extensions.dblink_send_query('apl_b', format('select /* apl_b */ close_appeal(%L, ''upheld'')', ap));
  loop
    exit when (select count(*) from pg_stat_activity a where (a.query like '%/* apl_a */%' or a.query like '%/* apl_b */%') and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock') = 2;
    tries := tries + 1;
    if tries > 400 then raise exception 'the refund and the close never both waited on the appeal''s lock'; end if;
    perform pg_sleep(0.025);
  end loop;
  perform extensions.dblink_exec('apl_h', 'commit');
  begin
    select r into ra from extensions.dblink_get_result('apl_a') as x(r text);
    select r into rb from extensions.dblink_get_result('apl_b') as x(r text);
  exception when others then
    -- The close may find no one to hear it (no staff is committed here): it raised before writing anything, and the refund stands.
    rb := sqlerrm;
  end;
  perform extensions.dblink_disconnect('apl_h');
  perform extensions.dblink_disconnect('apl_a');
  perform extensions.dblink_disconnect('apl_b');
  if (select count(*) from appeal_refunds where appeal_act = ap) is distinct from 1::bigint then raise exception 'the refund was lost or doubled behind the lock'; end if;
  if exists (select 1 from acts where kind = 'appeal_ruling' and target_act_id = ap) then raise exception 'a ruling was written for a refunded appeal'; end if;
end $$;

-- ---- 0. The world: a Boss, two Mods on staff, the settings, players ----
do $$
declare
  seed jsonb;
  general uuid := (select id from boards where slug = 'general');
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ap-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ap-boss', 'name', 'Appeal Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'ap-m1', 'name', 'Appeal Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'ap-m2', 'name', 'Appeal Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('ap-m1', 'ap-m2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  if beat_of(general) is distinct from 'ap-m1' then raise exception 'the world: the beat Mod of General is %', beat_of(general); end if;
  if current_boss() is distinct from 'ap-boss' then raise exception 'the world: the Boss is %', current_boss(); end if;
end $$;

-- ---- 1. open_appeal pays, writes a public appeal naming its appellant, and answers with what the judgment needs ----
do $$
declare
  c uuid := pg_temp.player('one');
  t uuid := tests.thread('Appeals one');
  hit jsonb := pg_temp.inf(c, t, 'moderate');
  w0 integer := pg_temp.wallet(c);
  seq0 integer := (select next_seq from threads where id = t);
  got jsonb;
  a acts%rowtype;
  ev wallet_events%rowtype;
begin
  got := pg_temp.appeal(c, (hit ->> 'infraction')::uuid, '  Please look again.  ');
  select * into a from acts where id = (got ->> 'appeal')::uuid;
  if a.kind is distinct from 'appeal' or a.character is distinct from c or a.target_act_id is distinct from (hit ->> 'infraction')::uuid or a.thread is distinct from t then raise exception 'the appeal Act is wrong: %', to_jsonb(a); end if;
  if a.seq is not null or (select next_seq from threads where id = t) is distinct from seq0 then raise exception 'an appeal took a seq'; end if;
  if a.payload is distinct from '{"plea": "Please look again."}'::jsonb then raise exception 'the plea is not kept trimmed: %', a.payload; end if;
  if pg_temp.wallet(c) is distinct from w0 - 50 then raise exception 'the price was not spent: % -> %', w0, pg_temp.wallet(c); end if;
  select * into ev from wallet_events where kind = 'appeal' and ref = a.id;
  if ev.change is distinct from -50 then raise exception 'the wallet event is wrong: %', to_jsonb(ev); end if;
  if got ->> 'staff' is distinct from 'ap-m1' or got #>> '{appellant,name}' is distinct from 'Ap one' or got ->> 'kind' is distinct from 'infraction' or got #>> '{details,band}' is distinct from 'moderate'
     or got ->> 'post' is distinct from hit ->> 'post' or (got ->> 'price')::integer <> 50 or got ->> 'plea' is distinct from 'Please look again.'
     or got #>> '{board,id}' is distinct from (select id::text from boards where slug = 'general') or got #>> '{details,rule}' is null then
    raise exception 'the answer is wrong: %', got;
  end if;
  if got::text ~* (select owner::text from characters where id = c) or to_jsonb(a)::text ~* (select owner::text from characters where id = c) then raise exception 'an appeal names an account'; end if;
  if not exists (select 1 from acts_public x where x.id = a.id and x.character = c) then raise exception 'the appeal is not a public Act of its appellant'; end if;
end $$;

-- ---- 2. Refusals write and spend nothing; only the punished character may appeal; one appeal per punishment ----
do $$
declare
  c uuid := pg_temp.player('two');
  other uuid := pg_temp.player('twoother');
  poor uuid := pg_temp.player('twopoor', 10);
  t uuid := tests.thread('Appeals two');
  hit jsonb := pg_temp.inf(c, t, 'minor');
  inf uuid := (hit ->> 'infraction')::uuid;
  mine uuid;
  twin uuid;
  poorhit jsonb := pg_temp.inf(poor, t, 'minor');
  w0 integer := pg_temp.wallet(c);
  n0 bigint := (select count(*) from acts where kind = 'appeal' and thread = t);
  e0 bigint := (select count(*) from wallet_events where kind = 'appeal' and account = (select owner from characters where id = c));
  said text;
  elsewhere text;
  nothing text;
begin
  -- No session at all.
  perform tests.become_anon();
  said := pg_temp.refusal(format('select open_appeal(%L, %L, %L)', c, inf, 'Why.'));
  perform tests.unbecome();
  if said is null then raise exception 'a visitor appealed'; end if;
  -- A character the caller does not play.
  perform tests.become((select owner from characters where id = other));
  said := pg_temp.refusal(format('select open_appeal(%L, %L, %L)', c, inf, 'Why.'));
  elsewhere := pg_temp.refusal(format('select open_appeal(%L, %L, %L)', other, inf, 'Why.'));
  nothing := pg_temp.refusal(format('select open_appeal(%L, %L, %L)', other, gen_random_uuid(), 'Why.'));
  perform tests.unbecome();
  if said is null then raise exception 'a player appealed through a character they do not play'; end if;
  -- Another character's punishment is refused in the same words as a punishment that is none.
  if elsewhere is null or nothing is null or elsewhere is distinct from nothing then raise exception 'another character''s punishment is refused differently from none: % / %', elsewhere, nothing; end if;
  -- A post is no punishment.
  if pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', c, hit ->> 'post')) is null then raise exception 'a post was appealed'; end if;
  -- Blank and over-long pleas, a short wallet.
  if pg_temp.refusal(format('select pg_temp.appeal(%L, %L, %L)', c, inf, '   ')) is null then raise exception 'a blank plea was taken'; end if;
  if pg_temp.refusal(format('select pg_temp.appeal(%L, %L, %L)', c, inf, repeat('x', 1001))) is null then raise exception 'an over-long plea was taken'; end if;
  if pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', poor, poorhit ->> 'infraction')) is null then raise exception 'a short wallet appealed'; end if;
  if pg_temp.wallet(c) is distinct from w0 or (select count(*) from acts where kind = 'appeal' and thread = t) is distinct from n0
     or (select count(*) from wallet_events where kind = 'appeal' and account = (select owner from characters where id = c)) is distinct from e0 then raise exception 'a refusal wrote or spent something'; end if;
  if exists (select 1 from acts where kind = 'appeal' and character = poor) then raise exception 'a short wallet left an appeal behind'; end if;
  -- A plea of exactly 1000 is taken, and a second appeal of the same punishment is not.
  mine := (pg_temp.appeal(c, inf, repeat('x', 1000)) ->> 'appeal')::uuid;
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', c, inf));
  if said is null or said not like '%appealed%' then raise exception 'a second appeal of one punishment was not refused: %', said; end if;
  if (select count(*) from acts where kind = 'appeal' and target_act_id = inf) is distinct from 1::bigint then raise exception 'two appeals of one punishment exist'; end if;
  -- The same player's other mask is refused as any stranger is.
  twin := tests.character((select owner from characters where id = c), 'Ap two twin');
  perform tests.become((select owner from characters where id = c));
  said := pg_temp.refusal(format('select open_appeal(%L, %L, %L)', twin, inf, 'Why.'));
  perform tests.unbecome();
  if said is distinct from nothing then raise exception 'a mask of the same account was refused in other words: %', said; end if;
end $$;

-- ---- 3. Who hears: the filer, the beat Mod once the filer has left, the Boss for a ban ----
do $$
declare
  c uuid := pg_temp.player('three');
  t uuid := tests.thread('Appeals three');
  by2 jsonb := pg_temp.inf(c, t, 'minor', 'ap-m2');
  by1 jsonb := pg_temp.inf(c, t, 'minor', 'ap-m1');
  bc uuid := pg_temp.player('threeban');
  ban uuid := pg_temp.banned(bc, t);
  ap jsonb;
  said text;
begin
  if appeal_hearer((by2 ->> 'infraction')::uuid) is distinct from 'ap-m2' or appeal_hearer((by1 ->> 'infraction')::uuid) is distinct from 'ap-m1' then raise exception 'the filer does not hear its infraction'; end if;
  if appeal_hearer(ban) is distinct from 'ap-boss' then raise exception 'the Boss does not hear a ban: %', appeal_hearer(ban); end if;
  -- The filer leaves staff: the Mod on the board's beat hears.
  insert into staff_offices (staff, office, cause) values ('ap-m2', 'member', 'admin');
  if appeal_hearer((by2 ->> 'infraction')::uuid) is distinct from 'ap-m1' then raise exception 'a departed filer''s infraction is heard by %', appeal_hearer((by2 ->> 'infraction')::uuid); end if;
  ap := pg_temp.appeal(c, (by2 ->> 'infraction')::uuid);
  if ap ->> 'staff' is distinct from 'ap-m1' then raise exception 'open_appeal names a hearer who left: %', ap ->> 'staff'; end if;
  -- Nobody is on staff at all: the Boss hears an infraction; with no Boss nor Mod there is no one, and the appeal is refused before anything is paid.
  insert into staff_offices (staff, office, cause) values ('ap-m1', 'member', 'admin');
  if appeal_hearer((by1 ->> 'infraction')::uuid) is distinct from 'ap-boss' then raise exception 'with no Mod the Boss hears: %', appeal_hearer((by1 ->> 'infraction')::uuid); end if;
  insert into staff_offices (staff, office, cause) values ('ap-m1', 'mod', 'admin'), ('ap-m2', 'mod', 'admin');
  -- A ruling is by who hears it now: the filer is a Mod again, so the beat Mod who was asked while it was away no longer is the one.
  said := pg_temp.refusal(format('select close_appeal(%L, ''upheld'', null, ''ap-m1'')', ap ->> 'appeal'));
  if said is null or said not like '%someone else%' then raise exception 'a close by who does not hear it was taken: %', said; end if;
  if exists (select 1 from acts where kind = 'appeal_ruling' and target_act_id = (ap ->> 'appeal')::uuid) then raise exception 'a ruling by the wrong staff member was written'; end if;
  -- A banned character appeals its ban, and the Boss hears it.
  ap := pg_temp.appeal(bc, ban, 'Too long for what I said.');
  if ap ->> 'staff' is distinct from 'ap-boss' or ap ->> 'kind' is distinct from 'ban' or (ap #>> '{details,days}')::integer is distinct from 1 then raise exception 'a ban''s appeal is wrong: %', ap; end if;
end $$;

-- ---- 4. close_appeal on an infraction: each verdict's effect on warn_points, the refund, and once ----
do $$
declare
  t uuid := tests.thread('Appeals four');
  c uuid; hit jsonb; ap jsonb; closed jsonb; again jsonb; w0 integer; r acts%rowtype; inf acts%rowtype; n bigint;
begin
  -- Overturned: all four points off, the price back, a public ruling with the Mod's stock line.
  c := pg_temp.player('fouro');
  hit := pg_temp.inf(c, t, 'moderate');
  if warn_points(c) is distinct from 4 then raise exception 'the bar before: %', warn_points(c); end if;
  w0 := pg_temp.wallet(c);
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'overturned', null, 'ap-m1');
  select * into r from acts where id = (closed ->> 'ruling_act')::uuid;
  if not (closed ->> 'closed')::boolean or warn_points(c) is distinct from 0 or (closed ->> 'points_delta')::integer is distinct from -4 then raise exception 'overturned did not clear the infraction: % / %', closed, warn_points(c); end if;
  if r.kind is distinct from 'appeal_ruling' or r.target_act_id is distinct from (ap ->> 'appeal')::uuid or r.thread is distinct from t or r.seq is not null
     or r.character is distinct from (select id from characters where staff = 'ap-m1') or r.payload ->> 'verdict' is distinct from 'overturned'
     or (r.payload ->> 'points_delta')::integer is distinct from -4 or r.payload ->> 'line' not like '%overturned%' then raise exception 'the ruling Act is wrong: %', to_jsonb(r); end if;
  if pg_temp.wallet(c) is distinct from w0 then raise exception 'an overturned appeal did not get its price back: % -> %', w0, pg_temp.wallet(c); end if;
  if (select why from appeal_refunds where appeal_act = (ap ->> 'appeal')::uuid) is distinct from 'overturned' then raise exception 'the refund is not marked overturned'; end if;
  if not exists (select 1 from acts_public x where x.id = r.id) then raise exception 'the ruling is not public'; end if;
  -- The infraction Act itself is as it was.
  select * into inf from acts where id = (hit ->> 'infraction')::uuid;
  if inf.payload ->> 'points' is distinct from '4' then raise exception 'the infraction was changed: %', inf.payload; end if;
  -- Once: a second close writes nothing and moves nothing.
  again := close_appeal((ap ->> 'appeal')::uuid, 'upheld');
  if (again ->> 'closed')::boolean or not (again ->> 'existing')::boolean or again ->> 'verdict' is distinct from 'overturned' or pg_temp.wallet(c) is distinct from w0
     or (select count(*) from acts where kind = 'appeal_ruling' and target_act_id = (ap ->> 'appeal')::uuid) is distinct from 1::bigint then raise exception 'a second close did something: %', again; end if;
  if (refund_appeal((ap ->> 'appeal')::uuid) ->> 'refunded')::boolean or (refund_appeal((ap ->> 'appeal')::uuid) ->> 'closed') is distinct from 'true' then raise exception 'an appeal with a ruling was refunded'; end if;

  -- Reduced: half the points, rounded up (a severe 7 keeps 3; a minor 2 keeps 1), no refund.
  c := pg_temp.player('fourr');
  hit := pg_temp.inf(c, t, 'severe');
  w0 := pg_temp.wallet(c);
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'reduced', 'Fine. Less.');
  if warn_points(c) is distinct from 3 or (closed ->> 'points_delta')::integer is distinct from -4 or closed ->> 'line' is distinct from 'Fine. Less.' then raise exception 'reduced severe: % / %', closed, warn_points(c); end if;
  if pg_temp.wallet(c) is distinct from w0 - 50 then raise exception 'a reduced appeal was refunded'; end if;
  c := pg_temp.player('fourr2');
  hit := pg_temp.inf(c, t, 'minor');
  perform close_appeal((pg_temp.appeal(c, (hit ->> 'infraction')::uuid) ->> 'appeal')::uuid, 'reduced');
  if warn_points(c) is distinct from 1 then raise exception 'reduced minor: %', warn_points(c); end if;

  -- Upheld: nothing changes, the Mod's own stock line is used where the instance gave one.
  c := pg_temp.player('fouru');
  hit := pg_temp.inf(c, t, 'moderate');
  w0 := pg_temp.wallet(c);
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'upheld', '   ');
  if warn_points(c) is distinct from 4 or (closed ->> 'points_delta')::integer is distinct from 0 or closed ->> 'line' is distinct from 'Appeal Mod One turns Ap fouru down.' or pg_temp.wallet(c) is distinct from w0 - 50 then
    raise exception 'upheld: % / %', closed, warn_points(c);
  end if;

  -- Increased: one more infraction of the same band for the same post; the bar rises by that band's points.
  c := pg_temp.player('fouri');
  hit := pg_temp.inf(c, t, 'moderate');
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'increased');
  if warn_points(c) is distinct from 8 or (closed ->> 'points_delta')::integer is distinct from 4 then raise exception 'increased: % / %', closed, warn_points(c); end if;
  select * into inf from acts where id = (closed ->> 'infraction')::uuid;
  if inf.kind is distinct from 'infraction' or inf.payload ->> 'band' is distinct from 'moderate' or inf.payload ->> 'about_act' is distinct from hit ->> 'post' or inf.payload ->> 'staff' is distinct from 'ap-m1' then raise exception 'the added infraction is wrong: %', to_jsonb(inf); end if;
  select count(*) into n from acts where kind = 'infraction' and payload ->> 'character' = c::text;
  if n <> 2 then raise exception 'increased filed % infractions', n; end if;
  -- An increase that fills the bar bans.
  c := pg_temp.player('fourib');
  hit := pg_temp.inf(c, t, 'severe');
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'increased');
  if closed ->> 'ban' is null or banned_until(c) is null or warn_points(c) is distinct from 0 then raise exception 'an increase that filled the bar did not ban: % / %', closed, banned_until(c); end if;
end $$;

-- ---- 5. close_appeal on a ban: overturned ends it at once, reduced and increased move its end by half its length, upheld leaves it ----
do $$
declare
  t uuid := tests.thread('Appeals five');
  c uuid; ban uuid; b acts%rowtype; ap jsonb; closed jsonb; w0 integer; first_ban uuid; second_ban uuid; spare uuid[]; four uuid[];
begin
  -- Overturned: the ban is over at once, the character posts again, and the price is back.
  c := pg_temp.player('fiveo');
  spare := pg_temp.posts(c, t);
  ban := pg_temp.banned(c, t);
  if banned_until(c) is null then raise exception 'the ban is not running'; end if;
  w0 := pg_temp.wallet(c);
  ap := pg_temp.appeal(c, ban);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'overturned', null, 'ap-boss');
  if banned_until(c) is not null then raise exception 'an overturned ban still runs until %', banned_until(c); end if;
  if pg_temp.wallet(c) is distinct from w0 then raise exception 'an overturned ban appeal was not refunded'; end if;
  perform not_banned(c);
  if (select payload ->> 'until' from acts where id = ban) is null then raise exception 'the ban Act was changed'; end if;
  -- The ladder does not count it: the next ban is the first rung (one day), not the second (three).
  first_ban := ban;
  second_ban := pg_temp.fill(c, spare);
  if (select (payload ->> 'days')::integer from acts where id = second_ban) is distinct from 1 then raise exception 'an overturned ban stepped the ladder: % days', (select payload ->> 'days' from acts where id = second_ban); end if;

  -- Reduced: half its length from its start. A three-day ban (the second rung) ends after a day and a half.
  c := pg_temp.player('fiver2');
  four := pg_temp.posts(c, t, 4);
  perform pg_temp.fill(c, four[1:2]);
  ban := pg_temp.fill(c, four[3:4]);
  perform close_appeal((pg_temp.appeal(c, ban) ->> 'appeal')::uuid, 'reduced');
  select * into b from acts where id = ban;
  if (b.payload ->> 'days')::integer is distinct from 3 then raise exception 'the second rung is % days', b.payload ->> 'days'; end if;
  if banned_until(c) is distinct from b.created_at + interval '36 hours' then raise exception 'a reduced three-day ban ends % (wanted %)', banned_until(c), b.created_at + interval '36 hours'; end if;

  -- Increased: half its length longer.
  c := pg_temp.player('fivei');
  ban := pg_temp.banned(c, t);
  select * into b from acts where id = ban;
  perform close_appeal((pg_temp.appeal(c, ban) ->> 'appeal')::uuid, 'increased');
  if banned_until(c) is distinct from (b.payload ->> 'until')::timestamptz + interval '12 hours' then raise exception 'an increased one-day ban ends % (wanted %)', banned_until(c), (b.payload ->> 'until')::timestamptz + interval '12 hours'; end if;

  -- Upheld: as it was.
  c := pg_temp.player('fiveu');
  ban := pg_temp.banned(c, t);
  select * into b from acts where id = ban;
  perform close_appeal((pg_temp.appeal(c, ban) ->> 'appeal')::uuid, 'upheld');
  if banned_until(c) is distinct from (b.payload ->> 'until')::timestamptz then raise exception 'an upheld ban moved to %', banned_until(c); end if;
end $$;

-- ---- 6. refund_appeal and the sweep: a failed judge leaves the appeal available ----
do $$
declare
  t uuid := tests.thread('Appeals six');
  c uuid := pg_temp.player('six');
  hit jsonb := pg_temp.inf(c, t, 'minor');
  inf uuid := (hit ->> 'infraction')::uuid;
  w0 integer := pg_temp.wallet(c);
  ap jsonb; again jsonb; n0 bigint; said text; old uuid; s uuid;
  stale_c uuid := pg_temp.player('sixstale');
  stale_inf uuid;
  k integer;
begin
  ap := pg_temp.appeal(c, inf);
  n0 := (select count(*) from acts where thread = t);
  again := refund_appeal((ap ->> 'appeal')::uuid);
  if not (again ->> 'refunded')::boolean or (again ->> 'amount')::integer <> 50 or pg_temp.wallet(c) is distinct from w0 then raise exception 'the refund did not give the price back: %', again; end if;
  if (select count(*) from acts where thread = t) is distinct from n0 then raise exception 'a refund wrote an Act'; end if;
  if (refund_appeal((ap ->> 'appeal')::uuid) ->> 'already') is distinct from 'true' or pg_temp.wallet(c) is distinct from w0 then raise exception 'a second refund moved the wallet'; end if;
  if (select why from appeal_refunds where appeal_act = (ap ->> 'appeal')::uuid) is distinct from 'failed' then raise exception 'the refund is not marked failed'; end if;
  -- A refunded appeal cannot be closed.
  again := close_appeal((ap ->> 'appeal')::uuid, 'overturned');
  if (again ->> 'closed')::boolean or not (again ->> 'refunded')::boolean or exists (select 1 from acts where kind = 'appeal_ruling' and target_act_id = (ap ->> 'appeal')::uuid) then raise exception 'a refunded appeal was closed: %', again; end if;
  if warn_points(c) is distinct from 2 then raise exception 'a refunded appeal moved the bar'; end if;
  -- The punishment can be appealed again, and now it is used.
  ap := pg_temp.appeal(c, inf, 'Again, please.');
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', c, inf));
  if said is null then raise exception 'a punishment with an open appeal was appealed twice'; end if;
  if (select count(*) from acts where kind = 'appeal' and target_act_id = inf) is distinct from 2::bigint then raise exception 'the refunded appeal was lost'; end if;

  -- The sweep: an appeal paid an hour ago and never judged is refunded; a fresh one is not; one with a ruling is not.
  stale_inf := (pg_temp.inf(stale_c, t, 'minor') ->> 'infraction')::uuid;
  perform set_config('kayfabb.appeal_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (stale_c, 'appeal', t, stale_inf, '{"plea": "never judged"}', now() - interval '1 hour') returning id into old;
  perform set_config('kayfabb.appeal_writer', '', true);
  if refund_stale_appeals(10) is distinct from 1 then raise exception 'the sweep did not take exactly the old appeal'; end if;
  if (select why from appeal_refunds where appeal_act = old) is distinct from 'stale' then raise exception 'the sweep''s refund is not marked stale'; end if;
  if exists (select 1 from appeal_refunds where appeal_act = (ap ->> 'appeal')::uuid) then raise exception 'the sweep took a fresh appeal'; end if;
  -- A swept appeal frees the punishment, but only three times: the third abandoned appeal of one punishment is the last.
  if appeal_blocks(stale_inf) then raise exception 'one swept appeal blocked the punishment'; end if;
  for k in 1..2 loop
    perform set_config('kayfabb.appeal_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload, created_at) values (stale_c, 'appeal', t, stale_inf, '{"plea": "never judged"}', now() - interval '1 hour');
    perform set_config('kayfabb.appeal_writer', '', true);
    if not appeal_blocks(stale_inf) then raise exception 'an unswept appeal did not block the punishment'; end if;
    perform refund_stale_appeals(10);
    if appeal_blocks(stale_inf) is distinct from (k = 2) then raise exception 'after % swept appeals the punishment blocks: %', k + 1, appeal_blocks(stale_inf); end if;
  end loop;
end $$;

-- ---- 7. The budget counts appeals in flight with the reports, in one count, the same words for everyone ----
do $$
declare
  t uuid := tests.thread('Appeals seven');
  c uuid := pg_temp.player('seven');
  d uuid := pg_temp.player('sevenb');
  hit jsonb := pg_temp.inf(c, t, 'minor');
  hit2 jsonb := pg_temp.inf(d, t, 'minor');
  was jsonb := (select value from settings where key = 'modBots');
  load0 integer := judgment_load_today();
  ap jsonb; said text; said2 text; w integer := pg_temp.wallet(d);
begin
  ap := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  if judgment_load_today() is distinct from load0 + 1 then raise exception 'an appeal in flight did not hold the budget: % -> %', load0, judgment_load_today(); end if;
  -- A billed call of its own takes its place in the ledger's count: the in-flight term drops.
  perform record_staff_call((ap ->> 'appeal')::uuid, 'appeal', 'ap-m1', '{"calls": 1}');
  if judgment_load_today() is distinct from load0 then raise exception 'an appeal with a record still counted twice: %', judgment_load_today(); end if;
  -- The budget spent: refused before anything is paid, in the same words for anyone.
  update settings set value = jsonb_set(value, '{judgmentsPerDay}', to_jsonb(judgment_load_today())) where key = 'modBots';
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', d, hit2 ->> 'infraction'));
  update settings set value = was where key = 'modBots';
  if said is null or said not like '%appeals they will today%' then raise exception 'the budget did not refuse: %', said; end if;
  if pg_temp.wallet(d) is distinct from w or exists (select 1 from acts where kind = 'appeal' and character = d) then raise exception 'a budget refusal wrote or spent something'; end if;
  -- A ruling or a refund takes it out of flight.
  load0 := judgment_load_today();
  ap := pg_temp.appeal(d, (hit2 ->> 'infraction')::uuid);
  if judgment_load_today() is distinct from load0 + 1 then raise exception 'the second appeal did not hold the budget'; end if;
  perform refund_appeal((ap ->> 'appeal')::uuid);
  if judgment_load_today() is distinct from load0 then raise exception 'a refunded appeal still held the budget'; end if;
end $$;

-- ---- 8. Masks: the hearing is told only public things ----
do $$
declare
  t uuid := tests.thread('Appeals eight');
  c uuid := pg_temp.player('eight');
  hit jsonb := pg_temp.inf(c, t, 'minor');
  ap jsonb := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
begin
  -- Everything open_appeal answers is a public Act's or a public name: no owner, no class.
  if ap::text ~* '(owner|class|account|reactor)' then raise exception 'open_appeal answers something private: %', ap; end if;
  if (select jsonb_object_keys(ap) limit 1) is null then raise exception 'empty answer'; end if;
end $$;

-- ---- 9. The doors ----
do $$
declare
  t uuid := tests.thread('Appeals doors');
  c uuid := pg_temp.player('doors');
  hit jsonb := pg_temp.inf(c, t, 'minor');
  ap jsonb := pg_temp.appeal(c, (hit ->> 'infraction')::uuid);
  said text;
  w integer := pg_temp.wallet(c);
begin
  perform tests.become((select owner from characters where id = c));
  for said in select unnest(array[
      format('select close_appeal(%L, ''overturned'')', ap ->> 'appeal'),
      format('select refund_appeal(%L)', ap ->> 'appeal'),
      'select refund_stale_appeals(1)',
      format('select appeal_hearer(%L)', hit ->> 'infraction'),
      format('select appeal_line(''appealUpheld'', ''ap-m1'', ''x'')'),
      format('select infract(%L, ''severe'', %L, ''ap-m1'')', c, hit ->> 'post')]) loop
    if pg_temp.refusal(said) is null then raise exception 'a player ran %', said; end if;
  end loop;
  -- A client cannot write an appeal or a ruling by hand.
  if pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''appeal'', %L, %L, ''{"plea": "by hand"}'')', c, t, hit ->> 'infraction')) is null then raise exception 'a player wrote an appeal by hand'; end if;
  if pg_temp.refusal('select * from appeal_refunds') is null then raise exception 'a client read appeal_refunds'; end if;
  perform tests.unbecome();
  -- Not even as the owner of the table: only open_appeal writes an appeal, and a ruling only a staff character's, on an appeal.
  if pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''appeal'', %L, %L, ''{"plea": "by hand"}'')', c, t, hit ->> 'infraction')) is null then raise exception 'an appeal was written outside open_appeal'; end if;
  if pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''appeal_ruling'', %L, %L, jsonb_build_object(''appeal_act'', %L::text, ''verdict'', ''overturned'', ''points_delta'', -2, ''line'', ''x''))', c, t, ap ->> 'appeal', ap ->> 'appeal')) is null then raise exception 'a player''s character gave a ruling'; end if;
  if pg_temp.refusal(format('select write_staff_act(''ap-m1'', ''appeal_ruling'', %L, %L, jsonb_build_object(''appeal_act'', %L::text, ''verdict'', ''upheld'', ''points_delta'', 0, ''line'', ''x''))', t, hit ->> 'post', hit ->> 'post')) is null then raise exception 'a ruling was written on a post'; end if;
  -- A ruling is bounded in shape: no verdict that is none of the four.
  if pg_temp.refusal(format('select write_staff_act(''ap-m1'', ''appeal_ruling'', %L, %L, jsonb_build_object(''appeal_act'', %L::text, ''verdict'', ''banned'', ''points_delta'', 0, ''line'', ''x''))', t, ap ->> 'appeal', ap ->> 'appeal')) is null then raise exception 'a ruling with a verdict outside the list was written'; end if;
  if pg_temp.refusal(format('select close_appeal(%L, ''banned'')', ap ->> 'appeal')) is null then raise exception 'a verdict outside the list was taken'; end if;
  if pg_temp.wallet(c) is distinct from w then raise exception 'the doors moved a wallet'; end if;
end $$;

-- ---- 10. A punishment that has run out is not appealed: nothing is paid or written, and no increase can revive it ----
do $$
declare
  t uuid := tests.thread('Appeals ten');
  c uuid := pg_temp.player('tenexp');
  two uuid[] := pg_temp.posts(c, t, 3);
  old_inf uuid;
  expired uuid;
  gone_ban uuid;
  bc uuid := pg_temp.player('tenban');
  bposts uuid[] := pg_temp.posts(bc, t, 2);
  emptied uuid;
  w0 integer := pg_temp.wallet(c);
  said text;
begin
  -- An infraction past its expiry (planted whole, as infract would have written it, a fortnight ago).
  perform set_config('kayfabb.warn_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at) values (null, 'infraction', t,
    jsonb_build_object('character', c, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', (select board from threads where id = t), 'about_act', two[1], 'visit_act', null, 'staff', 'ap-m1',
                       'expires_at', now() - interval '1 day'), now() - interval '15 days') returning id into expired;
  perform set_config('kayfabb.warn_writer', '', true);
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', c, expired));
  if said is null or said not like '%already run out%' then raise exception 'an expired infraction was appealed: %', said; end if;
  -- A ban whose end has passed.
  perform set_config('kayfabb.warn_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at) values (null, 'ban', t,
    jsonb_build_object('character', c, 'days', 1, 'until', now() - interval '1 hour', 'infraction_act', expired, 'season', 1), now() - interval '25 hours') returning id into gone_ban;
  perform set_config('kayfabb.warn_writer', '', true);
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', c, gone_ban));
  if said is null or said not like '%already run out%' then raise exception 'an ended ban was appealed: %', said; end if;
  -- An infraction a later ban emptied from the bar.
  old_inf := (infract(bc, 'severe', bposts[1], 'ap-m1') ->> 'infraction')::uuid;
  perform infract(bc, 'moderate', bposts[2], 'ap-m1');
  if warn_points(bc) is distinct from 0 then raise exception 'the bar was not emptied'; end if;
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', bc, old_inf));
  if said is null or said not like '%already run out%' then raise exception 'an infraction the bar no longer counts was appealed: %', said; end if;
  -- An overturned or reduced ban that is over by its ruling is over: it is not appealed again (the one appeal is used in any case).
  if pg_temp.wallet(c) is distinct from w0 or exists (select 1 from acts where kind = 'appeal' and character in (c, bc) and target_act_id in (expired, gone_ban, old_inf)) then raise exception 'a refusal wrote or spent something'; end if;
  if exists (select 1 from wallet_events e where e.kind = 'appeal' and e.account = (select owner from characters where id = c)) then raise exception 'a refusal left a wallet event'; end if;
  -- The live ban of the same character is still appealable.
  emptied := (select id from acts where kind = 'ban' and payload ->> 'character' = bc::text);
  if (pg_temp.appeal(bc, emptied) ->> 'appeal') is null then raise exception 'a running ban was refused'; end if;
end $$;

-- ---- 11. The other refusals, and who hears when no one is left ----
do $$
declare
  t uuid := tests.thread('Appeals eleven');
  c uuid := pg_temp.player('eleven');
  hit jsonb := pg_temp.inf(c, t, 'moderate');
  inf uuid := (hit ->> 'infraction')::uuid;
  bc uuid := pg_temp.player('elevenban');
  ban uuid := pg_temp.banned(bc, t);
  w0 integer := pg_temp.wallet(c);
  n0 bigint := (select count(*) from acts where kind = 'appeal' and thread = t);
  e0 bigint := (select count(*) from wallet_events where kind = 'appeal' and account = (select owner from characters where id = c));
  boss text := current_boss();
  said text; ap jsonb;
begin
  -- The System off: refused, nothing paid.
  update settings set value = 'false'::jsonb where key = 'systemEnabled';
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', c, inf));
  update settings set value = 'true'::jsonb where key = 'systemEnabled';
  if said is null or said not like '%no one on duty%' then raise exception 'an appeal was taken with The System off: %', said; end if;
  -- A ban with no Boss falls to the Mod on the beat.
  update seasons set boss = null where ends_at is null;
  if appeal_hearer(ban) is distinct from 'ap-m1' then raise exception 'a ban with no Boss is heard by %', appeal_hearer(ban); end if;
  -- No Boss and no Mod: no one hears, refused before anything is paid or written.
  insert into staff_offices (staff, office, cause) values ('ap-m1', 'member', 'admin'), ('ap-m2', 'member', 'admin');
  if appeal_hearer(inf) is not null or appeal_hearer(ban) is not null then raise exception 'someone hears with no one on staff'; end if;
  said := pg_temp.refusal(format('select pg_temp.appeal(%L, %L)', c, inf));
  if said is null or said not like '%no one on duty%' then raise exception 'an appeal with no one to hear it was taken: %', said; end if;
  if pg_temp.wallet(c) is distinct from w0 or (select count(*) from acts where kind = 'appeal' and thread = t) is distinct from n0
     or (select count(*) from wallet_events where kind = 'appeal' and account = (select owner from characters where id = c)) is distinct from e0 then raise exception 'a refusal wrote or spent something'; end if;
  insert into staff_offices (staff, office, cause) values ('ap-m1', 'mod', 'admin'), ('ap-m2', 'mod', 'admin');
  update seasons set boss = 'ap-boss' where ends_at is null;
  if current_boss() is distinct from boss then raise exception 'the Boss was not restored'; end if;
  -- A moderate infraction reduced loses half its points rounded up: 4 becomes 2.
  ap := pg_temp.appeal(c, inf);
  perform close_appeal((ap ->> 'appeal')::uuid, 'reduced');
  if warn_points(c) is distinct from 2 then raise exception 'a reduced moderate infraction counts %', warn_points(c); end if;
end $$;

-- ---- 12. The fallback lines: with no stock line in the instance's settings the plain default says the ruling ----
do $$
declare
  was jsonb := (select value from settings where key = 'systemLines');
begin
  update settings set value = '{}'::jsonb where key = 'systemLines';
  if appeal_line('appealOverturned', 'ap-m1', 'Bob') is distinct from 'Appeal Mod One heard Bob''s appeal and overturned it.'
     or appeal_line('appealReduced', 'ap-m1', 'Bob') is distinct from 'Appeal Mod One heard Bob''s appeal and reduced it.'
     or appeal_line('appealIncreased', 'ap-m1', 'Bob') is distinct from 'Appeal Mod One heard Bob''s appeal and increased it.'
     or appeal_line('appealUpheld', 'ap-m1', 'Bob') is distinct from 'Appeal Mod One heard Bob''s appeal and upheld it.' then
    raise exception 'a fallback line is wrong: % / %', appeal_line('appealOverturned', 'ap-m1', 'Bob'), appeal_line('appealUpheld', 'ap-m1', 'Bob');
  end if;
  -- A configured line is filled once, tokens only from the allowed two, and cut to 280.
  update settings set value = jsonb_build_object('appealUpheld', jsonb_build_array('{mod} to {appellant} {boss} {mod}')) where key = 'systemLines';
  if appeal_line('appealUpheld', 'ap-m1', '{mod}') is distinct from 'Appeal Mod One to {mod} {boss} Appeal Mod One' then raise exception 'a configured line is filled wrongly: %', appeal_line('appealUpheld', 'ap-m1', '{mod}'); end if;
  if was is not null then update settings set value = was where key = 'systemLines'; end if;
end $$;
