-- The cards a player has met (supabase/migrations/0040_cards_met.sql): the first-time callout's
-- memory, kept on the account beside its other preferences. A key is added once, a malformed one
-- or a 65th is refused, one account never writes or reads another's, a visitor cannot call
-- either function, and forgetting empties the caller's set alone. The marks-and-the-lens plan, Task 7.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('met-ann');
  bob uuid := tests.account('met-bob');
  said jsonb;
  later jsonb;
  i integer;
begin
  perform tests.become(ann);
  -- A first meeting creates the row with every other preference at its default.
  said := meet_card('whoops');
  if said -> 'cards_met' is distinct from '["whoops"]'::jsonb or said ->> 'theme' is distinct from 'system' then
    raise exception 'a first meeting keeps the key and the defaults: %', said;
  end if;
  -- A key added twice is kept once, and the answer is the same shape whether or not it was new.
  later := meet_card('whoops');
  if later is distinct from said then raise exception 'meeting a card again changes nothing, and answers the same: %', later; end if;
  said := meet_card('stick-around');
  if said -> 'cards_met' is distinct from '["whoops", "stick-around"]'::jsonb then raise exception 'a second kind is kept beside the first: %', said; end if;
  -- set_preferences leaves the set alone, and still answers without it.
  said := set_preferences(smoke => 'low');
  if said -> 'cards_met' is distinct from '["whoops", "stick-around"]'::jsonb then raise exception 'set_preferences answers the whole row, the cards met too: %', said; end if;
  if (select cards_met from account_preferences) is distinct from array['whoops', 'stick-around'] then raise exception 'set_preferences changed the cards met'; end if;

  -- A malformed key is refused by its words, as a refusal.
  if pg_temp.refusal($q$select meet_card('Whoops')$q$) is distinct from 'a card is named in lowercase words joined by hyphens' then raise exception 'an uppercase key'; end if;
  if pg_temp.refusal($q$select meet_card('')$q$) is distinct from 'a card is named in lowercase words joined by hyphens' then raise exception 'an empty key'; end if;
  if pg_temp.refusal($q$select meet_card(null)$q$) is distinct from 'a card is named in lowercase words joined by hyphens' then raise exception 'a null key'; end if;
  if pg_temp.refusal($q$select meet_card('1up')$q$) is distinct from 'a card is named in lowercase words joined by hyphens' then raise exception 'a key opening with a digit'; end if;
  if pg_temp.refusal($q$select meet_card(repeat('a', 41))$q$) is distinct from 'a card is named in lowercase words joined by hyphens' then raise exception 'a 41 character key'; end if;
  if pg_temp.refusal($q$select meet_card('bad key')$q$) is distinct from 'a card is named in lowercase words joined by hyphens' then raise exception 'a key with a space'; end if;

  -- The 65th key is refused; the set stays at 64, and a key already held still answers.
  for i in 3..64 loop perform meet_card('card-' || i); end loop;
  if cardinality((select cards_met from account_preferences)) is distinct from 64 then raise exception 'the set holds 64'; end if;
  if pg_temp.refusal($q$select meet_card('one-too-many')$q$) is distinct from 'at most 64 cards are kept as met' then raise exception 'the 65th key was not refused by its words'; end if;
  if cardinality((select cards_met from account_preferences)) is distinct from 64 then raise exception 'the refused key was kept'; end if;
  if meet_card('whoops') -> 'cards_met' is null then raise exception 'a key already held is still accepted at the cap'; end if;
  perform tests.unbecome();

  -- Another account: reads nothing of ann's, and its own meetings never touch hers.
  perform tests.become(bob);
  if exists (select 1 from account_preferences where account = ann) or (select count(*) from account_preferences) is distinct from 0 then raise exception 'another account read the cards met'; end if;
  said := meet_card('whoops');
  if said -> 'cards_met' is distinct from '["whoops"]'::jsonb then raise exception 'bob met one card: %', said; end if;
  -- Forgetting empties the caller's own set alone.
  said := forget_cards_met();
  if said -> 'cards_met' is distinct from '[]'::jsonb then raise exception 'forgetting empties the set: %', said; end if;
  if forget_cards_met() is distinct from said then raise exception 'forgetting an empty set answers the same'; end if;
  if (select count(*) from account_preferences) is distinct from 1 then raise exception 'an account reads its own row alone'; end if;
  perform tests.unbecome();
  if cardinality((select cards_met from account_preferences where account = ann)) is distinct from 64 then raise exception 'bob forgot ann''s cards'; end if;

  -- The column is read through the 0019 policy, by its own account alone.
  perform tests.become(ann);
  if (select count(*) from account_preferences where cards_met is not null) is distinct from 1 then raise exception 'ann reads her own row alone'; end if;
  perform tests.unbecome();

  -- A visitor cannot call either: refused by the grant.
  perform tests.become_anon();
  if pg_temp.refusal($q$select meet_card('whoops')$q$) is distinct from 'permission denied for function meet_card' then raise exception 'a visitor could call meet_card'; end if;
  if pg_temp.refusal($q$select forget_cards_met()$q$) is distinct from 'permission denied for function forget_cards_met' then raise exception 'a visitor could call forget_cards_met'; end if;
  perform tests.unbecome();
end $$;
