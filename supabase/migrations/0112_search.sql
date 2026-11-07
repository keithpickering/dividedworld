-- Search (docs/plans/2026-11-07-search-design.md; its plan, docs/plans/2026-11-07-search-plan.md). Begun by Task 1: a post's plain words.
--
--   bbcode_plain(body)   the words of a post as a reader sees them as the post's own, for the search index to read. It MIRRORS engine/bbcode/visible.ts (what counts as the
--                        post's own words) over engine/bbcode/parse.ts (how a post is read), step for step, in plain SQL: the same tag names, the same nesting cap
--                        (32), the same reading of a malformed tag, so a stray closer, an unknown tag, an unclosed tag, a tag past the cap and a tag whose attribute fails
--                        its check stay the text the player wrote, and a quote, code, a link and an image leave a separator and none of their words. Whitespace
--                        and separators are only a word boundary to the index, so the two are held equal after each collapses its whitespace.
--
-- The two walks are one list in two languages ("Two lists that must agree are one list"): engine/bbcode/plain.fixtures.ts is read by engine/bbcode/plain.test.ts against
-- visibleText(parse(body)), and tools/bbcode-plain.mjs makes supabase/tests/0115-bbcode-plain.sql from it, which asserts bbcode_plain on every fixture;
-- tools/check-bbcode-plain.mjs holds that file to exactly what the fixtures make, and tools/test-bbcode-plain.mjs drives the check red.
--
-- How it differs from the parser, on purpose. The parser builds a tree and the walk reads it; this keeps an explicit stack (arrays, never recursion, so 10,000 nested tags
-- cannot blow anything) and one array of output pieces that every word is appended to in place, each open tag remembering the piece where it began: a bold, italic, underline,
-- strike, color or size tag leaves its words where they are, a quote or a link with a target cuts back to where it began and leaves one separator, a list leaves a separator before
-- and after and one before each item, an image and code block leave a separator. A bare [url] is a link only when it closes around nothing but one good address, and otherwise
-- its tag, its words and its closer stay as text. The pieces are joined once at the end, so no step copies what has been written so far.
-- The text is cut into tokens once (a tag is `[`, no bracket, `]`; the rest is text), so the work grows with the post (supabase/tests/0116-bbcode-plain-scale.sql holds that to a
-- ratio on adversarial posts), and the next closer of [code] and [img] is found once from the end of the post, never by a scan per opener.
-- Lengths the parser counts in UTF-16 units (MAX_TAG, MAX_URL_LENGTH) are counted the same here (an astral character is two), by bbcode_plain_u16len.
-- A null body gives an empty string: a post with no words has none.

-- A text's length in UTF-16 units, as JavaScript counts it (an astral character is two), which is how the parser's limits are written.
create or replace function bbcode_plain_u16len(t text) returns int
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select length(t) + length(regexp_replace(t, '[^\U00010000-\U0010FFFF]', '', 'g'))
$$;

-- Whether an address passes the parser's check (safeHref: http, https, mailto or a path on this site; safeImageSrc: http or https); null is no. It mirrors
-- engine/bbcode/parse.ts checkedUrl, goodAuthority and BAD_URL_CHAR, and the JavaScript whitespace set (what String.trim removes) is written out because Postgres's depends on the locale. The characters the check refuses are Unicode's format characters (\p{Cf}, as of Unicode 17, the release
-- Node 22 reads), written out because Postgres has no property classes, and the blank-looking fillers that are not formats.
create or replace function bbcode_plain_url_ok(raw text, schemes text[], relative boolean) returns boolean
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  s text;
  sch text[];
  scheme text;
  rest text;
  authority text;
  colon int;
  host text;
