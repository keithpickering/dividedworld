-- The BBCode tags in the database (supabase/migrations/0118_bbcode_tags.sql, Task 7; docs/plans/2026-11-07-bbcode-tags-plan.md).
--
-- bbcode_plain's walk of every tag is held by the fixtures (0117) and its cost by 0118; this file holds what only the database does:
-- 1. A post written now is indexed by the new walk: a spoiler's words match and its tag and title do not, a counterfeit quote's words match and a real quote's do not.
-- 2. The reindex (search_reindex(), which the migration runs once) rewrites every row from its post's current version: a row left as the old walk wrote it (the
--    tags and a counterfeit quote's name as words) is made as the new walk writes it, an empty row is filled, and an edited post is indexed by its edit.
-- 3. No API role can run the reindex, and bbcode_plain still answers a signed-in player.

create function pg_temp.matches(act_id uuid, q text) returns boolean language sql as $$
  select coalesce((select words @@ websearch_to_tsquery('simple', q) from post_search where act = act_id), false)
$$;

do $test$
declare
  ann uuid := tests.account('ann');
  a uuid := tests.character(ann, 'Alice');
  t1 uuid := tests.thread('Reindexed thread');
  spoiled uuid;
  countered uuid;
  real_quoted uuid;
  edited uuid;
  n bigint;
  total bigint;
  stale bigint;
  cur_act uuid;
  cur_ctid tid;
begin
  -- 1. A post written now.
  spoiled := tests.post(a, t1, 'before [spoiler=Twist]hidden words[/spoiler] after');
  countered := tests.post(a, t1, '[quote=Geno Wario user=0f8fad5b-d9cb-469f-a165-70867728950e]forged words[/quote]');
  real_quoted := tests.post(a, t1, '[quote=' || spoiled || ']real quoted words[/quote]mine');
  if not pg_temp.matches(spoiled, 'hidden') or not pg_temp.matches(spoiled, 'before') then raise exception 'a spoiler''s words are not indexed'; end if;
  if pg_temp.matches(spoiled, 'spoiler') or pg_temp.matches(spoiled, 'twist') then raise exception 'a spoiler''s tag or title is indexed as words'; end if;
  if not pg_temp.matches(countered, 'forged') then raise exception 'a counterfeit quote''s words are not indexed'; end if;
  if pg_temp.matches(countered, 'geno') or pg_temp.matches(countered, 'wario') then raise exception 'a counterfeit quote''s name is indexed as words'; end if;
  if pg_temp.matches(real_quoted, 'real') or not pg_temp.matches(real_quoted, 'mine') then raise exception 'a real quote''s words are indexed, or the quoter''s are not'; end if;

  -- 2. Rows as the old walk wrote them, and an empty one.
  update post_search set words = to_tsvector('simple', 'before [spoiler=Twist]hidden words[/spoiler] after') where act = spoiled;
  update post_search set words = to_tsvector('simple', '[quote=Geno Wario user=0f8fad5b-d9cb-469f-a165-70867728950e]forged words[/quote]') where act = countered;
  update post_search set words = ''::tsvector where act = real_quoted;
  if not pg_temp.matches(spoiled, 'spoiler') or not pg_temp.matches(countered, 'wario') then raise exception 'the test did not set the old rows up'; end if;
  edited := tests.post(a, t1, 'first version');
  perform tests.act(a, 'edit', t1, jsonb_build_object('body', 'second [ispoiler]version[/ispoiler] with [noparse][b]raw[/b][/noparse]'), edited);
  update post_search set words = to_tsvector('simple', 'first version') where act = edited;

  perform tests.post(a, t1, 'a post already current');
  select count(*) into total from post_search;
  select count(*) into stale from post_search p where p.words is distinct from search_words_of(p.act, search_lang());
  if stale < 4 or stale >= total then raise exception 'the test did not leave some rows stale and some current (% of %)', stale, total; end if;
  select p.act, p.ctid into cur_act, cur_ctid from post_search p where p.words is not distinct from search_words_of(p.act, search_lang()) limit 1;
  n := search_reindex();
  if n is distinct from stale then raise exception 'the reindex rewrote % rows, and % were stale', n, stale; end if;
  if cur_act is null or not exists (select 1 from post_search p where p.act = cur_act and p.ctid = cur_ctid) then raise exception 'a row already current was rewritten'; end if;
  if pg_temp.matches(spoiled, 'spoiler') or not pg_temp.matches(spoiled, 'hidden') then raise exception 'the reindex left a spoiler''s tag as a word, or lost its words'; end if;
  if not pg_temp.matches(countered, 'forged') or pg_temp.matches(countered, 'wario') then raise exception 'the reindex did not index a counterfeit quote as the new walk does'; end if;
  if not pg_temp.matches(real_quoted, 'mine') or pg_temp.matches(real_quoted, 'real') then raise exception 'the reindex did not fill an empty row from its post'; end if;
  if pg_temp.matches(edited, 'first') or not pg_temp.matches(edited, 'second') or pg_temp.matches(edited, 'ispoiler') or not pg_temp.matches(edited, 'raw') then
    raise exception 'the reindex did not index the post''s current version (an edit''s words, an inline spoiler''s and a noparse''s)';
  end if;
  if exists (select 1 from post_search p where p.words is distinct from search_words_of(p.act, search_lang())) then raise exception 'a row differs from the words of its post after the reindex'; end if;
  if search_reindex() <> 0 then raise exception 'a second reindex rewrote a row that was current'; end if;
end
$test$;

-- 3. The API roles cannot run the reindex; bbcode_plain is theirs only as signed-in players.
do $test$
begin
  if has_function_privilege('authenticated', 'search_reindex()', 'execute') or has_function_privilege('anon', 'search_reindex()', 'execute') then
    raise exception 'an API role can run the reindex';
  end if;
  if not has_function_privilege('authenticated', 'bbcode_plain(text)', 'execute') or has_function_privilege('anon', 'bbcode_plain(text)', 'execute') then
    raise exception 'bbcode_plain is not granted as 0117 left it';
  end if;
  if has_function_privilege('anon', 'bbcode_plain_video_ok(text)', 'execute') or not has_function_privilege('authenticated', 'bbcode_plain_video_ok(text)', 'execute') then
    raise exception 'a helper of bbcode_plain is not granted as bbcode_plain is';
  end if;
end
$test$;
