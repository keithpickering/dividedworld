-- A real quote past the cap is cut, never text (docs/plans/2026-11-13-quote-cut-plan.md, Task 3; #567). engine/bbcode/parse.ts now reads a real quote nested past MAX_DEPTH as a quote that is not
-- shown (a `cut` node) and still follows it, so every real quote is read at any depth. bbcode_walk, its port in SQL, did not: past its cap of 32 a real quote was text, so the words of a hidden post
-- quoted that deep were in `plain` (search, Says) and `unquoted` (own_words, rule_breaks, spring_facts), and its Act was not in `quotes` (No-quote did not see it).
--
-- What changes, against 0340_conduct.sql's bbcode_walk (same signature, return columns and grants; the diff is a handful of lines):
--   1. max_depth 32 -> 16, parse.ts's MAX_DEPTH. The plan measured that no value is cheaper to parse (a tag past the cap is still a token and a frame, 20,000 characters at caps 8 to 32 differ by
--      less than two runs of one cap); at 16 the innermost quote on a 360px viewport is still 144px wide, at 32 it is 51px.
--   2. A real quote whose home is at the cap opens a frame as any real quote does: a 'sep' frame (never the excerpt's 'keep', since what is not shown is not excerpted), its Act goes into `qs`, and it
--      is dropped from `unquoted` by the same difference array. Inside it a real quote does the same and every other opener is text, as past the cap before. A counterfeit quote and every other tag
--      past the cap stay text. It closes by its closer, an outer closer or the end of input, as a real quote does. Still one pass, linear (supabase/tests/0118-bbcode-plain-scale.sql).
--
-- conceal_request_hidden_quoters(): a layer already stored may hold hidden words quoted past the old cap, so a layer is asked for again for every post that quotes a post hidden from quoting now.
-- It is one set-based insert, never a loop over the hidden posts: the distinct hidden posts are found once (decisions' own index, quote_hidden for each distinct post, not for each quoter), and each
-- one's quoters are an index range of quote_refs (quoted, act), one request per quoting Act. At a busy instance with H hidden posts and Q quoters of them the cost is H probes and Q requests;
-- conceal_due hands the job its limit of them a minute, oldest first, and record_layer writes no new layer where the latest is already for the set of now. The migration calls it once.
-- DEPLOY ORDER: the new `conceal` Edge Function (engine/bbcode/conceal.ts at the new cap) must be deployed BEFORE this migration is applied; the job would otherwise answer these requests by remaking the old layer.
-- Ways out: a post waiting on its layer shows the plain note and the job ends it by itself within a minute (0340). Security: definer, search_path ending in pg_temp, no grant to a client role.
-- Privacy: nothing here reads who owns a character; the requests are internal and no client reads them.

create or replace function bbcode_walk(body text, quoted uuid) returns table(plain text, excerpt text, quotes text[], unquoted text)
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
begin
  if body is null or body = '' then plain := ''; excerpt := ''; quotes := '{}'; unquoted := ''; return next; return; end if;
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
      k := f_kind[sp]; fname := f_name[sp]; fstart := f_start[sp]; ftok := f_tok[sp];
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
          if fname = 'quote' then
            -- its tokens, opener to the last one read (a closer that closed an outer frame to close this one is the outer frame's, so it stays)
            dend := case when unw = 1 and not matched then t - 2 else t - 1 end;
            dd[ftok] := dd[ftok] + 1; dd[dend + 1] := dd[dend + 1] - 1;
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

    -- A real quote whose home is at the cap is cut, not text (parse.ts openCut): a frame like any real quote's, a sep and never the excerpt's keep (what is not shown is not excerpted), so its Act is in
    -- quotes, its words are dropped from plain and from unquoted, and a real quote inside it is a frame the same way. Every other opener past the cap, a counterfeit quote included, is text.
    cut := nm = 'quote' and want in ('sep', 'keep') and f_depth[f_home[sp]] >= max_depth;
    if cut then want := 'sep'; end if;

    if want is null or (f_depth[f_home[sp]] >= max_depth and not cut) then
      -- An opener that is text, kept on the stack so its closer is text too.
      oc := oc + 1; out[oc] := tok;
      sp := sp + 1;
      f_kind[sp] := 'literal'; f_name[sp] := nm; f_start[sp] := 0;
      f_depth[sp] := f_depth[sp - 1]; f_home[sp] := f_home[sp - 1]; f_nodey[sp] := false; f_np[sp] := 0; f_npp[sp] := 0; f_tok[sp] := t;
    else
      -- A list puts a separator before its words, and a bare link its opener (given back as text if it is not a link), so each is the piece before the frame's start.
      if want = 'list' then oc := oc + 1; out[oc] := E'\n'; elsif want = 'bareurl' then oc := oc + 1; out[oc] := tok; end if;
      sp := sp + 1;
      f_kind[sp] := want; f_name[sp] := nm; f_start[sp] := oc;
      f_depth[sp] := f_depth[f_home[sp - 1]] + 1; f_home[sp] := sp; f_nodey[sp] := false; f_np[sp] := 0; f_npp[sp] := 0; f_tok[sp] := t;
      if nm = 'url' then open_urls := open_urls + 1; end if;
      if nm = 'ispoiler' then open_isp := open_isp + 1; end if;
      if want = 'sep' or want = 'keep' then open_sep := open_sep + 1; end if;
      -- A real quote that made a frame (one past max_depth is a cut, and is here): its Act.
      if nm = 'quote' and (want = 'sep' or want = 'keep') then
        qact := bbcode_plain_quote_act(qrest);
        if qact is not null then qc := qc + 1; qs[qc] := qact; end if;
      end if;
    end if;
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
  return next;
  return;
end
$$;

revoke execute on function bbcode_walk(text, uuid) from public, anon;
grant execute on function bbcode_walk(text, uuid) to authenticated, service_role;

create function conceal_request_hidden_quoters() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  -- The posts hidden from quoting now, each once (materialized, so quote_hidden is asked once per post and not once per quoter), then every Act that names one, each once.
  with hidden as materialized (
    select d.post from (select distinct x.post from conduct_decisions x where x.post is not null and x.outcome in ('hide', 'hideUntilEdited', 'unhide', 'approve')) d where quote_hidden(d.post)
  )
  insert into conceal_requests (act) select distinct r.act from hidden h join quote_refs r on r.quoted = h.post;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function conceal_request_hidden_quoters() from public, anon, authenticated;

select conceal_request_hidden_quoters();