begin
  if raw is null then return false; end if;
  s := regexp_replace(raw, '^[\u0009-\u000d    -     　﻿]+|[\u0009-\u000d    -     　﻿]+$', '', 'g');
  if s = '' or bbcode_plain_u16len(s) > 2048 then return false; end if;
  if s ~ '[\u0009-\u000d    -     　﻿\u0001-\u001f\u007f-\u009f"''<>`\\­؀-؅؜۝܏࢐-࢑࣢᠎​-‏‪-‮⁠-⁤⁦-⁯￹-￻\U000110bd\U000110cd\U00013430-\U0001343f\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0001\U000e0020-\U000e007f͏ᅟᅠ⠀ㅤﾠ]' then
    return false;
  end if;
  sch := regexp_match(s, '^([^:/?#]*):');
  if sch is not null then
    scheme := lower(sch[1]);
    if not (scheme = any (schemes)) then return false; end if;
    rest := substr(s, length(sch[1]) + 2);
    if scheme = 'mailto' then return rest <> ''; end if;
    authority := (regexp_match(rest, '^//([^/?#]*)'))[1];
    if authority is null then return false; end if;
    colon := strpos(authority, ':');
    host := case when colon = 0 then authority else left(authority, colon - 1) end;
    if colon > 0 and substr(authority, colon + 1) !~ '^[0-9]{1,5}$' then return false; end if;
    return host ~ '^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$' and strpos(host, '..') = 0;
  end if;
  return relative and left(s, 1) = '/' and left(s, 2) <> '//';
end
$$;

create or replace function bbcode_plain(body text) returns text
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  -- The tag names of engine/bbcode/parse.ts: BBCODE_TAGS (openers), its closers, and the ones that keep a count of how many are open.
  openers constant text[] := array['b','i','u','s','color','size','url','img','code','quote','list'];
  closers constant text[] := array['b','i','u','s','color','size','url','quote','list'];
  counted constant text[] := array['b','i','u','s','color','size','url','quote','list'];
  named constant text[] := array['black','silver','gray','grey','white','maroon','red','purple','fuchsia','green','lime','olive','yellow','navy','blue','teal','aqua','orange','pink','brown','gold','cyan','magenta','violet','indigo','crimson','coral','salmon','turquoise','tan','khaki','beige'];
  max_depth constant int := 32;       -- MAX_DEPTH
  max_tag constant int := 2064;       -- MAX_TAG: MAX_URL_LENGTH (2048) + 16
  max_raw constant int := 2112;       -- the longest image contents the parser checks: MAX_URL_LENGTH + 64
  toks text[];
  n int;
  nxt_code int[];                     -- per token, the next token after it that is [/code], or 0
  nxt_img int[];                      -- the same for [/img]
  cum int[];                          -- characters up to and including each token
  seen_code int := 0;
  seen_img int := 0;
  -- The output: out[1..oc] are the pieces written so far (a piece past oc is stale and is overwritten). The stack: frame 1 is the root. A frame that is not literal
  -- began at piece f_start, so its words are out[f_start + 1..oc]. A literal frame is an opener that became text, kept so its closer is text too; it owns nothing.
  out text[] := array[]::text[];
  oc int := 0;
  f_kind text[] := array['root'];     -- root, pass (words go up), sep (words dropped, one separator goes up), list, bareurl, literal
  f_name text[] := array[''];
  f_start int[] := array[0];
  f_depth int[] := array[0];
  f_home int[] := array[1];
  f_nodey boolean[] := array[false];  -- a node other than text was placed in this frame (a bare link is a link only around text alone)
  sp int := 1;
  cnt int[] := array_fill(0, array[9]);
  open_urls int := 0;
  t int := 1;
  unw int := 0;                       -- unwinding: 1 to a closer's name, 2 until no link is open, 3 to the end
  unw_name text;
  unw_raw text;
  links_closed boolean := false;
  tok text;
  b text;
  nm text;
  val text;
  eq int;
  idx int;
  j int;
  k text;
  fname text;
  fstart int;
  matched boolean;
  cl text;
  want text;                          -- how a tag that opens is opened: pass, sep, list, bareurl; null when it is text
  contents text;
