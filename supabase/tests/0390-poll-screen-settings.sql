-- screen_settings shows the five poll settings (supabase/migrations/0390_poll_screen_settings.sql), to anon, as the database holds them.
insert into settings (key, value) values
  ('pollOptionsMax', '7'::jsonb), ('pollQuestionMax', '150'::jsonb), ('pollOptionMax', '80'::jsonb),
  ('pollLastsMin', '{"unit":"hour","count":2}'::jsonb), ('pollLastsMax', '{"unit":"week","count":3}'::jsonb)
  on conflict (key) do update set value = excluded.value;
set local role anon;
do $$
declare got jsonb;
begin
  select settings into got from screen_settings;
  if got -> 'pollOptionsMax' is distinct from '7'::jsonb then raise exception 'pollOptionsMax is not shown: %', got -> 'pollOptionsMax'; end if;
  if got -> 'pollQuestionMax' is distinct from '150'::jsonb then raise exception 'pollQuestionMax is not shown: %', got -> 'pollQuestionMax'; end if;
  if got -> 'pollOptionMax' is distinct from '80'::jsonb then raise exception 'pollOptionMax is not shown: %', got -> 'pollOptionMax'; end if;
  if got -> 'pollLastsMin' is distinct from '{"unit":"hour","count":2}'::jsonb then raise exception 'pollLastsMin is not shown: %', got -> 'pollLastsMin'; end if;
  if got -> 'pollLastsMax' is distinct from '{"unit":"week","count":3}'::jsonb then raise exception 'pollLastsMax is not shown: %', got -> 'pollLastsMax'; end if;
end $$;
reset role;
