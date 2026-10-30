-- What the screens read of a player's own state (supabase/migrations/0030_screens_reads.sql): five
-- views, so the web never reads the characters, class_history, wallets, ledger, wallet_events or
-- pending_turns tables. The four my_* views are the caller's rows and nobody else's, and show
-- nothing a table's column grant hides (no class_history id, no pending Turn's asked_at, no name
-- folds); screen_settings is the public numbers a signed-out page needs, and no others. The
-- screens' web plan, Task 2.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- my_characters: only the caller's, with the class now, the Turn waiting, and when it may Turn ----
do $$
declare
  ann uuid := tests.account('sr-ann');
  bob uuid := tests.account('sr-bob');
  turned uuid := tests.character(ann, 'Sr Turned', 'alpha', now() - interval '60 days');
  fresh uuid := tests.character(ann, 'Sr Fresh', 'alpha', now() - interval '60 days');
  waiting uuid;
  gone uuid := tests.character(ann, 'Sr Gone', 'beta', now() - interval '60 days');
  other uuid := tests.character(bob, 'Sr Bobs', 'beta', now() - interval '60 days');
  applied timestamptz := date_trunc('second', now() - interval '10 days');
  retired timestamptz := date_trunc('second', now() - interval '2 days');
  last_end timestamptz := (select max(ends_at) from settlements);
  r record;
  why text;
  asked jsonb;
