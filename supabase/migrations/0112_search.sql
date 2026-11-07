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
-- cannot blow anything) and a text buffer per open tag that is placed in its parent when the tag closes: a bold, italic, underline, strike, color or size tag passes its
-- words up, a quote or a link with a target passes up one separator, a list passes up a separator before and after and one before each item, an image and code
-- block pass up a separator. A bare [url] is a link only when it closes around nothing but one good address, and otherwise gives its tag, its words and its closer back as text.
-- The text is cut into tokens once (a tag is `[`, no bracket, `]`; the rest is text), so the work grows with the post, and the next closer of [code] and [img] is found
-- once from the end of the post, never by a scan per opener.
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
  -- The stack. Frame 1 is the root. A frame that is not literal owns a buffer: `cur` is the buffer of the nearest such frame, and f_saved holds its parent's
  -- while it is open. A literal frame is an opener that became text, kept so its closer is text too; it owns nothing.
  f_kind text[] := array['root'];     -- root, pass (words go up), sep (words dropped, one separator goes up), list, bareurl, literal
  f_name text[] := array[''];
  f_raw text[] := array[''];
  f_saved text[] := array[null];
  f_depth int[] := array[0];
  f_home int[] := array[1];
  f_nodey boolean[] := array[false];  -- a node other than text was placed in this frame (a bare link is a link only around text alone)
  sp int := 1;
  cur text := '';
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
  fsaved text;
  fraw text;
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
      k := f_kind[sp]; fname := f_name[sp]; fsaved := f_saved[sp]; fraw := f_raw[sp];
      matched := unw = 1 and fname = unw_name;
      idx := array_position(counted, fname);
      if idx is not null then cnt[idx] := cnt[idx] - 1; end if;
      if k <> 'literal' and fname = 'url' then open_urls := open_urls - 1; end if;
      sp := sp - 1;
      cl := case when matched then unw_raw end;
      if k = 'literal' then
        if matched then cur := cur || unw_raw; end if;
      else
        if k = 'pass' then
          cur := fsaved || cur;
        elsif k = 'list' then
          cur := fsaved || E'\n' || cur || E'\n';
        elsif k = 'sep' then
          cur := fsaved || E'\n';
        else -- bareurl: a link only when closed, around nothing but text that is one good address
          if cl is not null and not f_nodey[sp + 1] and bbcode_plain_url_ok(cur, array['http','https','mailto'], true) then
            cur := fsaved || E'\n';
          else
            cur := fsaved || fraw || cur || coalesce(cl, '');
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
    if length(tok) < 2 or left(tok, 1) <> '[' then cur := cur || tok; t := t + 1; continue; end if;
    b := substr(tok, 2, length(tok) - 2);
    if b = '' or length(b) > max_tag or (length(b) > max_tag / 2 and bbcode_plain_u16len(b) > max_tag) then
      cur := cur || tok; t := t + 1; continue;
    end if;
    val := null;
    if b = '*' then
      nm := '*';
    elsif left(b, 1) = '/' then
      nm := lower(substr(b, 2));
      if not (nm = any (closers)) then cur := cur || tok; t := t + 1; continue; end if;
      -- A closer with nothing open to close is text; otherwise it closes the nearest opener of its name and what was opened inside it.
      t := t + 1;
      if cnt[array_position(counted, nm)] = 0 then
        cur := cur || tok;
      else
        unw := 1; unw_name := nm; unw_raw := tok;
      end if;
      continue;
    else
      eq := strpos(b, '=');
      nm := lower(case when eq = 0 then b else left(b, eq - 1) end);
      if not (nm = any (openers)) then cur := cur || tok; t := t + 1; continue; end if;
      if eq > 0 then
        val := substr(b, eq + 1);
        if length(val) >= 2 and left(val, 1) = '"' and right(val, 1) = '"' then val := substr(val, 2, length(val) - 2); end if;
      end if;
    end if;

    if nm = '*' then
      -- An item marker is one only directly inside a list; elsewhere it is text.
      if f_kind[f_home[sp]] = 'list' then cur := cur || E'\n'; else cur := cur || tok; end if;
      t := t + 1; continue;
    elsif nm = 'code' then
      -- Raw up to the closing tag; with none, or an attribute, only the opener is text.
      if val is null and nxt_code[t] > 0 then
        cur := cur || E'\n'; f_nodey[f_home[sp]] := true; t := nxt_code[t] + 1; continue;
      end if;
      cur := cur || tok; t := t + 1; continue;
    elsif nm = 'img' then
      j := nxt_img[t];
      if val is null and j > 0 and cum[j - 1] - cum[t] <= max_raw then
        contents := array_to_string(toks[t + 1 : j - 1], '');
        if bbcode_plain_u16len(contents) <= max_raw and bbcode_plain_url_ok(contents, array['http','https'], false) then
          cur := cur || E'\n'; f_nodey[f_home[sp]] := true; t := j + 1; continue;
        end if;
      end if;
      cur := cur || tok; t := t + 1; continue;
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
      cur := cur || tok;
      sp := sp + 1;
      f_kind[sp] := 'literal'; f_name[sp] := nm; f_raw[sp] := tok; f_saved[sp] := null;
      f_depth[sp] := f_depth[sp - 1]; f_home[sp] := f_home[sp - 1]; f_nodey[sp] := false;
    else
      sp := sp + 1;
      f_kind[sp] := want; f_name[sp] := nm; f_raw[sp] := tok; f_saved[sp] := cur;
      f_depth[sp] := f_depth[f_home[sp - 1]] + 1; f_home[sp] := sp; f_nodey[sp] := false;
      cur := '';
      if nm = 'url' then open_urls := open_urls + 1; end if;
    end if;
    cnt[array_position(counted, nm)] := cnt[array_position(counted, nm)] + 1;
    t := t + 1;
  end loop;
  return cur;
end
$$;
