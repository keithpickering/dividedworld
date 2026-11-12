-- A post-local reaction (supabase/migrations/0402_post_reactions.sql; docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 5; engine/rules/emoji.ts). A cast card with `adds_reaction` puts one emoji and the quadrant it
-- scores in on the one post it is cast on, for every player to give: its key is `x-` and the emoji's code points in lower-case hex, kept apart from the instance's own set. The cards are this file's own (pr...).
--
--  1. The catalog of keys: an instance kind may not start with `x-`; post_reaction_kinds is insert-only and readable by a signed-in player; the helpers are for no API role; the key and the base are the engine's.
--  2. The landing: three land on one post and a fourth is refused by the stack; the key and the row a play writes; the refusals (the same emoji twice, an instance emoji with and without U+FE0F or a skin tone, a configuration
--     that is none), each in the engine's words under its SQLSTATE; a retried play writes one row; a face-down one lands on the quoting post with its configuration, and one that cannot land stays set.
--  3. react: a reaction of the local kind is taken, counted in reaction_tallies and sent to settlement and the estimate with its quadrant; the same kind on another post is "there is no reaction"; after an admin's end a new
--     reaction is refused and the old ones still settle; the readers by quadrant (act_window_counts, demand_progress, demand_contributors, system_digest) count it in its own.
--  4. The triggers that replace the dropped foreign keys: a kind that is neither an instance kind nor one of that Act's post-local kinds is refused on reactions and on reaction_tallies.
--  5. A blind post: a post-local kind's tally obeys the policy of every other tally, and react answers no tally for it.
--  6. Two Overreactions of the same emoji at once leave one (a race), and the primary key holds it.

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
  -- Overreaction's shape: a cast on a post that adds a reaction, three at most on a post, no time up. A blind card and a plain Move beside it.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, adds_reaction) values
    ('prover', 'Pr Overreaction', 'salty', 'common', 'cast', '{post}', null, null, 3, true),
    ('prblind', 'Pr Blind Study', 'salty', 'uncommon', 'cast', '{post}', interval '3 days', 'totals', 1, false),
    ('prplain', 'Pr Plain', 'sweet', 'common', 'cast', '{post}', null, null, 3, false)
  on conflict (key) do nothing;
end $$;

-- The config an Overreaction is played with.
create function pg_temp.config(emoji text, quadrant text) returns text language sql as $$
  select jsonb_build_object('emoji', emoji, 'quadrant', quadrant)::text
$$;

-- play_card as the service role, with the card's refusal as `code words`, or null when it landed.
create function pg_temp.cast_(account uuid, card text, caster uuid, post uuid, config text) returns text language plpgsql as $$
declare got text;
begin
  perform tests.become_service();
  got := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', account, card, caster, post, config, ''));
  perform tests.unbecome();
  return got;
end $$;

