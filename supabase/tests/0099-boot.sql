-- boot() (supabase/migrations/0097_boot.sql; the forum-load design, section 2 and 10; its plan, Task 7): the frame and the HUD in one read.
-- Each piece equals what the screen reads today, one view or function at a time: a player's own characters and no one else's, her wallet and hand,
-- her preferences, the public faces of those characters, the boards, the unread count and the settlement marks. A signed-in caller with no account
-- gets `account` null and the public pieces; a visitor is refused, and reads settings() alone, as today.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('bt-ann');
  bob uuid := tests.account('bt-bob');
  a1 uuid := tests.character(ann, 'Bt Zed', 'alpha', now() - interval '60 days');
  a2 uuid := tests.character(ann, 'Bt Abe', 'beta', now() - interval '60 days');
  b1 uuid := tests.character(bob, 'Bt Bobs', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Bt thread');
  nobody uuid := gen_random_uuid();
  got jsonb;
  last_end timestamptz;
  why text;
begin
  insert into auth.users (id, email) values (nobody, 'bt-nobody@test.invalid');
  insert into wallets (account, balance) values (ann, 321);
  insert into card_ledger (account, card, kind, price) values (ann, 'blot', 'bought', 0), (ann, 'blot', 'bought', 0), (ann, 'sweetie', 'bought', 0);
  insert into account_preferences (account, theme, postbit) values (ann, 'dusk', 'stacked');
  insert into character_profiles (character, title, signature) values (a1, 'The Zed', 'zed sig') on conflict (character) do update set title = excluded.title;
  perform tests.post(a1, t, 'First.');
  perform tests.post(b1, t, 'Second.');
  last_end := (select max(ends_at) from settlements);
  if last_end is null or last_end < now() - interval '1 hour' then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(coalesce(last_end, (select min(starts_at) from seasons)), now() - interval '1 hour', '[]');
    perform tests.unbecome();
  end if;

  -- Ann: each piece equals the direct read.
  perform tests.become(ann);
  got := boot();
  if got -> 'settings' is distinct from (select settings from screen_settings) then raise exception 'settings: %', got -> 'settings'; end if;
  if got ->> 'account' is distinct from ann::text then raise exception 'account: %', got -> 'account'; end if;
  if got #>> '{preferences,theme}' is distinct from 'dusk' or got #>> '{preferences,postbit}' is distinct from 'stacked'
     or got -> 'preferences' is distinct from (select to_jsonb(p) - 'account' from (select theme, postbit, motion, smoke, contrast, text_size, tilt, effects, game_sound, game_volume, interface_sound, interface_volume, mode, cards_met, alerts_seen_at, settlement_seen, toasts, welcomed_at, tips, tips_seen from account_preferences) p) then
    raise exception 'preferences: %', got -> 'preferences';
  end if;
  if jsonb_array_length(got -> 'characters') is distinct from 2 then raise exception 'two characters of Ann''s: %', got -> 'characters'; end if;
  if got -> 'characters' is distinct from (select jsonb_agg(to_jsonb(c) order by c.name) from my_characters c) then raise exception 'characters: %', got -> 'characters'; end if;
  if got #>> '{characters,0,name}' is distinct from 'Bt Abe' then raise exception 'characters come by name: %', got -> 'characters'; end if;
  if got::text like '%Bt Bobs%' or got::text like '%' || b1::text || '%' then raise exception 'another player''s character is in the boot: %', got; end if;
  if jsonb_array_length(got -> 'faces') is distinct from 2 then raise exception 'two faces: %', got -> 'faces'; end if;
  if not exists (select 1 from jsonb_array_elements(got -> 'faces') f where f ->> 'id' = a1::text and f ->> 'name' = 'Bt Zed' and f #>> '{profile,title}' = 'The Zed') then raise exception 'a face carries its public name and profile: %', got -> 'faces'; end if;
  if got -> 'wallet' is distinct from (select to_jsonb(w) from my_wallet w) or (got #>> '{wallet,balance}')::integer is distinct from 321 then raise exception 'wallet: %', got -> 'wallet'; end if;
  if got -> 'cards' is distinct from (select jsonb_agg(to_jsonb(c) order by c.card) from my_cards c) or (select x ->> 'held' from jsonb_array_elements(got -> 'cards') x where x ->> 'card' = 'blot') is distinct from '2' then raise exception 'cards: %', got -> 'cards'; end if;
  if got -> 'admin' is distinct from to_jsonb(coalesce(is_admin(), false)) then raise exception 'admin: %', got -> 'admin'; end if;
  if (got ->> 'unread')::integer is distinct from my_alerts_unread() then raise exception 'unread: %', got -> 'unread'; end if;
  if (got ->> 'nextSettlementAt')::timestamptz is distinct from next_settlement_at() then raise exception 'nextSettlementAt: %', got -> 'nextSettlementAt'; end if;
  if (got ->> 'lastSettledAt')::timestamptz is distinct from (select max(ends_at) from settlements) then raise exception 'lastSettledAt: %', got -> 'lastSettledAt'; end if;
  if jsonb_array_length(got -> 'boards') is distinct from (select count(*) from boards_now)::integer then raise exception 'boards: %', got -> 'boards'; end if;
  -- Each board carries its count and its newest listed thread, as the adapter reads them one board at a time.
  if exists (
    select 1 from jsonb_array_elements(got -> 'boards') x
    where (x ->> 'thread_count')::integer is distinct from coalesce((select c.threads from board_counts c where c.board = (x ->> 'id')::uuid), 0)
       or x ->> 'last_thread' is distinct from (select l.id::text from thread_list l where l.board = (x ->> 'id')::uuid order by l.last_at desc limit 1)
       or x ->> 'last_title' is distinct from (select l.title from thread_list l where l.board = (x ->> 'id')::uuid order by l.last_at desc limit 1)
       or x ->> 'last_character' is distinct from (select l.last_character::text from thread_list l where l.board = (x ->> 'id')::uuid order by l.last_at desc limit 1)
  ) then
    raise exception 'a board carries its count and its newest thread: %', got -> 'boards';
  end if;
  if got -> 'boards' is distinct from index_page() -> 'boards' then raise exception 'boot boards are index_page boards: % vs %', got -> 'boards', index_page() -> 'boards'; end if;
  -- She has no ledger lines, so no settlement of hers is the newest one.
  if got -> 'newestSettlement' is distinct from 'null'::jsonb then raise exception 'newestSettlement: %', got -> 'newestSettlement'; end if;
  perform tests.unbecome();

  -- Bob has no preferences row, a wallet of nothing and no hand; and sees none of Ann's.
  perform tests.become(bob);
  got := boot();
  if got -> 'preferences' is distinct from 'null'::jsonb then raise exception 'no row, no preferences: %', got -> 'preferences'; end if;
  if jsonb_array_length(got -> 'characters') is distinct from 1 or got #>> '{characters,0,name}' is distinct from 'Bt Bobs' then raise exception 'Bob reads his one character: %', got -> 'characters'; end if;
  if got::text like '%Bt Zed%' or jsonb_array_length(got -> 'faces') is distinct from 1 then raise exception 'Bob''s boot holds one face and none of Ann''s: %', got -> 'faces'; end if;
  if jsonb_array_length(got -> 'cards') is distinct from 0 then raise exception 'Bob holds no card: %', got -> 'cards'; end if;
  perform tests.unbecome();

  -- Signed in with no account yet: account null, the public pieces still there.
  perform tests.become(nobody);
  got := boot();
  if got -> 'account' is distinct from 'null'::jsonb then raise exception 'no account, account null: %', got -> 'account'; end if;
  if got -> 'settings' is distinct from (select settings from screen_settings) or jsonb_array_length(got -> 'boards') is distinct from (select count(*) from boards_now)::integer then raise exception 'the public pieces stay: %', got; end if;
  if jsonb_array_length(got -> 'characters') is distinct from 0 then raise exception 'no account, no characters: %', got -> 'characters'; end if;
  perform tests.unbecome();

  -- A visitor is refused.
  perform tests.become_anon();
  why := pg_temp.refusal('select boot()');
  perform tests.unbecome();
  if why is null or why not like '42501%' then raise exception 'anon must be refused boot(), got %', why; end if;
  -- Lines in two settlements: the newer one's end is the newest settlement of hers, whichever line was written last.
  declare
    s1 bigint; s2 bigint; e2 timestamptz := date_trunc('second', now() + interval '2001 days');
  begin
    insert into settlements (starts_at, ends_at, season) values (now() + interval '1999 days', now() + interval '2000 days', (select id from seasons order by starts_at limit 1)) returning id into s1;
    insert into settlements (starts_at, ends_at, season) values (now() + interval '2000 days', e2, (select id from seasons order by starts_at limit 1)) returning id into s2;
    insert into ledger (settlement, account, character, reason, amount) values (s2, ann, a1, 'post.liked', 3), (s1, ann, a1, 'post.liked', 2);
    perform tests.become(ann);
    got := boot();
    perform tests.unbecome();
    if (got ->> 'newestSettlement')::timestamptz is distinct from e2 then raise exception 'the newest settlement of hers: % wanted %', got -> 'newestSettlement', e2; end if;
  end;
end $$;
