-- A spun thread's opening Act is a post for every card (supabase/migrations/0374_cards_on_a_spun_thread.sql; docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md, Task 1, cases C1 to C16;
-- design docs/plans/2026-11-16-cards-on-a-spun-thread-design.md, sections 1 to 3). Each case is played through play_card, set_card, take_back, post or spin as the act function sends it,
-- on S: a spun thread whose opening post (a `spin` Act) Ann's character wrote, with one reply by Bob's character. The cards are this file's own (cs...), never an instance's.
--
-- The same cases as the other side's file; a case added to one is added to both.
-- S is a spun thread whose opening post Ann's character wrote, with one reply by Bob's character. <card> is the card's name.
--
-- | #   | Play                                                                        | Expected                                                             |
-- |-----|-----------------------------------------------------------------------------|----------------------------------------------------------------------|
-- | C1  | a post card cast on the opening post by Bob's character                     | lands                                                                |
-- | C2  | the same card cast there by Ann's character                                 | lands                                                                |
-- | C3  | a post Gimmick used on the opening post by Ann's character                  | lands                                                                |
-- | C4  | the same Gimmick used there by Bob's character                              | "<card> is used on your own post"                                    |
-- | C5  | a card set face down on the opening post by Ann's character                 | lands; a quote of the opening post springs it; a take-back lands     |
-- | C6  | a set by Bob's character on Ann's opening post                              | "a card is set face down on a post of your own character's"          |
-- | C7  | a reply-carrying card cast on the opening post                              | lands; the reply is drawn under the opening post                     |
-- | C8  | a character card cast on Ann's character from the opening post              | lands                                                                |
-- | C9  | a character card on Bob's character from Ann's opening post                 | "a card on a character is played from one of its posts"              |
-- | C10 | a thread Gimmick used on S by Ann's character                               | lands                                                                |
-- | C11 | a thread Gimmick used on S by Bob's character                               | "<card> is used on a thread your own character started"              |
-- | C12 | a thread Move cast on S by Bob's character                                  | lands                                                                |
-- | C13 | a thread Move set face down by Bob's character on his reply, then sprung    | lands on S                                                           |
-- | C14 | a spin from a character card on Ann's character, pressed at the opening post| lands, with its moment                                               |
-- | C15 | any card on an `edit` Act, and on a `card` Act                              | "a card lands on a post"; a set, "a card is set face down on a post" |
-- | C16 | a second play of a stack-1 card on the opening post                         | "this post already carries that card"                                |

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, stack, reaches, replies, lasts, gimmick) values
    ('csp', 'Cs Post', 'sweet', 'common', 'cast', 1, '{post}', false, null, null),
    ('csgimmick', 'Cs Gimmick', 'sweet', 'common', 'use', 1, '{post}', false, interval '7 days', '{"kind": "ward", "flavors": ["pepperoni"]}'),
    ('csthreadgimmick', 'Cs Thread Gimmick', 'sweet', 'common', 'use', 1, '{thread}', false, interval '1 day', '{"kind": "ward", "flavors": ["pepperoni"]}'),
    ('csthreadmove', 'Cs Thread Move', 'salty', 'common', 'cast', 1, '{thread}', false, interval '1 day', null),
    ('cscharacter', 'Cs Character', 'pepperoni', 'uncommon', 'cast', 1, '{character}', false, interval '7 days', null),
    ('csreply', 'Cs Reply', 'pepperoni', 'rare', 'cast', 1, '{post}', true, null, null)
  on conflict (key) do nothing;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

-- The words and the code a refused statement says, or null if it was not refused.
create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm || '|' || sqlstate;
end $$;

