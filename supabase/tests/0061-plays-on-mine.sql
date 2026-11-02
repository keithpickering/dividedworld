-- my_posts_played_on beyond a post (supabase/migrations/0056_plays_on_mine.sql): the plays on anything of the caller's. A character
-- play lands on the player of that character, a thread play on the player who started the thread, each carrying its reach and the
-- target's public name; a board has no owner, so a board play is no one's row; a play by the caller's own masks is not a row, and
-- another account reads none of them. docs/plans/2026-11-02-alerts-plan.md, Task 1. The cards are the engine's test set.

create function pg_temp.cards() returns void language plpgsql as $$
begin
  update settings set value = value || '{"glint.price": 100, "marquee.price": 100, "quake.price": 100}' where key = 'economy';
  insert into card_kinds (key, name, alignment, price_setting, rarity, play, reaches, lasts) values
    ('glint', 'Glint', 'pepperoni', 'glint.price', 'uncommon', 'cast', '{character}', interval '7 days'),
    ('marquee', 'Marquee', 'sweet', 'marquee.price', 'rare', 'cast', '{thread}', interval '1 day'),
    ('quake', 'Quake', 'salty', 'quake.price', 'legendary', 'cast', '{board}', interval '1 day')
  on conflict (key) do nothing;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

do $$
declare
  ann uuid := tests.account('pom-ann'); bob uuid := tests.account('pom-bob'); cat uuid := tests.account('pom-cat');
  pipe uuid := tests.character(ann, 'Pom Pipe'); pipe2 uuid := tests.character(ann, 'Pom Pipe Two');
  hoo uuid := tests.character(bob, 'Pom Hoo'); kit uuid := tests.character(cat, 'Pom Kit');
  t uuid := tests.thread('Pom Thwomp'); mine_t uuid := tests.thread('Pom Pipe''s thread');
  hoo_post uuid; pipe_post uuid; pipe2_post uuid; own_post uuid;
  nameless uuid; on_hoo uuid; on_thread uuid; on_board uuid; on_post uuid; by_hoo uuid; own_play uuid;
  brd uuid; r record;
