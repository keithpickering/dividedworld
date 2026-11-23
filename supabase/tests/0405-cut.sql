-- A card that cuts, a Move that ends a Gimmick early (supabase/migrations/0405_cut.sql; docs/plans/2026-11-21-buzzkill-plan.md, Task 2; design docs/plans/2026-11-21-buzzkill-design.md, sections 3.1 to 3.3), for Buzzkill.
--   * The catalog: card_kinds_problem refuses each bad `cuts` in the engine's words (engine/rules/instance.ts, cutsProblems) and takes the good one; card_reach_problem takes it with no time up; a back of it is refused by
--     face_down_never_writes in the words decideSet gives; the table takes the column and its reach with no `lasts`.
--   * The cast: on a post with a live Gimmick the card lands instant (an `instant` and a `cut` naming the play and its card, no layer), the Gimmick is over (card_ended, card_cut_at), a second cut of the card lands (no stack
--     refusal) and one naming the cut Gimmick is refused; each cut_refusal sentence; a Ward turns it away with the Ward's words before cut_refusal and a weaker one does not; a catching back catches it and the Gimmick stays;
--     on a character it ends a pierce, and the character's next Move carries none; a staff caster is refused.
--   * The ways out: an admin's reversal of the cutting play brings the Gimmick back, and reverse_card tells the truth about a play that is over (an admin's end, a cut, a spent pierce).
--   * Settlement: settlement_input and estimate_input send the cut end for the play, the end of its own when the cut is reversed, and a cut play is not in the list that voids a play whole.
--   * The probe: card_cut_at's lookup is one lookup of acts_cut_play, and it never calls card_ended.
-- The cards are this file's own (bk...).

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

create function pg_temp.hand(who uuid, variadic keys text[]) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select who, k, 'bought', 0 from unnest(keys) k, generate_series(1, 8)
$$;

create function pg_temp.cards() returns void language plpgsql as $$
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, refunds, cuts, stack) values
    ('bkcut', 'Bk Buzzkill', 'salty', 'rare', 'cast', null, '{post,character}', null, null, null, '{"upTo": "rare"}', 1),
    ('bkkick', 'Bk Kick', 'salty', 'common', 'use', null, '{post}', interval '3 days', '{"kind": "earn", "quadrants": ["excitedNegative", "boredNegative"], "flat": 1}', '{"flavors": ["salty"], "count": 3}', null, 1),
    ('bkreq', 'Bk Required', 'sweet', 'uncommon', 'use', null, '{post}', interval '3 days', '{"kind": "earn", "quadrants": ["excitedPositive", "calmPositive"], "by": 1, "group": "publicity"}', null, null, 1),
    ('bkfield', 'Bk Field', 'pepperoni', 'uncommon', 'use', null, '{post}', interval '3 days', '{"kind": "ward", "upTo": "uncommon"}', null, null, 1),
    ('bkgloss', 'Bk Gloss', 'sweet', 'rare', 'use', null, '{post}', interval '3 days', '{"kind": "ward", "flavors": ["salty"]}', null, null, 1),
    ('bkleg', 'Bk Legend', 'sweet', 'legendary', 'use', null, '{post}', interval '3 days', '{"kind": "ward", "upTo": "common"}', null, null, 1),
    ('bkpierce', 'Bk Pierce', 'pepperoni', 'uncommon', 'use', null, '{character}', interval '3 days', '{"kind": "pierce", "upTo": "uncommon"}', null, null, 1),
    ('bkthr', 'Bk Thread Gimmick', 'sweet', 'uncommon', 'use', null, '{thread}', interval '3 days', '{"kind": "earn", "quadrants": ["excitedPositive"], "by": 1, "group": "publicity"}', null, null, 1),
    ('bkmove', 'Bk Move', 'salty', 'common', 'cast', null, '{post}', null, null, null, null, 8),
    ('bkhype', 'Bk Hype', 'sweet', 'common', 'cast', null, '{post}', interval '3 days', '{"kind": "earn", "quadrants": ["excitedPositive", "calmPositive"], "by": 1, "group": "publicity"}', null, null, 6),
    ('bkcatch', 'Bk Catch', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}', '{post}', null, null, null, null, 1)
  on conflict (key) do nothing;
end $$;

-- A cut of `play`, by `who` (`through` is the caster), on a post or, with a reach of character, on a character from one of its posts.
create function pg_temp.cut(who uuid, through uuid, target uuid, play uuid, reach text default 'post', from_post uuid default null) returns jsonb language sql as $$
  select play_card(who, 'bkcut', through, target, case when play is null then '{}'::jsonb else jsonb_build_object('play', play) end, 0, '', reach, from_post)
$$;

create function pg_temp.cut_error(who uuid, through uuid, target uuid, play uuid, reach text default 'post', from_post uuid default null) returns text language sql as $$
  select pg_temp.coded(format('select pg_temp.cut(%L, %L, %L, %L, %L, %L)', who, through, target, play, reach, from_post))
$$;

create function pg_temp.payload(play jsonb) returns jsonb language sql as $$
  select x.payload from acts x where x.id = (play ->> 'id')::uuid
$$;

-- ---- The catalog takes a card that cuts and refuses each bad one, in the engine's words ----
select tests.unbecome();
do $$
declare
  got text;
  good constant jsonb := '{"key": "bkgood", "rarity": "rare", "reaches": ["post", "character"], "cuts": {"upTo": "rare"}}';
  k text; ok boolean;
