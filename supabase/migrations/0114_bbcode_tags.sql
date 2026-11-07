-- The BBCode tags (docs/plans/2026-11-07-bbcode-tags-plan.md; its design, docs/plans/2026-11-07-bbcode-tags-design.md). One migration, in sections by the plan's tasks; each task appends its own.
--
-- ============================================================================ Task 7: search's plain words follow ====
--
--   bbcode_plain(body)   redefined whole (0113), so that it mirrors engine/bbcode/visible.ts over engine/bbcode/parse.ts as Tasks 1 to 5 left them. What the parser now reads
--                        and the plain words follow, tag for tag:
--                          - [quote=...]: a name that is an Act id is a real quote (words dropped, one separator); any other name of 1 to 80 characters (UTF-16 units, after
--                            trimming), `[quote]` bare and `[quote user=<id>]` are counterfeits, whose words are the post's own; a malformed `user=` or an empty or longer name makes the
--                            opener text, and its closer.
--                          - [spoiler] and [spoiler=title] (a title of at most 80 units after trimming, else text) and [ispoiler]: their words are kept, a title is not a word. While an
--                            [ispoiler] is open the opener and the closer of a block tag (quote, code, list, spoiler, center, left, right, hr, video, youtube, marquee) and of [url], and the
--                            opener of another [ispoiler], are text.
--                          - [video] and [youtube]: taken raw like [img]; a separator when the contents are an address engine/bbcode/video.ts has a player for (bbcode_plain_video_ok mirrors
--                            videoOf, host table, ids, ports, dot segments and the host's own parsing included), or, for [youtube], a bare 11-character id; otherwise the opener alone is text.
--                          - [center], [left], [right], [sub], [sup], [marquee], [rainbow] (no attribute), [font=name] (a name of the nine, case and surrounding blanks ignored), [glow], [shadow],
--                            [highlight] (no attribute, or a color from the list or hex): their words are kept; a bad attribute makes the opener text, and its closer.
--                          - [hr]: one separator, no closer (a [/hr] is text). [noparse]: taken raw, its contents are the words as written, and a lone noparse can be a bare link's whole target.
--                          - An autolink keeps its words, so it changes nothing here.
--                        Helpers added: bbcode_plain_trim, bbcode_plain_quote_head, bbcode_plain_pct, bbcode_plain_query_v, bbcode_plain_ipv4_number, bbcode_plain_punycode_ok,
--                        bbcode_plain_host_ok, bbcode_plain_video_ok. bbcode_plain_u16len and bbcode_plain_url_ok are 0113's and stay; bbcode_plain keeps its signature and its grants.
--
--   The reindex   Every post_search row is rewritten once, in this migration, from its post's current version by search_words_of (the same call the language rebuild makes; search_reindex() holds
--                 the one UPDATE), so a post that
--                 held `[spoiler]` as text before now indexes its words without the tags, and a post with a counterfeit quote now indexes its words. One statement: every post is
--                 indexed once. Its cost grows with the number of posts and their length (bbcode_plain is linear, 0117 holds it to that) and with the GIN index it maintains; on a busy
--                 instance it is minutes of one transaction that holds a row lock on each post_search row until it commits. A migration is the place for that: nothing reads a half-rebuilt
--                 index, and the alternative, the background rebuild (search_rebuild_step, a batch a minute), would leave posts indexed by the old walk for hours. Searching is not blocked while
--                 it runs (readers do not take row locks); a post written meanwhile has a new row, and an edit to a post waits for the commit.
--
-- Ways out: nothing here adds a state a player can be put in.

-- ---------------------------------------------------------------------------------------------------- helpers ----

