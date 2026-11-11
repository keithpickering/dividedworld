-- thread_page (supabase/migrations/0094_thread_page.sql; the forum-load plan, Task 4): a thread's page in one read. A thread of 45 posts, with a
-- play, a set, a reaction and a spin on page 2. As a player, with per_page 20: page 2 holds seq 21 to 40; a per_page of 500 (or 0) is refused and none is the instance's setting;
-- in_seq 42 lands on page 3; in_page 9 clamps to 3; each piece equals the matching view read made directly here (the same rows, by id); mine holds
-- only the caller's reactions and faces only the caller's sets; a missing thread is null; anon is refused. The guard
-- (supabase/tests/e2e/0016-screen-reads.ts) holds what it may read.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;
-- A refusal in full: its state, its hint and its words.
create function pg_temp.refusal_full(stmt text) returns text language plpgsql as $$
declare h text; m text; s text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint, m = message_text;
  return sqlstate || '|' || coalesce(h, '') || '|' || m;
end $$;

do $$
declare
  ann uuid := tests.account('tp-ann');
  bob uuid := tests.account('tp-bob');
  a1 uuid := tests.character(ann, 'Page One');
  a2 uuid := tests.character(bob, 'Page Two');
  t uuid := tests.thread('Forty-five');
  spin uuid;
  posts uuid[] := '{}';
  splat_play uuid;
  setter uuid;
  p_ uuid;
  r jsonb;
  r2 jsonb;
  capped uuid[] := '{}';
  above_play uuid;
  reveal uuid;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, gimmick, lasts) values ('tp-bluff', 'Bluff', 'pepperoni', 'common', 'set', null, null, null);
  insert into card_ledger (account, card, kind, price) values (ann, 'tp-bluff', 'bought', 0);

  for i in 1..45 loop
    posts := posts || tests.post(case when i % 2 = 0 then a2 else a1 end, t, 'Post ' || i);
  end loop;
  -- On page 2: a play on seq 25 (a card layer, which takes no seq), a set on the same post (Ann's own), a spin from seq 27.
  splat_play := tests.act(a2, 'card', t, '{"card": "splat", "config": {"color": "red"}}', posts[25]);
  setter := (set_card(ann, 'tp-bluff', a1, posts[25], '{}', 0) ->> 'id')::uuid;
  spin := tests.thread('Spun from 27');
  update threads set origin_act_id = posts[27] where id = spin;
  -- Ten layers on seq 30, oldest first: only the first eight are a post's plays. And a live play on the whole thread, which sits above every post.
  for i in 1..10 loop
    p_ := tests.act(a2, 'card', t, '{"card": "splat", "config": {"color": "blue"}}', posts[30], now() - interval '1 day' + i * interval '1 minute');
    if i <= 8 then capped := capped || p_; end if;
  end loop;
  above_play := tests.act(a2, 'card', t, jsonb_build_object('card', 'splat', 'reach', 'thread', 'thread', t, 'ends', now() + interval '1 day'), posts[1]);
  insert into play_reach (play, reach, thread, ends_at) values (above_play, 'thread', t, now() + interval '1 day');
  -- A play's saved state and the reader's release; a class reveal of Ann's, in a thread of its own.
  insert into effect_state (play, state, saved_by, saved_at) values (splat_play, '{"x": 1}', a2, now());
  insert into effect_releases (account, play) values (ann, splat_play);
  reveal := tests.act(a1, 'unmask', tests.thread('Reveals'), '{"class": "alpha", "message": "", "via": "act"}');
  -- Reactions: Ann's on seq 22 and on the play, Bob's on seq 21.
  perform tests.become(ann); perform react(posts[22], a1, 'up'); perform react(splat_play, a1, 'up'); perform mark_read(t, 33, a1); perform tests.unbecome();
  perform tests.become(bob); perform react(posts[21], a2, 'up'); perform tests.unbecome();

  -- Ann, page 2 of 20.
  perform tests.become(ann);
  r := thread_page(t, 2, null, 20, array['splat']);
  if (r -> 'page') is distinct from '2'::jsonb then raise exception 'page: %', r -> 'page'; end if;
  if (select array_agg((a ->> 'seq')::integer order by (a ->> 'seq')::integer) from jsonb_array_elements(r -> 'acts') a) is distinct from (select array_agg(g) from generate_series(21, 40) g) then
    raise exception 'page 2 acts are not seq 21 to 40'; end if;
  if (r -> 'summary') is distinct from (select to_jsonb(o) from thread_open o where o.id = t) then raise exception 'the summary is not the thread_open row'; end if;

  -- Each piece against the direct read.
  if (r -> 'acts') is distinct from (select jsonb_agg(to_jsonb(a) order by a.seq) from acts_public a where a.thread = t and a.seq between 21 and 40 and a.kind not in ('edit', 'card')) then
    raise exception 'acts differ from acts_public'; end if;
  if (r -> 'plays') is distinct from (select jsonb_agg(to_jsonb(a) order by a.created_at, a.id) from acts_public a where a.id = any (array[splat_play, setter] || capped)) or jsonb_array_length(r -> 'plays') is distinct from 10 then
    raise exception 'plays differ from acts_public: %', r -> 'plays'; end if;
  if jsonb_array_length(r -> 'above') is distinct from 1 or (r -> 'above' -> 0 ->> 'play')::uuid is distinct from above_play then raise exception 'above: %', r -> 'above'; end if;
  if (r -> 'above') is distinct from (select coalesce(jsonb_agg(jsonb_build_object('play', x.play, 'reach', x.reach, 'target', x.target, 'ends_at', x.ends_at, 'act', x.act)), '[]'::jsonb)
                                     from effects_above((select array_agg(distinct a.character) from acts_public a where a.thread = t and a.seq between 21 and 40 and a.kind = 'post'), t, (select board from threads where id = t)) x) then
    raise exception 'above differs from effects_above'; end if;
  if (select jsonb_agg(x order by x ->> 'act', x ->> 'kind') from jsonb_array_elements(r -> 'tallies') x)
     is distinct from (select jsonb_agg(jsonb_build_object('act', x.act, 'kind', x.kind, 'count', x.count) order by x.act::text, x.kind) from reaction_tallies x
                       where x.act in (select (a ->> 'id')::uuid from jsonb_array_elements(r -> 'acts') a) or x.act = any (array[splat_play, setter] || capped || above_play)) then
    raise exception 'tallies: %', r -> 'tallies'; end if;
  if (select (x ->> 'count')::integer from jsonb_array_elements(r -> 'tallies') x where (x ->> 'act')::uuid = posts[22]) is distinct from 1 then raise exception 'the tally of seq 22'; end if;
  -- mine: only Ann's two.
  if (select array_agg(x ->> 'act' order by x ->> 'act') from jsonb_array_elements(r -> 'mine') x) is distinct from (select array_agg(m.act::text order by m.act::text) from my_reactions m)
     or jsonb_array_length(r -> 'mine') is distinct from 2 then raise exception 'mine: %', r -> 'mine'; end if;
  -- faces: Ann's set.
  if (r -> 'faces') is distinct from jsonb_build_array(jsonb_build_object('play', setter, 'card', 'tp-bluff')) then raise exception 'faces: %', r -> 'faces'; end if;
  -- spun.
  if (r -> 'spun') is distinct from (select jsonb_agg(to_jsonb(l)) from thread_list l where l.origin_act_id = posts[27]) or jsonb_array_length(r -> 'spun') is distinct from 1 then
    raise exception 'spun: %', r -> 'spun'; end if;
  -- people: the page's two authors, with what ensurePeople reads.
  if (select array_agg(x -> 'character' ->> 'id' order by x -> 'character' ->> 'id') from jsonb_array_elements(r -> 'people') x) is distinct from (select array_agg(c::text order by c::text) from unnest(array[a1, a2]) c) then
    raise exception 'people: %', r -> 'people'; end if;
  if (select (x ->> 'posts')::integer from jsonb_array_elements(r -> 'people') x where x -> 'character' ->> 'id' = a1::text) is distinct from (select n.posts::integer from character_post_counts n where n.character = a1) then
    raise exception 'a character''s posts'; end if;
  if (select x -> 'character' ->> 'name' from jsonb_array_elements(r -> 'people') x where x -> 'character' ->> 'id' = a2::text) is distinct from 'Page Two' then raise exception 'a name'; end if;
  -- states and releases: the play's saved state and Ann's release, only for a card asked for.
  if r -> 'states' is distinct from (select jsonb_agg(jsonb_build_object('play', e.play, 'state', e.state, 'saved_at', e.saved_at)) from effect_state e where e.play = splat_play)
     or jsonb_array_length(r -> 'states') is distinct from 1 then raise exception 'states: %', r -> 'states'; end if;
  if r -> 'releases' is distinct from jsonb_build_array(splat_play) then raise exception 'releases: %', r -> 'releases'; end if;
  r2 := thread_page(t, 2, null, 20, '{}');
  if r2 -> 'states' is distinct from '[]'::jsonb or r2 -> 'releases' is distinct from '[]'::jsonb then raise exception 'states or releases without the card: % %', r2 -> 'states', r2 -> 'releases'; end if;
  -- A class reveal in people.reveals (the reveal's character is on the page, but its Act is in another thread).
  if (select jsonb_array_length(x -> 'reveals') from jsonb_array_elements(r -> 'people') x where x -> 'character' ->> 'id' = a1::text) is distinct from 1
     or (select x -> 'reveals' -> 0 ->> 'act' from jsonb_array_elements(r -> 'people') x where x -> 'character' ->> 'id' = a1::text) is distinct from reveal::text then raise exception 'reveals: %', r -> 'people'; end if;
  -- the rest.
  if (r ->> 'reading')::integer is distinct from 33 then raise exception 'reading: %', r -> 'reading'; end if;
  if r -> 'board' ->> 'slug' is distinct from 'general' then raise exception 'board: %', r -> 'board'; end if;
  if (r -> 'following') is distinct from to_jsonb(following_thread(t)) then raise exception 'following'; end if;
  if (r -> 'presence') is distinct from presence_box('thread', t) then raise exception 'presence'; end if;
  if (r -> 'unread') is distinct from to_jsonb(my_alerts_unread()) then raise exception 'unread'; end if;

  -- Landing: in_seq wins over in_page; the page clamps; per_page bounds.
  if (thread_page(t, 1, 42, 20, '{}') ->> 'page')::integer is distinct from 3 then raise exception 'in_seq 42 should land on page 3'; end if;
  if (thread_page(t, 9, null, 20, '{}') ->> 'page')::integer is distinct from 3 then raise exception 'in_page 9 should clamp to 3'; end if;
  if (thread_page(t, 0, null, 20, '{}') ->> 'page')::integer is distinct from 1 then raise exception 'in_page 0 should clamp to 1'; end if;
  if (thread_page(t, null, 999, 20, '{}') ->> 'page')::integer is distinct from 3 then raise exception 'in_seq past the end should clamp to 3'; end if;
  if jsonb_array_length(thread_page(t, 3, null, 20, '{}') -> 'acts') is distinct from 5 then raise exception 'page 3 should hold seq 41 to 45'; end if;
  if jsonb_array_length(thread_page(t, 1, null, 100, '{}') -> 'acts') is distinct from 45 then raise exception 'per_page 100 should hold every Act'; end if;
  if pg_temp.refusal_full(format('select thread_page(%L, 1, null, 500, %L)', t, '{}')) is distinct from '22023|kayfabb.refusal|a page holds 1 to 100 posts' then raise exception 'per_page 500: %', pg_temp.refusal_full(format('select thread_page(%L, 1, null, 500, %L)', t, '{}')); end if;
  if pg_temp.refusal_full(format('select thread_page(%L, 1, null, 0, %L)', t, '{}')) is distinct from '22023|kayfabb.refusal|a page holds 1 to 100 posts' then raise exception 'per_page 0 was not refused'; end if;
  -- No per_page is the instance's own postsPerPage setting, so a first load needs no read to learn it.
  if (select x.settings -> 'postsPerPage' from screen_settings x limit 1) is distinct from '20'::jsonb then raise exception 'the test expects postsPerPage 20'; end if;
  if thread_page(t, 2, null, null, '{}') is distinct from thread_page(t, 2, null, 20, '{}') then raise exception 'a null per_page should be the setting (20)'; end if;
  if (thread_page(t, null, 42, null, '{}') ->> 'page')::integer is distinct from 3 then raise exception 'null per_page, in_seq 42 should land on page 3'; end if;
  if jsonb_array_length(thread_page(t, 3, null, null, '{}') -> 'acts') is distinct from 5 then raise exception 'null per_page, page 3 should hold seq 41 to 45'; end if;
  -- A missing thread is null.
  if thread_page(gen_random_uuid(), 1, null, 20, '{}') is not null then raise exception 'a missing thread should be null'; end if;
  perform tests.unbecome();

  -- Bob sees his own reaction and not Ann's, and not her set's face.
  perform tests.become(bob);
  r := thread_page(t, 2, null, 20, '{}');
  if (select array_agg(x ->> 'character') from jsonb_array_elements(r -> 'mine') x) is distinct from array[a2::text] or jsonb_array_length(r -> 'mine') is distinct from 1 then raise exception 'Bob''s mine: %', r -> 'mine'; end if;
  if r -> 'faces' is distinct from '[]'::jsonb then raise exception 'Bob sees a face: %', r -> 'faces'; end if;
  if r -> 'reading' is distinct from 'null'::jsonb then raise exception 'Bob has read nothing: %', r -> 'reading'; end if;
  perform tests.unbecome();

  -- The page wrote nothing.
  if (select count(*) from presence) is distinct from 0 then raise exception 'thread_page marked a mask present'; end if;

  -- Anon is refused.
  perform tests.become_anon();
  if pg_temp.refusal(format('select thread_page(%L, 1, null, 20, %L)', t, '{}')) is distinct from '42501' then raise exception 'anon reads a thread page'; end if;
  perform tests.unbecome();
end $$;

-- An admin's end of a play on a post (0092's card_end) comes with the page's plays, as cardsOnMany answers it: the client marks a play
-- reversed only from its card_end (engine/ui/cards/plays.ts), so a page without it draws an ended splat over the post's words for every
-- reader. The plays are the page's layers (at most 8 a post) and the card_end of each, and nothing else.
do $$
declare
  admin_acc uuid := tests.account('tp-admin');
  reader uuid := tests.account('tp-reader');
  author uuid := tests.character(tests.account('tp-author'), 'Page Author');
  caster uuid := tests.character(tests.account('tp-caster'), 'Page Caster');
  t uuid := tests.thread('Ended on a post');
  p uuid := tests.post(author, t, 'Words under an ended splat.');
  ended uuid := tests.act(caster, 'card', t, '{"card": "splat"}', p);
  live uuid := tests.act(caster, 'card', t, '{"card": "splat"}', p);
  r jsonb;
begin
  insert into admins (account) values (admin_acc);
  perform tests.become(admin_acc); perform reverse_card(ended); perform tests.unbecome();
  perform tests.become(reader);
  r := thread_page(t, 1, null, 20, array['splat']);
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(r -> 'plays') x where x ->> 'kind' = 'card_end' and (x ->> 'target_act_id')::uuid = ended) then
    raise exception 'thread_page carries no card_end for the reversed play on its post: %', r -> 'plays'; end if;
  if (r -> 'plays') is distinct from (select jsonb_agg(to_jsonb(a) order by a.created_at, a.id) from acts_public a
                                      where a.id in (ended, live) or (a.kind = 'card_end' and a.target_act_id in (ended, live))) then
    raise exception 'plays are not the post''s layers and their ends: %', r -> 'plays'; end if;
end $$;