begin
  perform pg_temp.cards();
  got := card_kinds_problem(jsonb_build_array(good));
  if got is not null then raise exception 'a good card that cuts was refused: %', got; end if;
  got := card_reach_problem(jsonb_build_array(good));
  if got is not null then raise exception 'a card that cuts, with no time up, was refused by card_reach_problem: %', got; end if;
  -- A card with a null `cuts` cuts nothing.
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{cuts}', 'null')));
  if got is not null then raise exception 'a null cuts was refused: %', got; end if;
  -- The seeded one's row has the column, and the table takes it.
  if (select cuts from card_kinds where key = 'bkcut') is distinct from '{"upTo": "rare"}'::jsonb then raise exception 'the test card''s cuts column is not there'; end if;

  got := card_kinds_problem(jsonb_build_array(good - 'cuts' || jsonb_build_object('cuts', '{}'::jsonb)));
  if got is distinct from 'card "bkgood" has cuts up to nothing; a rarity is common, uncommon, rare or legendary' then raise exception 'cuts with no upTo: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{cuts,upTo}', '"mythic"')));
  if got is distinct from 'card "bkgood" has cuts up to "mythic"; a rarity is common, uncommon, rare or legendary' then raise exception 'cuts up to mythic: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{cuts,upTo}', '"legendary"')));
  if got is distinct from 'card "bkgood" has cuts up to legendary, rarer than the card' then raise exception 'cuts up to legendary on a rare card: %', got; end if;
  -- An upTo at or below the card's own is fine.
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{cuts,upTo}', '"common"')));
  if got is not null then raise exception 'cuts up to common on a rare card was refused: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{play}', '"use"')));
  if got is null or got not like '%card "bkgood" has cuts and is not a cast card%' then raise exception 'cuts on a use card: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{play}', '"set"')));
  if got is null or got not like '%card "bkgood" has cuts and is not a cast card%' then raise exception 'cuts on a set card: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{reaches}', '["post", "thread"]')));
  if got is distinct from 'card "bkgood" has cuts and reaches a thread; a card that cuts reaches a post or a character' then raise exception 'cuts reaching a thread: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{reaches}', '["board", "thread", "post"]')));
  if got is distinct from 'card "bkgood" has cuts and reaches a board and a thread; a card that cuts reaches a post or a character' then raise exception 'cuts reaching a board and a thread: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{reaches}', '["character"]')));
  if got is not null then raise exception 'cuts reaching a character alone was refused: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(jsonb_set(good, '{lasts}', '{"unit": "day", "count": 1}')));
  if got is distinct from 'card "bkgood" has cuts and a time up (lasts); a card that cuts is over when it lands' then raise exception 'cuts with a time up: %', got; end if;

  got := card_kinds_problem(jsonb_build_array(good || '{"stack": 3}'));
  if got is distinct from 'card "bkgood" has cuts and a stack; a card that cuts is over when it lands and has none' then raise exception 'cuts with a stack: %', got; end if;
  -- What the seed sends for what a card leaves out reads as left out: a stack of 1 and false flags (seed.ts).
  got := card_kinds_problem(jsonb_build_array(good || '{"stack": 1, "pins": false, "writes": false, "replies": false, "keeps": false, "surface": false, "addsReaction": false}'));
  if got is not null then raise exception 'the seed''s defaults beside cuts were refused: %', got; end if;
  got := card_kinds_problem(jsonb_build_array(good || '{"pins": true}'));
  if got is distinct from 'card "bkgood" has cuts and pins; a card that cuts is over when it lands and has none' then raise exception 'cuts with pins: %', got; end if;
  -- Stack, then pins, then the first other effect, in that order.
  got := card_kinds_problem(jsonb_build_array(good || '{"stack": 2, "pins": true, "writes": true}'));
  if got is distinct from 'card "bkgood" has cuts and a stack; a card that cuts is over when it lands and has none; card "bkgood" has cuts and pins; a card that cuts is over when it lands and has none; card "bkgood" has cuts and writes; a card that cuts has no other effect' then raise exception 'cuts with a stack, pins and writes: %', got; end if;

  -- Any other effect beside it, each named in the engine's order (the first present).
  foreach k in array array['gimmick', 'skim', 'refunds', 'discipline', 'writes', 'replies', 'keeps', 'scoresAs', 'draws', 'drive', 'surface', 'veil', 'needsMessage'] loop
    got := card_kinds_problem(jsonb_build_array(good || jsonb_build_object(k, case k when 'draws' then '["x"]'::jsonb when 'veil' then '"hidden"'::jsonb when 'needsMessage' then '"say why"'::jsonb
                                                                                      when 'gimmick' then '{"kind": "ward", "upTo": "common"}'::jsonb when 'skim' then '{"share": 0.1}'::jsonb
                                                                                      when 'refunds' then '{"flavors": ["salty"], "count": 1}'::jsonb when 'discipline' then '{"kind": "relief"}'::jsonb
                                                                                      when 'drive' then '{"lasts": {"unit": "hour", "count": 1}, "gifts": [], "overhead": "x"}'::jsonb else 'true'::jsonb end)));
    ok := got like format('%%card "bkgood" has cuts and %s; a card that cuts has no other effect%%',
                          case k when 'gimmick' then 'a gimmick' when 'skim' then 'a skim' when 'discipline' then 'a discipline' when 'drive' then 'a drive' when 'surface' then 'a surface' when 'veil' then 'a veil' else k end);
    if not coalesce(ok, false) then raise exception 'cuts beside %: %', k, got; end if;
  end loop;
  -- The first present wins: a gimmick and writes name the gimmick.
  got := card_kinds_problem(jsonb_build_array(good || '{"writes": true, "gimmick": {"kind": "ward", "upTo": "common"}}'));
  if got not like '%card "bkgood" has cuts and a gimmick; a card that cuts has no other effect%' or got like '%has cuts and writes%' then raise exception 'cuts with two other effects names the first: %', got; end if;
  -- A card that does not cut is untouched: a cast card with a time up is fine, as before.
  got := card_kinds_problem(jsonb_build_array('{"key": "bkplain", "rarity": "rare", "reaches": ["post"], "lasts": {"unit": "day", "count": 1}}'::jsonb));
  if got is not null then raise exception 'a plain cast card was refused: %', got; end if;
end $$;

-- ---- A back of a card that cuts is refused, in the words decideSet gives ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-fd-ann');
  a uuid := tests.character(ann, 'Bk Fd Ann');
  t uuid := tests.thread('Bk face down');
  p uuid := tests.post(a, t, 'Words a back would sit under.');
  why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut');
  perform tests.become_service();
  why := pg_temp.coded(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, 'bkcut', a, p, '{}'));
  perform tests.unbecome();
  if why is distinct from '22023 Bk Buzzkill is played face up and never set face down' then raise exception 'a card that cuts was set face down, or refused in other words: %', why; end if;
  if exists (select 1 from face_down f where f.post = p) or exists (select 1 from acts s where s.kind = 'set' and s.target_act_id = p) or card_held(ann, 'bkcut') is distinct from 8 then
    raise exception 'a refused set of a card that cuts left something behind';
  end if;
end $$;