-- The row a play wrote, as `key emoji quadrant`, for the post (the posts' rows in key order), or an empty string.
create function pg_temp.rows_of(post uuid) returns text language plpgsql as $$
begin
  return (select coalesce(string_agg(k.key || ' ' || k.emoji || ' ' || k.quadrant, ', ' order by k.key), '') from post_reaction_kinds k where k.post = rows_of.post);
end $$;

-- react as a signed-in player: its answer, or `code words`; the reaction is then dated `at` (react writes now()), so that it falls in the window the estimate and the settlement read.
create function pg_temp.reacts(account uuid, as_character uuid, post uuid, kind text, at timestamptz) returns jsonb language plpgsql as $$
declare res jsonb;
begin
  perform tests.become(account);
  begin
    res := react(post, as_character, kind);
  exception when others then
    perform tests.unbecome();
    return to_jsonb(sqlstate || ' ' || sqlerrm);
  end;
  perform tests.unbecome();
  update reactions r set created_at = at where r.act = post and r.reactor_account = account and r.kind = reacts.kind;
  return res;
end $$;

create function pg_temp.table_rows(account uuid, post uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform tests.become(account);
  select count(*)::integer into n from reaction_tallies t where t.act = post;
  perform tests.unbecome();
  return n;
end $$;

-- A staff Boss, The System's Announcements thread and a move written as the tick writes it (as 0051-moves.sql and 0168-blind-totals.sql do), for demand_progress and demand_contributors.
create function pg_temp.boss() returns uuid language plpgsql as $$
declare made uuid;
begin
  select id into made from characters where staff = 'pr-boss';
  if made is null then insert into characters (name, staff, staff_kind, debuted_at) values ('Pr Boss', 'pr-boss', 'persona', now()) returning id into made; end if;
  update seasons set boss = 'pr-boss' where ends_at is null and boss is distinct from 'pr-boss';
  return made;
end $$;
create function pg_temp.announcements() returns uuid language plpgsql as $$
declare made uuid;
begin
  select t.id into made from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Announcements';
  if made is null then insert into threads (board, title) select id, 'Announcements' from boards where is_system returning id into made; end if;
  return made;
end $$;
create function pg_temp.move(on_board uuid, demand jsonb, at timestamptz) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act(pg_temp.boss(), 'move', pg_temp.announcements(),
    jsonb_strip_nulls(jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.',
      'params', jsonb_build_object('board', on_board, 'name', 'Pr Renamed', 'premise', 'The subject of it', 'description', 'About it'),
      'demand', demand, 'expires_at', at + interval '3 days')), null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

-- The window the next estimate reads opens at the last settlement an earlier file left committed, and may be closed by now (its season over), so the world writes its Acts and its reactions an hour past that start.
create function pg_temp.ws() returns timestamptz language sql as $$
  select (estimate_input(tests.account('pr-ws-' || gen_random_uuid()), '3000-01-01') ->> 'windowStart')::timestamptz
$$;

-- The reactions an input holds for an Act, as `kind:quadrant` (the quadrant is empty where the input sent none).
create function pg_temp.sent(input jsonb, post uuid) returns text language sql as $$
  select coalesce(string_agg((e ->> 'kind') || ':' || coalesce(e ->> 'quadrant', ''), ', ' order by e ->> 'kind'), '') from jsonb_array_elements(input -> 'reactions') e where e ->> 'act' = post::text
$$;

-- ---- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing function below) ----
select tests.unbecome();
do $$
begin
  if to_regclass('post_reaction_kinds') is null then raise exception 'post_reaction_kinds exists'; end if;
end $$;

-- ---- 6. Two Overreactions of the same emoji at once leave one (first in the file: the committed rows must not meet this file's own locks, as 0166-post-veils.sql's races do) ----
-- Two casts of the same emoji on one post at once (two sessions, each its own transaction): place_cast takes the post's row first, so they are laid one at a time and the second reads what the first left and is refused
-- in the words of a key the post already holds; the post's primary key is the backstop that holds a key even if one skipped that lock. The rows the racers read are committed (tests.commit), under keys of their own.
select tests.unbecome();
do $$
declare
  u uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); a uuid := gen_random_uuid(); c uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid();
  said text[]; n integer; played uuid;
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'pr-race-author@test.invalid'), (%2$L, 'pr-race-caster@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Pr Race Author', now(), now()), (%4$L, %2$L, 'Pr Race Caster', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into threads (id, board, title) select %5$L, b.id, 'Pr race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%6$L, %3$L, 'post', %5$L, '{"body": "A post two skulls race for."}');
    insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, adds_reaction) values ('prrace', 'Pr Race', 'salty', 'common', 'cast', '{post}', null, 3, true);
    insert into card_ledger (account, card, kind, price) values (%2$L, 'prrace', 'bought', 0), (%2$L, 'prrace', 'bought', 0);
  $sql$, u, u2, a, c, t, p));
  said := tests.race_service(format('select play_card(%L, ''prrace'', %L, %L, %L, 0, '''')', u2, c, p, pg_temp.config('💀', 'excitedNegative')),
                             format('select play_card(%L, ''prrace'', %L, %L, %L, 0, '''')', u2, c, p, pg_temp.config('💀', 'calmPositive')));
  if (said[1] is null) = (said[2] is null) then raise exception 'two casts of one emoji at once: % / % (exactly one is refused)', said[1], said[2]; end if;
  if coalesce(said[1], said[2]) is distinct from 'this post already has that reaction' then raise exception 'the second of two casts of one emoji at once was told: %', coalesce(said[1], said[2]); end if;
  select count(*) into n from post_reaction_kinds k where k.post = p;
  if n is distinct from 1 then raise exception 'two casts of one emoji at once left % rows', n; end if;
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p) is distinct from 1 then raise exception 'two casts of one emoji at once left % card Acts on the post', (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p); end if;
  -- The primary key holds a key whatever wrote it: another play's row of the same key on the post is a unique violation, and so is a second row for the one play.
  select k.play into played from post_reaction_kinds k where k.post = p;
  if pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1f4a9', '💩', 'calmPositive', gen_random_uuid())) not like '23503%' then
    raise exception 'a row for a play that is no Act: %', pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1f4a9', '💩', 'calmPositive', gen_random_uuid())); end if;
  if pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1f480', '💀', 'calmPositive', p)) not like '23505%post_reaction_kinds_pkey%' then
    raise exception 'the primary key did not hold a key: %', pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1f480', '💀', 'calmPositive', p)); end if;
  if pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1fae1', '🫡', 'calmPositive', played)) not like '23505%post_reaction_kinds_play_key%' then
    raise exception 'the play''s uniqueness did not hold: %', pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1fae1', '🫡', 'calmPositive', played)); end if;
  -- The row's own checks: a key that is not hex, an emoji with whitespace, a quadrant that is none.
  if pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-ray', '💀', 'calmPositive', t)) not like '23514%' or
     pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1f480', '💀 💀', 'calmPositive', t)) not like '23514%' or
     pg_temp.coded(format('insert into post_reaction_kinds (post, key, emoji, quadrant, play) values (%L, %L, %L, %L, %L)', p, 'x-1f480', '💀', 'sideways', t)) not like '23514%' then raise exception 'a row''s own check did not hold'; end if;
  -- The race's rows are committed and stay (an Act and a ledger row name the card, and a post's reaction is never deleted); the scratch database is dropped with them.