begin
  if body is null or body = '' then return ''; end if;
  -- Tokens: a tag (`[`, no bracket, `]`), a lone `[`, or a run of text with no `[`.
  select array_agg(coalesce(m[1], m[2]) order by o) into toks
    from regexp_matches(body, '(\[[^\[\]]*\])|([^\[]+|\[)', 'g') with ordinality as r (m, o);
  n := coalesce(array_length(toks, 1), 0);
  nxt_code := array_fill(0, array[n]);
  nxt_img := array_fill(0, array[n]);
  cum := array_fill(0, array[n]);
  for j in reverse n..1 loop
    nxt_code[j] := seen_code;
    nxt_img[j] := seen_img;
    if length(toks[j]) = 7 and lower(toks[j]) = '[/code]' then seen_code := j; end if;
    if length(toks[j]) = 6 and lower(toks[j]) = '[/img]' then seen_img := j; end if;
  end loop;
  for j in 1..n loop
    cum[j] := coalesce(cum[j - 1], 0) + length(toks[j]);
  end loop;

  loop
    -- Closing frames, one a pass.
    if unw <> 0 then
      if unw = 3 and sp = 1 then exit; end if;
      if unw = 2 and open_urls = 0 then unw := 0; links_closed := true; continue; end if;
      k := f_kind[sp]; fname := f_name[sp]; fstart := f_start[sp];
      matched := unw = 1 and fname = unw_name;
      idx := array_position(counted, fname);
      if idx is not null then cnt[idx] := cnt[idx] - 1; end if;
      if k <> 'literal' and fname = 'url' then open_urls := open_urls - 1; end if;
      sp := sp - 1;
      cl := case when matched then unw_raw end;
      if k = 'literal' then
        if matched then oc := oc + 1; out[oc] := unw_raw; end if;
      else
        if k = 'pass' then
          null;                                       -- its words are already in place
        elsif k = 'list' then
          oc := oc + 1; out[oc] := E'\n';
        elsif k = 'sep' then
          oc := fstart + 1; out[oc] := E'\n';         -- drop its words, back to where it began
        else -- bareurl: a link only when closed, around nothing but text that is one good address; its opener is the piece before its start
          if cl is not null and not f_nodey[sp + 1] and bbcode_plain_url_ok(array_to_string(out[fstart + 1 : oc], ''), array['http','https','mailto'], true) then
            oc := fstart; out[oc] := E'\n';
          elsif cl is not null then
            oc := oc + 1; out[oc] := cl;
          end if;
        end if;
        f_nodey[f_home[sp]] := true;
      end if;
      if matched then unw := 0; end if;
      continue;
    end if;
    if t > n then unw := 3; continue; end if;

    tok := toks[t];
    -- Text, a lone `[`, and a tag the parser does not read: the words as written.
    if length(tok) < 2 or left(tok, 1) <> '[' then oc := oc + 1; out[oc] := tok; t := t + 1; continue; end if;
    b := substr(tok, 2, length(tok) - 2);
    if b = '' or length(b) > max_tag or (length(b) > max_tag / 2 and bbcode_plain_u16len(b) > max_tag) then
      oc := oc + 1; out[oc] := tok; t := t + 1; continue;
    end if;
    val := null;
    if b = '*' then
      nm := '*';
    elsif left(b, 1) = '/' then
      nm := lower(substr(b, 2));
      if not (nm = any (closers)) then oc := oc + 1; out[oc] := tok; t := t + 1; continue; end if;
      -- A closer with nothing open to close is text; otherwise it closes the nearest opener of its name and what was opened inside it.
      t := t + 1;
      if cnt[array_position(counted, nm)] = 0 then
        oc := oc + 1; out[oc] := tok;
      else
        unw := 1; unw_name := nm; unw_raw := tok;
      end if;
      continue;
    else
      eq := strpos(b, '=');
      nm := lower(case when eq = 0 then b else left(b, eq - 1) end);
      if not (nm = any (openers)) then oc := oc + 1; out[oc] := tok; t := t + 1; continue; end if;
      if eq > 0 then
        val := substr(b, eq + 1);
        if length(val) >= 2 and left(val, 1) = '"' and right(val, 1) = '"' then val := substr(val, 2, length(val) - 2); end if;
      end if;
    end if;

    if nm = '*' then
      -- An item marker is one only directly inside a list; elsewhere it is text.
      oc := oc + 1;
      if f_kind[f_home[sp]] = 'list' then out[oc] := E'\n'; else out[oc] := tok; end if;
      t := t + 1; continue;
    elsif nm = 'code' then
      -- Raw up to the closing tag; with none, or an attribute, only the opener is text.
      if val is null and nxt_code[t] > 0 then
        oc := oc + 1; out[oc] := E'\n'; f_nodey[f_home[sp]] := true; t := nxt_code[t] + 1; continue;
      end if;
      oc := oc + 1; out[oc] := tok; t := t + 1; continue;
    elsif nm = 'img' then
      j := nxt_img[t];
      if val is null and j > 0 and cum[j - 1] - cum[t] <= max_raw then
        contents := array_to_string(toks[t + 1 : j - 1], '');
        if bbcode_plain_u16len(contents) <= max_raw and bbcode_plain_url_ok(contents, array['http','https'], false) then
          oc := oc + 1; out[oc] := E'\n'; f_nodey[f_home[sp]] := true; t := j + 1; continue;
        end if;
      end if;
      oc := oc + 1; out[oc] := tok; t := t + 1; continue;
    end if;

    want := null;
    if nm in ('b','i','u','s') then
      if val is null then want := 'pass'; end if;
    elsif nm = 'color' then
      if val is not null and (lower(val) = any (named) or lower(val) ~ '^#([0-9a-f]{3}|[0-9a-f]{6})$') then want := 'pass'; end if;
    elsif nm = 'size' then
      if val is not null and val ~ '^[1-7]$' then want := 'pass'; end if;
    elsif nm = 'quote' then
      if val is not null and val ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then want := 'sep'; end if;
    elsif nm = 'list' then
      if val is null or val = '1' then want := 'list'; end if;
    elsif nm = 'url' then
      if val is null then
        want := 'bareurl';
      elsif bbcode_plain_url_ok(val, array['http','https','mailto'], true) then
        want := 'sep';
      end if;
      -- A link opened while another is open closes the open one first, with whatever was opened inside it.
      if want is not null and open_urls > 0 and not links_closed then unw := 2; continue; end if;
    end if;
    links_closed := false;

    if want is null or f_depth[f_home[sp]] >= max_depth then
      -- An opener that is text, kept on the stack so its closer is text too.
      oc := oc + 1; out[oc] := tok;
      sp := sp + 1;
      f_kind[sp] := 'literal'; f_name[sp] := nm; f_start[sp] := 0;
      f_depth[sp] := f_depth[sp - 1]; f_home[sp] := f_home[sp - 1]; f_nodey[sp] := false;
    else
      -- A list puts a separator before its words, and a bare link its opener (given back as text if it is not a link), so each is the piece before the frame's start.
      if want = 'list' then oc := oc + 1; out[oc] := E'\n'; elsif want = 'bareurl' then oc := oc + 1; out[oc] := tok; end if;
      sp := sp + 1;
      f_kind[sp] := want; f_name[sp] := nm; f_start[sp] := oc;
      f_depth[sp] := f_depth[f_home[sp - 1]] + 1; f_home[sp] := sp; f_nodey[sp] := false;
      if nm = 'url' then open_urls := open_urls + 1; end if;
    end if;
    cnt[array_position(counted, nm)] := cnt[array_position(counted, nm)] + 1;
    t := t + 1;
  end loop;
  return array_to_string(out[1 : oc], '');