-- ---- The cut on a post: it lands instant, the Gimmick is over, a second cut lands, one naming the cut Gimmick is refused ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-p-ann'); bob uuid := tests.account('bk-p-bob');
  a uuid := tests.character(ann, 'Bk P Ann'); b uuid := tests.character(bob, 'Bk P Bob');
  t uuid := tests.thread('Bk post');
  pb uuid := tests.post(b, t, 'Bob''s post.');
  kick uuid; req uuid; c jsonb; c2 jsonb; cp jsonb; kp jsonb; moved jsonb; at_cut timestamptz; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut', 'bkmove');
  perform pg_temp.hand(bob, 'bkkick', 'bkreq');
  perform tests.become_service();
  kick := (play_card(bob, 'bkkick', b, pb, '{}', 0, '') ->> 'id')::uuid;
  req := (play_card(bob, 'bkreq', b, pb, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  if card_ended(kick) or card_cut_at(kick) is not null then raise exception 'a fresh Gimmick is over'; end if;
  perform tests.become_service();

  -- A salty Move is handed back by the live Kick Me.
  moved := play_card(ann, 'bkmove', a, pb, '{}', 0, '');
  if not (pg_temp.payload(moved) ? 'handedBack') then raise exception 'a Move under a live Kick Me was not handed back: %', pg_temp.payload(moved); end if;

  c := pg_temp.cut(ann, a, pb, kick);
  cp := pg_temp.payload(c);
  if cp -> 'cut' is distinct from jsonb_build_object('play', kick::text, 'card', 'bkkick') then raise exception 'the cut did not name the Gimmick and its card: %', cp; end if;
  if cp ->> 'instant' is distinct from 'true' or cp ? 'layer' or cp ? 'caught' or cp ? 'ends' then raise exception 'the cut is not an instant play with no layer or end: %', cp; end if;
  -- The owner's answer (#965): a Kick Me never refunds the card that cuts it, so the cutting card is consumed and carries no `handedBack`.
  if cp ? 'handedBack' then raise exception 'the cut that ended a Kick Me was handed back by it: %', cp; end if;
  perform tests.unbecome();
  at_cut := (select x.created_at from acts x where x.id = (c ->> 'id')::uuid);
  if not card_ended(kick) then raise exception 'a cut Gimmick is not over'; end if;
  if card_cut_at(kick) is distinct from at_cut then raise exception 'card_cut_at is not the cutting play''s time: %, %', card_cut_at(kick), at_cut; end if;
  if card_ended(req) or card_cut_at(req) is not null then raise exception 'a cut ended another Gimmick'; end if;
  if card_ended((c ->> 'id')::uuid) then raise exception 'the cutting play itself is over'; end if;
  perform tests.become_service();

  -- The Kick Me no longer hands anything back.
  moved := play_card(ann, 'bkmove', a, pb, '{}', 0, '');
  if pg_temp.payload(moved) ? 'handedBack' then raise exception 'a Move was handed back by a cut Kick Me: %', pg_temp.payload(moved); end if;

  -- A second cut of the same card lands at once (no stack refusal, no layer to collide on) and ends the other Gimmick.
  c2 := pg_temp.cut(ann, a, pb, req);
  kp := pg_temp.payload(c2);
  if kp -> 'cut' is distinct from jsonb_build_object('play', req::text, 'card', 'bkreq') or kp ? 'layer' then raise exception 'a second cut did not land as the first did: %', kp; end if;
  perform tests.unbecome();
  if not card_ended(req) then raise exception 'the second cut did not end its Gimmick'; end if;
  perform tests.become_service();

  -- cutting_acts: the page's read gives the ids of the cutting Acts of the plays asked, to a signed-in player, and nothing for a play nobody cut.
  perform tests.unbecome();
  perform tests.become(ann);
  if (select array_agg(x order by x) from cutting_acts(array[kick, req, gen_random_uuid()]) x) is distinct from (select array_agg(i order by i) from unnest(array[(c ->> 'id')::uuid, (c2 ->> 'id')::uuid]) i) then
    raise exception 'cutting_acts did not give the two cutting Acts: %', (select array_agg(x) from cutting_acts(array[kick, req]) x);
  end if;
  if (select count(*) from cutting_acts(array[pb])) is distinct from 0::bigint then raise exception 'cutting_acts gave a cut for a play nobody cut'; end if;
  why := pg_temp.coded(format('select count(*) from cutting_acts(array(select gen_random_uuid() from generate_series(1, 1001)))'));
  if why is distinct from '22023 ask for at most 1000 plays at a time' then raise exception 'cutting_acts took 1001 plays: %', why; end if;
  perform tests.unbecome();
  if has_function_privilege('anon', 'cutting_acts(uuid[])', 'execute') or not has_function_privilege('authenticated', 'cutting_acts(uuid[])', 'execute') then raise exception 'cutting_acts is granted to the wrong roles'; end if;
  perform tests.become_service();

  -- Naming a Gimmick that is already cut, with nothing else up: no Gimmick is up at all.
  why := pg_temp.cut_error(ann, a, pb, kick);
  if why is distinct from '55000 there''s no Gimmick up on this post for Bk Buzzkill to end' then raise exception 'a cut of the cut Gimmick with none up: %', why; end if;
  perform tests.unbecome();
  -- Two cut plays on the post, neither with a layer, and the post's card list still holds them.
  if (select count(*) from acts k where k.kind = 'card' and k.target_act_id = pb and k.payload ->> 'card' = 'bkcut' and k.payload ->> 'instant' = 'true' and not k.payload ? 'layer') is distinct from 2::bigint then
    raise exception 'the two cut plays are not both instant with no layer';
  end if;
end $$;

-- ---- A cut Gimmick named while another is up: refused as not up ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-n-ann'); bob uuid := tests.account('bk-n-bob');
  a uuid := tests.character(ann, 'Bk N Ann'); b uuid := tests.character(bob, 'Bk N Bob');
  t uuid := tests.thread('Bk named');
  pb uuid := tests.post(b, t, 'Bob''s post.');
  kick uuid; req uuid; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut');
  perform pg_temp.hand(bob, 'bkkick', 'bkreq');
  perform tests.become_service();
  kick := (play_card(bob, 'bkkick', b, pb, '{}', 0, '') ->> 'id')::uuid;
  req := (play_card(bob, 'bkreq', b, pb, '{}', 0, '') ->> 'id')::uuid;
  perform pg_temp.cut(ann, a, pb, kick);
  why := pg_temp.cut_error(ann, a, pb, kick);
  if why is distinct from '55000 that Gimmick isn''t up on this post' then raise exception 'naming the cut Gimmick with another up: %', why; end if;
  perform tests.unbecome();
  if card_ended(req) then raise exception 'a refused cut ended the other Gimmick'; end if;
end $$;

-- ---- A cut of another Gimmick is handed back by a Kick Me still up, as any Salty Move (it did not cut that Kick Me) ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-h-ann'); bob uuid := tests.account('bk-h-bob');
  a uuid := tests.character(ann, 'Bk H Ann'); b uuid := tests.character(bob, 'Bk H Bob');
  t uuid := tests.thread('Bk handed');
  pb uuid := tests.post(b, t, 'Bob''s post.');
  kick uuid; req uuid; cp jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut');
  perform pg_temp.hand(bob, 'bkkick', 'bkreq');
  perform tests.become_service();
  kick := (play_card(bob, 'bkkick', b, pb, '{}', 0, '') ->> 'id')::uuid;
  req := (play_card(bob, 'bkreq', b, pb, '{}', 0, '') ->> 'id')::uuid;
  cp := pg_temp.payload(pg_temp.cut(ann, a, pb, req));
  if cp -> 'handedBack' is distinct from jsonb_build_object('by', kick::text, 'card', 'bkkick') then raise exception 'a cut of another Gimmick was not handed back by the live Kick Me: %', cp; end if;
  if cp -> 'cut' ->> 'play' is distinct from req::text then raise exception 'the cut did not name the other Gimmick: %', cp; end if;
  perform tests.unbecome();
  if card_ended(kick) or not card_ended(req) then raise exception 'the cut ended the wrong Gimmick'; end if;
end $$;

-- ---- Each refusal of cut_refusal, in the same words for every caster ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-r-ann'); bob uuid := tests.account('bk-r-bob');
  a uuid := tests.character(ann, 'Bk R Ann'); b uuid := tests.character(bob, 'Bk R Bob'); a2 uuid := tests.character(ann, 'Bk R Ann Two');
  t uuid := tests.thread('Bk refusals');
  empty uuid := tests.post(b, t, 'No Gimmick here.');
  moves uuid := tests.post(b, t, 'Only a Move''s earn here.');
  one uuid := tests.post(b, t, 'One Gimmick here.');
  other uuid := tests.post(b, t, 'Another post with a Gimmick.');
  big uuid := tests.post(b, t, 'A legendary Gimmick and a lesser one.');
  only_big uuid := tests.post(b, t, 'Only a legendary Gimmick.');
  req1 uuid; req2 uuid; leg uuid; leg2 uuid; thr uuid; why text; before_acts bigint;
  t2 uuid := tests.thread('Bk refusals two'); first2 uuid := tests.post(b, t2, 'The first post of a thread.');
  mine uuid := tests.post(a2, t, 'Ann''s other mask.');
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut', 'bkhype');
  perform pg_temp.hand(bob, 'bkreq', 'bkleg', 'bkthr');
  perform pg_temp.hand(ann, 'bkreq');
  perform tests.become_service();
  before_acts := (select count(*) from acts);

  why := pg_temp.cut_error(ann, a, empty, null);
  if why is distinct from '55000 there''s no Gimmick up on this post for Bk Buzzkill to end' then raise exception 'a post with no Gimmick: %', why; end if;
  -- A Move's earn is no Gimmick.
  perform play_card(ann, 'bkhype', a, moves, '{}', 0, '');
  why := pg_temp.cut_error(ann, a, moves, null);
  if why is distinct from '55000 there''s no Gimmick up on this post for Bk Buzzkill to end' then raise exception 'a post with only a Move''s earn: %', why; end if;

  -- One Gimmick up: the play is not named, or not a uuid, or names another post's.
  req1 := (play_card(bob, 'bkreq', b, one, '{}', 0, '') ->> 'id')::uuid;
  req2 := (play_card(bob, 'bkreq', b, other, '{}', 0, '') ->> 'id')::uuid;
  why := pg_temp.cut_error(ann, a, one, null);
  if why is distinct from '55000 Bk Buzzkill names the Gimmick it ends' then raise exception 'no play named: %', why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'bkcut', a, one, '{"play": "not-a-uuid"}', ''));
  if why is distinct from '55000 Bk Buzzkill names the Gimmick it ends' then raise exception 'a play that is no uuid: %', why; end if;
  why := pg_temp.coded(format('select play_card(%L, %L, %L, %L, %L, 0, %L)', ann, 'bkcut', a, one, '{"play": 7}', ''));
  if why is distinct from '55000 Bk Buzzkill names the Gimmick it ends' then raise exception 'a play that is a number: %', why; end if;
  why := pg_temp.cut_error(ann, a, one, req2);
  if why is distinct from '55000 that Gimmick isn''t up on this post' then raise exception 'a play on another post: %', why; end if;
  why := pg_temp.cut_error(ann, a, one, gen_random_uuid());
  if why is distinct from '55000 that Gimmick isn''t up on this post' then raise exception 'a play that is nowhere: %', why; end if;
  -- The same words from Ann's other mask, and from Bob himself (a Move on one's own post is a Move like any).
  why := pg_temp.cut_error(ann, a2, one, req2);
  if why is distinct from '55000 that Gimmick isn''t up on this post' then raise exception 'the other mask got other words: %', why; end if;

  -- A legendary Gimmick is past a Buzzkill up to rare: with a lesser one up the words name it; with it alone, none is up.
  leg := (play_card(bob, 'bkleg', b, big, '{}', 0, '') ->> 'id')::uuid;
  perform play_card(bob, 'bkreq', b, big, '{}', 0, '');
  why := pg_temp.cut_error(ann, a, big, leg);
  if why is distinct from '55000 Bk Buzzkill ends a Gimmick up to rare, and Bk Legend is legendary' then raise exception 'a legendary Gimmick: %', why; end if;
  leg2 := (play_card(bob, 'bkleg', b, only_big, '{}', 0, '') ->> 'id')::uuid;
  why := pg_temp.cut_error(ann, a, only_big, leg2);
  if why is distinct from '55000 there''s no Gimmick up on this post for Bk Buzzkill to end' then raise exception 'only a legendary Gimmick: %', why; end if;

  -- A Gimmick on a thread, named from the thread's first post, is not reached, with another up or with none.
  thr := (play_card(bob, 'bkthr', b, t2, '{}', 0, '', 'thread') ->> 'id')::uuid;
  why := pg_temp.cut_error(ann, a, first2, thr);
  if why is distinct from '55000 there''s no Gimmick up on this post for Bk Buzzkill to end' then raise exception 'a thread''s Gimmick, alone: %', why; end if;
  perform play_card(bob, 'bkreq', b, first2, '{}', 0, '');
  why := pg_temp.cut_error(ann, a, first2, thr);
  if why is distinct from '55000 that Gimmick isn''t up on this post' then raise exception 'a thread''s Gimmick named from a post: %', why; end if;

  perform tests.unbecome();
  if (select count(*) from acts where kind = 'card' and payload ? 'cut' and thread in (t, t2)) is distinct from 0::bigint then raise exception 'a refused cut wrote an Act'; end if;
  if (select count(*) from card_ledger l where l.account = ann and l.card = 'bkcut' and l.kind <> 'bought') is distinct from 0::bigint then raise exception 'a refused cut spent the card'; end if;
