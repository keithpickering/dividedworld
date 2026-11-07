-- The BBCode tags (docs/plans/2026-11-07-bbcode-tags-plan.md; its design, docs/plans/2026-11-07-bbcode-tags-design.md). One migration, in sections by the plan's tasks; each task appends its own.
--
-- ============================================================================ Task 7: search's plain words follow ====
--
--   bbcode_plain(body)   redefined whole (0116), so that it mirrors engine/bbcode/visible.ts over engine/bbcode/parse.ts as Tasks 1 to 5 left them. What the parser now reads
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
--                        bbcode_plain_host_ok, bbcode_plain_video_ok. bbcode_plain_u16len and bbcode_plain_url_ok are 0116's and stay; bbcode_plain keeps its signature and its grants.
--
--   The reindex   Every post_search row whose words change is rewritten once (a row already current is left alone), in this migration, from its post's current version by search_words_of (the same call the language rebuild makes; search_reindex() holds
--                 the one UPDATE), so a post that
--                 held `[spoiler]` as text before now indexes its words without the tags, and a post with a counterfeit quote now indexes its words. One statement: every post is
--                 indexed once. Its cost grows with the number of posts and their length (bbcode_plain is linear, 0118 holds it to that) and with the GIN index it maintains; on a busy
--                 instance it is minutes of one transaction that holds a row lock on each post_search row until it commits. A migration is the place for that: nothing reads a half-rebuilt
--                 index, and the alternative, the background rebuild (search_rebuild_step, a batch a minute), would leave posts indexed by the old walk for hours. Searching is not blocked while
--                 it runs (readers do not take row locks); writes to acts and post_search wait for the commit (the reindex takes `lock table acts, post_search in share row exclusive mode`), so no post or
--                 edit lands after the UPDATE's snapshot and is indexed by the old walk.
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
  -- Nothing to decode (`xn--`, `xn---`): the parser refuses the host.
  if cardinality(cps) = 0 and len = 0 then return false; end if;
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
-- Redefined whole from 0116. What changed: the tag lists (openers, closers, the ones that keep a count), the five tags taken raw (code, img, video, youtube, noparse; the next closer
-- of each found once from the end, as 0116 did for two), the opener rules of the new tags, the quote head, the inline spoiler's blocked tags, and a bare link whose one node is a
-- noparse. Everything else, the stack, the one output array, the unwinding and the cost, is 0116's.

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

-- The helpers and bbcode_plain are called by the index's trigger and the search reads, never by the API's anonymous or digest roles (0116 granted bbcode_plain the same way).
revoke execute on function bbcode_plain(text), bbcode_plain_trim(text), bbcode_plain_quote_head(text), bbcode_plain_pct(text), bbcode_plain_query_v(text), bbcode_plain_ipv4_number(text),
  bbcode_plain_punycode_ok(text), bbcode_plain_host_ok(text), bbcode_plain_video_ok(text) from public, anon;
grant execute on function bbcode_plain(text), bbcode_plain_trim(text), bbcode_plain_quote_head(text), bbcode_plain_pct(text), bbcode_plain_query_v(text), bbcode_plain_ipv4_number(text),
  bbcode_plain_punycode_ok(text), bbcode_plain_host_ok(text), bbcode_plain_video_ok(text) to authenticated, service_role;

-- ------------------------------------------------------------------------------------------------- the reindex ----
--
-- Every post_search row is rewritten once from its post's current version, in the instance's search language, by one UPDATE; a row whose post search_words_of cannot read (none today)
-- keeps its words. It is a function, as search_backfill is, so that supabase/tests/0119-bbcode-tags.sql runs the very statement the migration runs; no API role may execute it.
create function search_reindex() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  -- Writes wait for the migration's commit, readers do not: a post or an edit landing after the UPDATE's snapshot would otherwise be indexed by the old walk, because the redefined
  -- bbcode_plain is not visible to other sessions until this transaction commits. SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE that every insert and update takes, and
  -- not with the ACCESS SHARE of a search or a read.
  lock table acts, post_search in share row exclusive mode;
  -- Only a row whose words change is written: words is GIN-indexed, so no update is HOT, and an unchanged row would cost WAL, bloat and an index entry for nothing.
  update post_search p set words = w.new_words
    from (select s.act, coalesce(search_words_of(s.act, (select search_lang())), s.words) as new_words from post_search s) w
    where p.act = w.act and p.words is distinct from w.new_words;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function search_reindex() from public, anon, authenticated;