end $$;

-- ---- 1. The keys ----
select tests.unbecome();
do $$
declare got text; fn text;
begin
  -- An instance kind may not start with `x-`: the check refuses it, and the instance's own keys are untouched.
  got := pg_temp.coded($q$ insert into reaction_kinds (key, emoji, quadrant) values ('x-ray', '🩻', 'calmPositive') $q$);
  if got is null or got not like '23514%reaction_kinds_key_not_local%' then raise exception 'an instance kind keyed x-ray: %', got; end if;
  if exists (select 1 from reaction_kinds k where k.key like 'x-%') then raise exception 'an instance kind starts with x-'; end if;
  -- The key a post-local kind has is the engine's: `x-` and each code point in lower-case hex without leading zeros, joined by hyphens (emoji.ts, localKey).
  if local_reaction_key('💀') is distinct from 'x-1f480' then raise exception 'the key of a skull is %', local_reaction_key('💀'); end if;
  if local_reaction_key(E'#️⃣') is distinct from 'x-23-fe0f-20e3' then raise exception 'the key of a keycap is %', local_reaction_key(E'#️⃣'); end if;
  if local_reaction_key('👍🏽') is distinct from 'x-1f44d-1f3fd' then raise exception 'the key of a thumb with a skin tone is %', local_reaction_key('👍🏽'); end if;
  if local_reaction_key('🇺🇸') is distinct from 'x-1f1fa-1f1f8' then raise exception 'the key of a flag is %', local_reaction_key('🇺🇸'); end if;
  if local_reaction_key('✔') is distinct from 'x-2714' or local_reaction_key('©') is distinct from 'x-a9' then raise exception 'a key keeps no leading zero'; end if;
  -- The base is emojiBase's: without U+FE0F and the skin tones U+1F3FB to U+1F3FF.
  if emoji_base(E'⬆️') is distinct from E'⬆' or emoji_base('👍🏽') is distinct from '👍' or emoji_base('👍🏻') is distinct from '👍' or emoji_base('👍🏿') is distinct from '👍' then raise exception 'the base of an emoji'; end if;
  if emoji_base('💀') is distinct from '💀' or emoji_base(E'👍') is distinct from '👍' then raise exception 'the base of a plain emoji'; end if;
  -- The configuration's emoji is its trimmed `emoji` when that is a string.
  if local_emoji('{"emoji": "  💀 "}'::jsonb) is distinct from '💀' or local_emoji('{"emoji": 5}'::jsonb) is not null or local_emoji('{"emoji": "   "}'::jsonb) is not null or local_emoji('{}'::jsonb) is not null then raise exception 'local_emoji'; end if;
  -- The SQLSTATE of each refusal.
  if land_refusal_code('this post already has that reaction') is distinct from '23505' or land_refusal_code('choose one emoji') is distinct from '22023' or land_refusal_code('this forum already has that reaction') is distinct from '22023'
     or land_refusal_code('choose the quadrant it scores in') is distinct from '22023' or land_refusal_code('that is more than one emoji') is distinct from '22023' or land_refusal_code('a post by the staff keeps its name') is distinct from '42501' then
    raise exception 'land_refusal_code';
  end if;
  -- The table is insert-only, and no API role may run the helpers (the sweep's list is 0167's).
  for fn in select p.oid::regprocedure::text from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('local_emoji', 'local_reaction_key', 'emoji_base', 'reaction_quadrant', 'land_refusal_code', 'reaction_kind_known', 'post_reaction_kinds_append_only')
            and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')) loop
    raise exception '% is granted to an API role', fn;
  end loop;
  if has_table_privilege('anon', 'post_reaction_kinds', 'select') or has_table_privilege('authenticated', 'post_reaction_kinds', 'insert') or has_table_privilege('authenticated', 'post_reaction_kinds', 'update')
     or has_table_privilege('authenticated', 'post_reaction_kinds', 'delete') or not has_table_privilege('authenticated', 'post_reaction_kinds', 'select') then raise exception 'post_reaction_kinds is not readable by a signed-in player alone'; end if;
end $$;

