-- Quote conditions (docs/plans/2026-11-08-quote-conditions-plan.md; the design is docs/plans/2026-11-08-quote-conditions-design.md). One migration for the whole plan: this file is written
-- section by section, one task at a time, so more sections follow the ones below; each section opens with a rule line naming its task.
--
-- Section: one looser matcher (Task 1; design section 2).
--
--   phrase_norm(t)          engine/bbcode/phrase.ts's `normalize`, in SQL. (1) A run of characters that are neither a letter or digit (phrase_word_class) nor whitespace, with a letter or digit on each side, is removed:
--                           "don't" is "dont", "e-mail" is "email", "U.S.A." is "USA". (2) Every other run of characters that are not letters or digits becomes one line break if it holds one, else one space.
--                           (3) The ends are trimmed. Whitespace and line breaks are written out as sets (the same two sets engine/bbcode/phrase.ts holds, never the locale's [[:space:]]): so a non-breaking
--                           space, an ideographic space (U+3000) and a line separator read as the engine reads them, and CJK or Arabic punctuation is punctuation. Three regexp_replace passes and a trim, each linear in the text (no pattern rescans a run from every start): the removal; every maximal run of non-word characters holding no line break becomes one space (a match always
--                           consumes its whole run, so nothing is retried); then a run of spaces and line breaks that holds a break becomes one line break (after the second pass a run with no break is a single space, so this match
--                           starts only where it succeeds); and btrim. The earlier lookahead that asked of each start position whether a break lay ahead in its run was quadratic in a long run.
--   phrase_in, phrase_pattern, phrase_probe   redefined to read both the text and the phrase through phrase_norm, then fold: phrase_fold(phrase_norm(x)). Normalizing first matters: phrase_fold sets the
--                           dotted capital I aside as a private-use character, which is not a letter, so it must not meet the removal. Everything else is 0142's as written.
--
-- A normalized phrase is never longer than the phrase: a removed run shrinks it, every other run becomes one character, and the trim only shortens it. So it is still at most 100 characters (SET_PHRASE_MOST,
-- engine/rules/cards.ts), and what it holds besides letters and digits is only spaces and line breaks, which a pattern does not escape, so its escaped form is no longer than the phrase's was. phrase_pattern's
-- 400-character padding therefore still gives every back one pattern length, and no back's time says whether it held a phrase (0142's cost argument is unchanged).
--
-- Masks. Nothing here is computed from a private fact: the matcher reads the quoting post's public words and a phrase the setter wrote; a response differs with neither who owns a character nor a class.
-- It is one list in two languages with phrase.ts: engine/bbcode/phrase.fixtures.ts is held to `phraseIn` by phrase.test.ts, supabase/tests/0136-phrase.sql (tools/phrase-sql.mjs) holds phrase_in to it.

-- phrase_norm(t): what the matcher reads of a string. Immutable: it reads nothing but its argument. The whitespace set and the line-break set are written out in its patterns (see the header).
create or replace function phrase_norm(t text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(t,
            '(' || w.c || ')((?:(?!' || w.c || ')[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000])+)(?=' || w.c || ')', '\1', 'g'),
          '(?:(?!' || w.c || ')[^\u000a-\u000d\u0085\u2028\u2029])+', ' ', 'g'),
        '[ \u000a-\u000d\u0085\u2028\u2029]*[\u000a-\u000d\u0085\u2028\u2029][ \u000a-\u000d\u0085\u2028\u2029]*', E'\n', 'g'),
    E' \n')
  from (select phrase_word_class() as c) w
$$;