begin
  perform pg_temp.cards();
  insert into settings (key, value) select 'systemAnnouncements', to_jsonb(x.id::text)
    from (select id from threads where board = (select id from boards where slug = 'the-system') limit 1) x on conflict (key) do nothing;
  if not exists (select 1 from settings where key = 'systemAnnouncements') then
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(tests.thread('Pom Announcements')::text);
  end if;
  hoo_post := tests.post(hoo, t, 'Hoo starts it.');
  pipe_post := tests.post(pipe, t, 'Pipe replies.');
  pipe2_post := tests.post(pipe2, t, 'Pipe Two replies.');
  own_post := tests.post(pipe, mine_t, 'Pipe starts one.');
  insert into boards (slug, name) values ('pom-board', 'Pom Board') returning id into brd;
  perform pg_temp.hand(ann, 'glint', 'marquee', 'quake', 'glint');
  perform pg_temp.hand(bob, 'glint', 'marquee');

  -- Ann's Pipe plays on Hoo (a character), on Hoo's thread, on a board, and a card on Hoo's post. Ann's two masks play on Ann's own.
  on_hoo := (play_card(ann, 'glint', pipe, hoo, '{}', 0, 'Sparkle.', 'character', hoo_post) ->> 'id')::uuid;
  on_thread := (play_card(ann, 'marquee', pipe, t, '{}', 0, '', 'thread') ->> 'id')::uuid;
  on_board := (play_card(ann, 'quake', pipe, brd, '{}', 0, '', 'board') ->> 'id')::uuid;
  own_play := (play_card(ann, 'glint', pipe, pipe2, '{}', 0, '', 'character', pipe2_post) ->> 'id')::uuid;
  -- Bob's Hoo plays on Pipe: Ann's.
  by_hoo := (play_card(bob, 'glint', hoo, pipe, '{}', 0, '', 'character', pipe_post) ->> 'id')::uuid;
  -- Ann's mask plays on a thread Ann's other mask started: hers already.
  perform pg_temp.hand(ann, 'marquee');
  perform play_card(ann, 'marquee', pipe2, mine_t, '{}', 0, '', 'thread');

  -- The play's Act carries the target's public name as it was when the card was played, so a later rename changes no line.
  if (select payload ->> 'targetName' from acts where id = on_hoo) is distinct from 'Pom Hoo' then raise exception 'a character play carries the name: %', (select payload from acts where id = on_hoo); end if;
  if (select payload ->> 'targetName' from acts where id = on_thread) is distinct from 'Pom Thwomp' then raise exception 'a thread play carries the title'; end if;
  if (select payload ->> 'targetName' from acts where id = on_board) is distinct from 'Pom Board' then raise exception 'a board play carries the board''s name: %', (select payload from acts where id = on_board); end if;
  if (select payload ->> 'targetName' from acts where id = on_board) is distinct from (select name from boards_now where id = brd) then raise exception 'the name is the one boards_now gives'; end if;
  update boards set name = 'Pom Board Renamed' where id = brd;
  update threads set title = 'Pom Thwomp Renamed' where id = t;
  update characters set name = 'Pom Hoo Renamed' where id = hoo;
  if (select payload ->> 'targetName' from acts where id = on_board) is distinct from 'Pom Board' then raise exception 'renaming the board changes no play'; end if;
  -- A play written without a name (before 0056) reads the target as it stands.
  insert into acts (character, kind, thread, target_act_id, payload)
  values (pipe, 'card', t, hoo_post, jsonb_build_object('card', 'glint', 'reach', 'character', 'character', hoo, 'ends', now() + interval '1 day')) returning id into nameless;
  insert into play_reach (play, reach, character, ends_at) values (nameless, 'character', hoo, now() + interval '1 day');

  -- Bob reads the plays on his Hoo and on the thread Hoo started, with their reach and their public names.
  perform tests.become(bob);
  select * into r from my_posts_played_on where play = on_hoo;
  if r.play is null then raise exception 'a play on Bob''s character is a row of his: %', (select jsonb_agg(to_jsonb(x)) from my_posts_played_on x); end if;
  if r.target_character is distinct from hoo then raise exception 'a character play is about the character it landed on: %', to_jsonb(r); end if;
  if r.reach is distinct from 'character' or r.target_name is distinct from 'Pom Hoo' or r.post is distinct from hoo_post then
    raise exception 'a character play carries its reach and the character''s name: %', to_jsonb(r);
  end if;
  select * into r from my_posts_played_on where play = on_thread;
  if r.play is null then raise exception 'a play on the thread Bob''s mask started is a row of his'; end if;
  if r.target_character is distinct from hoo then raise exception 'a thread play is about the character that started the thread: %', to_jsonb(r); end if;
  if r.reach is distinct from 'thread' or r.target_name is distinct from 'Pom Thwomp' then
    raise exception 'a thread play carries its reach and the thread''s title: %', to_jsonb(r);
  end if;
  select * into r from my_posts_played_on where play = nameless;
  if r.target_name is distinct from 'Pom Hoo Renamed' then raise exception 'a play with no name reads the character as it stands: %', to_jsonb(r); end if;
  if exists (select 1 from my_posts_played_on where play = on_board) then raise exception 'a board has no owner: its play is no one''s row'; end if;
  if exists (select 1 from my_posts_played_on where play = by_hoo) then raise exception 'a play by Bob''s own mask is not a row of his'; end if;
  if (select count(*) from my_posts_played_on) is distinct from 3::bigint then
    raise exception 'Bob reads the three plays on his, read %', (select jsonb_agg(to_jsonb(x)) from my_posts_played_on x);
  end if;
  perform tests.unbecome();

  -- Ann reads the play on her Pipe, and none of the plays her own masks made.
  perform tests.become(ann);
  select * into r from my_posts_played_on where play = by_hoo;
  if r.reach is distinct from 'character' or r.target_name is distinct from 'Pom Pipe' then raise exception 'Ann reads the play on her Pipe: %', to_jsonb(r); end if;
  if (select count(*) from my_posts_played_on) is distinct from 1::bigint then
    raise exception 'Ann reads the one play another player made on hers, read %', (select jsonb_agg(to_jsonb(x)) from my_posts_played_on x);
  end if;
  perform tests.unbecome();

  -- Another account reads none of them.
  perform tests.become(cat);
  if exists (select 1 from my_posts_played_on) then raise exception 'Cat reads none of them: %', (select jsonb_agg(to_jsonb(x)) from my_posts_played_on x); end if;
  perform tests.unbecome();
end $$;

-- ---- A play on a post still reads as a post's, with its reach, and no name of the target ----
do $$
declare
  ann uuid := tests.account('pom2-ann'); bob uuid := tests.account('pom2-bob');
  pipe uuid := tests.character(ann, 'Pom2 Pipe'); hoo uuid := tests.character(bob, 'Pom2 Hoo');
  t uuid := tests.thread('Pom2'); p uuid; k uuid; r record;
begin
  p := tests.post(hoo, t, 'Splat me.');
  perform pg_temp.hand(ann, 'sweetie');
  k := (play_card(ann, 'sweetie', pipe, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.become(bob);
  select * into r from my_posts_played_on where play = k;
  if r.play is null or r.reach is distinct from 'post' or r.post is distinct from p then raise exception 'a post play reads as it did, with its reach: %', to_jsonb(r); end if;
  perform tests.unbecome();
end $$;
