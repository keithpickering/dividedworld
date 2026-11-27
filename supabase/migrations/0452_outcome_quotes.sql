-- A Mod's outcome post quotes what it answers (docs/plans/2026-11-27-outcome-quotes-plan.md, Task 1; the owner's answer on #1205: "Yes, let's do the rendered quote").
--
-- Every outcome post (a filing, a concession, an infraction's, a ban's and a move's ruling) and the Banlist's ban entry opens with a real `[quote=<act>]` of what it answers, written by the code ahead of the Mod's words, in the form a player's
-- quote has (engine/ui/composer/text.ts quoteText): the target's opening words, a line break, then the Mod's words. The head (the author, Post #seq) is drawn from the Act at render time, as for any real quote.
--
-- 1. outcome_quote(target, room): the quote, or null. Its words are a selection's, not a whole-post copy's: the words of the target's current version a reader sees, as the forged-quote check reads them (the version's quote_sources
--    row, bbcode_walk's `source`: quote_norm of the words, whitespace collapsed), so they are a verbatim run of it and the check cannot call them forged. The current version is the latest edit that is not hidden, else the Act itself
--    (a post, a spin, or a move, whose said line is its payload's `body`), found in the order quote_forged reads them. All of the words when they fit; otherwise the first 280 characters cut at a word (a word longer than that is cut
--    hard) and `…`, which quote_norm drops. The words stop at a cut mark of the source (a quote's own cut), which is no word. Words that could read as a tag (a `[` or `[/` and then a letter or `*`, asTyped's guard) are wrapped in [noparse], as engine/ui/composer/text.ts asTyped wraps a selection that
--    looks like a tag, and a `[/noparse]` among them is split so it cannot end the cover (`[/noparse` + `[/noparse][noparse]` + `]`, the closer's letters as they stand). `room` is how many characters the words, their `…` and their cover
--    may take in all (the caller has taken the 53 of the markup out); the words shrink until the three fit, and where not one word fits, or the target holds a live No quote (the test acts_quote_guard uses, so the quote could never
--    be written without the post being refused), or the target has no words, there is no quote. Internal: no role calls it.
-- 2. post_outcome puts it ahead of the Mod's words, in the room the post has after them (postMaxLength, with the Mod's words never cut for it); post_ban_entry names the post that tipped the bar as the entry's target.
-- 3. The forged-quote check counts a `move` with a text body as a version of itself, as a post and a spin are: acts_quote_sources writes its source (the trigger's WHEN, and a backfill for the moves already written) and quote_forged
--    reads it, so a quote of a move's said line is real and a doctored one is forged. Posts, spins and edits read as they did.
--
-- Masks: the quote is the target's public words, written as a player's quote; nothing in it, in when it is written or in whether it is left out turns on who owns any character.
-- Security: every function pins search_path ending in pg_temp; outcome_quote is internal.


-- ------------------------------------------------------------------------------ the forged-quote check counts a move ----

-- acts_quote_sources (0393_forged_quotes.sql): the function is as 0393 wrote it; its trigger now also fires for a `move` with a text body, and the moves already written get their source (a source is a row of its own, not an Act's content).
drop trigger acts_quote_sources on acts;
create trigger acts_quote_sources after insert on acts for each row
  when (new.kind in ('post', 'spin', 'edit', 'move') and jsonb_typeof(new.payload -> 'body') = 'string') execute function acts_quote_sources();
insert into quote_sources (act, source, digest)
select a.id, w.source, md5(w.source)
from acts a, lateral bbcode_walk(a.payload ->> 'body', null, act_forged(a.payload), true) w
where a.kind = 'move' and jsonb_typeof(a.payload -> 'body') = 'string'
on conflict do nothing;

-- quote_forged (0393_forged_quotes.sql), the post's own version is also a move's. Everything else as 0393 wrote it.
create or replace function quote_forged(body text, at timestamptz) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  walked jsonb;
  k text;
  quotes jsonb;
  forged uuid[] := '{}';
  pending jsonb[];
  left_over jsonb[];
  q jsonb;
  v record;
  vers refcursor;
  ph integer;
  dig text;
  src text;
  started timestamptz;
  cap constant interval := quote_search_cap();
  any_version boolean;
  spent boolean := false;
  seen_digests text[];
begin
  if body is null or body !~* '\[quote=' then return '{}'::uuid[]; end if;
  select w.held into walked from bbcode_walk(body, null, '{}', true) w;
  started := clock_timestamp();
  for k, quotes in select e.key, e.value from jsonb_each(coalesce(walked, '{}'::jsonb)) e loop
    -- Once the time cap is passed every post that is left has unmatched quotes, and is forged without a read.
    if spent then forged := forged || k::uuid; continue; end if;
    -- The quotes of the post, each distinct one once, none matched yet. Each version's text is read once and every pending quote is tested against it; the rule is as before: the post is forged when
    -- some quote of it stands in no eligible version (design, section 2 and 5), and no version at all (an id that is no Act, an Act with no text body, every version hidden or after `at`) is forged.
    pending := array(select distinct j from jsonb_array_elements(quotes) j);
    any_version := false;
    seen_digests := '{}';
    -- The eligible versions, newest first, a text seen already (by digest) once, a hidden one skipped before its text is read (only a visible version's digest is remembered, so a hidden copy of a text does not hide a visible one).
    -- They are STREAMED, so the clock bounds reading them as well as testing them: the edits come from the ordered index acts_edits (target_act_id, created_at desc, id desc; no sort, no join) one row at a time, then the
    -- post's own Act, the oldest version. Each row's source is looked up by its key in the loop, after the clock is read; a query that joined and sorted every version first would spend a time linear in the post's edits
    -- before the first read (final review G1).
    for ph in 1..2 loop
      if ph = 1 then
        open vers for select e.id, e.created_at from acts e where e.kind = 'edit' and e.target_act_id = k::uuid and e.created_at <= at order by e.created_at desc, e.id desc;
      else
        open vers for select a.id, a.created_at from acts a where a.id = k::uuid and a.kind in ('post', 'spin', 'move') and a.created_at <= at;
      end if;
      loop
        exit when cardinality(pending) = 0;
        -- The clock, before every version is fetched (a hidden one and a text seen already included: the row is found and its hiding asked), so a long history of small versions is bounded as well.
        if clock_timestamp() - started > cap then spent := true; exit; end if;
        fetch vers into v;
        exit when not found;
        select s.digest into dig from quote_sources s where s.act = v.id;
        continue when dig is null or dig = any (seen_digests) or version_hidden(v.id, k::uuid);
        seen_digests := seen_digests || dig;
        any_version := true;
        -- The text is read only now, once, for a version that is not hidden.
        select s.source into src from quote_sources s where s.act = v.id;
        left_over := '{}';
        foreach q in array pending loop
          -- The clock again, before each quote is tested: the unit that can be slow is one strpos.
          if clock_timestamp() - started > cap then spent := true; exit; end if;
          if not quote_holds(src, q) then left_over := left_over || q; end if;
        end loop;
        exit when spent;
        pending := left_over;
      end loop;
      close vers;
      exit when spent or cardinality(pending) = 0;
    end loop;
    if not any_version or cardinality(pending) > 0 then forged := forged || k::uuid; end if;
  end loop;
  return coalesce((select array_agg(f order by f) from unnest(forged) f), '{}'::uuid[]);
end $$;
revoke execute on function quote_forged(text, timestamptz) from public, anon, authenticated;

-- ----------------------------------------------------------------------------------------------- the quote ----

create function outcome_quote(target uuid, room integer) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  most constant integer := 280;                       -- engine/bbcode/outcome-quote.ts OUTCOME_QUOTE_MOST
  cutc constant text := E'﷐';                    -- bbcode_walk's cut mark
  v record;
  src text;
  s text;
  w text;
  r text;
  lim integer;
begin
  if target is null or room is null or room < 1 then return null; end if;
  -- A live No quote: the quote could not be written without the post being refused (acts_quote_guard), and write_staff_act drops the target the same way.
  if exists (select 1 from no_quote_on(outcome_quote.target)) then return null; end if;
  -- The current version, in the order quote_forged reads them: the latest edit that is not hidden, else the Act itself. A version's source is the walk of its words the forged-quote check holds a quote to.
  for v in
    select x.id from (
      select e.id, 1 as ord, e.created_at from acts e where e.kind = 'edit' and e.target_act_id = outcome_quote.target
      union all select a.id, 0, a.created_at from acts a where a.id = outcome_quote.target and a.kind in ('post', 'spin', 'move')) x
    order by x.ord desc, x.created_at desc, x.id desc
  loop
    continue when version_hidden(v.id, outcome_quote.target);
    select q.source into src from quote_sources q where q.act = v.id;
    exit;
  end loop;
  if src is null then return null; end if;
  -- The words stop at a cut mark (a quote's own cut inside the version): a cut is no word, and a quote cannot hold it.
  s := btrim(split_part(src, cutc, 1), ' ');
  if s = '' then return null; end if;
  lim := least(most, room);
  loop
    if length(s) <= lim then
      w := s;
    else
      -- The first `lim` characters cut at a word: from the last space of the first lim + 1 (a space just past the cut leaves the whole), else hard where there is no space.
      w := left(s, lim + 1);
      if strpos(w, ' ') > 0 then w := regexp_replace(w, ' [^ ]*$', ''); else w := left(s, lim); end if;
      w := btrim(w, ' ');
      if w = '' then w := left(s, lim); end if;
      w := w || '…';
    end if;
    r := case when w ~* '\[/?[a-z*]' then '[noparse]' || regexp_replace(w, '(\[/noparse)\]', '\1[/noparse][noparse]]', 'gi') || '[/noparse]' else w end;
    exit when length(r) <= room;
    lim := lim - (length(r) - room);
    if lim < 1 then return null; end if;
  end loop;
  return '[quote=' || outcome_quote.target::text || ']' || r || E'[/quote]\n';
end $$;
revoke execute on function outcome_quote(uuid, integer) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------ the writers ----

-- post_outcome (0451_outcome_posts.sql), the body is the quote of the target, in the room the post has after the Mod's words (outcome_quote), ahead of them. Everything else as 0451 wrote it.
create or replace function post_outcome(about uuid, kind text, visit uuid, staff_key text, in_thread uuid, target uuid, body text, source text, season integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap integer := greatest(coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength'), 5000), 1);
  th uuid := in_thread;
  made jsonb;
  err text;
  held outcome_posts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.outcome.' || about::text, 0));
  select * into held from outcome_posts o where o.about_act = post_outcome.about;
  if found then return jsonb_build_object('posted', false, 'existing', true, 'post', held.post_act); end if;
  begin
    if nullif(btrim(coalesce(body, ''), E' \t\n\r\f\v'), '') is null then raise exception 'no line' using errcode = 'P0001'; end if;
    if th is null and post_outcome.season is not null then
      th := banlist_thread((select x.id from seasons x where x.number = post_outcome.season order by x.id desc limit 1));
    end if;
    -- The quote of what the post answers, ahead of the Mod's words, in what the post has room for after them and the fixed markup (53 characters: the opener, the Act's id, the closer and the line break). The Mod's words are never cut for it.
    made := write_staff_act(staff_key, 'post', th, target, jsonb_build_object('body', left(coalesce(outcome_quote(target, cap - length(body) - 53), '') || body, cap)));
    insert into outcome_posts (about_act, kind, visit_act, source, post_act) values (about, post_outcome.kind, visit, post_outcome.source, (made ->> 'id')::uuid);
    return jsonb_build_object('posted', true, 'existing', false, 'post', (made ->> 'id')::uuid);
  exception when others then
    err := left(sqlerrm, 500);
    raise warning 'post_outcome: % % posted nothing: % (%)', kind, about, sqlerrm, sqlstate;
  end;
  insert into outcome_posts (about_act, kind, visit_act, source, error) values (about, post_outcome.kind, visit, post_outcome.source, err);
  return jsonb_build_object('posted', false, 'existing', false, 'error', err);
end $$;
revoke execute on function post_outcome(uuid, text, uuid, text, uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;

-- post_ban_entry (0451_outcome_posts.sql), the entry's target is the post that tipped the bar (the infraction's about_act), so the entry quotes it. Everything else as 0451 wrote it.
create or replace function post_ban_entry(ban uuid, line text, source text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o bans_owed%rowtype;
  held outcome_posts%rowtype;
  head text;
  said text;
  src text := post_ban_entry.source;
  lines jsonb;
  mod_id uuid;
  banned text;
  missing text;
  tipped uuid;
begin
  if src is null or src not in ('model', 'stock') then raise exception 'an entry is the model''s or the stock''s, not %', coalesce(src, 'nothing') using errcode = '22023'; end if;
  select * into o from bans_owed b where b.ban_act = post_ban_entry.ban;
  if not found then return jsonb_build_object('posted', false, 'existing', false, 'owed', false); end if;
  select * into held from outcome_posts x where x.about_act = post_ban_entry.ban;
  if found then return jsonb_build_object('posted', false, 'existing', true, 'post', held.post_act); end if;
  head := ban_entry_head(post_ban_entry.ban);
  -- The post that tipped the bar (the infraction's about_act): what the entry quotes, in another thread.
  tipped := (select (i.payload ->> 'about_act')::uuid from acts b join acts i on i.id = (b.payload ->> 'infraction_act')::uuid where b.id = post_ban_entry.ban);
  select string_agg(k, ' and ') into missing from (values ('banlistThreadTitle'), ('banlistEntry')) w(k)
  where not exists (select 1 from settings s where s.key = 'copy' and jsonb_typeof(s.value -> w.k) = 'string' and btrim(s.value ->> w.k) <> '');
  if missing is not null or head is null then
    -- The words are the instance's to give: without them nothing is posted and nothing is opened, and the ban stands.
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.outcome.' || post_ban_entry.ban::text, 0));
    insert into outcome_posts (about_act, kind, visit_act, source, error)
    values (post_ban_entry.ban, 'banned', null, src, left('the instance gives no words for copy.' || coalesce(missing, 'banlistEntry') || '; seed them', 500))
    on conflict (about_act) do nothing;
    -- Where a writer got there first (a race), its row stands and that is the answer, as the early return above gives it.
    if not found then
      select * into held from outcome_posts x where x.about_act = post_ban_entry.ban;
      return jsonb_build_object('posted', false, 'existing', true, 'post', held.post_act);
    end if;
    return jsonb_build_object('posted', false, 'existing', false, 'error', 'no words');
  end if;
  if src = 'model' then said := left(btrim(coalesce(line, ''), E' \t\n\r\f\v'), 280); end if;
  if src = 'model' and nullif(said, '') is null then src := 'stock'; said := null; end if;
  if src = 'stock' then
    lines := stock_lines('banEntry', o.staff);
    mod_id := (select c.id from characters c where c.staff = o.staff);
    banned := (select c.name from characters c join acts b on b.id = post_ban_entry.ban where c.id = (b.payload ->> 'character')::uuid);
    if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
      said := fill_tokens(lines ->> concession_line_index(post_ban_entry.ban, jsonb_array_length(lines)), jsonb_build_object('mod', coalesce((select c.name from characters c where c.id = mod_id), ''), 'banned', coalesce(banned, '')) || pronoun_tokens('mod', mod_id));
    end if;
  end if;
  return post_outcome(post_ban_entry.ban, 'banned', null, o.staff, null, tipped, head || case when said is not null then E'\n\n' || said else '' end, src, o.season);
end $$;
revoke execute on function post_ban_entry(uuid, text, text) from public, anon, authenticated;
grant execute on function post_ban_entry(uuid, text, text) to service_role;
