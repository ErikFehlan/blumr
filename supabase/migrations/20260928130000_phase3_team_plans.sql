-- Phase 3 team membership and manually provisioned paid pilots.
begin;

create table public.workspace_plans (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 plan text not null default 'beta' check(plan in ('beta','pilot')),
 status text not null default 'active' check(status in ('active','paused','expired')),
 monthly_ai_calls integer check(monthly_ai_calls between 1 and 100000),
 period_ends_at timestamptz,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id) on delete set null,
 check(plan='beta' or monthly_ai_calls is not null)
);
insert into public.workspace_plans(workspace_id) select id from public.workspaces on conflict do nothing;
alter table public.workspace_plans enable row level security;
revoke all on public.workspace_plans from public,anon,authenticated;
grant select on public.workspace_plans to authenticated;
grant all on public.workspace_plans to service_role;
create policy workspace_plans_read on public.workspace_plans for select to authenticated
 using(public.is_workspace_member(workspace_id));

-- Provider-reported usage, separate from conservative pre-call reservations.
create table public.ai_provider_usage (
 response_id text primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 operation text not null check(char_length(operation) between 1 and 80),
 model text not null check(char_length(model) between 1 and 160),
 input_tokens integer not null check(input_tokens>=0),
 cached_input_tokens integer not null default 0 check(cached_input_tokens>=0 and cached_input_tokens<=input_tokens),
 output_tokens integer not null check(output_tokens>=0),
 created_at timestamptz not null default now()
);
create index ai_provider_usage_workspace_time on public.ai_provider_usage(workspace_id,created_at desc);
create table public.ai_model_rates (
 model text primary key,
 input_usd_per_million numeric(12,6) not null check(input_usd_per_million>=0),
 cached_input_usd_per_million numeric(12,6) not null check(cached_input_usd_per_million>=0),
 output_usd_per_million numeric(12,6) not null check(output_usd_per_million>=0),
 updated_at timestamptz not null default now()
);
alter table public.ai_provider_usage enable row level security;
alter table public.ai_model_rates enable row level security;
revoke all on public.ai_provider_usage,public.ai_model_rates from public,anon,authenticated;
grant all on public.ai_provider_usage,public.ai_model_rates to service_role;

create or replace function public.admin_set_model_rate(p_model text,p_input numeric,p_cached numeric,p_output numeric)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if p_model is null or char_length(trim(p_model)) not between 1 and 160 or
   p_input is null or p_cached is null or p_output is null or
   p_input not between 0 and 100000 or p_cached not between 0 and 100000 or p_output not between 0 and 100000 then
  raise exception 'Enter valid model token rates' using errcode='22023';end if;
 insert into public.ai_model_rates(model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million)
 values(trim(p_model),p_input,p_cached,p_output)
 on conflict(model) do update set input_usd_per_million=excluded.input_usd_per_million,
 cached_input_usd_per_million=excluded.cached_input_usd_per_million,output_usd_per_million=excluded.output_usd_per_million,updated_at=now();
end$$;
revoke all on function public.admin_set_model_rate(text,numeric,numeric,numeric) from public,anon;
grant execute on function public.admin_set_model_rate(text,numeric,numeric,numeric) to authenticated;
create or replace function public.admin_list_model_rates() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('model',models.model,'calls',models.calls,
  'input',rates.input_usd_per_million,'cached',rates.cached_input_usd_per_million,'output',rates.output_usd_per_million) order by models.model)
  from (select model,count(*) as calls from public.ai_provider_usage group by model) models
  left join public.ai_model_rates rates on rates.model=models.model),'[]'::jsonb);
end$$;
revoke all on function public.admin_list_model_rates() from public,anon;
grant execute on function public.admin_list_model_rates() to authenticated;

create or replace function public.create_workspace_plan() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_plans(workspace_id) values(new.id);
 return new;
