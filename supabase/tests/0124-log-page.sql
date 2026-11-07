-- log_page(before) (supabase/migrations/0123_log_page.sql; the glass-load design, section 7; its plan, Task 9): /log and /log/settlement in one read.
-- `sources` holds the thirteen reads the adapter's log() makes, each its view's rows newest first at or before `before`, at most LOG_ROWS (200), with the
-- same columns and filters; `shares` the shares of the settlements read, whole; and the pieces useLog's `around` reads for them, computed over every row
-- read: the Acts the lines name and the two rounds those follow, the saved states of the plays, the characters, threads and boards named, the caller's
-- characters' standings and announced Turns, and the season. Another player's rows are absent; a visitor is refused.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- A source as the test reads it directly: the rows as one array ([] where there are none), to compare with the document's.
create function pg_temp.arr(rows jsonb) returns jsonb language sql as $$ select coalesce(rows, '[]'::jsonb) $$;

do $$
declare
  ann uuid := tests.account('lg-ann');
  bob uuid := tests.account('lg-bob');
  nobody uuid := gen_random_uuid();
  a1 uuid := tests.character(ann, 'Lg Ann One', 'alpha', now() - interval '60 days');
  a2 uuid := tests.character(ann, 'Lg Ann Two', 'beta', now() - interval '60 days');
  b1 uuid := tests.character(bob, 'Lg Bob One', 'alpha', now() - interval '60 days');
  base timestamptz := now() - interval '10 days';
  t uuid := tests.thread('Lg thread');
  th_turns uuid := tests.thread('Lg turns');
  p1 uuid; p2 uuid; y uuid; w uuid; set_act uuid; z uuid; sp uuid; k uuid; c1 uuid; b_on_p1 uuid; infr_act uuid; ban_act uuid; turn_act uuid;
  s1 bigint; s2 bigint; l1 bigint; l2 bigint; lb bigint;
  i integer;
  doc jsonb;
  later jsonb;
  cut timestamptz;
  why text;
  want jsonb;
  ids text[];
