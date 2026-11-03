-- A post's text and version for a card's rules, and a play decided against an older version refused
-- (supabase/migrations/0070_autocorrect.sql). docs/plans/2026-11-03-autocorrect-plan.md, Task 2. The card is the
-- test set's, never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('ac-ann'); bob uuid := tests.account('ac-bob');
  a uuid := tests.character(ann, 'Autocorrect Ann'); b uuid := tests.character(bob, 'Autocorrect Bob');
  th uuid := tests.thread('Autocorrect thread');
  p uuid := tests.post(a, th, 'my cats are [b]great[/b]', now() - interval '1 hour');
  first_edit uuid; second_edit uuid;
  got jsonb;
  said text;
begin
  update settings set value = value || '{"stickers.price": 100}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, stack) values ('stickers', 'Stickers', 'pepperoni', 'stickers.price', 'common', 3);
  insert into card_ledger (account, card, kind, price) select bob, 'stickers', 'bought', 0 from generate_series(1, 3);

  -- Before any edit, the version is the post itself, and the body is what it was written with.
  got := card_target(p);
  if got ->> 'version' is distinct from p::text then raise exception 'an unedited post''s version is its own id, got %', got ->> 'version'; end if;
  if got ->> 'body' is distinct from 'my cats are [b]great[/b]' then raise exception 'the body is the post''s words, got %', got ->> 'body'; end if;
  if (card_target_reach('post', p) ->> 'version') is distinct from p::text then raise exception 'card_target_reach passes the version through'; end if;

  -- After an edit, the version is the latest edit, and the body is its words.
  first_edit := tests.act(a, 'edit', th, '{"body": "my dogs are great"}', p, now() - interval '30 minutes');
  second_edit := tests.act(a, 'edit', th, '{"body": "my cats are fine"}', p, now() - interval '10 minutes');
  got := card_target(p);
  if got ->> 'version' is distinct from second_edit::text then raise exception 'the version is the latest edit, got % (first %)', got ->> 'version', first_edit; end if;
  if got ->> 'body' is distinct from 'my cats are fine' then raise exception 'the body is the latest edit''s, got %', got ->> 'body'; end if;

  -- A play decided against an older version is refused in plain words, and nothing is spent.
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', first_edit));
  if said is distinct from 'the post was edited; look again' then raise exception 'a stale version is refused, said %', said; end if;
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', p));
  if said is distinct from 'the post was edited; look again' then raise exception 'the post''s own id is stale once it is edited, said %', said; end if;
  if exists (select 1 from acts where kind = 'card' and target_act_id = p) then raise exception 'a refused play writes no Act'; end if;

  -- The current version lands, and so does a play given no version (every reach beyond a post, and every older caller).
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', second_edit));
  if said is not null then raise exception 'the current version lands, said %', said; end if;
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', bob, 'stickers', b, p, '{}', '', 'post'));
  if said is not null then raise exception 'a play with no version lands as before, said %', said; end if;
  if (select count(*) from acts where kind = 'card' and target_act_id = p) is distinct from 2 then raise exception 'two plays landed'; end if;

  -- Players cannot call the version-checking play_card themselves; only the service decides a play.
  perform tests.become(bob);
  said := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, %L)', bob, 'stickers', b, p, '{}', '', 'post', second_edit));
  perform tests.unbecome();
  if said is null or said not like 'permission denied%' then raise exception 'a player may not call play_card with a version, said %', said; end if;
end $$;
