-- Which alert kinds toast (supabase/migrations/0064_toast_kinds.sql): the account's own choice, null meaning the instance's defaults.
-- It is set and read back, an empty choice is a choice of its own, a kind named twice is kept once, a kind that is none of the engine's is
-- refused naming it, resetting puts it back to null, every answer that carries the preferences carries it, another account neither reads
-- nor moves it, and a visitor cannot call. The alerts plan, Task 11.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('toast-ann');
  bob uuid := tests.account('toast-bob');
  said jsonb;
begin
  perform tests.become(ann);
  -- Never chosen: no row, and so the instance's defaults.
  if exists (select 1 from account_preferences) then raise exception 'a row was made before any call'; end if;

  -- A first choice makes the row, leaves the other preferences at their defaults, and is answered and read back.
  said := set_preferences(toasts => array['quote', 'ruling']);
  if said -> 'toasts' is distinct from '["quote", "ruling"]'::jsonb then raise exception 'set_preferences answers the choice: %', said; end if;
  if (select toasts from account_preferences) is distinct from array['quote', 'ruling'] or (select theme from account_preferences) is distinct from 'system' then
    raise exception 'the choice is read back from the row';
  end if;

  -- A choice is replaced whole; a call that leaves it out keeps it.
  said := set_preferences(smoke => 'low');
  if said -> 'toasts' is distinct from '["quote", "ruling"]'::jsonb then raise exception 'a call that left the toasts out changed them: %', said; end if;
  said := set_preferences(toasts => array['hint']);
  if said -> 'toasts' is distinct from '["hint"]'::jsonb then raise exception 'a choice replaces the one before it: %', said; end if;

  -- An empty choice is a choice (nothing toasts), not the defaults.
  said := set_preferences(toasts => '{}');
  if said -> 'toasts' is distinct from '[]'::jsonb then raise exception 'an empty choice is kept as empty: %', said; end if;

  -- A kind named twice is kept once, in the order it was first named.
  said := set_preferences(toasts => array['update', 'quote', 'update', 'quote', 'hint']);
  if said -> 'toasts' is distinct from '["update", "quote", "hint"]'::jsonb then raise exception 'duplicates are repaired: %', said; end if;

  -- A kind that is not the engine's is refused naming it, and the choice stands.
  if pg_temp.refusal($q$select set_preferences(toasts => array['quote', 'confetti'])$q$) is distinct from 'not a kind of alert: confetti' then raise exception 'an unknown kind is refused naming it'; end if;
  if pg_temp.refusal($q$select set_preferences(toasts => array['confetti', 'party', 'confetti'])$q$) is distinct from 'not a kind of alert: confetti, party' then raise exception 'every unknown kind is named, once'; end if;
  if pg_temp.refusal($q$select set_preferences(toasts => array['quote', null])$q$) is distinct from 'not a kind of alert: (blank)' then raise exception 'a blank kind is refused'; end if;
  if pg_temp.refusal($q$select set_preferences(toasts => array['quote'], toasts_default => true)$q$) is distinct from 'the toasts are chosen or put back to the defaults, not both' then raise exception 'choosing and resetting together is refused'; end if;
  if (select toasts from account_preferences) is distinct from array['update', 'quote', 'hint'] then raise exception 'a refused call changed the choice'; end if;

  -- The other two functions that answer the preferences carry it, as do the marks.
  said := meet_card('whoops');
  if said -> 'toasts' is distinct from '["update", "quote", "hint"]'::jsonb then raise exception 'meet_card answered without the toasts: %', said; end if;
  said := restore_tips();
  if said -> 'toasts' is distinct from '["update", "quote", "hint"]'::jsonb then raise exception 'restore_tips answered without the toasts: %', said; end if;

  -- Resetting puts the choice back to null, the instance's defaults, and the answer says null (a key that is there, with no value).
  said := set_preferences(toasts_default => true);
  if not said ? 'toasts' or said -> 'toasts' is distinct from 'null'::jsonb then raise exception 'reset answers a null choice: %', said; end if;
  if (select toasts from account_preferences) is not null then raise exception 'reset left a choice'; end if;
  -- A row that never had a choice answers null on every path.
  perform tests.unbecome();
  perform tests.become(bob);
  said := meet_card('whoops');
  if not said ? 'toasts' or said -> 'toasts' is distinct from 'null'::jsonb then raise exception 'meet_card answers a null choice: %', said; end if;

  -- Another account reads none of the first's choice and moves only its own.
  if (select count(*) from account_preferences where toasts is not null) is distinct from 0 then raise exception 'another account read a choice of the first''s'; end if;
  said := set_preferences(toasts => array['seasonNews']);
  if said -> 'toasts' is distinct from '["seasonNews"]'::jsonb then raise exception 'a second account sets its own: %', said; end if;
  said := set_preferences(toasts => array['cardEnded', 'quote']);
  if said -> 'toasts' is distinct from '["cardEnded", "quote"]'::jsonb then raise exception 'cardEnded is a kind of alert a toast may name: %', said; end if;
  perform tests.unbecome();
  if (select toasts from account_preferences where account = ann) is not null then raise exception 'another account''s call moved the first''s choice'; end if;

  -- The table refuses a kind that is not the engine's, even from a write that bypassed the function.
  if pg_temp.refusal(format('update account_preferences set toasts = array[''confetti''] where account = %L', ann)) is null then raise exception 'the column accepted an unknown kind'; end if;

  -- A visitor cannot call.
  perform tests.become_anon();
  if pg_temp.refusal($q$select set_preferences(toasts => array['quote'])$q$) is distinct from 'permission denied for function set_preferences' then raise exception 'a visitor could call set_preferences'; end if;
  perform tests.unbecome();
end $$;