-- A spin as `who`, through `through`, from `origin`, at `at_post` (null for none); the Act's id.
create function pg_temp.spun_at(who uuid, through uuid, origin uuid, at_post uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(who);
  made := spin(origin => origin, through => through, title => 'Spun ' || left(gen_random_uuid()::text, 6), body => 'The opening post.', at_post => at_post);
  perform tests.unbecome();
  return (made -> 'act' ->> 'id')::uuid;
end $$;

-- S: Ann's character spins a post of Bob's, so the spun thread's opening Act is Ann's `spin`; Bob's character replies once. Each case builds a world of its own, so the cases share nothing.
create function pg_temp.world() returns jsonb language plpgsql as $$
declare
  tag text := left(gen_random_uuid()::text, 8);
  ann uuid := tests.account('cs-ann-' || tag); bob uuid := tests.account('cs-bob-' || tag); cat uuid := tests.account('cs-cat-' || tag);
  a uuid := tests.character(ann, 'Cs Ann ' || tag); b uuid := tests.character(bob, 'Cs Bob ' || tag); c uuid := tests.character(cat, 'Cs Cat ' || tag);
  origin_thread uuid := tests.thread('Cs origin ' || tag);
  origin_post uuid := tests.post(b, origin_thread, 'The post that is spun.');
  open uuid := pg_temp.spun_at(ann, a, origin_post, null);
  s uuid := (select thread from acts where id = open);
  reply uuid := tests.post(b, s, 'Bob replies.');
begin
  perform pg_temp.cards();
  return jsonb_build_object('ann', ann, 'bob', bob, 'cat', cat, 'a', a, 'b', b, 'c', c, 's', s, 'open', open, 'reply', reply);
end $$;

-- ---- The spin is the opening Act, and only a spin is a post besides a post ----
do $$
declare w jsonb := pg_temp.world();
begin
  if (select kind from acts where id = (w ->> 'open')::uuid) is distinct from 'spin' or (select seq from acts where id = (w ->> 'open')::uuid) is distinct from 1 then
    raise exception 'the fixture is a spun thread whose seq 1 is a spin';
  end if;
  if post_kind('post') is not true or post_kind('spin') is not true then raise exception 'a post and a spin are posts'; end if;
  if post_kind('edit') or post_kind('card') or post_kind('set') or post_kind('spring') or post_kind('take_back') or post_kind('announce') then raise exception 'no other kind is a post'; end if;
  if post_kind(null) is not null then raise exception 'no kind is no answer'; end if;
end $$;

-- C1: a post card cast on the opening post by Bob's character lands.
do $$
declare w jsonb := pg_temp.world(); played jsonb; k acts%rowtype;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csp');
  played := play_card((w ->> 'bob')::uuid, 'csp', (w ->> 'b')::uuid, (w ->> 'open')::uuid, '{}', 0, '');
  select * into k from acts where id = (played ->> 'id')::uuid;
  if k.kind is distinct from 'card' or k.target_act_id is distinct from (w ->> 'open')::uuid or k.thread is distinct from (w ->> 's')::uuid or k.character is distinct from (w ->> 'b')::uuid then
    raise exception 'C1: a cast on the opening post is a card Act on it, in its thread: %', to_jsonb(k);
  end if;
end $$;

-- C2: the same card cast there by Ann's character (the spin's author) lands, its stack allowing.
do $$
declare w jsonb := pg_temp.world(); played jsonb; k acts%rowtype;
begin
  perform pg_temp.hand((w ->> 'ann')::uuid, 'csp');
  played := play_card((w ->> 'ann')::uuid, 'csp', (w ->> 'a')::uuid, (w ->> 'open')::uuid, '{}', 0, '');
  select * into k from acts where id = (played ->> 'id')::uuid;
  if k.kind is distinct from 'card' or k.target_act_id is distinct from (w ->> 'open')::uuid or k.thread is distinct from (w ->> 's')::uuid or k.character is distinct from (w ->> 'a')::uuid then
    raise exception 'C2: the author casts on the opening post: %', to_jsonb(k);
  end if;
end $$;

-- C3: a post Gimmick used on the opening post by Ann's character lands.
do $$
declare w jsonb := pg_temp.world(); played jsonb; k acts%rowtype;
begin
  perform pg_temp.hand((w ->> 'ann')::uuid, 'csgimmick');
  played := play_card((w ->> 'ann')::uuid, 'csgimmick', (w ->> 'a')::uuid, (w ->> 'open')::uuid, '{}', 0, '');
  select * into k from acts where id = (played ->> 'id')::uuid;
  if k.kind is distinct from 'card' or k.target_act_id is distinct from (w ->> 'open')::uuid or k.thread is distinct from (w ->> 's')::uuid then
    raise exception 'C3: a Gimmick on the author''s own opening post: %', to_jsonb(k);
  end if;
end $$;

-- C4: the same Gimmick used there by Bob's character is refused, in the words every post gives.
do $$
declare w jsonb := pg_temp.world(); why text;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csgimmick');
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', w ->> 'bob', 'csgimmick', w ->> 'b', w ->> 'open', '{}', ''));
  if why is distinct from 'Cs Gimmick is used on your own post|42501' then raise exception 'C4: %', why; end if;
  if card_held((w ->> 'bob')::uuid, 'csgimmick') is distinct from 1 then raise exception 'C4: a refused play spent the card'; end if;