end $$;

-- ---- A Ward turns the card away with the Ward's words before cut_refusal; a weaker one does not, and the card ends it ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-w-ann'); bob uuid := tests.account('bk-w-bob');
  a uuid := tests.character(ann, 'Bk W Ann'); b uuid := tests.character(bob, 'Bk W Bob');
  t uuid := tests.thread('Bk wards');
  warded uuid := tests.post(b, t, 'Under a rare Ward.');
  fielded uuid := tests.post(b, t, 'Under an uncommon Ward.');
  gloss uuid; field uuid; c jsonb; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut');
  perform pg_temp.hand(bob, 'bkgloss', 'bkfield', 'bkreq');
  perform tests.become_service();
  gloss := (play_card(bob, 'bkgloss', b, warded, '{}', 0, '') ->> 'id')::uuid;
  field := (play_card(bob, 'bkfield', b, fielded, '{}', 0, '') ->> 'id')::uuid;
  -- Sugar Coat's place: a rare Ward of Salty turns the card away, with the Ward's words, whether or not the play is named, and nothing is cut.
  why := pg_temp.cut_error(ann, a, warded, gloss);
  if why is distinct from '42501 this post''s Bk Gloss turns away Salty cards' then raise exception 'a Ward of Salty did not turn the cut away in its own words: %', why; end if;
  why := pg_temp.cut_error(ann, a, warded, null);
  if why is distinct from '42501 this post''s Bk Gloss turns away Salty cards' then raise exception 'a Ward of Salty turned the unnamed cut away in other words: %', why; end if;
  -- Force Field's place: an uncommon Ward does not cover a rare card, and the cut ends it.
  c := pg_temp.cut(ann, a, fielded, field);
  perform tests.unbecome();
  if not card_ended(field) or card_ended(gloss) then raise exception 'the cut did not end the weaker Ward alone'; end if;
