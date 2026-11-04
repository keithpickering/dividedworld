-- How players reach an admin (the onboarding follow-ups plan, Task 8; its design, section 2). The guide's last line and the log's foot send a player
-- to an admin, and until now no screen said how. The contact is the setting `adminContact`, a list of { label, href } an admin writes in the
-- running instance (a personal address stays out of git, and changing it takes no deploy). `settings` is carried by the export, so the contact is
-- too. The page that shows it, /contact, is readable signed out, because the player who most needs a person is often the one who cannot sign in.
--
-- admin_contact() is the read, for a visitor and a player alike. It reads one setting and no account, so it is the same for every caller: nothing
-- here is computed from a private fact ("A response never proves a private fact"). It is a definer because `settings` is no API role's to read.
--
-- set_admin_contact(links) is an admin's write, and the spirit of "A validator tighter than the schema is a place a paid answer goes to die"
-- holds, as post_update (0062) keeps it: what can be repaired without inventing words is repaired, and what cannot is refused, naming the
-- predicate and the row's number (the position the admin typed it at, an empty row counted).
--   Repaired: whitespace around a label or an address; a row with neither; keys that are no part of a link; a null list; a bare email, which
--   becomes `mailto:`. A bare email is `name@host.tld` and nothing else: it carries no scheme (no colon), no slash, no query, no space. An input
--   that looks like an email but has a scheme (`javascript:a@b`) is therefore not a bare email, is never given a `mailto:` in front, and is
--   refused by the scheme rule below.
--   Refused: an address that is neither `https://host…` nor `mailto:name@host…` (so `javascript:`, `http:`, `data:` and a scheme-relative `//`
--   are refused; the scheme is read in any case), an address with a space or a control character, a label over 40 characters, an address over
--   300, a label with no address or an address with no label (either would be inventing it), and more than five links once empty rows are dropped.
-- "Whitespace" and "space or control character" are one explicit set, the same in the fake (engine/ui/data/fake.ts): ASCII controls and space, the C1
-- controls (U+007F-U+009F, so U+0085 too), U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. It does not lean on a locale's
-- [[:space:]] or on JavaScript's \s, which disagree about U+0085 and U+00A0 (NUL cannot occur in text). A label of only U+200B-U+200D, U+2060 and U+FEFF would
-- draw an invisible link, so it is refused as a label that is empty once those are removed.
-- Every refusal carries hint = 'kayfabb.refusal', as the rest of the admin screen's do, so the form shows its words.
--
-- Only an admin writes it: auth.uid() is null for the service role, which is refused too, as post_update refuses it, since a model's words reach
-- the service role's functions and a contact is a thing a player is sent to.
--
-- Its way out: a contact is a setting, not a state. A wrong one is replaced by the next write, and clearing it ([]) is allowed, after which the
-- page says plainly that the admins have not added one and the admin screen warns that players have no way to reach them.

create function admin_contact() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.value from settings s where s.key = 'adminContact' and jsonb_typeof(s.value) = 'array'), '[]'::jsonb)
$$;
revoke execute on function admin_contact() from public;
grant execute on function admin_contact() to anon, authenticated;

create function set_admin_contact(links jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  fixed jsonb := '[]';
  e jsonb;
  n integer := 0;
  lab text;
  adr text;
begin
  if auth.uid() is null or not is_admin() then
    raise exception 'only an admin sets how players reach the admins' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if links is null or jsonb_typeof(links) = 'null' then
    links := '[]';
  elsif jsonb_typeof(links) <> 'array' then
    raise exception 'the contact is a list of { label, href }, not a %', jsonb_typeof(links) using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(links) x loop
    n := n + 1;
    if jsonb_typeof(e) <> 'object' then
      raise exception 'row % is { label, href }, not a %', n, jsonb_typeof(e) using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if e ? 'label' and jsonb_typeof(e -> 'label') not in ('string', 'null') then
      raise exception 'row % has a label that is text', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if e ? 'href' and jsonb_typeof(e -> 'href') not in ('string', 'null') then
      raise exception 'row % has an address that is text', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    lab := regexp_replace(coalesce(e ->> 'label', ''), '^[\x01-\x20\x7f-\x9f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\x01-\x20\x7f-\x9f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g');
    adr := regexp_replace(coalesce(e ->> 'href', ''), '^[\x01-\x20\x7f-\x9f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\x01-\x20\x7f-\x9f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g');
    if lab = '' and adr = '' then continue; end if;
    if adr = '' then
      raise exception 'row % has a label and no address; give it an address, or leave the row out', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if lab = '' then
      raise exception 'row % has an address and no label; give it a label, or leave the row out', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if regexp_replace(lab, '[\u200b-\u200d\u2060\ufeff]', '', 'g') = '' then
      raise exception 'row % has a label with something visible in it, not only zero-width characters', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if char_length(lab) > 40 then
      raise exception 'row % has a label of at most 40 characters', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if char_length(adr) > 300 then
      raise exception 'row % has an address of at most 300 characters', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if adr ~ '[\x01-\x20\x7f-\x9f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' then
      raise exception 'row % has an address with no spaces or control characters in it', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    -- A bare email: no scheme, no slash, no query, and one at sign. Anything with a colon is not, whatever follows it.
    if adr ~ '^[^@:/?#]+@[^@:/?#]+\.[^@:/?#]+$' then
      adr := 'mailto:' || adr;
    end if;
    if not (adr ~* '^https://[^/?#@]+([/?#]|$)' or adr ~* '^mailto:[^@:/?#]+@[^@:/?#]+$') then
      raise exception 'row % has an address that is https: or mailto: (a bare email is made mailto:)', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    if jsonb_array_length(fixed) >= 5 then
      raise exception 'the contact holds at most 5 links, and row % is one too many', n using hint = 'kayfabb.refusal', errcode = '22023';
    end if;
    fixed := fixed || jsonb_build_array(jsonb_build_object('label', lab, 'href', adr));
  end loop;
  insert into settings (key, value) values ('adminContact', fixed) on conflict (key) do update set value = excluded.value;
  return fixed;
end $$;
revoke execute on function set_admin_contact(jsonb) from public, anon;
grant execute on function set_admin_contact(jsonb) to authenticated;