end$$;
create trigger create_workspace_plan after insert on public.workspaces for each row execute function public.create_workspace_plan();
revoke all on function public.create_workspace_plan() from public,anon,authenticated;

-- Paused teams can still read and export their existing records.
create or replace function public.require_active_workspace_plan() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from public.workspace_plans p where p.workspace_id=new.workspace_id
  and p.status='active' and (p.period_ends_at is null or p.period_ends_at>now())) then
  raise exception 'This team plan is inactive. Contact the team owner.' using errcode='42501';
 end if;
 return new;
end$$;
do $$declare t text;begin
 foreach t in array array['jobs','candidates','candidate_documents','candidate_assessments','candidate_benchmarks',
  'manager_feedback','interview_outcomes','screening_insights','resume_intake_tasks','job_reassessment_tasks','job_criteria_tasks'] loop
  execute format('create trigger require_active_workspace_plan before insert or update on public.%I for each row execute function public.require_active_workspace_plan()',t);
 end loop;
end$$;
revoke all on function public.require_active_workspace_plan() from public,anon,authenticated;

-- Existing public table privileges cannot be trusted for role/ownership edits.
revoke insert,update,delete on public.workspace_members from authenticated,anon;
revoke update on public.workspaces from authenticated,anon;

create or replace function public.team_add_member(p_workspace uuid,p_email text,p_role text default 'member')
returns void language plpgsql security definer set search_path='' as $$
declare target uuid; clean text:=lower(trim(p_email)); owner uuid; cap integer; total integer;
begin
 if auth.uid() is null or not public.can_manage_workspace(p_workspace) then raise exception 'Team owner or admin required' using errcode='42501';end if;
 if clean is null or length(clean)>254 or clean!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_role not in ('member','admin') then
  raise exception 'Enter a registered email and valid role' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('team:'||p_workspace::text,0));
 select owner_id into owner from public.workspaces where id=p_workspace;
 select u.id into target from auth.users u where lower(u.email)=clean and public.has_beta_access(u.id);
 if target is null then raise exception 'This email needs an approved blumr account first' using errcode='22023';end if;
 if target=owner then raise exception 'The owner already belongs to this team' using errcode='22023';end if;
 select count(*) into total from public.workspace_members where workspace_id=p_workspace;
 cap:=case when (select plan from public.workspace_plans where workspace_id=p_workspace)='pilot' then 5 else 10 end;
 if total>=cap and not exists(select from public.workspace_members where workspace_id=p_workspace and user_id=target) then
  raise exception 'Team seat limit reached' using errcode='PT429';end if;
 insert into public.workspace_members(workspace_id,user_id,role) values(p_workspace,target,p_role)
 on conflict(workspace_id,user_id) do update set role=excluded.role;
end$$;