end $$;

-- ---- A rare catching back catches the cut: no `cut`, the Gimmick still live ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-c-ann'); bob uuid := tests.account('bk-c-bob');
  a uuid := tests.character(ann, 'Bk C Ann'); b uuid := tests.character(bob, 'Bk C Bob');
  t uuid := tests.thread('Bk catch');
  pb uuid := tests.post(b, t, 'Bob''s post with a back.');
  req uuid; back uuid; c jsonb; cp jsonb;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut');
  perform pg_temp.hand(bob, 'bkreq', 'bkcatch');
  perform tests.become_service();
  req := (play_card(bob, 'bkreq', b, pb, '{}', 0, '') ->> 'id')::uuid;
  back := (set_card(bob, 'bkcatch', b, pb, '{}', 0, 'bkcut') ->> 'id')::uuid;
  c := pg_temp.cut(ann, a, pb, req);
  cp := pg_temp.payload(c);
  if cp ->> 'caught' is null or cp ? 'cut' or cp ? 'layer' then raise exception 'a caught cut is not a caught play with no cut: %', cp; end if;
  if c -> 'sprung' -> 'payload' ->> 'did' is distinct from 'caught' then raise exception 'the back did not catch the cut: %', c; end if;
  perform tests.unbecome();
  if card_ended(req) or card_cut_at(req) is not null then raise exception 'a caught cut ended the Gimmick'; end if;
  perform tests.become(ann);
  if (select count(*) from cutting_acts(array[req])) is distinct from 0::bigint then raise exception 'cutting_acts gave a caught cut'; end if;
  perform tests.unbecome();
end $$;

-- ---- On a character: a cut ends a Cheap Shot, and the character's next Move carries no pierce ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('bk-ch-ann'); bob uuid := tests.account('bk-ch-bob');
  a uuid := tests.character(ann, 'Bk Ch Ann'); b uuid := tests.character(bob, 'Bk Ch Bob'); b2 uuid := tests.character(bob, 'Bk Ch Bob Two');
  t uuid := tests.thread('Bk character');
  pb uuid := tests.post(b, t, 'Bob''s own post.'); pa uuid := tests.post(a, t, 'Ann''s own post.'); pb2 uuid := tests.post(b2, t, 'Bob''s other mask''s post.');
  shot uuid; kick uuid; c jsonb; cp jsonb; moved jsonb; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut');
  perform pg_temp.hand(bob, 'bkpierce', 'bkmove', 'bkkick');
  perform tests.become_service();
  -- A character with no Gimmick on it is refused in a character's words.
  why := pg_temp.cut_error(ann, a, b, null, 'character', pb);
  if why is distinct from '55000 there''s no Gimmick up on this character for Bk Buzzkill to end' then raise exception 'a character with no Gimmick: %', why; end if;
  shot := (play_card(bob, 'bkpierce', b, b, '{}', 0, '', 'character', pb) ->> 'id')::uuid;
  kick := (play_card(bob, 'bkkick', b, pb, '{}', 0, '') ->> 'id')::uuid;
  -- A post's Gimmick is not a character's, even played from the same post.
  why := pg_temp.cut_error(ann, a, b, kick, 'character', pb);
  if why is distinct from '55000 that Gimmick isn''t up on this character' then raise exception 'a post''s Gimmick named on its author: %', why; end if;
  -- The cut, played from Bob's post.
  c := pg_temp.cut(ann, a, b, shot, 'character', pb);
  cp := pg_temp.payload(c);
  if cp -> 'cut' is distinct from jsonb_build_object('play', shot::text, 'card', 'bkpierce') or cp ->> 'instant' is distinct from 'true' or cp ? 'ends' or cp ? 'lifted' or cp ->> 'reach' is distinct from 'character' then
    raise exception 'the cut on a character is not an instant play naming the Cheap Shot: %', cp;
  end if;
  perform tests.unbecome();
  if not card_ended(shot) or card_cut_at(shot) is null then raise exception 'the Cheap Shot is not over'; end if;
  if exists (select 1 from play_reach r where r.play = (c ->> 'id')::uuid) then raise exception 'an instant cut wrote a play_reach row'; end if;
  if card_ended(kick) then raise exception 'the cut on a character ended the post''s Gimmick'; end if;
  perform tests.become_service();
  -- Bob's next Move carries no pierce: the Cheap Shot is over.
  moved := play_card(bob, 'bkmove', b, pa, '{}', 0, '');
  if pg_temp.payload(moved) ? 'pierce' then raise exception 'a Move carried a cut pierce: %', pg_temp.payload(moved); end if;
  why := pg_temp.cut_error(ann, a, b, shot, 'character', pb);
  if why is distinct from '55000 there''s no Gimmick up on this character for Bk Buzzkill to end' then raise exception 'cutting the cut Cheap Shot again: %', why; end if;
