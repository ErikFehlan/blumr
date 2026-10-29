-- Additive, opt-in foundation only. No enrollment, billing or worker activation.
begin;

create table public.subscription_plan_versions (
 code text primary key,
 tier text not null check(tier in ('basic','advanced','pro')),
 monthly_price_cents integer not null check(monthly_price_cents>0),
 currency text not null default 'usd' check(currency='usd'),
 rules_limit integer not null check(rules_limit>=0),
 shortlist_ai_limit integer not null check(shortlist_ai_limit>=0),
 deep_ai_limit integer not null check(deep_ai_limit>=0),
 check(tier<>'basic' or (shortlist_ai_limit=0 and deep_ai_limit=0))
);
insert into public.subscription_plan_versions values
 ('basic-v1','basic',2900,'usd',1000,0,0),
 ('advanced-v1','advanced',7900,'usd',1000,100,0),
 ('pro-v1','pro',15000,'usd',1000,100,500);

create table public.subscription_accounts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id) on delete cascade,
 plan_code text not null references public.subscription_plan_versions(code),
 status text not null check(status in ('active','trialing','beta','complimentary','past_due','unpaid','paused','canceled')),
 source text not null check(source in ('manual','stripe')),
 access_until timestamptz,
 current_period_id uuid,
 created_at timestamptz not null default now()
);
create table public.subscription_periods (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.subscription_accounts(id) on delete cascade,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 rules_limit integer not null check(rules_limit between 0 and 1000000),
 shortlist_ai_limit integer not null check(shortlist_ai_limit between 0 and 1000000),
 deep_ai_limit integer not null check(deep_ai_limit between 0 and 1000000),
 unique(account_id,starts_at), unique(account_id,id),
 check(ends_at>starts_at)
);
alter table public.subscription_accounts add constraint subscription_current_period
 foreign key(id,current_period_id) references public.subscription_periods(account_id,id)
 deferrable initially deferred;

