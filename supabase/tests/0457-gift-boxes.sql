-- A card wrapped in another, in the database (supabase/migrations/0457_gift_boxes.sql; docs/plans/2026-11-27-season-two-cards-plan.md, Task 5; design docs/plans/2026-11-27-season-two-cards-design.md, sections 1.4, 6 and 9).
-- A wrapper card (card_kinds.wraps), a Move that draws an effect and a Move with a price on a long post, a Use that wards, and the Moves a present may not hold:
--   * the catalog: card_kinds.wraps exists; seed_instance writes it; card_kinds_problem refuses a wrapper that stacks above 1, lasts, reaches beyond a post or is not cast.
--   * every refusal at the wrap, in plain words: no gift, a gift on a plain card, no such gift card, a wrapper as the gift, a Use, a thread-only Move, a card that needs words, a gift not held, a staff post (#1270), a present beyond a post.
--   * the box's Act, its payload and every view another account can read hold no gift key, configuration or price beyond the box's; another account cannot select from gift_box; the giver can; the box's ledger row carries the box's price and the gift's row its own.
--   * only the post's author opens it; the author's open lands the gift as the giver's play and frees the box's slot, even on a one-slot post (F1); a second open is refused; a post's own checks alone decide it (#1264): a giver who is banned, locked out, empty-handed or broke still lands.
--   * a ward on the post at the open returns the gift with the ward's words and gives it back to the giver's hand with a ledger row; a gift a trap catches at the open counts as landed (F8).
--   * an admin's end of an unopened box returns the gift to the giver; an admin's end of an opened one is refused; the open is read as the box's end by post_plays and by no admin-ended feed.
--   * the giver's own post is allowed; self_kinds names open_gift.
-- The cards are this file's own (gb...). The race is 0457-gift-boxes-race.sql.

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 6)
$$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- A wrap as the Edge Function makes it: the box's card, the gift and its extra price, the service role's.
create function pg_temp.wrap(who uuid, through uuid, target uuid, gift text, gift_price integer default 0, out id uuid, out said text) language plpgsql as $$
begin
  -- The giver of most wraps here is Ann: her wallet is topped up to what two plays need, so the wallet's own refusal is asked of Dan alone.
  update wallets set balance = 600 where account = who and balance < 400 and account = (select u.id from auth.users u where u.email = 'gb-ann@test.invalid');
  perform tests.become_service();
  begin
    id := (play_card(who, 'gbbox', through, target, '{}', 150 + gift_price, '', 'post', null, null, null, null, '{}', null, gift, '{}', gift_price) ->> 'id')::uuid;
  exception when others then
    said := sqlstate || ' ' || sqlerrm;
  end;
  perform tests.unbecome();
end $$;

create function pg_temp.opened(who uuid, box uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform tests.become_service();
  r := open_gift(who, box);
  perform tests.unbecome();
  return r;
end $$;

create function pg_temp.open_said(who uuid, box uuid) returns text language plpgsql as $$
declare said text;
begin
  perform tests.become_service();
  said := pg_temp.coded(format('select open_gift(%L, %L)', who, box));
  perform tests.unbecome();
  return said;
end $$;

create function pg_temp.held(who uuid, card text) returns integer language sql as $$ select card_held(who, card) $$;

-- ---- The catalog ----
select tests.unbecome();
do $$
begin
  perform pg_temp.expect(exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'wraps' and is_nullable = 'NO' and column_default = 'false'), 'card_kinds has no wraps boolean not null default false');
  perform pg_temp.expect(exists (select 1 from information_schema.tables where table_name = 'gift_box'), 'there is no gift_box table');
  perform pg_temp.expect(exists (select 1 from pg_proc where proname = 'open_gift'), 'there is no open_gift');
  perform pg_temp.expect('open_gift' = any (self_kinds()), 'open_gift is no self kind');
end $$;

-- ---- card_kinds_problem: the wrapper's rules ----
select tests.unbecome();
do $$
declare
  ok jsonb := '{"key": "gbw", "rarity": "uncommon", "play": "cast", "reaches": ["post"], "wraps": true, "stack": 1}';
