-- Appealing a group punishment (supabase/migrations/0123_group_appeals.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 14, as amended 2026-11-07).
--
-- 1. open_appeal accepts a landed conferGroup move whose group is a punishment, appealed only by its params->>'character', once, at appealPrice, and answers with what the
--    judgment needs (the group, the board it bars, its length, its end, who made it, who hears it). It refuses a favor, another character's move (the same words as no move),
--    a second appeal, a move that has ended or run out, and a short wallet, writing and spending nothing. The hearer is the move's staff character, Boss or Mod.
-- 2. close_appeal on a group move, as a ban's verdicts are: upheld changes nothing; reduced ends the move at its landing plus half its length (at once, if that has passed:
--    the move ends then, why expired, by appeal); increased adds half its length, never past the phase's moveExpiryMostDays from landing (the phase's number is passed in; the
--    instance's own setting is the fallback); overturned ends it at once, why overturned, says so, refunds the fee, and the move no longer counts toward staff_punishments. The
--    ruling Act carries `until`, and move_expires_at, bars_now and the tick read it; the move's own Act is never touched. A move with no end of its own cannot be shortened or
--    lengthened: it is upheld. Only who hears it now may close it.
-- 3. The appeal and the apology are independent: an apology accepted after a reduced ruling ends the move once; an apology that ended the move first leaves the appeal refunded as
--    run out; a ruling's `until` in the past is ended `expired` by the tick, once; an extended move is not ended by a tick that read the old expiry (end_move rechecks).

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

-- Run a statement as an account (null: the service role); its first column as text, or 'ERROR: ' and the refusal.
create function pg_temp.as_val(who uuid, stmt text) returns text language plpgsql as $$
declare
  r text;
begin
  if who is null then perform tests.become_service(); else perform tests.become(who); end if;
  begin
    execute stmt into r;
  exception when others then
    r := 'ERROR: ' || sqlerrm;
  end;
  perform tests.unbecome();
  return r;
end $$;

-- A group move that has landed (as an Act), created `ago` ago, as in 0117's and 0118's tests. expires_in null: a move with no end of its own.
create function pg_temp.landed(staff text, who uuid, grp text, ago interval default interval '1 day', board uuid default null, demand jsonb default null,
                               expires_in interval default interval '4 days') returns uuid language plpgsql as $$
declare
  made uuid;
  at timestamptz := clock_timestamp() - ago;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act((select id from characters c where c.staff = landed.staff), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.',
      'params', jsonb_strip_nulls(jsonb_build_object('character', who::text, 'group', grp, 'board', board::text)))
      || case when demand is not null then jsonb_build_object('demand', demand) else '{}'::jsonb end
      || case when expires_in is not null then jsonb_build_object('expires_at', at + expires_in) else '{}'::jsonb end,
    null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return made;
end $$;

create function pg_temp.apology() returns jsonb language sql as $$ select jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb) $$;

create function pg_temp.player(label text, cash integer default 500) returns uuid language plpgsql as $$
declare a uuid := tests.account('ga-' || label);
begin
  insert into wallets (account, balance) values (a, cash) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Ga ' || label);
end $$;
create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;
create function pg_temp.wallet(c uuid) returns integer language sql as $$ select coalesce((select w.balance from wallets w join characters x on x.owner = w.account where x.id = c), 0) $$;
create function pg_temp.grp(c uuid) returns text language sql as $$ select "group" from characters_public where id = c $$;
create function pg_temp.ends(m uuid) returns bigint language sql as $$ select count(*) from acts where kind = 'move_end' and target_act_id = m $$;

-- The appeal, through the real open_appeal as the player who owns the character; an assertion that it was taken.
create function pg_temp.opened(c uuid, m uuid, plea text default 'I did nothing wrong.') returns jsonb language plpgsql as $$
declare r text := pg_temp.as_val(pg_temp.owner(c), format('select open_appeal(%L, %L, %L)', c, m, plea));
begin
  if r like 'ERROR:%' then raise exception 'open_appeal refused a punishment of the character''s own: %', r; end if;
  return r::jsonb;
end $$;