create table public.subscription_evaluations (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.subscription_accounts(id) on delete cascade,
 period_id uuid not null,
 workspace_id uuid references public.workspaces(id) on delete set null,
 metric text not null check(metric in ('rules','shortlist_ai','deep_ai')),
 evaluation_key text not null check(evaluation_key ~ '^[a-f0-9]{64}$'),
 state text not null check(state in ('reserved','succeeded','released','uncertain')),
 attempt_id uuid not null,
 attempts integer not null default 1 check(attempts>0),
 result_id uuid,
 outcome text check(outcome in ('succeeded','failed','canceled','uncertain')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(account_id,period_id) references public.subscription_periods(account_id,id),
 unique(account_id,workspace_id,metric,evaluation_key),
 check(state<>'succeeded' or (result_id is not null and outcome='succeeded'))
);
create index subscription_usage_period on public.subscription_evaluations(account_id,period_id,metric,state);
create index subscription_evaluations_workspace on public.subscription_evaluations(workspace_id);
-- Append-only attempt history preserves failed/canceled work when it is retried
-- in a later period. Operational content and provider invoices live elsewhere.
create table public.subscription_evaluation_events (
 id bigint generated always as identity primary key,
 reservation_id uuid not null references public.subscription_evaluations(id) on delete cascade,
 account_id uuid not null references public.subscription_accounts(id) on delete cascade,
 period_id uuid not null,
 attempt_id uuid not null,
 event text not null check(event in ('reserved','succeeded','failed','canceled','uncertain')),
 created_at timestamptz not null default now(),
 foreign key(account_id,period_id) references public.subscription_periods(account_id,id),
 unique(reservation_id,attempt_id,event)
);
create index subscription_events_account on public.subscription_evaluation_events(account_id,period_id);
comment on table public.subscription_evaluations is
 'Customer allowance ledger, not provider cost accounting. No resume, job text or personal content. Service-only writes; integrate settlement with result persistence before activation.';

alter table public.subscription_plan_versions enable row level security;
alter table public.subscription_accounts enable row level security;
alter table public.subscription_periods enable row level security;
alter table public.subscription_evaluations enable row level security;
alter table public.subscription_evaluation_events enable row level security;
revoke all on public.subscription_plan_versions,public.subscription_accounts,public.subscription_periods,public.subscription_evaluations from public,anon,authenticated;
grant select on public.subscription_plan_versions,public.subscription_accounts,public.subscription_periods,public.subscription_evaluations to authenticated;
grant all on public.subscription_plan_versions,public.subscription_accounts,public.subscription_periods,public.subscription_evaluations to service_role;
revoke all on public.subscription_evaluation_events from public,anon,authenticated;
grant select on public.subscription_evaluation_events to authenticated;
grant select,insert on public.subscription_evaluation_events to service_role;
grant usage,select on sequence public.subscription_evaluation_events_id_seq to service_role;
create policy subscription_catalog_read on public.subscription_plan_versions for select to authenticated using(true);
create policy subscription_account_read on public.subscription_accounts for select to authenticated using(user_id=(select auth.uid()));
create policy subscription_period_read on public.subscription_periods for select to authenticated
 using(account_id in (select id from public.subscription_accounts where user_id=(select auth.uid())));
create policy subscription_usage_read on public.subscription_evaluations for select to authenticated
 using(account_id in (select id from public.subscription_accounts where user_id=(select auth.uid())));
create policy subscription_events_read on public.subscription_evaluation_events for select to authenticated
 using(account_id in (select id from public.subscription_accounts where user_id=(select auth.uid())));

-- Trusted worker lookup. Caller must supply the verified/durable actor, never
-- user-controlled plan data or the workspace owner's identity as a fallback.
create function public.subscription_entitlement(p_workspace uuid,p_actor uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.subscription_accounts; p public.subscription_periods; tier_name text;
begin
 if p_actor is null or not exists(select from public.workspace_members where workspace_id=p_workspace and user_id=p_actor) then
  return '{"allowed":false,"code":"subscription_actor_required"}'::jsonb;
 end if;
 select * into a from public.subscription_accounts where user_id=p_actor;
 if a.id is null then return '{"allowed":false,"code":"subscription_required"}'::jsonb;end if;
 if a.status not in ('active','trialing','beta','complimentary') or (a.access_until is not null and a.access_until<=now()) then
  return '{"allowed":false,"code":"subscription_inactive"}'::jsonb;
 end if;
 select * into p from public.subscription_periods where account_id=a.id and id=a.current_period_id;
 if p.id is null or p.starts_at>now() or p.ends_at<=now() then
  return '{"allowed":false,"code":"subscription_period_inactive"}'::jsonb;
 end if;
 select tier into tier_name from public.subscription_plan_versions where code=a.plan_code;
 return jsonb_build_object('allowed',true,'account_id',a.id,'tier',tier_name,'period_id',p.id,
  'period_ends_at',p.ends_at,'ai_allowed',tier_name<>'basic');
end$$;

-- One short account-row lock serializes admission across that user's workspaces.
-- Backend keys identify logical evaluations across periods, not HTTP requests.
create function public.reserve_subscription_evaluation(p_workspace uuid,p_actor uuid,p_metric text,p_key text,p_attempt uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.subscription_accounts; p public.subscription_periods; e public.subscription_evaluations;
 entitlement jsonb; capacity integer; used bigint; plan public.subscription_plan_versions;
begin
 if p_metric is null or p_metric not in ('rules','shortlist_ai','deep_ai') or p_key is null or p_key!~'^[a-f0-9]{64}$' or p_attempt is null then
  raise exception 'Invalid evaluation identity' using errcode='22023';
 end if;
 select * into a from public.subscription_accounts where user_id=p_actor for update;
 entitlement:=public.subscription_entitlement(p_workspace,p_actor);
 if entitlement->>'allowed'<>'true' then return entitlement;end if;
 select * into plan from public.subscription_plan_versions where code=a.plan_code;
 if (plan.tier='basic' and p_metric<>'rules') or (plan.tier='advanced' and p_metric='deep_ai') then
  return '{"allowed":false,"code":"subscription_feature_unavailable"}'::jsonb;
 end if;
 select * into e from public.subscription_evaluations
  where account_id=a.id and workspace_id=p_workspace and metric=p_metric and evaluation_key=p_key;
 if e.state='succeeded' then
  return jsonb_build_object('allowed',true,'state','cached','reservation_id',e.id,'result_id',e.result_id);
 elsif e.state in ('reserved','uncertain') then
  return jsonb_build_object('allowed',e.state='reserved' and e.attempt_id=p_attempt,
   'state',case when e.state='reserved' and e.attempt_id=p_attempt then 'reserved' else 'in_progress' end,
   'reservation_id',e.id,'code','evaluation_in_progress');
 elsif e.state='released' and e.attempt_id=p_attempt then
  return jsonb_build_object('allowed',false,'state','released','code','new_attempt_required');
 end if;
 select * into p from public.subscription_periods where id=a.current_period_id and account_id=a.id for update;
 capacity:=case p_metric when 'rules' then p.rules_limit when 'shortlist_ai' then p.shortlist_ai_limit else p.deep_ai_limit end;
 select count(*) into used from public.subscription_evaluations
  where account_id=a.id and period_id=p.id and metric=p_metric and state in ('reserved','succeeded','uncertain');
 if used>=capacity then return '{"allowed":false,"code":"evaluation_allowance_exhausted"}'::jsonb;end if;
 if e.id is null then
  insert into public.subscription_evaluations(account_id,period_id,workspace_id,metric,evaluation_key,state,attempt_id)
   values(a.id,p.id,p_workspace,p_metric,p_key,'reserved',p_attempt) returning * into e;
 else
  update public.subscription_evaluations set period_id=p.id,state='reserved',attempt_id=p_attempt,
   attempts=attempts+1,outcome=null,result_id=null,updated_at=now() where id=e.id returning * into e;
 end if;
 insert into public.subscription_evaluation_events(reservation_id,account_id,period_id,attempt_id,event)
  values(e.id,e.account_id,e.period_id,e.attempt_id,'reserved');
 return jsonb_build_object('allowed',true,'state','reserved','reservation_id',e.id,'remaining',capacity-used-1);
end$$;

-- The persisted worker attempt owns settlement. An old attempt cannot release
-- or consume a replacement reservation. Uncertain work holds capacity until
-- explicit backend reconciliation; elapsed time alone is not proof of failure.
create function public.settle_subscription_evaluation(p_reservation uuid,p_attempt uuid,p_outcome text,p_result uuid default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.subscription_evaluations; account uuid;
begin
 if p_outcome is null or p_outcome not in ('succeeded','failed','canceled','uncertain') or (p_outcome='succeeded' and p_result is null) or (p_outcome<>'succeeded' and p_result is not null) then
  raise exception 'Invalid evaluation outcome' using errcode='22023';
 end if;
 select account_id into account from public.subscription_evaluations where id=p_reservation;
 perform 1 from public.subscription_accounts where id=account for update;
 select * into e from public.subscription_evaluations where id=p_reservation for update;
 if e.id is null or p_attempt is null or e.attempt_id<>p_attempt then return false;end if;
 if e.state in ('succeeded','released') then return e.outcome=p_outcome and e.result_id is not distinct from p_result;end if;
 update public.subscription_evaluations set state=case p_outcome when 'succeeded' then 'succeeded' when 'uncertain' then 'uncertain' else 'released' end,
  outcome=p_outcome,result_id=p_result,updated_at=now() where id=e.id;
 insert into public.subscription_evaluation_events(reservation_id,account_id,period_id,attempt_id,event)
  values(e.id,e.account_id,e.period_id,e.attempt_id,p_outcome) on conflict do nothing;
 return true;
end$$;

revoke all on function public.subscription_entitlement(uuid,uuid),
 public.reserve_subscription_evaluation(uuid,uuid,text,text,uuid),
 public.settle_subscription_evaluation(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.subscription_entitlement(uuid,uuid),
 public.reserve_subscription_evaluation(uuid,uuid,text,text,uuid),
 public.settle_subscription_evaluation(uuid,uuid,text,uuid) to service_role;

commit;