begin
  perform pg_temp.expect(card_kinds_problem(jsonb_build_array(ok)) is null, format('a good wrapper is refused: %s', card_kinds_problem(jsonb_build_array(ok))));
  perform pg_temp.expect(card_kinds_problem(jsonb_build_array(ok || '{"wraps": false, "stack": 3, "reaches": ["post", "thread"]}')) is null, 'a card that wraps nothing meets none of the wrapper rules');
  perform pg_temp.expect(card_kinds_problem(jsonb_build_array(ok || '{"stack": 2}')) = 'card "gbw" wraps a card, and a present stacks at most 1', format('stack: %s', card_kinds_problem(jsonb_build_array(ok || '{"stack": 2}'))));
  perform pg_temp.expect(card_kinds_problem(jsonb_build_array(ok || '{"reaches": ["post", "character"]}')) = 'card "gbw" wraps a card, and a card that wraps reaches a post alone', 'reaches');
  perform pg_temp.expect(card_kinds_problem(jsonb_build_array(ok || '{"lasts": {"unit": "day", "count": 1}}')) = 'card "gbw" wraps a card, and a present has no time up: nothing returns the gift from a box that wears off', 'lasts');
  perform pg_temp.expect(card_kinds_problem(jsonb_build_array(ok || '{"play": "use", "gimmick": {"kind": "ward", "upTo": "common"}, "lasts": {"unit": "day", "count": 1}}')) like '%a present is a cast card%', 'play');
  perform pg_temp.expect(card_kinds_problem(jsonb_build_array(ok || '{"wraps": "yes"}')) = 'card "gbw" wraps "yes"; wraps is true or left out', format('a wraps that is not a boolean: %s', card_kinds_problem(jsonb_build_array(ok || '{"wraps": "yes"}'))));
end $$;

-- ---- The fixture ----
create temp table gb_fix (label text primary key, id uuid not null);
create function pg_temp.fix(l text) returns uuid language sql as $$ select id from gb_fix where label = l $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('gb-ann'); bob uuid := tests.account('gb-bob'); cat uuid := tests.account('gb-cat'); boss uuid := tests.account('gb-admin');
  a uuid := tests.character(ann, 'Gb Ann'); b uuid := tests.character(bob, 'Gb Bob'); c uuid := tests.character(cat, 'Gb Cat');
  t uuid := tests.thread('Gb thread'); staff uuid;
begin
  insert into admins (account) values (boss);
  insert into settings (key, value) values ('postEffects', '2') on conflict (key) do update set value = excluded.value;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect, wraps) values
    ('gbbox', 'Gb Present', 'sweet', 'uncommon', 'cast', '{post}', null, 1, true, true),
    ('gbbox2', 'Gb Other Present', 'sweet', 'uncommon', 'cast', '{post}', null, 1, true, true),
    ('gbdraw', 'Gb Draw', 'salty', 'common', 'cast', '{post}', null, 1, true, false),
    ('gbdraw2', 'Gb Draw Two', 'sweet', 'common', 'cast', '{post}', null, 1, true, false),
    ('gblong', 'Gb Long', 'salty', 'common', 'cast', '{post}', null, 2, false, false),
    ('gbplain', 'Gb Plain', 'salty', 'common', 'cast', '{post}', null, 2, false, false);
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect) values
    ('gbthread', 'Gb Thread Only', 'salty', 'common', 'cast', '{thread}', interval '1 day', 1, false);
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect, gimmick) values
    ('gbward', 'Gb Ward', 'sweet', 'uncommon', 'use', '{post}', interval '7 days', 1, false, '{"kind": "ward", "upTo": "uncommon"}'),
    ('gbuse', 'Gb Use', 'sweet', 'uncommon', 'use', '{post}', interval '7 days', 1, false, '{"kind": "ward", "upTo": "common"}');
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack, draws_effect, needs_message) values
    ('gbtalk', 'Gb Talk', 'salty', 'common', 'cast', '{post}', null, 1, false, 'Say something.');
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, draws_effect) values
    ('gbsnare', 'Gb Snare', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, false);
  perform pg_temp.hand(ann, 'gbbox', 'gbbox2', 'gbdraw', 'gblong', 'gbthread', 'gbplain', 'gbward', 'gbuse', 'gbtalk');
  perform pg_temp.hand(bob, 'gbward', 'gbsnare', 'gbbox');
  perform pg_temp.hand(cat, 'gbbox', 'gblong', 'gbdraw2');
  -- A staff character's post: nobody can open a present left there.
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into characters (name, staff, staff_kind, debuted_at) values ('Gb Mod Bot', 'gbmod', 'persona', now()) returning id into staff;
  insert into class_history (character, class_key) values (staff, 'alpha');
  insert into gb_fix values ('ann', ann), ('bob', bob), ('cat', cat), ('boss', boss), ('a', a), ('b', b), ('c', c), ('t', t), ('staff', staff);
  insert into gb_fix select 'staffpost', tests.post(staff, t, 'A staff post.');
  perform set_config('kayfabb.staff_writer', '', true);
  -- Every giver can pay: a wallet the test's prices fit in.
  insert into wallets (account, balance) values (ann, 600), (cat, 600), (bob, 600) on conflict (account) do update set balance = excluded.balance;
