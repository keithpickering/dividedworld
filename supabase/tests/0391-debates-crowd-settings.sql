-- settings_held holds both features at once (supabase/migrations/0391_debates_crowd_settings.sql): `debateDays` (0391) and `crowdPayEach` and `crowdPayMost` (0383), each copied from 0377 on its own branch, so the
-- later copy replayed over the earlier one and dropped `debateDays`. Each key here is refused a poisoned value with 23514 and takes a good one, in one replay, so a later copy that drops any of the three goes red here.

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;

do $$
declare
  row record;
  got text;
begin
  for row in select * from (values
    ('debateDays', '0'), ('debateDays', '366'), ('debateDays', '1.5'), ('debateDays', '"3"'), ('debateDays', 'null'), ('debateDays', 'true'),
    ('crowdPayEach', '-1'), ('crowdPayEach', '1.5'), ('crowdPayEach', '"5"'), ('crowdPayEach', 'null'),
    ('crowdPayMost', '0'), ('crowdPayMost', '2.5'), ('crowdPayMost', '"5"'), ('crowdPayMost', 'true')) v(key, value) loop
    got := pg_temp.coded(format('update settings set value = %L::jsonb where key = %L', row.value, row.key));
    if got is distinct from '23514' then raise exception '% = % was not refused with 23514 (got %)', row.key, row.value, coalesce(got, 'nothing'); end if;
  end loop;

  for row in select * from (values ('debateDays', '1'), ('debateDays', '365'), ('crowdPayEach', '0'), ('crowdPayEach', '5'), ('crowdPayMost', '1'), ('crowdPayMost', '40')) v(key, value) loop
    got := pg_temp.coded(format('update settings set value = %L::jsonb where key = %L', row.value, row.key));
    if got is not null then raise exception '% = % was refused (%)', row.key, row.value, got; end if;
  end loop;

  -- Every row the update reached: a key the fixtures do not hold would be no test at all.
  if (select count(*) from settings where key in ('debateDays', 'crowdPayEach', 'crowdPayMost')) is distinct from 3 then
    raise exception 'the fixtures do not hold all three settings, so nothing above was tested';
  end if;
end $$;