end $$;

-- C5: a card set face down on the opening post by Ann's character lands, and a quote of the opening post springs it; a take-back by Ann's character lands too.
do $$
declare
  w jsonb := pg_temp.world(); w2 jsonb := pg_temp.world();
  set_act uuid; quote_post uuid; taken jsonb; set2 uuid;
begin
  perform pg_temp.hand((w ->> 'ann')::uuid, 'csp');
  set_act := (set_card((w ->> 'ann')::uuid, 'csp', (w ->> 'a')::uuid, (w ->> 'open')::uuid, '{}', 0) ->> 'id')::uuid;
  if not exists (select 1 from acts where id = set_act and kind = 'set' and target_act_id = (w ->> 'open')::uuid and thread = (w ->> 's')::uuid) then
    raise exception 'C5: the set Act is on the opening post';
  end if;
  if (select post from face_down where play = set_act) is distinct from (w ->> 'open')::uuid then raise exception 'C5: face_down.post is the opening Act'; end if;
  perform tests.become((w ->> 'bob')::uuid);
  quote_post := ((post((w ->> 's')::uuid, (w ->> 'b')::uuid, 'Quoting the opening post.', (w ->> 'open')::uuid)) -> 'act' ->> 'id')::uuid;
  perform tests.unbecome();
  if not exists (select 1 from acts where kind = 'spring' and target_act_id = (w ->> 'open')::uuid and (payload ->> 'set') = set_act::text and thread = (w ->> 's')::uuid) then
    raise exception 'C5: a quote of the opening post springs the back: %', (select jsonb_agg(to_jsonb(x)) from acts x where x.thread = (w ->> 's')::uuid and x.kind in ('spring', 'card'));
  end if;
  -- A take-back, on another world's opening post.
  perform pg_temp.hand((w2 ->> 'ann')::uuid, 'csp');
  set2 := (set_card((w2 ->> 'ann')::uuid, 'csp', (w2 ->> 'a')::uuid, (w2 ->> 'open')::uuid, '{}', 0) ->> 'id')::uuid;
  taken := take_back((w2 ->> 'ann')::uuid, (w2 ->> 'a')::uuid, set2);
  if not exists (select 1 from acts where id = (taken ->> 'id')::uuid and kind = 'take_back' and target_act_id = (w2 ->> 'open')::uuid and payload = jsonb_build_object('set', set2::text)) then
    raise exception 'C5: the take-back is on the opening post: %', taken;
  end if;
  if card_held((w2 ->> 'ann')::uuid, 'csp') is distinct from 1 then raise exception 'C5: the take-back returns the card'; end if;
end $$;

-- C6: a set by Bob's character on Ann's opening post is refused, as on any post that is not the setter's.
do $$
declare w jsonb := pg_temp.world(); why text;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csp');
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', w ->> 'bob', 'csp', w ->> 'b', w ->> 'open', '{}'));
  if why is distinct from 'a card is set face down on a post of your own character''s|42501' then raise exception 'C6: %', why; end if;
  if exists (select 1 from acts where kind = 'set' and thread = (w ->> 's')::uuid) then raise exception 'C6: a refused set wrote an Act'; end if;
end $$;

-- C7: a reply-carrying card cast on the opening post lands, and the reply is drawn under it while the play is in force.
do $$
declare w jsonb := pg_temp.world(); played jsonb; r uuid;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csreply');
  played := play_card((w ->> 'bob')::uuid, 'csreply', (w ->> 'b')::uuid, (w ->> 'open')::uuid, '{}', 0, '', reply => 'Cutting in under the opening post.');
  if not exists (select 1 from acts where id = (played ->> 'id')::uuid and kind = 'card' and target_act_id = (w ->> 'open')::uuid) then raise exception 'C7: the card Act is on the opening post: %', played; end if;
  r := (select (payload ->> 'reply')::uuid from acts where id = (played ->> 'id')::uuid);
  if (select count(*) from post_under u where u.play = (played ->> 'id')::uuid and u.parent = (w ->> 'open')::uuid and u.reply = r and u.thread = (w ->> 's')::uuid) is distinct from 1::bigint then
    raise exception 'C7: post_under holds the opening Act as the parent and the new post as the reply: %', (select jsonb_agg(to_jsonb(u)) from post_under u);
  end if;
  if (select kind from acts where id = r) is distinct from 'post' or (select thread from acts where id = r) is distinct from (w ->> 's')::uuid then raise exception 'C7: the reply is a post of S'; end if;