begin
  insert into auth.users (id, email) values (nobody, 'lg-nobody@test.invalid');
  insert into wallets (account, balance) values (ann, 100) on conflict (account) do nothing;
  p1 := tests.post(a1, t, 'Ann post.', base);
  p2 := tests.post(b1, t, 'Bob post.', base + interval '1 minute');
  y := tests.post(b1, t, 'Y.', base + interval '2 minutes');
  w := tests.post(b1, t, 'W.', base + interval '2 minutes 30 seconds');
  -- A chain: a card (a share's Act, K) carries the spring it came from (SP); the spring is of a card set face down on Y and caught the card Z, which landed on W.
  -- Depth zero is K; one is the post K landed on (P2) and the spring; two is the spring's post (Y) and what it caught (Z); W is a third round and is not read.
  set_act := tests.act(b1, 'set', t, '{}', y, base + interval '3 minutes');
  z := tests.act(a1, 'card', t, '{"card": "splat"}', w, base + interval '3 minutes 30 seconds');
  sp := tests.act(b1, 'spring', t, jsonb_build_object('card', 'blot', 'trigger', 'reply', 'outcome', '{}'::jsonb, 'set', set_act, 'caught', z), y, base + interval '4 minutes');
  k := tests.act(b1, 'card', t, jsonb_build_object('card', 'splat', 'spring', sp), p2, base + interval '5 minutes');
  -- A card of Ann's on Bob's post, in her card ledger; a card of Bob's on Ann's post, saved.
  c1 := tests.act(a1, 'card', t, '{"card": "blot"}', p2, base + interval '6 minutes');
  b_on_p1 := tests.act(b1, 'card', t, '{"card": "splat"}', p1, base + interval '7 minutes');
  insert into card_ledger (account, card, kind, act, price, at) values (ann, 'blot', 'played', c1, 10, base + interval '6 minutes'), (ann, 'sweetie', 'bought', null, 5, base + interval '8 minutes');
  insert into effect_state (play, state, saved_by, saved_at) values (b_on_p1, '{"scrub": 3}', a1, base + interval '9 minutes');
  -- Two settlements, with lines for Ann and one for Bob, and shares on Ann's.
  insert into settlements (starts_at, ends_at, season, applied_at) values (base - interval '3 days', base - interval '2 days', (select min(id) from seasons), base - interval '2 days') returning id into s1;
  insert into settlements (starts_at, ends_at, season, applied_at) values (base - interval '2 days', base - interval '1 day', (select min(id) from seasons), base - interval '1 day') returning id into s2;
  insert into ledger (settlement, account, character, reason, amount) values (s1, ann, a1, 'post.reacted', 120) returning id into l1;
  insert into ledger (settlement, account, character, reason, amount) values (s2, ann, a2, 'post.quoted', 30) returning id into l2;
  insert into ledger (settlement, account, character, reason, amount) values (s2, bob, b1, 'post.reacted', 50) returning id into lb;
  insert into ledger_shares (ledger, act, quadrant, amount) values (l1, p1, 'excitedPositive', 100), (l1, k, 'calmPositive', 20), (l2, p1, null, 30), (lb, p2, null, 50);
  -- Wallet: a bribe naming Q's cousin, and more events than a page holds.
  insert into wallet_events (account, settlement, kind, change, balance_after, ref, at) values (ann, null, 'bribe', -5, 95, p2, base + interval '10 minutes');
  for i in 1..205 loop
    insert into wallet_events (account, settlement, kind, change, balance_after, at) values (ann, null, 'refund', 1, 100, base + interval '1 hour' + i * interval '1 second');
  end loop;
  insert into wallet_events (account, settlement, kind, change, balance_after, at) values (bob, null, 'refund', 9, 9, base + interval '1 hour');
  -- An infraction and a ban on Ann's, one of Bob's.
  perform set_config('kayfabb.warn_writer', 'on', true);
  infr_act := tests.act(null::uuid, 'infraction', t, jsonb_build_object('character', a1, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', (select board from threads where id = t), 'about_act', p1, 'visit_act', null, 'staff', 'lg-mod', 'expires_at', (base + interval '14 days')::text), null, base + interval '12 minutes');
  ban_act := tests.act(null::uuid, 'ban', t, jsonb_build_object('character', a1, 'days', 3, 'until', (base + interval '3 days')::text, 'infraction_act', infr_act, 'season', 1), null, base + interval '13 minutes');
  perform tests.act(null::uuid, 'infraction', t, jsonb_build_object('character', b1, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', (select board from threads where id = t), 'about_act', p2, 'visit_act', null, 'staff', 'lg-mod', 'expires_at', (base + interval '14 days')::text), null, base + interval '14 minutes');
  perform set_config('kayfabb.warn_writer', 'off', true);
  -- A Turn Ann's character announced when it took its class: a line the log names.
  turn_act := (write_announce(a1, th_turns, 'turn', 'alpha', null, (select started_at from class_history where character = a1 limit 1)) ->> 'id')::uuid;

  perform tests.become(ann);
  doc := log_page(null);

  -- ---- The thirteen sources: each its view's rows, newest first, at most 200, the same columns ----
  if doc -> 'sources' -> 'ledger' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select settlement, starts_at, ends_at, character, reason, amount, shares_kept, params from my_ledger order by ends_at desc, settlement, character, reason limit 200) r))
     or jsonb_array_length(doc -> 'sources' -> 'ledger') is distinct from 2 then raise exception 'ledger: %', doc -> 'sources' -> 'ledger'; end if;
  if doc -> 'sources' -> 'wallet' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select settlement, kind, change, overflow, floored, balance_after, ref, at from my_wallet_events order by at desc, settlement, kind, ref, change, overflow, floored, balance_after limit 200) r))
     or jsonb_array_length(doc -> 'sources' -> 'wallet') is distinct from 200 then raise exception 'wallet: % rows', jsonb_array_length(doc -> 'sources' -> 'wallet'); end if;
  if doc -> 'sources' -> 'cards' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select card, kind, act, price, at, springs from my_card_ledger order by at desc, card, kind, act, price limit 200) r))
     or jsonb_array_length(doc -> 'sources' -> 'cards') is distinct from 2 then raise exception 'cards: %', doc -> 'sources' -> 'cards'; end if;
  if doc -> 'sources' -> 'playsOnMine' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select play, post, at, reach, target_name, target_character from my_posts_played_on order by at desc, play limit 200) r))
     or jsonb_array_length(doc -> 'sources' -> 'playsOnMine') is distinct from 1 then raise exception 'playsOnMine: %', doc -> 'sources' -> 'playsOnMine'; end if;
  if doc -> 'sources' -> 'saves' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select play, post, saved_at from my_posts_played_on where saved_at is not null order by saved_at desc, play limit 200) r))
     or jsonb_array_length(doc -> 'sources' -> 'saves') is distinct from 1 then raise exception 'saves: %', doc -> 'sources' -> 'saves'; end if;
  if doc -> 'sources' -> 'setEnds' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select play, card, post, spring, ended_at from my_face_down where ended_at is not null order by ended_at desc, play limit 200) r)) then raise exception 'setEnds: %', doc -> 'sources' -> 'setEnds'; end if;
  if doc -> 'sources' -> 'setPasses' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select play, card, post, ends_at, passed_at from my_face_down where passed_at is not null and spring is null order by passed_at desc, play limit 200) r)) then raise exception 'setPasses: %', doc -> 'sources' -> 'setPasses'; end if;
  if doc -> 'sources' -> 'caught' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select play, card, post, trap, spring, price, bought_price, at from my_caught order by at desc, play limit 200) r)) then raise exception 'caught: %', doc -> 'sources' -> 'caught'; end if;
  if doc -> 'sources' -> 'ended' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select card_end, play, card, at, side, reach, target_name, post_author_name, caster_name, character from my_cards_ended order by at desc, card_end limit 200) r)) then raise exception 'ended: %', doc -> 'sources' -> 'ended'; end if;
  if doc -> 'sources' -> 'infractions' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select infraction, character, at, band, points, rule_number, rule, mod_name, post, post_seq, thread, expires_at, relief, emptied_at from my_infractions order by at desc, infraction limit 200) r))
     or jsonb_array_length(doc -> 'sources' -> 'infractions') is distinct from 1 then raise exception 'infractions: %', doc -> 'sources' -> 'infractions'; end if;
  if doc -> 'sources' -> 'bans' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select ban, character, at, days, until, infraction, rule, thread from my_bans order by at desc, ban limit 200) r))
     or jsonb_array_length(doc -> 'sources' -> 'bans') is distinct from 1 then raise exception 'bans: %', doc -> 'sources' -> 'bans'; end if;
  if doc -> 'sources' -> 'reports' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select report, character, at, post, post_seq, thread, verdict, verdict_at, mod_name, refund from my_reports order by at desc, report limit 200) r)) then raise exception 'reports: %', doc -> 'sources' -> 'reports'; end if;
  if doc -> 'sources' -> 'appeals' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select appeal, character, at, punishment, punishment_kind, post_seq, thread, verdict, ruled_at, points_delta, hearer_name, refund from my_appeals order by at desc, appeal limit 200) r)) then raise exception 'appeals: %', doc -> 'sources' -> 'appeals'; end if;
  if (select count(*) from jsonb_object_keys(doc -> 'sources')) is distinct from 13 then raise exception 'thirteen sources, not %', (select count(*) from jsonb_object_keys(doc -> 'sources')); end if;
  if doc::text like '%' || b1::text || '"%' and exists (select 1 from jsonb_array_elements(doc -> 'sources' -> 'ledger') x where x ->> 'character' = b1::text) then raise exception 'another player''s ledger line is in the page'; end if;
  if exists (select 1 from jsonb_array_elements(doc -> 'sources' -> 'wallet') x where (x ->> 'change')::integer = 9) then raise exception 'another player''s wallet event is in the page'; end if;

  -- ---- The shares of the settlements read, whole ----
  if doc -> 'shares' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select settlement, character, reason, act, quadrant, amount from my_ledger_shares where settlement in (s1, s2) order by settlement desc, character, reason, act, quadrant) r))
     or jsonb_array_length(doc -> 'shares') is distinct from 3 then raise exception 'shares: %', doc -> 'shares'; end if;

  -- ---- What `around` reads for them ----
  -- The Acts the lines name: shares', cards', plays', saves', the bribe's, the Turn's; then two rounds on (the spring and the post, then what it caught and its post), not a third (W).
  ids := (select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(doc -> 'acts') x);
  if ids is distinct from (select array_agg(u.v::text order by u.v::text) from unnest(array[p1, p2, y, k, sp, z, c1, b_on_p1, turn_act]) as u(v)) then
    raise exception 'acts: %', ids;
  end if;
  if doc -> 'acts' is distinct from (select jsonb_agg(to_jsonb(a) order by a.created_at, a.id::text collate "C") from acts_public a where a.id in (p1, p2, y, k, sp, z, c1, b_on_p1, turn_act)) then raise exception 'the acts are the acts_public rows'; end if;
  -- The saved state of the play.
  if doc -> 'states' is distinct from (select jsonb_agg(to_jsonb(e)) from (select play, state, saved_at from effect_state where play = b_on_p1) e) or jsonb_array_length(doc -> 'states') is distinct from 1 then raise exception 'states: %', doc -> 'states'; end if;
  -- The characters named that are not the caller's: Bob's, as the faces carry them; none of her own.
  if doc -> 'people' is distinct from (
      select jsonb_agg(to_jsonb(cp) || jsonb_build_object('profile', (
        select to_jsonb(p) from (
          select r.character, r.title, r.signature, r.avatar_square, r.avatar_portrait, r.square_frame, r.portrait_frame, r.pip_style
          from character_profiles r where r.character = cp.id) p)) order by cp.name)
      from characters_public cp where cp.id = b1) then raise exception 'people: %', doc -> 'people'; end if;
  -- The Turn's thread.
  if doc -> 'threads' is distinct from (select jsonb_agg(to_jsonb(x)) from thread_open x where x.id = th_turns) or jsonb_array_length(doc -> 'threads') is distinct from 1 then raise exception 'threads: %', doc -> 'threads'; end if;
  if doc -> 'boards' is distinct from '[]'::jsonb then raise exception 'boards: %', doc -> 'boards'; end if;
  -- The caller's own characters' standings and announced Turns, and the season.
  if doc -> 'standings' is distinct from (select jsonb_agg(to_jsonb(s2x) order by s2x.character::text collate "C") from (select character, standing from current_standings where character in (select id from my_characters)) s2x)
     or jsonb_array_length(doc -> 'standings') is distinct from 2 then raise exception 'standings: %', doc -> 'standings'; end if;
  if doc -> 'turns' is distinct from (select jsonb_agg(to_jsonb(x) order by x.at, x.act::text collate "C") from (select act, character, at, was from turns_announced where character in (select id from my_characters)) x)
     or jsonb_array_length(doc -> 'turns') is distinct from 1 then raise exception 'turns: %', doc -> 'turns'; end if;
  if doc -> 'season' is distinct from (select to_jsonb(x) from current_season x) then raise exception 'season: %', doc -> 'season'; end if;
  if doc ? 'estimate' then raise exception 'the estimate is not in it'; end if;

  -- ---- A cursor: rows at or before it ----
  cut := (select ends_at from settlements where id = s1);
  later := log_page(cut);
  if jsonb_array_length(later -> 'sources' -> 'ledger') is distinct from 1 or later -> 'sources' -> 'ledger' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select settlement, starts_at, ends_at, character, reason, amount, shares_kept, params from my_ledger where ends_at <= cut order by ends_at desc, settlement, character, reason limit 200) r)) then
    raise exception 'ledger before the cursor: %', later -> 'sources' -> 'ledger';
  end if;
  if later -> 'shares' is distinct from pg_temp.arr((select jsonb_agg(to_jsonb(r)) from (
       select settlement, character, reason, act, quadrant, amount from my_ledger_shares where settlement = s1 order by settlement desc, character, reason, act, quadrant) r)) then raise exception 'shares before the cursor: %', later -> 'shares'; end if;
  if jsonb_array_length(later -> 'sources' -> 'wallet') is distinct from 0 or jsonb_array_length(later -> 'sources' -> 'cards') is distinct from 0 then raise exception 'nothing else is that old'; end if;
  perform tests.unbecome();

  -- ---- Bob reads his own and none of Ann's ----
  perform tests.become(bob);
  doc := log_page(null);
  if jsonb_array_length(doc -> 'sources' -> 'ledger') is distinct from 1 or doc #>> '{sources,ledger,0,character}' is distinct from b1::text then raise exception 'Bob''s ledger: %', doc -> 'sources' -> 'ledger'; end if;
  if jsonb_array_length(doc -> 'shares') is distinct from 1 or jsonb_array_length(doc -> 'sources' -> 'wallet') is distinct from 1 then raise exception 'Bob''s shares and wallet: %', doc; end if;
  if exists (select 1 from jsonb_array_elements(doc -> 'sources' -> 'infractions') x where x ->> 'character' = a1::text) then raise exception 'Ann''s infraction is in Bob''s page'; end if;
  perform tests.unbecome();

  -- A signed-in caller with nothing: empty sources, no error.
  perform tests.become(nobody);
  doc := log_page(null);
  if (select count(*) from jsonb_object_keys(doc -> 'sources')) is distinct from 13 or exists (select 1 from jsonb_each(doc -> 'sources') e where e.value is distinct from '[]'::jsonb) then raise exception 'a caller with nothing reads thirteen empty sources: %', doc -> 'sources'; end if;
  perform tests.unbecome();

  -- A visitor is refused.
  perform tests.become_anon();
  why := pg_temp.refusal('select log_page(null)');
  perform tests.unbecome();
  if why is null or why not like '42501%' then raise exception 'anon must be refused log_page(), got %', why; end if;
end $$;
