-- The old voice's window, tokenizer, floor, short-tail share and re-rolls (supabase/migrations/0353_old_voice_window.sql), as
-- docs/plans/2026-11-12-old-voice-window-design.md §4 settles them. Each new key's out-of-bounds values are refused with 23514 and the
-- phrase Task 1 gave settingsProblems (engine/rules/instance.ts); one in bounds is held; screen_settings shows the window and the floor
-- to anon. The floor below the window is not checked here: each row is held alone, and the most a play may buy is computed.

do $$
declare r record; refused boolean; want text;
begin
  for r in select * from (values
    ('oldVoiceWindow', '63', 'a whole number of tokens from 64 to 1,000,000'),
    ('oldVoiceWindow', '1000001', 'a whole number of tokens from 64 to 1,000,000'),
    ('oldVoiceWindow', '1024.5', 'a whole number of tokens from 64 to 1,000,000'),
    ('oldVoiceWindow', '"1024"', 'a whole number of tokens from 64 to 1,000,000'),
    ('oldVoiceWindow', 'null', 'a whole number of tokens from 64 to 1,000,000'),
    ('oldVoiceTokenizer', '"gpt3"', '"gpt2" or "bytes"'),
    ('oldVoiceTokenizer', '2', '"gpt2" or "bytes"'),
    ('oldVoiceTokenizer', 'null', '"gpt2" or "bytes"'),
    ('oldVoicePromptFloor', '0', 'a whole number of tokens, at least 1'),
    ('oldVoicePromptFloor', '1.5', 'a whole number of tokens, at least 1'),
    ('oldVoicePromptFloor', '"256"', 'a whole number of tokens, at least 1'),
    ('cardWriteShortShare', '-0.1', 'a number from 0 to 1'),
    ('cardWriteShortShare', '1.1', 'a number from 0 to 1'),
    ('cardWriteShortShare', '"0.5"', 'a number from 0 to 1'),
    ('cardWriteShortShare', 'null', 'a number from 0 to 1'),
    ('cardWriteRerolls', '-1', 'a whole number from 0 to 5'),
    ('cardWriteRerolls', '6', 'a whole number from 0 to 5'),
    ('cardWriteRerolls', '2.5', 'a whole number from 0 to 5'),
    ('cardWriteRerolls', '"3"', 'a whole number from 0 to 5')
  ) as t(key, value, phrase) loop
    refused := false;
    begin
      insert into settings (key, value) values (r.key, r.value::jsonb)
        on conflict (key) do update set value = excluded.value;
    exception when check_violation then
      refused := true;
      want := r.key || ' is ' || r.phrase;
      if sqlerrm <> want then raise exception '% = % was refused with %, not %', r.key, r.value, sqlerrm, want; end if;
    end;
    if not refused then raise exception '% = % was not refused with 23514', r.key, r.value; end if;
  end loop;

  -- In bounds, each edge and a middle: held.
  for r in select * from (values
    ('oldVoiceWindow', '64'), ('oldVoiceWindow', '1024'), ('oldVoiceWindow', '1000000'),
    ('oldVoiceTokenizer', '"gpt2"'), ('oldVoiceTokenizer', '"bytes"'),
    ('oldVoicePromptFloor', '1'), ('oldVoicePromptFloor', '256'),
    ('cardWriteShortShare', '0'), ('cardWriteShortShare', '0.5'), ('cardWriteShortShare', '1'),
    ('cardWriteRerolls', '0'), ('cardWriteRerolls', '3'), ('cardWriteRerolls', '5')
  ) as t(key, value) loop
    insert into settings (key, value) values (r.key, r.value::jsonb)
      on conflict (key) do update set value = excluded.value;
    if (select s.value from settings s where s.key = r.key) is distinct from r.value::jsonb then raise exception '% = % was not held', r.key, r.value; end if;
  end loop;

  -- A floor at or above the window is held: the relation is not checked in SQL, the most is computed.
  insert into settings (key, value) values ('oldVoiceWindow', '64'::jsonb), ('oldVoicePromptFloor', '5000'::jsonb)
    on conflict (key) do update set value = excluded.value;
end $$;

-- screen_settings shows the window and the floor, and only those two of the five.
insert into settings (key, value) values ('oldVoiceWindow', '2048'::jsonb), ('oldVoicePromptFloor', '300'::jsonb), ('oldVoiceTokenizer', '"bytes"'::jsonb)
  on conflict (key) do update set value = excluded.value;
set local role anon;
do $$
declare got jsonb;
begin
  select settings into got from screen_settings;
  if got -> 'oldVoiceWindow' is distinct from '2048'::jsonb then raise exception 'oldVoiceWindow is not shown: %', got -> 'oldVoiceWindow'; end if;
  if got -> 'oldVoicePromptFloor' is distinct from '300'::jsonb then raise exception 'oldVoicePromptFloor is not shown: %', got -> 'oldVoicePromptFloor'; end if;
  if got ? 'oldVoiceTokenizer' or got ? 'cardWriteShortShare' or got ? 'cardWriteRerolls' then raise exception 'screen_settings shows a key it should not: %', got; end if;
end $$;
reset role;
