-- Blind totals (supabase/migrations/0401_blind_totals.sql; docs/plans/2026-11-11-card-notes-part-3-plan.md, Task 4; engine/rules/cards.ts, CardRules.veil = 'totals').
-- A cast card with `veil = 'totals'` on a post withholds the post's reaction totals while it is up: a third player reads no tally row of it, in the table or in a page, and the author's player and the caster's player
-- read their own. What differs between readers keys on the reader's own account alone: it owns the veil's `author` character, or it is the veil's `caster_account`. The cards are this file's own (bt...).
--
--  1. totals_withheld(act, account): a live totals veil is on the Act and the account neither owns its author nor cast it; an author veil withholds no totals.
--  2. A world: a post P (by Ann's character) that two players reacted to, a post Q (by Fay's) as the control, a totals veil Bob casts on P, and three more reactions after it. Before the cast every probe below finds
--     what it looks for (the detector's poison: a probe that cannot go red on the unveiled fixture proves nothing).
--  3. While the veil is up: a third player's read of the table and of thread_page holds none of P's tallies, Ann's and Bob's hold them all; Q's are whole for everyone; react's answer has no tally for anyone;
--     reaction_tallies_open and the three readers the machine reads through it (demand_progress, demand_contributors, system_digest) leave P out; estimate_input leaves out the others' reactions to P for a third
--     player and for a reactor, and holds them all for Ann and for Bob; settlement_input holds every one.
--  4. It all returns at ends_at (once by an admin's end, once by the time), the settlement the same with the veil and without it.
--  5. Who may read what: the grants of reaction_tallies_open and the digest role's reads of the tallies.
--  6. Bounded reads: a live veil in the table does not take the primary key from a page's tally read, and the read touches a few buffers however many tallies there are.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- The stand-in, as seed_instance makes it, for the one author veil this file casts (a veil on the totals alone needs none).
create function pg_temp.stand() returns uuid language plpgsql as $$
declare made uuid;
begin
  select c.id into made from characters c where c.staff_kind = 'anonymous';
  if made is not null then return made; end if;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into made;
  insert into character_profiles (character, title, signature) values (made, 'Could be anyone.', '');
  return made;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values
    ('btblind', 'Bt Blind Study', 'salty', 'uncommon', 'cast', '{post}', interval '3 days', 'totals', 1, null),
    ('btauthor', 'Bt Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null)
  on conflict (key) do nothing;
end $$;

-- A staff Boss, The System's Announcements thread and a move written as the tick writes it (as 0051-moves.sql does), for demand_progress.
create function pg_temp.boss() returns uuid language plpgsql as $$
declare made uuid;
begin
  select id into made from characters where staff = 'bt-boss';
  if made is null then insert into characters (name, staff, staff_kind, debuted_at) values ('Bt Boss', 'bt-boss', 'persona', now()) returning id into made; end if;
  update seasons set boss = 'bt-boss' where ends_at is null and boss is distinct from 'bt-boss';
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
      'params', jsonb_build_object('board', on_board, 'name', 'Bt Renamed', 'premise', 'The subject of it', 'description', 'About it'),
      'demand', demand, 'expires_at', at + interval '3 days')), null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

-- react, as a signed-in player: its answer. The reaction is then dated `at` (react writes now()), so that it falls in the window the estimate and the settlement read.
create function pg_temp.reacts(account uuid, as_character uuid, post uuid, kind text, at timestamptz) returns jsonb language plpgsql as $$
declare res jsonb;
begin
  perform tests.become(account);
  begin
    res := react(post, as_character, kind);
  exception when others then
    perform tests.unbecome();
    raise;
  end;
  perform tests.unbecome();
  update reactions r set created_at = at where r.act = post and r.reactor_account = account and r.kind = reacts.kind;
  return res;
end $$;

-- How many tally rows of an Act a signed-in player reads from the table, and from a thread's page.
create function pg_temp.table_rows(account uuid, post uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform tests.become(account);
  select count(*)::integer into n from reaction_tallies t where t.act = post;
  perform tests.unbecome();
  return n;
end $$;
create function pg_temp.page_rows(account uuid, in_thread uuid, post uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform tests.become(account);
  select count(*)::integer into n from jsonb_array_elements(thread_page(in_thread, 1, null, null, null) -> 'tallies') e where e ->> 'act' = post::text;
  perform tests.unbecome();
  return n;
end $$;
-- The sum of the counts of an Act's tallies as a signed-in player reads them.
create function pg_temp.table_sum(account uuid, post uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform tests.become(account);
  select coalesce(sum(t.count), 0)::integer into n from reaction_tallies t where t.act = post;
  perform tests.unbecome();
  return n;
end $$;

-- The window the next estimate reads opens at the last settlement an earlier file left committed, and may be closed by now (its season over), so the world writes its Acts and its reactions an hour past that start
-- (`at`) and asks for the estimate, the settlement and the digest around that time, as 0076-core-loop-answers.sql does.
create function pg_temp.ws() returns timestamptz language sql as $$
  select (estimate_input(tests.account('bt-ws-' || gen_random_uuid()), '3000-01-01') ->> 'windowStart')::timestamptz
$$;

-- The reactions to an Act that estimate_input holds for an account.
create function pg_temp.estimated(account uuid, post uuid, at timestamptz) returns integer language sql as $$
  select count(*)::integer from jsonb_array_elements(estimate_input(account, at + interval '1 hour') -> 'reactions') e where e ->> 'act' = post::text
$$;
create function pg_temp.settled(post uuid, at timestamptz) returns integer language sql as $$
  select count(*)::integer from jsonb_array_elements(settlement_input(at - interval '30 minutes', at + interval '1 hour') -> 'reactions') e where e ->> 'act' = post::text
$$;
-- The reactions the digest says an Act drew, from its excerpts (the window's posts, the most reacted first).
create function pg_temp.digested(post uuid, at timestamptz) returns integer language sql as $$
  select (e ->> 'reactions')::integer
  from jsonb_array_elements(system_digest(at - interval '30 minutes', at + interval '1 hour') -> 'excerpts') e where e ->> 'act' = post::text
$$;
create function pg_temp.progress(move uuid) returns integer language sql as $$
  select (demand_progress(move) ->> 'done')::integer
$$;
create function pg_temp.credited(move uuid, who uuid) returns boolean language sql as $$
  select who = any (demand_contributors(move))
$$;

-- The world one run of the file reads. Ann's post P and Fay's post Q are on a board of their own, with a move whose demand counts excitedPositive reactions there since an hour ago. Cat and Dee react to both
-- before anything is cast; Bob (the caster) then casts the veil on P; Eve and Bob react to P after it, and Eve to Q. Everything the probes need is returned by name.
create function pg_temp.world(tag text) returns jsonb language plpgsql as $$
declare
  ann uuid := tests.account('bt-ann-' || tag); bob uuid := tests.account('bt-bob-' || tag); cat uuid := tests.account('bt-cat-' || tag);
  dee uuid := tests.account('bt-dee-' || tag); eve uuid := tests.account('bt-eve-' || tag); fay uuid := tests.account('bt-fay-' || tag); adm uuid := tests.account('bt-adm-' || tag);
  a uuid := tests.character(ann, 'Bt Ann ' || tag); b uuid := tests.character(bob, 'Bt Bob ' || tag); c uuid := tests.character(cat, 'Bt Cat ' || tag);
  d uuid := tests.character(dee, 'Bt Dee ' || tag); e uuid := tests.character(eve, 'Bt Eve ' || tag); f uuid := tests.character(fay, 'Bt Fay ' || tag);
  board uuid; t uuid; p uuid; q uuid; mv uuid; veil uuid; ans_eve jsonb; ans_bob jsonb; ans_q jsonb; at timestamptz := pg_temp.ws() + interval '1 hour';
begin
  insert into admins (account) values (adm);
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '20'), ('digestExcerptChars', '10') on conflict (key) do update set value = excluded.value;
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) values ('postsOnBoard'), ('distinctCharactersOnBoard'), ('quadrantOnBoard'), ('characterPostsInThread'), ('crossQuote') on conflict do nothing;
  insert into boards (slug, name, description) values ('bt-' || tag, 'Bt ' || tag, 'x') returning id into board;
  insert into threads (board, title) values (board, 'Bt thread ' || tag) returning id into t;
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'btblind');
  p := tests.post(a, t, 'Ann''s post.', at);
  q := tests.post(f, t, 'Fay''s post.', at);
  mv := pg_temp.move(board, jsonb_build_object('kind', 'quadrantOnBoard', 'params', jsonb_build_object('board', board, 'quadrant', 'excitedPositive', 'count', 100)), at - interval '1 hour');
  perform pg_temp.reacts(cat, c, p, 'up', at); perform pg_temp.reacts(cat, c, q, 'up', at);
  perform pg_temp.reacts(dee, d, p, 'wow', at); perform pg_temp.reacts(dee, d, q, 'wow', at);

  -- THE DETECTOR'S POISON: before the cast every probe finds what it looks for.
  if pg_temp.table_rows(eve, p) is distinct from 2 then raise exception 'detector: a third player reads % tally rows of P before the cast, not 2', pg_temp.table_rows(eve, p); end if;
  if pg_temp.page_rows(eve, t, p) is distinct from 2 then raise exception 'detector: a third player''s page holds % tally rows of P before the cast, not 2', pg_temp.page_rows(eve, t, p); end if;
  if pg_temp.progress(mv) is distinct from 4 then raise exception 'detector: demand_progress is % before the cast, not 4', pg_temp.progress(mv); end if;
  if not pg_temp.credited(mv, a) then raise exception 'detector: Ann is not credited before the cast'; end if;
  if pg_temp.digested(p, at) is distinct from 2 then raise exception 'detector: the digest says P drew % reactions before the cast, not 2', pg_temp.digested(p, at); end if;
  if pg_temp.estimated(dee, p, at) is distinct from 2 then raise exception 'detector: a reactor''s estimate holds % reactions to P before the cast, not 2', pg_temp.estimated(dee, p, at); end if;
  if pg_temp.settled(p, at) is distinct from 2 then raise exception 'detector: the settlement holds % reactions to P before the cast, not 2', pg_temp.settled(p, at); end if;
  if (select count(*) from reaction_tallies_open o where o.act = p) is distinct from 2 then raise exception 'detector: reaction_tallies_open holds % rows of P before the cast, not 2', (select count(*) from reaction_tallies_open o where o.act = p); end if;

  perform tests.become_service();
  veil := (play_card(bob, 'btblind', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  ans_eve := pg_temp.reacts(eve, e, p, 'up', at);
  ans_bob := pg_temp.reacts(bob, b, p, 'wow', at);
  ans_q := pg_temp.reacts(eve, e, q, 'up', at);
  return jsonb_build_object('ann', ann, 'bob', bob, 'cat', cat, 'dee', dee, 'eve', eve, 'fay', fay, 'adm', adm, 'a', a, 'b', b, 'c', c, 'd', d, 'e', e, 'f', f,
    'board', board, 'at', at, 't', t, 'p', p, 'q', q, 'mv', mv, 'veil', veil, 'ans_eve', ans_eve, 'ans_bob', ans_bob, 'ans_q', ans_q);
end $$;

-- What a world reads while its veil is up: P is 4 reactions (up by Cat and Eve, wow by Dee and Bob: two rows of count 2), Q is 3 (up 2, wow 1).
create function pg_temp.while_up(w jsonb) returns void language plpgsql as $$
declare
  ann uuid := (w ->> 'ann')::uuid; bob uuid := (w ->> 'bob')::uuid; cat uuid := (w ->> 'cat')::uuid; dee uuid := (w ->> 'dee')::uuid; eve uuid := (w ->> 'eve')::uuid; fay uuid := (w ->> 'fay')::uuid;
  a uuid := (w ->> 'a')::uuid; f uuid := (w ->> 'f')::uuid; t uuid := (w ->> 't')::uuid; p uuid := (w ->> 'p')::uuid; q uuid := (w ->> 'q')::uuid; mv uuid := (w ->> 'mv')::uuid;
  who uuid; at timestamptz := (w ->> 'at')::timestamptz;
begin
  -- The table and the page, as a third player, a reactor and the author's own other readers: none of P's rows. Ann's player and Bob's hold both.
  foreach who in array array[eve, cat, dee, fay] loop
    if pg_temp.table_rows(who, p) is distinct from 0 then raise exception 'a third player reads % tally rows of the blind post from the table', pg_temp.table_rows(who, p); end if;
    if pg_temp.page_rows(who, t, p) is distinct from 0 then raise exception 'a third player''s thread page holds % tally rows of the blind post', pg_temp.page_rows(who, t, p); end if;
  end loop;
  foreach who in array array[ann, bob] loop
    if pg_temp.table_rows(who, p) is distinct from 2 or pg_temp.table_sum(who, p) is distinct from 4 then raise exception 'the author''s player and the caster''s read % rows (sum %) of the blind post, not 2 (4)', pg_temp.table_rows(who, p), pg_temp.table_sum(who, p); end if;
    if pg_temp.page_rows(who, t, p) is distinct from 2 then raise exception 'the author''s player and the caster''s page holds % tally rows of the blind post, not 2', pg_temp.page_rows(who, t, p); end if;
  end loop;
  -- The control: Q's tallies are whole for every reader.
  foreach who in array array[ann, bob, cat, eve, fay] loop
    if pg_temp.table_sum(who, q) is distinct from 3 or pg_temp.page_rows(who, t, q) is distinct from 2 then raise exception 'a plain post''s tallies are not whole for a reader: % in the table, % rows on the page', pg_temp.table_sum(who, q), pg_temp.page_rows(who, t, q); end if;
  end loop;
  -- A player still reads their own reactions to the blind post (my_reactions is theirs).
  perform tests.become(eve);
  if (select count(*) from my_reactions m where m.act = p) is distinct from 1 then raise exception 'a player no longer reads their own reaction to the blind post'; end if;
  perform tests.unbecome();

  -- react's answer has no tally, for anyone (a reactor, the caster); a plain post's answer has one.
  if jsonb_typeof(w -> 'ans_eve' -> 'tally') is distinct from 'null' or jsonb_typeof(w -> 'ans_bob' -> 'tally') is distinct from 'null' then
    raise exception 'react answered a tally for the blind post: % %', w -> 'ans_eve', w -> 'ans_bob';
  end if;
  if jsonb_typeof(w -> 'ans_q' -> 'tally') is distinct from 'object' or (w -> 'ans_q' -> 'tally' ->> 'up') is distinct from '2' then raise exception 'react did not answer the plain post''s tally: %', w -> 'ans_q'; end if;

  -- The machine's reads: the open view leaves P out and keeps Q; the demand, its credit and the digest do not move with a reaction to P.
  if exists (select 1 from reaction_tallies_open o where o.act = p) then raise exception 'reaction_tallies_open holds the blind post'; end if;
  if (select coalesce(sum(o.count), 0) from reaction_tallies_open o where o.act = q) is distinct from 3 then raise exception 'reaction_tallies_open does not hold the plain post whole'; end if;
  -- Three reactions to Q are excitedPositive (up 2, wow 1); P's four are not counted, and the three made after the cast are not either.
  if pg_temp.progress(mv) is distinct from 3 then raise exception 'demand_progress is %, not 3: it moved with the blind post''s tallies', pg_temp.progress(mv); end if;
  if pg_temp.credited(mv, a) then raise exception 'demand_contributors credits the author of the blind post'; end if;
  if not pg_temp.credited(mv, f) then raise exception 'demand_contributors does not credit the author of the plain post'; end if;
  if pg_temp.digested(p, at) is distinct from 0 then raise exception 'the digest says the blind post drew % reactions, not 0', pg_temp.digested(p, at); end if;
  if pg_temp.digested(q, at) is distinct from 3 then raise exception 'the digest says the plain post drew % reactions, not 3', pg_temp.digested(q, at); end if;
  -- A reaction to the blind post, made now, moves none of them.
  perform pg_temp.reacts(fay, f, p, 'boo', at);
  if pg_temp.progress(mv) is distinct from 3 or pg_temp.digested(p, at) is distinct from 0 or exists (select 1 from reaction_tallies_open o where o.act = p) then raise exception 'a reaction to the blind post moved the machine''s reads'; end if;
  perform pg_temp.reacts(fay, f, p, 'up', at);   -- (Fay's second reaction here, so P holds 6 reactions from now on)
  if pg_temp.progress(mv) is distinct from 3 then raise exception 'a second reaction to the blind post moved demand_progress'; end if;

  -- The live estimate: Ann's and Bob's hold every reaction to P (six); a third player holds their own alone, and so does a reactor. Q is whole for all.
  if pg_temp.estimated(ann, p, at) is distinct from 6 then raise exception 'the author''s estimate holds % reactions to the blind post, not 6', pg_temp.estimated(ann, p, at); end if;
  if pg_temp.estimated(bob, p, at) is distinct from 6 then raise exception 'the caster''s estimate holds % reactions to the blind post, not 6', pg_temp.estimated(bob, p, at); end if;
  if pg_temp.estimated(eve, p, at) is distinct from 1 then raise exception 'a third player''s estimate holds % reactions to the blind post, not their own 1', pg_temp.estimated(eve, p, at); end if;
  if pg_temp.estimated(cat, p, at) is distinct from 1 then raise exception 'a reactor''s estimate holds % reactions to the blind post, not their own 1', pg_temp.estimated(cat, p, at); end if;
  if pg_temp.estimated(fay, p, at) is distinct from 2 then raise exception 'a third player''s estimate holds % reactions to the blind post, not their own 2', pg_temp.estimated(fay, p, at); end if;
  if pg_temp.estimated(eve, q, at) is distinct from 3 then raise exception 'a third player''s estimate holds % reactions to a plain post, not 3', pg_temp.estimated(eve, q, at); end if;
  -- The settlement is exact: it holds all six.
  if pg_temp.settled(p, at) is distinct from 6 then raise exception 'the settlement holds % reactions to the blind post, not 6', pg_temp.settled(p, at); end if;
end $$;

-- What a world reads once its veil is over: everything is back.
create function pg_temp.when_over(w jsonb) returns void language plpgsql as $$
declare
  ann uuid := (w ->> 'ann')::uuid; bob uuid := (w ->> 'bob')::uuid; cat uuid := (w ->> 'cat')::uuid; dee uuid := (w ->> 'dee')::uuid; eve uuid := (w ->> 'eve')::uuid; fay uuid := (w ->> 'fay')::uuid;
  a uuid := (w ->> 'a')::uuid; d uuid := (w ->> 'd')::uuid; t uuid := (w ->> 't')::uuid; p uuid := (w ->> 'p')::uuid; mv uuid := (w ->> 'mv')::uuid;
  who uuid; ans jsonb; at timestamptz := (w ->> 'at')::timestamptz;
begin
  foreach who in array array[eve, cat, dee, ann, bob, fay] loop
    if pg_temp.table_sum(who, p) is distinct from 6 or pg_temp.table_rows(who, p) is distinct from 3 then raise exception 'after the veil a reader reads % rows (sum %) of the post, not 3 (6)', pg_temp.table_rows(who, p), pg_temp.table_sum(who, p); end if;
    if pg_temp.page_rows(who, t, p) is distinct from 3 then raise exception 'after the veil a reader''s page holds % tally rows of the post, not 3', pg_temp.page_rows(who, t, p); end if;
  end loop;
  ans := pg_temp.reacts(dee, d, p, 'meh', at);
  if jsonb_typeof(ans -> 'tally') is distinct from 'object' or (ans -> 'tally' ->> 'meh') is distinct from '1' then raise exception 'react after the veil did not answer the tally: %', ans; end if;
  if (select coalesce(sum(o.count), 0) from reaction_tallies_open o where o.act = p) is distinct from 7 then raise exception 'reaction_tallies_open does not hold the post after the veil'; end if;
  -- P's excitedPositive are up by Cat, Eve and Fay and wow by Dee and Bob (five; Fay's boo and Dee's meh are other quadrants), and Q's three: eight.
  if pg_temp.progress(mv) is distinct from 8 then raise exception 'demand_progress is % after the veil, not 8', pg_temp.progress(mv); end if;
  if not pg_temp.credited(mv, a) then raise exception 'demand_contributors does not credit the author after the veil'; end if;
  if pg_temp.digested(p, at) is distinct from 7 then raise exception 'the digest says the post drew % reactions after the veil, not 7', pg_temp.digested(p, at); end if;
  if pg_temp.estimated(eve, p, at) is distinct from 7 or pg_temp.estimated(cat, p, at) is distinct from 7 then raise exception 'a third player''s estimate holds % reactions to the post after the veil, not 7', pg_temp.estimated(eve, p, at); end if;
end $$;

-- ---- 0. The migration exists at all ----
select tests.unbecome();
do $$
begin
  if to_regprocedure('totals_withheld(uuid, uuid)') is null then raise exception 'totals_withheld(uuid, uuid) exists'; end if;
  if to_regclass('reaction_tallies_open') is null then raise exception 'reaction_tallies_open exists'; end if;
end $$;

-- ---- 1. totals_withheld ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bw-ann'); bob uuid := tests.account('bw-bob'); eve uuid := tests.account('bw-eve');
  a uuid := tests.character(ann, 'Bw Ann'); b uuid := tests.character(bob, 'Bw Bob'); a2 uuid := tests.character(ann, 'Bw Ann Two');
  t uuid := tests.thread('Bw withheld');
  p uuid := tests.post(a, t, 'Blind.'); r uuid := tests.post(a2, t, 'Whodunnit.'); plain uuid := tests.post(a, t, 'Plain.');
  veil uuid; ended uuid; adm uuid := tests.account('bw-adm');
begin
  insert into admins (account) values (adm);
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'btblind', 'btauthor');
  perform pg_temp.stand();
  perform tests.become_service();
  veil := (play_card(bob, 'btblind', b, p, '{}', 0, '') ->> 'id')::uuid;
  perform play_card(bob, 'btauthor', b, r, '{}', 0, '');
  perform tests.unbecome();
  if totals_withheld(p, eve) is not true then raise exception 'a third player is not withheld the blind post''s totals'; end if;
  if totals_withheld(p, ann) is not false then raise exception 'the author''s player is withheld the blind post''s totals'; end if;
  if totals_withheld(p, bob) is not false then raise exception 'the caster is withheld the blind post''s totals'; end if;
  if totals_withheld(p, null) is not true then raise exception 'no account reads the blind post''s totals'; end if;
  if totals_withheld(plain, eve) is not false or totals_withheld(plain, ann) is not false then raise exception 'a plain post is withheld'; end if;
  if totals_withheld(r, eve) is not false then raise exception 'an author veil withholds the post''s totals'; end if;
  -- An admin's end returns them.
  perform tests.become(adm);
  perform reverse_card(veil);
  perform tests.unbecome();
  if totals_withheld(p, eve) is not false then raise exception 'the totals are still withheld after an admin''s end'; end if;
end $$;

-- ---- 2, 3, 4. A world, while the veil is up, and after an admin's end ----
select tests.unbecome();
do $$
declare w jsonb := pg_temp.world('adm');
begin
  perform pg_temp.while_up(w);
  perform tests.become((w ->> 'adm')::uuid);
  perform reverse_card((w ->> 'veil')::uuid);
  perform tests.unbecome();
  perform pg_temp.when_over(w);
end $$;

-- ---- 2, 3, 4. A second world, until its time passes: the same, and the settlement is the same with the veil and without it ----
select tests.unbecome();
do $$
declare w jsonb := pg_temp.world('time'); with_veil jsonb; without_veil jsonb;
begin
  perform pg_temp.while_up(w);
  with_veil := settlement_input((w ->> 'at')::timestamptz - interval '30 minutes', (w ->> 'at')::timestamptz + interval '1 hour');
  -- The veil's time passes (the one row is edited here only, as a test may: the trigger that keeps it is put back).
  alter table post_veils disable trigger post_veils_no_update;
  update post_veils set ends_at = now() - interval '1 second' where play = (w ->> 'veil')::uuid;
  alter table post_veils enable always trigger post_veils_no_update;
  without_veil := settlement_input((w ->> 'at')::timestamptz - interval '30 minutes', (w ->> 'at')::timestamptz + interval '1 hour');
  if with_veil is distinct from without_veil then raise exception 'the settlement differs with the veil and without it'; end if;
  perform pg_temp.when_over(w);
end $$;

-- ---- 5. Who may read what ----
select tests.unbecome();
do $$
begin
  if has_table_privilege('authenticated', 'reaction_tallies_open', 'select') or has_table_privilege('anon', 'reaction_tallies_open', 'select') or has_table_privilege('service_role', 'reaction_tallies_open', 'select') then
    raise exception 'a client reads reaction_tallies_open';
  end if;
  if not has_table_privilege('kayfabb_digest', 'reaction_tallies_open', 'select') then raise exception 'the digest role cannot read reaction_tallies_open'; end if;
  if has_table_privilege('kayfabb_digest', 'reaction_tallies', 'select') then raise exception 'the digest role still reads reaction_tallies, blind posts and all'; end if;
  if has_function_privilege('authenticated', 'totals_withheld(uuid, uuid)', 'execute') or has_function_privilege('anon', 'totals_withheld(uuid, uuid)', 'execute') then
    raise exception 'a client can ask totals_withheld about another account';
  end if;
  -- Every definer function that reads the tallies reads them through the open view, never the table (the poison: a function that did would pass the file's other reads for want of a blind post).
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proowner = 'kayfabb_digest'::regrole and pg_get_functiondef(p.oid) ~ 'reaction_tallies\y(?!_open)') then
    raise exception 'a function of the digest role reads reaction_tallies, not reaction_tallies_open: %',
      (select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proowner = 'kayfabb_digest'::regrole and pg_get_functiondef(p.oid) ~ 'reaction_tallies\y(?!_open)');
  end if;
end $$;

-- ---- 6. Bounded reads: a live veil in the table does not take the key from a page's tally read ----
create function pg_temp.plan_as(account uuid, q text) returns text language plpgsql as $$
declare ln record; out text := '';
begin
  perform tests.become(account);
  for ln in execute 'explain ' || q loop out := out || E'\n' || ln."QUERY PLAN"; end loop;
  perform tests.unbecome();
  return out;
end $$;
create function pg_temp.plan_of_open(post uuid) returns text language plpgsql as $$
declare ln record; out text := '';
begin
  for ln in execute format('explain select act, kind, count from reaction_tallies_open t where t.act = %L', post) loop out := out || E'\n' || ln."QUERY PLAN"; end loop;
  return out;
end $$;
create function pg_temp.buffers_as(account uuid, call_sql text) returns bigint language plpgsql as $$
declare plan jsonb;
begin
  perform tests.become(account);
  for i in 1..8 loop execute call_sql; end loop;
  execute 'explain (analyze, buffers, format json) ' || call_sql into plan;
  perform tests.unbecome();
  return coalesce((plan -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint, 0) + coalesce((plan -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint, 0);
end $$;

select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bb-ann'); bob uuid := tests.account('bb-bob'); eve uuid := tests.account('bb-eve');
  a uuid := tests.character(ann, 'Bb Ann'); b uuid := tests.character(bob, 'Bb Bob');
  t uuid := tests.thread('Bb plans');
  p uuid := tests.post(a, t, 'Blind.');
  ids uuid[]; plan text; touched bigint; q text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'btblind');
  -- 3,000 posts that each drew a reaction, and the blind post among them with its own.
  insert into acts (character, kind, thread, payload) select a, 'post', t, jsonb_build_object('body', 'Filler ' || n) from generate_series(1, 3000) n;
  insert into reaction_tallies (act, kind, count) select x.id, 'up', 1 from acts x where x.thread = t and x.kind = 'post';
  perform tests.become_service();
  perform play_card(bob, 'btblind', b, p, '{}', 0, '');
  perform tests.unbecome();
  analyze acts; analyze reaction_tallies; analyze post_veils;
  select array_agg(x.id) into ids from (select id from acts where thread = t and kind = 'post' order by seq limit 20) x;
  if not p = any (ids) then ids[1] := p; end if;
  set local enable_seqscan = off;
  -- The page's own read, as a third player: the key of reaction_tallies, a few rows, never a scan of the table.
  q := format('select act, kind, count from reaction_tallies t where t.act = any (%L::uuid[])', ids);
  plan := pg_temp.plan_as(eve, q);
  if plan !~ 'reaction_tallies_pkey' or plan ~ 'Seq Scan on reaction_tallies' then raise exception 'a page''s tally read does not stay on its key: %', plan; end if;
  reset enable_seqscan;
  touched := pg_temp.buffers_as(eve, format('select act, kind, count from reaction_tallies t where t.act = any (%L::uuid[])', ids));
  raise notice 'a page''s tally read touches % buffers', touched;
  -- Twenty Acts, each a probe of the key plus the policy's one probe of the veils' own index: about a hundred buffers (130 measured), never the 3,000 rows' pages (a policy that planned a view on every call, as a SQL function
  -- does, read 1,700 here). The margin is room for the heap's state, not for a scan.
  if touched > 250 then raise exception 'a page''s tally read touches % buffers with 3,000 tally rows and a live totals veil', touched; end if;
  -- And the machine's view of one Act is the same probe.
  set local enable_seqscan = off;
  plan := pg_temp.plan_of_open(p);
  if plan !~ 'reaction_tallies_pkey' or plan ~ 'Seq Scan on reaction_tallies' or plan !~ 'post_veils' then raise exception 'reaction_tallies_open''s read of an Act does not stay on the keys: %', plan; end if;
  reset enable_seqscan;
end $$;