end $$;

-- ---- Every refusal at the wrap, in plain words, and nothing changes hands ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t'); staffpost uuid := pg_temp.fix('staffpost');
  p uuid := tests.post(b, t, 'A post to leave presents on.'); r record; said text; before_balance integer := (select balance from wallets where account = ann); before_boxes bigint := (select count(*) from gift_box);
  before_hand integer := pg_temp.held(ann, 'gblong');
begin
  perform tests.become_service();
  said := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 150, %L)', ann, 'gbbox', a, p, '{}', ''));
  perform pg_temp.expect(said = '22023 Gb Present holds a card: choose the card to wrap in it', format('a wrapper with no gift: %s', said));
  said := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, null, null, null, null, %L, null, %L, %L)', ann, 'gbplain', a, p, '{}', '', 'post', '{}', 'gblong', '{}'));
  perform pg_temp.expect(said = '22023 only a present holds a card, and Gb Plain is not one', format('a gift on a plain card: %s', said));
  perform tests.unbecome();
  r := pg_temp.wrap(ann, a, p, 'zzz'); perform pg_temp.expect(r.said = '22023 there is no card "zzz"' or r.said = 'P0002 there is no card "zzz"', format('no such gift card: %s', r.said));
  r := pg_temp.wrap(ann, a, p, 'gbbox2'); perform pg_temp.expect(r.said = '22023 a present can''t hold another present', format('a wrapper as the gift: %s', r.said));
  r := pg_temp.wrap(ann, a, p, 'gbuse'); perform pg_temp.expect(r.said = '22023 a present holds a Move that is cast on a post', format('a Use as the gift: %s', r.said));
  r := pg_temp.wrap(ann, a, p, 'gbthread'); perform pg_temp.expect(r.said = '22023 a present holds a Move that is cast on a post', format('a Move beyond a post as the gift: %s', r.said));
  r := pg_temp.wrap(ann, a, p, 'gbtalk'); perform pg_temp.expect(r.said = '22023 a present can''t hold a card that needs words of its own', format('a gift that needs words: %s', r.said));
  r := pg_temp.wrap(bob, b, p, 'gblong'); perform pg_temp.expect(r.said = 'P0001 you hold no "gblong" card to wrap; the Vending Machine sells them', format('a gift not held: %s', r.said));
  r := pg_temp.wrap(ann, a, staffpost, 'gblong'); perform pg_temp.expect(r.said = '22023 a present is left on a player''s post, since only its author can open it', format('a post no account owns (#1270): %s', r.said));
  perform tests.become_service();
  said := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 150, %L, %L, %L, null, null, null, %L, null, %L, %L)', ann, 'gbbox', a, t, '{}', '', 'thread', null, '{}', 'gblong', '{}'));
  perform tests.unbecome();
  perform pg_temp.expect(said = '22023 a present is left on a post', format('a present beyond a post: %s', said));
  perform tests.become_service();
  said := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 150, %L, %L, null, null, null, null, %L, null, %L, %L, 151)', ann, 'gbbox', a, p, '{}', '', 'post', '{}', 'gblong', '{}'));
  perform tests.unbecome();
  perform pg_temp.expect(said = '22023 a gift''s price is between 0 and what the play costs', format('a gift price beyond the play''s: %s', said));
  perform pg_temp.expect((select balance from wallets where account = ann) = before_balance, 'a refused wrap charged the wallet');
  perform pg_temp.expect((select count(*) from gift_box) = before_boxes, 'a refused wrap wrote a gift_box row');
  perform pg_temp.expect(pg_temp.held(ann, 'gblong') = before_hand and not exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = p), 'a refused wrap changed the hand or wrote an Act');
