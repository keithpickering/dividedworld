-- Red-check probe only (never merged): one acts_public / pool_probe probe of an unveiled post, under many planner states, for several plantings. Prints; raises once at the end so the run shows FAIL with the table.
create function pg_temp.acts_read() returns bigint language sql as $$ select coalesce(sum(seq_tup_read + idx_tup_fetch), 0)::bigint from pg_stat_xact_all_tables where relname = 'acts' $$;
create function pg_temp.probe(label text, p uuid) returns text language plpgsql as $$
declare c0 bigint; a bigint; b bigint; r record;
begin
  perform set_config('track_functions', 'all', true);
  c0 := pg_temp.acts_read(); execute 'select x.id from acts_public x where x.id = $1' using p into r; a := pg_temp.acts_read() - c0;
  c0 := pg_temp.acts_read(); execute 'select * from pool_probe($1)' using p into r; b := pg_temp.acts_read() - c0;
  return format('%s: view %s, pool_probe %s', label, a, b) || E'\n';
end $$;
create function pg_temp.states(size text, p uuid) returns text language plpgsql as $$
declare o text := '';
begin
  o := o || pg_temp.probe(size || ' as planted', p);
  perform set_config('enable_seqscan', 'off', true); o := o || pg_temp.probe(size || ' as planted, seqscan off', p); perform set_config('enable_seqscan', 'on', true);
  perform set_config('random_page_cost', '100', true); o := o || pg_temp.probe(size || ' rpc 100', p); perform set_config('random_page_cost', '4', true);
  update pg_class c set relallvisible = c.relpages where c.oid in ('acts'::regclass, 'post_veils'::regclass, 'post_veil_cover'::regclass, 'card_write_refunds'::regclass);
  o := o || pg_temp.probe(size || ' all visible', p);
  perform set_config('random_page_cost', '100', true); o := o || pg_temp.probe(size || ' all visible, rpc 100', p); perform set_config('random_page_cost', '4', true);
  analyze acts;
  o := o || pg_temp.probe(size || ' acts analyzed', p);
  perform set_config('random_page_cost', '100', true); o := o || pg_temp.probe(size || ' acts analyzed, rpc 100', p); perform set_config('random_page_cost', '4', true);
  update pg_class c set relallvisible = c.relpages where c.oid in ('acts'::regclass, 'post_veils'::regclass, 'post_veil_cover'::regclass, 'card_write_refunds'::regclass);
  o := o || pg_temp.probe(size || ' acts analyzed, all visible', p);
  delete from pg_statistic where starelid = 'acts'::regclass; update pg_class set relpages = 0, reltuples = 0, relallvisible = 0 where oid = 'acts'::regclass;
  o := o || pg_temp.probe(size || ' empty acts', p);
  perform set_config('plan_cache_mode', 'force_generic_plan', true); o := o || pg_temp.probe(size || ' empty acts, generic', p); perform set_config('plan_cache_mode', 'auto', true);
  return o;
end $$;
do $$
declare a uuid := tests.character(tests.account('mx-ann'), 'Mx Ann'); t uuid := tests.thread('Mx'); p uuid := tests.act(a, 'post', t, '{"body": "plain"}'::jsonb);
  sz integer[]; v integer; e integer; acc text := '';
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  foreach sz slice 1 in array array[[8, 10], [3, 10], [8, 40], [8, 200], [30, 10]] loop
    v := sz[1]; e := sz[2];
    begin
      perform tests.plant_live_veils(v, e);
      acc := acc || pg_temp.states(format('%s veils %s ends', v, e), p);
      raise exception 'undo' using errcode = 'P0099';
    exception when sqlstate 'P0099' then null;
    end;
  end loop;
  raise exception E'matrix:\n%', acc;
end $$;
