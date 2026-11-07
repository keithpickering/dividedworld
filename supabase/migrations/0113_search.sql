-- Search (docs/plans/2026-11-07-search-design.md; its plan, docs/plans/2026-11-07-search-plan.md). Begun by Task 1: a post's plain words.
--
--   bbcode_plain(body)   the words of a post as a reader sees them as the post's own, for the search index to read. It MIRRORS engine/bbcode/visible.ts (what counts as the
--                        post's own words) over engine/bbcode/parse.ts (how a post is read), step for step, in plain SQL: the same tag names, the same nesting cap
--                        (32), the same reading of a malformed tag, so a stray closer, an unknown tag, an unclosed tag, a tag past the cap and a tag whose attribute fails
--                        its check stay the text the player wrote, and a quote, code, a link and an image leave a separator and none of their words. Whitespace
--                        and separators are only a word boundary to the index, so the two are held equal after each collapses its whitespace.
--
-- The two walks are one list in two languages ("Two lists that must agree are one list"): engine/bbcode/plain.fixtures.ts is read by engine/bbcode/plain.test.ts against
-- visibleText(parse(body)), and tools/bbcode-plain.mjs makes supabase/tests/0116-bbcode-plain.sql from it, which asserts bbcode_plain on every fixture;
-- tools/check-bbcode-plain.mjs holds that file to exactly what the fixtures make, and tools/test-bbcode-plain.mjs drives the check red.
--
-- How it differs from the parser, on purpose. The parser builds a tree and the walk reads it; this keeps an explicit stack (arrays, never recursion, so 10,000 nested tags
-- cannot blow anything) and one array of output pieces that every word is appended to in place, each open tag remembering the piece where it began: a bold, italic, underline,
-- strike, color or size tag leaves its words where they are, a quote or a link with a target cuts back to where it began and leaves one separator, a list leaves a separator before
-- and after and one before each item, an image and code block leave a separator. A bare [url] is a link only when it closes around nothing but one good address, and otherwise
-- its tag, its words and its closer stay as text. The pieces are joined once at the end, so no step copies what has been written so far.
-- The text is cut into tokens once (a tag is `[`, no bracket, `]`; the rest is text), so the work grows with the post (supabase/tests/0117-bbcode-plain-scale.sql holds that to a
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
  piece text;
  core int;                          -- the length of contents up to its last character that is not a blank
  tail_len int;
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
          -- Its words are joined piece by piece and given up past the longest address: a slice of out would copy the whole array each time, and the words past that length cannot be an address.
          -- The parser trims the words before it checks their length, so the blanks that lead are not joined and a piece's trailing blanks do not count: it stops only once the words up to the last character that is not a blank pass the longest address, and then the trimmed words are too long whatever follows. Each piece is trimmed once, so the join stays bounded and linear.
          contents := ''; core := 0;
          if cl is not null and not f_nodey[sp + 1] then
            for j in fstart + 1..oc loop
              piece := out[j];
              if contents = '' then piece := regexp_replace(piece, '^[\u0009-\u000d    -     　﻿]+', ''); end if;
              if piece = '' then continue; end if;
              tail_len := length(regexp_replace(piece, '[\u0009-\u000d    -     　﻿]+$', ''));
              if tail_len > 0 then core := length(contents) + tail_len; end if;
              contents := contents || piece;
              if core > 2048 then exit; end if;
            end loop;
          end if;
          if cl is not null and not f_nodey[sp + 1] and bbcode_plain_url_ok(contents, array['http','https','mailto'], true) then
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
        contents := '';                               -- joined token by token, since a slice of toks would copy the whole array each time; the check above bounds it
        for idx in t + 1..j - 1 loop contents := contents || toks[idx]; end loop;
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

-- One row per post or spin: its Act, thread, board, author, time and words. Readable by signed-in players as the Acts are.
--
-- The board is copied onto the row and `first` (the thread's seq-1 post, the one whose words carry the title) is kept beside it, so that a search filtered by board, or by titles only, is
-- bounded by the matches of that filter and not by every match of its word across the instance ("Weigh a design at the scale of a busy instance"). A filter on a join to threads or to
-- acts is applied after the word's matches are read: at 200,000 posts, "common" in 66,666 of them, a board holding a tenth of the threads read all 66,666 to keep 5,001, and the pool, the
-- count and the walk's budget all counted after that filter. With the board on the row, the index (board, words) finds only the board's matches and the keyset index (board, created_at,
-- act) walks only the board in time order. This amends the design's section 4 ("the board is not copied"), and the sync answers its concern for staleness: the acts trigger and the
-- backfill write both columns, the rebuild rewrites words alone, and the trigger on threads below rewrites board when a thread's board changes (nothing moves a thread today). The title
-- is in the first post's words at weight A, so titles only is the partial indexes `where first`, a thread's worth of rows and not a post's. A thread's board and first post never change
-- otherwise, and the export carries the columns like any others (post_search is a public table).
create table post_search (
  act uuid primary key references acts (id),
  thread uuid not null,
  board uuid not null,
  first boolean not null,
  character uuid,
  created_at timestamptz not null,
  words tsvector not null
);
alter table post_search enable row level security;
create policy post_search_read on post_search for select to authenticated using (true);
revoke all on post_search from anon, authenticated;
grant select on post_search to authenticated;
-- btree_gin is a contrib extension that ships with Postgres (and with Supabase): it lets a GIN index hold a plain column beside the words, so one index scan finds the board's matches.
create extension if not exists btree_gin with schema extensions;
create index post_search_words on post_search using gin (words);
create index post_search_board_words on post_search using gin (board, words);
create index post_search_first_words on post_search using gin (board, words) where first;      -- titles only, in a board or anywhere (a GIN on a subset of its columns reads those alone)
create index post_search_newest on post_search (created_at desc, act desc);
create index post_search_board_newest on post_search (board, created_at desc, act desc);       -- the board's posts in time order: the keyset walk of a board filter
create index post_search_first_newest on post_search (created_at desc, act desc) where first;  -- the same for titles only
create index post_search_first_board_newest on post_search (board, created_at desc, act desc) where first;
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
  tboard uuid;
  tseq integer;
begin
  if new.kind in ('post', 'spin') then
    select case when new.seq = 1 then t.title end, t.board into title, tboard from threads t where t.id = new.thread;
    insert into post_search (act, thread, board, first, character, created_at, words)
    values (new.id, new.thread, tboard, new.seq = 1, new.character, new.created_at, search_words(new.payload ->> 'body', title));
  elsif new.kind = 'edit' then
    if exists (select 1 from acts x where x.kind = 'edit' and x.target_act_id = new.target_act_id and (x.created_at, x.id) > (new.created_at, new.id)) then return null; end if;
    select p.seq into tseq from acts p where p.id = new.target_act_id;
    select t.title into title from threads t where t.id = new.thread and tseq = 1;
    update post_search set words = search_words(new.payload ->> 'body', title) where act = new.target_act_id;
  end if;
  return null;
end $$;
create trigger acts_search after insert on acts for each row when (new.kind in ('post', 'spin', 'edit')) execute function acts_search();

-- A thread moved to another board takes its posts with it: the copy of the board is rewritten, so a board-filtered search finds them where the thread is. No migration moves a thread
-- today; this is the sync that must exist when one does.
create function threads_search_board() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update post_search set board = new.board where thread = new.id;
  return null;
end $$;
create trigger threads_search_board after update of board on threads
  for each row when (old.board is distinct from new.board) execute function threads_search_board();

-- Indexes every post and spin that has no row, by its current version. Run once below for the posts written before the trigger; safe to run again. Returns how many it wrote.
create function search_backfill() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  insert into post_search (act, thread, board, first, character, created_at, words)
  select a.id, a.thread, t.board, a.seq = 1, a.character, a.created_at, search_words(a.current_payload ->> 'body', case when a.seq = 1 then t.title end)
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

revoke execute on function acts_search(), threads_search_board(), search_backfill(), search_words_of(uuid, regconfig), settings_search_language(), search_rebuild_step(integer), schedule_search_rebuild()
  from public, anon, authenticated;
grant execute on function search_rebuild_step(integer) to service_role;
-- The reads (Task 3) are security invoker and call these; they say only what a setting and a text are. fold_text is called by whoever writes a thread or a character (an index
-- expression runs with the writer's privileges), and by the suggest list; none is a visitor's or the digest role's.
revoke execute on function fold_text(text), search_lang(), search_words(text, text), search_words(text, text, regconfig) from public, anon;
grant execute on function fold_text(text), search_lang(), search_words(text, text), search_words(text, text, regconfig) to authenticated, service_role;

-- ------------------------------------------------------------------------------------------------- Task 3: the reads ----
--
-- Design sections 1, 5, 6, 7 and 9; the plan's Task 3. Three reads, search_posts, search_threads and search_suggest, each `language sql stable security invoker`, so each reads as the
-- caller under the caller's policies and writes nothing, and each answers from public facts alone (a post's words, its author character, its time, its thread and board, a thread's title,
-- a debuted character's name, a board's name): no result, count, order, refusal or timing reads an account, an owner or a class. An argument out of range is refused through
-- screen_refusal (0094) before anything is read.
--
-- The threads are those thread_open holds: every thread but the Updates thread (the unlisted ones included, design section 1). thread_open itself is not read here, because it is a view of
-- a dozen joins no search needs and the planner cannot drop (it would read every thread, and characters and acts with them); `threads` is read with its one rule, and the test holds the two
-- to the same set.
--
-- Why the matching is built as text. A SQL function's body is planned once, without its arguments' values, so the planner cannot tell a common word (walk the newest posts, which find
-- twenty matches at once) from a rare one (read the few matches through the GIN index and sort them); a generic plan sorts every match of a common word, measured at 0.7 s for 200,000 posts.
-- So the one place a match is found, search_matches, builds its query as text with the arguments written into it as literals (search_matches_sql, which holds every condition), and runs it:
-- the planner then sees the word and its statistics, and chooses for it, and a condition on an argument that is null is simply not written. Every value is written through format's %L (a
-- typed literal), the tsquery is made by websearch_to_tsquery before it is written, and the limit is an integer, so nothing a caller writes is ever part of the text. The function is
-- stable and security invoker, so a search reads as the caller. The text is a function of its own so that supabase/tests/0115-search.sql can read the plan of exactly what runs.
--
-- The cursor is {rank, at, act}: the rank (0 unless the search is by relevance), the time and the id of the last result shown. Newest and oldest page by (at, act) inside search_matches,
-- so page 40 costs what page 1 does. Relevance takes the newest `searchRankPool` matches, ranks them by ts_rank_cd (document length normalized) and pages through that list by
-- (rank, at, act); `pooled` says more than the pool matched, so older matches were not ranked. The count is of at most 1,001 matches (threads, for search_threads), `more` is true past 1,000.
-- Threads under newest and oldest have no pool but a bound of the same size: see search_walk and search_threads.
-- A result's cursor can hold any time and id a caller wrote, and the worst a forged one does is show a page of public posts from where it points.

-- Whether the values of a cursor cast: a time, an id and, if it has one, a rank. The casts are tried inside the function so a value out of range ("2026-13-45", 1e400) answers false and the
-- search refuses it as a cursor, where a raw cast would fail with a Postgres error. Total for any jsonb: a missing key casts to null.
create function search_cursor_cast(c jsonb) returns boolean
language plpgsql stable set search_path = public, pg_temp as $$
begin
  perform (c ->> 'at')::timestamptz, (c ->> 'act')::uuid;
  if c ? 'rank' then perform (c ->> 'rank')::float8; end if;
  return true;
exception when data_exception then
  return false;
end $$;

-- Whether a cursor is one a search gave: an object with a time that is one, an id that is one and a numeric rank that fits (a search by relevance needs it, any other takes one or none).
-- `relevance` is whether the search is by relevance (a sort of relevance, or none, with a query). A forged cursor that passes shows a page of public posts from where it points, no more.
create function search_cursor_ok(c jsonb, relevance boolean) returns boolean
language sql stable parallel safe set search_path = public, pg_temp
begin atomic
  select coalesce(jsonb_typeof(search_cursor_ok.c) = 'object'
    and jsonb_typeof(search_cursor_ok.c -> 'at') = 'string' and (search_cursor_ok.c ->> 'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+(Z|[+-][0-9:]+)?$'
    and jsonb_typeof(search_cursor_ok.c -> 'act') = 'string' and (search_cursor_ok.c ->> 'act') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (case when coalesce(search_cursor_ok.relevance, false) then jsonb_typeof(search_cursor_ok.c -> 'rank') = 'number'
              else not search_cursor_ok.c ? 'rank' or jsonb_typeof(search_cursor_ok.c -> 'rank') = 'number' end)
    and search_cursor_cast(search_cursor_ok.c), false);
end;

-- The Updates thread, the glass's and not the board's: the one thread a search leaves out (thread_open leaves it out the same way). `settings` is not a table a player reads, so this reads it as its
-- owner and says only that, which the Updates page shows anyone; null before an instance opens one.
create function search_updates_thread() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread'
$$;

-- Newest threads first, whatever a search is asked for ("newest" with an empty prefix in the suggest list): the index a global walk reads.
create index threads_last_at on threads (last_at desc nulls last, id desc);

-- The conditions that make a row of post_search (aliased `al`) a match: a text query (if there is one) in the words of its current version, the author (if one is given), the time range
-- [from_at, to_at), and with `titles_only` the first post of its thread alone and only where the query is in the title (weight A). One place, because a thread's key (below) asks the same of
-- the other matches of its thread. Written as text with every value through %L (a typed literal), so nothing a caller writes is ever part of the text.
create function search_match_conds(al text, tsq tsquery, author uuid, from_at timestamptz, to_at timestamptz, titles_only boolean)
returns text[]
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  conds text[] := '{}';
begin
  if tsq is not null and numnode(tsq) = 0 then
    conds := conds || 'false'::text;                  -- only stop words or symbols: no lexeme to find, so nothing is found
  elsif tsq is not null then
    conds := conds || format('%I.words @@ %L::tsquery', al, tsq::text);
    if titles_only then conds := conds || format('ts_filter(%I.words, %L) @@ %L::tsquery', al, '{a}', tsq::text); end if;
  end if;
  if author is not null then conds := conds || format('%I."character" = %L::uuid', al, author); end if;
  if from_at is not null then conds := conds || format('%I.created_at >= %L::timestamptz', al, from_at); end if;
  if to_at is not null then conds := conds || format('%I.created_at < %L::timestamptz', al, to_at); end if;
  if titles_only then conds := conds || format('%I.first', al); end if;
  return conds;
end $$;

-- The text of the query that finds the matches of a search, newest first (`newest`) or oldest first, from after the cursor (after_at, after_act) when it is given, at most `lim`. A row is a post
-- or a spin that search_match_conds says matches, in the board (if one is given), in a thread that is not the Updates thread.
create function search_matches_sql(q text, author uuid, board uuid, from_at timestamptz, to_at timestamptz, titles_only boolean, newest boolean, after_at timestamptz, after_act uuid, lim integer)
returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  tsq tsquery := case when btrim(coalesce(q, '')) = '' then null else websearch_to_tsquery(search_lang(), q) end;
  dir text := case when coalesce(newest, true) then 'desc' else 'asc' end;
  updates uuid := search_updates_thread();
  conds text[] := array['true'] || search_match_conds('p', tsq, author, from_at, to_at, titles_only);
begin
  if after_at is not null then
    conds := conds || format('(p.created_at, p.act) %s (%L::timestamptz, %L::uuid)', case when dir = 'desc' then '<' else '>' end, after_at,
                             coalesce(after_act, case when dir = 'desc' then 'ffffffff-ffff-ffff-ffff-ffffffffffff' else '00000000-0000-0000-0000-000000000000' end::uuid));
  end if;
  if updates is not null then conds := conds || format('p.thread <> %L::uuid', updates); end if;
  if board is not null then conds := conds || format('p.board = %L::uuid', board); end if;
  return format('select p.act, p.thread, p.board, t.title, p."character", p.created_at, p.words from post_search p join threads t on t.id = p.thread where %s order by p.created_at %s, p.act %s limit %s',
                array_to_string(conds, ' and '), dir, dir, greatest(coalesce(lim, 0), 0)::integer);
end $$;

create function search_matches(p_q text, p_author uuid, p_board uuid, p_from_at timestamptz, p_to_at timestamptz, p_titles_only boolean, p_newest boolean, p_after_at timestamptz, p_after_act uuid, p_lim integer)
returns table (act uuid, thread uuid, board uuid, title text, "character" uuid, created_at timestamptz, words tsvector)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  return query execute search_matches_sql(p_q, p_author, p_board, p_from_at, p_to_at, p_titles_only, p_newest, p_after_at, p_after_act, p_lim);
end $$;

-- The walk by time that newest and oldest page threads and count by, with a bound. A thread is found at its key: the match no other match of its thread is newer than (oldest first: older than),
-- so walking the matches in time order and keeping the keys finds each thread once, at one place, with no pool: a thread is reached however many newer matches other threads have. The test of a
-- key is a probe of post_search by thread (post_search_thread_at). What bounds the walk is the matches it reads, never the keys it finds: a word in many posts of few threads has many matches that
-- are no key, and a walk that waited for the keys would read them all. So the text below reads at most `budget` matches (and one more, to know there were more), and the keys among them are what
-- a page keeps.
create function search_walk_sql(q text, author uuid, board uuid, from_at timestamptz, to_at timestamptz, titles_only boolean, newest boolean, after_at timestamptz, after_act uuid, budget integer)
returns text
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  tsq tsquery := case when btrim(coalesce(q, '')) = '' then null else websearch_to_tsquery(search_lang(), q) end;
begin
  return format('select w.act, w.thread, w.board, w.title, w."character", w.created_at, not exists (select 1 from post_search k where k.thread = w.thread and %s and (k.created_at, k.act) %s (w.created_at, w.act)) as is_key from (%s) w',
                array_to_string(array['true'] || search_match_conds('k', tsq, author, from_at, to_at, titles_only), ' and '), case when coalesce(newest, true) then '>' else '<' end,
                search_matches_sql(q, author, board, from_at, to_at, titles_only, newest, after_at, after_act, greatest(coalesce(budget, 0), 0) + 1));
end $$;

-- Runs the walk and stops at the first of: `want` keys found; `budget` matches read. In the second case, if a match remains beyond the budget, one more row says so (`stop`, with the time and id of
-- the last match read, where the next walk resumes strictly after it); a walk that read everything left, or found its keys, has none. The text's rows come as the loop asks for them, so a page of
-- twenty keys in the first twenty matches reads about as many.
create function search_walk(p_q text, p_author uuid, p_board uuid, p_from_at timestamptz, p_to_at timestamptz, p_titles_only boolean, p_newest boolean, p_after_at timestamptz, p_after_act uuid, p_want integer, p_budget integer)
returns table (act uuid, thread uuid, board uuid, title text, "character" uuid, created_at timestamptz, stop boolean)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  r record;
  read_n integer := 0;
  kept integer := 0;
  last_at timestamptz;
  last_act uuid;
begin
  if coalesce(p_want, 0) <= 0 or coalesce(p_budget, 0) <= 0 then return; end if;
  for r in execute search_walk_sql(p_q, p_author, p_board, p_from_at, p_to_at, p_titles_only, p_newest, p_after_at, p_after_act, p_budget) loop
    if read_n >= p_budget then          -- a match beyond the budget: the walk stopped short, and resumes after the last match it read
      act := last_act; thread := null; board := null; title := null; "character" := null; created_at := last_at; stop := true;
      return next;
      return;
    end if;
    read_n := read_n + 1; last_at := r.created_at; last_act := r.act;
    if r.is_key then
      act := r.act; thread := r.thread; board := r.board; title := r.title; "character" := r."character"; created_at := r.created_at; stop := false;
      return next;
      kept := kept + 1;
      if kept >= p_want then return; end if;
    end if;
  end loop;
end $$;

create index post_search_thread_at on post_search (thread, created_at desc, act desc);

-- The card plays that reach a post and have not been ended, as the keys of the cards, oldest first, at most 8 (a face-down card has no key). Its own function so that a result's cost is one read of
-- acts by target, which supabase/tests/0115-search.sql reads the plan of.
create function search_post_cards(act uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((
    select jsonb_agg(l.card order by l.created_at, l.id)
    from (select o.payload ->> 'card' as card, o.created_at, o.id from acts_public o
          where o.kind in ('card', 'spring') and o.target_act_id = $1 and coalesce(o.payload ->> 'reach', 'post') = 'post'
            and not exists (select 1 from acts_public e where e.kind = 'card_end' and e.target_act_id = o.id)
          order by o.created_at, o.id limit 8) l), '[]'::jsonb)
$$;

-- How many of a thread's posts match a search, counted to 101 (a result shows 100 and says "more" past it): the same conditions as search_match_conds, read through post_search_thread_at.
create function search_thread_matches(thread uuid, tsq tsquery, author uuid, from_at timestamptz, to_at timestamptz, titles_only boolean) returns bigint
language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*) from (
    select 1 from post_search p2
    where p2.thread = $1
      and ($2 is null or p2.words @@ $2)
      and (not coalesce($6, false) or $2 is null or ts_filter(p2.words, '{a}') @@ $2)
      and ($3 is null or p2."character" = $3)
      and p2.created_at >= coalesce($4, '-infinity') and p2.created_at < coalesce($5, 'infinity')
      and (not coalesce($6, false) or exists (select 1 from acts_public f where f.id = p2.act and f.seq = 1))
    limit 101) z
$$;

-- A thread's page of a post, as the thread screen counts it: the post's seq over the instance's postsPerPage.

-- search_posts: see above. `author` is a character, never a player, and one that is not a debuted character finds nothing, as a character nobody holds does (both read characters_public).
create function search_posts(q text, author uuid, board uuid, from_at timestamptz, to_at timestamptz, titles_only boolean, sort text, after jsonb, per_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select case
    when char_length(coalesce(search_posts.q, '')) > 200 then screen_refusal('a search is at most 200 characters')
    when search_posts.sort is not null and search_posts.sort not in ('relevance', 'newest', 'oldest') then screen_refusal('sort is relevance, newest or oldest')
    when coalesce(search_posts.per_page, 20) not between 1 and 50 then screen_refusal('a page holds 1 to 50 results')
    when search_posts.from_at >= search_posts.to_at then screen_refusal('the range ends before it begins')
    when search_posts.after is not null and not search_cursor_ok(search_posts.after, coalesce(search_posts.sort, 'relevance') = 'relevance' and btrim(coalesce(search_posts.q, '')) <> '') then screen_refusal('that is not a cursor this search gave')
  end;

  with
  k as materialized (select btrim(coalesce(search_posts.q, '')) <> '' as has_q),
  cfg as materialized (
    select coalesce(search_posts.per_page, 20) as pp,
           coalesce((select (x.settings ->> 'searchRankPool')::integer from screen_settings x limit 1), 5000) as pool,
           coalesce((select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1), 20) as thread_pp,
           case when coalesce(search_posts.sort, 'relevance') = 'relevance' then case when k.has_q then 'relevance' else 'newest' end else search_posts.sort end as s
    from k
  ),
  tsq as materialized (select case when (select k.has_q from k) then websearch_to_tsquery(search_lang(), search_posts.q) end as t),
  au as materialized (
    select case when search_posts.author is null then null
                when exists (select 1 from characters_public c where c.id = search_posts.author) then search_posts.author
                else '00000000-0000-0000-0000-000000000000'::uuid end as id
  ),
  c as materialized (
    select (search_posts.after ->> 'rank')::float8 as rank, (search_posts.after ->> 'at')::timestamptz as at, (search_posts.after ->> 'act')::uuid as act where search_posts.after is not null
  ),
  m as materialized (
    select * from search_matches(search_posts.q, (select au.id from au), search_posts.board, search_posts.from_at, search_posts.to_at, coalesce(search_posts.titles_only, false),
      (select cfg.s <> 'oldest' from cfg),
      case when (select cfg.s from cfg) <> 'relevance' then (select c.at from c) end,
      case when (select cfg.s from cfg) <> 'relevance' then (select c.act from c) end,
      case when (select cfg.s from cfg) = 'relevance' then (select cfg.pool from cfg) + 1 else (select cfg.pp from cfg) + 1 end)
  ),
  cnt as materialized (
    select count(*) as n from search_matches(search_posts.q, (select au.id from au), search_posts.board, search_posts.from_at, search_posts.to_at, coalesce(search_posts.titles_only, false),
      true, null::timestamptz, null::uuid, 1001)
  ),
  ranked as materialized (   -- by relevance, the newest `pool` of the matches taken (the one over says there were more)
    select x.*, case when (select cfg.s from cfg) = 'relevance' then ts_rank_cd(x.words, (select tsq.t from tsq), 1)::float8 else 0::float8 end as rank
    from (select m.*, row_number() over (order by m.created_at desc, m.act desc) as rn from m) x
    where (select cfg.s from cfg) <> 'relevance' or x.rn <= (select cfg.pool from cfg)
  ),
  page as materialized (
    select r.*, row_number() over (order by r.rank desc, case when cfg.s = 'oldest' then r.created_at end asc, case when cfg.s <> 'oldest' then r.created_at end desc,
                                            case when cfg.s = 'oldest' then r.act end asc, case when cfg.s <> 'oldest' then r.act end desc) as n
    from ranked r, cfg
    where cfg.s <> 'relevance' or not exists (select 1 from c) or (r.rank, r.created_at, r.act) < ((select c.rank from c), (select c.at from c), (select c.act from c))
    order by n limit (select cfg.pp from cfg) + 1
  ),
  shown as materialized (select p.* from page p where p.n <= (select cfg.pp from cfg)),
  people as materialized (select cp.id, cp.name from characters_public cp where cp.id in (select s.character from shown s)),
  places as materialized (select b.id, b.slug, b.name from boards_now b where b.id in (select s.board from shown s))
  select jsonb_build_object(
    'count', (select cnt.n from cnt),
    'more', (select cnt.n from cnt) > 1000,
    'pooled', (select cfg.s from cfg) = 'relevance' and (select count(*) from m) > (select cfg.pool from cfg),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'act', s.act, 'thread', s.thread, 'title', s.title, 'board', s.board, 'board_slug', pl.slug, 'board_name', pl.name,
        'seq', a.seq, 'page', greatest(1, ceil(a.seq::numeric / (select cfg.thread_pp from cfg)))::integer,
        'character', s.character, 'name', pe.name, 'created_at', s.created_at,
        'snippet', case when (select tsq.t from tsq) is null then left(regexp_replace(bbcode_plain(a.current_payload ->> 'body'), '\s+', ' ', 'g'), 200)
                        else ts_headline(search_lang(), bbcode_plain(a.current_payload ->> 'body'), (select tsq.t from tsq),
                                         'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=30,MinWords=12') end,
        'cards', search_post_cards(s.act)
      ) order by s.n)
      from shown s join acts_public a on a.id = s.act left join people pe on pe.id = s.character left join places pl on pl.id = s.board), '[]'::jsonb),
    'next', (select jsonb_build_object('rank', p.rank, 'at', p.created_at, 'act', p.act) from page p
             where p.n = (select cfg.pp from cfg) and exists (select 1 from page x where x.n = (select cfg.pp from cfg) + 1))
  );
