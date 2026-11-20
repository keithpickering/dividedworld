-- Forged quotes, task 1: the quote's text and a version's source (docs/plans/2026-11-20-forged-quotes-plan.md, Task 1; #403). A real quote whose words are not in the post it names is a counterfeit
-- (docs/plans/2026-11-20-forged-quotes-design.md, section 1), and the words of both sides are read here and in engine/bbcode/quoted.ts, one list in two languages, held to the same fixtures
-- (engine/bbcode/plain.fixtures.ts, supabase/tests/0117-bbcode-plain.sql). The later tasks of the plan add their sections below this one.
--
-- 1. quote_norm(t) and bbcode_walk's `held` and `source`.
--   quote_norm is quoteNorm: Unicode NFC; each run of whitespace (the engine's \s, written out) one space; a run of more than eight of one code point eight (quote_run_cap, linear); trimmed; one leading `...`+ or `…` and one trailing
--   one removed with the space beside each; trimmed again. Immutable, plain SQL.
--   bbcode_walk (0350's definition) gains two output columns, `held jsonb` (an object from each Act a real quote names, not a cut's, to an array of its quotes in the order their openers stand, each an array of
--   pieces: the quote's words normalized and split at each cut) and `source text` (quote_norm of the words of the whole body, a cut a cut mark between separators), from the same single pass: every word is
--   also written to a second buffer that drops nothing, and a real quote's words are that buffer from where its frame began, joined once at its close (a quote's nesting is capped at 16, so a word is joined
--   at most 16 times). It also takes a third argument, `forged uuid[]`, an Act's verdict (section 2 below): a real quote of a forged post walks as a counterfeit. A function's return type and argument list cannot change under create or replace, so
--   it is dropped and made again with its grants restated; bbcode_plain (0316) is a SQL wrapper that names it without a dependency, and every reader of the columns by name calls it with two arguments.
--   The cut mark is U+FDD0, not U+0000, which a Postgres text cannot hold; every word has it stripped so only a cut puts one in the text.
--   Security: invoker, no table is read, search_path ending in pg_temp, as bbcode_walk was.

-- A run of more than eight of one code point is eight. Not `regexp_replace(t, '(.)\1{8,}', ...)`: a backreference regex is quadratic in Postgres (8,000 characters took 1.3 s, 36,000 took 24 s), and this runs
-- over every body. One pass over the code points instead, each kept unless it is the ninth or later of its run; the array is rewritten in place, so it is linear.
create function quote_run_cap(t text) returns text
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  cs text[];
  n int;
  i int;
  oc int := 0;
  run int := 0;
  prev text;
begin
  if t is null or t = '' then return t; end if;
  cs := regexp_split_to_array(t, '');
  n := array_length(cs, 1);
  for i in 1..n loop
    if cs[i] is not distinct from prev then run := run + 1; else run := 1; prev := cs[i]; end if;
    if run <= 8 then oc := oc + 1; cs[oc] := cs[i]; end if;
  end loop;
  return array_to_string(cs[1 : oc], '');
end
$$;

revoke execute on function quote_run_cap(text) from public, anon;
grant execute on function quote_run_cap(text) to authenticated, service_role;

create function quote_norm(t text) returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        btrim(
          quote_run_cap(regexp_replace(normalize(t, nfc), '[\u0009-\u000d \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g')),
          ' '),
        '^(\.{3,}|\u2026) ?', ''),
      ' ?(\.{3,}|\u2026)$', ''),
    ' ')
$$;

revoke execute on function quote_norm(text) from public, anon;
grant execute on function quote_norm(text) to authenticated, service_role;

drop function bbcode_walk(text, uuid);

