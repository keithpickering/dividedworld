-- "Drop now" is the default debut: create_character (0028) with its `timing` defaulting to 'now' where it defaulted to 'tally'. Only the default
-- changes; the body, the signature and the grants (0024) are those of 0028, and a call that names its timing is unaffected. The onboarding plan, Task 1.

create or replace function create_character(name text, class text, timing text default 'now', loudness text default 'announced') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  named text := btrim(name, ' ');
  made uuid;
  at timestamptz;
  announced jsonb;
begin
  if named is null or char_length(named) not between 1 and 40 then
    raise exception 'a name is 1 to 40 characters' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A name nobody's can be made to look like: unique whatever its case or script (0011), and holding no
  -- invisible, control or direction character and no space but a single one. The same set as
  -- engine/rules/actions.ts's NAME_HIDDEN.
  if named ~ '[\u0001-\u001f\u007f- ­͏؜ᅟᅠ ឴឵᠋-᠎ -‏ -  -⁯　ㅤ︀-️﻿ﾠ￰-￿⠀\U0001d173-\U0001d17a\U000e0000-\U000e0fff]' or named like '%  %' then
    raise exception 'a name can hold letters, marks, digits, symbols and single spaces, nothing hidden' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = class) then
    raise exception 'there is no class "%"', class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform debut_options(timing, loudness);
  begin
    -- A drop is debuted in the insert itself, at its creation (both are the transaction's now()).
    insert into characters (owner, name, debut_loudness, debuted_at) values (caller, named, loudness, case when timing = 'now' then now() end)
    returning id, created_at into made, at;
  exception when unique_violation then
    raise exception 'that name is taken' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  insert into class_history (character, class_key, started_at) values (made, class, at);
  if timing = 'now' and loudness <> 'silent' then announced := announce_drop(made, at); end if;
  return jsonb_build_object('id', made, 'name', named, 'class', class, 'waiting', timing = 'tally', 'loudness', loudness, 'announcement', announced);
end $$;