end;

-- search_threads: the same filters and rules, one result for each thread: its best match (the most relevant post, the newest or the oldest) with its snippet and how many of its posts match
-- (`matches`, counted to 100, with `matches_more` true past it). By relevance the threads are found among the pool of the newest `searchRankPool` matches, as a post is, and `pooled` says
-- there were more. Newest and oldest page by time and have no pool: a thread is keyed by its newest (oldest) match, and a page walks the matches in time order from the cursor (search_walk),
-- keeping the keys, to one past the page, but reads at most `searchRankPool` matches to do it. A page that read that many without a page's worth of keys returns the keys it found (a few, or none)
-- and a cursor at the last match it read, so Next goes on from there: every thread is reached, each once (it appears only at its key), and no page costs more than the pool, however many matches
-- other threads have or one thread has. The count, whatever the sort, is the same walk from the start to 1,001 threads or the pool's worth of matches; `more` is true past 1,000 and when the walk
-- stopped short with matches left. The cursor is the best match's {rank, at, act}; in a walk that stopped short, the last match read.
create function search_threads(q text, author uuid, board uuid, from_at timestamptz, to_at timestamptz, titles_only boolean, sort text, after jsonb, per_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select case
    when char_length(coalesce(search_threads.q, '')) > 200 then screen_refusal('a search is at most 200 characters')
    when search_threads.sort is not null and search_threads.sort not in ('relevance', 'newest', 'oldest') then screen_refusal('sort is relevance, newest or oldest')
    when coalesce(search_threads.per_page, 20) not between 1 and 50 then screen_refusal('a page holds 1 to 50 results')
    when search_threads.from_at >= search_threads.to_at then screen_refusal('the range ends before it begins')
    when search_threads.after is not null and not search_cursor_ok(search_threads.after, coalesce(search_threads.sort, 'relevance') = 'relevance' and btrim(coalesce(search_threads.q, '')) <> '') then screen_refusal('that is not a cursor this search gave')
  end;

  with
  k as materialized (select btrim(coalesce(search_threads.q, '')) <> '' as has_q),
  cfg as materialized (
    select coalesce(search_threads.per_page, 20) as pp,
           coalesce((select (x.settings ->> 'searchRankPool')::integer from screen_settings x limit 1), 5000) as pool,
           coalesce((select (x.settings ->> 'postsPerPage')::integer from screen_settings x limit 1), 20) as thread_pp,
           case when coalesce(search_threads.sort, 'relevance') = 'relevance' then case when k.has_q then 'relevance' else 'newest' end else search_threads.sort end as s
    from k
  ),
  tsq as materialized (select case when (select k.has_q from k) then websearch_to_tsquery(search_lang(), search_threads.q) end as t),
  au as materialized (
    select case when search_threads.author is null then null
                when exists (select 1 from characters_public c where c.id = search_threads.author) then search_threads.author
                else '00000000-0000-0000-0000-000000000000'::uuid end as id
  ),
  c as materialized (
    select (search_threads.after ->> 'rank')::float8 as rank, (search_threads.after ->> 'at')::timestamptz as at, (search_threads.after ->> 'act')::uuid as act where search_threads.after is not null
  ),
  m as materialized (        -- by relevance: the newest `pool` matches, and one more to say there were more; for the other sorts none
    select * from search_matches(search_threads.q, (select au.id from au), search_threads.board, search_threads.from_at, search_threads.to_at, coalesce(search_threads.titles_only, false),
      true, null::timestamptz, null::uuid, case when (select cfg.s from cfg) = 'relevance' then (select cfg.pool from cfg) + 1 else 0 end)
  ),
  ranked as materialized (
    select x.*, ts_rank_cd(x.words, (select tsq.t from tsq), 1)::float8 as rank
    from (select m.*, row_number() over (order by m.created_at desc, m.act desc) as rn from m) x
    where x.rn <= (select cfg.pool from cfg)
  ),
  best as materialized (
    select distinct on (r.thread) r.act, r.thread, r.board, r.title, r."character", r.created_at, r.rank
    from ranked r
    order by r.thread, r.rank desc, r.created_at desc, r.act desc
  ),
  walk as materialized (     -- newest or oldest: the thread keys among the next `pool` matches from the cursor on, one past a page; a last row (stop) when the matches read were not all there were
    select * from search_walk(search_threads.q, (select au.id from au), search_threads.board, search_threads.from_at, search_threads.to_at, coalesce(search_threads.titles_only, false),
      (select cfg.s <> 'oldest' from cfg), (select c.at from c), (select c.act from c), case when (select cfg.s from cfg) = 'relevance' then 0 else (select cfg.pp from cfg) + 1 end, (select cfg.pool from cfg))
  ),
  walked as materialized (
    select w.act, w.thread, w.board, w.title, w."character", w.created_at, 0::float8 as rank from walk w where not w.stop
  ),
  cnt as materialized (      -- the threads among the first `pool` matches from the start, to 1,001; cut says there were matches beyond what was read
    select count(*) filter (where not w.stop) as n, coalesce(bool_or(w.stop), false) as cut
    from search_walk(search_threads.q, (select au.id from au), search_threads.board, search_threads.from_at, search_threads.to_at, coalesce(search_threads.titles_only, false),
      true, null::timestamptz, null::uuid, 1001, (select cfg.pool from cfg)) w
  ),
  found as materialized (
    select * from best union all select * from walked
  ),
  page as materialized (
    select b.*, row_number() over (order by b.rank desc, case when cfg.s = 'oldest' then b.created_at end asc, case when cfg.s <> 'oldest' then b.created_at end desc,
                                            case when cfg.s = 'oldest' then b.act end asc, case when cfg.s <> 'oldest' then b.act end desc) as n
    from found b, cfg
    where cfg.s <> 'relevance' or not exists (select 1 from c) or (b.rank, b.created_at, b.act) < ((select c.rank from c), (select c.at from c), (select c.act from c))
    order by n limit (select cfg.pp from cfg) + 1
  ),
  shown as materialized (select p.* from page p where p.n <= (select cfg.pp from cfg)),
  people as materialized (select cp.id, cp.name from characters_public cp where cp.id in (select s.character from shown s)),
  places as materialized (select b.id, b.slug, b.name from boards_now b where b.id in (select s.board from shown s))
  select jsonb_build_object(
    'count', (select cnt.n from cnt),
    'more', (select cnt.n from cnt) > 1000 or (select cnt.cut from cnt),
    'pooled', (select cfg.s from cfg) = 'relevance' and (select count(*) from m) > (select cfg.pool from cfg),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'thread', s.thread, 'title', s.title, 'board', s.board, 'board_slug', pl.slug, 'board_name', pl.name,
        'act', s.act, 'seq', a.seq, 'page', greatest(1, ceil(a.seq::numeric / (select cfg.thread_pp from cfg)))::integer,
        'character', s.character, 'name', pe.name, 'created_at', s.created_at,
        'snippet', case when (select tsq.t from tsq) is null then left(regexp_replace(bbcode_plain(a.current_payload ->> 'body'), '\s+', ' ', 'g'), 200)
                        else ts_headline(search_lang(), bbcode_plain(a.current_payload ->> 'body'), (select tsq.t from tsq),
                                         'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=30,MinWords=12') end,
        'matches', least(h.n, 100), 'matches_more', h.n > 100
      ) order by s.n)
      from shown s join acts_public a on a.id = s.act left join people pe on pe.id = s.character left join places pl on pl.id = s.board
      cross join lateral (
        select search_thread_matches(s.thread, (select tsq.t from tsq), (select au.id from au), search_threads.from_at, search_threads.to_at, coalesce(search_threads.titles_only, false)) as n) h), '[]'::jsonb),
    'next', coalesce(
      (select jsonb_build_object('rank', p.rank, 'at', p.created_at, 'act', p.act) from page p
       where p.n = (select cfg.pp from cfg) and exists (select 1 from page x where x.n = (select cfg.pp from cfg) + 1)),
      (select jsonb_build_object('rank', 0, 'at', w.created_at, 'act', w.act) from walk w where w.stop))
  );