end $$;

-- ---- The wrap: two cards, the box's price and the gift's, a gift no one else can read ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); c uuid := pg_temp.fix('c'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(b, t, 'A post that gets a present.'); r record; bx uuid; row_text text; seen bigint; payload jsonb;
begin
  insert into gb_fix values ('p', p);
  r := pg_temp.wrap(ann, a, p, 'gblong', 50);
  perform pg_temp.expect(r.said is null, format('the wrap was refused: %s', r.said)); bx := r.id;
  insert into gb_fix values ('box', bx);
  perform pg_temp.expect((select balance from wallets where account = ann) = 400, format('the wallet was not charged the box and the gift together: %s', (select balance from wallets where account = ann)));
  perform pg_temp.expect(pg_temp.held(ann, 'gbbox') = 5 and pg_temp.held(ann, 'gblong') = 5, format('both cards left the hand: %s %s', pg_temp.held(ann, 'gbbox'), pg_temp.held(ann, 'gblong')));
  perform pg_temp.expect((select (g.account, g.card, g.paid) from gift_box g where g.box = bx) = row(ann, 'gblong'::text, 50::bigint), 'the gift_box row is not the giver''s card and its extra price');
  -- The ledger: the box's row carries the box's own price, the gift's its own.
  perform pg_temp.expect((select array_agg((l.card, l.price)::text order by l.card) from card_ledger l where l.act = bx and l.kind = 'played') = array['(gbbox,150)', '(gblong,50)'], format('the ledger rows are %s', (select array_agg((l.card, l.price)::text) from card_ledger l where l.act = bx)));
  -- The box's Act and what any reader gets of it name no gift, configuration or price beyond the box's.
  select a2.payload into payload from acts a2 where a2.id = bx;
  perform pg_temp.expect(payload = jsonb_build_object('card', 'gbbox', 'message', '', 'config', '{}'::jsonb, 'layer', 1), format('the box''s payload is not the box''s alone: %s', payload));
  perform tests.become(bob);
  select to_jsonb(x)::text into row_text from acts_public x where x.id = bx;
  perform pg_temp.expect(row_text is not null and row_text !~* 'gblong|gift|"paid"', format('another account reads the gift in the box''s row: %s', row_text));
  perform pg_temp.expect(post_plays(array[p])::text !~* 'gblong|gift', 'post_plays names the gift to a reader');
  perform pg_temp.expect((select count(*) from gift_box) = 0, 'another account selects from gift_box');
  perform pg_temp.expect(pg_temp.coded('insert into gift_box (box, account, card, paid) select box, account, card, 0 from gift_box') is not null, 'an account writes gift_box');
  perform tests.become(cat);
  perform pg_temp.expect((select count(*) from gift_box) = 0 and not exists (select 1 from card_ledger l where l.act = bx), 'a third account reads the gift or the ledger');
  perform tests.become(ann);
  perform pg_temp.expect((select count(*) from gift_box) = 1, 'the giver cannot read their own gift');
  perform tests.unbecome();
  -- A second box on the post is refused as any card's stack is.
  r := pg_temp.wrap(ann, a, p, 'gblong', 50); perform pg_temp.expect(r.said = '23505 this post already carries that card', format('a second box: %s', r.said));
  -- gift_box is append-only.
  perform pg_temp.expect(pg_temp.coded('update gift_box set paid = 0') is not null, 'gift_box was edited');
  perform pg_temp.expect(pg_temp.coded('delete from gift_box') is not null, 'gift_box was deleted from');
end $$;

-- ---- Only the post's author opens it; the author's open lands the gift as the giver's play and frees the box's slot ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); p uuid := pg_temp.fix('p'); bx uuid := pg_temp.fix('box'); t uuid := pg_temp.fix('t'); boss uuid := pg_temp.fix('boss');
  said text; res jsonb; gift uuid; open_id uuid; balance_before integer := (select balance from wallets where account = ann); hand_before integer := pg_temp.held(ann, 'gblong');