end $$;

-- ---- A caster who cuts their own Cheap Shot spends no pierce on it; reversing the Buzzkill brings the Cheap Shot back ----
select tests.unbecome();
do $$
declare
  admin_acc uuid := tests.account('bk-o-admin');
  bob uuid := tests.account('bk-o-bob');
  b uuid := tests.character(bob, 'Bk O Bob');
  t uuid := tests.thread('Bk own cut');
  pb uuid := tests.post(b, t, 'Bob''s own post.');
  shot uuid; c jsonb; cp jsonb; moved jsonb;
begin
  insert into admins (account) values (admin_acc);
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'bkcut', 'bkpierce', 'bkmove');
  perform tests.become_service();
  shot := (play_card(bob, 'bkpierce', b, b, '{}', 0, '', 'character', pb) ->> 'id')::uuid;
  c := pg_temp.cut(bob, b, b, shot, 'character', pb);
  cp := pg_temp.payload(c);
  if cp ? 'pierce' then raise exception 'a cut spent the pierce it cuts: %', cp; end if;
  if cp -> 'cut' is distinct from jsonb_build_object('play', shot::text, 'card', 'bkpierce') then raise exception 'the cut of one''s own Cheap Shot did not land: %', cp; end if;
  perform tests.unbecome();
  if not card_ended(shot) or card_cut_at(shot) is null then raise exception 'the Cheap Shot is not cut'; end if;
  perform tests.become(admin_acc);
  perform reverse_card((c ->> 'id')::uuid);
  perform tests.unbecome();
  if card_ended(shot) or card_cut_at(shot) is not null then raise exception 'reversing the Buzzkill did not bring the own Cheap Shot back'; end if;
  perform tests.become_service();
  moved := play_card(bob, 'bkmove', b, pb, '{}', 0, '');
  if pg_temp.payload(moved) #>> '{pierce,by}' is distinct from shot::text then raise exception 'the restored Cheap Shot did not pierce: %', pg_temp.payload(moved); end if;
end $$;

-- ---- A staff caster is refused, plainly ----
select tests.unbecome();
do $$
declare
  bob uuid := tests.account('bk-s-bob');
  b uuid := tests.character(bob, 'Bk S Bob');
  t uuid := tests.thread('Bk staff');
  pb uuid := tests.post(b, t, 'Bob''s post.');
  bot uuid; req uuid; why text;
begin
  perform pg_temp.cards();
  perform pg_temp.hand(bob, 'bkreq');
  insert into characters (name, staff, staff_kind, debuted_at) values ('Bk Mod', 'bk-mod', 'persona', now()) returning id into bot;
  perform tests.become_service();
  req := (play_card(bob, 'bkreq', b, pb, '{}', 0, '') ->> 'id')::uuid;
  perform tests.unbecome();
  why := pg_temp.coded(format('select place_cast(%L, %L, %L, %L, %L, %L, null, null, 0)', bot, 'bkcut', pb, jsonb_build_object('play', req), '', 'post'));
  if why is distinct from '42501 a staff character casts no card that ends a Gimmick' then raise exception 'a staff caster was not refused plainly: %', why; end if;
  if card_ended(req) then raise exception 'a refused staff cut ended the Gimmick'; end if;
end $$;

-- ---- The ways out: an admin's reversal of the cut brings the Gimmick back; reverse_card tells the truth about a play that is over ----
select tests.unbecome();
do $$
declare
  admin_acc uuid := tests.account('bk-e-admin');
  ann uuid := tests.account('bk-e-ann'); bob uuid := tests.account('bk-e-bob');
  a uuid := tests.character(ann, 'Bk E Ann'); b uuid := tests.character(bob, 'Bk E Bob');
  t uuid := tests.thread('Bk ends');
  pb uuid := tests.post(b, t, 'Bob''s post.'); pa uuid := tests.post(a, t, 'Ann''s post.');
  kick uuid; shot uuid; c jsonb; c2 jsonb; cut_id uuid; cut_id2 uuid; kick_ends timestamptz; why text;
