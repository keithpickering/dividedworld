-- An Earn a cast card carries on a post alone (supabase/migrations/0369_hype_up_on_a_post.sql; docs/plans/2026-11-13-hype-up-on-a-post-plan.md, Task 2; the catalog's refusals are in 0161-earn-casts.sql).
-- A cast card that reaches a post alone may carry an earn with a time up: it lands on a post, writes `ends` a `lasts` out as a skim's does, takes the place a play holds on that post only while it is up (a second is
-- refused while one is live and lands once the first has ended), and set face down it lands on the quoting post as a cast does. settlement_input carries its play with its target and its end. The cards are this
-- file's own (pe...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('pehype', 'Pe Hype', 'sweet', 'common', 'cast', interval '3 days', '{post}',
      '{"kind": "earn", "quadrants": ["excitedPositive", "calmPositive"], "by": 1, "group": "publicity"}')
  on conflict (key) do nothing;
end $$;

create function pg_temp.entry(input jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = id::text
$$;
create function pg_temp.ms(t timestamptz) returns bigint language sql as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- ---- A cast on a post writes `ends`; a second is refused while one is live and lands once it has ended ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pe-ann'); bob uuid := tests.account('pe-bob');
  a uuid := tests.character(ann, 'Pe Ann'); b uuid := tests.character(bob, 'Pe Bob');
  t uuid := tests.thread('Pe thread');
  p uuid := tests.post(a, t, 'Ann''s post.');
  made jsonb; why text; first_id uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pehype', 'pehype');
  perform pg_temp.hand(bob, 'pehype');
  perform tests.become_service();

  made := play_card(ann, 'pehype', a, p, '{}', 0, '');
  first_id := (made ->> 'id')::uuid;
  if (select (k.target_act_id, coalesce(k.payload ->> 'reach', 'post'), (k.payload ->> 'ends')::timestamptz between now() + interval '3 days' - interval '1 minute' and now() + interval '3 days' + interval '1 minute')
      from acts k where k.id = first_id) is distinct from (p, 'post'::text, true) then
    raise exception 'a cast earn on a post did not write ends a lasts out: %', (select to_jsonb(k) from acts k where k.id = first_id);
  end if;

  -- A second, by anyone, while one is live.
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'pehype', a, p, '{}', ''));
  if why is distinct from '23505 this post already carries that card' then raise exception 'a second cast earn on one post: %', why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', bob, 'pehype', b, p, '{}', ''));
  if why is distinct from '23505 this post already carries that card' then raise exception 'a second cast earn on one post, by another player: %', why; end if;

  -- After ends has passed (the payload's own ends backdated), a cast lands.
  perform tests.unbecome();
  alter table acts disable trigger acts_no_update;
  update acts set payload = jsonb_set(payload, '{ends}', to_jsonb((now() - interval '1 minute')::text)) where id = first_id;
  alter table acts enable trigger acts_no_update;
  perform tests.become_service();
  made := play_card(bob, 'pehype', b, p, '{}', 0, '');
  if (select (k.payload ->> 'ends')::timestamptz > now() + interval '2 days' from acts k where k.id = (made ->> 'id')::uuid) is not true then
    raise exception 'a cast earn after the first had ended did not land with ends: %', made;
  end if;
end $$;

-- ---- Set face down, it lands on the quoting post with `ends` ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pe-set-ann'); bob uuid := tests.account('pe-set-bob');
  a uuid := tests.character(ann, 'Pe Set Ann'); b uuid := tests.character(bob, 'Pe Set Bob');
  t uuid := tests.thread('Pe set thread');
  pa uuid := tests.post(a, t, 'A back under this.');
  made jsonb; laid uuid; quoting uuid;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'pehype');
  perform tests.become_service();
  perform set_card(ann, 'pehype', a, pa, '{}', 0);
  perform tests.unbecome();
  perform tests.become(bob);
  made := post(t, b, 'Quoting Ann.', pa);
  perform tests.unbecome();
  quoting := (made ->> 'id')::uuid;
  select k.id into laid from acts k where k.kind = 'card' and k.payload ->> 'spring' = (made -> 'sprung' ->> 'id');
  if laid is null then raise exception 'the quote landed no card: %', made; end if;
  if (select (k.target_act_id, (k.payload ->> 'ends')::timestamptz > now() + interval '2 days') from acts k where k.id = laid) is distinct from (quoting, true) then
    raise exception 'the sprung cast earn did not land on the quoting post with ends: %', (select to_jsonb(k) from acts k where k.id = laid);
  end if;
end $$;

-- ---- The settlement carries the play with its target and its end ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pe-st-ann'); bob uuid := tests.account('pe-st-bob');
  a uuid := tests.character(ann, 'Pe St Ann'); b uuid := tests.character(bob, 'Pe St Bob');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Pe settlement thread');
  pb uuid; play uuid; got jsonb;
begin
  perform pg_temp.cards();
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  pb := tests.post(b, t, 'Bob''s post.', w0 - interval '20 hours');
  play := tests.act(a, 'card', t, jsonb_build_object('card', 'pehype', 'message', '', 'config', '{}'::jsonb, 'ends', w0 + interval '74 hours'), pb, w0 + interval '2 hours');
  got := pg_temp.entry(settlement_input(w0, w1), play);
  if got is null or got ->> 'target' is distinct from pb::text or (got ->> 'ends')::bigint is distinct from pg_temp.ms(w0 + interval '74 hours') or got ->> 'card' is distinct from 'pehype' then
    raise exception 'a cast earn on a post is not carried with its target and its end: %', got;
  end if;
end $$;