create function bbcode_walk(body text, quoted uuid, forged uuid[] default '{}') returns table(plain text, excerpt text, quotes text[], unquoted text, held jsonb, source text)
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
  max_depth constant int := 16;       -- MAX_DEPTH
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
  -- Every real quote the walk makes a frame for, the Act it names (lowercase), in the order they open: qs[1..qc], written by index as out[] is, never appended to in the loop; the list is made distinct once, at the end.
  qs text[] := array[]::text[];
  qc int := 0;
  qact text;
  -- The body as written with every real quote cut out, from its opener to its closer (and to the end of the body when it never closes): dd is a difference array over the tokens,
  -- +1 at a dropped quote's opener and -1 after its last token, so the running sum says which tokens are inside a quote. Nested quotes sum, and the nesting costs nothing more.
  f_tok int[] := array[0];            -- per frame, the token its opener was
  dd int[];
  dn int := 0;
  ftok int;
  dend int;
  cut boolean;                        -- the quote being opened is a real one at the cap
  -- The version source and the quote texts (this migration): sr[1..sc] are the pieces of every word a reader sees, in the order the renderer draws them, as engine/bbcode/quoted.ts quoteWords reads them: no frame drops its
  -- words here (a quote's, a link's and code's all stay), a block edge is one '\n', and a cut (a real quote past the cap, not shown) is '\n' || cutc || '\n' with its words dropped. A piece past sc is stale and is overwritten.
  -- A real quote's words are the pieces of sr from where its frame began, nested quotes' words included, so each is joined once at its close and the walk stays one pass; hq[i] are the pieces of the i-th real quote
  -- (qs[i]), as a jsonb array, null for a cut. cutc is U+FDD0: a Postgres text cannot hold U+0000, and every word has it stripped, so only a cut puts one in the text.
  cutc constant text := chr(64976);
  sr text[] := array[]::text[];
  sc int := 0;
  hq jsonb[] := array[]::jsonb[];
  f_sstart int[] := array[0];         -- per frame, sc at its first word (a link's opener, or a quote's leading separator, is the piece at it or before it)
  f_q int[] := array[0];              -- per frame, its index in qs when it is a real quote with an Act, else 0
  f_cut boolean[] := array[false];    -- per frame, a cut
  fsstart int;
  fq int;
  fcut boolean;
  stitle text;
  qnorm text;
  qw text[] := array[]::text[];
  xn int;
begin
  if body is null or body = '' then plain := ''; excerpt := ''; quotes := '{}'; unquoted := ''; held := '{}'::jsonb; source := ''; return next; return; end if;
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
  dd := array_fill(0, array[n + 2]);
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
      k := f_kind[sp]; fname := f_name[sp]; fstart := f_start[sp]; ftok := f_tok[sp]; fsstart := f_sstart[sp]; fq := f_q[sp]; fcut := f_cut[sp];
      matched := unw = 1 and fname = unw_name;
      idx := array_position(counted, fname);
      if idx is not null then cnt[idx] := cnt[idx] - 1; end if;
      if k <> 'literal' and fname = 'url' then open_urls := open_urls - 1; end if;
      if k <> 'literal' and fname = 'ispoiler' then open_isp := open_isp - 1; end if;
      if k = 'sep' or k = 'keep' then open_sep := open_sep - 1; end if;
      sp := sp - 1;
      cl := case when matched then unw_raw end;
      if k = 'literal' then
        if matched then oc := oc + 1; out[oc] := unw_raw; sc := sc + 1; sr[sc] := replace(unw_raw, cutc, ''); end if;
      else
        if k = 'pass' then
          -- its words are already in place; a block edge closes with a separator
          if fname in ('center', 'left', 'right', 'marquee', 'spoiler', 'quote') then sc := sc + 1; sr[sc] := E'\n'; end if;
        elsif k = 'list' then
          oc := oc + 1; out[oc] := E'\n';
          sc := sc + 1; sr[sc] := E'\n';
        elsif k = 'sep' or k = 'keep' then
          -- A kept quote's words go to the excerpt first (nested real quotes and links in them are already one separator each, as in the plain output), one separator before each after the first.
          -- Kept quotes never nest, so each piece of out is copied at most once and the cost stays linear.
          if k = 'keep' then
            if kept > 0 then xc := xc + 1; ex[xc] := E'\n'; end if;
            kept := kept + 1;
            for j in fstart + 1..oc loop xc := xc + 1; ex[xc] := out[j]; end loop;
          end if;
          oc := fstart + 1; out[oc] := E'\n';         -- drop its words, back to where it began
          if fname = 'quote' then
            -- its tokens, opener to the last one read (a closer that closed an outer frame to close this one is the outer frame's, so it stays)
            dend := case when unw = 1 and not matched then t - 2 else t - 1 end;
            dd[ftok] := dd[ftok] + 1; dd[dend + 1] := dd[dend + 1] - 1;
            if fcut then
              -- a cut is not shown: its words (and the cuts inside it) go, one cut mark stays between two separators
              sc := fsstart; sc := sc + 1; sr[sc] := cutc; sc := sc + 1; sr[sc] := E'\n';
            else
              -- a real quote's words, normalized and split at each cut mark: its pieces
              if fq > 0 then
                -- Its pieces are copied out one at a time: a slice of sr would flatten the whole array at every close (quadratic in the quotes of a post), and this costs the quote's own size.
                xn := 0;
                for j in fsstart + 1..sc loop xn := xn + 1; qw[xn] := sr[j]; end loop;
                qnorm := quote_norm(array_to_string(qw[1 : xn], ''));
                hq[fq] := case when qnorm = '' then '[]'::jsonb
                  else to_jsonb(string_to_array(replace(replace(qnorm, ' ' || cutc, cutc), cutc || ' ', cutc), cutc)) end;   -- each piece trimmed: the blanks beside a cut mark go
              end if;
              sc := sc + 1; sr[sc] := E'\n';
            end if;
          end if;
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
            sr[fsstart] := '';                        -- a link's words stay, its opener does not
          elsif cl is not null then
            oc := oc + 1; out[oc] := cl;
            sc := sc + 1; sr[sc] := replace(cl, cutc, '');
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
    if length(tok) < 2 or left(tok, 1) <> '[' then oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue; end if;
    b := substr(tok, 2, length(tok) - 2);
    if b = '' or length(b) > max_tag or (length(b) > max_tag / 2 and bbcode_plain_u16len(b) > max_tag) then
      oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue;
    end if;
    val := null;
    qrest := null;
    if b = '*' then
      nm := '*';
    elsif left(b, 1) = '/' then
      nm := lower(substr(b, 2));
      if not (nm = any (closers)) then oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue; end if;
      -- A closer with nothing open to close is text; otherwise it closes the nearest opener of its name and what was opened inside it. Inside an inline spoiler the closer of a block tag
      -- or a link is text, and a [/video] or [/youtube] is always text (no frame of either is ever open).
      t := t + 1;
      if (open_isp > 0 and (nm = any (blocks) or nm = 'url')) or nm in ('video', 'youtube') or cnt[array_position(counted, nm)] = 0 then
        oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, '');
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
      if not (nm = any (openers)) then oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue; end if;
      if eq > 0 then
        val := substr(b, eq + 1);
        if length(val) >= 2 and left(val, 1) = '"' and right(val, 1) = '"' then val := substr(val, 2, length(val) - 2); end if;
      end if;
    end if;

    if open_isp > 0 and nm <> '*' and (nm = any (blocks) or nm = 'url' or nm = 'ispoiler') then
      -- A block tag, a link or another inline spoiler inside an inline spoiler is the words as written (the spoiler is a button, and a button holds nothing interactive).
      oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue;
    end if;

    if nm = '*' then
      -- An item marker is one only directly inside a list; elsewhere it is text.
      oc := oc + 1; sc := sc + 1;
      if f_kind[f_home[sp]] = 'list' then out[oc] := E'\n'; sr[sc] := E'\n'; else out[oc] := tok; sr[sc] := replace(tok, cutc, ''); end if;
      t := t + 1; continue;
    elsif nm = 'hr' then
      -- A rule is a leaf with no closer; with an attribute it is text.
      oc := oc + 1; sc := sc + 1;
      if val is null then out[oc] := E'\n'; sr[sc] := E'\n'; f_nodey[f_home[sp]] := true; else out[oc] := tok; sr[sc] := replace(tok, cutc, ''); end if;
      t := t + 1; continue;
    elsif nm = 'code' then
      -- Raw up to the closing tag; with none, or an attribute, only the opener is text.
      if val is null and nxt_code[t] > 0 then
        oc := oc + 1; out[oc] := E'\n'; f_nodey[f_home[sp]] := true;
        sc := sc + 1; sr[sc] := E'\n';
        for idx in t + 1..nxt_code[t] - 1 loop sc := sc + 1; sr[sc] := replace(toks[idx], cutc, ''); end loop;
        sc := sc + 1; sr[sc] := E'\n';
        t := nxt_code[t] + 1; continue;
      end if;
      oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue;
    elsif nm = 'noparse' then
      -- Raw up to the closing tag, its contents one node of the post's own words as written (none at all when empty); with no closer, or an attribute, only the opener is text.
      j := nxt_noparse[t];
      if val is null and j > 0 then
        if j > t + 1 then
          -- Its tokens go in piece by piece (a substr of the body would walk to its offset each time, and a slice of toks would copy it), and are joined once at the end.
          for idx in t + 1..j - 1 loop oc := oc + 1; out[oc] := toks[idx]; sc := sc + 1; sr[sc] := replace(toks[idx], cutc, ''); end loop;
          f_np[f_home[sp]] := f_np[f_home[sp]] + 1;
          f_npp[f_home[sp]] := f_npp[f_home[sp]] + (j - t - 1);
        end if;
        t := j + 1; continue;
      end if;
      oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue;
    elsif nm = 'img' then
      j := nxt_img[t];
      if val is null and j > 0 and cum[j - 1] - cum[t] <= max_raw then
        contents := '';                               -- joined token by token, since a slice of toks would copy the whole array each time; the check above bounds it
        for idx in t + 1..j - 1 loop contents := contents || toks[idx]; end loop;
        if bbcode_plain_u16len(contents) <= max_raw and bbcode_plain_url_ok(contents, array['http','https'], false) then
          oc := oc + 1; out[oc] := E'\n'; sc := sc + 1; sr[sc] := E'\n'; f_nodey[f_home[sp]] := true; t := j + 1; continue;
        end if;
      end if;
      oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue;
    elsif nm = 'video' or nm = 'youtube' then
      -- Taken as an image is; the contents (trimmed) must be an address videoOf has a player for, or for [youtube] a bare id. Otherwise only the opener is text.
      j := case when nm = 'video' then nxt_video[t] else nxt_youtube[t] end;
      if val is null and j > 0 and cum[j - 1] - cum[t] <= max_raw then
        contents := '';
        for idx in t + 1..j - 1 loop contents := contents || toks[idx]; end loop;
        if bbcode_plain_u16len(contents) <= max_raw then
          vid := bbcode_plain_trim(contents);
          if vid <> '' and ((nm = 'youtube' and vid ~ '^[A-Za-z0-9_-]{11}$') or bbcode_plain_video_ok(vid) is true) then
            oc := oc + 1; out[oc] := E'\n'; sc := sc + 1; sr[sc] := E'\n'; f_nodey[f_home[sp]] := true; t := j + 1; continue;
          end if;
        end if;
      end if;
      oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); t := t + 1; continue;
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
      -- A real quote of a forged post (the Act's verdict, `forged`) is a counterfeit, parse.ts's `forged`: its words are the post's own, in plain and in unquoted and in the source, and it is no real quote, so it is
      -- never in quotes, the excerpt or held, and past the cap it is text as any counterfeit is. A forged post's every quote in the body is one, each by its Act id in any letters.
      if want = 'sep' and coalesce(bbcode_plain_quote_act(qrest)::uuid = any (forged), false) then want := 'pass'; end if;
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

    -- A real quote whose home is at the cap is cut, not text (parse.ts openCut): a frame like any real quote's, a sep and never the excerpt's keep (what is not shown is not excerpted), so its Act is in
    -- quotes, its words are dropped from plain and from unquoted, and a real quote inside it is a frame the same way. Every other opener past the cap, a counterfeit quote included, is text.
    cut := nm = 'quote' and want in ('sep', 'keep') and f_depth[f_home[sp]] >= max_depth;
    if cut then want := 'sep'; end if;

    if want is null or (f_depth[f_home[sp]] >= max_depth and not cut) then
      -- An opener that is text, kept on the stack so its closer is text too.
      oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, '');
      sp := sp + 1;
      f_kind[sp] := 'literal'; f_name[sp] := nm; f_start[sp] := 0;
      f_depth[sp] := f_depth[sp - 1]; f_home[sp] := f_home[sp - 1]; f_nodey[sp] := false; f_np[sp] := 0; f_npp[sp] := 0; f_tok[sp] := t; f_q[sp] := 0;
    else
      -- A list puts a separator before its words, and a bare link its opener (given back as text if it is not a link), so each is the piece before the frame's start.
      if want = 'list' then oc := oc + 1; out[oc] := E'\n'; sc := sc + 1; sr[sc] := E'\n'; elsif want = 'bareurl' then oc := oc + 1; out[oc] := tok; sc := sc + 1; sr[sc] := replace(tok, cutc, ''); end if;
      sp := sp + 1;
      f_kind[sp] := want; f_name[sp] := nm; f_start[sp] := oc;
      f_depth[sp] := f_depth[f_home[sp - 1]] + 1; f_home[sp] := sp; f_nodey[sp] := false; f_np[sp] := 0; f_npp[sp] := 0; f_tok[sp] := t; f_q[sp] := 0;
      -- a block edge opens with a separator in the source, a spoiler with its title between two (the default title when it has none, as the parser shows it)
      if nm in ('center', 'left', 'right', 'marquee', 'quote') then
        sc := sc + 1; sr[sc] := E'\n';
      elsif nm = 'spoiler' then
        stitle := coalesce(nullif(bbcode_plain_trim(val), ''), 'Spoiler');
        sc := sc + 1; sr[sc] := E'\n'; sc := sc + 1; sr[sc] := replace(stitle, cutc, ''); sc := sc + 1; sr[sc] := E'\n';
      end if;
      if nm = 'url' then open_urls := open_urls + 1; end if;
      if nm = 'ispoiler' then open_isp := open_isp + 1; end if;
      if want = 'sep' or want = 'keep' then open_sep := open_sep + 1; end if;
      -- A real quote that made a frame (one past max_depth is a cut, and is here): its Act.
      if nm = 'quote' and (want = 'sep' or want = 'keep') then
        qact := bbcode_plain_quote_act(qrest);
        if qact is not null then qc := qc + 1; qs[qc] := qact; f_q[sp] := qc; end if;
      end if;
    end if;
    f_sstart[sp] := sc; f_cut[sp] := coalesce(cut, false);
    cnt[array_position(counted, nm)] := cnt[array_position(counted, nm)] + 1;
    t := t + 1;
  end loop;
  plain := array_to_string(out[1 : oc], '');
  excerpt := array_to_string(ex[1 : xc], '');
  oc := 0;
  for j in 1..n loop
    dn := dn + dd[j];
    if dn <= 0 then oc := oc + 1; out[oc] := toks[j]; end if;
  end loop;
  unquoted := array_to_string(out[1 : oc], '');
  -- Each Act once, at the place it first opens.
  quotes := coalesce((select array_agg(d.x order by d.o) from (select distinct on (u.x) u.x, u.o from unnest(qs[1 : qc]) with ordinality u(x, o) order by u.x, u.o) d), '{}');
  source := quote_norm(array_to_string(sr[1 : sc], ''));
  -- Each Act's quotes, in the order their openers stand. A cut's Acts are not shown and have no pieces: its slot in hq stays null (a gap, when a real quote opens after it), and the filter drops it.
  held := coalesce((select jsonb_object_agg(g.a, g.q) from (
    select u.a, jsonb_agg(h.p order by u.o) q from unnest(qs[1 : qc]) with ordinality u(a, o) join unnest(hq) with ordinality h(p, o) on h.o = u.o where h.p is not null group by u.a
  ) g), '{}'::jsonb);
  return next;
  return;
