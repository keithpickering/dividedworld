-- The model-call ledger (supabase/migrations/0042_model_calls.sql; the system plan, Task 3): no client can read or write
-- model_calls or call its writer, each row is written once and never changed, and the writer refuses an outcome outside the three.

do $$
declare
  payload jsonb := jsonb_build_object('duty', 'microEvent', 'staff', 'director', 'provider', 'anthropic', 'model', 'claude-haiku-5-5',
    'service_tier', 'standard', 'input_tokens', 1000, 'output_tokens', 500, 'cache_read_tokens', 0, 'cache_write_5m_tokens', 0, 'cache_write_1h_tokens', 0,
    'cost_microdollars', 350, 'outcome', 'ok', 'trims', '[]'::jsonb, 'retries', 1);
  who text;
  made bigint;
  meeting_id bigint;
  denied boolean;
  held model_calls%rowtype;
begin
  -- No client reaches the table or the writer.
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    denied := false;
    begin perform count(*) from model_calls; exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can read model_calls', who; end if;
    denied := false;
    begin insert into model_calls (duty, provider, model, cost_microdollars, outcome) values ('meeting', 'p', 'm', 0, 'ok'); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can write model_calls', who; end if;
    denied := false;
    begin perform record_model_call(payload); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can call record_model_call', who; end if;
    perform tests.unbecome();
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.model_calls'::regclass) then raise exception 'model_calls has no row-level security'; end if;

  -- The service role records a row, and it is what was said.
  perform tests.become_service();
  made := record_model_call(payload);
  perform tests.unbecome();
  select * into held from model_calls where model_calls.id = made;
  if held.duty is distinct from 'microEvent' or held.staff is distinct from 'director' or held.model is distinct from 'claude-haiku-5-5'
     or held.cost_microdollars is distinct from 350 or held.outcome is distinct from 'ok' or held.retries is distinct from 1
     or held.input_tokens is distinct from 1000 or held.meeting is not null or held.predicate is not null or held.at is null then
    raise exception 'the ledger row is not what was recorded: %', to_jsonb(held);
  end if;

  -- A rejection keeps its predicate and its trims; a failure needs neither.
  -- The meeting it names is a real one (0044 gave model_calls.meeting its foreign key).
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), now(), now(), 'rejected') returning id into meeting_id;
  made := record_model_call(payload || jsonb_build_object('outcome', 'rejected', 'predicate', 'atMost(6)', 'meeting', meeting_id,
    'trims', '[{"path": "moves", "predicate": "atMost(6)", "before": 7, "after": 6}]'::jsonb));
  select * into held from model_calls where model_calls.id = made;
  if held.outcome <> 'rejected' or held.predicate <> 'atMost(6)' or held.meeting <> meeting_id or jsonb_array_length(held.trims) <> 1 then raise exception 'a rejection lost its record: %', to_jsonb(held); end if;
  perform record_model_call('{"duty": "meeting", "provider": "completions", "model": "self-hosted", "cost_microdollars": 0, "outcome": "failed", "gpu_seconds": 2.5}');

  -- An outcome outside the three is refused, and so is a rejection that names no predicate and a negative cost.
  denied := false;
  begin perform record_model_call(payload || '{"outcome": "maybe"}'); exception when invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'record_model_call took an outcome outside ok, rejected and failed'; end if;
  denied := false;
  begin perform record_model_call(payload || '{"outcome": "rejected"}'); exception when check_violation or invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'a rejection without a predicate was recorded'; end if;
  denied := false;
  begin perform record_model_call(payload || '{"cost_microdollars": -1}'); exception when check_violation or invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'a negative cost was recorded'; end if;
  denied := false;
  begin perform record_model_call(payload - 'cost_microdollars'); exception when not_null_violation or invalid_parameter_value then denied := true; end;
  if not denied then raise exception 'a call with no cost was recorded: the cost is a column'; end if;

  -- Each row is written once: an update, a delete and a truncate raise, even in replica mode.
  denied := false;
  begin update model_calls set cost_microdollars = 0 where model_calls.id = made; exception when raise_exception then denied := true; end;
  if not denied then raise exception 'a ledger row was updated'; end if;
  denied := false;
  begin delete from model_calls where model_calls.id = made; exception when raise_exception then denied := true; end;
  if not denied then raise exception 'a ledger row was deleted'; end if;
  denied := false;
  begin truncate model_calls; exception when raise_exception then denied := true; end;
  if not denied then raise exception 'the ledger was truncated'; end if;
  perform set_config('session_replication_role', 'replica', true);
  denied := false;
  begin update model_calls set cost_microdollars = 0 where model_calls.id = made; exception when raise_exception then denied := true; end;
  perform set_config('session_replication_role', 'origin', true);
  if not denied then raise exception 'a ledger row was updated in replica mode'; end if;
end $$;
