-- How players reach an admin (supabase/migrations/0081_admin_contact.sql; the onboarding follow-ups plan, Task 8; its design, section 2):
-- the setting `adminContact`, a list of { label, href }, read by admin_contact() for anyone and written by set_admin_contact() for an admin
-- alone, which repairs what can be repaired without inventing words and refuses the rest, naming the predicate and the row.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
declare
  hint text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics hint = pg_exception_hint;
  return sqlstate || '|' || coalesce(hint, '') || '|' || sqlerrm;
end $$;

-- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing function below).
do $$
begin
  if to_regprocedure('admin_contact()') is null then raise exception 'admin_contact() exists'; end if;
  if to_regprocedure('set_admin_contact(jsonb)') is null then raise exception 'set_admin_contact(jsonb) exists'; end if;
end $$;

-- ---- The shape: a definer, stable read with a pinned search path, for visitors and players ----
do $$
declare
  r record;
begin
  for r in select p.proname, p.prosecdef, p.provolatile, p.proconfig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_contact', 'set_admin_contact')
  loop
    if not r.prosecdef then raise exception '% is security definer', r.proname; end if;
    if not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%' and c like '%pg_temp') then raise exception '% pins its search_path, ending in pg_temp', r.proname; end if;
    if r.proname = 'admin_contact' and r.provolatile <> 's' then raise exception 'admin_contact is stable'; end if;
  end loop;
  if not has_function_privilege('anon', 'admin_contact()', 'execute') or not has_function_privilege('authenticated', 'admin_contact()', 'execute') then
    raise exception 'a visitor and a player may read the contact';
  end if;
  if has_function_privilege('anon', 'set_admin_contact(jsonb)', 'execute') then raise exception 'a visitor may not write the contact'; end if;
  if not has_function_privilege('authenticated', 'set_admin_contact(jsonb)', 'execute') then raise exception 'an admin is authenticated, and may write it'; end if;
end $$;

-- ---- Unset: an empty list, to anyone ----
do $$
begin
  delete from settings where key = 'adminContact';
  perform tests.become_anon();
  if admin_contact() is distinct from '[]'::jsonb then raise exception 'unset, a visitor reads []: %', admin_contact(); end if;
  perform tests.unbecome();
end $$;

-- ---- Who may write ----
do $$
declare
  ann uuid := tests.account('ac-ann');
  adm uuid := tests.account('ac-admin');
  said text;
begin
  insert into admins (account) values (adm);
  perform tests.become(ann);
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Mail", "href": "a@b.example"}]')$q$);
  perform tests.unbecome();
  if said is null or said not like '42501|kayfabb.refusal|%' then raise exception 'a player wrote the contact: %', coalesce(said, 'no refusal'); end if;
  perform tests.become_anon();
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Mail", "href": "a@b.example"}]')$q$);
  perform tests.unbecome();
  if said is null then raise exception 'a visitor reached set_admin_contact'; end if;
  -- The service role has no uid, and is_admin reads the uid: refused, as post_update refuses it.
  perform tests.become_service();
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Mail", "href": "a@b.example"}]')$q$);
  perform tests.unbecome();
  if said is null then raise exception 'the service role wrote the contact, and a model would reach it so'; end if;
  if exists (select 1 from settings where key = 'adminContact') then raise exception 'a refused write left a setting'; end if;
end $$;

-- ---- An admin's write: repairs, then refusals ----
do $$
declare
  adm uuid := tests.account('ac-admin2');
  said text;
  got jsonb;
  long40 text := repeat('x', 40);