end
$$;

revoke execute on function bbcode_walk(text, uuid, uuid[]) from public, anon;
grant execute on function bbcode_walk(text, uuid, uuid[]) to authenticated, service_role;

-- ===================================================================================== 2. the readers pass the verdict ====
-- An Act's verdict is its payload's `forged` (the posts some real quote of which in its body is doctored; Task 3 writes it). A real quote of a forged post is a counterfeit in every reader, as parse.ts's third argument makes it in the
-- engine (docs/plans/2026-11-20-forged-quotes-design.md, sections 1, 5 and 7): its words are the poster's own, in plain, unquoted and the source, and it is no quote, so it is never in quotes, the excerpt or held.
-- act_forged(p) reads the verdict out of a payload; bbcode_plain, search_words and own_words take it as a last argument that defaults to none, so a body with no verdict reads as it always did. Each function below that reads an
-- Act's words is its latest definition (found with grep, as the plan says) with only the call changed: it passes act_forged of the payload the body came from, and where it read the body without the payload (own_words, and the `before`
-- read of claim_card_writes, which took the body of an edit) the payload is read with it. Every lock a copied function takes, and its order, stand as written.
-- Not passed here: acts_quote_guard (Task 4), and a draft body (quote_check, Task 3).

create function act_forged(p jsonb) returns uuid[]
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select coalesce((select array_agg(lower(x.v)::uuid order by x.o) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'forged') = 'array' then p -> 'forged' else '[]'::jsonb end) with ordinality x (v, o)
                   where x.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '{}'::uuid[])
$$;
revoke execute on function act_forged(jsonb) from public, anon;
grant execute on function act_forged(jsonb) to authenticated, service_role;

-- bbcode_plain (0316): the wrapper of bbcode_walk, now with the verdict. A second argument with a default would make the one-argument function ambiguous beside it, so the old one is dropped (nothing depends on it: a SQL function's body names it without a dependency).
drop function bbcode_plain(text);
create function bbcode_plain(body text, forged uuid[] default '{}') returns text
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select w.plain from bbcode_walk(body, null, forged) w
$$;
revoke execute on function bbcode_plain(text, uuid[]) from public, anon;
grant execute on function bbcode_plain(text, uuid[]) to authenticated, service_role;

-- search_words (0117): the verdict is a fourth argument; the three-argument function is dropped for the same reason as bbcode_plain's, and the two-argument one is kept as a verdict-free wrapper: it now resolves to the four-argument function with `forged` empty, and no reader of an Act's words calls it (only tests 0190 and 0191 do).
drop function search_words(text, text, regconfig);
create function search_words(body text, title text, lang regconfig, forged uuid[] default '{}') returns tsvector
language sql stable set search_path = public, pg_temp as $$
  select setweight(to_tsvector(lang, coalesce(title, '')), 'A') || to_tsvector(lang, bbcode_plain(body, forged))
$$;
revoke execute on function search_words(text, text, regconfig, uuid[]) from public, anon;
grant execute on function search_words(text, text, regconfig, uuid[]) to authenticated, service_role;

-- search_words_of, acts_search and search_backfill (0117, no later definition): the words of an Act's row, read with the verdict of the payload the body came from.
create or replace function search_words_of(act_id uuid, lang regconfig) returns tsvector
language sql stable security definer set search_path = public, pg_temp as $$
  select search_words(a.current_payload ->> 'body', case when a.seq = 1 then t.title end, lang, act_forged(a.current_payload))
  from acts_public a join threads t on t.id = a.thread where a.id = act_id
$$;

create or replace function acts_search() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  title text;
  tboard uuid;
  tseq integer;
begin
  if new.kind in ('post', 'spin') then
    select case when new.seq = 1 then t.title end, t.board into title, tboard from threads t where t.id = new.thread;
    insert into post_search (act, thread, board, first, character, created_at, words)
    values (new.id, new.thread, tboard, new.seq = 1, new.character, new.created_at, search_words(new.payload ->> 'body', title, search_lang(), act_forged(new.payload)));
  elsif new.kind = 'edit' then
    if exists (select 1 from acts x where x.kind = 'edit' and x.target_act_id = new.target_act_id and (x.created_at, x.id) > (new.created_at, new.id)) then return null; end if;
    select p.seq into tseq from acts p where p.id = new.target_act_id;
    select t.title into title from threads t where t.id = new.thread and tseq = 1;
    update post_search set words = search_words(new.payload ->> 'body', title, search_lang(), act_forged(new.payload)) where act = new.target_act_id;
  end if;
  return null;
end $$;

create or replace function search_backfill() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  insert into post_search (act, thread, board, first, character, created_at, words)
  select a.id, a.thread, t.board, a.seq = 1, a.character, a.created_at, search_words(a.current_payload ->> 'body', case when a.seq = 1 then t.title end, search_lang(), act_forged(a.current_payload))
  from acts_public a join threads t on t.id = a.thread
  where a.kind in ('post', 'spin') and not exists (select 1 from post_search p where p.act = a.id)
  on conflict (act) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- search_reindex_past_cap (0350)
create or replace function search_reindex_past_cap() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  lock table acts, post_search in share row exclusive mode;
  update post_search p set words = w.new_words
  from (
    select a.id as act, search_words(cur.body, case when a.seq = 1 then t.title end, search_lang(), cur.forged) as new_words
    from post_search s
    join acts a on a.id = s.act
    join threads t on t.id = a.thread
    left join lateral (
      select x.id, x.payload from acts x where x.kind = 'edit' and x.target_act_id = a.id and a.kind = 'post' order by x.created_at desc, x.id desc limit 1
    ) e on true
    cross join lateral (select coalesce(e.payload, a.payload) ->> 'body' as body, act_forged(coalesce(e.payload, a.payload)) as forged) cur
    where (cur.body ilike '%[quote%' or length(cur.body) - length(replace(cur.body, '[', '')) > 16)
      and not (case when e.id is null then a.kind = 'post' and version_hidden(a.id, a.id) else version_hidden(e.id, a.id) end)
  ) w
  where p.act = w.act and p.words is distinct from w.new_words;
  get diagnostics n = row_count;
  return n;
end $$;

-- search_posts (0368)
create or replace function public.search_posts(q text, author uuid, board uuid, from_at timestamp with time zone, to_at timestamp with time zone, titles_only boolean, sort text, after jsonb, per_page integer)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN (char_length(COALESCE(q, ''::text)) > 200) THEN screen_refusal('a search is at most 200 characters'::text)
             WHEN ((sort IS NOT NULL) AND (sort <> ALL (ARRAY['relevance'::text, 'newest'::text, 'oldest'::text]))) THEN screen_refusal('sort is relevance, newest or oldest'::text)
             WHEN ((COALESCE(per_page, 20) < 1) OR (COALESCE(per_page, 20) > 50)) THEN screen_refusal('a page holds 1 to 50 results'::text)
             WHEN (from_at >= to_at) THEN screen_refusal('the range ends before it begins'::text)
             WHEN ((after IS NOT NULL) AND (NOT search_cursor_ok(after, ((COALESCE(sort, 'relevance'::text) = 'relevance'::text) AND (btrim(COALESCE(q, ''::text)) <> ''::text))))) THEN screen_refusal('that is not a cursor this search gave'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH k AS MATERIALIZED (
          SELECT (btrim(COALESCE(q, ''::text)) <> ''::text) AS has_q
         ), cfg AS MATERIALIZED (
          SELECT COALESCE(search_posts.per_page, 20) AS pp,
             COALESCE(( SELECT ((x.settings ->> 'searchRankPool'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 5000) AS pool,
             COALESCE(( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 20) AS thread_pp,
                 CASE
                     WHEN (COALESCE(search_posts.sort, 'relevance'::text) = 'relevance'::text) THEN
                     CASE
                         WHEN k.has_q THEN 'relevance'::text
                         ELSE 'newest'::text
                     END
                     ELSE search_posts.sort
                 END AS s
            FROM k
         ), tsq AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN ( SELECT k.has_q
                        FROM k) THEN websearch_to_tsquery(search_lang(), q)
                     ELSE NULL::tsquery
                 END AS t
         ), au AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN (author IS NULL) THEN NULL::uuid
                     WHEN (EXISTS ( SELECT 1
                        FROM characters_public c
                       WHERE (c.id = search_posts.author))) THEN author
                     ELSE '00000000-0000-0000-0000-000000000000'::uuid
                 END AS id
         ), c AS MATERIALIZED (
          SELECT ((after ->> 'rank'::text))::double precision AS rank,
             ((after ->> 'at'::text))::timestamp with time zone AS at,
             ((after ->> 'act'::text))::uuid AS act
           WHERE (after IS NOT NULL)
         ), m AS MATERIALIZED (
          SELECT search_matches.act,
             search_matches.thread,
             search_matches.board,
             search_matches.title,
             search_matches."character",
             search_matches.created_at,
             search_matches.words
            FROM search_matches(search_posts.q, ( SELECT au.id
                    FROM au), search_posts.board, search_posts.from_at, search_posts.to_at, COALESCE(search_posts.titles_only, false), ( SELECT (cfg.s <> 'oldest'::text)
                    FROM cfg),
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) <> 'relevance'::text) THEN ( SELECT c.at
                        FROM c)
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) <> 'relevance'::text) THEN ( SELECT c.act
                        FROM c)
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN (( SELECT cfg.pool
                        FROM cfg) + 1)
                     ELSE (( SELECT cfg.pp
                        FROM cfg) + 1)
                 END) search_matches(act, thread, board, title, "character", created_at, words)
         ), cnt AS MATERIALIZED (
          SELECT count(*) AS n
            FROM search_matches(search_posts.q, ( SELECT au.id
                    FROM au), search_posts.board, search_posts.from_at, search_posts.to_at, COALESCE(search_posts.titles_only, false), true, NULL::timestamp with time zone, NULL::uuid, 1001) search_matches(act, thread, board, title, "character", created_at, words)
         ), ranked AS MATERIALIZED (
          SELECT x.act,
             x.thread,
             x.board,
             x.title,
             x."character",
             x.created_at,
             x.words,
             x.rn,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN (ts_rank_cd(x.words, ( SELECT tsq.t
                        FROM tsq), 1))::double precision
                     ELSE (0)::double precision
                 END AS rank
            FROM ( SELECT m.act,
                     m.thread,
                     m.board,
                     m.title,
                     m."character",
                     m.created_at,
                     m.words,
                     row_number() OVER (ORDER BY m.created_at DESC, m.act DESC) AS rn
                    FROM m) x
           WHERE ((( SELECT cfg.s
                    FROM cfg) <> 'relevance'::text) OR (x.rn <= ( SELECT cfg.pool
                    FROM cfg)))
         ), page AS MATERIALIZED (
          SELECT r.act,
             r.thread,
             r.board,
             r.title,
             r."character",
             r.created_at,
             r.words,
             r.rn,
             r.rank,
             row_number() OVER (ORDER BY r.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END DESC) AS n
            FROM ranked r,
             cfg
           WHERE ((cfg.s <> 'relevance'::text) OR (NOT (EXISTS ( SELECT 1
                    FROM c))) OR (ROW(r.rank, r.created_at, r.act) < ROW(( SELECT c.rank
                    FROM c), ( SELECT c.at
                    FROM c), ( SELECT c.act
                    FROM c))))
           ORDER BY (row_number() OVER (ORDER BY r.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN r.act
                     ELSE NULL::uuid
                 END DESC))
          LIMIT (( SELECT cfg_1.pp
                    FROM cfg cfg_1) + 1)
         ), shown AS MATERIALIZED (
          SELECT p.act,
             p.thread,
             p.board,
             p.title,
             p."character",
             p.created_at,
             p.words,
             p.rn,
             p.rank,
             p.n
            FROM page p
           WHERE (p.n <= ( SELECT cfg.pp
                    FROM cfg))
         ), people AS MATERIALIZED (
          SELECT cp.id,
             cp.name
            FROM characters_public cp
           WHERE (cp.id IN ( SELECT s."character"
                    FROM shown s))
         ), places AS MATERIALIZED (
          SELECT b.id,
             b.slug,
             b.name
            FROM boards_now b
           WHERE (b.id IN ( SELECT s.board
                    FROM shown s))
         )
  SELECT jsonb_build_object('count', ( SELECT cnt.n
            FROM cnt), 'more', (( SELECT cnt.n
            FROM cnt) > 1000), 'pooled', ((( SELECT cfg.s
            FROM cfg) = 'relevance'::text) AND (( SELECT count(*) AS count
            FROM m) > ( SELECT cfg.pool
            FROM cfg))), 'results', COALESCE(( SELECT jsonb_agg(jsonb_build_object('act', s.act, 'thread', s.thread, 'title', s.title, 'board', s.board, 'board_slug', pl.slug, 'board_name', pl.name, 'seq', a.seq, 'page', (GREATEST((1)::numeric, ceil(((a.seq)::numeric / (( SELECT cfg.thread_pp
                    FROM cfg))::numeric))))::integer, 'character', s."character", 'name', pe.name, 'created_at', s.created_at, 'snippet',
                 CASE
                     WHEN (( SELECT tsq.t
                        FROM tsq) IS NULL) THEN "left"(regexp_replace(bbcode_plain((a.current_payload ->> 'body'::text), act_forged(a.current_payload)), '\s+'::text, ' '::text, 'g'::text), 200)
                     ELSE ts_headline(search_lang(), bbcode_plain((a.current_payload ->> 'body'::text), act_forged(a.current_payload)), ( SELECT tsq.t
                        FROM tsq), 'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=30,MinWords=12'::text)
                 END, 'cards', search_post_cards(s.act)) ORDER BY s.n) AS jsonb_agg
            FROM (((shown s
              JOIN acts_public a ON ((a.id = s.act)))
              LEFT JOIN people pe ON ((pe.id = s."character")))
              LEFT JOIN places pl ON ((pl.id = s.board)))), '[]'::jsonb), 'next', ( SELECT jsonb_build_object('rank', p.rank, 'at', p.created_at, 'act', p.act) AS jsonb_build_object
            FROM page p
           WHERE ((p.n = ( SELECT cfg.pp
                    FROM cfg)) AND (EXISTS ( SELECT 1
                    FROM page x
                   WHERE (x.n = (( SELECT cfg.pp
                            FROM cfg) + 1))))))) AS jsonb_build_object
  );