end
$$;

-- ------------------------------------------------------------------------------------------------ Task 2: the index ----
--
-- Design sections 2, 3, 4 and 6; the plan's Task 2. A post's current plain words held as a tsvector in a row of their own beside the Act ("Append-only": the Act is never
-- touched; `effect_state` is the same kind of row), kept by a trigger on acts so no writer can forget it (a Mod Bot's post included), and rebuilt in the background when the
-- instance changes its stemming language.
--
-- Export and import: post_search and search_rebuild are public tables, so tools/export-instance.mjs carries them like any other and tools/import-instance.mjs puts them
-- back row for row. The import writes as a replica (session_replication_role), where the acts trigger below does not fire, so an imported post never gets a second row
-- from it; the rows are the ones exported. The rebuild's job is scheduled by this migration itself, so a fresh database an import goes into already has it.

-- bbcode_plain and its helpers are called by the index's trigger and the search reads, never by the API's anonymous or digest roles.
revoke execute on function bbcode_plain(text), bbcode_plain_u16len(text), bbcode_plain_url_ok(text, text[], boolean) from public, anon;
grant execute on function bbcode_plain(text), bbcode_plain_u16len(text), bbcode_plain_url_ok(text, text[], boolean) to authenticated, service_role;

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- The text an index of names and titles folds to: lower case, accents off. The wrapper an index expression needs, since unaccent itself is only stable. It is called with the
-- privileges of whoever writes a thread or a character, so it is executable by everyone who may.
create function fold_text(t text) returns text
language sql immutable parallel safe as $$ select lower(extensions.unaccent('extensions.unaccent'::regdictionary, t)) $$;

create index threads_title_trgm on threads using gin (fold_text(title) extensions.gin_trgm_ops);
create index characters_name_trgm on characters using gin (fold_text(name) extensions.gin_trgm_ops);

-- ------------------------------------------------------------------------------------------------ the two settings ----

-- settings_held (0104), also holding `searchLanguage` (a text search configuration this database holds, which the stemming follows) and `searchRankPool` (how many of the
-- newest matches a relevance search ranks, design section 6). Everything else as 0104 wrote it.
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $$;

-- screen_settings (0084), also showing the two search settings: neither is a private fact. Everything else as 0084 wrote it.
create or replace view screen_settings as
  select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
         || jsonb_build_object('cardEconomy', (
              select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
              from settings x cross join lateral jsonb_each(x.value) e
              where x.key = 'economy' and jsonb_typeof(x.value) = 'object'
                and e.key in (select k.price_setting from card_kinds k union select unnest(k.reads) from card_kinds k))) as settings
  from settings s
  where s.key in ('postsPerPage', 'hotReplies', 'editGrace', 'reactionCap', 'charactersPerPlayer', 'invitesPerPlayer', 'inviteLifetime',
                  'turnCooldown', 'walletCap', 'postMaxLength', 'titleMaxLength', 'registrationMode', 'settlementLength', 'cardSettings',
                  'presencePollSeconds', 'presenceWindow', 'toastDefaults', 'economy', 'staffGroup', 'searchLanguage', 'searchRankPool');

-- ------------------------------------------------------------------------------------------------- the index ----

-- One row per post or spin: its Act, thread, author, time and words. The board is not copied (a search joins threads for it). Readable by signed-in players as the Acts are.
create table post_search (
  act uuid primary key references acts (id),
  thread uuid not null,
  character uuid,
  created_at timestamptz not null,
  words tsvector not null
);
alter table post_search enable row level security;
create policy post_search_read on post_search for select to authenticated using (true);
revoke all on post_search from anon, authenticated;
grant select on post_search to authenticated;
create index post_search_words on post_search using gin (words);
create index post_search_newest on post_search (created_at desc, act desc);
create index post_search_character on post_search (character, created_at desc);
create index post_search_thread on post_search (thread);

-- The stemming language the index is written in: the instance's setting, and the language-neutral `simple` before an instance is seeded.
create function search_lang() returns regconfig
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (s.value #>> '{}')::regconfig from settings s where s.key = 'searchLanguage'), 'simple'::regconfig)
$$;

-- A post's words: its title (a thread's first post only) at weight A, and its body's plain words (bbcode_plain, so a tag's name, a quote's and a link's address are not words).
create function search_words(body text, title text, lang regconfig) returns tsvector
language sql stable set search_path = public, pg_temp as $$
  select setweight(to_tsvector(lang, coalesce(title, '')), 'A') || to_tsvector(lang, bbcode_plain(body))