-- ---- 2. The landing ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pr-ann'); bob uuid := tests.account('pr-bob'); cat uuid := tests.account('pr-cat'); adm uuid := tests.account('pr-admin');
  a uuid := tests.character(ann, 'Pr Ann'); b uuid := tests.character(bob, 'Pr Bob'); c uuid := tests.character(cat, 'Pr Cat');
  t uuid := tests.thread('Pr landing');
  p uuid := tests.post(a, t, 'Three land here.'); p2 uuid := tests.post(a, t, 'The same emoji twice.'); p3 uuid := tests.post(a, t, 'An instance emoji.'); p4 uuid := tests.post(a, t, 'A configuration that is none.');
  got text; said text; plays integer; play uuid; before_acts integer;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prover', 'prplain');
  insert into reaction_kinds (key, emoji, quadrant) values ('thumb', '👍', 'excitedPositive');

  -- Three land on one post, each with its own row: the key built from the emoji, the emoji itself (the keycap with its selector, as played), the quadrant it scores in, and the play.
  got := pg_temp.cast_(bob, 'prover', b, p, pg_temp.config('💀', 'excitedNegative'));
  if got is not null then raise exception 'the first Overreaction: %', got; end if;
  got := pg_temp.cast_(bob, 'prover', b, p, pg_temp.config('🫡', 'calmPositive'));
  if got is not null then raise exception 'the second Overreaction: %', got; end if;
  got := pg_temp.cast_(bob, 'prover', b, p, pg_temp.config(E'#️⃣', 'boredNegative'));
  if got is not null then raise exception 'the third Overreaction: %', got; end if;
  if pg_temp.rows_of(p) is distinct from E'x-1f480 💀 excitedNegative, x-1fae1 🫡 calmPositive, x-23-fe0f-20e3 #️⃣ boredNegative' then raise exception 'the three rows of the post: %', pg_temp.rows_of(p); end if;
  select k.play into play from post_reaction_kinds k where k.post = p and k.key = 'x-1f480';
  if (select (a2.kind, a2.target_act_id, a2.payload ->> 'card')::text from acts a2 where a2.id = play) is distinct from format('(card,%s,prover)', p) then raise exception 'the row''s play is not the card Act: %', play; end if;
  -- A fourth, an emoji of its own, is refused by the stack, in the stack's words, and writes nothing.
  before_acts := (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p);
  got := pg_temp.cast_(bob, 'prover', b, p, pg_temp.config('🥲', 'calmPositive'));
  if got is distinct from '23505 this post already carries 3 of that card, the most it takes' then raise exception 'a fourth Overreaction on a post: %', got; end if;
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p) is distinct from before_acts or (select count(*) from post_reaction_kinds k where k.post = p) is distinct from 3 then raise exception 'a refused fourth wrote something'; end if;

  -- The same emoji twice on one post is refused in the words of a key the post already holds, under 23505, and writes nothing.
  got := pg_temp.cast_(bob, 'prover', b, p2, pg_temp.config('💀', 'excitedNegative'));
  if got is not null then raise exception 'a first skull: %', got; end if;
  before_acts := (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p2);
  got := pg_temp.cast_(bob, 'prover', b, p2, pg_temp.config('💀', 'calmPositive'));
  if got is distinct from '23505 this post already has that reaction' then raise exception 'the same emoji twice: %', got; end if;
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p2) is distinct from before_acts or pg_temp.rows_of(p2) is distinct from 'x-1f480 💀 excitedNegative' then raise exception 'a refused repeat wrote something'; end if;
  -- The same emoji on another post is no repeat; the same emoji after its play has ended is one still ("an emoji once added cannot be added again").
  got := pg_temp.cast_(bob, 'prover', b, p3, pg_temp.config('💀', 'excitedNegative'));
  if got is not null then raise exception 'the same emoji on another post: %', got; end if;
  insert into admins (account) values (adm);
  perform tests.become(adm);
  perform reverse_card((select k.play from post_reaction_kinds k where k.post = p3 and k.key = 'x-1f480'));
  perform tests.unbecome();
  got := pg_temp.cast_(bob, 'prover', b, p3, pg_temp.config('💀', 'excitedNegative'));
  if got is distinct from '23505 this post already has that reaction' then raise exception 'the same emoji after its play ended: %', got; end if;

  -- An instance emoji is refused, with and without U+FE0F (the instance's ⬆️ has it) and with a skin tone (the instance's 👍 has none), in the engine's words under 22023.
  foreach got in array array[E'⬆️', E'⬆', '👻', '👍', '👍🏽', '👍🏿', E'👍️'] loop
    before_acts := (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p4);
    plays := (select count(*) from post_reaction_kinds);
    said := pg_temp.cast_(bob, 'prover', b, p4, pg_temp.config(got, 'calmPositive'));
    if said is distinct from '22023 this forum already has that reaction' then raise exception 'an instance emoji % was not refused: %', got, coalesce(said, 'it landed'); end if;
    if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = p4) is distinct from before_acts or (select count(*) from post_reaction_kinds) is distinct from plays then raise exception 'a refused instance emoji wrote something'; end if;
  end loop;

  -- A configuration that is none: no emoji, an emoji that is not a string or is blank or has whitespace inside or is too long for a row (the table's own checks, so a play never fails on one after its Act is written),
  -- and then no quadrant or one that is none; the engine's words, 22023, nothing written.
  foreach got in array array['{}', '{"quadrant": "calmPositive"}', '{"emoji": 5, "quadrant": "calmPositive"}', '{"emoji": "", "quadrant": "calmPositive"}', '{"emoji": "   ", "quadrant": "calmPositive"}',
                             E'{"emoji": "💀 🫡", "quadrant": "calmPositive"}', '{"emoji": "aaaaaaaaaaaaaaaaa", "quadrant": "calmPositive"}'] loop
    said := pg_temp.cast_(bob, 'prover', b, p4, got);
    if said is distinct from '22023 choose one emoji' then raise exception 'a configuration with no emoji, % : %', got, coalesce(said, 'it landed'); end if;
  end loop;
  foreach got in array array['{"emoji": "🫡"}', '{"emoji": "🫡", "quadrant": null}', '{"emoji": "🫡", "quadrant": "sideways"}', '{"emoji": "🫡", "quadrant": 3}'] loop
    said := pg_temp.cast_(bob, 'prover', b, p4, got);
    if said is distinct from '22023 choose the quadrant it scores in' then raise exception 'a configuration with no quadrant, % : %', got, coalesce(said, 'it landed'); end if;
  end loop;
  if pg_temp.rows_of(p4) is distinct from '' or exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = p4) then raise exception 'a refused configuration wrote something'; end if;
  -- The emoji is trimmed as the engine trims it: a play with spaces around it lands under the key of the emoji alone.
  if pg_temp.cast_(bob, 'prover', b, p4, '{"emoji": "  🤌 ", "quadrant": "excitedPositive"}') is not null or pg_temp.rows_of(p4) is distinct from 'x-1f90c 🤌 excitedPositive' then raise exception 'a padded emoji: %', pg_temp.rows_of(p4); end if;
  -- A card that adds no reaction reads none of this: the same configuration is nothing to a plain Move, and a refusal is the card's own to make.
  if land_refusal((select k from card_kinds k where k.key = 'prplain'), p4, '{"emoji": "👍"}') is not null or land_refusal((select k from card_kinds k where k.key = 'prblind'), p4, '{}') is not null then raise exception 'land_refusal refuses a card that adds no reaction'; end if;
  if land_refusal((select k from card_kinds k where k.key = 'prover'), p4, '{"emoji": "🤌", "quadrant": "calmPositive"}') is distinct from 'this post already has that reaction' then raise exception 'land_refusal for a key the post holds'; end if;

  -- A retried play writes one row: land_rows run again for the play (a replay of the write the play's transaction made) leaves the one.
  select k.play into play from post_reaction_kinds k where k.post = p4;
  perform land_rows(play, (select k from card_kinds k where k.key = 'prover'), p4, '{"emoji": "🤌", "quadrant": "excitedPositive"}', b);
  perform land_rows(play, (select k from card_kinds k where k.key = 'prover'), p4, '{"emoji": "🤌", "quadrant": "excitedPositive"}', b);
  if pg_temp.rows_of(p4) is distinct from 'x-1f90c 🤌 excitedPositive' then raise exception 'a replayed land_rows wrote a second row: %', pg_temp.rows_of(p4); end if;
  -- The row is append-only, and a player reads it.
  got := pg_temp.coded(format('update post_reaction_kinds set quadrant = %L where post = %L', 'calmPositive', p4));
  if got is distinct from '55000 a post''s reaction is never edited; it stops being offered when its card ends' then raise exception 'an update of a post''s reaction: %', got; end if;
  got := pg_temp.coded(format('delete from post_reaction_kinds where post = %L', p4));
  if got is distinct from '55000 a post''s reaction is never edited; it stops being offered when its card ends' then raise exception 'a delete of a post''s reaction: %', got; end if;
  perform tests.become(cat);
  if (select count(*) from post_reaction_kinds k where k.post = p) is distinct from 3 then raise exception 'a signed-in player does not read the post''s kinds'; end if;
  perform tests.unbecome();
end $$;

-- ---- 2b. A face-down Overreaction lands on the quoting post with its configuration; one that cannot land stays set ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pr-fann'); cat uuid := tests.account('pr-fcat');
  a uuid := tests.character(ann, 'Pr Fann'); c uuid := tests.character(cat, 'Pr Fcat');
  t uuid := tests.thread('Pr face down');
  held uuid := tests.post(a, t, 'A back lies here.'); held2 uuid := tests.post(a, t, 'Another back lies here.');
  back uuid; back2 uuid; made jsonb; q uuid; q2 uuid; landed uuid; fd face_down%rowtype; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'prover', 'prover');
  perform tests.become_service();
  back := (set_card(ann, 'prover', a, held, pg_temp.config('🤌', 'excitedPositive')::jsonb, 0) ->> 'id')::uuid;
  perform tests.unbecome();
  if exists (select 1 from post_reaction_kinds k where k.post = held) then raise exception 'a card set face down added a reaction before it landed'; end if;
  perform tests.become(cat);
  made := post(t, c, 'Quoting the back.', held);
  perform tests.unbecome();
  q := (made ->> 'id')::uuid;
  select k.play into landed from post_reaction_kinds k where k.post = q;
  if landed is null or pg_temp.rows_of(q) is distinct from 'x-1f90c 🤌 excitedPositive' then raise exception 'the face-down card did not land on the quoting post with its configuration: % (%)', pg_temp.rows_of(q), made; end if;
  if (select k.payload ->> 'spring' from acts k where k.id = landed) is null or (select k.target_act_id from acts k where k.id = landed) is distinct from q then raise exception 'the landed card is not the spring''s'; end if;
  if exists (select 1 from post_reaction_kinds k where k.post = held) then raise exception 'the post that held the back took the reaction'; end if;
  -- A back whose configuration cannot land (an emoji the instance has) does not: spring_facts says why, the spring writes nothing and the back stays set.
  perform tests.become_service();
  back2 := (set_card(ann, 'prover', a, held2, pg_temp.config(E'⬆', 'calmPositive')::jsonb, 0) ->> 'id')::uuid;
  perform tests.unbecome();
  perform tests.become(cat);
  made := post(t, c, 'Quoting the other back.', held2);
  perform tests.unbecome();
  q2 := (made ->> 'id')::uuid;
  select * into fd from face_down f where f.play = back2;
  why := (spring_facts(fd, 'quote', q2, null)).land_why;
  if why is distinct from 'this forum already has that reaction' then raise exception 'spring_facts land_why for a reaction the instance has: %', why; end if;
  if exists (select 1 from post_reaction_kinds k where k.post = q2) or exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = back2::text) or fd.play is null then raise exception 'a back that could not land was spent or landed'; end if;
