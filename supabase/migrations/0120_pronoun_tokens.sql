-- Staff pronoun tokens in stock lines (docs/plans/2026-11-07-pronouns-design.md, section 1; docs/plans/2026-11-07-pronouns-plan.md, Task 9). A stock line about a staff
-- character may say `{mod.they}`, `{boss.their}` and the rest of engine/rules/pronouns.ts's PRONOUN_FORMS (`they They them Them their Their theirs Theirs themself Themself is was
-- has does s`), filled from that character's own set, so a line reads right for whoever holds the office now. A form that does not exist stays as written, as any token with no
-- value does. The tokens are only the staff character's: a reporter's or an appellant's pronouns are never read.
--
-- Written here: fill_tokens (0048), a token pattern that may hold dots; pronoun_tokens, the keys for one character; and system_line (0102), visit_line (0105), report_line (0107)
-- and appeal_line (0109), each the latest definition with the staff character's tokens merged in. The only callers of fill_tokens that fill `{boss}` or `{mod}` are these four
-- (checked by grep: 0108 and the rest fill only `{param}`), and none of them changes its signature or its callers.
--
-- Ways out: no state is added.

-- fill_tokens (0048), whose token may now hold dots: `{mod.they}`. Everything else as 0048 wrote it, with the same single pass.
create or replace function fill_tokens(template text, vals jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  rest text := coalesce(template, '');
  out text := '';
  m text[];
begin
  loop
    m := regexp_match(rest, '^(.*?)\{([\w.]+)\}(.*)$', 's');
    exit when m is null;
    out := out || m[1] || case when jsonb_typeof(vals -> m[2]) = 'string' then vals ->> m[2] else '{' || m[2] || '}' end;
    rest := m[3];
  end loop;
  return out || rest;
end $$;
revoke execute on function fill_tokens(text, jsonb) from public, anon, authenticated;

-- The tokens for one character's pronouns: `{prefix}.{form}` for every key of engine/rules/pronouns.ts's words(), from the character's profile, else the instance's `pronouns`
-- setting, else the it-set (new_pronouns, 0118). A form is the set's word and its capitalized twin; the verbs follow `plural` ("they are", "it is"). Definer, since it reads a
-- profile the caller has no grant on; no caller is a player.
create function pronoun_tokens(prefix text, who uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_object_agg(prefix || '.' || f.k, f.v)
  from (select coalesce((select p.pronouns from character_profiles p where p.character = who), new_pronouns()) as v) s,
  lateral (values
    ('they', s.v ->> 'subject'), ('They', upper(left(s.v ->> 'subject', 1)) || substr(s.v ->> 'subject', 2)),
    ('them', s.v ->> 'object'), ('Them', upper(left(s.v ->> 'object', 1)) || substr(s.v ->> 'object', 2)),
    ('their', s.v ->> 'determiner'), ('Their', upper(left(s.v ->> 'determiner', 1)) || substr(s.v ->> 'determiner', 2)),
    ('theirs', s.v ->> 'possessive'), ('Theirs', upper(left(s.v ->> 'possessive', 1)) || substr(s.v ->> 'possessive', 2)),
    ('themself', s.v ->> 'reflexive'), ('Themself', upper(left(s.v ->> 'reflexive', 1)) || substr(s.v ->> 'reflexive', 2)),
    ('is', case when (s.v ->> 'plural')::boolean then 'are' else 'is' end), ('was', case when (s.v ->> 'plural')::boolean then 'were' else 'was' end),
    ('has', case when (s.v ->> 'plural')::boolean then 'have' else 'has' end), ('does', case when (s.v ->> 'plural')::boolean then 'do' else 'does' end),
    ('s', case when (s.v ->> 'plural')::boolean then '' else 's' end)) f(k, v)
$$;
revoke execute on function pronoun_tokens(text, uuid) from public, anon, authenticated;

-- system_line (0102), also filling `{boss.they}` and the other forms from the staff member's set. Everything else as 0102 wrote it.
create or replace function system_line(line_key text, move_kind text, params jsonb, staff_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  words text;
  line text;
  boss_name text;
  boss_id uuid;
  board_name text := '';
  rule_words text := '';
  rule_board uuid;
  predicate_words text;
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  select s.value ->> move_kind into words from settings s where s.key = 'systemMoveWords';
  words := coalesce(words, 'a move');
  if jsonb_typeof(params) = 'object' then
    words := fill_tokens(words, params);
    if lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      board_name := coalesce((select b.name from boards_now b where b.id = (params ->> 'board')::uuid), '');
    end if;
    if move_kind = 'setRule' then
      rule_board := case when lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (params ->> 'board')::uuid end;
      if rule_board is null then board_name := 'every board'; end if;
      select fill_tokens(x.plain, jsonb_build_object('param', coalesce(params #>> '{param}', ''))) into predicate_words from rule_predicates x where x.key = params ->> 'predicate';
      rule_words := case when rule_board is null then 'House Rule ' else 'Rule ' end
        || ((select count(*) from acts p where p.kind = 'move' and p.payload ->> 'kind' = 'setRule' and coalesce(p.payload #>> '{params,board}', '') = coalesce(rule_board::text, '')) + 1)::text
        || ': ' || coalesce(predicate_words, 'a rule');
    end if;
  end if;
  select c.name, c.id into boss_name, boss_id from characters c where c.staff = staff_key;
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    line := lines ->> floor(random() * jsonb_array_length(lines))::integer;
  else
    return words;
  end if;
  return fill_tokens(line, jsonb_build_object('boss', coalesce(boss_name, ''), 'board', board_name, 'move', words, 'rule', rule_words) || pronoun_tokens('boss', boss_id));
end $$;
revoke execute on function system_line(text, text, jsonb, text) from public, anon, authenticated;

-- visit_line (0105), also filling `{mod.they}` and the other forms from the Mod's set. Everything else as 0105 wrote it.
create or replace function visit_line(line_key text, staff text, charges jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = visit_line.staff), '');
  mod_id uuid := (select c.id from characters c where c.staff = visit_line.staff);
  rules text := coalesce(nullif((select string_agg(coalesce(nullif(c ->> 'rule', ''), 'a breach of the rules'), '; ' order by n) from jsonb_array_elements(charges) with ordinality e(c, n)), ''), 'a breach of the rules');
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'rule', rules) || pronoun_tokens('mod', mod_id));
  end if;
  return case line_key when 'visitArrived' then mod_name || ' is looking at this post under ' || rules || '.' else mod_name || ' filed this post under ' || rules || '.' end;
end $$;
revoke execute on function visit_line(text, text, jsonb) from public, anon, authenticated;

-- report_line (0107), also filling `{mod.they}` and the other forms from the Mod's set; the reporter's are no tokens. Everything else as 0107 wrote it.
create or replace function report_line(line_key text, staff text, reporter text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = report_line.staff), '');
  mod_id uuid := (select c.id from characters c where c.staff = report_line.staff);
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return left(fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'reporter', reporter) || pronoun_tokens('mod', mod_id)), 280);
  end if;
  return case line_key
    when 'reportDismissed' then mod_name || ' read ' || reporter || '''s report and dismissed it.'
    else mod_name || ' read ' || reporter || '''s report and has some thoughts about ' || reporter || '.' end;
end $$;
revoke execute on function report_line(text, text, text) from public, anon, authenticated;

-- appeal_line (0109), also filling `{mod.they}` and the other forms from the hearer's set; the appellant's are no tokens. Everything else as 0109 wrote it.
create or replace function appeal_line(line_key text, staff text, appellant text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = appeal_line.staff), '');
  mod_id uuid := (select c.id from characters c where c.staff = appeal_line.staff);
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return left(fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'appellant', appellant) || pronoun_tokens('mod', mod_id)), 280);
  end if;
  return case line_key
    when 'appealOverturned' then mod_name || ' heard ' || appellant || '''s appeal and overturned it.'
    when 'appealReduced' then mod_name || ' heard ' || appellant || '''s appeal and reduced it.'
    when 'appealIncreased' then mod_name || ' heard ' || appellant || '''s appeal and increased it.'
    else mod_name || ' heard ' || appellant || '''s appeal and upheld it.' end;
end $$;
revoke execute on function appeal_line(text, text, text) from public, anon, authenticated;