$$;
create function search_words(body text, title text) returns tsvector
language sql stable set search_path = public, pg_temp as $$ select search_words(body, title, search_lang()) $$;

-- The words an Act's row should hold now: its current version (the latest edit's body over a post's own), with its thread's title where it is the thread's first.
create function search_words_of(act_id uuid, lang regconfig) returns tsvector
language sql stable security definer set search_path = public, pg_temp as $$
  select search_words(a.current_payload ->> 'body', case when a.seq = 1 then t.title end, lang)
  from acts_public a join threads t on t.id = a.thread where a.id = act_id
$$;

-- Keeps the row beside each post or spin, and the words of an edited post. Nothing else gets a row. An edit counts only if it is the post's latest (the one acts_public shows),
-- so an edit written late never undoes a newer one.
create function acts_search() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  title text;
  tseq integer;
begin
  if new.kind in ('post', 'spin') then
    select t.title into title from threads t where t.id = new.thread and new.seq = 1;
    insert into post_search (act, thread, character, created_at, words)
    values (new.id, new.thread, new.character, new.created_at, search_words(new.payload ->> 'body', title));
  elsif new.kind = 'edit' then
    if exists (select 1 from acts x where x.kind = 'edit' and x.target_act_id = new.target_act_id and (x.created_at, x.id) > (new.created_at, new.id)) then return null; end if;
    select p.seq into tseq from acts p where p.id = new.target_act_id;
    select t.title into title from threads t where t.id = new.thread and tseq = 1;
    update post_search set words = search_words(new.payload ->> 'body', title) where act = new.target_act_id;
  end if;
  return null;