end $$;

-- ---- 3. react, the settlement and the readers by quadrant ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pr-ra'); bob uuid := tests.account('pr-rb'); cat uuid := tests.account('pr-rc'); dee uuid := tests.account('pr-rd'); eve uuid := tests.account('pr-re'); adm uuid := tests.account('pr-radm');
  a uuid := tests.character(ann, 'Pr Ra'); b uuid := tests.character(bob, 'Pr Rb'); c uuid := tests.character(cat, 'Pr Rc'); d uuid := tests.character(dee, 'Pr Rd'); e uuid := tests.character(eve, 'Pr Re');
  at timestamptz := pg_temp.ws() + interval '1 hour';
  board uuid; t uuid; p uuid; q uuid; mv uuid; mv_pos uuid; res jsonb; play uuid; at_thread jsonb; counts jsonb; since timestamptz := at - interval '1 hour';
  entry jsonb;
begin
  insert into admins (account) values (adm);
  insert into settings (key, value) values ('digestThreads', '20'), ('digestExcerpts', '20'), ('digestExcerptChars', '10') on conflict (key) do update set value = excluded.value;
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard'), ('distinctCharactersOnBoard'), ('quadrantOnBoard'), ('characterPostsInThread'), ('crossQuote') on conflict do nothing;
  insert into boards (slug, name, description) values ('pr-board', 'Pr board', 'x') returning id into board;
  insert into threads (board, title) values (board, 'Pr thread') returning id into t;
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'prover', 'prover');
  p := tests.post(a, t, 'Ann''s post.', at);
  q := tests.post(a, t, 'Ann''s other post.', at);
  mv := pg_temp.move(board, jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', board, 'quadrant', 'excitedNegative', 'count', 100)), at - interval '1 hour');
  if pg_temp.cast_(bob, 'prover', b, p, pg_temp.config('💀', 'excitedNegative')) is not null then raise exception 'the skull on P'; end if;
  play := (select k.play from post_reaction_kinds k where k.post = p);

  -- A reaction of the local kind is taken: the answer holds its tally, the table counts it, and the instance's own kind beside it is as before.
  res := pg_temp.reacts(cat, c, p, 'x-1f480', at);
  if res -> 'tally' is distinct from '{"x-1f480": 1}'::jsonb then raise exception 'react of a post-local kind answered %', res; end if;
  res := pg_temp.reacts(dee, d, p, 'x-1f480', at);
  if res -> 'tally' is distinct from '{"x-1f480": 2}'::jsonb then raise exception 'a second reaction of the post-local kind answered %', res; end if;
  res := pg_temp.reacts(dee, d, p, 'up', at);
  if res -> 'tally' is distinct from '{"up": 1, "x-1f480": 2}'::jsonb then raise exception 'an instance kind beside it answered %', res; end if;
  if (select t2.count from reaction_tallies t2 where t2.act = p and t2.kind = 'x-1f480') is distinct from 2 or (select count(*) from reactions r where r.act = p and r.kind = 'x-1f480') is distinct from 2 then raise exception 'the tally of the post-local kind is not counted'; end if;
  -- The caller's own cap and repeat still hold for it ("you have already left that reaction here" is the same word for every kind).
  res := pg_temp.reacts(cat, c, p, 'x-1f480', at);
  if res is distinct from to_jsonb('23505 you have already left that reaction here'::text) then raise exception 'a repeat of the post-local kind: %', res; end if;
  -- The same kind on another post, one that holds none of its own, or no kind at all, is "there is no reaction".
  res := pg_temp.reacts(cat, c, q, 'x-1f480', at);
  if res is distinct from to_jsonb('22023 there is no reaction "x-1f480"'::text) then raise exception 'the same kind on another post: %', res; end if;
  res := pg_temp.reacts(cat, c, p, 'x-1f4a9', at);
  if res is distinct from to_jsonb('22023 there is no reaction "x-1f4a9"'::text) then raise exception 'a post-local key the post does not hold: %', res; end if;
  res := pg_temp.reacts(cat, c, p, 'x-ray', at);
  if res is distinct from to_jsonb('22023 there is no reaction "x-ray"'::text) then raise exception 'a key that is no one''s: %', res; end if;
  if exists (select 1 from reaction_tallies t2 where t2.act = q) then raise exception 'a refused reaction wrote a tally'; end if;

  -- By quadrant: the settlement and the estimate send the quadrant for the post-local kind and none for an instance kind; the engine reads quadrantOf.get(kind) ?? quadrant.
  if pg_temp.sent(settlement_input(at - interval '30 minutes', at + interval '1 hour'), p) is distinct from 'up:, x-1f480:excitedNegative, x-1f480:excitedNegative' then
    raise exception 'settlement_input sent %', pg_temp.sent(settlement_input(at - interval '30 minutes', at + interval '1 hour'), p); end if;
  if pg_temp.sent(estimate_input(dee, at + interval '1 hour'), p) is distinct from 'up:, x-1f480:excitedNegative, x-1f480:excitedNegative' then raise exception 'estimate_input sent %', pg_temp.sent(estimate_input(dee, at + interval '1 hour'), p); end if;
  -- The readers by quadrant count it in its own: a hint's window counts, a board's demand and who it credits, and the digest's split of a thread.
  counts := act_window_counts(p, since) -> 'counts';
  if counts is distinct from '{"excitedPositive": 1, "excitedNegative": 2, "calmPositive": 0, "boredNegative": 0}'::jsonb then raise exception 'act_window_counts says %', counts; end if;
  if (demand_progress(mv) ->> 'done')::integer is distinct from 2 or not a = any (demand_contributors(mv)) then raise exception 'demand_progress is %, contributors %', demand_progress(mv), demand_contributors(mv); end if;
  mv_pos := pg_temp.move(board, jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', board, 'quadrant', 'excitedPositive', 'count', 100)), at - interval '1 hour');
  if (demand_progress(mv_pos) ->> 'done')::integer is distinct from 1 then raise exception 'demand_progress counted a local kind in the wrong quadrant: %', demand_progress(mv_pos); end if;
  -- The digest's controversy of the thread is 1 - biggest / total over the four quadrants' counts (1 excitedPositive, 2 excitedNegative: 1 - 2/3).
  select x into entry from jsonb_array_elements(system_digest(at - interval '30 minutes', at + interval '1 hour') -> 'threads') x where x ->> 'thread' = t::text;
  if entry is null or (entry ->> 'controversy')::numeric is distinct from 0.3333 then raise exception 'the digest''s controversy of the thread is %', entry; end if;
  -- reaction_quadrant itself: an instance kind's, a post's own kind's, and none for a kind the post does not hold.
  if reaction_quadrant(p, 'up') is distinct from 'excitedPositive' or reaction_quadrant(q, 'up') is distinct from 'excitedPositive' or reaction_quadrant(p, 'x-1f480') is distinct from 'excitedNegative'
     or reaction_quadrant(q, 'x-1f480') is not null or reaction_quadrant(p, 'nothing') is not null then raise exception 'reaction_quadrant'; end if;

  -- After an admin's end a new reaction is refused, in words that say it, and the old ones still settle in their quadrant (the tally stands, the instance's own kinds are as before).
  perform tests.become(adm); perform reverse_card(play); perform tests.unbecome();
  res := pg_temp.reacts(eve, e, p, 'x-1f480', at);
  if res is distinct from to_jsonb('22023 that reaction is no longer offered on this post'::text) then raise exception 'a reaction after the end: %', res; end if;
  if (select t2.count from reaction_tallies t2 where t2.act = p and t2.kind = 'x-1f480') is distinct from 2 then raise exception 'the tally moved after the end'; end if;
  if pg_temp.sent(settlement_input(at - interval '30 minutes', at + interval '1 hour'), p) is distinct from 'up:, x-1f480:excitedNegative, x-1f480:excitedNegative' then raise exception 'the old reactions no longer settle: %', pg_temp.sent(settlement_input(at - interval '30 minutes', at + interval '1 hour'), p); end if;
  if (demand_progress(mv) ->> 'done')::integer is distinct from 2 then raise exception 'demand_progress moved after the end'; end if;
  res := pg_temp.reacts(eve, e, p, 'up', at);
  if res -> 'tally' is distinct from '{"up": 2, "x-1f480": 2}'::jsonb then raise exception 'an instance kind after the end answered %', res; end if;
end $$;

-- ---- 4. The triggers that replace the dropped foreign keys ----
-- A kind that is neither an instance kind nor one of that Act's post-local kinds is refused on each table, by a poisoned insert; the writer that passes is react's, and a row of a kind the Act holds is taken whether or not its play has ended.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pr-ta'); cat uuid := tests.account('pr-tc');
  a uuid := tests.character(ann, 'Pr Ta'); c uuid := tests.character(cat, 'Pr Tc');
  t uuid := tests.thread('Pr triggers');
  p uuid := tests.post(a, t, 'A post.'); q uuid := tests.post(a, t, 'Another post.');
  got text; said text; words text := '23503 reaction kind "%s" is neither one of the instance''s nor one a card added to this post';
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'prover');
  if pg_temp.cast_(ann, 'prover', a, p, pg_temp.config('💀', 'excitedNegative')) is not null then raise exception 'the skull on P'; end if;
  -- Refused: a kind the Act does not hold (the other post's), a made-up one, and a post-local one on an Act that holds none.
  foreach got in array array['x-1f480:' || q::text, 'x-1f4a9:' || p::text, 'nothing:' || p::text, 'x-1f4a9:' || q::text] loop
    said := pg_temp.coded(format('insert into reactions (act, reactor_character, reactor_account, kind, slot) values (%L, %L, %L, %L, 1)', split_part(got, ':', 2), c, cat, split_part(got, ':', 1)));
    if said is distinct from format(words, split_part(got, ':', 1)) then raise exception 'a reaction of kind % on % was taken: %', split_part(got, ':', 1), split_part(got, ':', 2), coalesce(said, 'it was written'); end if;
    said := pg_temp.coded(format('insert into reaction_tallies (act, kind, count) values (%L, %L, 1)', split_part(got, ':', 2), split_part(got, ':', 1)));
    if said is distinct from format(words, split_part(got, ':', 1)) then raise exception 'a tally of kind % on % was taken: %', split_part(got, ':', 1), split_part(got, ':', 2), coalesce(said, 'it was written'); end if;
  end loop;
  if exists (select 1 from reactions r where r.act in (p, q)) or exists (select 1 from reaction_tallies x where x.act in (p, q)) then raise exception 'a refused row was written'; end if;
  -- Taken: an instance kind on any Act, and the post's own kind on the post, live or ended.
  if pg_temp.coded(format('insert into reactions (act, reactor_character, reactor_account, kind, slot) values (%L, %L, %L, %L, 1)', q, c, cat, 'up')) is not null
     or pg_temp.coded(format('insert into reaction_tallies (act, kind, count) values (%L, %L, 1)', q, 'up')) is not null then raise exception 'an instance kind was refused'; end if;
  if pg_temp.coded(format('insert into reactions (act, reactor_character, reactor_account, kind, slot) values (%L, %L, %L, %L, 1)', p, c, cat, 'x-1f480')) is not null
     or pg_temp.coded(format('insert into reaction_tallies (act, kind, count) values (%L, %L, 1)', p, 'x-1f480')) is not null then raise exception 'the post''s own kind was refused'; end if;
end $$;

-- ---- 5. A blind post: a post-local kind's tally obeys the policy of every other tally ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pr-ba'); bob uuid := tests.account('pr-bb'); cat uuid := tests.account('pr-bc'); eve uuid := tests.account('pr-be');
  a uuid := tests.character(ann, 'Pr Ba'); b uuid := tests.character(bob, 'Pr Bb'); c uuid := tests.character(cat, 'Pr Bc'); e uuid := tests.character(eve, 'Pr Be');
  t uuid := tests.thread('Pr blind');
  p uuid := tests.post(a, t, 'A blind post.'); res jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'prover', 'prblind');
  if pg_temp.cast_(bob, 'prover', b, p, pg_temp.config('💀', 'excitedNegative')) is not null then raise exception 'the skull on P'; end if;
  res := pg_temp.reacts(cat, c, p, 'x-1f480', now());
  if res -> 'tally' is distinct from '{"x-1f480": 1}'::jsonb then raise exception 'before the veil, react answered %', res; end if;
  if pg_temp.cast_(bob, 'prblind', b, p, '{}') is not null then raise exception 'the blind card on P'; end if;
  -- While the totals are withheld: react answers no tally for the post-local kind, to anyone; a third player reads no tally row of it, and the author's player and the caster's read it.
  res := pg_temp.reacts(eve, e, p, 'x-1f480', now());
  if jsonb_typeof(res -> 'tally') is distinct from 'null' or res ->> 'act' is distinct from p::text then raise exception 'react on a blind post answered % for the post-local kind', res; end if;
  if pg_temp.table_rows(eve, p) is distinct from 0 or pg_temp.table_rows(cat, p) is distinct from 0 then raise exception 'a third player reads a post-local tally of a blind post'; end if;
  if pg_temp.table_rows(ann, p) is distinct from 1 or pg_temp.table_rows(bob, p) is distinct from 1 then raise exception 'the author''s player and the caster do not read the post-local tally of a blind post'; end if;
end $$;
