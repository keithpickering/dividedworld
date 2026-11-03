-- Settings' Tips row (supabase/migrations/0069_tips_settings.sql; the onboarding plan's Task 9): resume_tips turns tips on and forgets
-- nothing; replay_tour also sets the welcome mark when it is empty and leaves a first time alone; forget_cards_met is gone.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('tset-ann');
  bob uuid := tests.account('tset-bob');
  said jsonb;
  first_at timestamptz;
begin
  perform tests.become(ann);
  perform see_welcome();
  first_at := (select welcomed_at from account_preferences);
  perform see_tip('grid'); perform see_tip('tour-plate'); perform meet_card('whoops');
  perform skip_tips();
  said := resume_tips();
  if said ->> 'tips' is distinct from 'on' then raise exception 'resuming turns tips on: %', said; end if;
  if said -> 'tips_seen' is distinct from '["grid", "tour-plate"]'::jsonb or said -> 'cards_met' is distinct from '["whoops"]'::jsonb then
    raise exception 'resuming forgets nothing: %', said;
  end if;
  if resume_tips() is distinct from said then raise exception 'resuming twice answers the same'; end if;
  if (select welcomed_at from account_preferences) is distinct from first_at then raise exception 'resuming touched the welcome mark'; end if;

  -- A replay leaves a first welcome alone.
  perform replay_tour();
  if (select welcomed_at from account_preferences) is distinct from first_at then raise exception 'replaying moved the first welcome'; end if;
  perform tests.unbecome();

  -- An account that never saw the welcome gets the mark from a replay, so the tour can show; its row is made if it had none.
  perform tests.become(bob);
  said := replay_tour();
  if said -> 'welcomed_at' is null or said -> 'welcomed_at' = 'null'::jsonb then raise exception 'replaying sets the empty welcome mark: %', said; end if;
  if said ->> 'tips' is distinct from 'on' then raise exception 'replaying turns tips on: %', said; end if;
  perform tests.unbecome();
  -- Bob's calls never touched ann's row.
  if (select welcomed_at from account_preferences where account = ann) is distinct from first_at then raise exception 'bob changed ann''s welcome'; end if;
  perform tests.become(bob);
  perform skip_tips();
  said := resume_tips();
  if said ->> 'tips' is distinct from 'on' or (select count(*) from account_preferences) is distinct from 1 then raise exception 'resuming is the caller''s row alone'; end if;
  perform tests.unbecome();

  -- An account with no preferences row yet: resume_tips makes the row (the insert branch), tips on, nothing seen.
  perform tests.become(tests.account('tset-cy'));
  if (select count(*) from account_preferences) is distinct from 0 then raise exception 'cy should start with no row'; end if;
  said := resume_tips();
  if said ->> 'tips' is distinct from 'on' or said -> 'tips_seen' is distinct from '[]'::jsonb or (select count(*) from account_preferences) is distinct from 1 then
    raise exception 'resuming with no row makes one, on: %', said;
  end if;
  perform tests.unbecome();

  -- forget_cards_met is gone; a visitor cannot call resume_tips.
  if exists (select 1 from pg_proc where proname = 'forget_cards_met') then raise exception 'forget_cards_met still exists'; end if;
  perform tests.become_anon();
  if pg_temp.refusal($q$select resume_tips()$q$) is distinct from 'permission denied for function resume_tips' then raise exception 'a visitor could call resume_tips'; end if;
  perform tests.unbecome();
end $$;