end $$;
create trigger acts_search after insert on acts for each row when (new.kind in ('post', 'spin', 'edit')) execute function acts_search();

-- Indexes every post and spin that has no row, by its current version. Run once below for the posts written before the trigger; safe to run again. Returns how many it wrote.
create function search_backfill() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  insert into post_search (act, thread, character, created_at, words)
  select a.id, a.thread, a.character, a.created_at, search_words(a.current_payload ->> 'body', case when a.seq = 1 then t.title end)
  from acts_public a join threads t on t.id = a.thread
  where a.kind in ('post', 'spin') and not exists (select 1 from post_search p where p.act = a.id)
  on conflict (act) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
select search_backfill();

-- ----------------------------------------------------------------------------------------- the language's way to change ----

-- One row at most: the rebuild under way, and the last Act it rewrote (null before the first run). Its way out: the job rewrites a batch a minute in Act-id order and deletes the
-- row after the last, so searching goes on meanwhile (rows not yet rewritten are in the old language, and still match their own words).
create table search_rebuild (
  only_one boolean primary key default true check (only_one),
  after_act uuid
);
alter table search_rebuild enable row level security;
revoke all on search_rebuild from anon, authenticated;

-- A new or changed searchLanguage records a rebuild, starting it over if one was under way, when there are rows to rewrite.
create function settings_search_language() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' or old.value is distinct from new.value) and exists (select 1 from post_search) then
    insert into search_rebuild (only_one, after_act) values (true, null) on conflict (only_one) do update set after_act = null;
  end if;
  return null;
end $$;
create trigger settings_search_language after insert or update on settings
  for each row when (new.key = 'searchLanguage') execute function settings_search_language();

-- The job's body: rewrites the next `batch` rows (5,000 a run) in the setting's language and returns how many. After the last the record is deleted. Two runs at once cannot
-- both hold the record, so the second does nothing.
create function search_rebuild_step(batch integer default 5000) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rb search_rebuild%rowtype;
  lang regconfig := search_lang();
  n integer;
  last_act uuid;
begin
  select * into rb from search_rebuild for update skip locked;
  if not found then return 0; end if;
  with next as (select p.act from post_search p where rb.after_act is null or p.act > rb.after_act order by p.act limit batch),
       rewritten as (update post_search p set words = search_words_of(p.act, lang) from next where p.act = next.act returning p.act)
  select count(*)::integer, (array_agg(r.act order by r.act desc))[1] into n, last_act from rewritten r;
  if n < batch then
    delete from search_rebuild;
  else
    update search_rebuild set after_act = last_act;
  end if;
  return n;
end $$;

create function schedule_search_rebuild() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-search-rebuild', '* * * * *', 'select public.search_rebuild_step()');
end $$;
select schedule_search_rebuild();

revoke execute on function acts_search(), search_backfill(), search_words_of(uuid, regconfig), settings_search_language(), search_rebuild_step(integer), schedule_search_rebuild()
  from public, anon, authenticated;
grant execute on function search_rebuild_step(integer) to service_role;
-- The reads (Task 3) are security invoker and call these; they say only what a setting and a text are. fold_text is called by whoever writes a thread or a character (an index
-- expression runs with the writer's privileges), and by the suggest list; none is a visitor's or the digest role's.
revoke execute on function fold_text(text), search_lang(), search_words(text, text), search_words(text, text, regconfig) from public, anon;
grant execute on function fold_text(text), search_lang(), search_words(text, text), search_words(text, text, regconfig) to authenticated, service_role;