-- The ruling, through the real close_appeal as the service; an assertion that it was taken. most_days null: the instance's own number.
create function pg_temp.closed(ap uuid, verdict text, most_days integer default null, staff text default null) returns jsonb language plpgsql as $$
declare r text := pg_temp.as_val(null, format('select close_appeal(%L, %L, %L, %L, %s)', ap, verdict, 'A line.', staff, coalesce(most_days::text, 'null')));
begin
  if r like 'ERROR:%' then raise exception 'close_appeal refused: %', r; end if;
  return r::jsonb;
end $$;

create function pg_temp.near(a timestamptz, b timestamptz) returns boolean language sql as $$ select abs(extract(epoch from a - b)) < 1 $$;

-- ---- 0. The world: a Boss, a Mod on staff, a ladder and two conferred groups, a board beside General ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'apology', jsonb_build_object('apologyEveryHours', 24, 'apologyJudgeBatch', 2, 'apologyRulingMaxWords', 80),
      'systemLines', jsonb_build_object('moveOverturned', jsonb_build_array('Overturned: {move}.'), 'moveExpired', jsonb_build_array('Over: {move}.')),
      'systemMoveWords', jsonb_build_object('conferGroup', 'moving a member into "{groupName}"')),
    'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment'),
      jsonb_build_object('key', 'teachersPet', 'name', 'Teacher''s Pet', 'color', '#c2408f', 'source', 'conferred', 'tone', 'favor')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ga-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ga-boss', 'name', 'Ga Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'ga-mod', 'name', 'Ga Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('ga-mod'),
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'apologyAccepted')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into boards (slug, name, description) values ('ga-games', 'Games', 'Talk about games.');
  insert into settings (key, value) values ('moveExpiryMostDays', '90') on conflict (key) do update set value = '90';
  if current_boss() is distinct from 'ga-boss' then raise exception 'the world: the Boss is %', current_boss(); end if;
  if not exists (select 1 from staff_now where staff = 'ga-mod') then raise exception 'the world: the Mod is not on staff'; end if;
end $$;

-- ---- 1. open_appeal on a group punishment ----
do $$
declare
  games uuid := pg_temp.board('ga-games');
  c uuid := pg_temp.player('one');
  mask uuid := tests.character(pg_temp.owner(c), 'Ga One Mask');
  other uuid := pg_temp.player('two');
  poor uuid := pg_temp.player('poor', 10);
  m uuid := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  m_mod uuid := pg_temp.landed('ga-mod', other, 'trialMembers', interval '1 day', null, pg_temp.apology());
  fav uuid := pg_temp.landed('ga-boss', pg_temp.player('fav'), 'teachersPet', interval '1 hour', null, pg_temp.apology(), interval '2 days');
  m_poor uuid := pg_temp.landed('ga-boss', poor, 'trialMembers', interval '1 hour');
  m_over uuid := pg_temp.landed('ga-boss', pg_temp.player('over'), 'trialMembers', interval '3 days', null, null, interval '2 days');
  m_gone uuid := pg_temp.landed('ga-boss', pg_temp.player('gone'), 'trialMembers', interval '1 hour');
  w0 integer := pg_temp.wallet(c);
  got jsonb;
  said text;
  a acts%rowtype;
  seq0 integer;
