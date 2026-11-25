-- The two card-write settings renamed (supabase/migrations/0363_card_write_top_ups.sql; docs/plans/2026-11-13-you-were-saying-voice-design.md §3).
-- A stored cardWriteRerolls row becomes a cardWriteTopUps row with its value and tuned_at kept, and a stored cardWriteShortShare row (its meaning changed) is removed.
-- A test file runs after every migration, so it cannot replay a migration against a state from before it: the old rows are set up here (settings_held lets an unnamed
-- key through) and the migration's two statements are run below, the same text as the migration's.

insert into settings (key, value) values ('cardWriteRerolls', '2'::jsonb), ('cardWriteShortShare', '0.5'::jsonb)
  on conflict (key) do update set value = excluded.value;
update settings set tuned_at = '2026-11-01 12:00:00+00' where key = 'cardWriteRerolls';
delete from settings where key = 'cardWriteTopUps';

-- The migration's statements.
update settings set key = 'cardWriteTopUps' where key = 'cardWriteRerolls' and not exists (select 1 from settings where key = 'cardWriteTopUps');
delete from settings where key in ('cardWriteRerolls', 'cardWriteShortShare');

do $$
declare r settings;
begin
  select * into r from settings where key = 'cardWriteTopUps';
  if not found then raise exception 'the cardWriteTopUps row is missing'; end if;
  if r.value is distinct from '2'::jsonb then raise exception 'cardWriteTopUps lost its value: %', r.value; end if;
  if r.tuned_at is distinct from '2026-11-01 12:00:00+00'::timestamptz then raise exception 'cardWriteTopUps lost its tuned_at: %', r.tuned_at; end if;
  if exists (select 1 from settings where key in ('cardWriteRerolls', 'cardWriteShortShare')) then raise exception 'an old-named row is still stored'; end if;
end $$;