-- String.prototype.trim: the JavaScript whitespace set, written out because Postgres's depends on the locale (as in bbcode_plain_url_ok).
create or replace function bbcode_plain_trim(t text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select regexp_replace(t, '^[\u0009-\u000d    -     　﻿]+|[\u0009-\u000d    -     　﻿]+$', '', 'g')
$$;

-- What follows `quote` in a quote opener (engine/bbcode/parse.ts quoteHead): nothing, `=<name>`, ` user=<id>` or `=<name> user=<id>`, the name quoted or the words up to
-- whitespace and `user=` (in any case). 'real' when the name is an Act id, 'counterfeit' for any other name of 1 to 80 UTF-16 units, none, or a `user=` alone; null when the
-- opener is text. The case-blind parts are written out for ASCII letters, since the parser's /i does not fold a non-ASCII letter to an ASCII one and Postgres's locale might.
create or replace function bbcode_plain_quote_head(rest text) returns text
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  v text;
  j int;
  m text[];
  nm text;
  tail text;
begin
  if left(rest, 1) = '=' then
    v := substr(rest, 2);
    if left(v, 1) = '"' then
      j := strpos(substr(v, 2), '"');
      if j = 0 then return null; end if;
      nm := left(substr(v, 2), j - 1);
      tail := substr(v, j + 2);
    else
      m := regexp_match(v, '^(.*?)[\u0009-\u000d    -     　﻿][uU][sS][eE][rR]=');
      if m is null then nm := v; tail := ''; else nm := m[1]; tail := substr(v, length(m[1]) + 1); end if;
    end if;
    nm := bbcode_plain_trim(nm);
    if nm = '' or bbcode_plain_u16len(nm) > 80 then return null; end if;
  else
    tail := rest;
  end if;
  if tail <> '' and tail !~ '^[\u0009-\u000d    -     　﻿]+[uU][sS][eE][rR]=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return null; end if;
  if nm is not null and nm ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return 'real'; end if;
  return 'counterfeit';
end
$$;

-- A query component as URLSearchParams reads it, kept to what an id check can tell apart: a plus is a blank, %XX of an ASCII character is that character, and a byte
-- of 128 or more (or a NUL) is `~`, which no id has. Linear in the text.
create or replace function bbcode_plain_pct(s text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce(string_agg(
           case when m[1] ~ '^%' then
                  case when substr(m[1], 2, 2) ~ '^[0-7][0-9a-fA-F]$' and substr(m[1], 2, 2) <> '00' then chr(('x' || substr(m[1], 2, 2))::bit(8)::int) else '~' end
                else m[1] end, '' order by o), '')
  from regexp_matches(replace(s, '+', ' '), '(%[0-9A-Fa-f]{2}|[^%]|%)', 'g') with ordinality as r (m, o)
$$;

-- searchParams.get('v') for a query string (without its `?`): the first pair named v, written `v` or `%76`, decoded; null when there is none.
create or replace function bbcode_plain_query_v(q text) returns text
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  pair text;
  eq int;
begin
  if q is null then return null; end if;
  foreach pair in array string_to_array(q, '&') loop
    if pair = '' then continue; end if;
    eq := strpos(pair, '=');
    if (case when eq = 0 then pair else left(pair, eq - 1) end) in ('v', '%76') then
      return bbcode_plain_pct(case when eq = 0 then '' else substr(pair, eq + 1) end);
    end if;
  end loop;
  return null;
end
$$;

-- The WHATWG IPv4 number parser: the value of one part of a host that ends in a number (decimal, 0x hex or leading-0 octal), or null when the part is not a number.
-- A value of 2^32 or more is returned as 2^32, which no part may reach.
create or replace function bbcode_plain_ipv4_number(part text) returns numeric
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  x text := part;
  r int := 10;
  v numeric := 0;
  i int;
begin
  if x = '' then return null; end if;
  if length(x) >= 2 and left(x, 2) in ('0x', '0X') then x := substr(x, 3); r := 16;
  elsif length(x) >= 2 and left(x, 1) = '0' then x := substr(x, 2); r := 8; end if;
  if x = '' then return 0; end if;
  if r = 10 and x !~ '^[0-9]+$' then return null; end if;
  if r = 16 and x !~ '^[0-9a-fA-F]+$' then return null; end if;
  if r = 8 and x !~ '^[0-7]+$' then return null; end if;
  x := ltrim(x, '0');
  if x = '' then return 0; end if;
  if length(x) > 11 then return 4294967296; end if;
  for i in 1..length(x) loop
    v := v * r + (strpos('0123456789abcdef', lower(substr(x, i, 1))) - 1);
  end loop;
  return least(v, 4294967296);
end
$$;

-- Whether a host label written `xn--<label>` is one the URL parser takes: the Punycode of RFC 3492 must decode, and what it decodes to must not be a C1 control or a
-- surrogate. (The parser also holds the decoded text to IDNA's tables; those are not mirrored, so a label that decodes but is outside them is judged valid here.)
create or replace function bbcode_plain_punycode_ok(label text) returns boolean
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  b int := length(label) - coalesce(strpos(reverse(label), '-'), 0) + 1;
  rest text;
  len int;
  pos int := 1;
  cps int[] := array[]::int[];
  n bigint := 128;
  i bigint := 0;
  oldi bigint;
  w bigint;
  k int;
  bias int := 72;
  d int;
  t int;
  c text;
  m int;
  delta bigint;
  cp int;
begin
  if strpos(label, '-') = 0 then b := 0; end if;
  if b > 1 then
    for pos in 1..b - 1 loop cps := cps || ascii(substr(label, pos, 1)); end loop;
  end if;
  rest := substr(label, b + 1);
  len := length(rest);
  pos := 1;
  while pos <= len loop
    oldi := i; w := 1; k := 36;
    loop
      if pos > len then return false; end if;
      c := substr(rest, pos, 1); pos := pos + 1;
      d := case when c between '0' and '9' then ascii(c) - 22 when c between 'a' and 'z' then ascii(c) - 97 else -1 end;
      if d < 0 then return false; end if;
      i := i + d * w;
      if i > 2147483647 then return false; end if;
      t := case when k <= bias then 1 when k >= bias + 26 then 26 else k - bias end;
      exit when d < t;
      w := w * (36 - t);
      if w > 2147483647 then return false; end if;
      k := k + 36;
    end loop;
    m := coalesce(array_length(cps, 1), 0) + 1;
    delta := i - oldi;
    delta := case when oldi = 0 then delta / 700 else delta / 2 end;
    delta := delta + delta / m;
    k := 0;
    while delta > 455 loop delta := delta / 35; k := k + 36; end loop;
    bias := k + (36 * delta) / (delta + 38);
    n := n + i / m;
    i := i % m;
    if n > 1114111 then return false; end if;
    cp := n;
    if cp between 128 and 159 or cp between 55296 and 57343 then return false; end if;
    cps := cps[1:i::int] || cp || cps[i::int + 1:];
    i := i + 1;
  end loop;
  return true;
end
$$;

-- Whether the URL parser takes a host (lowercase, as bbcode_plain_url_ok passed it: letters, digits, dots and hyphens, no empty label): a host whose last label is a number must
-- be an IPv4 address (up to four parts, each in range), and a label that starts `xn--` must be valid Punycode. `new URL` throws otherwise, and then videoOf gives null.
create or replace function bbcode_plain_host_ok(host text) returns boolean
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  labels text[] := string_to_array(host, '.');
  cnt int := array_length(string_to_array(host, '.'), 1);
  lab text;
  num numeric;
  i int;
begin
  if labels[cnt] ~ '^[0-9]+$' or labels[cnt] ~ '^0[xX][0-9a-fA-F]*$' then
    if cnt > 4 then return false; end if;
    for i in 1..cnt loop
      num := bbcode_plain_ipv4_number(labels[i]);
      if num is null then return false; end if;
      if i < cnt and num > 255 then return false; end if;
      if i = cnt and num >= 256 ^ (5 - cnt) then return false; end if;
    end loop;
    return true;
  end if;
  foreach lab in array labels loop
    if left(lab, 4) = 'xn--' and not bbcode_plain_punycode_ok(substr(lab, 5)) then return false; end if;
  end loop;
  return true;
end
$$;

-- Whether engine/bbcode/video.ts videoOf has a player for an address (null is no): the address passes the images' check, the URL parser takes it, its port is none or
-- its scheme's default, and its host, path (dot segments resolved, a trailing slash tolerated) and ids fit a provider's row, or it is an https address ending .mp4 or .webm. The
-- host table and each id's character set are written out as the TypeScript has them, in ASCII ranges (a locale's case folding must not widen them).
create or replace function bbcode_plain_video_ok(raw text) returns boolean
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  s text;
  scheme text;
  rest text;
  authority text;
  colon int;
  host text;
  port int;
  dflt int;
  m text[];
  path text;
  segs text[];
  items text[] := array[]::text[];
  ic int := 0;
  sg text;
  k int;
  last_seg int;
  pn text;
  sc int;
  a text;
  b text;
  c text;
  v text;
  yt_id constant text := '^[A-Za-z0-9_-]{11}$';
  seg_ok constant text := '^[A-Za-z0-9_-]{1,100}$';
begin
  -- Only an http or https address can pass, so the rest is not looked at for any other contents.
  if raw is null or raw !~ '^[\u0009-\u000d    -     　﻿]*[hH][tT][tT][pP][sS]?:' then return false; end if;
  if not bbcode_plain_url_ok(raw, array['http', 'https'], false) then return false; end if;
  s := bbcode_plain_trim(raw);
  scheme := lower(left(s, strpos(s, ':') - 1));
  rest := substr(s, strpos(s, ':') + 1);
  authority := (regexp_match(rest, '^//([^/?#]*)'))[1];
  colon := strpos(authority, ':');
  host := lower(case when colon = 0 then authority else left(authority, colon - 1) end);
  if colon > 0 then
    port := substr(authority, colon + 1)::int;
    -- A port past 65535 makes `new URL` throw, the scheme's own default is dropped, and any other is a refusal (videoOf: u.port !== '').
    dflt := case when scheme = 'http' then 80 else 443 end;
    if port > 65535 or port <> dflt then return false; end if;
  end if;
  if not bbcode_plain_host_ok(host) then return false; end if;
  m := regexp_match(substr(rest, 3 + length(authority)), '^([^?#]*)(?:\?([^#]*))?');
  path := m[1];
  -- The pathname: dot segments resolved as the URL parser does (`.` and `%2e`, `..` and its encoded spellings), and `/` when there is no path.
  if path = '' then
    pn := '/';
  else
    segs := case when path = '/' then array[''] else string_to_array(substr(path, 2), '/') end;
    last_seg := array_length(segs, 1);
    for k in 1..last_seg loop
      sg := segs[k];
      if lower(sg) in ('..', '.%2e', '%2e.', '%2e%2e') then
        if ic > 0 then ic := ic - 1; end if;
        if k = last_seg then ic := ic + 1; items[ic] := ''; end if;
      elsif lower(sg) in ('.', '%2e') then
        if k = last_seg then ic := ic + 1; items[ic] := ''; end if;
      else
        ic := ic + 1; items[ic] := sg;
      end if;
    end loop;
    pn := '/' || array_to_string(items[1:ic], '/');
  end if;
  -- Its segments, one trailing slash tolerated.
  segs := string_to_array(case when right(pn, 1) = '/' then left(pn, -1) else pn end, '/');
  sc := greatest(coalesce(array_length(segs, 1), 0) - 1, 0);
  a := segs[2]; b := segs[3]; c := segs[4];

  if host = 'youtu.be' then return sc = 1 and a ~ yt_id;
  elsif host in ('youtube.com', 'www.youtube.com', 'm.youtube.com') then
    if sc = 1 and a = 'watch' then
      v := bbcode_plain_query_v(m[2]);
      return v is not null and v ~ yt_id;
    end if;
    return sc = 2 and a in ('shorts', 'live') and b ~ yt_id;
  elsif host in ('vimeo.com', 'www.vimeo.com') then return sc = 1 and a ~ '^[0-9]{1,12}$';
  elsif host = 'clips.twitch.tv' then return sc = 1 and a ~ seg_ok;
  elsif host in ('twitch.tv', 'www.twitch.tv') then return sc = 3 and a ~ seg_ok and b = 'clip' and c ~ seg_ok;
  elsif host in ('streamable.com', 'www.streamable.com') then return sc = 1 and a ~ '^[A-Za-z0-9]{3,16}$';
  elsif host in ('nicovideo.jp', 'www.nicovideo.jp') then return sc = 2 and a = 'watch' and b ~ '^(sm|nm|so)[0-9]{1,12}$';
  elsif host in ('soundcloud.com', 'www.soundcloud.com') then return sc = 2 and a ~ seg_ok and b ~ seg_ok;
  end if;
  return scheme = 'https' and pn ~ '\.([mM][pP]4|[wW][eE][bB][mM])$';
end
$$;

-- ------------------------------------------------------------------------------------------------ bbcode_plain ----
--
-- Redefined whole from 0113. What changed: the tag lists (openers, closers, the ones that keep a count), the five tags taken raw (code, img, video, youtube, noparse; the next closer
-- of each found once from the end, as 0113 did for two), the opener rules of the new tags, the quote head, the inline spoiler's blocked tags, and a bare link whose one node is a
-- noparse. Everything else, the stack, the one output array, the unwinding and the cost, is 0113's.

create or replace function bbcode_plain(body text) returns text
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  -- The tag names of engine/bbcode/parse.ts: BBCODE_TAGS (openers), its closers, the ones that keep a count of how many are open (every tag that makes a frame),
  -- the block tags (BLOCK) that are text inside an inline spoiler, and the fonts (FONTS).
  openers constant text[] := array['b','i','u','s','color','size','url','img','code','quote','list','spoiler','ispoiler','video','youtube','center','left','right','hr','sub','sup','font','marquee','glow','shadow','rainbow','highlight','noparse'];
  closers constant text[] := array['b','i','u','s','color','size','url','quote','list','spoiler','ispoiler','video','youtube','center','left','right','sub','sup','font','marquee','glow','shadow','rainbow','highlight'];
  counted constant text[] := array['b','i','u','s','color','size','url','quote','list','spoiler','ispoiler','center','left','right','sub','sup','font','marquee','glow','shadow','rainbow','highlight'];
  blocks constant text[] := array['quote','code','list','spoiler','center','left','right','hr','video','youtube','marquee'];
  fonts constant text[] := array['verdana','arial','tahoma','trebuchet ms','georgia','times new roman','courier new','comic sans ms','impact'];
  named constant text[] := array['black','silver','gray','grey','white','maroon','red','purple','fuchsia','green','lime','olive','yellow','navy','blue','teal','aqua','orange','pink','brown','gold','cyan','magenta','violet','indigo','crimson','coral','salmon','turquoise','tan','khaki','beige'];
  max_depth constant int := 32;       -- MAX_DEPTH
  max_tag constant int := 2064;       -- MAX_TAG: MAX_URL_LENGTH (2048) + 16
  max_raw constant int := 2112;       -- the longest image or video contents the parser checks: MAX_URL_LENGTH + 64
  toks text[];
  n int;
  nxt_code int[];                     -- per token, the next token after it that is [/code], or 0
  nxt_img int[];                      -- the same for [/img]
  nxt_video int[];                    -- [/video]
  nxt_youtube int[];                  -- [/youtube]
  nxt_noparse int[];                  -- [/noparse]
  cum int[];                          -- characters up to and including each token
  seen_code int := 0;
  seen_img int := 0;
  seen_video int := 0;
  seen_youtube int := 0;
  seen_noparse int := 0;
  -- The output: out[1..oc] are the pieces written so far (a piece past oc is stale and is overwritten). The stack: frame 1 is the root. A frame that is not literal
  -- began at piece f_start, so its words are out[f_start + 1..oc]. A literal frame is an opener that became text, kept so its closer is text too; it owns nothing.
  out text[] := array[]::text[];
  oc int := 0;
  f_kind text[] := array['root'];     -- root, pass (words go up), sep (words dropped, one separator goes up), list, bareurl, literal
  f_name text[] := array[''];
  f_start int[] := array[0];
  f_depth int[] := array[0];
  f_home int[] := array[1];
  f_nodey boolean[] := array[false];  -- a node other than text and noparse was placed in this frame (a bare link is a link only around text alone, or one noparse alone)
  f_np int[] := array[0];             -- how many noparse nodes were placed in this frame
  f_npp int[] := array[0];            -- and how many pieces of out they took (a noparse's contents go in a token at a time)
  sp int := 1;
  cnt int[] := array_fill(0, array[22]);
  open_urls int := 0;
  open_isp int := 0;                  -- inline spoilers that are open and real
  t int := 1;
  unw int := 0;                       -- unwinding: 1 to a closer's name, 2 until no link is open, 3 to the end
  unw_name text;
  unw_raw text;
  links_closed boolean := false;
  tok text;
  b text;
  nm text;
  val text;
  qrest text;
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
  vid text;
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
  nxt_video := array_fill(0, array[n]);
  nxt_youtube := array_fill(0, array[n]);
  nxt_noparse := array_fill(0, array[n]);
  cum := array_fill(0, array[n]);
  for j in reverse n..1 loop
    nxt_code[j] := seen_code;
    nxt_img[j] := seen_img;
    nxt_video[j] := seen_video;
    nxt_youtube[j] := seen_youtube;
    nxt_noparse[j] := seen_noparse;
    if length(toks[j]) between 6 and 10 and left(toks[j], 2) = '[/' then
      case lower(toks[j])
        when '[/code]' then seen_code := j;
        when '[/img]' then seen_img := j;
        when '[/video]' then seen_video := j;
        when '[/youtube]' then seen_youtube := j;
        when '[/noparse]' then seen_noparse := j;
        else null;
      end case;
    end if;
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
      if k <> 'literal' and fname = 'ispoiler' then open_isp := open_isp - 1; end if;
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
        else -- bareurl: a link only when closed, around nothing but text that is one good address (or one noparse alone); its opener is the piece before its start
          -- Its words are joined piece by piece and given up past the longest address: a slice of out would copy the whole array each time, and the words past that length cannot be an address.
          -- The parser trims the words before it checks their length, so the blanks that lead are not joined and a piece's trailing blanks do not count: it stops only once the words up to the last character that is not a blank pass the longest address, and then the trimmed words are too long whatever follows. Each piece is trimmed once, so the join stays bounded and linear.
          -- One noparse is a node, so it is the whole target only when nothing else was written in the frame: its pieces are the only ones after the opener.
          contents := ''; core := 0;
          if cl is not null and not f_nodey[sp + 1] and (f_np[sp + 1] = 0 or (f_np[sp + 1] = 1 and oc - fstart = f_npp[sp + 1])) then
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
          if cl is not null and not f_nodey[sp + 1] and (f_np[sp + 1] = 0 or (f_np[sp + 1] = 1 and oc - fstart = f_npp[sp + 1])) and bbcode_plain_url_ok(contents, array['http','https','mailto'], true) then
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
    qrest := null;
    if b = '*' then
      nm := '*';
    elsif left(b, 1) = '/' then
      nm := lower(substr(b, 2));
      if not (nm = any (closers)) then oc := oc + 1; out[oc] := tok; t := t + 1; continue; end if;
      -- A closer with nothing open to close is text; otherwise it closes the nearest opener of its name and what was opened inside it. Inside an inline spoiler the closer of a block tag
      -- or a link is text, and a [/video] or [/youtube] is always text (no frame of either is ever open).
      t := t + 1;
      if (open_isp > 0 and (nm = any (blocks) or nm = 'url')) or nm in ('video', 'youtube') or cnt[array_position(counted, nm)] = 0 then
        oc := oc + 1; out[oc] := tok;
      else
        unw := 1; unw_name := nm; unw_raw := tok;
      end if;
      continue;
    elsif left(b, 5) ~ '^[qQ][uU][oO][tT][eE]$' and (length(b) = 5 or substr(b, 6, 1) = '=' or substr(b, 6, 1) ~ '^[\u0009-\u000d    -     　﻿]$') then
      nm := 'quote';
      qrest := substr(b, 6);
    else
      eq := strpos(b, '=');
      nm := lower(case when eq = 0 then b else left(b, eq - 1) end);
      if not (nm = any (openers)) then oc := oc + 1; out[oc] := tok; t := t + 1; continue; end if;
      if eq > 0 then
        val := substr(b, eq + 1);
        if length(val) >= 2 and left(val, 1) = '"' and right(val, 1) = '"' then val := substr(val, 2, length(val) - 2); end if;
      end if;
    end if;

    if open_isp > 0 and nm <> '*' and (nm = any (blocks) or nm = 'url' or nm = 'ispoiler') then
      -- A block tag, a link or another inline spoiler inside an inline spoiler is the words as written (the spoiler is a button, and a button holds nothing interactive).
      oc := oc + 1; out[oc] := tok; t := t + 1; continue;
    end if;

    if nm = '*' then
      -- An item marker is one only directly inside a list; elsewhere it is text.
      oc := oc + 1;
      if f_kind[f_home[sp]] = 'list' then out[oc] := E'\n'; else out[oc] := tok; end if;
      t := t + 1; continue;
    elsif nm = 'hr' then
      -- A rule is a leaf with no closer; with an attribute it is text.
      oc := oc + 1;
      if val is null then out[oc] := E'\n'; f_nodey[f_home[sp]] := true; else out[oc] := tok; end if;
      t := t + 1; continue;
    elsif nm = 'code' then
      -- Raw up to the closing tag; with none, or an attribute, only the opener is text.
      if val is null and nxt_code[t] > 0 then
        oc := oc + 1; out[oc] := E'\n'; f_nodey[f_home[sp]] := true; t := nxt_code[t] + 1; continue;
      end if;
      oc := oc + 1; out[oc] := tok; t := t + 1; continue;
    elsif nm = 'noparse' then
      -- Raw up to the closing tag, its contents one node of the post's own words as written (none at all when empty); with no closer, or an attribute, only the opener is text.
      j := nxt_noparse[t];
      if val is null and j > 0 then
        if j > t + 1 then
          -- Its tokens go in piece by piece (a substr of the body would walk to its offset each time, and a slice of toks would copy it), and are joined once at the end.
          for idx in t + 1..j - 1 loop oc := oc + 1; out[oc] := toks[idx]; end loop;
          f_np[f_home[sp]] := f_np[f_home[sp]] + 1;
          f_npp[f_home[sp]] := f_npp[f_home[sp]] + (j - t - 1);
        end if;
        t := j + 1; continue;
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
    elsif nm = 'video' or nm = 'youtube' then
      -- Taken as an image is; the contents (trimmed) must be an address videoOf has a player for, or for [youtube] a bare id. Otherwise only the opener is text.
      j := case when nm = 'video' then nxt_video[t] else nxt_youtube[t] end;
      if val is null and j > 0 and cum[j - 1] - cum[t] <= max_raw then
        contents := '';
        for idx in t + 1..j - 1 loop contents := contents || toks[idx]; end loop;
        if bbcode_plain_u16len(contents) <= max_raw then
          vid := bbcode_plain_trim(contents);
          if vid <> '' and ((nm = 'youtube' and vid ~ '^[A-Za-z0-9_-]{11}$') or bbcode_plain_video_ok(vid) is true) then
            oc := oc + 1; out[oc] := E'\n'; f_nodey[f_home[sp]] := true; t := j + 1; continue;
          end if;
        end if;
      end if;
      oc := oc + 1; out[oc] := tok; t := t + 1; continue;
    end if;

    want := null;
    if nm in ('b','i','u','s','ispoiler','center','left','right','sub','sup','marquee','rainbow') then
      if val is null then want := 'pass'; end if;
    elsif nm = 'color' then
      if val is not null and (lower(val) = any (named) or lower(val) ~ '^#([0-9a-f]{3}|[0-9a-f]{6})$') then want := 'pass'; end if;
    elsif nm = 'size' then
      if val is not null and val ~ '^[1-7]$' then want := 'pass'; end if;
    elsif nm = 'quote' then
      want := case bbcode_plain_quote_head(qrest) when 'real' then 'sep' when 'counterfeit' then 'pass' end;
    elsif nm = 'spoiler' then
      if val is null or bbcode_plain_u16len(bbcode_plain_trim(val)) <= 80 then want := 'pass'; end if;
    elsif nm = 'font' then
      if val is not null and lower(bbcode_plain_trim(val)) = any (fonts) then want := 'pass'; end if;
    elsif nm in ('glow','shadow','highlight') then
      if val is null or lower(val) = any (named) or lower(val) ~ '^#([0-9a-f]{3}|[0-9a-f]{6})$' then want := 'pass'; end if;
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
      f_depth[sp] := f_depth[sp - 1]; f_home[sp] := f_home[sp - 1]; f_nodey[sp] := false; f_np[sp] := 0; f_npp[sp] := 0;
    else
      -- A list puts a separator before its words, and a bare link its opener (given back as text if it is not a link), so each is the piece before the frame's start.
      if want = 'list' then oc := oc + 1; out[oc] := E'\n'; elsif want = 'bareurl' then oc := oc + 1; out[oc] := tok; end if;
      sp := sp + 1;
      f_kind[sp] := want; f_name[sp] := nm; f_start[sp] := oc;
      f_depth[sp] := f_depth[f_home[sp - 1]] + 1; f_home[sp] := sp; f_nodey[sp] := false; f_np[sp] := 0; f_npp[sp] := 0;
      if nm = 'url' then open_urls := open_urls + 1; end if;
      if nm = 'ispoiler' then open_isp := open_isp + 1; end if;
    end if;
    cnt[array_position(counted, nm)] := cnt[array_position(counted, nm)] + 1;
    t := t + 1;
  end loop;
  return array_to_string(out[1 : oc], '');
end
$$;

-- The helpers and bbcode_plain are called by the index's trigger and the search reads, never by the API's anonymous or digest roles (0113 granted bbcode_plain the same way).
revoke execute on function bbcode_plain(text), bbcode_plain_trim(text), bbcode_plain_quote_head(text), bbcode_plain_pct(text), bbcode_plain_query_v(text), bbcode_plain_ipv4_number(text),
  bbcode_plain_punycode_ok(text), bbcode_plain_host_ok(text), bbcode_plain_video_ok(text) from public, anon;
grant execute on function bbcode_plain(text), bbcode_plain_trim(text), bbcode_plain_quote_head(text), bbcode_plain_pct(text), bbcode_plain_query_v(text), bbcode_plain_ipv4_number(text),
  bbcode_plain_punycode_ok(text), bbcode_plain_host_ok(text), bbcode_plain_video_ok(text) to authenticated, service_role;

-- ------------------------------------------------------------------------------------------------- the reindex ----
--
-- Every post_search row is rewritten once from its post's current version, in the instance's search language, by one UPDATE; a row whose post search_words_of cannot read (none today)
-- keeps its words. It is a function, as search_backfill is, so that supabase/tests/0118-bbcode-tags.sql runs the very statement the migration runs; no API role may execute it.
create function search_reindex() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  update post_search set words = coalesce(search_words_of(act, (select search_lang())), words);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function search_reindex() from public, anon, authenticated;
select search_reindex();