end
$function$;

-- search_threads (0368)
create or replace function public.search_threads(q text, author uuid, board uuid, from_at timestamp with time zone, to_at timestamp with time zone, titles_only boolean, sort text, after jsonb, per_page integer)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  perform
         CASE
             WHEN (char_length(COALESCE(q, ''::text)) > 200) THEN screen_refusal('a search is at most 200 characters'::text)
             WHEN ((sort IS NOT NULL) AND (sort <> ALL (ARRAY['relevance'::text, 'newest'::text, 'oldest'::text]))) THEN screen_refusal('sort is relevance, newest or oldest'::text)
             WHEN ((COALESCE(per_page, 20) < 1) OR (COALESCE(per_page, 20) > 50)) THEN screen_refusal('a page holds 1 to 50 results'::text)
             WHEN (from_at >= to_at) THEN screen_refusal('the range ends before it begins'::text)
             WHEN ((after IS NOT NULL) AND (NOT search_cursor_ok(after, ((COALESCE(sort, 'relevance'::text) = 'relevance'::text) AND (btrim(COALESCE(q, ''::text)) <> ''::text))))) THEN screen_refusal('that is not a cursor this search gave'::text)
             ELSE NULL::integer
         END AS "case";
  return (
  WITH k AS MATERIALIZED (
          SELECT (btrim(COALESCE(q, ''::text)) <> ''::text) AS has_q
         ), cfg AS MATERIALIZED (
          SELECT COALESCE(search_threads.per_page, 20) AS pp,
             COALESCE(( SELECT ((x.settings ->> 'searchRankPool'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 5000) AS pool,
             COALESCE(( SELECT ((x.settings ->> 'postsPerPage'::text))::integer AS int4
                    FROM screen_settings x
                  LIMIT 1), 20) AS thread_pp,
                 CASE
                     WHEN (COALESCE(search_threads.sort, 'relevance'::text) = 'relevance'::text) THEN
                     CASE
                         WHEN k.has_q THEN 'relevance'::text
                         ELSE 'newest'::text
                     END
                     ELSE search_threads.sort
                 END AS s
            FROM k
         ), tsq AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN ( SELECT k.has_q
                        FROM k) THEN websearch_to_tsquery(search_lang(), q)
                     ELSE NULL::tsquery
                 END AS t
         ), au AS MATERIALIZED (
          SELECT
                 CASE
                     WHEN (author IS NULL) THEN NULL::uuid
                     WHEN (EXISTS ( SELECT 1
                        FROM characters_public c
                       WHERE (c.id = search_threads.author))) THEN author
                     ELSE '00000000-0000-0000-0000-000000000000'::uuid
                 END AS id
         ), c AS MATERIALIZED (
          SELECT ((after ->> 'rank'::text))::double precision AS rank,
             ((after ->> 'at'::text))::timestamp with time zone AS at,
             ((after ->> 'act'::text))::uuid AS act
           WHERE (after IS NOT NULL)
         ), m AS MATERIALIZED (
          SELECT search_matches.act,
             search_matches.thread,
             search_matches.board,
             search_matches.title,
             search_matches."character",
             search_matches.created_at,
             search_matches.words
            FROM search_matches(search_threads.q, ( SELECT au.id
                    FROM au), search_threads.board, search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false), true, NULL::timestamp with time zone, NULL::uuid,
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN (( SELECT cfg.pool
                        FROM cfg) + 1)
                     ELSE 0
                 END) search_matches(act, thread, board, title, "character", created_at, words)
         ), ranked AS MATERIALIZED (
          SELECT x.act,
             x.thread,
             x.board,
             x.title,
             x."character",
             x.created_at,
             x.words,
             x.rn,
             (ts_rank_cd(x.words, ( SELECT tsq.t
                    FROM tsq), 1))::double precision AS rank
            FROM ( SELECT m.act,
                     m.thread,
                     m.board,
                     m.title,
                     m."character",
                     m.created_at,
                     m.words,
                     row_number() OVER (ORDER BY m.created_at DESC, m.act DESC) AS rn
                    FROM m) x
           WHERE (x.rn <= ( SELECT cfg.pool
                    FROM cfg))
         ), best AS MATERIALIZED (
          SELECT DISTINCT ON (r.thread) r.act,
             r.thread,
             r.board,
             r.title,
             r."character",
             r.created_at,
             r.rank
            FROM ranked r
           ORDER BY r.thread, r.rank DESC, r.created_at DESC, r.act DESC
         ), walk AS MATERIALIZED (
          SELECT search_walk.act,
             search_walk.thread,
             search_walk.board,
             search_walk.title,
             search_walk."character",
             search_walk.created_at,
             search_walk.stop
            FROM search_walk(search_threads.q, ( SELECT au.id
                    FROM au), search_threads.board, search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false), ( SELECT (cfg.s <> 'oldest'::text)
                    FROM cfg), ( SELECT c.at
                    FROM c), ( SELECT c.act
                    FROM c),
                 CASE
                     WHEN (( SELECT cfg.s
                        FROM cfg) = 'relevance'::text) THEN 0
                     ELSE (( SELECT cfg.pp
                        FROM cfg) + 1)
                 END, ( SELECT cfg.pool
                    FROM cfg)) search_walk(act, thread, board, title, "character", created_at, stop)
         ), walked AS MATERIALIZED (
          SELECT w.act,
             w.thread,
             w.board,
             w.title,
             w."character",
             w.created_at,
             (0)::double precision AS rank
            FROM walk w
           WHERE (NOT w.stop)
         ), cnt AS MATERIALIZED (
          SELECT count(*) FILTER (WHERE (NOT w.stop)) AS n,
             COALESCE(bool_or(w.stop), false) AS cut
            FROM search_walk(search_threads.q, ( SELECT au.id
                    FROM au), search_threads.board, search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false), true, NULL::timestamp with time zone, NULL::uuid, 1001, ( SELECT cfg.pool
                    FROM cfg)) w(act, thread, board, title, "character", created_at, stop)
         ), found AS MATERIALIZED (
          SELECT best.act,
             best.thread,
             best.board,
             best.title,
             best."character",
             best.created_at,
             best.rank
            FROM best
         UNION ALL
          SELECT walked.act,
             walked.thread,
             walked.board,
             walked.title,
             walked."character",
             walked.created_at,
             walked.rank
            FROM walked
         ), page AS MATERIALIZED (
          SELECT b.act,
             b.thread,
             b.board,
             b.title,
             b."character",
             b.created_at,
             b.rank,
             row_number() OVER (ORDER BY b.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END DESC) AS n
            FROM found b,
             cfg
           WHERE ((cfg.s <> 'relevance'::text) OR (NOT (EXISTS ( SELECT 1
                    FROM c))) OR (ROW(b.rank, b.created_at, b.act) < ROW(( SELECT c.rank
                    FROM c), ( SELECT c.at
                    FROM c), ( SELECT c.act
                    FROM c))))
           ORDER BY (row_number() OVER (ORDER BY b.rank DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.created_at
                     ELSE NULL::timestamp with time zone
                 END DESC,
                 CASE
                     WHEN (cfg.s = 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END,
                 CASE
                     WHEN (cfg.s <> 'oldest'::text) THEN b.act
                     ELSE NULL::uuid
                 END DESC))
          LIMIT (( SELECT cfg_1.pp
                    FROM cfg cfg_1) + 1)
         ), shown AS MATERIALIZED (
          SELECT p.act,
             p.thread,
             p.board,
             p.title,
             p."character",
             p.created_at,
             p.rank,
             p.n
            FROM page p
           WHERE (p.n <= ( SELECT cfg.pp
                    FROM cfg))
         ), people AS MATERIALIZED (
          SELECT cp.id,
             cp.name
            FROM characters_public cp
           WHERE (cp.id IN ( SELECT s."character"
                    FROM shown s))
         ), places AS MATERIALIZED (
          SELECT b.id,
             b.slug,
             b.name
            FROM boards_now b
           WHERE (b.id IN ( SELECT s.board
                    FROM shown s))
         )
  SELECT jsonb_build_object('count', ( SELECT cnt.n
            FROM cnt), 'more', ((( SELECT cnt.n
            FROM cnt) > 1000) OR ( SELECT cnt.cut
            FROM cnt)), 'pooled', ((( SELECT cfg.s
            FROM cfg) = 'relevance'::text) AND (( SELECT count(*) AS count
            FROM m) > ( SELECT cfg.pool
            FROM cfg))), 'results', COALESCE(( SELECT jsonb_agg(jsonb_build_object('thread', s.thread, 'title', s.title, 'board', s.board, 'board_slug', pl.slug, 'board_name', pl.name, 'act', s.act, 'seq', a.seq, 'page', (GREATEST((1)::numeric, ceil(((a.seq)::numeric / (( SELECT cfg.thread_pp
                    FROM cfg))::numeric))))::integer, 'character', s."character", 'name', pe.name, 'created_at', s.created_at, 'snippet',
                 CASE
                     WHEN (( SELECT tsq.t
                        FROM tsq) IS NULL) THEN "left"(regexp_replace(bbcode_plain((a.current_payload ->> 'body'::text), act_forged(a.current_payload)), '\s+'::text, ' '::text, 'g'::text), 200)
                     ELSE ts_headline(search_lang(), bbcode_plain((a.current_payload ->> 'body'::text), act_forged(a.current_payload)), ( SELECT tsq.t
                        FROM tsq), 'StartSel=<<,StopSel=>>,MaxFragments=1,MaxWords=30,MinWords=12'::text)
                 END, 'matches', LEAST(h.n, (100)::bigint), 'matches_more', (h.n > 100)) ORDER BY s.n) AS jsonb_agg
            FROM ((((shown s
              JOIN acts_public a ON ((a.id = s.act)))
              LEFT JOIN people pe ON ((pe.id = s."character")))
              LEFT JOIN places pl ON ((pl.id = s.board)))
              CROSS JOIN LATERAL ( SELECT search_thread_matches(s.thread, ( SELECT tsq.t
                            FROM tsq), ( SELECT au.id
                            FROM au), search_threads.from_at, search_threads.to_at, COALESCE(search_threads.titles_only, false)) AS n) h)), '[]'::jsonb), 'next', COALESCE(( SELECT jsonb_build_object('rank', p.rank, 'at', p.created_at, 'act', p.act) AS jsonb_build_object
            FROM page p
           WHERE ((p.n = ( SELECT cfg.pp
                    FROM cfg)) AND (EXISTS ( SELECT 1
                    FROM page x
                   WHERE (x.n = (( SELECT cfg.pp
                            FROM cfg) + 1)))))), ( SELECT jsonb_build_object('rank', 0, 'at', w.created_at, 'act', w.act) AS jsonb_build_object
            FROM walk w
           WHERE w.stop))) AS jsonb_build_object
  );