end $$;

-- C8: a character card cast on Ann's character from the opening post lands.
do $$
declare w jsonb := pg_temp.world(); played jsonb; k acts%rowtype;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'cscharacter');
  played := play_card((w ->> 'bob')::uuid, 'cscharacter', (w ->> 'b')::uuid, (w ->> 'a')::uuid, '{}', 0, '', 'character', (w ->> 'open')::uuid);
  select * into k from acts where id = (played ->> 'id')::uuid;
  if k.kind is distinct from 'card' or k.target_act_id is distinct from (w ->> 'open')::uuid or k.thread is distinct from (w ->> 's')::uuid then raise exception 'C8: %', to_jsonb(k); end if;
  if not exists (select 1 from play_reach r where r.play = k.id and r.reach = 'character' and r.character = (w ->> 'a')::uuid) then raise exception 'C8: the play reaches Ann''s character'; end if;
end $$;

-- C9: a character card on Bob's character from Ann's opening post is refused.
do $$
declare w jsonb := pg_temp.world(); why text;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'cscharacter');
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', w ->> 'bob', 'cscharacter', w ->> 'b', w ->> 'b', '{}', '', 'character', w ->> 'open'));
  if why is distinct from 'a card on a character is played from one of its posts|22023' then raise exception 'C9: %', why; end if;
end $$;

-- C10: a thread Gimmick used on S by Ann's character lands, on the opening Act, and its play_reach row names the thread.
do $$
declare w jsonb := pg_temp.world(); played jsonb; k acts%rowtype;
begin
  perform pg_temp.hand((w ->> 'ann')::uuid, 'csthreadgimmick');
  played := play_card((w ->> 'ann')::uuid, 'csthreadgimmick', (w ->> 'a')::uuid, (w ->> 's')::uuid, '{}', 0, '', 'thread');
  select * into k from acts where id = (played ->> 'id')::uuid;
  if k.kind is distinct from 'card' or k.target_act_id is distinct from (w ->> 'open')::uuid or k.thread is distinct from (w ->> 's')::uuid then raise exception 'C10: %', to_jsonb(k); end if;
  if (select kind from acts where id = k.target_act_id) is distinct from 'spin' then raise exception 'C10: the card Act points at the opening spin Act'; end if;
  if not exists (select 1 from play_reach r where r.play = k.id and r.reach = 'thread' and r.thread = (w ->> 's')::uuid) then raise exception 'C10: the play_reach row names the thread'; end if;
end $$;

-- C11: a thread Gimmick used on S by Bob's character is refused.
do $$
declare w jsonb := pg_temp.world(); why text;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csthreadgimmick');
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', w ->> 'bob', 'csthreadgimmick', w ->> 'b', w ->> 's', '{}', '', 'thread'));
  if why is distinct from 'Cs Thread Gimmick is used on a thread your own character started|42501' then raise exception 'C11: %', why; end if;
end $$;

-- C12: a thread Move cast on S by Bob's character lands, its play_reach row names the thread, and its Act points at the opening spin Act.
do $$
declare w jsonb := pg_temp.world(); played jsonb; k acts%rowtype;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csthreadmove');
  played := play_card((w ->> 'bob')::uuid, 'csthreadmove', (w ->> 'b')::uuid, (w ->> 's')::uuid, '{}', 0, '', 'thread');
  select * into k from acts where id = (played ->> 'id')::uuid;
  if k.kind is distinct from 'card' or k.target_act_id is distinct from (w ->> 'open')::uuid or k.thread is distinct from (w ->> 's')::uuid then raise exception 'C12: %', to_jsonb(k); end if;
  if (select kind from acts where id = k.target_act_id) is distinct from 'spin' then raise exception 'C12: the card Act points at the opening spin Act'; end if;
  if not exists (select 1 from play_reach r where r.play = k.id and r.reach = 'thread' and r.thread = (w ->> 's')::uuid) then raise exception 'C12: the play_reach row names the thread'; end if;
end $$;