begin
  insert into admins (account) values (admin_acc);
  perform pg_temp.cards();
  perform pg_temp.hand(ann, 'bkcut', 'bkmove');
  perform pg_temp.hand(bob, 'bkkick', 'bkpierce', 'bkmove', 'bkreq');
  perform tests.become_service();
  kick := (play_card(bob, 'bkkick', b, pb, '{}', 0, '') ->> 'id')::uuid;
  kick_ends := (select (x.payload ->> 'ends')::timestamptz from acts x where x.id = kick);
  c := pg_temp.cut(ann, a, pb, kick);
  cut_id := (c ->> 'id')::uuid;
  perform tests.unbecome();

  -- An admin ends the cutting play: the Kick Me is in force again for what is left of its own end.
  perform tests.become(admin_acc);
  perform reverse_card(cut_id);
  perform tests.unbecome();
  if card_cut_at(kick) is not null or card_ended(kick) then raise exception 'reversing the cut did not bring the Kick Me back'; end if;
  if (select (x.payload ->> 'ends')::timestamptz from acts x where x.id = kick) is distinct from kick_ends then raise exception 'the Kick Me''s own end changed'; end if;
  if not card_ended(cut_id) then raise exception 'the reversed cut is not over'; end if;
  perform tests.become_service();
  -- The Kick Me is live again: a Move is handed back, and a second cut can end it.
  if not (pg_temp.payload(play_card(ann, 'bkmove', a, pb, '{}', 0, '')) ? 'handedBack') then raise exception 'a Move was not handed back by the restored Kick Me'; end if;
  c2 := pg_temp.cut(ann, a, pb, kick);
  cut_id2 := (c2 ->> 'id')::uuid;
  perform tests.unbecome();
  if card_cut_at(kick) is null then raise exception 'the second cut did not end the Kick Me'; end if;

  -- reverse_card on the cut Kick Me names the cutting card; on a spent Cheap Shot, "already over"; on an admin-ended play, the words as before.
  perform tests.become(admin_acc);
  why := pg_temp.coded(format('select reverse_card(%L)', kick));
  if why is distinct from '55000 a Bk Buzzkill already ended that card; end that card to bring this one back' then raise exception 'reversing a cut Gimmick: %', why; end if;
  perform tests.unbecome();
  perform tests.become_service();
  shot := (play_card(bob, 'bkpierce', b, b, '{}', 0, '', 'character', pb) ->> 'id')::uuid;
  perform play_card(bob, 'bkmove', b, pa, '{}', 0, '');
  perform tests.unbecome();
  if not card_ended(shot) then raise exception 'the Move did not spend the Cheap Shot'; end if;
  perform tests.become(admin_acc);
  why := pg_temp.coded(format('select reverse_card(%L)', shot));
  if why is distinct from '55000 that card is already over' then raise exception 'reversing a spent Cheap Shot: %', why; end if;
  -- An admin's own end keeps its words, even over a cut Gimmick: end the cutting play, then the Kick Me, then the Kick Me again.
  perform reverse_card(cut_id2);
  perform reverse_card(kick);
  why := pg_temp.coded(format('select reverse_card(%L)', kick));
  if why is distinct from '55000 an admin has already ended that card' then raise exception 'reversing an admin-ended play: %', why; end if;
  why := pg_temp.coded(format('select reverse_card(%L)', cut_id2));
  if why is distinct from '55000 an admin has already ended that card' then raise exception 'reversing the reversed cut: %', why; end if;
  perform tests.unbecome();
end $$;

-- ---- Settlement: a cut play is sent with the cut end; reversed, with its own; a cut play is never voided whole ----
select tests.unbecome();
do $$
declare
  admin_acc uuid := tests.account('bk-st-admin');
  ann uuid := tests.account('bk-st-ann'); bob uuid := tests.account('bk-st-bob'); cat uuid := tests.account('bk-st-cat');
  a uuid := tests.character(ann, 'Bk St Ann'); b uuid := tests.character(bob, 'Bk St Bob'); c uuid := tests.character(cat, 'Bk St Cat');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Bk settlement thread');
  pb uuid; kick uuid; cutp uuid; got jsonb; input jsonb; want bigint; own bigint;
