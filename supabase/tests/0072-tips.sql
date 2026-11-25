-- The tips' state on the account (supabase/migrations/0068_tips.sql; the onboarding plan's Task 3): the welcome mark, the tips switch and
-- the tips seen, kept on the caller's own account_preferences row and changed by five functions alone. Each answers the whole preferences,
-- each touches the caller's row only, a key that is not a key is refused in plain words, the set holds 64, and a visitor cannot call any.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('tip-ann');
  bob uuid := tests.account('tip-bob');
  said jsonb;
  first_at timestamptz;
  i integer;
begin
  perform tests.become(ann);
  -- A first call creates the row at its defaults: not welcomed, tips on, nothing seen.
  said := see_welcome();
  if said -> 'welcomed_at' is null or said -> 'welcomed_at' = 'null'::jsonb then raise exception 'seeing the welcome sets the mark: %', said; end if;
  if said ->> 'tips' is distinct from 'on' or said -> 'tips_seen' is distinct from '[]'::jsonb then raise exception 'a first call keeps the defaults: %', said; end if;
  first_at := (select welcomed_at from account_preferences);
  -- Seen once: a second call leaves the first time.
  perform pg_sleep(0.01);
  said := see_welcome();
  if (select welcomed_at from account_preferences) is distinct from first_at then raise exception 'a second welcome moved the mark'; end if;

  -- A tip is added once; the answer is the same whether or not it was new.
  said := see_tip('grid');
  if said -> 'tips_seen' is distinct from '["grid"]'::jsonb then raise exception 'a first tip is kept: %', said; end if;
  if see_tip('grid') is distinct from said then raise exception 'seeing a tip again changes nothing: %', see_tip('grid'); end if;
  said := see_tip('tour-plate');
  perform see_tip('tour-orbs');
  perform see_tip('tour-hand');
  if said -> 'tips_seen' is distinct from '["grid", "tour-plate"]'::jsonb then raise exception 'a second tip is kept beside the first: %', said; end if;
  -- set_preferences and meet_card leave the tips alone and still answer them.
  perform meet_card('whoops');
  said := set_preferences(smoke => 'low');
  if said ->> 'tips' is distinct from 'on' or said -> 'tips_seen' is distinct from '["grid", "tour-plate", "tour-orbs", "tour-hand"]'::jsonb
     or said -> 'welcomed_at' is null or said -> 'welcomed_at' = 'null'::jsonb then
    raise exception 'set_preferences answers the whole row, the tips too: %', said;
  end if;

  -- skip_tips turns tips off and keeps what was seen.
  said := skip_tips();
  if said ->> 'tips' is distinct from 'off' or jsonb_array_length(said -> 'tips_seen') is distinct from 4 then raise exception 'skipping turns tips off and keeps the seen: %', said; end if;
  if skip_tips() is distinct from said then raise exception 'skipping twice answers the same'; end if;

  -- replay_tour removes the tour's keys alone and turns tips on.
  said := replay_tour();
  if said ->> 'tips' is distinct from 'on' or said -> 'tips_seen' is distinct from '["grid"]'::jsonb then raise exception 'replaying the tour forgets its keys alone: %', said; end if;
  if replay_tour() is distinct from said then raise exception 'replaying twice answers the same'; end if;
  if (select cards_met from account_preferences) is distinct from array['whoops'] then raise exception 'replaying the tour touched the cards met'; end if;

  -- restore_tips turns tips on and forgets the tips seen and the cards met; the welcome stays seen.
  perform skip_tips();
  said := restore_tips();
  if said ->> 'tips' is distinct from 'on' or said -> 'tips_seen' is distinct from '[]'::jsonb or said -> 'cards_met' is distinct from '[]'::jsonb then
    raise exception 'restoring puts all three back: %', said;
  end if;
  if (select welcomed_at from account_preferences) is distinct from first_at then raise exception 'restoring touched the welcome mark'; end if;

  -- A key that is not a key is refused by its words.
  if pg_temp.refusal($q$select see_tip('Grid')$q$) is distinct from 'a tip is named in lowercase words joined by hyphens' then raise exception 'an uppercase key'; end if;
  if pg_temp.refusal($q$select see_tip('')$q$) is distinct from 'a tip is named in lowercase words joined by hyphens' then raise exception 'an empty key'; end if;
  if pg_temp.refusal($q$select see_tip(null)$q$) is distinct from 'a tip is named in lowercase words joined by hyphens' then raise exception 'a null key'; end if;
  if pg_temp.refusal($q$select see_tip('1up')$q$) is distinct from 'a tip is named in lowercase words joined by hyphens' then raise exception 'a key opening with a digit'; end if;
  if pg_temp.refusal($q$select see_tip(repeat('a', 41))$q$) is distinct from 'a tip is named in lowercase words joined by hyphens' then raise exception 'a 41 character key'; end if;
  if pg_temp.refusal($q$select see_tip('bad key')$q$) is distinct from 'a tip is named in lowercase words joined by hyphens' then raise exception 'a key with a space'; end if;

  -- The 65th key is refused; the set stays at 64, and a key already held still answers.
  for i in 1..64 loop perform see_tip('tip-' || i); end loop;
  if cardinality((select tips_seen from account_preferences)) is distinct from 64 then raise exception 'the set holds 64'; end if;
  if pg_temp.refusal($q$select see_tip('one-too-many')$q$) is distinct from 'at most 64 tips are kept as seen' then raise exception 'the 65th key was not refused by its words'; end if;
  if cardinality((select tips_seen from account_preferences)) is distinct from 64 then raise exception 'the refused key was kept'; end if;
  if see_tip('tip-1') -> 'tips_seen' is null then raise exception 'a key already held is still accepted at the cap'; end if;
  perform tests.unbecome();

  perform tests.unbecome();
  -- The table itself holds the same bound, whatever the function does.
  if pg_temp.refusal($q$update account_preferences set tips_seen = tips_seen || 'x' where account = $q$ || quote_literal(ann) || $q$::uuid$q$) is null then
    raise exception 'the column let a 65th key in';
  end if;
  if pg_temp.refusal($q$update account_preferences set tips_seen = '{Bad Key}'$q$) is null then raise exception 'the column let a malformed key in'; end if;
  if pg_temp.refusal($q$update account_preferences set tips = 'maybe'$q$) is null then raise exception 'the column let a third tips value in'; end if;

  -- Another account reads nothing of ann's and its own calls never touch hers.
  perform tests.become(bob);
  if (select count(*) from account_preferences) is distinct from 0 then raise exception 'another account read the tips'; end if;
  said := skip_tips();
  if said ->> 'tips' is distinct from 'off' or said -> 'welcomed_at' <> 'null'::jsonb or said -> 'tips_seen' is distinct from '[]'::jsonb then raise exception 'bob starts from the defaults: %', said; end if;
  perform see_tip('grid');
  perform restore_tips();
  perform replay_tour();
  perform see_welcome();
  if (select count(*) from account_preferences) is distinct from 1 then raise exception 'an account reads its own row alone'; end if;
  perform tests.unbecome();
  if (select tips_seen from account_preferences where account = ann) is distinct from (select array_agg('tip-' || n order by n) from generate_series(1, 64) n)
     or (select tips from account_preferences where account = ann) is distinct from 'on' or (select welcomed_at from account_preferences where account = ann) is distinct from first_at then
    raise exception 'bob changed ann''s tips';
  end if;

  -- A visitor cannot call any of them: refused by the grant.
  perform tests.become_anon();
  if pg_temp.refusal($q$select see_welcome()$q$) is distinct from 'permission denied for function see_welcome' then raise exception 'a visitor could call see_welcome'; end if;
  if pg_temp.refusal($q$select see_tip('grid')$q$) is distinct from 'permission denied for function see_tip' then raise exception 'a visitor could call see_tip'; end if;
  if pg_temp.refusal($q$select skip_tips()$q$) is distinct from 'permission denied for function skip_tips' then raise exception 'a visitor could call skip_tips'; end if;
  if pg_temp.refusal($q$select restore_tips()$q$) is distinct from 'permission denied for function restore_tips' then raise exception 'a visitor could call restore_tips'; end if;
  if pg_temp.refusal($q$select replay_tour()$q$) is distinct from 'permission denied for function replay_tour' then raise exception 'a visitor could call replay_tour'; end if;
  perform tests.unbecome();
end $$;
