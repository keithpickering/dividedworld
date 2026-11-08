-- Quote conditions (docs/plans/2026-11-08-quote-conditions-plan.md; the design is docs/plans/2026-11-08-quote-conditions-design.md). One migration for the whole plan: this file is written
-- section by section, one task at a time, so more sections follow the ones below; each section opens with a rule line naming its task.
--
-- Section: one looser matcher (Task 1; design section 2).
--
--   phrase_norm(t)          engine/bbcode/phrase.ts's `normalize`, in SQL. (1) A run of characters that are neither a letter or digit (phrase_word_class) nor whitespace, with a letter or digit on each side, is removed:
--                           "don't" is "dont", "e-mail" is "email", "U.S.A." is "USA". (2) Every other run of characters that are not letters or digits becomes one line break if it holds one, else one space.
--                           (3) The ends are trimmed. Whitespace and line breaks are written out as sets (the same two sets engine/bbcode/phrase.ts holds, never the locale's [[:space:]]): so a non-breaking
--                           space, an ideographic space (U+3000) and a line separator read as the engine reads them, and CJK or Arabic punctuation is punctuation. Four regexp_replace passes over the word class: the removal, the runs with a line break, the other runs, and the trim.
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
        '(?=(?:(?!' || w.c || ')[^\u000a-\u000d\u0085\u2028\u2029])*[\u000a-\u000d\u0085\u2028\u2029])(?:(?!' || w.c || ').)+', E'\n', 'g'),
      '(?:(?!' || w.c || ')[^\u000a-\u000d\u0085\u2028\u2029])+', ' ', 'g'),
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

-- phrase_probe(plain, phrase, token): phrase_in's answer, by the same work whether or not there is a phrase: the text is normalized and folded and phrase_pattern is compiled and run for every back; a back with no phrase answers false.
create or replace function phrase_probe(plain text, phrase text, token text) returns boolean
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when plain is null then false else (phrase_fold(phrase_norm(plain)) ~ phrase_pattern(phrase, token)) and (phrase is not null and phrase ~ phrase_word_class()) end
$$;

-- As phrase_fold's (0142): called by the write that springs a back, never by the API's anonymous or digest roles. phrase_in is inlined into its caller's plan, so its caller needs phrase_norm.
revoke execute on function phrase_norm(text) from public, anon;
grant execute on function phrase_norm(text) to authenticated, service_role;
