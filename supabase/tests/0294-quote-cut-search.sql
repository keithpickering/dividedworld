-- search_reindex_quoters() (supabase/migrations/0344_quote_cut.sql; docs/plans/2026-11-13-quote-cut-plan.md, Decision 7): bbcode_walk reads a real quote past the cap, so the words of a hidden post quoted that deep
-- are no longer in the words the insert and edit triggers write. A post_search row written before the change holds them, and a player who is not the author finds the post by them. The rewrite gives every row
-- that quotes what the triggers would write today: from the post's current raw body, a hidden version's row left as conduct leaves it, an edited post from its latest edit. The old rows are written by hand here,
-- from text that includes the marker word, the way an instance holds them.

create function pg_temp.sp(q text) returns uuid[] language sql as $$
  select coalesce(array_agg((r ->> 'act')::uuid), '{}') from jsonb_array_elements(search_posts(q, null, null, null, null, false, null, null, null) -> 'results') r $$;
create function pg_temp.deep(n integer, q uuid, words text) returns text language sql immutable as $$
  select 'before ' || repeat('[b]', n) || format('[quote=%s]%s[/quote]', q, words) || repeat('[/b]', n) || ' after'
$$;
-- A row as the walk of before the change wrote it: the quoted words in it.
create function pg_temp.old_row(a uuid, w text) returns void language sql as $$
  update post_search set words = to_tsvector(search_lang(), w) where act = a $$;

do $$
declare
  adm uuid := tests.account('cqs-admin');
  au uuid := tests.account('cqs-author');
  qu uuid := tests.account('cqs-quoter');
  rd uuid := tests.account('cqs-reader');
  ch_au uuid := tests.character(au, 'Cqs Author');
  ch_qu uuid := tests.character(qu, 'Cqs Quoter');
  th uuid := tests.thread('Quote cut search');
  base timestamptz := now() - interval '1 day';
  hid uuid; deepq uuid; shallowq uuid; selfhid uuid; edited uuid; plain_post uuid;
  before_hidden tsvector;
  n bigint;
begin
  insert into admins (account) values (adm);
  hid := tests.post(ch_au, th, 'Hidden words zqxmarker.', base);
  perform tests.become(adm);
  perform decide(null, hid, 'hide', null, 'cqs');
  perform tests.unbecome();
  -- a quote of the hidden post nested 20 deep behind bold tags (past the new cap of 16, under the old 32): written by hand as the old walk indexed it, with the quoted words
  deepq := tests.post(ch_qu, th, 'Ordinary alpha ' || pg_temp.deep(20, hid, 'Hidden words zqxmarker.'), base + interval '1 minute');
  perform pg_temp.old_row(deepq, 'ordinary alpha hidden words zqxmarker');
  -- the same quote under the cap: always read as a quote, never in the words
  shallowq := tests.post(ch_qu, th, 'Ordinary beta ' || pg_temp.deep(1, hid, 'Hidden words zqxmarker.'), base + interval '2 minutes');
  -- a post hidden itself, which quotes: its row is what conduct left (no words), and the rewrite does not index it from its raw body
  selfhid := tests.post(ch_qu, th, 'Own words zqxown ' || pg_temp.deep(20, hid, 'Hidden words zqxmarker.'), base + interval '3 minutes');
  perform tests.become(adm);
  perform decide(null, selfhid, 'hide', null, 'cqs');
  perform tests.unbecome();
  -- a quoter that was edited: its current body is the edit's, and its row is written from that
  edited := tests.post(ch_qu, th, 'Oldword ' || pg_temp.deep(20, hid, 'Hidden words zqxmarker.'), base + interval '4 minutes');
  perform tests.act(ch_qu, 'edit', th, jsonb_build_object('body', 'Newword gamma ' || pg_temp.deep(20, hid, 'Hidden words zqxmarker.')), edited, base + interval '5 minutes');
  perform pg_temp.old_row(edited, 'oldword newword gamma zqxmarker');
  -- a post that quotes nothing, with a row this rewrite has no reason to touch
  plain_post := tests.post(ch_qu, th, 'Plain delta words.', base + interval '6 minutes');
  perform pg_temp.old_row(plain_post, 'kept by hand epsilon');
  select p.words into before_hidden from post_search p where p.act = selfhid;
  if before_hidden::text like '%zqxown%' then raise exception 'the setup is wrong: a hidden post''s row holds its own words'; end if;

  -- the control: a player who is not the author finds the posts by the hidden words (the leak the rewrite closes)
  perform tests.become(rd);
  if not (deepq = any (pg_temp.sp('zqxmarker'))) then raise exception 'the setup is wrong: the old row of a deep quoter is not found by the hidden words'; end if;
  if not (edited = any (pg_temp.sp('zqxmarker'))) then raise exception 'the setup is wrong: the old row of an edited quoter is not found by the hidden words'; end if;
  perform tests.unbecome();

  n := search_reindex_quoters();

  perform tests.become(rd);
  if pg_temp.sp('zqxmarker') <> '{}'::uuid[] then raise exception 'the hidden words still find posts after the rewrite: %', pg_temp.sp('zqxmarker'); end if;
  if not (deepq = any (pg_temp.sp('alpha'))) then raise exception 'the rewrite lost the post''s own words (alpha)'; end if;
  if not (shallowq = any (pg_temp.sp('beta'))) then raise exception 'the rewrite lost the own words of a quoter under the cap (beta)'; end if;
  if not (edited = any (pg_temp.sp('gamma'))) then raise exception 'an edited post''s row does not follow its current body (gamma)'; end if;
  if edited = any (pg_temp.sp('oldword')) then raise exception 'an edited post''s row holds the words of the version before the edit'; end if;
  if not (plain_post = any (pg_temp.sp('epsilon'))) then raise exception 'a post that quotes nothing was rewritten'; end if;
  perform tests.unbecome();
  if n < 2 then raise exception 'the rewrite reports % rows written, two were stale', n; end if;
  if (select p.words from post_search p where p.act = selfhid) is distinct from before_hidden then raise exception 'a hidden post''s own row was re-indexed from its raw body'; end if;
  -- idempotent: a second run writes nothing
  if search_reindex_quoters() <> 0 then raise exception 'a second run of the rewrite wrote rows'; end if;
  -- no client runs it
  perform tests.become(rd);
  begin
    perform search_reindex_quoters();
    raise exception 'a signed-in player ran search_reindex_quoters()';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();
end $$;