begin
  said := pg_temp.open_said(cat, bx); perform pg_temp.expect(said = '42501 only this post''s author can open it', format('a stranger''s open: %s', said));
  said := pg_temp.open_said(ann, bx); perform pg_temp.expect(said = '42501 only this post''s author can open it', format('the giver''s open of another''s post: %s', said));
  said := pg_temp.open_said(bob, p); perform pg_temp.expect(said = 'P0002 there is no present to open', format('an open of a post: %s', said));
  perform pg_temp.expect(not card_ended(bx) and post_effects_up(p) = 1, 'a refused open ended the box');
  res := pg_temp.opened(bob, bx);
  perform pg_temp.expect(res ->> 'did' = 'landed' and res -> 'why' = 'null'::jsonb, format('the author''s open did not land: %s', res));
  gift := (res #>> '{gift,id}')::uuid; open_id := (res #>> '{open,id}')::uuid;
  perform pg_temp.expect((select (k.kind, k.character, k.target_act_id, k.payload ->> 'card', k.payload ->> 'opened') from acts k where k.id = gift) = row('card'::text, a, p, 'gblong'::text, open_id::text), 'the gift is not the giver''s play on the post, naming the open');
  perform pg_temp.expect((select o.payload from acts o where o.id = open_id) = jsonb_build_object('box', bx, 'did', 'landed', 'gift', gift, 'why', null), format('the open Act is %s', (select o.payload from acts o where o.id = open_id)));
  perform pg_temp.expect((select (o.character, o.target_act_id) from acts o where o.id = open_id) = row(b, bx), 'the open is the author''s Act on the box');
  perform pg_temp.expect(card_ended(bx) and (select over_at is not null from play_post where play = bx), 'the box''s play is not over');
  perform pg_temp.expect((select balance from wallets where account = ann) = balance_before and pg_temp.held(ann, 'gblong') = hand_before, 'the open charged the wallet or took a card');
  perform pg_temp.expect(pg_temp.open_said(bob, bx) = '55000 this present was already opened or ended', format('a second open: %s', pg_temp.open_said(bob, bx)));
  perform pg_temp.expect(not exists (select 1 from card_ledger l where l.act = open_id), 'a landed open wrote a ledger row');
  perform pg_temp.expect((select count(*) from play_post_drift()) = 0, 'the kept play rows drifted');
  -- The page's plays reader reads the open as the box's end; no admin-ended feed does.
  perform pg_temp.expect(post_plays(array[p]) -> 'plays' @> jsonb_build_array(jsonb_build_object('kind', 'open_gift', 'id', open_id)) or (post_plays(array[p]) ->> 'plays')::jsonb @> '[{"kind": "open_gift"}]', 'post_plays does not read the open as the box''s end');
  perform tests.become(ann);
  perform pg_temp.expect(not exists (select 1 from my_cards_ended m where m.play = bx), 'my_cards_ended lists an open as an admin''s end');
  perform tests.become(boss);
  perform pg_temp.expect(admin_queue()::text not like '%' || bx::text || '%', 'the admin queue lists an open as an admin''s end');
  perform tests.unbecome();
end $$;

-- ---- A one-slot post: the box's slot is freed before the gift is tried (F1) ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); cat uuid := pg_temp.fix('cat'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(b, t, 'A one-slot post.'); r record; res jsonb; said text;
begin
  update settings set value = '1' where key = 'postEffects';
  r := pg_temp.wrap(ann, a, p, 'gbdraw'); perform pg_temp.expect(r.said is null, format('the wrap was refused: %s', r.said));
  perform pg_temp.expect(post_effects_up(p) = 1, 'the box holds no slot while it waits');
  said := (select pg_temp.coded(format('select place_cast(%L, %L, %L, %L, %L, %L, null, %L, 0)', (select c.id from characters c where c.owner = cat), 'gbdraw2', p, '{}', '', 'post', cat)));
  perform pg_temp.expect(said like '23505 this post already shows 1 effects%', format('the post is not full while the box waits: %s', said));
  res := pg_temp.opened(bob, r.id);
  perform pg_temp.expect(res ->> 'did' = 'landed', format('an effect-drawing gift did not land on a one-slot post from an effect-drawing box: %s', res));
  perform pg_temp.expect(post_effects_up(p) = 1, format('the post holds %s effects after the open', post_effects_up(p)));
  update settings set value = '2' where key = 'postEffects';
end $$;

-- ---- A ward on the post at the open turns the gift away: back to the giver's hand with the ward's words ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(b, t, 'A post that wards.'); r record; res jsonb; ward_said text; open_id uuid; hand integer; used jsonb;
begin
  r := pg_temp.wrap(ann, a, p, 'gblong', 50); perform pg_temp.expect(r.said is null, format('the wrap was refused: %s', r.said));
  hand := pg_temp.held(ann, 'gblong');
  perform tests.become_service();
  used := play_card(bob, 'gbward', b, p, '{}', 0, '');
  ward_said := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'gblong', a, p, '{}', ''));
  perform tests.unbecome();
  perform pg_temp.expect(ward_said like '42501 %Gb Ward%', format('the ward does not turn a plain cast away: %s', ward_said));
  res := pg_temp.opened(bob, r.id);
  open_id := (res #>> '{open,id}')::uuid;
  perform pg_temp.expect(res ->> 'did' = 'returned' and res -> 'gift' = 'null'::jsonb and '42501 ' || (res ->> 'why') = ward_said, format('the open did not return the gift with the ward''s words: %s (a cast says %s)', res, ward_said));
  perform pg_temp.expect((select o.payload from acts o where o.id = open_id) = jsonb_build_object('box', r.id, 'did', 'returned', 'gift', null, 'why', res ->> 'why'), 'the open Act does not say why');
  perform pg_temp.expect(pg_temp.held(ann, 'gblong') = hand + 1, 'the gift did not go back to the giver''s hand');
  perform pg_temp.expect((select (l.card, l.kind, l.price) from card_ledger l where l.act = open_id) = row('gblong'::text, 'returned'::text, 0), 'the return has no ledger row naming the open');
  perform pg_temp.expect(not exists (select 1 from acts k where k.kind = 'card' and k.target_act_id = p and k.payload ->> 'card' = 'gblong') and card_ended(r.id), 'a returned gift left a play, or the box is still up');
  perform pg_temp.expect(pg_temp.open_said(bob, r.id) = '55000 this present was already opened or ended', 'a returned box can be opened again');
  perform pg_temp.expect((select count(*) from play_post_drift()) = 0, 'the kept play rows drifted');
end $$;

-- ---- A gift a trap catches at the open counts as landed (F8) ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t');
  p uuid := tests.post(b, t, 'A post with a back.'); r record; res jsonb; ann_hand integer; bob_hand integer;
begin
  perform tests.become_service();
  perform set_card(bob, 'gbsnare', b, p, '{}', 0, 'gblong');
  perform tests.unbecome();
  r := pg_temp.wrap(ann, a, p, 'gblong', 50); perform pg_temp.expect(r.said is null, format('the wrap was refused: %s', r.said));
  ann_hand := pg_temp.held(ann, 'gblong'); bob_hand := pg_temp.held(bob, 'gblong');
  res := pg_temp.opened(bob, r.id);
  perform pg_temp.expect(res ->> 'did' = 'landed' and (res #> '{gift,payload}') ? 'caught', format('a caught gift is not a landed open: %s', res));
  perform pg_temp.expect(pg_temp.held(ann, 'gblong') = ann_hand and pg_temp.held(bob, 'gblong') = bob_hand + 1, 'the caught gift did not go to the setter');
  perform pg_temp.expect((select o.payload ->> 'did' from acts o where o.id = (res #>> '{open,id}')::uuid) = 'landed', 'the open Act does not say landed');
end $$;

-- ---- An admin's end of an unopened box returns the gift; of an opened one is refused ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); bob uuid := pg_temp.fix('bob'); boss uuid := pg_temp.fix('boss'); a uuid := pg_temp.fix('a'); b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t'); opened_box uuid := pg_temp.fix('box');
  p uuid := tests.post(b, t, 'A post whose present an admin ends.'); r record; hand integer; ended jsonb;
begin
  r := pg_temp.wrap(ann, a, p, 'gblong', 50); perform pg_temp.expect(r.said is null, format('the wrap was refused: %s', r.said));
  hand := pg_temp.held(ann, 'gblong');
  perform tests.become(boss);
  ended := reverse_card(r.id);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.held(ann, 'gblong') = hand + 1, 'an admin''s end did not return the gift');
  perform pg_temp.expect((select (l.card, l.kind, l.price) from card_ledger l where l.act = (ended ->> 'id')::uuid) = row('gblong'::text, 'returned'::text, 0), 'the end has no ledger row for the gift');
  perform pg_temp.expect(pg_temp.open_said(bob, r.id) = '55000 this present was already opened or ended', 'an ended box can be opened');
  perform tests.become(boss);
  perform pg_temp.expect(pg_temp.coded(format('select reverse_card(%L)', opened_box)) = '55000 that present was already opened', format('an admin ends an opened box: %s', pg_temp.coded(format('select reverse_card(%L)', opened_box))));
  perform tests.unbecome();
  perform pg_temp.expect((select count(*) from play_post_drift()) = 0, 'the kept play rows drifted');
end $$;

-- ---- The giver's own post is allowed ----
select tests.unbecome();
do $$
declare
  ann uuid := pg_temp.fix('ann'); a uuid := pg_temp.fix('a'); t uuid := pg_temp.fix('t'); mine uuid := tests.post(pg_temp.fix('a'), pg_temp.fix('t'), 'A post of the giver''s own.'); r record; res jsonb;
begin
  r := pg_temp.wrap(ann, a, mine, 'gblong', 50); perform pg_temp.expect(r.said is null, format('a present on the giver''s own post was refused: %s', r.said));
  res := pg_temp.opened(ann, r.id);
  perform pg_temp.expect(res ->> 'did' = 'landed', format('the giver opened their own present and it did not land: %s', res));
end $$;

-- ---- The post's own checks alone (#1264): a giver with no card and no Aura left, locked out of the thread, still lands ----
select tests.unbecome();
do $$
declare
  bob uuid := pg_temp.fix('bob'); b uuid := pg_temp.fix('b'); t uuid := pg_temp.fix('t'); dan uuid := tests.account('gb-dan'); d uuid := tests.character(dan, 'Gb Dan');
  p uuid := tests.post(b, t, 'A post a giver is locked out of.'); r record; res jsonb; said text;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, draws_effect) values
    ('gblock', 'Gb Lock', 'salty', 'uncommon', 'set', '{"trigger": {"on": "cast"}, "outcome": {"kind": "lockout", "hours": 24}}', '{post}', null, false);
  insert into card_ledger (account, card, kind, price) values (dan, 'gbbox', 'bought', 0), (dan, 'gblong', 'bought', 0), (dan, 'gbplain', 'bought', 0);
  insert into wallets (account, balance) values (dan, 200) on conflict (account) do update set balance = excluded.balance;
  perform pg_temp.hand(bob, 'gblock');
  perform tests.become_service();
  perform set_card(bob, 'gblock', b, p, '{}', 0, 'gbplain');
  perform tests.unbecome();
  r := pg_temp.wrap(dan, d, p, 'gblong', 50); perform pg_temp.expect(r.said is null, format('the wrap was refused: %s', r.said));
  perform tests.become_service();
  perform play_card(dan, 'gbplain', d, p, '{}', 0, '');
  said := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', dan, 'gbplain', d, p, '{}', ''));
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.held(dan, 'gblong') = 0 and (select balance from wallets where account = dan) = 0, 'the giver still holds the gift or has Aura left');
  perform pg_temp.expect(pg_temp.coded(format('select place_cast(%L, %L, %L, %L, %L, %L, null, %L, 0)', d, 'gblong', p, '{}', '', 'post', dan)) like '55000 Gb Dan is locked out of this thread%', 'the giver is not locked out of the thread');
  res := pg_temp.opened(bob, r.id);
  perform pg_temp.expect(res ->> 'did' = 'landed', format('a locked-out giver with no hand and no wallet did not land at the open: %s', res));
end $$;