create or replace function phrase_in(plain text, phrase text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case
    when plain is null or phrase is null or phrase !~ phrase_word_class() then false
    else phrase_fold(phrase_norm(plain)) ~ ('(?<!' || phrase_word_class() || ')'
                               || regexp_replace(phrase_fold(phrase_norm(phrase)), '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
                               || '(?!' || phrase_word_class() || ')')
  end
$$;

-- phrase_pattern(phrase, token): the pattern phrase_probe runs, '(?<!C)(?:A|B)(?!C)' with C the word class. A is the escaped folded normalized phrase, or for no phrase a contradiction no text satisfies (an assertion that 'a' is and is not next)
-- and the escaped token; B is the same contradiction, the escaped token (the back's own id, so the pattern is its own) and padding after escaping, to make A and B together 400 characters. A phrase is at most 100 characters
-- (the engine's SET_PHRASE_MOST, engine/rules/cards.ts, which decideSet and place_set both hold), 200 escaped at the most, and normalizing never makes it longer (the header), so the length is the same for every back whatever it holds. B never matches, so the answer is A's.
create or replace function phrase_pattern(phrase text, token text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select '(?<!' || phrase_word_class() || ')(?:' || x.a || '|' || rpad(x.b, greatest(length(x.b), 400 - length(x.a)), 'z') || ')(?!' || phrase_word_class() || ')'
  from (select case when r.real then regexp_replace(phrase_fold(phrase_norm(phrase)), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') else '(?=a)(?!a)' || regexp_replace(token, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') end as a,
               '(?=a)(?!a)' || regexp_replace(token, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') as b
        from (select phrase is not null and phrase ~ phrase_word_class() as real) r) x
$$;

-- phrase_probe(plain, phrase, token): phrase_in's answer, by nearly the same work whether or not there is a phrase: the text is normalized and folded and phrase_pattern is compiled and run for every back; a back with no phrase answers false. The one difference is that a back with a phrase
-- also normalizes and folds the phrase (phrase_pattern skips that when r.real is false), bounded by the phrase's 100 characters, so it is not text-dependent.
create or replace function phrase_probe(plain text, phrase text, token text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when plain is null then false else (phrase_fold(phrase_norm(plain)) ~ phrase_pattern(phrase, token)) and (phrase is not null and phrase ~ phrase_word_class()) end
$$;

-- As phrase_fold's (0142): called by the write that springs a back, never by the API's anonymous or digest roles. phrase_in is inlined into its caller's plan, so its caller needs phrase_norm.
revoke execute on function phrase_norm(text) from public, anon;
grant execute on function phrase_norm(text) to authenticated, service_role;


-- ============================================================================ Task 2: the excerpt, in the same walk ====
--
-- The excerpt of an Act in a post (design section 3; plan Task 2): the visible text of every real quote of that Act that no other real quote encloses, joined with a line break (an empty quote
-- still takes its place). A quote of the Act inside a quote of another Act is that Act's words and does not count; a quote inside a real link is not found, as engine/bbcode/visible.ts
-- excerptText does not find it; a counterfeit quote naming the Act is the post's own words and is not a quote of it.
--
--   bbcode_walk(body, quoted)   0118's bbcode_plain with one frame kind added: a real quote whose head names `quoted`, with no real quote or real link open (open_sep = 0), is a `keep` frame. In the
--                               plain output it is cut back to one separator as any real quote is; its words (nested real quotes and links already cut back to a separator in them) are also copied to a
--                               second output. Kept quotes never nest, so the copy is linear. Returns (plain, excerpt); with a null `quoted` the excerpt is empty and plain is bbcode_plain's.
--   bbcode_plain(body)          (bbcode_walk(body, null)).plain, so the one parser serves both ("Two lists that must agree are one list"). Its signature, volatility and search_path are 0118's
--                               and its grants follow it (the search index's trigger and reads call it; never the API's anonymous or digest roles). Nothing depends on it more closely than by name:
--                               search_words_of and the search reads (0117) and phrase_probe's callers (0142) call it, and create or replace keeps them.
--   bbcode_plain_quote_act(rest)  the Act id a real quote opener names (lowercase), for the walk to compare; null when the opener is not a real quote.
--
-- Held by supabase/tests/0117-bbcode-plain.sql (made by tools/bbcode-plain.mjs from engine/bbcode/plain.fixtures.ts: every fixture's plain words, and its excerpt where it names an excerptOf)
-- and supabase/tests/0118-bbcode-plain-scale.sql (the wrapper keeps the walk linear). Ways out: nothing here adds a state a player can be put in.

-- The name in a real quote opener (what follows `quote`): bbcode_plain_quote_head's own reading of it, so it is called only for an opener that head calls real.
create or replace function bbcode_plain_quote_act(rest text) returns text
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  v text;
  j int;
  m text[];
  nm text;
begin
  if bbcode_plain_quote_head(rest) is distinct from 'real' or left(rest, 1) <> '=' then return null; end if;
  v := substr(rest, 2);
  if left(v, 1) = '"' then
    j := strpos(substr(v, 2), '"');
    nm := left(substr(v, 2), j - 1);
  else
    m := regexp_match(v, '^(.*?)[\u0009-\u000d    -     　﻿][uU][sS][eE][rR]=');
    nm := case when m is null then v else m[1] end;
  end if;
  return lower(bbcode_plain_trim(nm));
end
$$;

create or replace function bbcode_walk(body text, quoted uuid) returns table(plain text, excerpt text)
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
  f_kind text[] := array['root'];     -- root, pass (words go up), sep (words dropped, one separator goes up), keep (a sep whose words also go to the excerpt), list, bareurl, literal
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
  -- The excerpt (this migration): ex[1..xc] are the pieces of the quotes of `quoted`, kept = how many such quotes have closed, open_sep = real quotes and real links open (a quote
  -- is kept only with none open, so a quote inside another quote, or inside a link, is not found, as engine/bbcode/visible.ts excerptText does not find it).
  ex text[] := array[]::text[];
  xc int := 0;
  kept int := 0;
  open_sep int := 0;
  quoted_text text := lower(quoted::text);
begin
  if body is null or body = '' then plain := ''; excerpt := ''; return next; return; end if;
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
      if k = 'sep' or k = 'keep' then open_sep := open_sep - 1; end if;
      sp := sp - 1;
      cl := case when matched then unw_raw end;
      if k = 'literal' then
        if matched then oc := oc + 1; out[oc] := unw_raw; end if;
      else
        if k = 'pass' then
          null;                                       -- its words are already in place
        elsif k = 'list' then
          oc := oc + 1; out[oc] := E'\n';
        elsif k = 'sep' or k = 'keep' then
          -- A kept quote's words go to the excerpt first (nested real quotes and links in them are already one separator each, as in the plain output), one separator before each after the first.
          -- Kept quotes never nest, so each piece of out is copied at most once and the cost stays linear.
          if k = 'keep' then
            if kept > 0 then xc := xc + 1; ex[xc] := E'\n'; end if;
            kept := kept + 1;
            for j in fstart + 1..oc loop xc := xc + 1; ex[xc] := out[j]; end loop;
          end if;
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
      -- A real quote of the Act asked for, with no real quote or real link open, is kept: cut from the plain output as any real quote is, and its words go to the excerpt.
      if want = 'sep' and quoted is not null and open_sep = 0 and bbcode_plain_quote_act(qrest) = quoted_text then want := 'keep'; end if;
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
      if want = 'sep' or want = 'keep' then open_sep := open_sep + 1; end if;
    end if;
    cnt[array_position(counted, nm)] := cnt[array_position(counted, nm)] + 1;
    t := t + 1;
  end loop;
  plain := array_to_string(out[1 : oc], '');
  excerpt := array_to_string(ex[1 : xc], '');
  return next;
  return;
end
$$;

create or replace function bbcode_plain(body text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select w.plain from bbcode_walk(body, null) w
$$;

revoke execute on function bbcode_plain(text), bbcode_walk(text, uuid), bbcode_plain_quote_act(text) from public, anon;
grant execute on function bbcode_plain(text), bbcode_walk(text, uuid), bbcode_plain_quote_act(text) to authenticated, service_role;
