-- What the player's log reads beside the ledger, its shares and the wallet's events
-- (supabase/migrations/0037_log_reads.sql): the player's own card ledger, the plays other players
-- landed on the player's own posts with when each post's effect was last saved, and whether a
-- settlement was made once its shares were kept. Each read by its own player alone. The log shares
-- plan, Task 4.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- The card ledger: what the player bought and played, by card, read by the player alone ----
do $$
declare
  ann uuid := tests.account('lr-ann');
  bob uuid := tests.account('lr-bob');
  a uuid := tests.character(ann, 'Lr Ann');
  b uuid := tests.character(bob, 'Lr Bob');
  t uuid := tests.thread();
  p uuid := tests.post(b, t, 'Splat me.');
  played uuid;
  r record;
begin
  insert into wallets (account, balance) values (ann, 600), (bob, 600);
  perform tests.become_service();
  perform buy_card(ann, 'blot', 100);
  played := (play_card(ann, 'blot', a, p, '{}', 25, 'Take that.') ->> 'id')::uuid;
  perform buy_card(bob, 'sweetie', 100);
  perform tests.unbecome();

  perform tests.become(ann);
  if (select count(*) from my_card_ledger) is distinct from 2::bigint then
    raise exception 'Ann reads her purchase and her play, read %', (select jsonb_agg(to_jsonb(x)) from my_card_ledger x);
  end if;
  select * into r from my_card_ledger where kind = 'bought';
  if r.card is distinct from 'blot' or r.price is distinct from 100 or r.act is not null or r.at is null then
    raise exception 'a purchase names its card and its price: %', to_jsonb(r);
  end if;
  select * into r from my_card_ledger where kind = 'played';
  if r.card is distinct from 'blot' or r.price is distinct from 25 or r.act is distinct from played then
    raise exception 'a play names its card, its price and its Act: %', to_jsonb(r);
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'my_card_ledger' and column_name in ('account', 'id')) then
    raise exception 'my_card_ledger never shows the account or the row''s id';
  end if;
  perform tests.unbecome();

  -- Bob reads his own purchase and nothing of Ann's.
  perform tests.become(bob);
  if (select count(*) from my_card_ledger) is distinct from 1::bigint or (select card from my_card_ledger) is distinct from 'sweetie' then
    raise exception 'Bob reads his one purchase alone: %', (select jsonb_agg(to_jsonb(x)) from my_card_ledger x);
  end if;
  perform tests.unbecome();
end $$;

-- ---- A play that costs nothing still reads in the card ledger, where it writes no wallet event ----
do $$
declare
  ann uuid := tests.account('lr-free-ann');
  bob uuid := tests.account('lr-free-bob');
  a uuid := tests.character(ann, 'Lr Free Ann');
  b uuid := tests.character(bob, 'Lr Free Bob');
  t uuid := tests.thread();
  p uuid := tests.post(b, t, 'A short one.');
  played uuid;
