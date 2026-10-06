-- Staging fixture infrastructure only; never apply to the production project.
-- AFTER fires once for an upsert and rolls the entire reservation back on refusal.
create schema if not exists readiness_private;
revoke all on schema readiness_private from public,anon,authenticated;
create table if not exists readiness_private.budgets (
 run uuid primary key, expires_at timestamptz not null,
 ceiling_micro_usd bigint not null check(ceiling_micro_usd between 1 and 10000000),
 max_calls integer not null check(max_calls between 1 and 60),
 reserved_micro_usd bigint not null default 0, calls integer not null default 0
);
create table if not exists readiness_private.workspaces (
 workspace uuid primary key, run uuid not null references readiness_private.budgets(run)
);
revoke all on all tables in schema readiness_private from public,anon,authenticated;
create or replace function readiness_private.reserve() returns trigger
language plpgsql set search_path='' as $$
declare run_id uuid; cost bigint; call_delta integer;
begin
 if new.period<>'day' or new.scope not like 'workspace:%' then return new; end if;
 select run into run_id from readiness_private.workspaces where workspace::text=substring(new.scope from 11);
 if run_id is null then return new; end if;
 call_delta:=new.calls-case when tg_op='UPDATE' then old.calls else 0 end;
 -- Deliberately pessimistic: one input byte per token, no cache discount.
 cost:=(new.input_bytes-case when tg_op='UPDATE' then old.input_bytes else 0 end)*5
      +(new.output_tokens-case when tg_op='UPDATE' then old.output_tokens else 0 end)*20;
 if call_delta<=0 or cost<0 then raise exception 'readiness_budget_invalid_delta'; end if;
 update readiness_private.budgets set reserved_micro_usd=reserved_micro_usd+cost,calls=calls+call_delta
 where run=run_id and expires_at>now() and reserved_micro_usd+cost<=ceiling_micro_usd and calls+call_delta<=max_calls;
 if not found then raise exception 'readiness_budget_exhausted'; end if;
 return new;
end$$;
revoke all on function readiness_private.reserve() from public,anon,authenticated;
drop trigger if exists readiness_budget on public.ai_budget_counters;
create trigger readiness_budget after insert or update on public.ai_budget_counters
for each row execute function readiness_private.reserve();