create or replace function public.team_remove_member(p_workspace uuid,p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.can_manage_workspace(p_workspace) then raise exception 'Team owner or admin required' using errcode='42501';end if;
 if p_user=(select owner_id from public.workspaces where id=p_workspace) then raise exception 'The team owner cannot be removed' using errcode='22023';end if;
 delete from public.workspace_members where workspace_id=p_workspace and user_id=p_user;
end$$;

create or replace function public.team_rename(p_workspace uuid,p_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.can_manage_workspace(p_workspace) then raise exception 'Team owner or admin required' using errcode='42501';end if;
 if p_name is null or char_length(trim(p_name)) not between 1 and 120 then raise exception 'Enter a team name' using errcode='22023';end if;
 update public.workspaces set name=trim(p_name) where id=p_workspace;
end$$;

create or replace function public.team_overview(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare data jsonb;
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace) then raise exception 'Team access required' using errcode='42501';end if;
 select jsonb_build_object('name',w.name,'role',m.role,'plan',p.plan,'status',p.status,
  'monthly_ai_calls',p.monthly_ai_calls,'period_ends_at',p.period_ends_at,
  'calls_this_month',coalesce((select c.calls from public.ai_budget_counters c where c.scope='workspace:'||p_workspace::text
    and c.period='month' and c.window_start=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0),
  'reserved_input_bytes_this_month',coalesce((select c.input_bytes from public.ai_budget_counters c where c.scope='workspace:'||p_workspace::text
    and c.period='month' and c.window_start=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0),
  'reserved_output_tokens_this_month',coalesce((select c.output_tokens from public.ai_budget_counters c where c.scope='workspace:'||p_workspace::text
    and c.period='month' and c.window_start=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),0),
  'provider_usage',(select jsonb_build_object('recorded_calls',count(*),'unpriced_calls',count(*) filter(where r.model is null),
    'input_tokens',coalesce(sum(a.input_tokens),0),'output_tokens',coalesce(sum(a.output_tokens),0),
    'estimated_usd',round(coalesce(sum(((a.input_tokens-a.cached_input_tokens)*r.input_usd_per_million+
      a.cached_input_tokens*r.cached_input_usd_per_million+a.output_tokens*r.output_usd_per_million)/1000000),0),4))
    from public.ai_provider_usage a left join public.ai_model_rates r on r.model=a.model
    where a.workspace_id=p_workspace and a.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),
  'calls_today',coalesce((select c.calls from public.ai_budget_counters c where c.scope='workspace:'||p_workspace::text
    and c.period='day' and c.window_start=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),0),
  'members',(select coalesce(jsonb_agg(jsonb_build_object('id',wm.user_id,'email',u.email,'role',wm.role) order by wm.created_at),'[]'::jsonb)
    from public.workspace_members wm join auth.users u on u.id=wm.user_id where wm.workspace_id=p_workspace)) into data
 from public.workspaces w join public.workspace_members m on m.workspace_id=w.id and m.user_id=auth.uid()
 join public.workspace_plans p on p.workspace_id=w.id where w.id=p_workspace;
 return data;
end$$;

-- Only a blumr administrator can manually activate or pause a paid pilot.
create or replace function public.admin_set_workspace_plan(p_workspace uuid,p_plan text,p_status text,p_monthly_ai_calls integer,p_period_ends_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if p_plan not in ('beta','pilot') or p_status not in ('active','paused','expired') or
   (p_plan='pilot' and (p_monthly_ai_calls is null or p_monthly_ai_calls not between 1 and 100000)) then
  raise exception 'Invalid plan or allowance' using errcode='22023';end if;
 update public.workspace_plans set plan=p_plan,status=p_status,monthly_ai_calls=case when p_plan='beta' then null else p_monthly_ai_calls end,
  period_ends_at=p_period_ends_at,updated_at=now(),updated_by=auth.uid() where workspace_id=p_workspace;
 if not found then raise exception 'Team not found' using errcode='22023';end if;
end$$;

create or replace function public.admin_list_workspace_plans() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'owner_email',u.email,
  'plan',p.plan,'status',p.status,'monthly_ai_calls',p.monthly_ai_calls,'period_ends_at',p.period_ends_at) order by w.created_at)
 from public.workspaces w join auth.users u on u.id=w.owner_id join public.workspace_plans p on p.workspace_id=w.id),'[]'::jsonb);
end$$;

revoke all on function public.team_add_member(uuid,text,text),public.team_remove_member(uuid,uuid),public.team_rename(uuid,text),
 public.team_overview(uuid),public.admin_set_workspace_plan(uuid,text,text,integer,timestamptz) from public,anon;
grant execute on function public.team_add_member(uuid,text,text),public.team_remove_member(uuid,uuid),public.team_rename(uuid,text),
 public.team_overview(uuid),public.admin_set_workspace_plan(uuid,text,text,integer,timestamptz) to authenticated;
revoke all on function public.admin_list_workspace_plans() from public,anon;
grant execute on function public.admin_list_workspace_plans() to authenticated;

-- The existing reservation remains atomic across provider calls and retries.
create or replace function public.reserve_ai_budget(p_workspace uuid,p_actor uuid,p_input_bytes integer,p_output_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.security_limits;owner_id uuid;row record;b public.ai_budget_counters;
 plan_row public.workspace_plans;
 minute_start timestamptz:=date_trunc('minute',now());
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 month_start timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
 if p_input_bytes is null or p_input_bytes not between 1 and 800000 or p_output_tokens is null or p_output_tokens not between 1 and 8000 then
  return '{"allowed":false,"code":"input_too_large"}'::jsonb;end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=p_workspace;
 if owner_id is null or not public.has_beta_access(owner_id) or
 (p_actor is not null and (not public.has_beta_access(p_actor) or not exists(select from public.workspace_members where workspace_id=p_workspace and user_id=p_actor))) then
  return '{"allowed":false,"code":"beta_access_required"}'::jsonb;end if;
 -- One short transaction serializes all scopes. Concurrent requests cannot
 -- each observe the last available credit, including across different workers.
 perform pg_advisory_xact_lock(17200001);
 select * into plan_row from public.workspace_plans where workspace_id=p_workspace;
 if plan_row.workspace_id is null or plan_row.status<>'active' or (plan_row.period_ends_at is not null and plan_row.period_ends_at<=now()) then
  return '{"allowed":false,"code":"plan_inactive"}'::jsonb;end if;
 select * into strict l from public.security_limits where id;
 if l.ai_paused then return '{"allowed":false,"code":"ai_paused"}'::jsonb;end if;
 for row in select * from (values
  ('workspace:'||p_workspace::text,'minute',minute_start,l.workspace_minute),
  ('workspace:'||p_workspace::text,'day',day_start,l.workspace_day),
  ('user:'||coalesce(p_actor,owner_id)::text,'minute',minute_start,l.workspace_minute),
  ('user:'||coalesce(p_actor,owner_id)::text,'day',day_start,l.workspace_day),
  ('global','day',day_start,l.global_day),('global','month',month_start,l.global_month),
  ('workspace:'||p_workspace::text,'month',month_start,coalesce(plan_row.monthly_ai_calls,2147483647))
 ) as buckets(scope,period,starts,max_calls) loop
  select * into b from public.ai_budget_counters where scope=row.scope and period=row.period and window_start=row.starts;
  if coalesce(b.calls,0)>=row.max_calls or (row.scope='global' and row.period='day' and
   (coalesce(b.input_bytes,0)+p_input_bytes>l.global_input_bytes_day or coalesce(b.output_tokens,0)+p_output_tokens>l.global_output_tokens_day)) then
   return jsonb_build_object('allowed',false,'code','usage_limit','retry_after',case row.period when 'minute' then 60 when 'day' then 86400 else 2678400 end);
  end if;
 end loop;
 for row in select * from (values
  ('workspace:'||p_workspace::text,'minute',minute_start),('workspace:'||p_workspace::text,'day',day_start),
  ('user:'||coalesce(p_actor,owner_id)::text,'minute',minute_start),('user:'||coalesce(p_actor,owner_id)::text,'day',day_start),
  ('global','day',day_start),('global','month',month_start),
  ('workspace:'||p_workspace::text,'month',month_start)
 ) as buckets(scope,period,starts) loop
  insert into public.ai_budget_counters(scope,period,window_start,calls,input_bytes,output_tokens)
   values(row.scope,row.period,row.starts,1,p_input_bytes,p_output_tokens)
  on conflict(scope,period,window_start) do update set calls=public.ai_budget_counters.calls+1,
   input_bytes=public.ai_budget_counters.input_bytes+excluded.input_bytes,output_tokens=public.ai_budget_counters.output_tokens+excluded.output_tokens;
 end loop;
 delete from public.ai_budget_counters where (period='minute' and window_start<now()-interval '2 hours')
 or (period='day' and window_start<now()-interval '35 days') or (period='month' and window_start<now()-interval '400 days');
 return '{"allowed":true}'::jsonb;
end$$;

commit;