select search_reindex();


-- ============================================================================ Task 8: the framed alert, in the database ====
--
-- The framed alert (design section 1, "The framed alert"; plan Task 8): a counterfeit quote names a character (`[quote=Name user=<id>]`), and that character's owner is told. It is its own
-- written kind, not `quote` ("your post was quoted" would be false), and it never bluffs: the alert says only that a post holds words put in a character's mouth, about that post.
--
--   framed         An alert kind, written by write_framed (below) in the transaction of the post, thread start or spin that holds the counterfeit, to the owner of the character the body names, about
--                  that Act, with the character, as `quote`'s is. No sub. An edit writes none, as an edit writes no `quote` alert: edit_post is not touched.
--   write_framed(body, framing, about, acting)
--                  For each distinct id among the first 5 of `framing` (in the order named), if it is a debuted character (characters.debuted_at is not null) and `body` contains `user=<id>`, case
--                  ignored, it calls write_alert (0061), which skips a staff character (no owner) and the acting account's own masks. Any other id is skipped silently. It returns nothing, and
--                  neither it nor the three callers answer differently for an id that is unknown, undebuted, unnamed, staff or the poster's own: no refusal, no field. What it adds for an owned,
--                  debuted, named character is one indexed insert and one outbox row, the cost write_alert's own header already accepts for `quote` (a staff, undebuted or own-mask target is seen
--                  only by the account that knows). At most 5 ids are looked at whatever the body holds, so a post's cost is bounded. It is not security definer: its callers are, and write_alert is
--                  no API role's. No API role may execute it.
--
-- What changed, each redefined whole from its latest definition (everything else is as that migration wrote it):
--   - alerts_kind_check (0092) gains 'framed'. account_preferences_toasts_check (0092) gains it.
--   - set_preferences (0115) and settings_held (0116) list it among the kinds a toast choice and the toastDefaults setting may name. (settings_held does concern alerts: it validates
--     toastDefaults against the same list.)
--   - post, start_thread and spin (all 0105) gain `framing uuid[] default '{}'` and call write_framed after the Act is written. Each is dropped and created whole, since the
--     signature changes: with the default, a call that names no `framing` reads as before, and no overload is left beside the new one. Their grants are restated for the new signatures.
--
-- Ways out: nothing here adds a state a player can be put in; an alert is read and cleared as every alert is.