end;

-- ---------------------------------------------------------------------------------------------------------- suggest ----
--
-- Threads by title, characters by name and boards by name, as one types: a prefix of 2 to 100 characters (folded to lower case without accents), matched where the folded text starts with
-- it, or where one of its words is near it by trigrams (word_similarity of at least 0.3, so "mairo" finds "Mario" and "mar" finds "Super Mario"), best match first, then newest.
-- An empty prefix with kinds = {threads} lists the newest threads: the Reveal field's empty state. `most` is 1 to 10 for each kind.

-- The threads a prefix finds. A string body like suggest_characters's, so that supabase/tests/0115-search.sql reads its plan; it pins its search_path and carries the trigram threshold, so that
-- called by itself it finds what the screen's read finds. $1 is the prefix, $2 the board, $3 whether to leave out the system board, $4 how many.
create function search_suggest_threads(prefix text, board uuid, exclude_system boolean, most integer)
returns table (id uuid, title text, board uuid)
language sql stable security invoker set search_path = public, pg_temp set pg_trgm.word_similarity_threshold = '0.3' as $$
  with p as materialized (
    select fold_text(btrim(coalesce($1, ''))) as fp,
           replace(replace(replace(fold_text(btrim(coalesce($1, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select h.id, h.title, h.board
  from (
    (select t.id, t.title, t.board
     from threads t join boards bb on bb.id = t.board
     where (select p.fp from p) <> ''
       and (fold_text(t.title) like (select p.pat from p) or (select p.fp from p) operator(extensions.<%) fold_text(t.title))
       and t.id is distinct from search_updates_thread()
       and ($2 is null or t.board = $2)
       and (not coalesce($3, false) or not bb.is_system)
     order by extensions.word_similarity((select p.fp from p), fold_text(t.title)) desc, t.last_at desc nulls last, t.id desc
     limit $4)
    union all
    (select t.id, t.title, t.board
     from threads t join boards bb on bb.id = t.board
     where (select p.fp from p) = ''
       and t.id is distinct from search_updates_thread()
       and ($2 is null or t.board = $2)
       and (not coalesce($3, false) or not bb.is_system)
     order by t.last_at desc nulls last, t.id desc
     limit $4)
  ) h
$$;

-- The characters a prefix finds: only the id and the name of the characters that have debuted, which is all characters_public shows of one; `characters` is owner-only (0001), so this reads
-- it as its owner and returns nothing that depends on who owns a character. The string body is the plan a test reads. $1 is the prefix, $2 how many.
create function suggest_characters(prefix text, most integer) returns table (id uuid, name text)
language sql stable security definer set search_path = public, pg_temp set pg_trgm.word_similarity_threshold = '0.3' as $$
  with p as materialized (
    select fold_text(btrim(coalesce($1, ''))) as fp,
           replace(replace(replace(fold_text(btrim(coalesce($1, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select c.id, c.name
  from characters c
  where c.debuted_at is not null and (select p.fp from p) <> ''
    and (fold_text(c.name) like (select p.pat from p) or (select p.fp from p) operator(extensions.<%) fold_text(c.name))
  order by extensions.word_similarity((select p.fp from p), fold_text(c.name)) desc, c.name, c.id
  limit $2
$$;

create function search_suggest(prefix text, kinds text[], board uuid, exclude_system boolean, most integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp set pg_trgm.word_similarity_threshold = '0.3'
begin atomic
  select case
    when search_suggest.kinds is not null and (cardinality(search_suggest.kinds) = 0 or not coalesce(search_suggest.kinds <@ array['threads', 'characters', 'boards'], false))
      then screen_refusal('kinds are threads, characters and boards')
    when coalesce(search_suggest.most, 5) not between 1 and 10 then screen_refusal('a list holds 1 to 10 suggestions')
    when char_length(btrim(coalesce(search_suggest.prefix, ''))) > 100 then screen_refusal('a prefix is at most 100 characters')
    when char_length(btrim(coalesce(search_suggest.prefix, ''))) = 1 then screen_refusal('a prefix is at least 2 characters')
    when char_length(btrim(coalesce(search_suggest.prefix, ''))) = 0 and search_suggest.kinds is distinct from array['threads'] then screen_refusal('only the threads list takes an empty prefix')
  end;

  with p as materialized (
    select fold_text(btrim(coalesce(search_suggest.prefix, ''))) as fp,
           replace(replace(replace(fold_text(btrim(coalesce(search_suggest.prefix, ''))), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           coalesce(search_suggest.most, 5) as n,
           coalesce(search_suggest.kinds, array['threads', 'characters', 'boards']) as k
  ),
  found as materialized (
    select t.* from p, search_suggest_threads(search_suggest.prefix, search_suggest.board, search_suggest.exclude_system, p.n) t where p.k @> array['threads']
  ),
  board_names as materialized (select b.id, b.name from boards_now b where b.id in (select f.board from found f))
  select jsonb_build_object(
    'threads', case when (select p.k @> array['threads'] from p) then coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'board', t.board, 'board_name', (select bn.name from board_names bn where bn.id = t.board)))
      from found t), '[]'::jsonb) else '[]'::jsonb end,
    'characters', case when (select p.k @> array['characters'] from p) then coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name))
      from suggest_characters(search_suggest.prefix, (select p.n from p)) c), '[]'::jsonb) else '[]'::jsonb end,
    'boards', case when (select p.k @> array['boards'] from p) then coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'slug', x.slug, 'name', x.name) order by x.rank desc, x.created_at desc, x.id)
      from (select b.id, b.slug, b.name, b.created_at, extensions.word_similarity((select p.fp from p), fold_text(b.name)) as rank
            from boards_now b
            where (select p.fp from p) <> '' and (not coalesce(search_suggest.exclude_system, false) or not b.is_system)
              and (fold_text(b.name) like (select p.pat from p) or (select p.fp from p) operator(extensions.<%) fold_text(b.name))
            order by rank desc, b.created_at desc, b.id limit (select p.n from p)) x), '[]'::jsonb) else '[]'::jsonb end
  );
end;

revoke execute on function search_updates_thread(), search_cursor_cast(jsonb), search_cursor_ok(jsonb, boolean), search_match_conds(text, tsquery, uuid, timestamptz, timestamptz, boolean), search_matches_sql(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer),
  search_matches(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer), search_walk_sql(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer),
  search_walk(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer, integer), search_post_cards(uuid), search_thread_matches(uuid, tsquery, uuid, timestamptz, timestamptz, boolean),
  search_posts(text, uuid, uuid, timestamptz, timestamptz, boolean, text, jsonb, integer), search_threads(text, uuid, uuid, timestamptz, timestamptz, boolean, text, jsonb, integer),
  search_suggest_threads(text, uuid, boolean, integer), suggest_characters(text, integer), search_suggest(text, text[], uuid, boolean, integer) from public, anon;
grant execute on function search_updates_thread(), search_cursor_cast(jsonb), search_cursor_ok(jsonb, boolean), search_match_conds(text, tsquery, uuid, timestamptz, timestamptz, boolean), search_matches_sql(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer),
  search_matches(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer), search_walk_sql(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer),
  search_walk(text, uuid, uuid, timestamptz, timestamptz, boolean, boolean, timestamptz, uuid, integer, integer), search_post_cards(uuid), search_thread_matches(uuid, tsquery, uuid, timestamptz, timestamptz, boolean),
  search_posts(text, uuid, uuid, timestamptz, timestamptz, boolean, text, jsonb, integer), search_threads(text, uuid, uuid, timestamptz, timestamptz, boolean, text, jsonb, integer),
  search_suggest_threads(text, uuid, boolean, integer), suggest_characters(text, integer), search_suggest(text, text[], uuid, boolean, integer) to authenticated, service_role;