-- C13: a thread Move set face down by Bob's character on his reply in S, then sprung by a quote, lands on S.
do $$
declare w jsonb := pg_temp.world(); set_act uuid;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csthreadmove');
  set_act := (set_card((w ->> 'bob')::uuid, 'csthreadmove', (w ->> 'b')::uuid, (w ->> 'reply')::uuid, '{}', 0) ->> 'id')::uuid;
  perform tests.become((w ->> 'ann')::uuid);
  perform post((w ->> 's')::uuid, (w ->> 'a')::uuid, 'Quoting Bob''s reply.', (w ->> 'reply')::uuid);
  perform tests.unbecome();
  if not exists (select 1 from acts where kind = 'spring' and (payload ->> 'set') = set_act::text) then raise exception 'C13: the quote springs the back'; end if;
  if not exists (select 1 from acts k where k.kind = 'card' and k.payload ->> 'card' = 'csthreadmove' and k.payload ? 'spring' and k.thread = (w ->> 's')::uuid and k.target_act_id = (w ->> 'open')::uuid) then
    raise exception 'C13: the sprung thread Move lands on S: %', (select jsonb_agg(to_jsonb(x)) from acts x where x.thread = (w ->> 's')::uuid and x.kind in ('spring', 'card'));
  end if;
end $$;

-- C14: a spin from a character card on Ann's character, pressed at S's opening post, lands with its moment.
do $$
declare w jsonb := pg_temp.world(); played jsonb; s2 uuid;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'cscharacter');
  played := play_card((w ->> 'bob')::uuid, 'cscharacter', (w ->> 'b')::uuid, (w ->> 'a')::uuid, '{}', 0, '', 'character', (w ->> 'open')::uuid);
  s2 := pg_temp.spun_at((w ->> 'cat')::uuid, (w ->> 'c')::uuid, (played ->> 'id')::uuid, (w ->> 'open')::uuid);
  if (select payload ->> 'at' from acts where id = s2) is distinct from (w ->> 'open') then raise exception 'C14: the spin names the opening post: %', (select payload from acts where id = s2); end if;
  if (select count(*) from spin_moments where spin = s2) is distinct from 1::bigint then raise exception 'C14: a spin pressed at the opening post writes its moment'; end if;
  if (select post_version from spin_moments where spin = s2) is distinct from (w ->> 'open')::uuid then raise exception 'C14: the moment names the opening post: %', (select post_version from spin_moments where spin = s2); end if;
end $$;

-- C15: any card on an edit Act, and on a card Act, is refused in the words it always was.
do $$
declare w jsonb := pg_temp.world(); ed uuid; played jsonb; why text;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csp', 'csp', 'csp');
  ed := tests.act((w ->> 'b')::uuid, 'edit', (w ->> 's')::uuid, '{"body": "Edited."}', (w ->> 'reply')::uuid);
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', w ->> 'bob', 'csp', w ->> 'b', ed, '{}', ''));
  if why is distinct from 'a card lands on a post|22023' then raise exception 'C15: on an edit: %', why; end if;
  played := play_card((w ->> 'bob')::uuid, 'csp', (w ->> 'b')::uuid, (w ->> 'reply')::uuid, '{}', 0, '');
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', w ->> 'bob', 'csp', w ->> 'b', played ->> 'id', '{}', ''));
  if why is distinct from 'a card lands on a post|22023' then raise exception 'C15: on a card Act: %', why; end if;
  -- A card set face down on an edit says its own words.
  why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', w ->> 'bob', 'csp', w ->> 'b', ed, '{}'));
  if why is distinct from 'a card is set face down on a post|22023' then raise exception 'C15: a set on an edit: %', why; end if;
end $$;

-- C16: a second play of a stack-1 card on the opening post is refused.
do $$
declare w jsonb := pg_temp.world(); why text;
begin
  perform pg_temp.hand((w ->> 'bob')::uuid, 'csp', 'csp');
  perform play_card((w ->> 'bob')::uuid, 'csp', (w ->> 'b')::uuid, (w ->> 'open')::uuid, '{}', 0, '');
  why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', w ->> 'bob', 'csp', w ->> 'b', w ->> 'open', '{}', ''));
  if why is distinct from 'this post already carries that card|23505' then raise exception 'C16: %', why; end if;
end $$;

-- ---- post_kind is no visitor's to call ----
-- 0375 grants it to a signed-in player, because thread_page is a security invoker and asks it; supabase/tests/0005-default-deny.sql holds the reason.
do $$
begin
  if has_function_privilege('anon', 'post_kind(text)', 'execute') then raise exception 'post_kind is callable by a visitor'; end if;
end $$;