begin
  insert into admins (account) values (adm);
  perform tests.become(adm);

  -- Whitespace trimmed, an empty row dropped, a bare email made mailto:, extra keys dropped, a null list made empty.
  got := set_admin_contact('[{"label": "  Discord  ", "href": "  https://discord.example/u/gabe  "}, {"label": "  ", "href": ""}, {"label": "Mail", "href": " gabe@example.com ", "extra": 1}, {}]');
  if got is distinct from '[{"label": "Discord", "href": "https://discord.example/u/gabe"}, {"label": "Mail", "href": "mailto:gabe@example.com"}]'::jsonb then
    raise exception 'the repaired list: %', got;
  end if;
  if admin_contact() is distinct from got then raise exception 'what is stored is what was answered'; end if;
  got := set_admin_contact(null);
  if got is distinct from '[]'::jsonb or admin_contact() is distinct from '[]'::jsonb then raise exception 'a null list clears the contact'; end if;
  if set_admin_contact('[]') is distinct from '[]'::jsonb then raise exception 'an empty list is the empty contact'; end if;
  -- A label of exactly 40, an address of exactly 300, and five rows are inside the bounds; mailto: and https: in any case.
  got := set_admin_contact(jsonb_build_array(
    jsonb_build_object('label', long40, 'href', 'https://e.example/' || repeat('p', 282)),
    jsonb_build_object('label', 'Up', 'href', 'MAILTO:a@b.example'), jsonb_build_object('label', 'Three', 'href', 'HTTPS://x.example'),
    jsonb_build_object('label', 'Four', 'href', 'https://four.example'), jsonb_build_object('label', 'Five', 'href', 'https://five.example')));
  if jsonb_array_length(got) is distinct from 5 or char_length(got #>> '{0,href}') is distinct from 300 then raise exception 'the bounds hold exactly at their edge: %', got; end if;
  -- Six rows with one empty are five.
  got := set_admin_contact('[{"label":"a","href":"https://a.example"},{"label":"","href":""},{"label":"b","href":"https://b.example"},{"label":"c","href":"https://c.example"},{"label":"d","href":"https://d.example"},{"label":"e","href":"https://e.example"}]');
  if jsonb_array_length(got) is distinct from 5 then raise exception 'an empty row is dropped before the rows are counted'; end if;

  -- Refusals: a state is stored first so each is shown to leave it alone. Each names its predicate and the row, and carries the hint.
  got := set_admin_contact('[{"label": "Keep", "href": "https://keep.example"}]');
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "a", "href": "https://a.example"}, {"label": "Script", "href": "javascript:alert(1)"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 2%https:%mailto:%' then raise exception 'javascript: is refused naming row 2: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Plain", "href": "http://plain.example"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%https:%mailto:%' then raise exception 'http: is refused naming row 1: %', coalesce(said, 'no refusal'); end if;
  -- Looks like an email but carries a scheme: refused, never repaired into mailto:javascript:a@b.
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Sneaky", "href": "javascript:a@b"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%https:%mailto:%' then raise exception 'javascript:a@b is refused, not repaired: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Sneaky", "href": "javascript:a@b.example"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%https:%mailto:%' then raise exception 'javascript:a@b.example is refused, not repaired: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Sneaky", "href": "data:text/html,a@b.example"}]')$q$);
  if said is null then raise exception 'data: with an at sign is refused'; end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Sneaky", "href": "//evil.example"}]')$q$);
  if said is null then raise exception 'a scheme-relative address is refused'; end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "Space", "href": "https://a.example/ b"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%' then raise exception 'an address with a space is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal(format($q$select set_admin_contact('[{"label": "%s", "href": "https://a.example"}]')$q$, repeat('x', 41)));
  if said is null or said not like '22023|kayfabb.refusal|%row 1%label%40%' then raise exception 'a 41-character label is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal(format($q$select set_admin_contact('[{"label": "Long", "href": "https://e.example/%s"}]')$q$, repeat('p', 283)));
  if said is null or said not like '22023|kayfabb.refusal|%row 1%address%300%' then raise exception 'a 301-character address is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label":"a","href":"https://a.example"},{"label":"b","href":"https://b.example"},{"label":"c","href":"https://c.example"},{"label":"d","href":"https://d.example"},{"label":"e","href":"https://e.example"},{"label":"f","href":"https://f.example"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%at most 5%row 6%' then raise exception 'six rows are refused naming row 6: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "No address", "href": ""}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%' then raise exception 'a label with no address is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": "", "href": "https://a.example"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%' then raise exception 'an address with no label is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('{"label": "x"}')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%' then raise exception 'an object is no list: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('["https://a.example"]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%' then raise exception 'a row that is no object is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact('[{"label": 5, "href": "https://a.example"}]')$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%' then raise exception 'a label that is no string is refused: %', coalesce(said, 'no refusal'); end if;
  -- A newline inside an address is a control character, however the form let it in.
  said := pg_temp.refusal($q$select set_admin_contact(jsonb_build_array(jsonb_build_object('label', 'Nl', 'href', E'https://a.example/\nb')))$q$);
  if said is null then raise exception 'a control character is refused'; end if;
  -- One explicit whitespace set, locale-free: U+00A0 and U+0085 are whitespace at the edges and inside an address; a label of only zero-width characters is empty.
  got := set_admin_contact(jsonb_build_array(jsonb_build_object('label', E'\u00a0\u0085Nb\ufeff', 'href', E'\u00a0\u0085https://nb.example\u00a0')));
  if got is distinct from '[{"label": "Nb", "href": "https://nb.example"}]'::jsonb then raise exception 'U+00A0, U+0085 and U+FEFF are trimmed: %', got; end if;
  got := set_admin_contact('[{"label": "Keep", "href": "https://keep.example"}]');
  said := pg_temp.refusal($q$select set_admin_contact(jsonb_build_array(jsonb_build_object('label', 'Nb', 'href', E'https://a.example/\u00a0b')))$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%spaces%' then raise exception 'a no-break space inside an address is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact(jsonb_build_array(jsonb_build_object('label', 'Nel', 'href', E'https://a.example/\u0085b')))$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%spaces%' then raise exception 'U+0085 inside an address is refused: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact(jsonb_build_array(jsonb_build_object('label', E'\u200b\u200c\u200d\u2060', 'href', 'https://a.example')))$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 1%label%zero-width%' then raise exception 'a zero-width-only label is refused naming row 1: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select set_admin_contact(jsonb_build_array(jsonb_build_object('label', 'Ok', 'href', 'https://ok.example'), jsonb_build_object('label', E' \u200b\ufeff', 'href', 'https://a.example')))$q$);
  if said is null or said not like '22023|kayfabb.refusal|%row 2%' then raise exception 'a zero-width-and-space label is refused naming row 2: %', coalesce(said, 'no refusal'); end if;
  if admin_contact() is distinct from got then raise exception 'a refused write left the stored contact alone: %', admin_contact(); end if;
  perform tests.unbecome();
end $$;

-- ---- The answer is the instance's: the same for a visitor, a player and an admin, and for a player with masks ----
do $$
declare
  ann uuid := tests.account('ac-same-ann');
  adm uuid := tests.account('ac-same-admin');
  ac uuid := tests.character(ann, 'AcSame');
  want jsonb;
  seen jsonb[] := '{}';
begin
  insert into admins (account) values (adm);
  perform tests.become(adm);
  want := set_admin_contact('[{"label": "Discord", "href": "https://discord.example/u/gabe"}, {"label": "Mail", "href": "gabe@example.com"}]');
  perform tests.unbecome();
  perform tests.become_anon();
  seen := seen || admin_contact();
  perform tests.unbecome();
  perform tests.become(ann);
  seen := seen || admin_contact();
  perform tests.unbecome();
  perform tests.become(adm);
  seen := seen || admin_contact();
  perform tests.unbecome();
  if exists (select 1 from unnest(seen) s where s is distinct from want) or cardinality(seen) <> 3 then raise exception 'the contact differs by caller: %', seen; end if;
  -- It is the setting's value as an admin wrote it, and names no account or character.
  if exists (select 1 from jsonb_array_elements(want) e, jsonb_object_keys(e) k where k not in ('label', 'href')) then raise exception 'a contact holds a label and an address, and nothing else'; end if;
  if want::text like '%' || ac::text || '%' or want::text like '%' || ann::text || '%' then raise exception 'the contact names an account or a character'; end if;
end $$;
