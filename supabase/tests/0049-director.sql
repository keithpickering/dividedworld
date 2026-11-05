-- The Director's records (supabase/migrations/0044_director.sql; the system plan, Task 6): no client reads meetings,
-- staff_memory or move_bank; staff_profile_now is public and shows the latest version; the three append-only tables
-- refuse an edit; bank_now accrues and caps without writing; model_calls.meeting now names a real meeting.

do $$
declare
  who text;
  t text;
  denied boolean;
  m1 bigint;
  m2 bigint;
  bank numeric;
  seen text;
  fav uuid;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Dir Boss', 'dir-boss', 'persona', now()), ('Dir Other', 'dir-other', 'persona', now());
  insert into meetings (started_at, slot, finished_at, outcome, bank_before, bank_after) values (now() - interval '2 minutes', now() - interval '2 minutes', now() - interval '1 minute', 'ok', 2, 1) returning id into m1;
  insert into meetings (started_at, slot, finished_at, outcome, error, consecutive_failures) values (now() - interval '1 minute', now() - interval '1 minute', now(), 'failed', 'upstream 500', 1) returning id into m2;
  insert into staff_memory (staff, meeting, body) values ('dir-boss', m1, '{"opinions": []}');
  insert into move_bank (staff, balance, as_of) values ('dir-boss', 1, now());
  fav := (select id from characters where staff = 'dir-boss');
  insert into staff_profiles (staff, meeting, at, interests, favorites, mood, signature) values ('dir-boss', m1, now() - interval '1 minute', array['wrestling'], array[fav], 'smug', 'first');
  insert into staff_profiles (staff, meeting, at, interests, favorites, mood, signature) values ('dir-boss', m2, now(), array['wrestling', 'pie'], '{}', 'furious', 'second');
  insert into staff_profiles (staff, meeting, at, signature) values ('dir-other', m1, now(), 'other boss');

  -- One version per staff member per meeting.
  denied := false;
  begin insert into staff_memory (staff, meeting, body) values ('dir-boss', m1, '{}'); exception when unique_violation then denied := true; end;
  if not denied then raise exception 'staff_memory takes a second version for one staff member and meeting'; end if;
  denied := false;
  begin insert into staff_profiles (staff, meeting) values ('dir-boss', m1); exception when unique_violation then denied := true; end;
  if not denied then raise exception 'staff_profiles takes a second version for one staff member and meeting'; end if;

  -- No client reads or writes the three tables or the bank.
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    foreach t in array array['staff_memory', 'meetings', 'move_bank', 'staff_profiles'] loop
      denied := false;
      begin execute format('select count(*) from %I', t); exception when insufficient_privilege then denied := true; end;
      if not denied then raise exception '% can read %', who, t; end if;
      denied := false;
      begin execute format('delete from %I', t); exception when insufficient_privilege then denied := true; end;
      if not denied then raise exception '% can write %', who, t; end if;
    end loop;
    denied := false;
    begin perform bank_now('dir-boss', 5, 10); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can call bank_now', who; end if;
    perform tests.unbecome();
  end loop;
  foreach t in array array['staff_memory', 'meetings', 'move_bank', 'staff_profiles'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '% has no row-level security', t; end if;
  end loop;

  -- staff_profile_now: readable by anon and by a signed-in player, the latest version of each staff member, and only that.
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    select string_agg(staff || ':' || signature || ':' || mood, ',' order by staff) into seen from staff_profile_now;
    if seen is distinct from 'dir-boss:second:furious,dir-other:other boss:' then raise exception '% saw %', who, seen; end if;
    perform tests.unbecome();
  end loop;
  if (select interests from staff_profile_now where staff = 'dir-boss') is distinct from array['wrestling', 'pie'] then raise exception 'the view does not carry the latest interests'; end if;

  -- Append-only: no edit, no removal, no truncate, even as the table's owner.
  foreach t in array array['staff_memory', 'staff_profiles'] loop
    denied := false;
    begin execute format('update %I set at = at', t); exception when sqlstate 'P0001' then denied := true; end;
    if not denied then raise exception '% can be updated', t; end if;
    denied := false;
    begin execute format('delete from %I', t); exception when sqlstate 'P0001' then denied := true; end;
    if not denied then raise exception '% can be deleted from', t; end if;
    denied := false;
    begin execute format('truncate %I cascade', t); exception when sqlstate 'P0001' then denied := true; end;
    if not denied then raise exception '% can be truncated', t; end if;
  end loop;
  denied := false;
  begin update meetings set error = 'edited'; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'meetings can be updated'; end if;
  denied := false;
  begin delete from meetings; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'meetings can be deleted from'; end if;
  denied := false;
  begin truncate meetings cascade; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'meetings can be truncated'; end if;
  denied := false;
  begin insert into meetings (started_at, slot, finished_at, outcome) values (now(), now(), now(), 'maybe'); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a meeting outcome outside the four is accepted'; end if;

  -- The bank is a counter: it is updated in place.
  update move_bank set balance = 1 where staff = 'dir-boss';

  -- bank_now: no row is zero; the balance accrues weekly_moves over exactly a week; it caps; it writes nothing.
  if bank_now('dir-other', 5, 10) is distinct from 0::numeric then raise exception 'a Boss with no bank row starts at zero'; end if;
  update move_bank set balance = 1, as_of = now() - interval '7 days' where staff = 'dir-boss';
  bank := bank_now('dir-boss', 5, 10);
  if bank is distinct from 6::numeric then raise exception 'a week at 5 a week from 1 is 6, not %', bank; end if;
  bank := bank_now('dir-boss', 5, 4);
  if bank is distinct from 4::numeric then raise exception 'a bank caps at its cap, not %', bank; end if;
  update move_bank set balance = 1, as_of = now() - interval '5 years' where staff = 'dir-boss';
  bank := bank_now('dir-boss', 5, 10);
  if bank is distinct from 10::numeric then raise exception 'a long idle stretch caps at bank_cap, not %', bank; end if;
  update move_bank set balance = 3, as_of = now() + interval '1 day' where staff = 'dir-boss';
  if bank_now('dir-boss', 5, 10) is distinct from 3::numeric then raise exception 'a bank does not accrue backwards'; end if;
  if (select balance from move_bank where staff = 'dir-boss') is distinct from 3::numeric then raise exception 'bank_now wrote the bank'; end if;

  -- A null argument is a null bank, not a full or an uncapped one; a negative rate never goes below zero.
  if bank_now('dir-boss', null, 10) is not null then raise exception 'a null weekly_moves returned a bank'; end if;
  if bank_now('dir-boss', 5, null) is not null then raise exception 'a null bank_cap returned a bank'; end if;
  if bank_now('dir-boss', 5, 10) is null then raise exception 'bank_now with all arguments returned null'; end if;
  update move_bank set balance = 1, as_of = now() - interval '7 days' where staff = 'dir-boss';
  bank := bank_now('dir-boss', -5, 10);
  if bank is distinct from 0::numeric then raise exception 'a negative weekly_moves went below zero: %', bank; end if;

  -- The append-only tables refuse an edit even in replica mode, as a restore with triggers disabled runs.
  perform set_config('session_replication_role', 'replica', true);
  foreach t in array array['meetings', 'staff_memory', 'staff_profiles'] loop
    denied := false;
    begin execute format('update %I set %I = %I', t, case t when 'meetings' then 'started_at' else 'staff' end, case t when 'meetings' then 'started_at' else 'staff' end); exception when raise_exception then denied := true; end;
    if not denied then perform set_config('session_replication_role', 'origin', true); raise exception '% was updated in replica mode', t; end if;
    denied := false;
    begin execute format('delete from %I', t); exception when raise_exception then denied := true; end;
    if not denied then perform set_config('session_replication_role', 'origin', true); raise exception '% was deleted from in replica mode', t; end if;
    denied := false;
    begin execute format('truncate %s', case t when 'meetings' then 'meetings, model_calls, staff_memory, staff_profiles, queued_moves' else t end); exception when raise_exception then denied := true; end;
    if not denied then perform set_config('session_replication_role', 'origin', true); raise exception '% was truncated in replica mode', t; end if;
  end loop;
  perform set_config('session_replication_role', 'origin', true);
  -- Meetings are referenced by other tables, so its truncate cannot be tried alone; its triggers are checked as well.
  if (select count(*) from pg_trigger where tgname in ('meetings_no_update', 'meetings_no_truncate', 'staff_memory_no_update',
    'staff_memory_no_truncate', 'staff_profiles_no_update', 'staff_profiles_no_truncate') and tgenabled = 'A') is distinct from 6 then
    raise exception 'an append-only trigger is not enabled always';
  end if;

  -- model_calls.meeting names a real meeting.
  perform record_model_call(jsonb_build_object('duty', 'meeting', 'staff', 'dir-boss', 'provider', 'anthropic', 'model', 'claude-opus-5-5',
    'cost_microdollars', 1, 'outcome', 'failed', 'meeting', m2));
  if (select count(*) from model_calls where meeting = m2) is distinct from 1 then raise exception 'a call does not keep its meeting'; end if;
  denied := false;
  begin perform record_model_call(jsonb_build_object('duty', 'meeting', 'provider', 'anthropic', 'model', 'claude-opus-5-5',
    'cost_microdollars', 1, 'outcome', 'failed', 'meeting', m2 + 1000)); exception when foreign_key_violation then denied := true; end;
  if not denied then raise exception 'a call can name a meeting that does not exist'; end if;
end $$;
