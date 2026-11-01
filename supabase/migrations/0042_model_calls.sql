-- The model-call ledger. The system plan (docs/plans/2026-10-30-the-system-plan.md), Task 3.
--
-- "Cost is a column, not a report": every model call lands in a row here, priced in whole
-- microdollars from the provider's own usage block (supabase/functions/_shared/models/prices.ts),
-- the tier the usage block reports being the sole authority on what was billed. A rejected answer
-- and a failed call each write a row too, so no call leaves none. A model missing from the price
-- table throws before it is ever priced at zero (the row of that call is a failure, cost 0, with
-- the predicate `unpriced`).
--
-- It is the instance's own bookkeeping, not play: no client reads or writes it, nor calls its
-- writer. The Edge Function that made the call writes it through record_model_call, as the
-- service role. Each row is written once and never changed or removed, as an Act is
-- (acts_no_update): a bill reconciled against it monthly needs the rows to hold still.
-- `meeting` names the meeting a call was made in, once meetings exist (a later migration gives it
-- its table); it is empty for a call made outside one.

create table model_calls (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  duty text not null,
  staff text,
  provider text not null,
  model text not null,
  service_tier text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cache_read_tokens integer check (cache_read_tokens >= 0),
  cache_write_5m_tokens integer check (cache_write_5m_tokens >= 0),
  cache_write_1h_tokens integer check (cache_write_1h_tokens >= 0),
  gpu_seconds numeric check (gpu_seconds >= 0),
  cost_microdollars bigint not null check (cost_microdollars >= 0),
  outcome text not null check (outcome in ('ok', 'rejected', 'failed')),
  -- The bound a rejected answer failed (or, on a failure, why it was not priced); an answer used names none.
  predicate text,
  -- Every bound the answer was trimmed to: [{path, predicate, before, after}].
  trims jsonb not null default '[]' check (jsonb_typeof(trims) = 'array'),
  retries integer not null default 0 check (retries >= 0),
  meeting bigint,
  check (outcome <> 'ok' or predicate is null),
  check (outcome <> 'rejected' or predicate is not null)
);
create index model_calls_at on model_calls (at);

alter table model_calls enable row level security;
revoke all on model_calls from public, anon, authenticated;

create function model_calls_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a model call is never edited or removed (%); the ledger is written once', tg_op using errcode = 'P0001';
end $$;
create trigger model_calls_no_update before update or delete on model_calls for each row execute function model_calls_append_only();
create trigger model_calls_no_truncate before truncate on model_calls for each statement execute function model_calls_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table model_calls enable always trigger model_calls_no_update;
alter table model_calls enable always trigger model_calls_no_truncate;
revoke execute on function model_calls_append_only() from public, anon, authenticated;

-- The one writer. A payload names the columns in snake case; `at` and `trims` and `retries` default.
create function record_model_call(payload jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made bigint;
begin
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'a model call is recorded from an object' using errcode = '22023'; end if;
  if payload ->> 'outcome' is null or payload ->> 'outcome' not in ('ok', 'rejected', 'failed') then
    raise exception 'a model call ends ok, rejected or failed, not %', coalesce(payload ->> 'outcome', 'nothing') using errcode = '22023';
  end if;
  insert into model_calls (duty, staff, provider, model, service_tier, input_tokens, output_tokens, cache_read_tokens,
    cache_write_5m_tokens, cache_write_1h_tokens, gpu_seconds, cost_microdollars, outcome, predicate, trims, retries, meeting)
  values (payload ->> 'duty', payload ->> 'staff', payload ->> 'provider', payload ->> 'model', payload ->> 'service_tier',
    (payload ->> 'input_tokens')::integer, (payload ->> 'output_tokens')::integer, (payload ->> 'cache_read_tokens')::integer,
    (payload ->> 'cache_write_5m_tokens')::integer, (payload ->> 'cache_write_1h_tokens')::integer, (payload ->> 'gpu_seconds')::numeric,
    (payload ->> 'cost_microdollars')::bigint, payload ->> 'outcome', payload ->> 'predicate', coalesce(payload -> 'trims', '[]'::jsonb),
    coalesce((payload ->> 'retries')::integer, 0), (payload ->> 'meeting')::bigint)
  returning id into made;
  return made;
end $$;
revoke execute on function record_model_call(jsonb) from public, anon, authenticated;
grant execute on function record_model_call(jsonb) to service_role;