alter table alerts drop constraint alerts_kind_check;
alter table alerts add constraint alerts_kind_check check (kind in ('quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'cardEnded', 'framed'));

alter table account_preferences drop constraint account_preferences_toasts_check;
alter table account_preferences add constraint account_preferences_toasts_check
  check (toasts is null or toasts <@ array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed']);

-- set_preferences (0115, which made it again with the board mode), with `framed` among the kinds a toast may name. Everything else as 0115 wrote it; the signature is 0115's, so this replaces that one.
create or replace function set_preferences(theme text default null, postbit text default null, motion text default null,
  smoke text default null, contrast text default null, text_size integer default null, tilt text default null, mode text default null,
  toasts text[] default null, toasts_default boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  kept account_preferences%rowtype;
  known text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed'];
  bad text;
  once text[];
begin
  if theme is not null and theme !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'a theme is named in lowercase words joined by hyphens' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if postbit is not null and postbit not in ('side', 'stacked') then raise exception 'the postbit is side or stacked' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if motion is not null and motion not in ('system', 'reduce', 'full', 'snappy') then raise exception 'motion follows the system, or is off, smooth or snappy' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if smoke is not null and smoke not in ('full', 'low', 'off') then raise exception 'the smoke is full, low or off' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if contrast is not null and contrast not in ('standard', 'high') then raise exception 'contrast is standard or high' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if text_size is not null and text_size not in (100, 125, 150, 200) then raise exception 'text size is 100, 125, 150 or 200 percent' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if tilt is not null and tilt not in ('off', 'on') then raise exception 'tilt is off or on' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if mode is not null and mode not in ('system', 'light', 'dark') then raise exception 'the mode follows the device, or is light or dark' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null and coalesce(toasts_default, false) then raise exception 'the toasts are chosen or put back to the defaults, not both' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if toasts is not null then
    select string_agg(coalesce(k, '(blank)'), ', ' order by first) into bad from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) where k is null or not k = any (known) group by k) u;
    if bad is not null then raise exception 'not a kind of alert: %', bad using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- Repaired, not refused: the same kind named twice is the kind once, in the order it was first named.
    select coalesce(array_agg(k order by first), '{}') into once from (select k, min(n) as first from unnest(toasts) with ordinality t(k, n) group by k) d;
  end if;
  insert into account_preferences as p (account, theme, postbit, motion, smoke, contrast, text_size, tilt, mode, toasts)
  values (caller, coalesce(theme, 'default'), coalesce(postbit, 'side'), coalesce(motion, 'system'),
    coalesce(smoke, 'full'), coalesce(contrast, 'standard'), coalesce(text_size, 100), coalesce(tilt, 'off'), coalesce(mode, 'system'), once)
  on conflict (account) do update set theme = coalesce(set_preferences.theme, p.theme), postbit = coalesce(set_preferences.postbit, p.postbit),
    motion = coalesce(set_preferences.motion, p.motion), smoke = coalesce(set_preferences.smoke, p.smoke),
    contrast = coalesce(set_preferences.contrast, p.contrast), text_size = coalesce(set_preferences.text_size, p.text_size),
    tilt = coalesce(set_preferences.tilt, p.tilt), mode = coalesce(set_preferences.mode, p.mode),
    toasts = case when coalesce(set_preferences.toasts_default, false) then null when set_preferences.toasts is not null then once else p.toasts end
  returning * into kept;
  return preferences_answer(kept);
end $$;

revoke execute on function set_preferences(text, text, text, text, text, integer, text, text, text[], boolean) from public, anon;
grant execute on function set_preferences(text, text, text, text, text, integer, text, text, text[], boolean) to authenticated;

-- settings_held (0116), with `framed` among the kinds toastDefaults may name. Everything else as 0116 wrote it.
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed'];
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

-- write_framed: see the header. Called by post, start_thread and spin after the Act is written.
create function write_framed(body text, framing uuid[], about uuid, acting uuid) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  named uuid;
begin
  if body is null or framing is null then return; end if;
  for named in select t.id from unnest(framing[1:5]) with ordinality t(id, n) where t.id is not null group by t.id order by min(t.n) loop
    if exists (select 1 from characters c where c.id = named and c.debuted_at is not null)
       and position('user=' || lower(named::text) in lower(body)) > 0 then
      perform write_alert(named, 'framed', null, about, acting);
    end if;
  end loop;
end $$;
revoke execute on function write_framed(text, uuid[], uuid, uuid) from public, anon, authenticated, service_role;

-- post (0105), with `framing`, and the framed alerts written after the quote's alert and before the rules are checked. Everything else as 0105 wrote it.
drop function post(uuid, uuid, text, uuid);
CREATE FUNCTION public.post(in_thread uuid, through uuid, body text, quoting uuid DEFAULT NULL::uuid, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  written uuid;
  sprung jsonb;
  candidate uuid;
  maybe uuid[];
  parked uuid[];
  locked uuid[];
  passes uuid[];
  setters uuid[];
begin
  perform acting(through);
  perform not_banned(through);
  perform within('body', body, 'postMaxLength');
  select board into on_board from threads where id = in_thread;
  if on_board is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  if quoting is not null and not exists (select 1 from acts where id = quoting) then raise exception 'there is no such Act to quote' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- What this post may pass: the thread's waiting backs on others' posts (the partial index), those that have sprung apart, since a
  -- sprung back is neither locked nor probed for a lock (a spring is public, and acts_one_spring finds it by index).
  select coalesce(array_agg(w.play) filter (where not w.sprung), '{}'), coalesce(array_agg(w.play) filter (where w.sprung), '{}') into maybe, parked
  from (select r.play, exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = r.play::text) as sprung
        from face_down_reply r join face_down f on f.play = r.play join acts p on p.id = f.post
        where r.thread = in_thread and r.passed_by is null and p.character is distinct from through) w;
  -- Plus the quoted post's live, unsprung back, passed or not.
  maybe := maybe || array(select f.play from face_down f
                          where f.post = quoting and f.ends_at > now() and f.play <> all (maybe)
                            and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text));
  -- Step 3: those backs with their reply rows, in `play` order, in one statement. A reply row is read as locked: a post that passed a
  -- back while this waited has stamped it, and it is not this post's to pass. spring_traps then finds each row already held.
  select coalesce(array_agg(b.play), '{}'), coalesce(array_agg(b.play) filter (where b.waits and b.poster is distinct from through), '{}'),
         coalesce(array_agg(b.setter), '{}')
    into locked, passes, setters
  from (select f.play, s.character as setter, p.character as poster, (r.passed_by is null and r.thread = in_thread) as waits
        from face_down f join face_down_reply r on r.play = f.play join acts s on s.id = f.play join acts p on p.id = f.post
        where f.play = any (maybe)
        order by f.play for update of f, r) b;
  -- Step 4: the thread whose seq the insert takes.
  perform 1 from threads where id = in_thread for no key update;
  -- Step 5: the poster's count row and every setter's, by character, each made first where it is missing.
  insert into character_post_counts (character)
  select distinct c from unnest(setters || through) c order by c on conflict do nothing;
  perform 1 from character_post_counts where character = any (setters || through) order by character for update;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'post', in_thread, quoting, jsonb_build_object('body', body)) returning id into written;
  -- Only a back this post locked springs (the header's note on `held`).
  if quoting is not null then sprung := spring_traps('quote', quoting, written, held => locked); end if;
  -- Locked and read as waiting in step 3, so no other post can have stamped them.
  update face_down_reply set passed_by = written, passed_at = now() where play = any (passes);
  -- The sprung ones are stamped without waiting: a post that locked one in step 3 (it read the back unsprung) may hold the row and
  -- wait on this post's thread or count row, so a wait here could cross. A row held by another is skipped and stays waiting; the next
  -- post by another character stamps it.
  if cardinality(parked) > 0 then
    update face_down_reply set passed_by = written, passed_at = now()
    where play in (select r.play from face_down_reply r where r.play = any (parked) and r.passed_by is null order by r.play for update skip locked);
  end if;
  if sprung is null then
    for candidate in
      select f.post from face_down f join acts p on p.id = f.post
      where f.play = any (passes)
      group by f.post, p.seq order by p.seq desc
    loop
      sprung := spring_traps('reply', candidate, written, held => locked);
      exit when sprung is not null;
    end loop;
  end if;
  if quoting is not null then perform write_alert((select a.character from acts a where a.id = quoting), 'quote', null, written, auth.uid()); end if;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $function$;

-- start_thread (0105), with `framing`. Everything else as 0105 wrote it.
drop function start_thread(text, uuid, text, text);
CREATE FUNCTION public.start_thread(board_slug text, through uuid, title text, body text, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select id into on_board from boards where slug = board_slug;
  if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

-- spin (0105), with `framing`. Everything else as 0105 wrote it.
drop function spin(uuid, uuid, text, text);
CREATE FUNCTION public.spin(origin uuid, through uuid, title text, body text DEFAULT ''::text, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', coalesce(body, ''), 'postMaxLength', true);
  select case when b.is_system then players_board() else b.id end into on_board
  from acts a join threads t on t.id = a.thread join boards b on b.id = t.board where a.id = origin and a.kind <> 'edit';
  if on_board is null then raise exception 'there is no such Act to spin from' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into threads (board, title, origin_act_id) values (on_board, title, origin) returning id into made;
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'spin', made, origin, jsonb_build_object('title', title, 'body', coalesce(body, ''))) returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

revoke execute on function start_thread(text, uuid, text, text, uuid[]), post(uuid, uuid, text, uuid, uuid[]), spin(uuid, uuid, text, text, uuid[]) from public, anon;
grant execute on function start_thread(text, uuid, text, text, uuid[]), post(uuid, uuid, text, uuid, uuid[]), spin(uuid, uuid, text, text, uuid[]) to authenticated;