end
$function$;

-- rule_breaks (0340)
create or replace function rule_breaks(post_act uuid, only_move uuid default null) returns setof rules_now
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p record;
  prev record;
  r rules_now%rowtype;
  body text;
  broken boolean;
begin
  select a.character, a.thread, a.seq, a.created_at, a.payload ->> 'body' as body, act_forged(a.payload) as forged, t.board, t.title into p
  from acts a join threads t on t.id = a.thread where a.id = post_act and a.kind in ('post', 'spin') and not coalesce(version_hidden(a.id), false);
  if not found then return; end if;
  -- Only a body that names a quote is walked; one that does not has nothing to cut.
  body := coalesce(case when p.body ilike '%[quote%' then (select w.unquoted from bbcode_walk(p.body, null, p.forged) w) else p.body end, '');
  -- The post before this one in the thread: the unique (thread, seq) index walked back. A thread's opener has none.
  select x.character, x.created_at into prev from acts x
  where x.thread = p.thread and x.seq < p.seq and x.kind in ('post', 'spin') order by x.seq desc limit 1;
  for r in select * from rules_now x where (x.board is null or x.board = p.board) and (only_move is null or x.move_act = only_move) order by x.board nulls first, x.number loop
    broken := case r.predicate
      when 'minLength' then char_length(body) < (r.param #>> '{}')::integer
      when 'maxLength' then char_length(body) > (r.param #>> '{}')::integer
      when 'noAllCaps' then (
        select w.letters > 0 and w.uppers * 2 > w.letters
        from (select length(regexp_replace(q.s, '[^[:alpha:]]', '', 'g')) as letters, length(regexp_replace(q.s, '[^[:upper:]]', '', 'g')) as uppers
              from (select regexp_replace(body, '\[/?[a-zA-Z*]+(=[^\]]*)?\]', '', 'g') as s) q) w)
      when 'noDoublePost' then prev.character is not null and prev.character = p.character
      when 'noNecropost' then prev.created_at is not null and p.created_at - prev.created_at > make_interval(days => (r.param #>> '{}')::integer)
      when 'noDuplicateTitle' then p.seq = 1 and exists (
        select 1 from threads o where o.board = p.board and o.id <> p.thread and lower(btrim(o.title)) = lower(btrim(p.title)))
      when 'bannedWord' then body ~* ('(^|[^[:alnum:]_])' || regex_escape(r.param #>> '{}') || '([^[:alnum:]_]|$)')
      when 'requiredWord' then body !~* ('(^|[^[:alnum:]_])' || regex_escape(r.param #>> '{}') || '([^[:alnum:]_]|$)')
      when 'noTag' then body ~* ('\[' || regex_escape(r.param #>> '{}') || '([=\] ]|$)')
      when 'repliesOnly' then p.seq = 1
      else null end;
    if broken is null then raise exception 'no check for predicate %', r.predicate using errcode = '0A000'; end if;
    if broken then return next r; end if;
  end loop;
end $$;

-- own_words (0340): the body of a version and that version's verdict. The one-argument function is dropped for the same reason as bbcode_plain's.
drop function own_words(text);
create function own_words(raw text, forged uuid[] default '{}') returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(case when raw ilike '%[quote%' then (select w.unquoted from bbcode_walk(raw, null, forged) w) else raw end, '')
$$;
revoke execute on function own_words(text, uuid[]) from public, anon, authenticated;

-- claim_card_writes (0375): the `before` read takes the payload of the version it reads the body of, so the verdict is that version's.
CREATE OR REPLACE FUNCTION public.claim_card_writes(most integer, only_post uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  nearby integer := coalesce((((select s.value from settings s where s.key = 'pool') ->> 'chatterThreadPosts'))::integer, 8);
  claimed jsonb;
begin
  delete from card_writes w where w.play in (
    select x.play from card_writes x where card_ended(x.play) and (claim_card_writes.only_post is null or x.post = claim_card_writes.only_post) for update skip locked);
  with picked as materialized (
    select c.play from card_writes c join acts a on a.id = c.play
    where (c.claimed_until is null or c.claimed_until < clock_timestamp()) and c.not_before <= clock_timestamp() and not card_ended(c.play)
      and (claim_card_writes.only_post is null or c.post = claim_card_writes.only_post)
      and not exists (select 1 from card_writes e join acts ea on ea.id = e.play
                      where e.post = c.post and e.play <> c.play and not card_ended(e.play) and (ea.created_at, ea.id) < (a.created_at, a.id))
    order by c.queued_at, c.play limit greatest(claim_card_writes.most, 0) for update of c skip locked
  ), taken as (
    update card_writes w set claimed_until = clock_timestamp() + interval '5 minutes', attempts = w.attempts + 1, version = post_version(w.post)
    from picked where w.play = picked.play
    returning w.play, w.post, w.version, w.attempts, w.queued_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'play', t.play, 'version', t.version, 'post', t.post, 'thread', pa.thread, 'attempts', t.attempts,
      'card', pl.payload ->> 'card', 'config', coalesce(pl.payload -> 'config', '{}'::jsonb), 'tokens', (pl.payload ->> 'tokens')::integer,
      'author', ch.name, 'body', own_words(case when version_hidden(v.id, pa.id) then null else v.payload ->> 'body' end, act_forged(v.payload)), 'title', th.title,
      'before', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'body', x.body) order by x.seq), '[]'::jsonb)
                 from (select n.seq, cn.name,
                              own_words(cur.payload ->> 'body', act_forged(cur.payload)) as body
                       from acts_public n join acts na on na.id = n.id join characters_public cn on cn.id = n.character
                       cross join lateral (select case when n.hidden then null else coalesce((select e.payload from acts e where e.kind = 'edit' and e.target_act_id = n.id order by e.created_at desc, e.id desc limit 1), na.payload) end as payload) cur
                       where n.thread = pa.thread and post_kind(n.kind) and n.seq < pa.seq
                       order by n.seq desc limit greatest(nearby, 0)) x),
      'earlier', (select coalesce(jsonb_agg(jsonb_build_object('play', q.id, 'text', q.text) order by q.created_at, q.id), '[]'::jsonb)
                  from (select ea.id, ea.created_at,
                          coalesce((select x.text from card_texts x where x.play = ea.id and x.version = t.version and x.text is not null),
                                   (select x.text from card_texts x where x.play = ea.id and x.text is not null order by x.created_at desc, x.id desc limit 1)) as text
                        from live_writing_plays(t.post) lp join acts ea on ea.id = lp
                        where (ea.created_at, ea.id) < (pl.created_at, pl.id)) q
                  where q.text is not null)
    ) order by t.queued_at, t.play), '[]'::jsonb) into claimed
  from taken t
  join acts pl on pl.id = t.play
  join acts pa on pa.id = t.post
  join characters ch on ch.id = shown_author(pa.id, pa.character)
  join threads th on th.id = pa.thread
  join acts v on v.id = t.version;
  return claimed;
end $function$;

-- place_set (0374)
create or replace function public.place_set(setter uuid, card text, target uuid, config jsonb, payer uuid, price integer, catches text DEFAULT NULL::text, phrase text DEFAULT NULL::text, passage text DEFAULT NULL::text, named uuid[] DEFAULT NULL::uuid[], who_except boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  kind_of card_kinds%rowtype;
  caught_kind card_kinds%rowtype;
  target_kind text;
  author uuid;
  in_thread uuid;
  written uuid;
  rounds integer;
  staff_setter boolean;
  body text;
  body_forged uuid[];
  off_board integer;
  nq_name text;
  nq_ends timestamptz;
begin
  select c.staff is not null into staff_setter from characters c where c.id = setter;
  if staff_setter is null then raise exception 'there is no such character' using errcode = 'P0002'; end if;
  if staff_setter is distinct from (payer is null) then
    raise exception 'a staff character''s card is paid by no one, and a player''s by its player' using errcode = '22023';
  end if;
  if payer is null and coalesce(price, 0) <> 0 then raise exception 'a staff character''s card costs nothing' using errcode = '22023'; end if;
  if octet_length(coalesce(config, '{}')::text) > 4096 then raise exception 'a card''s configuration is at most 4 KB' using hint = 'kayfabb.refusal', errcode = '22001'; end if;
  select * into kind_of from card_kinds k where k.key = place_set.card;
  if kind_of.key is null then raise exception 'there is no such card' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if kind_of.play is distinct from 'cast' and kind_of.play is distinct from 'set' then
    raise exception '% is %', kind_of.name, case kind_of.play when 'use' then 'used on your own post' else 'kept in the hand' end using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A set card with no trap could never spring, and its setter would not know (decideSet's words). It is refused at seed time too; this is for a row that held one before.
  if kind_of.play = 'set' and kind_of.trap is null then
    raise exception '% has no trap to spring', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A Reversal that waits for a cast waits for a named card or for a match; one set with neither could catch nothing, and its setter would not know. Naming and matching are one or the other.
  if catches is null and kind_of.play = 'set' and kind_of.trap #>> '{trigger,on}' = 'cast' and jsonb_typeof(kind_of.trap -> 'match') is distinct from 'object' then
    raise exception '% names no card to catch', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if catches is not null and jsonb_typeof(kind_of.trap -> 'match') = 'object' then
    raise exception '% names a card or matches cards, never both', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A ride is read in a quadrant, which the setter names when setting it.
  if kind_of.play = 'set' and jsonb_typeof(kind_of.trap -> 'outcome') = 'object'
     and not coalesce(coalesce(config, '{}') ->> 'quadrant' = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']), false) then
    raise exception 'this card names a reaction quadrant' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A match reaches only cards at or below its own rarity, and so does a name (decideSet's words).
  if jsonb_typeof(kind_of.trap -> 'match') = 'object' and kind_of.trap #>> '{match,upTo}' is not null
     and rarity_rank(kind_of.trap #>> '{match,upTo}') > rarity_rank(kind_of.rarity) then
    raise exception '% names cards up to %', kind_of.name, kind_of.rarity using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if catches is not null then
    if kind_of.play is distinct from 'set' or kind_of.trap #>> '{trigger,on}' is distinct from 'cast' then
      raise exception '% catches no card', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    select * into caught_kind from card_kinds k where k.key = place_set.catches;
    if caught_kind.key is null or caught_kind.play is distinct from 'cast' or not ('post' = any (caught_kind.reaches)) then
      raise exception '% names a card that is cast on a post', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if rarity_rank(caught_kind.rarity) > rarity_rank(kind_of.rarity) then
      raise exception '% names cards up to %', kind_of.name, kind_of.rarity using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
  end if;
  if phrase is not null then
    if kind_of.play is distinct from 'cast' then raise exception '% waits for no phrase', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if btrim(phrase) = '' then raise exception '% needs a phrase to wait for', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- The engine's bound (SET_PHRASE_MOST, engine/rules/cards.ts, which decideSet holds in the same words): phrase_pattern is one length for every back only up to it.
    if char_length(phrase) > 100 then raise exception '% waits for a phrase of at most 100 characters', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  -- The conditions of a Move (design sections 3 and 4). A Gimmick takes none.
  if passage is not null or named is not null or who_except is not null then
    if kind_of.play is distinct from 'cast' then raise exception '% takes no conditions', kind_of.name using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  if passage is not null then
    if btrim(passage) = '' or phrase_norm(passage) = '' then raise exception 'the passage needs a letter or a digit' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if char_length(passage) > 100 then raise exception 'the passage is at most 100 characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  if (named is null) is distinct from (who_except is null) then
    raise exception 'a list of characters comes with Only these or Anyone but these' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if named is not null then
    if cardinality(named) not between 1 and 5 then raise exception 'a list names one to five characters' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- The same message for an id that is missing and one that has not debuted: what is read is the debut alone, as suggest_characters reads `characters`, never the owner.
    select min(i) into off_board from generate_subscripts(named, 1) i
    where named[i] is null or not exists (select 1 from characters c where c.id = named[i] and c.debuted_at is not null);
    if off_board is not null then raise exception '% is not a character on the board', off_board using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    if (select count(distinct x) from unnest(named) x) <> cardinality(named) then raise exception 'a character is named once in a list' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  select a.kind, a.character, a.thread into target_kind, author, in_thread from acts a where a.id = target for no key update;
  if not coalesce(post_kind(target_kind), false) then raise exception 'a card is set face down on a post' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if author is distinct from setter then raise exception 'a card is set face down on a post of your own character''s' using hint = 'kayfabb.refusal', errcode = '42501'; end if;
  -- The passage must be in the post's current words (its latest edit's body, else its own), read as the probe reads them. The post is public, so the refusal reads nothing private.
  if passage is not null then
    select p.current_payload ->> 'body', act_forged(p.current_payload) into body, body_forged from acts_public p where p.id = target;
    if not phrase_in(bbcode_plain(coalesce(body, ''), body_forged), passage) then raise exception 'that passage is not in this post''s words' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  end if;
  -- Public, since the back is.
  -- A back is live until it springs, is taken back or its time passes; the three are public.
  if exists (select 1 from face_down f where f.post = target and f.ends_at > now()
             and not exists (select 1 from acts s where s.kind = 'spring' and (s.payload ->> 'set') = f.play::text)
             and not exists (select 1 from acts s where s.kind = 'take_back' and (s.payload ->> 'set') = f.play::text)) then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  -- A post that holds a live No quote takes no back until it ends (public: the play is a face-up card on the post). The refusal names the card and its end, the same for every setter.
  select n.name, n.ends into nq_name, nq_ends from no_quote_on(target) n order by n.ends desc limit 1;
  if nq_name is not null then
    raise exception 'this post''s % stops quotes until %, so no card is set face down here until then', nq_name, refusal_time(nq_ends) using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  select count(*) into rounds from face_down f where f.post = target;
  insert into acts (character, kind, thread, target_act_id, payload) values (setter, 'set', in_thread, target, '{}') returning id into written;
  begin
    insert into face_down (play, account, card, config, post, thread, round, ends_at, catches, phrase, passage, who, who_except)
    values (written, payer, card, coalesce(config, '{}'), target, in_thread, rounds + 1, now() + span_interval(setting('setLasts')), place_set.catches, place_set.phrase,
            place_set.passage, place_set.named, place_set.who_except);
  exception when unique_violation then
    raise exception 'this post already holds a card face down' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  return act_projection(written);
end $function$;

-- spring_facts (0374)
create or replace function public.spring_facts(fd face_down, trigger text, by_act uuid, incoming_card text)
 RETURNS spring_facts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  f spring_facts;
  k card_kinds%rowtype;
  named text;
  in_character integer;
  in_thread integer;
  in_board integer;
  walked_plain text;
  raw_body text;
  raw_forged uuid[];
  walked_excerpt text;
  ic card_kinds%rowtype;
  m jsonb;
  ic_rank integer;
  up_rank integer;
  own_rank integer;
  flavor_ok boolean;
  matched boolean;
begin
  -- 1. The setter's character, and what decides whether it can act (retired, not debuted), who it belongs to and whether it is staff.
  select a.character into f.setter_character from acts a where a.id = fd.play;
  select c.retired_at, c.debuted_at, c.owner, c.staff is not null into f.setter_retired, f.setter_debuted, f.setter_owner, f.setter_staff from characters c where c.id = f.setter_character;
  -- 2. The back's card kind.
  select * into k from card_kinds x where x.key = fd.card;
  f.kind_play := k.play; f.kind_trap := k.trap; f.kind_stack := k.stack; f.kind_seeded := k.seeded;
  f.kind_skim := k.skim is not null; f.kind_scores := k.scores_as; f.kind_veil := k.veil;
  f.reach := coalesce(k.reaches[1], 'post');
  -- 3. The Act that met the back: its kind, character, thread, board and words, and the thread's first post and the announcements thread a board card would be written in. For a cast
  -- or a visit by_act is not a post, or not yet written, and these find what they find.
  select a.kind, a.character, a.thread, case when coalesce(version_hidden(a.id), false) then null else a.payload ->> 'body' end, act_forged(a.payload), t.board into f.by_kind, f.by_character, f.by_thread, raw_body, raw_forged, f.by_board
  from acts a left join threads t on t.id = a.thread where a.id = by_act;
  select a.id into f.first_post from acts a where a.thread = f.by_thread and a.seq = 1 and post_kind(a.kind);
  f.announce_thread := setting_thread('systemAnnouncements');
  -- 4. The stack at the would-be target and reach, for every reach: the plays of the card still up on the Act (a post's), the layer to go on from, and the plays of it still up on
  -- the Act's character, thread and board (a play beyond a post's), counted as place_cast counts them. Which reach the card takes is then a choice among values already read.
  f.target := case f.reach when 'post' then by_act when 'character' then f.by_character when 'thread' then f.by_thread else f.by_board end;
  -- Each play found is asked whether an admin ended it, whatever card it is (card_ended is a read of its own, and the subquery cannot be flattened away, so it is made for every play found and not only
  -- for the ones of this back's card): which card is counted is chosen after the reads.
  select count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended),
         greatest(coalesce(max(l.layer) filter (where l.card is not distinct from fd.card), 0), count(*) filter (where l.card is not distinct from fd.card)) + 1,
         count(*) filter (where l.card is not distinct from fd.card and (l.ends is null or l.ends > now()) and not l.ended and l.quadrant is not distinct from (fd.config ->> 'quadrant'))
    into f.up, f.layer, f.quadrant_up
  from (select k2.payload ->> 'card' as card, (k2.payload ->> 'ends')::timestamptz as ends, (k2.payload ->> 'layer')::integer as layer, card_ended(k2.id) as ended,
               k2.payload #>> '{config,quadrant}' as quadrant
        from acts k2 where k2.kind = 'card' and k2.target_act_id = by_act and not (k2.payload ? 'caught') and coalesce(k2.payload ->> 'reach', 'post') = 'post' offset 0) l;
  f.quadrant_ok := (fd.config ->> 'quadrant') = any (array['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative']);
  -- The window a scored-as play would name, and whether the quoting character already has a class named for it: a play of any scored-as card made at or after the last settled window's end, not ended.
  select w.opens, w.closes, w.why into f.window_opens, f.window_closes, f.window_why from scored_as_window(now()) w;
  f.class_ok := exists (select 1 from class_kinds ck where ck.key = fd.config ->> 'class');
  select count(*) filter (where l.card = fd.card and not l.ended and l.character = f.by_character), count(*) filter (where l.card = fd.card and not l.ended and l.thread = f.by_thread),
         count(*) filter (where l.card = fd.card and not l.ended and l.board = f.by_board),
         count(*) filter (where l.scores and not l.ended and l.character = f.by_character and l.at >= (select max(x.ends_at) from settlements x)) > 0
    into in_character, in_thread, in_board, f.class_taken
  from (select k2.payload ->> 'card' as card, r.character, r.thread, r.board, card_ended(r.play) as ended, k2.created_at as at, coalesce(ck.scores_as, false) as scores
        from play_reach r join acts k2 on k2.id = r.play left join card_kinds ck on ck.key = k2.payload ->> 'card'
        where r.ends_at > now() and (r.character = f.by_character or r.thread = f.by_thread or r.board = f.by_board) offset 0) l;
  f.reach_up := case f.reach when 'character' then in_character when 'thread' then in_thread else in_board end;
  -- 4b. Whether a live ward Gimmick on the Act turns the card away: place_cast turns a cast away by the same test (ward_refusal), and a Move does not land through it either.
  f.warded := ward_refusal('post', by_act, k) is not null;
  -- 4c. What the card's landing refuses on the Act (land_refusal): the same reads, from public facts, for every back whatever it holds. A Move that is refused here does not land and its back stays set.
  f.land_why := land_refusal(k, by_act, fd.config);
  -- 5. A board's live card, whatever the card's reach.
  select max(r.ends_at) into f.live_board from play_reach r where r.board = f.by_board and r.ends_at > now() and not card_ended(r.play);
  -- 6. The named catch (a back with none reads its own card's row, so the read finds one row either way: a null key would be a read of nothing), compared with the incoming card.
  select x.key into named from card_kinds x where x.key = coalesce(fd.catches, fd.card);
  -- 6b. The back's match, and the incoming card's printed row, for every back whatever it holds (a back with no match reads the same row and asks the same questions of an empty one): the card's
  -- flavor in the match's `flavors`, its rarity at or below the match's `upTo` and at or below the back's own card's. A cast back springs on the card it names or on one its match holds.
  select * into ic from card_kinds x where x.key = incoming_card;
  m := case when jsonb_typeof(k.trap -> 'match') = 'object' then k.trap -> 'match' else '{}'::jsonb end;
  ic_rank := rarity_rank(ic.rarity); up_rank := rarity_rank(coalesce(m ->> 'upTo', 'legendary')); own_rank := rarity_rank(k.rarity);
  flavor_ok := case when jsonb_typeof(m -> 'flavors') = 'array' then (m -> 'flavors') ? ic.alignment else true end;
  matched := jsonb_typeof(k.trap -> 'match') = 'object' and ic.key is not null and flavor_ok and ic_rank <= up_rank and ic_rank <= own_rank;
  f.caught := (fd.catches is not null and fd.catches = incoming_card and named is not null) or coalesce(matched, false);
  -- 7. ONE walk of the Act's words for every back: its own visible words, and the excerpt of the quotes of the back's post (null for a cast or a visit, whose by_act holds no words). A function in a FROM
  -- clause runs once however many columns are taken from it, and both are taken here, so the walk costs the same whatever the back holds.
  select w.plain, w.excerpt, w.unquoted into walked_plain, walked_excerpt, f.by_body from bbcode_walk(raw_body, fd.post, raw_forged) w;
  -- A quote of a post an admin hid carries its words, so the Quotes condition does not read them (the Act's own words, with every quote cut out, are all `by_body` and Says read).
  if coalesce(quote_hidden(fd.post), false) then walked_excerpt := ''; end if;
  if raw_body is null then f.by_body := null; end if;
  -- 8. Both probes, for every back, whatever it holds: phrase_probe folds the text and compiles and runs a pattern of one shape (a back with no such condition has a pattern built around its own id, which
  -- cannot match), the Says over the Act's own words and the Quotes, on a token of its own, over the excerpt. And the Who check, against an empty list for Anyone.
  f.phrase_hit := coalesce(phrase_probe(walked_plain, fd.phrase, fd.play::text), false);
  f.passage_hit := coalesce(phrase_probe(walked_excerpt, fd.passage, fd.play::text || 'p'), false);
  f.who_hit := coalesce(f.by_character = any (coalesce(fd.who, '{}')), false);
  return f;
end $function$;

-- ===================================================================================== 3. the verdict: sources, the trigger and quote_check ====
-- (docs/plans/2026-11-20-forged-quotes-plan.md, Task 3; docs/plans/2026-11-20-forged-quotes-design.md, sections 3, 5, 6, 11 and 12.)
-- A post is forged in an Act when some real quote of it in the Act's body has words that do not stand, in order, in one eligible version of it: the post's own Act (a post or a spin) or one of its
-- edits, written at or before the Act, and not hidden by an admin at the Act's writing (version_hidden). The verdict is the sorted list of those posts, written once, by a trigger before the Act is
-- inserted, into its payload's `forged` (replacing whatever the writer sent), and a post whose target is forged is written with no target, so the springs and the `quote` alert that read the target
-- from the row never see it. Nothing ever updates it ("Append-only"), and a hide or an unhide later changes nothing already written.
--
-- quote_sources (act, source, digest): the walked text of every version (bbcode_walk's `source`, with the version's own verdict, and its md5), written by an after-insert trigger the moment the version
-- is, so a check is string searches and never a walk of every version. Insert-only by the repository's append-only trigger pair, enabled always (as quote_refs, 0340), read by no client role: RLS on and
-- no policy, every grant revoked. The export reads it as it reads every table of `public`, and a restore with triggers off keeps the rows it is handed. It is backfilled for the Acts already written:
-- a source is a row of its own and not an Act's content; the verdict is not backfilled (that would be an update of an Act's content), so an Act written before this reads as it always did.
--
-- quote_holds(source, pieces): engine/bbcode/quoted.ts's holds, in PL/pgSQL: every piece in order, each found by strpos at or after the end of the last, empty pieces skipped, no pieces holds.
-- quote_forged(body, at): one walk of the body; for each Act it quotes, its eligible versions newest first, a text seen already (by digest) once; each quote of the Act is judged on its own against any one
--   version (design, section 2), and one that stands in none forges the Act (section 5); no version at all (an id that is no Act, an Act with no text body, every version hidden or written after `at`) is forged. Security definer, no client grant.
-- quote_check(body): within postMaxLength, then quote_forged(body, now()): the composer's preview asks it of a draft. It reads only public facts (versions that are not hidden now, which the History shows
--   everyone), nothing about the caller or who owns anything, so a guess at a hidden post's words comes back forged for its author and for anyone alike.
-- Security: invoker, no table is read in quote_holds; the others pin search_path ending in pg_temp.

create table quote_sources (
  act uuid primary key references acts (id),
  source text not null,
  digest text not null
);
alter table quote_sources enable row level security;
revoke all on quote_sources from public, anon, authenticated;

create function quote_sources_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a quote source is never edited or removed (%); an Act''s words do not change', tg_op using errcode = 'P0001';
end $$;
create trigger quote_sources_no_update before update or delete on quote_sources for each row execute function quote_sources_append_only();
create trigger quote_sources_no_truncate before truncate on quote_sources for each statement execute function quote_sources_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table quote_sources enable always trigger quote_sources_no_update;
alter table quote_sources enable always trigger quote_sources_no_truncate;
revoke execute on function quote_sources_append_only() from public, anon, authenticated;

-- Backfill: a source for each version already written (no verdict: act_forged of an old payload is empty).
insert into quote_sources (act, source, digest)
select a.id, w.source, md5(w.source)
from acts a, lateral bbcode_walk(a.payload ->> 'body', null, act_forged(a.payload)) w
where a.kind in ('post', 'spin', 'edit') and jsonb_typeof(a.payload -> 'body') = 'string'
on conflict do nothing;

create function acts_quote_sources() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare s text;
begin
  select w.source into s from bbcode_walk(new.payload ->> 'body', null, act_forged(new.payload)) w;
  insert into quote_sources (act, source, digest) values (new.id, s, md5(s)) on conflict do nothing;
  return null;
end $$;
revoke execute on function acts_quote_sources() from public, anon, authenticated;
create trigger acts_quote_sources after insert on acts for each row
  when (new.kind in ('post', 'spin', 'edit') and jsonb_typeof(new.payload -> 'body') = 'string') execute function acts_quote_sources();

create function quote_holds(source text, pieces jsonb) returns boolean
language plpgsql immutable parallel safe set search_path = public, pg_temp as $$
declare
  p text;
  from_at integer := 1;
  found_at integer;
begin
  for p in select jsonb_array_elements_text(pieces) loop
    continue when p = '';
    found_at := case when from_at = 1 then strpos(source, p) else strpos(substr(source, from_at), p) end;
    if found_at = 0 then return false; end if;
    from_at := from_at + found_at - 1 + char_length(p);
  end loop;
  return true;
end $$;
revoke execute on function quote_holds(text, jsonb) from public, anon, authenticated;

create function quote_forged(body text, at timestamptz) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  walked jsonb;
  k text;
  quotes jsonb;
  q jsonb;
  forged uuid[] := '{}';
  sources text[];
  seen text[];
  v record;
  held boolean;
  doctored boolean;
  i integer;
begin
  if body is null or body !~* '\[quote=' then return '{}'::uuid[]; end if;
  select w.held into walked from bbcode_walk(body, null) w;
  for k, quotes in select e.key, e.value from jsonb_each(coalesce(walked, '{}'::jsonb)) e loop
    -- The eligible versions' texts, newest first, a text seen already (by digest) once; a hidden version is never read (hidden is asked first, so a hidden copy of a text does not hide a visible one).
    sources := '{}';
    seen := '{}';
    for v in
      select x.id, s.source, s.digest
      from (
        select a.id, a.created_at from acts a where a.id = k::uuid and a.kind in ('post', 'spin') and a.created_at <= at
        union all
        select e.id, e.created_at from acts e where e.kind = 'edit' and e.target_act_id = k::uuid and e.created_at <= at
      ) x
      join quote_sources s on s.act = x.id
      order by x.created_at desc, x.id desc
    loop
      continue when v.digest = any (seen) or version_hidden(v.id, k::uuid);
      seen := seen || v.digest;
      sources := sources || v.source;
    end loop;
    -- Each quote is judged on its own against any one version (design, section 2); one that stands in none forges the post (section 5). No version at all: forged.
    doctored := cardinality(sources) = 0;
    if not doctored then
      for q in select jsonb_array_elements(quotes) loop
        held := false;
        for i in 1..cardinality(sources) loop
          if quote_holds(sources[i], q) then held := true; exit; end if;
        end loop;
        if not held then doctored := true; exit; end if;
      end loop;
    end if;
    if doctored then forged := forged || k::uuid; end if;
  end loop;
  return coalesce((select array_agg(f order by f) from unnest(forged) f), '{}'::uuid[]);
end $$;
revoke execute on function quote_forged(text, timestamptz) from public, anon, authenticated;

create function quote_check(body text) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform within('body', body, 'postMaxLength');
  return quote_forged(body, now());
end $$;
revoke execute on function quote_check(text) from public, anon;
grant execute on function quote_check(text) to authenticated;

-- The verdict. Before the Act is inserted, and (its name sorting before acts_quote_guard's) before No-quote reads the Act: a client's `forged` is dropped whatever it holds, the verdict is written when there is
-- one, and a post whose target is forged is written with no target. An ordinary trigger, not `always`, so a restore with triggers disabled keeps what was written at the save.
create function acts_forged_quotes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  body text := new.payload ->> 'body';
  verdict uuid[] := '{}';
begin
  new.payload := new.payload - 'forged';
  if jsonb_typeof(new.payload -> 'body') = 'string' and body ~* '\[quote=' then
    verdict := quote_forged(body, new.created_at);
  end if;
  if cardinality(verdict) > 0 then
    new.payload := new.payload || jsonb_build_object('forged', to_jsonb(verdict));
    if new.kind = 'post' and new.target_act_id = any (verdict) then new.target_act_id := null; end if;
  end if;
  return new;
end $$;
revoke execute on function acts_forged_quotes() from public, anon, authenticated;
create trigger acts_forged_quotes before insert on acts for each row when (new.kind in ('post', 'spin', 'edit')) execute function acts_forged_quotes();