begin
  -- A Turn applied ten days ago: beta now, since then, and the cooldown (30 days) runs on.
  insert into class_history (character, class_key, started_at) values (turned, 'beta', applied);
  -- A character waiting to debut, and one an admin retired.
  insert into characters (owner, name, created_at) values (ann, 'Sr Waiting', now() - interval '1 day') returning id into waiting;
  insert into class_history (character, class_key, started_at) values (waiting, 'alpha', now() - interval '1 day');
  update characters set retired_at = retired where id = gone;
  -- Settled up to an hour ago, so a Turn asked now has a window to take effect at.
  if last_end is null or last_end < now() - interval '1 hour' then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(coalesce(last_end, (select min(starts_at) from seasons)), now() - interval '1 hour', '[]');
    perform tests.unbecome();
  end if;

  perform tests.become(ann);
  if (select count(*) from my_characters) is distinct from 4::bigint then raise exception 'Ann reads her four characters, got %', (select count(*) from my_characters); end if;
  if exists (select 1 from my_characters where id = other or name = 'Sr Bobs') then raise exception 'Ann read a character of Bob''s'; end if;

  -- The class now, since when.
  select * into r from my_characters where id = turned;
  if r.class is distinct from 'beta' or r.class_since is distinct from applied then raise exception 'the class after a Turn took effect: % since %', r.class, r.class_since; end if;
  select * into r from my_characters where id = fresh;
  if r.class is distinct from 'alpha' or r.class_since is distinct from (select created_at from characters where id = fresh) then raise exception 'a first class is since its creation'; end if;

  -- When it may Turn: after the cooldown from the Turn that took effect, as turn() says in its refusal.
  select * into r from my_characters where id = turned;
  if r.turn_opens_at is distinct from applied + interval '30 days' then raise exception 'the cooldown runs from the last Turn: %', r.turn_opens_at; end if;
  why := pg_temp.refusal(format('select turn(%L, ''alpha'', ''silent'')', turned));
  if why is distinct from 'this character can Turn again at ' || to_char(r.turn_opens_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') then
    raise exception 'turn_opens_at disagrees with turn()''s refusal: % and %', r.turn_opens_at, why;
  end if;
  -- A character that never Turned may Turn now, and an expired cooldown is no date either.
  if (select turn_opens_at from my_characters where id = fresh) is not null then raise exception 'a character that never Turned may Turn now'; end if;
  perform tests.unbecome();
  update class_history set started_at = now() - interval '40 days' where character = turned and class_key = 'beta';
  insert into class_history (character, class_key, started_at) values (turned, 'alpha', now() - interval '31 days') on conflict do nothing;
  perform tests.become(ann);
  if (select turn_opens_at from my_characters where id = turned) is not null then raise exception 'a cooldown that has passed names no date'; end if;

  -- Waiting and retired, and nothing pending yet.
  select * into r from my_characters where id = waiting;
  if r.debuted_at is not null or r.debut_loudness is distinct from 'announced' or r.retired_at is not null then raise exception 'a waiting character has not debuted: %', to_jsonb(r); end if;
  select * into r from my_characters where id = gone;
  if r.retired_at is distinct from retired or r.debuted_at is null then raise exception 'a retired character shows when: %', to_jsonb(r); end if;
  if exists (select 1 from my_characters where pending_class is not null or pending_loudness is not null or pending_show_from is not null
                                              or pending_show_to is not null or takes_effect_at is not null) then
    raise exception 'no Turn is pending, yet a pending column says so';
  end if;

  -- A Turn waiting: its columns, and when it takes effect, the settlement turn() promised.
  asked := turn(fresh, 'beta', 'announced', true, false);
  select * into r from my_characters where id = fresh;
  if (r.pending_class, r.pending_loudness, r.pending_show_from, r.pending_show_to) is distinct from ('beta', 'announced', true, false) then
    raise exception 'a pending Turn''s columns: %', to_jsonb(r);
  end if;
  if r.takes_effect_at is null or r.takes_effect_at is distinct from (asked ->> 'takes_effect_at')::timestamptz then raise exception 'takes_effect_at is what turn() promised: % and %', r.takes_effect_at, asked; end if;
  if r.class is distinct from 'alpha' then raise exception 'a waiting Turn has not changed the class'; end if;
  if exists (select 1 from my_characters where id <> fresh and (pending_class is not null or takes_effect_at is not null)) then raise exception 'a Turn waiting shows on another character'; end if;
  perform tests.unbecome();

  -- Bob sees his own, and nothing of Ann's.
  perform tests.become(bob);
  if (select array_agg(name) from my_characters) is distinct from array['Sr Bobs'] then raise exception 'Bob reads only his own character'; end if;
  if exists (select 1 from my_characters where pending_class is not null) then raise exception 'Bob read a Turn of Ann''s'; end if;
  perform tests.unbecome();

  -- The columns are exactly these: nothing the tables withhold.
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_characters')
     is distinct from array['id', 'name', 'class', 'class_since', 'turn_opens_at', 'debuted_at', 'debut_loudness', 'retired_at', 'pending_class', 'pending_loudness',
                            'pending_show_from', 'pending_show_to', 'takes_effect_at'] then
    raise exception 'my_characters shows more or less than it should';
  end if;
end $$;

-- ---- my_wallet, my_ledger, my_wallet_events: the caller's, and only the caller's ----
do $$
declare
  ann uuid := tests.account('sw-ann');
  bob uuid := tests.account('sw-bob');
  cat uuid := tests.account('sw-cat');
  a uuid := tests.character(ann, 'Sw Ann');
  b uuid := tests.character(bob, 'Sw Bob');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  r record;
begin
  perform apply_settlement(w1, w2, jsonb_build_array(
    jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 150),
    jsonb_build_object('player', bob, 'character', b, 'reason', 'alpha.groaned', 'amount', 40)));

  perform tests.become(ann);
  if (select count(*) from my_wallet) is distinct from 1::bigint then raise exception 'one wallet row'; end if;
  if (select (balance, cap) from my_wallet) is distinct from (150, 600) then raise exception 'Ann''s balance and the cap: %', (select to_jsonb(my_wallet) from my_wallet); end if;
  select * into r from my_ledger;
  if (select count(*) from my_ledger) is distinct from 1::bigint or r.character is distinct from a or r.reason is distinct from 'alpha.cheered' or r.amount is distinct from 150
     or r.starts_at is distinct from w1 or r.ends_at is distinct from w2 or r.settlement is distinct from (select id from settlements where starts_at = w1) then
    raise exception 'Ann''s ledger is her one line with its window: %', to_jsonb(r);
  end if;
  select * into r from my_wallet_events;
  if (select count(*) from my_wallet_events) is distinct from 1::bigint or (r.kind, r.change, r.overflow, r.floored, r.balance_after) is distinct from ('settlement', 150, 0, 0, 150)
     or r.settlement is distinct from (select id from settlements where starts_at = w1) or r.at is null then
    raise exception 'Ann''s wallet event: %', to_jsonb(r);
  end if;
  perform tests.unbecome();

  perform tests.become(bob);
  if (select balance from my_wallet) is distinct from 40 then raise exception 'Bob reads his own balance'; end if;
  if exists (select 1 from my_ledger where character = a) or exists (select 1 from my_wallet_events where change = 150) then raise exception 'Bob read a line of Ann''s'; end if;
  perform tests.unbecome();

  -- No wallets row yet: nothing earned or spent, so 0 of the cap, still one row.
  perform tests.become(cat);
  if (select (balance, cap) from my_wallet) is distinct from (0, 600) then raise exception 'a player with no wallet row has 0'; end if;
  if exists (select 1 from my_ledger) or exists (select 1 from my_wallet_events) then raise exception 'a player with no history read someone''s'; end if;
  perform tests.unbecome();

  -- The columns are exactly these.
  if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_wallet') is distinct from array['balance', 'cap']
     or (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_ledger')
        is distinct from array['settlement', 'starts_at', 'ends_at', 'character', 'reason', 'amount']
     or (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'my_wallet_events')
        is distinct from array['settlement', 'kind', 'change', 'overflow', 'floored', 'balance_after', 'ref', 'at'] then
    raise exception 'a wallet view shows more or less than it should';
  end if;
end $$;

-- ---- screen_settings: public numbers, readable signed out, and no others ----
do $$
declare
  seen jsonb;
  listed text[] := array['postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime', 'turnCooldown',
                         'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength'];
  k text;
begin
  perform tests.become_anon();
  seen := (select settings from screen_settings);
  perform tests.unbecome();
  if (select count(*) from screen_settings) is distinct from 1::bigint then raise exception 'one row of settings'; end if;
  if seen is null or (select array_agg(key order by key) from jsonb_object_keys(seen) key) is distinct from (select array_agg(x order by x) from unnest(listed) x) then
    raise exception 'screen_settings holds exactly the listed keys: %', seen;
  end if;
  if seen ? 'economy' or seen ? 'settlementCron' or seen ? 'copy' or seen ? 'viewCountCron' or seen ? 'vote' then raise exception 'a setting that is not for the screens: %', seen; end if;
  if seen -> 'postsPerPage' is distinct from '20'::jsonb or seen -> 'registrationMode' is distinct from '"invite"'::jsonb or seen -> 'turnCooldown' is distinct from '{"unit": "day", "count": 30}'::jsonb then
    raise exception 'values are the settings'' own: %', seen;
  end if;
  -- Signed in, the same.
  perform tests.become(tests.account('ss-ann'));
  if (select settings from screen_settings) is distinct from seen then raise exception 'a signed-in player reads the same settings'; end if;
  perform tests.unbecome();
  -- A key the instance does not hold is absent, not null.
  delete from settings where key = 'hotReplies';
  if (select settings from screen_settings) ? 'hotReplies' then raise exception 'an unset key is absent'; end if;
end $$;

-- ---- A signed-out visitor reads no player's view ----
do $$
declare v text;
begin
  perform tests.become_anon();
  foreach v in array array['my_characters', 'my_wallet', 'my_ledger', 'my_wallet_events'] loop
    if pg_temp.refusal(format('select * from %I', v)) is distinct from format('permission denied for view %s', v) then
      raise exception '% was readable signed out: %', v, pg_temp.refusal(format('select * from %I', v));
    end if;
  end loop;
  perform tests.unbecome();
end $$;

-- ---- A character's public month: the first day of the month it debuted, never a time ----
do $$
declare
  ann uuid := tests.account('jm-ann');
  early uuid := tests.character(ann, 'Jm Early', 'alpha', timestamptz '2026-10-03 04:05:06.789+00');
  late uuid := tests.character(ann, 'Jm Late', 'alpha', timestamptz '2026-10-31 23:59:59+00');
  nextmonth uuid := tests.character(ann, 'Jm Next', 'alpha', timestamptz '2026-11-01 00:00:01+00');
  waiting uuid;
begin
  -- Two characters made a minute apart, in one month, show the same value: it says who owns neither.
  if (select joined from characters_public where id = early) is distinct from date '2026-10-01' then
    raise exception 'joined is the first of the month: %', (select joined from characters_public where id = early);
  end if;
  if (select joined from characters_public where id = late) is distinct from date '2026-10-01' then raise exception 'the last day of a month is that month'; end if;
  if (select joined from characters_public where id = nextmonth) is distinct from date '2026-11-01' then raise exception 'the next month is the next month'; end if;
  if (select data_type from information_schema.columns where table_name = 'characters_public' and column_name = 'joined') is distinct from 'date' then
    raise exception 'joined is a date, never a time';
  end if;
  -- A waiting character is in no list, so it has no month either.
  insert into characters (owner, name) values (ann, 'Jm Waiting') returning id into waiting;
  if exists (select 1 from characters_public where id = waiting) then raise exception 'a waiting character is public'; end if;
  -- A player reads it.
  perform tests.become(tests.account('jm-bob'));
  if (select joined from characters_public where id = early) is distinct from date '2026-10-01' then raise exception 'a player reads the month'; end if;
  perform tests.unbecome();
end $$;