begin
  perform end_move(m_gone, 'reversed', 'test');
  seq0 := (select next_seq from threads where id = pg_temp.announcements());
  got := pg_temp.opened(c, m);
  select * into a from acts where id = (got ->> 'appeal')::uuid;
  if a.kind is distinct from 'appeal' or a.target_act_id is distinct from m or a.character is distinct from c or a.thread is distinct from pg_temp.announcements() or a.seq is not null then
    raise exception 'the appeal is a public Act of the character on the move, in its thread, taking no seq: %', to_jsonb(a);
  end if;
  if (select next_seq from threads where id = pg_temp.announcements()) is distinct from seq0 then raise exception 'the appeal took a seq'; end if;
  if pg_temp.wallet(c) is distinct from w0 - 50 then raise exception 'the appeal did not cost appealPrice: % to %', w0, pg_temp.wallet(c); end if;
  if not exists (select 1 from wallet_events where kind = 'appeal' and ref = a.id and change = -50) then raise exception 'the price is not a wallet event of kind appeal'; end if;
  if got ->> 'kind' is distinct from 'move' or got ->> 'staff' is distinct from 'ga-boss' or (got ->> 'price')::integer is distinct from 50 or got ->> 'punishment' is distinct from m::text
     or coalesce(got ->> 'post', '') <> '' then
    raise exception 'open_appeal answers with the move, its staff and the price: %', got;
  end if;
  if got #>> '{details,group}' is distinct from 'Trial Members' or got #>> '{details,bars}' is distinct from 'Games' or got #>> '{details,filed_by}' is distinct from 'ga-boss'
     or not pg_temp.near((got #>> '{details,until}')::timestamptz, move_expires_at(m)) or (got #>> '{details,days}')::numeric is distinct from 4::numeric
     or (got #>> '{details,apology}')::boolean is distinct from true or got #>> '{appellant,name}' is distinct from 'Ga one' then
    raise exception 'the details say what the move did: %', got -> 'details';
  end if;
  if got::text ~* 'owner|account' then raise exception 'the answer names an owner or an account: %', got; end if;

  -- A second appeal of the same move; another character's (the player's own other mask, another player); a favor; a move that is none: each in words that do not tell them apart.
  said := pg_temp.as_val(pg_temp.owner(c), format('select open_appeal(%L, %L, %L)', c, m, 'Again.'));
  if said not like 'ERROR: this punishment has already been appealed%' then raise exception 'a second appeal of a move was taken: %', said; end if;
  said := pg_temp.as_val(pg_temp.owner(c), format('select open_appeal(%L, %L, %L)', mask, m, 'Not mine.'));
  if said is distinct from 'ERROR: that is not a punishment of this character' then raise exception 'the player''s other mask appealed the move: %', said; end if;
  said := pg_temp.as_val(pg_temp.owner(other), format('select open_appeal(%L, %L, %L)', other, m, 'Not mine.'));
  if said is distinct from 'ERROR: that is not a punishment of this character' then raise exception 'another player appealed the move: %', said; end if;
  said := pg_temp.as_val(pg_temp.owner(c), format('select open_appeal(%L, %L, %L)', c, gen_random_uuid(), 'None.'));
  if said is distinct from 'ERROR: that is not a punishment of this character' then raise exception 'a move that is none: %', said; end if;
  said := pg_temp.as_val((select owner from characters where id = (select (payload #>> '{params,character}')::uuid from acts where id = fav)),
                         format('select open_appeal(%L, %L, %L)', (select (payload #>> '{params,character}')::uuid from acts where id = fav), fav, 'A favor.'));
  if said is distinct from 'ERROR: that is not a punishment of this character' then raise exception 'a favor was appealed: %', said; end if;
  if (select count(*) from acts where kind = 'appeal' and target_act_id in (fav, m)) is distinct from 1::bigint then raise exception 'a refused appeal wrote an Act'; end if;

  -- A move that has ended, one that has run out and not been ended yet, and a short wallet.
  said := pg_temp.as_val(pg_temp.owner((select (payload #>> '{params,character}')::uuid from acts where id = m_gone)),
                         format('select open_appeal(%L, %L, %L)', (select (payload #>> '{params,character}')::uuid from acts where id = m_gone), m_gone, 'Ended.'));
  if said is distinct from 'ERROR: that punishment has already run out' then raise exception 'an ended move was appealed: %', said; end if;
  said := pg_temp.as_val(pg_temp.owner((select (payload #>> '{params,character}')::uuid from acts where id = m_over)),
                         format('select open_appeal(%L, %L, %L)', (select (payload #>> '{params,character}')::uuid from acts where id = m_over), m_over, 'Late.'));
  if said is distinct from 'ERROR: that punishment has already run out' then raise exception 'a move past its expiry was appealed: %', said; end if;
  w0 := pg_temp.wallet(poor);
  said := pg_temp.as_val(pg_temp.owner(poor), format('select open_appeal(%L, %L, %L)', poor, m_poor, 'No money.'));
  if said not like 'ERROR:%' or pg_temp.wallet(poor) is distinct from w0 or exists (select 1 from acts where kind = 'appeal' and target_act_id = m_poor) then
    raise exception 'a short wallet appealed or was charged: % / %', said, pg_temp.wallet(poor);
  end if;

  -- The Mod that made a move hears it.
  got := pg_temp.opened(other, m_mod);
  if got ->> 'staff' is distinct from 'ga-mod' then raise exception 'a Mod''s move is heard by %', got ->> 'staff'; end if;
  -- ... and without a board the answer still names the board the judgment reads.
  if got #>> '{board,name}' is null then raise exception 'the answer names no board for a move that bars none: %', got; end if;
  if got #>> '{details,bars}' is not null then raise exception 'a move that bars nothing says it bars %', got #>> '{details,bars}'; end if;
end $$;

-- ---- 2. close_appeal: each verdict on a group punishment ----
do $$
declare
  games uuid := pg_temp.board('ga-games');
  c uuid;
  w0 integer;
  m uuid;
  ap uuid;
  got jsonb;
  r acts%rowtype;
  before_n bigint;
  landed_at timestamptz;
  expires timestamptz;
begin
  -- upheld: nothing changes.
  c := pg_temp.player('up'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  expires := move_expires_at(m);
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid; w0 := pg_temp.wallet(c);
  got := pg_temp.closed(ap, 'upheld', 30);
  select * into r from acts where kind = 'appeal_ruling' and target_act_id = ap;
  if r.id is null or r.character is distinct from (select id from characters where staff = 'ga-boss') or r.payload ->> 'verdict' is distinct from 'upheld' or r.payload ? 'until'
     or (r.payload ->> 'points_delta')::integer is distinct from 0 or r.thread is distinct from pg_temp.announcements() then
    raise exception 'an upheld ruling is the Boss''s public Act with no new end: %', to_jsonb(r);
  end if;
  if move_expires_at(m) is distinct from expires or pg_temp.ends(m) <> 0 or pg_temp.wallet(c) is distinct from w0 then raise exception 'upheld changed the move or refunded'; end if;
  if (select ru.id from acts ru where ru.kind = 'appeal_ruling' and ru.target_act_id = ap) is distinct from r.id or (pg_temp.closed(ap, 'overturned', 30) ->> 'existing') is distinct from 'true' then
    raise exception 'a second close ruled again';
  end if;
  perform system_tick();
  if pg_temp.grp(c) is distinct from 'trialMembers' then raise exception 'upheld: the group after the tick is %', pg_temp.grp(c); end if;

  -- reduced: ends at landing + half its length.
  c := pg_temp.player('red'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  landed_at := (select created_at from acts where id = m); expires := move_expires_at(m);
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  got := pg_temp.closed(ap, 'reduced', 30);
  select * into r from acts where kind = 'appeal_ruling' and target_act_id = ap;
  if r.payload ->> 'verdict' is distinct from 'reduced' or not pg_temp.near((r.payload ->> 'until')::timestamptz, landed_at + (expires - landed_at) / 2) then
    raise exception 'a reduced ruling names landing + half its length (%): %', landed_at + (expires - landed_at) / 2, r.payload;
  end if;
  if not pg_temp.near(move_expires_at(m), landed_at + (expires - landed_at) / 2) then raise exception 'move_expires_at does not read the reduced ruling: % for %', move_expires_at(m), expires; end if;
  if (select (a.payload ->> 'expires_at')::timestamptz from acts a where a.id = m) is distinct from expires then raise exception 'the move''s own Act was written over'; end if;
  if not pg_temp.near((select b.expires_at from bars_now b where b.move_act = m), landed_at + (expires - landed_at) / 2) then raise exception 'bars_now does not read the ruling'; end if;
  if pg_temp.ends(m) <> 0 then raise exception 'a reduced move with half its length to go ended at once'; end if;
  perform system_tick();
  if pg_temp.grp(c) is distinct from 'trialMembers' then raise exception 'reduced, still running: the group after the tick is %', pg_temp.grp(c); end if;

  -- reduced, with half its length already past: it ends at once, expired, by the appeal, said once.
  c := pg_temp.player('redonce'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '3 days', games, pg_temp.apology());
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  before_n := (select count(*) from acts where kind = 'post' and payload ->> 'body' = 'Over: moving a member into "Trial Members".');
  perform pg_temp.closed(ap, 'reduced', 30);
  if (select payload ->> 'why' || '/' || (payload ->> 'by') from acts where kind = 'move_end' and target_act_id = m) is distinct from 'expired/appeal' then
    raise exception 'a reduced ruling past half the length ended as %', (select payload from acts where kind = 'move_end' and target_act_id = m);
  end if;
  if exists (select 1 from open_moves where move_act = m) or pg_temp.grp(c) is distinct from 'members' then raise exception 'reduced at once: the move is still in force (group %)', pg_temp.grp(c); end if;
  if exists (select 1 from bars_now where move_act = m) then raise exception 'reduced at once: the bar is still up'; end if;
  perform system_tick(); perform system_tick();
  if pg_temp.ends(m) is distinct from 1::bigint then raise exception 'the tick ended a move the ruling had ended: % ends', pg_temp.ends(m); end if;
  if (select count(*) from acts where kind = 'post' and payload ->> 'body' = 'Over: moving a member into "Trial Members".') is distinct from before_n + 1 then raise exception 'the end was not said exactly once'; end if;

  -- increased: half its length more, within the phase's most days from landing.
  c := pg_temp.player('inc'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  landed_at := (select created_at from acts where id = m); expires := move_expires_at(m);
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  perform pg_temp.closed(ap, 'increased', 10);
  if not pg_temp.near(move_expires_at(m), expires + (expires - landed_at) / 2) then raise exception 'increased adds half its length: % for % to %', move_expires_at(m), landed_at, expires; end if;
  if not pg_temp.near((select (payload ->> 'until')::timestamptz from acts where kind = 'appeal_ruling' and target_act_id = ap), move_expires_at(m)) then raise exception 'the ruling does not carry the new end'; end if;
  perform system_tick();
  if pg_temp.grp(c) is distinct from 'trialMembers' then raise exception 'increased: the group after the tick is %', pg_temp.grp(c); end if;

  -- increased, clamped by the phase: 4 days long, 5 days at most from landing: one day more, not two. At the most already: no more.
  c := pg_temp.player('clamp'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  landed_at := (select created_at from acts where id = m);
  perform pg_temp.closed((pg_temp.opened(c, m) ->> 'appeal')::uuid, 'increased', 5);
  if not pg_temp.near(move_expires_at(m), landed_at + interval '5 days') then raise exception 'increased went past the phase''s most days: % from %', move_expires_at(m), landed_at; end if;
  c := pg_temp.player('clamp2'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  expires := move_expires_at(m);
  perform pg_temp.closed((pg_temp.opened(c, m) ->> 'appeal')::uuid, 'increased', 3);
  if not pg_temp.near(move_expires_at(m), expires) then raise exception 'increased lengthened a move already past the phase''s most days: % for %', move_expires_at(m), expires; end if;
  -- ... the instance's own most days where the call names none.
  insert into settings (key, value) values ('moveExpiryMostDays', '5') on conflict (key) do update set value = '5';
  c := pg_temp.player('clamp3'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  landed_at := (select created_at from acts where id = m);
  perform pg_temp.closed((pg_temp.opened(c, m) ->> 'appeal')::uuid, 'increased', null);
  if not pg_temp.near(move_expires_at(m), landed_at + interval '5 days') then raise exception 'with no phase number, the instance''s most days did not clamp: %', move_expires_at(m); end if;

  -- overturned: ends at once, says so, refunds, and no longer counts toward the cap.
  c := pg_temp.player('turned'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  w0 := pg_temp.wallet(c);
  if staff_punishments(c, 7) is distinct from 1 then raise exception 'the punishment is not counted before the appeal: %', staff_punishments(c, 7); end if;
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  if pg_temp.wallet(c) is distinct from w0 - 50 then raise exception 'the fee was not taken'; end if;
  got := pg_temp.closed(ap, 'overturned', 30);
  if (select payload ->> 'why' || '/' || (payload ->> 'by') from acts where kind = 'move_end' and target_act_id = m) is distinct from 'overturned/appeal' then
    raise exception 'an overturned move ended as %', (select payload from acts where kind = 'move_end' and target_act_id = m);
  end if;
  if exists (select 1 from open_moves where move_act = m) or pg_temp.grp(c) is distinct from 'members' or exists (select 1 from bars_now where move_act = m) then raise exception 'overturned: still in force'; end if;
  if pg_temp.wallet(c) is distinct from w0 or (got ->> 'refunded_amount')::integer is distinct from 50 or (select why from appeal_refunds where appeal_act = ap) is distinct from 'overturned' then
    raise exception 'overturned did not refund the fee: % -> %, %', w0, pg_temp.wallet(c), got;
  end if;
  if staff_punishments(c, 7) is distinct from 0 then raise exception 'a group punishment overturned on appeal is counted: %', staff_punishments(c, 7); end if;
  if not exists (select 1 from acts where kind = 'post' and thread = pg_temp.announcements() and payload ->> 'body' = 'Overturned: moving a member into "Trial Members".') then
    raise exception 'the overturning was not said: %', (select jsonb_agg(payload ->> 'body') from acts where kind = 'post' and thread = pg_temp.announcements());
  end if;
  perform system_tick();
  if pg_temp.ends(m) is distinct from 1::bigint then raise exception 'the tick ended an overturned move again'; end if;

  -- A move with no end of its own: reduced and increased have nothing to measure, so they are upheld.
  c := pg_temp.player('open'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology(), null);
  got := pg_temp.closed((pg_temp.opened(c, m) ->> 'appeal')::uuid, 'reduced', 30);
  select * into r from acts where kind = 'appeal_ruling' and target_act_id = (select a.id from acts a where a.kind = 'appeal' and a.target_act_id = m);
  if r.payload ->> 'verdict' is distinct from 'upheld' or r.payload ? 'until' or got ->> 'verdict' is distinct from 'upheld' or move_expires_at(m) is not null or not exists (select 1 from open_moves where move_act = m) then
    raise exception 'a reduced ruling on a move with no end was not upheld: %', r.payload;
  end if;

  -- Only who hears it now closes it: the Mod's move is not the Boss's to close.
  c := pg_temp.player('modded'); m := pg_temp.landed('ga-mod', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  if pg_temp.as_val(null, format('select close_appeal(%L, %L, %L, %L)', ap, 'upheld', 'x', 'ga-boss')) is distinct from 'ERROR: this appeal is heard by someone else now' then raise exception 'the Boss closed the Mod''s appeal'; end if;
  got := pg_temp.closed(ap, 'increased', 30, 'ga-mod');
  if (select ru.character from acts ru where ru.kind = 'appeal_ruling' and ru.target_act_id = ap) is distinct from (select id from characters where staff = 'ga-mod') then raise exception 'the Mod did not write its own ruling'; end if;
end $$;

-- ---- 3. The appeal and the apology; the tick; the race ----
do $$
declare
  games uuid := pg_temp.board('ga-games');
  c uuid;
  m uuid;
  ap uuid;
  apo bigint;
  said text;
  eap uuid;
  t_ap uuid;
begin
  -- An apology accepted after a reduced ruling ends the move once, met.
  c := pg_temp.player('sorry'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  perform pg_temp.closed(ap, 'reduced', 30);
  said := pg_temp.as_val(pg_temp.owner(c), format('select apologize(%L, %L, %L, %L)', m, c, 'Sorry', 'I am sorry, truly.'));
  if said like 'ERROR:%' then raise exception 'an apology to a reduced move was refused: %', said; end if;
  apo := (select id from apologies where move_act = m and state = 'pending');
  said := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', apo, 'accepted', 'Accepted.'));
  if said like 'ERROR:%' then raise exception 'the apology was not ruled: %', said; end if;
  perform system_tick(); perform system_tick();
  if pg_temp.ends(m) is distinct from 1::bigint or (select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = m) is distinct from 'met' then
    raise exception 'the apology after a reduced ruling did not end the move once, met: % ends', pg_temp.ends(m);
  end if;
  if pg_temp.grp(c) is distinct from 'members' then raise exception 'the apologized character is in %', pg_temp.grp(c); end if;

  -- The apology ended the move while an appeal waited: the ruling finds it over, refunds the fee, writes no ruling, and the move is ended once.
  c := pg_temp.player('first'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  perform end_move(m, 'met', 'check');
  said := pg_temp.as_val(null, format('select close_appeal(%L, %L, %L, %L, %s)', ap, 'overturned', 'x', null, '30'));
  if said like 'ERROR:%' or (said::jsonb ->> 'expired') is distinct from 'true' or (said::jsonb ->> 'closed') is distinct from 'false' then raise exception 'a ruling on a move already ended: %', said; end if;
  if exists (select 1 from acts where kind = 'appeal_ruling' and target_act_id = ap) or pg_temp.wallet(c) is distinct from 500 or pg_temp.ends(m) is distinct from 1::bigint then
    raise exception 'the second ending was not a no-op: wallet %, % ends', pg_temp.wallet(c), pg_temp.ends(m);
  end if;

  -- The tick ended the move (its expiry came) while an appeal waited: the same.
  c := pg_temp.player('tickfirst'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  ap := (pg_temp.opened(c, m) ->> 'appeal')::uuid;
  perform end_move(m, 'expired', 'expiry');
  said := pg_temp.as_val(null, format('select close_appeal(%L, %L, %L, %L, %s)', ap, 'reduced', 'x', null, '30'));
  if (said::jsonb ->> 'expired') is distinct from 'true' or pg_temp.ends(m) is distinct from 1::bigint or pg_temp.wallet(c) is distinct from 500 then raise exception 'a ruling after the tick ended the move: %', said; end if;

  -- A ruling's `until` in the past: the tick reads it, and ends the move expired, once. (The ruling is written as close_appeal would have, some time ago.)
  c := pg_temp.player('later'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '1 day', games, pg_temp.apology());
  perform set_config('kayfabb.appeal_writer', 'on', true);
  t_ap := tests.act(c, 'appeal', pg_temp.announcements(), jsonb_build_object('plea', 'Long ago.'), m);
  perform set_config('kayfabb.appeal_writer', '', true);
  perform write_staff_act('ga-boss', 'appeal_ruling', pg_temp.announcements(), t_ap,
    jsonb_build_object('appeal_act', t_ap, 'verdict', 'reduced', 'points_delta', 0, 'line', 'Cut.', 'until', clock_timestamp() - interval '1 hour'));
  if move_expires_at(m) >= now() then raise exception 'move_expires_at did not read the ruling''s past end'; end if;
  perform system_tick(); perform system_tick();
  if pg_temp.ends(m) is distinct from 1::bigint or (select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = m) is distinct from 'expired' or pg_temp.grp(c) is distinct from 'members' then
    raise exception 'the tick did not end the move a ruling had cut short, once: % ends, group %', pg_temp.ends(m), pg_temp.grp(c);
  end if;

  -- A move past its own expiry that a ruling extended is not ended by a tick that read the old expiry: end_move rechecks, and still ends it for any other reason.
  c := pg_temp.player('extended'); m := pg_temp.landed('ga-boss', c, 'trialMembers', interval '3 days', games, pg_temp.apology(), interval '2 days');
  perform set_config('kayfabb.appeal_writer', 'on', true);
  eap := tests.act(c, 'appeal', pg_temp.announcements(), jsonb_build_object('plea', 'Longer.'), m);
  perform set_config('kayfabb.appeal_writer', '', true);
  perform write_staff_act('ga-boss', 'appeal_ruling', pg_temp.announcements(), eap,
    jsonb_build_object('appeal_act', eap, 'verdict', 'increased', 'points_delta', 0, 'line', 'More.', 'until', clock_timestamp() + interval '1 day'));
  perform system_tick();
  if not exists (select 1 from open_moves where move_act = m) then raise exception 'the tick ended a move a ruling had extended'; end if;
  if (end_move(m, 'expired', 'expiry') ->> 'ended')::boolean then raise exception 'end_move ended an extended move as expired'; end if;
  if (end_move(m, 'reversed', 'admin') ->> 'ended')::boolean is not true then raise exception 'an admin''s reversal of an extended move was refused'; end if;
end $$;