begin
  insert into card_ledger (account, card, kind, price) values (ann, 'blot', 'bought', 0);
  perform tests.become_service();
  played := (play_card(ann, 'blot', a, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(ann);
  if not exists (select 1 from my_card_ledger where kind = 'played' and act = played and price = 0) then
    raise exception 'a play at no cost is in the card ledger: %', (select jsonb_agg(to_jsonb(x)) from my_card_ledger x);
  end if;
  if exists (select 1 from my_wallet_events where ref = played) then
    raise exception 'a play at no cost writes no wallet event, so the log cannot read it there';
  end if;
  perform tests.unbecome();
end $$;

-- ---- Plays on the player's posts: by another player's characters, with the effect's last save ----
do $$
declare
  ann uuid := tests.account('lr-on-ann');
  bob uuid := tests.account('lr-on-bob');
  cat uuid := tests.account('lr-on-cat');
  a uuid := tests.character(ann, 'Lr On Ann');
  a2 uuid := tests.character(ann, 'Lr On Ann Two');
  b uuid := tests.character(bob, 'Lr On Bob');
  c uuid := tests.character(cat, 'Lr On Cat');
  t uuid := tests.thread();
  mine uuid := tests.post(a, t, 'Mine.');
  theirs uuid := tests.post(c, t, 'Cat''s.');
  by_bob uuid;
  by_own uuid;
  on_cat uuid;
  r record;
begin
  insert into card_ledger (account, card, kind, price) values (bob, 'blot', 'bought', 0), (ann, 'blot', 'bought', 0), (bob, 'sweetie', 'bought', 0);
  perform tests.become_service();
  by_bob := (play_card(bob, 'blot', b, mine, '{}', 0, 'Bob was here.') ->> 'id')::uuid;
  by_own := (play_card(ann, 'blot', a2, mine, '{}', 0, '') ->> 'id')::uuid;
  on_cat := (play_card(bob, 'sweetie', b, theirs, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();

  perform tests.become(ann);
  -- Bob's play on Ann's post reads; her own character's play on it is hers already (my_card_ledger),
  -- and a play on Cat's post is none of hers.
  if (select count(*) from my_posts_played_on) is distinct from 1::bigint then
    raise exception 'Ann reads the one play another player landed on her post, read %', (select jsonb_agg(to_jsonb(x)) from my_posts_played_on x);
  end if;
  select * into r from my_posts_played_on;
  if r.play is distinct from by_bob or r.post is distinct from mine or r.at is null or r.saved_at is not null then
    raise exception 'the play names itself, the post and when, and no save yet: %', to_jsonb(r);
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'my_posts_played_on' and column_name in ('account', 'owner', 'state', 'saved_by')) then
    raise exception 'my_posts_played_on never shows an account, an owner or the effect''s state';
  end if;
  perform tests.unbecome();

  -- The author saves the effect: the save's time reads, never what it holds.
  insert into effect_state (play, state, saved_by, saved_at) values (by_bob, '{"strokes": []}', a, '2031-01-02T03:04:05Z');
  perform tests.become(ann);
  if (select saved_at from my_posts_played_on where play = by_bob) is distinct from '2031-01-02T03:04:05Z'::timestamptz then
    raise exception 'the effect''s last save reads: %', (select jsonb_agg(to_jsonb(x)) from my_posts_played_on x);
  end if;
  perform tests.unbecome();

  -- Cat's post's play reads for Cat alone; Bob, who played both, reads neither (a play he made is his card ledger's).
  perform tests.become(cat);
  if (select play from my_posts_played_on) is distinct from on_cat or (select count(*) from my_posts_played_on) is distinct from 1::bigint then
    raise exception 'Cat reads the play on her post alone: %', (select jsonb_agg(to_jsonb(x)) from my_posts_played_on x);
  end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if exists (select 1 from my_posts_played_on) then raise exception 'Bob''s plays on others'' posts are not plays on his'; end if;
  perform tests.unbecome();
end $$;

-- ---- The mark is at most one row; with none, every settlement was made with its shares kept ----
do $$
declare
  ann uuid := tests.account('lr-mark-ann');
  a uuid := tests.character(ann, 'Lr Mark Ann');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
begin
  -- The scratch database settled nothing before 0037, so it holds no mark, as a new instance does not.
  if exists (select 1 from ledger_shares_kept) then raise exception 'a database that settled nothing before 0037 holds no mark'; end if;
  perform apply_settlement(w1, w1 + interval '1 day', jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 3)));
  perform tests.become(ann);
  if (select shares_kept from my_ledger) is distinct from true then raise exception 'with no mark, a settlement was made with its shares kept'; end if;
  perform tests.unbecome();
  insert into ledger_shares_kept (from_settlement) values (1);
  if pg_temp.refusal('insert into ledger_shares_kept (from_settlement) values (2)') is null then
    raise exception 'a second mark is refused';
  end if;
end $$;

-- ---- Whether a settlement was made once its shares were kept ----
do $$
declare
  ann uuid := tests.account('lr-kept-ann');
  a uuid := tests.character(ann, 'Lr Kept Ann');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  w3 timestamptz := w2 + interval '1 day';
  before_kept bigint;
begin
  -- A settlement before the shares were kept: the mark moved past it, as 0037 sets it on an
  -- instance that settled before 0034.
  perform apply_settlement(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 5)));
  before_kept := (select id from settlements where starts_at = w1);
  insert into ledger_shares_kept (from_settlement) values (before_kept + 1) on conflict (one) do update set from_settlement = excluded.from_settlement;
  -- One after, whose entry the estimate valued on no post, so it has no shares either.
  perform apply_settlement(w2, w3, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 7)));

  perform tests.become(ann);
  if (select shares_kept from my_ledger where settlement = before_kept) is distinct from false then
    raise exception 'a settlement before the shares were kept says so: %', (select jsonb_agg(to_jsonb(x)) from my_ledger x);
  end if;
  if (select shares_kept from my_ledger where starts_at = w2) is distinct from true then
    raise exception 'a settlement after says its shares were kept, though it has none: %', (select jsonb_agg(to_jsonb(x)) from my_ledger x);
  end if;
  perform tests.unbecome();
end $$;

-- ---- Nobody signed out reads any of it, and the tables underneath stay closed ----
do $$
declare
  v text;
begin
  perform tests.become_anon();
  foreach v in array array['my_card_ledger', 'my_posts_played_on'] loop
    if pg_temp.refusal(format('select count(*) from %I', v)) is null then
      raise exception '% was readable signed out', v;
    end if;
  end loop;
  perform tests.unbecome();
  if has_table_privilege('authenticated', 'ledger_shares_kept', 'select') or has_table_privilege('anon', 'ledger_shares_kept', 'select') then
    raise exception 'ledger_shares_kept is the views'' alone';
  end if;
end $$;
