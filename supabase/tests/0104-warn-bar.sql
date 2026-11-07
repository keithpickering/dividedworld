-- The warn bar, infractions and timed bans (supabase/migrations/0102_warn_bar.sql; the Mod Bots design, section 5; its plan, Task 5).
--
-- An infraction and a ban are Acts of no character that name theirs in the payload (as a reveal does), written only by infract(); points land when a
-- visit files and drop off `decay` after they land; a full bar brings a timed ban on that character, empties the bar, and steps the season's ladder;
-- a banned character can browse but not post, start a thread, spin, edit, react, unmask or play a card, and the refusal says plainly when the ban ends.
-- Bans are per character: the mask test shows another mask of the same account is refused nothing.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm || ' [' || sqlstate || ']';
end $$;

-- The text a ban's refusal must carry: its end, in UTC, to the minute rounded up, so the time named is never before the real end.
create function pg_temp.ends(c uuid) returns text language sql as $$
  select to_char(date_trunc('minute', banned_until(c) + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
$$;

-- ---- Two filings at once: an infraction takes its time after it holds the character's row, so one filed after a ban counts toward the new bar ----
-- A second session holds the character's row and files the infraction that fills the bar (a ban); a first filing, begun before that, waits on the row. Once the
-- ban commits, the waiting infraction lands after it and counts: 2 points, not 0. Committed rows, so first, and removed at the end.
do $$
declare
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  tries integer := 0;
  got jsonb;
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}');
    insert into auth.users (id, email) values (%1$L, 'wb-race@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Wb Racer', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into threads (id, board, title) select %3$L, b.id, 'Wb race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%4$L, %2$L, 'post', %3$L, '{"body": "A racing post."}');
    do $d$ begin perform infract(%2$L, 'severe', %4$L, 'wb-mod'); end $d$;
  $sql$, u, c, t, p));
  perform extensions.dblink_connect('wbr_h', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_connect('wbr_a', current_setting('kayfabb.scratch_url'));
  perform extensions.dblink_exec('wbr_h', 'begin');
  perform * from extensions.dblink('wbr_h', format('select 1 from characters where id = %L for no key update', c)) as x(n integer);
  perform extensions.dblink_send_query('wbr_a', format('select /* wbr_a */ infract(%L, ''minor'', %L, ''wb-mod'')', c, p));
  -- The first filing has begun and waits on the row.
  loop
    exit when exists (select 1 from pg_stat_activity a where a.query like '%/* wbr_a */%' and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock');
    tries := tries + 1;
    if tries > 400 then raise exception 'the first filing never waited on the character''s row'; end if;
    perform pg_sleep(0.025);
  end loop;
  perform pg_sleep(0.05);
  perform * from extensions.dblink('wbr_h', format('select infract(%L, ''severe'', %L, ''wb-mod'')', c, p)) as x(r jsonb);
  perform extensions.dblink_exec('wbr_h', 'commit');
  select r into got from extensions.dblink_get_result('wbr_a') as x(r jsonb);
  perform extensions.dblink_disconnect('wbr_h');
  perform extensions.dblink_disconnect('wbr_a');
  if (select count(*) from acts where kind = 'ban' and payload ->> 'character' = c::text) is distinct from 1 then raise exception 'the second session''s filing banned once'; end if;
  if (select i.created_at from acts i where i.id = (got ->> 'infraction')::uuid) < (select b.created_at from acts b where b.kind = 'ban' and b.payload ->> 'character' = c::text) then
    raise exception 'an infraction that waited on the row for a ban is stamped before the ban';
  end if;
  if warn_points(c) <> 2 then raise exception 'an infraction filed after a ban counts toward the new bar: 2, got %', warn_points(c); end if;
  perform tests.commit(format($sql$
    delete from settings where key = 'warnBar';
  $sql$));
end $$;

-- Fixtures: two players (the first with two masks), the bar's numbers, a thread with a post of Other's to react to, and a card in each hand.
do $$
declare
  ann uuid := tests.account('wb-ann');
  bob uuid := tests.account('wb-bob');
  one uuid := tests.character(ann, 'Wb Mask One');
  two uuid := tests.character(ann, 'Wb Mask Two');
  other uuid := tests.character(bob, 'Wb Other');
  t uuid := tests.thread('Warn bar');
begin
  insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}')
    on conflict (key) do update set value = excluded.value;
  perform tests.post(other, t, 'Other''s post.');
  perform tests.post(other, t, 'Other''s second post.');
  perform tests.post(one, t, 'One''s post.');
  -- A Cast card (sweetie) and a Set card (bluffy, the engine's test set), two of each in Ann's hand.
  update settings set value = value || '{"bluffy.price": 25}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, trap, ward, lasts)
    values ('bluffy', 'Bluffy', 'pepperoni', 'bluffy.price', 'common', 'set', null, false, null) on conflict (key) do nothing;
  insert into card_ledger (account, card, kind, price) values (ann, 'sweetie', 'bought', 0), (ann, 'sweetie', 'bought', 0), (ann, 'bluffy', 'bought', 0), (ann, 'bluffy', 'bought', 0);
  insert into wallets (account, balance) values (ann, 600);
  perform tests.post(two, t, 'Mask Two''s own post.');
end $$;

create function pg_temp.id(label text) returns uuid language sql as $$ select id from characters where name = label $$;
create function pg_temp.post_of(by_name text, body text) returns uuid language sql as $$
  select id from acts where kind = 'post' and payload ->> 'body' = body and character = pg_temp.id(by_name)
$$;

-- ---- Points add by band, and an infraction is an Act of no character that names its own ----
do $$
declare
  c uuid := tests.character((select id from auth.users where email = 'wb-bob@test.invalid'), 'Wb Pointed');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  p uuid := tests.post(c, t, 'A breaking post.');
  got jsonb;
  row_ acts%rowtype;
  threads_before integer := (select next_seq from threads where id = t);
begin
  if warn_points(c) <> 0 then raise exception 'a character starts with an empty bar'; end if;
  got := infract(c, 'minor', p, 'wb-mod', 3, null);
  if warn_points(c) <> 2 then raise exception 'a minor adds 2, got %', warn_points(c); end if;
  select * into row_ from acts where id = (got ->> 'infraction')::uuid;
  if row_.kind <> 'infraction' or row_.character is not null then raise exception 'an infraction is an Act of no character'; end if;
  if row_.thread <> t or row_.seq is not null then raise exception 'it sits in the post''s thread and takes no seq'; end if;
  if (select next_seq from threads where id = t) is distinct from threads_before then raise exception 'it leaves its thread''s counters alone'; end if;
  if row_.payload ->> 'character' <> c::text or row_.payload ->> 'band' <> 'minor' or (row_.payload ->> 'points')::int <> 2
     or (row_.payload ->> 'rule_number')::int <> 3 or row_.payload ->> 'staff' <> 'wb-mod' or row_.payload ->> 'about_act' <> p::text
     or jsonb_typeof(row_.payload -> 'visit_act') <> 'null' or (row_.payload ->> 'board')::uuid <> (select board from threads where id = t) then
    raise exception 'the payload freezes the band, points, rule, board and staff: %', row_.payload;
  end if;
  if (row_.payload ->> 'expires_at')::timestamptz <> row_.created_at + interval '14 days' then raise exception 'it expires decay after it lands: %', row_.payload; end if;
  perform infract(c, 'moderate', p, 'wb-mod');
  if warn_points(c) <> 6 then raise exception 'a moderate adds 4, got %', warn_points(c); end if;
  if banned_until(c) is not null then raise exception 'six of ten is no ban'; end if;
  -- Frozen: a later change to the bands moves nothing already landed.
  update settings set value = '{"size": 10, "bands": {"minor": 1, "moderate": 1, "severe": 1}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}' where key = 'warnBar';
  if warn_points(c) <> 6 then raise exception 'landed points are frozen on the Act'; end if;
  update settings set value = '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}' where key = 'warnBar';
end $$;

-- ---- The guard: nothing but infract() writes an infraction or a ban; infract refuses what it cannot warn ----
do $$
declare
  c uuid := pg_temp.id('Wb Pointed');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  p uuid := pg_temp.post_of('Wb Pointed', 'A breaking post.');
  inf uuid := (select id from acts where kind = 'infraction' limit 1);
  card uuid := tests.act(c, 'card', t, '{"card": "sweetie"}', p);
  why text;
begin
  why := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (null, ''infraction'', %L, %L)', t,
    jsonb_build_object('character', c, 'band', 'minor', 'points', 2, 'rule_number', 1, 'board', (select board from threads where id = t), 'about_act', p, 'visit_act', null, 'staff', 'x', 'expires_at', now() + interval '1 day')));
  if why is null or why not like '%only through infract%' then raise exception 'a direct infraction is refused by the guard, got %', why; end if;
  why := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (null, ''ban'', %L, %L)', t,
    jsonb_build_object('character', c, 'days', 1, 'until', now() + interval '1 day', 'infraction_act', inf, 'season', 1)));
  if why is null or why not like '%only through infract%' then raise exception 'a direct ban is refused by the guard, got %', why; end if;
  why := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''infraction'', %L, ''{}'')', c, t));
  if why is null then raise exception 'an infraction with an author is refused'; end if;
  why := pg_temp.refusal(format('select infract(%L, ''dire'', %L, ''wb-mod'')', c, p));
  if why is null or why not like '%band%' then raise exception 'an unknown band is refused, got %', why; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''wb-mod'')', c, card));
  if why is null or why not like '%post%' then raise exception 'an infraction is for a post, got %', why; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''wb-mod'')', c, pg_temp.post_of('Wb Other', 'Other''s post.')));
  if why is null or why not like '%post this character wrote%' then raise exception 'an infraction is for a post the character wrote, got %', why; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, '''')', c, p));
  if why is null then raise exception 'an infraction names the Mod that filed it'; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''wb-mod'')', gen_random_uuid(), p));
  if why is null then raise exception 'there is no character to warn'; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''wb-mod'', 1, %L)', c, p, gen_random_uuid()));
  if why is null then raise exception 'a visit that is no Act is refused'; end if;
  -- Not callable by a player, a visitor, or from the web.
  perform tests.become((select id from auth.users where email = 'wb-ann@test.invalid'));
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''wb-mod'')', c, p));
  if why is null or why not like '%permission denied%' then raise exception 'a player cannot warn anyone, got %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- An infraction drops off after the decay (set short by the settings), and its expiry is the decay from landing ----
do $$
declare
  c uuid := tests.character((select id from auth.users where email = 'wb-bob@test.invalid'), 'Wb Fading');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  p uuid := tests.post(c, t, 'A fading post.');
  got jsonb;
  inf acts%rowtype;
begin
  update settings set value = '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "minute", "count": 1}, "banDays": [1, 3, 7]}' where key = 'warnBar';
  got := infract(c, 'severe', p, 'wb-mod');
  select * into inf from acts where id = (got ->> 'infraction')::uuid;
  if (inf.payload ->> 'expires_at')::timestamptz <> inf.created_at + interval '1 minute' then raise exception 'the decay comes from the setting at landing: %', inf.payload; end if;
  if warn_points(c) <> 7 then raise exception 'seven points while it counts, got %', warn_points(c); end if;
  -- Time passes: the Act is backdated by hand (an Act is never edited in play; the harness switches the guard off for this one statement).
  alter table acts disable trigger acts_no_update;
  update acts set created_at = created_at - interval '2 minutes',
                  payload = jsonb_set(payload, '{expires_at}', to_jsonb((inf.created_at - interval '1 minute')::text)) where id = inf.id;
  alter table acts enable trigger acts_no_update;
  if warn_points(c) <> 0 then raise exception 'an expired infraction no longer counts, got %', warn_points(c); end if;
  update settings set value = '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}' where key = 'warnBar';
end $$;

-- ---- A full bar bans, empties the bar, and steps the ladder 1, 3, 7, 7 ----
create function pg_temp.fill(c uuid, p uuid) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  -- Severe after severe until the bar is full (two are enough from an empty bar, and never more than three).
  for i in 1 .. 3 loop
    got := infract(c, 'severe', p, 'wb-mod');
    if got ->> 'ban' is not null then return got; end if;
  end loop;
  raise exception 'three severe infractions did not fill a bar of ten';
end $$;

do $$
declare
  c uuid := tests.character((select id from auth.users where email = 'wb-bob@test.invalid'), 'Wb Ladder');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  p uuid := tests.post(c, t, 'A ladder post.');
  got jsonb;
  b acts%rowtype;
  expected integer[] := array[1, 3, 7, 7];
  step integer;
  last_until timestamptz;
begin
  for step in 1 .. 4 loop
    got := pg_temp.fill(c, p);
    if got ->> 'ban' is null then raise exception 'ban %: a full bar brings a ban: %', step, got; end if;
    select * into b from acts where id = (got ->> 'ban')::uuid;
    if b.kind <> 'ban' or b.character is not null or b.thread <> t or b.seq is not null then raise exception 'a ban is an Act of no character, in the post''s thread, with no seq'; end if;
    if (b.payload ->> 'days')::int <> expected[step] then raise exception 'ban %: the ladder says % days, got %', step, expected[step], b.payload; end if;
    if (b.payload ->> 'until')::timestamptz <> b.created_at + make_interval(days => expected[step]) then raise exception 'ban %: until is days after the ban: %', step, b.payload; end if;
    if b.payload ->> 'character' <> c::text or (b.payload ->> 'season')::int <> 1 or b.payload ->> 'infraction_act' <> got ->> 'infraction' then
      raise exception 'ban %: the payload names the character, the season and the infraction that filled the bar: %', step, b.payload;
    end if;
    if warn_points(c) <> 0 then raise exception 'ban %: a ban empties the bar, got %', step, warn_points(c); end if;
    if banned_until(c) <> (b.payload ->> 'until')::timestamptz then raise exception 'ban %: banned_until is the ban''s end', step; end if;
    -- Points from before the last ban are gone; points after it count again.
    if step < 4 then
      perform infract(c, 'minor', p, 'wb-mod');
      if warn_points(c) <> 2 then raise exception 'ban %: only what lands after the last ban counts, got %', step, warn_points(c); end if;
    end if;
  end loop;
  if (select count(*) from acts where kind = 'ban' and payload ->> 'character' = c::text) is distinct from 4 then raise exception 'four bans in all'; end if;
end $$;

-- ---- A bar filled exactly reaches the size; one point short does not ----
do $$
declare
  owner uuid := (select id from auth.users where email = 'wb-bob@test.invalid');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  short uuid := tests.character(owner, 'Wb Short');
  exact uuid := tests.character(owner, 'Wb Exact');
  sp uuid := tests.post(short, t, 'A short post.');
  ep uuid := tests.post(exact, t, 'An exact post.');
  got jsonb;
begin
  perform infract(short, 'severe', sp, 'wb-mod');
  got := infract(short, 'minor', sp, 'wb-mod');
  if got ->> 'ban' is not null or warn_points(short) <> 9 then raise exception 'nine of ten is no ban'; end if;
  update settings set value = '{"size": 9, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}' where key = 'warnBar';
  perform infract(exact, 'severe', ep, 'wb-mod');
  if infract(exact, 'minor', ep, 'wb-mod') ->> 'ban' is null then raise exception 'nine of nine fills the bar'; end if;
  update settings set value = '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}' where key = 'warnBar';
end $$;

-- ---- No open season: the ban takes the latest season's number (not 0), the ladder goes on, and the ban ends at its own `until` whatever the season does ----
do $$
declare
  c uuid := tests.character(tests.account('wb-gap'), 'Wb Gap');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  p uuid := tests.post(c, t, 'A gap post.');
  got jsonb;
  b acts%rowtype;
  latest integer := (select max(number) from seasons);
begin
  update seasons set ends_at = now() where ends_at is null;
  if exists (select 1 from seasons where ends_at is null) then raise exception 'no season is open'; end if;
  got := pg_temp.fill(c, p);
  select * into b from acts where id = (got ->> 'ban')::uuid;
  if (b.payload ->> 'season')::int <> latest then raise exception 'with no open season a ban takes the latest season''s number %, got %', latest, b.payload; end if;
  got := pg_temp.fill(c, p);
  if ((select payload from acts where id = (got ->> 'ban')::uuid) ->> 'days')::int <> 3 then raise exception 'the ladder goes on through the gap'; end if;
  -- A season's end does not end its bans: banned_until is the ban's own end.
  if banned_until(c) <> (select max((x.payload ->> 'until')::timestamptz) from acts x where x.kind = 'ban' and x.payload ->> 'character' = c::text)
     or banned_until(c) < now() + interval '2 days' then
    raise exception 'a ban ends at its own until after its season has ended, got %', banned_until(c);
  end if;
end $$;

-- ---- An infraction filed while banned counts toward the next bar; a second, overlapping ban makes banned_until the later end ----
do $$
declare
  c uuid := tests.character(tests.account('wb-overlap'), 'Wb Overlap');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  p uuid := tests.post(c, t, 'An overlap post.');
  first_ban acts%rowtype;
  second_ban acts%rowtype;
begin
  update settings set value = '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [7, 1]}' where key = 'warnBar';
  select * into first_ban from acts where id = (pg_temp.fill(c, p) ->> 'ban')::uuid;
  perform infract(c, 'severe', p, 'wb-mod');
  if warn_points(c) <> 7 then raise exception 'an infraction filed while banned counts toward the next bar, got %', warn_points(c); end if;
  select * into second_ban from acts where id = (infract(c, 'severe', p, 'wb-mod') ->> 'ban')::uuid;
  if (second_ban.payload ->> 'days')::int <> 1 then raise exception 'the second ban steps the ladder: %', second_ban.payload; end if;
  if (second_ban.payload ->> 'until')::timestamptz >= (first_ban.payload ->> 'until')::timestamptz then raise exception 'the second ban ends before the first'; end if;
  if banned_until(c) <> (first_ban.payload ->> 'until')::timestamptz then raise exception 'overlapping bans: banned_until is the later end, got %', banned_until(c); end if;
  update settings set value = '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}' where key = 'warnBar';
end $$;

-- ---- The ladder resets in a new season ----
do $$
declare
  c uuid := pg_temp.id('Wb Ladder');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  p uuid := pg_temp.post_of('Wb Ladder', 'A ladder post.');
  got jsonb;
  b acts%rowtype;
begin
  update seasons set ends_at = now() where ends_at is null;
  insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), now());
  got := pg_temp.fill(c, p);
  select * into b from acts where id = (got ->> 'ban')::uuid;
  if (b.payload ->> 'days')::int <> 1 or (b.payload ->> 'season')::int <> (select max(number) from seasons) then
    raise exception 'a new season starts the ladder over at its first step, got %', b.payload;
  end if;
  got := pg_temp.fill(c, p);
  if ((select payload from acts where id = (got ->> 'ban')::uuid) ->> 'days')::int <> 3 then raise exception 'and steps again from there'; end if;
  if banned_until(pg_temp.id('Wb Gap')) < now() + interval '2 days' then raise exception 'a ban from an earlier season runs to its own end after the next season begins'; end if;
end $$;

-- ---- Refusals: a banned character cannot post, start a thread, spin, edit, react, unmask or play a card; the message says when it ends ----
do $$
declare
  ann uuid := (select id from auth.users where email = 'wb-ann@test.invalid');
  bob uuid := (select id from auth.users where email = 'wb-bob@test.invalid');
  one uuid := pg_temp.id('Wb Mask One');
  other uuid := pg_temp.id('Wb Other');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  others_post uuid := pg_temp.post_of('Wb Other', 'Other''s post.');
  ones_post uuid := pg_temp.post_of('Wb Mask One', 'One''s post.');
  why text;
  ends text;
begin
  perform infract(one, 'severe', ones_post, 'wb-mod');
  perform infract(one, 'severe', ones_post, 'wb-mod');
  ends := pg_temp.ends(one);
  if ends is null then raise exception 'Mask One is banned'; end if;
  if pg_temp.refusal(format('select not_banned(%L)', one)) not like '%holds only this character, not your other characters%' then raise exception 'the refusal says what the ban holds'; end if;
  -- The time named is never before the real end (it is rounded up to the minute).
  if (substr(pg_temp.refusal(format('select not_banned(%L)', one)), position('banned until ' in pg_temp.refusal(format('select not_banned(%L)', one))) + 13, 16) || ':00+00')::timestamptz < banned_until(one)
     or (substr(pg_temp.refusal(format('select not_banned(%L)', one)), position('banned until ' in pg_temp.refusal(format('select not_banned(%L)', one))) + 13, 16) || ':00+00')::timestamptz >= banned_until(one) + interval '1 minute' then
    raise exception 'the refusal names a minute at or after the real end, within a minute of it';
  end if;

  perform tests.become(ann);
  why := pg_temp.refusal(format('select post(%L, %L, ''Still talking.'')', t, one));
  if why is null or why not like '%banned until ' || ends || '%UTC%' or why not like '%ends by itself%' then raise exception 'post: a plain refusal naming the end, got %', why; end if;
  if why not like '%[55000]' then raise exception 'post: refused as a state, not a permission, got %', why; end if;
  why := pg_temp.refusal(format('select start_thread(''general'', %L, ''A new thread'', ''Body.'')', one));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'start_thread, got %', why; end if;
  why := pg_temp.refusal(format('select spin(%L, %L, ''A spun thread'', ''Body.'')', others_post, one));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'spin, got %', why; end if;
  why := pg_temp.refusal(format('select edit_post(%L, %L, ''Edited.'')', ones_post, one));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'edit_post, got %', why; end if;
  why := pg_temp.refusal(format('select react(%L, %L, ''up'')', others_post, one));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'react, got %', why; end if;
  why := pg_temp.refusal(format('select unmask(%L, %L, ''It was me.'')', one, t));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'unmask, got %', why; end if;
  perform tests.unbecome();
  perform tests.become_service();
  why := pg_temp.refusal(format('select play_card(%L, ''sweetie'', %L, %L, ''{}'', 0, '''')', ann, one, others_post));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'play_card, got %', why; end if;
  why := pg_temp.refusal(format('select play_card(%L, ''sweetie'', %L, %L, ''{}'', 0, '''', ''post'', null, null)', ann, one, others_post));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'play_card with a version, got %', why; end if;
  why := pg_temp.refusal(format('select set_card(%L, ''bluffy'', %L, %L, ''{}'', 0)', ann, one, ones_post));
  if why is null or why not like '%banned until ' || ends || '%' then raise exception 'set_card, got %', why; end if;
  perform tests.unbecome();
  -- Nothing was written by any of them.
  if exists (select 1 from acts where character = one and kind in ('edit', 'spin', 'card', 'unmask') ) then raise exception 'a refused write left an Act'; end if;
  if exists (select 1 from threads where title in ('A new thread', 'A spun thread')) then raise exception 'a refused thread was made'; end if;

  -- The mask test: Mask Two, of the same account, is refused nothing; nor is another player.
  perform tests.become(ann);
  perform post(t, pg_temp.id('Wb Mask Two'), 'Mask Two talks.');
  perform react(others_post, pg_temp.id('Wb Mask Two'), 'up');
  perform start_thread('general', pg_temp.id('Wb Mask Two'), 'Mask Two''s thread', 'Body.');
  perform spin(others_post, pg_temp.id('Wb Mask Two'), 'Mask Two spins', 'Body.');
  perform tests.unbecome();
  perform tests.become_service();
  perform play_card(ann, 'sweetie', pg_temp.id('Wb Mask Two'), others_post, '{}', 0, '');
  perform set_card(ann, 'bluffy', pg_temp.id('Wb Mask Two'), pg_temp.post_of('Wb Mask Two', 'Mask Two''s own post.'), '{}', 0);
  perform tests.unbecome();
  perform tests.become(bob);
  perform post(t, other, 'Other talks.');
  perform tests.unbecome();

  -- A banned character can still browse and keep its profile.
  perform tests.become(ann);
  if thread_page(t, 1, null, null, array[]::text[]) is null then raise exception 'a banned character can read a thread'; end if;
  perform set_profile(one, 'Still here', 'a signature', 'default');
  perform tests.unbecome();
end $$;

-- ---- Nothing is refused once banned_until passes ----
do $$
declare
  ann uuid := (select id from auth.users where email = 'wb-ann@test.invalid');
  one uuid := pg_temp.id('Wb Mask One');
  t uuid := (select thread from acts where payload ->> 'body' = 'Other''s post.');
  others_post uuid := pg_temp.post_of('Wb Other', 'Other''s post.');
  ones_post uuid := pg_temp.post_of('Wb Mask One', 'One''s post.');
begin
  alter table acts disable trigger acts_no_update;
  update acts set payload = jsonb_set(payload, '{until}', to_jsonb((now() - interval '1 minute')::text)) where kind = 'ban' and payload ->> 'character' = one::text;
  alter table acts enable trigger acts_no_update;
  if banned_until(one) is not null then raise exception 'banned_until is null once the ban has passed'; end if;
  perform tests.become(ann);
  perform post(t, one, 'Back again.');
  perform edit_post(ones_post, one, 'Edited at last.');
  perform react(others_post, one, 'wow');
  perform start_thread('general', one, 'Back with a thread', 'Body.');
  perform spin(others_post, one, 'Back with a spin', 'Body.');
  perform unmask(one, t, 'It was me.');
  perform tests.unbecome();
  perform tests.become_service();
  perform play_card(ann, 'sweetie', one, pg_temp.post_of('Wb Other', 'Other''s second post.'), '{}', 0, '');
  perform set_card(ann, 'bluffy', one, pg_temp.post_of('Wb Mask One', 'Back again.'), '{}', 0);
  perform tests.unbecome();
end $$;

-- ---- The reads carry warn_points and banned_until: characters_public, thread_page's people, profile_page, and presence_box's names ----
do $$
declare
  ann uuid := (select id from auth.users where email = 'wb-ann@test.invalid');
  c uuid := pg_temp.id('Wb Pointed');
  banned uuid := pg_temp.id('Wb Ladder');
  t uuid := (select thread from acts where payload ->> 'body' = 'A ladder post.');
  pt uuid := (select thread from acts where payload ->> 'body' = 'A breaking post.');
  page jsonb;
  person jsonb;
  box jsonb;
begin
  if (select warn_points from characters_public where id = c) is distinct from 6 or (select banned_until from characters_public where id = c) is not null then
    raise exception 'characters_public carries the bar and no ban for the pointed';
  end if;
  if (select banned_until from characters_public where id = banned) is distinct from banned_until(banned) or banned_until(banned) is null then
    raise exception 'characters_public carries the ban';
  end if;
  -- Every signed-in player reads them: an infraction is a public Act.
  perform tests.become(ann);
  if (select warn_points from characters_public where id = c) is distinct from 6 then raise exception 'a player reads the bar'; end if;
  page := thread_page(pt, 1, null, null, array[]::text[]);
  person := (select p from jsonb_array_elements(page -> 'people') p where p -> 'character' ->> 'id' = c::text);
  if (person -> 'character' ->> 'warn_points')::int <> 6 or jsonb_typeof(person -> 'character' -> 'banned_until') <> 'null' then raise exception 'thread_page carries them: %', person -> 'character'; end if;
  page := thread_page(t, 1, null, null, array[]::text[]);
  person := (select p from jsonb_array_elements(page -> 'people') p where p -> 'character' ->> 'id' = banned::text);
  if (person -> 'character' ->> 'banned_until')::timestamptz <> banned_until(banned) then raise exception 'thread_page carries the ban: %', person -> 'character'; end if;
  page := profile_page(banned);
  if (page -> 'character' ->> 'banned_until')::timestamptz <> banned_until(banned) or (page -> 'character' ->> 'warn_points')::int <> 0 then raise exception 'profile_page carries them: %', page -> 'character'; end if;
  perform tests.unbecome();
  -- Presence: a banned character listed in a thread's box carries its ban; the others carry null.
  perform tests.become((select owner from characters where id = banned));
  perform here('thread', t, banned);
  perform tests.unbecome();
  perform tests.become((select id from auth.users where email = 'wb-ann@test.invalid'));
  perform here('thread', t, pg_temp.id('Wb Mask Two'));
  box := presence_box('thread', t);
  perform tests.unbecome();
  person := (select n from jsonb_array_elements(box -> 'names') n where n ->> 'id' = banned::text);
  if (person ->> 'banned_until')::timestamptz is distinct from banned_until(banned) then raise exception 'presence_box tags the banned: %', box; end if;
  person := (select n from jsonb_array_elements(box -> 'names') n where n ->> 'id' = pg_temp.id('Wb Mask Two')::text);
  if person is null or jsonb_typeof(person -> 'banned_until') <> 'null' then raise exception 'presence_box tags no one else: %', box; end if;
end $$;

-- ---- The read is cheap: the bar and the ban are read by an index of the character's own infractions and bans, never a scan of Acts ----
do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'acts_infractions' and indexdef like '%payload ->> ''character''%' and indexdef like '%infraction%') then
    raise exception 'acts_infractions: the character''s infractions, indexed by the character named in the payload';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'acts_bans' and indexdef like '%payload ->> ''character''%' and indexdef like '%''ban''%') then
    raise exception 'acts_bans: the character''s bans, indexed by the character named in the payload';
  end if;
end $$;

-- ==================================================================== appeals (0107): infraction_relief ====
-- warn_points subtracts infraction_relief(infraction Act) from each infraction's points. An appeal's ruling (supabase/migrations/0107_appeals.sql) is what relieves it: an
-- overturned infraction counts none, a reduced one its remaining points, an upheld one is unchanged, and an increased one is unchanged and a second infraction stands beside it.
-- (supabase/tests/0109-appeals.sql tests the appeals themselves; this is the bar's side of them.)
do $$
declare
  u uuid := tests.account('wb-relief');
  c uuid := tests.character(u, 'Wb Relief');
  t uuid := tests.thread('Wb relief');
  p uuid := tests.post(c, t, 'A post to be filed.');
  q uuid := tests.post(c, t, 'Another post.');
  inf uuid := (infract(c, 'severe', p, 'wb-mod') ->> 'infraction')::uuid;
  inf2 uuid := (infract(c, 'minor', q, 'wb-mod') ->> 'infraction')::uuid;
  ap uuid; ap2 uuid; mod_char uuid;
begin
  if infraction_relief(inf) <> 0 or warn_points(c) <> 9 then raise exception 'no ruling, no relief: % / %', infraction_relief(inf), warn_points(c); end if;
  -- The Mod's rulings are written by a staff character; a stand-in one here, as the appeal tests have the real ones.
  perform set_config('kayfabb.appeal_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (c, 'appeal', t, inf, '{"plea": "Please."}') returning id into ap;
  insert into acts (character, kind, thread, target_act_id, payload) values (c, 'appeal', t, inf2, '{"plea": "Please."}') returning id into ap2;
  perform set_config('kayfabb.appeal_writer', '', true);
  mod_char := (select id from characters where staff is not null and staff_kind = 'persona' limit 1);
  if mod_char is null then
    -- No staff in this database yet: the relief is what the rulings say, and a ruling needs a staff character, so a minimal one is made.
    insert into characters (id, name, staff, staff_kind, debuted_at) values (gen_random_uuid(), 'Wb Ruler', 'wb-ruler', 'persona', now()) returning id into mod_char;
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (mod_char, 'appeal_ruling', t, ap, jsonb_build_object('appeal_act', ap::text, 'verdict', 'reduced', 'points_delta', -4, 'line', 'Less.'));
  perform set_config('kayfabb.staff_writer', '', true);
  if infraction_relief(inf) <> 4 or warn_points(c) <> 5 then raise exception 'a reduced infraction counts its remaining points: % / %', infraction_relief(inf), warn_points(c); end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (mod_char, 'appeal_ruling', t, ap2, jsonb_build_object('appeal_act', ap2::text, 'verdict', 'overturned', 'points_delta', -2, 'line', 'Gone.'));
  perform set_config('kayfabb.staff_writer', '', true);
  if infraction_relief(inf2) <> 2 or warn_points(c) <> 3 then raise exception 'an overturned infraction counts none: % / %', infraction_relief(inf2), warn_points(c); end if;
  -- (An upheld ruling carries points_delta 0 and an increased one adds an infraction beside the original; supabase/tests/0109-appeals.sql shows both relieve nothing.)
  if (select count(*) from acts where kind = 'infraction' and payload ->> 'character' = c::text) is distinct from 2::bigint then raise exception 'the infractions themselves were touched'; end if;
end $$;