begin
  insert into admins (account) values (admin_acc);
  perform pg_temp.cards();
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  pb := tests.post(b, t, 'Bob''s post.', w0 - interval '20 hours');
  -- t0: Bob uses a Kick Me; t1: a negative vote; t2: the cut; t3: a negative vote.
  kick := tests.act(b, 'card', t, jsonb_build_object('card', 'bkkick', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', w0 + interval '73 hours'), pb, w0 + interval '1 hour');
  cutp := tests.act(a, 'card', t, jsonb_build_object('card', 'bkcut', 'message', '', 'config', jsonb_build_object('play', kick), 'instant', true, 'cut', jsonb_build_object('play', kick, 'card', 'bkkick')), pb, w0 + interval '3 hours');
  insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    (pb, c, cat, 'boo', 1, w0 + interval '2 hours'), (pb, c, cat, 'meh', 2, w0 + interval '4 hours');
  want := (extract(epoch from (w0 + interval '3 hours')) * 1000)::bigint;
  own := (extract(epoch from (w0 + interval '73 hours')) * 1000)::bigint;

  input := settlement_input(w0, w1);
  got := (select e from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = kick::text);
  if got is null then raise exception 'settlement_input lost the cut Kick Me: %', input -> 'acts'; end if;
  if (got ->> 'ends')::bigint is distinct from want then raise exception 'settlement_input did not send the cut end: % (wanted %)', got, want; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'ended') e where e #>> '{}' = kick::text) or input ->> 'ended' like '%' || kick::text || '%' then raise exception 'a cut play joined the list that voids a play: %', input -> 'ended'; end if;
  -- Both votes are in the input; the engine pays only inside [at, ends), so the first is paid and the second is not.
  if (select count(*) from jsonb_array_elements(input -> 'reactions') r where r ->> 'act' = pb::text) is distinct from 2::bigint then raise exception 'the votes on the post are not both in the input: %', input -> 'reactions'; end if;
  -- The estimate for Bob agrees.
  perform tests.become_service();
  got := (select e from jsonb_array_elements(estimate_input(bob, w1) -> 'acts') e where e ->> 'id' = kick::text);
  if got is null or (got ->> 'ends')::bigint is distinct from want then raise exception 'estimate_input did not send the cut end: %', got; end if;
  perform tests.unbecome();

  -- Reversed before the window settles: the play is sent with its own end again.
  perform tests.become(admin_acc);
  perform reverse_card(cutp);
  perform tests.unbecome();
  got := (select e from jsonb_array_elements(settlement_input(w0, w1) -> 'acts') e where e ->> 'id' = kick::text);
  if got is null or (got ->> 'ends')::bigint is distinct from own then raise exception 'settlement_input did not send the play''s own end after the cut was reversed: % (wanted %)', got, own; end if;
  perform tests.become_service();
  got := (select e from jsonb_array_elements(estimate_input(bob, w1) -> 'acts') e where e ->> 'id' = kick::text);
  if got is null or (got ->> 'ends')::bigint is distinct from own then raise exception 'estimate_input did not send the play''s own end after the cut was reversed: %', got; end if;
  perform tests.unbecome();
end $$;

-- ---- The probe: card_cut_at is one lookup of acts_cut_play and never calls card_ended; card_ended probes it ----
select tests.unbecome();
do $$
declare
  plan_line text; plan_text text := ''; play uuid := gen_random_uuid(); def text;
begin
  analyze acts;
  perform set_config('enable_seqscan', 'off', true); perform set_config('enable_bitmapscan', 'off', true);
  for plan_line in execute format($q$explain select min(c.created_at) from acts c where c.kind = 'card' and (c.payload -> 'cut' ->> 'play') = %L and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = c.id)$q$, play::text) loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;
  perform set_config('enable_seqscan', 'on', true); perform set_config('enable_bitmapscan', 'on', true);
  if plan_text not like '%acts_cut_play%' then raise exception 'the cut probe does not use acts_cut_play: %', plan_text; end if;
  raise notice 'cut probe plan: %', plan_text;
  if not exists (select 1 from pg_indexes where indexname = 'acts_cut_play' and indexdef like '%WHERE%') then raise exception 'acts_cut_play is not a partial index'; end if;

  analyze acts;
  -- The page's read, through acts_public as PostgREST writes it. Reported either way: through the view the planner reads the payload as shown_payload(...), not acts.payload.
  plan_text := '';
  perform set_config('enable_seqscan', 'off', true); perform set_config('enable_bitmapscan', 'off', true);
  for plan_line in execute format($q$explain select * from acts_public where kind = 'card' and (payload -> 'cut' ->> 'play') in (%L, %L)$q$, play::text, gen_random_uuid()::text) loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;
  perform set_config('enable_seqscan', 'on', true); perform set_config('enable_bitmapscan', 'on', true);
  -- FINDING, pinned: through acts_public the filter does NOT reach acts_cut_play (the view's payload is shown_payload(...) of acts.payload, so the planner cannot push the predicate down to the index); the same predicate on acts does.
  if plan_text like '%acts_cut_play%' then raise exception 'acts_public now lets the cut filter reach acts_cut_play; the page can read it through the view, so say so and drop this pin: %', plan_text; end if;
  plan_text := '';
  perform set_config('enable_seqscan', 'off', true); perform set_config('enable_bitmapscan', 'off', true);
  for plan_line in execute format($q$explain select * from acts where kind = 'card' and (payload -> 'cut' ->> 'play') in (%L, %L)$q$, play::text, gen_random_uuid()::text) loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;
  perform set_config('enable_seqscan', 'on', true); perform set_config('enable_bitmapscan', 'on', true);
  if plan_text not like '%acts_cut_play%' then raise exception 'the page read of cutting plays on acts does not use acts_cut_play: %', plan_text; end if;

  plan_text := '';
  perform set_config('enable_seqscan', 'off', true); perform set_config('enable_bitmapscan', 'off', true);
  for plan_line in execute format($q$explain select a.id from acts a where a.kind = 'card' and (a.payload -> 'cut' ->> 'play') = any (%L::text[]) and not (a.payload ? 'caught')$q$, array[play::text, gen_random_uuid()::text]::text[]) loop
    plan_text := plan_text || plan_line || E'\n';
  end loop;
  perform set_config('enable_seqscan', 'on', true); perform set_config('enable_bitmapscan', 'on', true);
  if plan_text not like '%acts_cut_play%' then raise exception 'the cutting_acts read does not use acts_cut_play: %', plan_text; end if;
  if pg_get_functiondef('cutting_acts(uuid[])'::regprocedure) not like '%(a.payload -> ''cut'' ->> ''play'')%' then raise exception 'cutting_acts does not read the expression acts_cut_play holds'; end if;

  -- card_ended itself, run as the page runs it (with the scans a tiny table prefers set aside) on a play no cut names: the index scan count of acts_cut_play, read inside the transaction, goes up, so card_ended's probe reaches the partial index (and finds nothing).
  declare before bigint; after bigint;
  begin
    before := coalesce(pg_stat_get_xact_numscans('acts_cut_play'::regclass), 0);
    perform set_config('enable_seqscan', 'off', true); perform set_config('enable_bitmapscan', 'off', true);
    perform card_ended(play);
    perform set_config('enable_seqscan', 'on', true); perform set_config('enable_bitmapscan', 'on', true);
    after := coalesce(pg_stat_get_xact_numscans('acts_cut_play'::regclass), 0);
    if after <= before then raise exception 'card_ended on a play no cut names did not scan acts_cut_play (% before, % after)', before, after; end if;
    raise notice 'card_ended probed acts_cut_play: % scan(s)', after - before;
  end;
  if not coalesce((select p.proconfig @> array['plan_cache_mode=force_generic_plan', 'jit=off'] from pg_proc p where p.oid = 'cutting_acts(uuid[])'::regprocedure), false) then raise exception 'cutting_acts is not a client read that plans once (0368)'; end if;
  def := pg_get_functiondef('card_cut_at(uuid)'::regprocedure);
  if def like '%card_ended(%' then raise exception 'card_cut_at calls card_ended'; end if;
  if pg_get_functiondef('card_ended(uuid)'::regprocedure) not like '%card_cut_at(%' then raise exception 'card_ended does not ask card_cut_at'; end if;
  -- A play no Act names is not cut, and card_ended answers false for it.
  if card_cut_at(play) is not null or card_ended(play) then raise exception 'a play nobody named is cut or over'; end if;

  -- cut_refusal is nobody's to call but the definers that need it, as wards_against is not.
  if has_function_privilege('authenticated', 'cut_refusal(card_kinds, text, uuid, jsonb)', 'execute') or has_function_privilege('anon', 'cut_refusal(card_kinds, text, uuid, jsonb)', 'execute')
     or has_function_privilege('service_role', 'cut_refusal(card_kinds, text, uuid, jsonb)', 'execute') then raise exception 'cut_refusal is granted to an API role'; end if;
  if not has_function_privilege('authenticated', 'card_ended(uuid)', 'execute') then raise exception 'card_ended lost its grant'; end if;
  -- A card without cuts has no refusal.
  if cut_refusal((select k from card_kinds k where k.key = 'bkmove'), 'post', gen_random_uuid(), '{}') is not null then raise exception 'a card that does not cut has a cut refusal'; end if;
end $$;
