-- Opt-in administration only. This migration grants no accounts or live access.
begin;
set local lock_timeout='5s';
create schema if not exists blumr_subscriptions_private;
revoke all on schema blumr_subscriptions_private from public,anon,authenticated;
grant usage on schema blumr_subscriptions_private to authenticated;

alter table public.subscription_accounts add column if not exists admin_revision bigint not null default 0;
create or replace function blumr_subscriptions_private.bump_revision() returns trigger
language plpgsql set search_path='' as $$begin new.admin_revision:=old.admin_revision+1;return new;end$$;
revoke all on function blumr_subscriptions_private.bump_revision() from public,anon,authenticated;
drop trigger if exists subscription_admin_revision on public.subscription_accounts;
create trigger subscription_admin_revision before update on public.subscription_accounts
 for each row execute function blumr_subscriptions_private.bump_revision();

create table if not exists public.subscription_admin_changes (
 id uuid primary key,
 account_id uuid references public.subscription_accounts(id) on delete set null,
 user_id uuid references auth.users(id) on delete set null,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null check(action in ('save','renew','pause')),
 reason text not null check(char_length(reason) between 10 and 500),
 request jsonb not null,
 before_state jsonb,
 after_state jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists subscription_admin_history on public.subscription_admin_changes(user_id,created_at desc,id);
create index if not exists subscription_admin_account on public.subscription_admin_changes(account_id);
create index if not exists subscription_admin_actor on public.subscription_admin_changes(actor_id);
alter table public.subscription_admin_changes enable row level security;
revoke all on public.subscription_admin_changes from public,anon,authenticated,service_role;
grant select on public.subscription_admin_changes to service_role;
comment on table public.subscription_admin_changes is 'Append-only through admin RPCs. Non-billable access changes; no resumes or payment credentials. Request ID makes response-loss retries idempotent.';

-- Only privileged, authorized operations call this private helper. The version
-- also includes period values, so a trusted backend period edit conflicts too.
create or replace function blumr_subscriptions_private.snapshot(p_user uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare a public.subscription_accounts;p public.subscription_periods;email text;tier_name text;usage jsonb;account jsonb;
begin
 select u.email into email from auth.users u where u.id=p_user;
 if not found then return null;end if;
 select * into a from public.subscription_accounts where user_id=p_user;
 if found then
  select * into p from public.subscription_periods where id=a.current_period_id and account_id=a.id;
  select tier into tier_name from public.subscription_plan_versions where code=a.plan_code;
  select jsonb_object_agg(metric,jsonb_build_object('used',used,'pending',pending,'limit',maximum,'remaining',greatest(0,maximum-used-pending))) into usage from (
   select m.metric,m.maximum,count(e.id) filter(where e.state='succeeded') as used,count(e.id) filter(where e.state in ('reserved','uncertain')) as pending
   from (values('rules',coalesce(p.rules_limit,0)),('shortlist_ai',coalesce(p.shortlist_ai_limit,0)),('deep_ai',coalesce(p.deep_ai_limit,0))) m(metric,maximum)
   left join public.subscription_evaluations e on e.account_id=a.id and e.period_id=p.id and e.metric=m.metric group by m.metric,m.maximum
  ) totals;
  account:=jsonb_build_object('id',a.id,'plan_code',a.plan_code,'tier',tier_name,'status',a.status,'source',a.source,'access_until',a.access_until,
   'period',case when p.id is null then null else jsonb_build_object('id',p.id,'starts_at',p.starts_at,'ends_at',p.ends_at) end,'usage',usage);
 end if;
 return jsonb_build_object('user',jsonb_build_object('id',p_user,'email',email,'eligible',public.has_beta_access(p_user)),
  'version',case when a.id is null then 'unassigned' else md5(jsonb_build_object('account',to_jsonb(a),'period',to_jsonb(p))::text) end,
  'account',account,'plans',(select jsonb_agg(jsonb_build_object('code',code,'tier',tier,'rules_limit',rules_limit,'shortlist_ai_limit',shortlist_ai_limit,'deep_ai_limit',deep_ai_limit) order by monthly_price_cents,code) from public.subscription_plan_versions),
  'history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id) from (
   select c.id,c.action,c.actor_id,u.email as actor_email,c.reason,c.before_state,c.after_state,c.created_at from public.subscription_admin_changes c left join auth.users u on u.id=c.actor_id where c.user_id=p_user order by c.created_at desc,c.id limit 20
  ) h),'[]'::jsonb));
end$$;
revoke all on function blumr_subscriptions_private.snapshot(uuid) from public,anon,authenticated;

create or replace function blumr_subscriptions_private.lookup(p_email text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare target uuid;matches uuid[];
begin
 if auth.uid() is null or public.is_app_admin() is distinct from true then raise exception 'Admin access required' using errcode='42501';end if;
 if p_email is null or char_length(trim(p_email)) not between 3 and 320 or position('@' in p_email)=0 then raise exception 'Enter the registered email address' using errcode='22023';end if;
 select array_agg(id) into matches from auth.users where lower(email)=lower(trim(p_email));
 if coalesce(cardinality(matches),0)<>1 then return null;end if;
 target:=matches[1];return blumr_subscriptions_private.snapshot(target);
end$$;
revoke all on function blumr_subscriptions_private.lookup(text) from public,anon;
grant execute on function blumr_subscriptions_private.lookup(text) to authenticated;

create or replace function blumr_subscriptions_private.change_access(p_request uuid,p_user uuid,p_expected_version text,
 p_action text,p_plan text,p_status text,p_expires timestamptz,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.subscription_accounts;p public.subscription_periods;plan public.subscription_plan_versions;
 previous public.subscription_admin_changes;before_view jsonb;after_view jsonb;identity jsonb;period_id uuid;actor uuid:=auth.uid();
begin
 if actor is null or public.is_app_admin() is distinct from true then raise exception 'Admin access required' using errcode='42501';end if;
 if p_request is null or p_user is null or p_expected_version is null or char_length(p_expected_version) not between 1 and 64
  or p_action is null or p_action not in ('save','renew','pause') or p_reason is null or char_length(trim(p_reason)) not between 10 and 500 then
  raise exception 'Choose an account and action, and explain the change in 10–500 characters' using errcode='22023';end if;
 identity:=jsonb_build_object('user',p_user,'version',p_expected_version,'action',p_action,'plan',p_plan,'status',p_status,'expires',extract(epoch from p_expires),'reason',trim(p_reason));
 -- Same request first, then subscriber, then the same account/period locks used
 -- by evaluation admission. Concurrent first grants cannot create extra periods.
 perform pg_advisory_xact_lock(hashtextextended('subscription-request:'||p_request::text,0));
 select * into previous from public.subscription_admin_changes where id=p_request;
 if found then
  if previous.actor_id is distinct from actor or previous.request is distinct from identity then raise exception 'This request was already used for a different change' using errcode='PT409';end if;
  return jsonb_build_object('replayed',true,'change_id',p_request,'snapshot',blumr_subscriptions_private.snapshot(p_user));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('subscription-admin:'||p_user::text,0));
 select * into a from public.subscription_accounts where user_id=p_user for update;
 if a.id is not null then select * into p from public.subscription_periods where id=a.current_period_id and account_id=a.id for update;end if;
 before_view:=blumr_subscriptions_private.snapshot(p_user);
 if before_view is null then raise exception 'Registered account not found' using errcode='22023';end if;
 if before_view->>'version' is distinct from p_expected_version then raise exception 'This subscription changed. Find the account again before saving.' using errcode='PT409';end if;
 if a.id is not null and a.source<>'manual' then raise exception 'Billing-managed subscriptions cannot be changed here' using errcode='22023';end if;
 if p_action='pause' then
  if a.id is null or p_plan is not null or p_status is not null or p_expires is not null then raise exception 'Choose an existing manual subscription to pause' using errcode='22023';end if;
  update public.subscription_accounts set status='paused' where id=a.id;
 else
  if public.has_beta_access(p_user) is distinct from true then raise exception 'This registered account must have verified, approved access before a plan can be granted' using errcode='22023';end if;
  if p_status is null or p_status not in ('beta','trialing','complimentary') or p_expires is null or not isfinite(p_expires) or p_expires<=now() or p_expires>now()+interval '366 days' then
   raise exception 'Choose beta, trial, or complimentary access with an end time within the next year' using errcode='22023';end if;
  select * into plan from public.subscription_plan_versions where code=p_plan;
  if not found then raise exception 'Choose an available plan' using errcode='22023';end if;
  if a.id is not null then select * into p from public.subscription_periods where id=a.current_period_id and account_id=a.id for update;end if;
  if p_action='renew' and (a.id is null or p.id is null or p.ends_at>now()) then raise exception 'A new allowance period is available only after the current period ends' using errcode='22023';end if;
  if p_action='save' and p.id is not null and (p.starts_at>now() or p.ends_at<=now()) then raise exception 'The allowance period is inactive. Renew expired access instead.' using errcode='22023';end if;
  if a.id is null then
   insert into public.subscription_accounts(user_id,plan_code,status,source,access_until) values(p_user,p_plan,p_status,'manual',p_expires) returning * into a;
  end if;
  if p.id is null or p_action='renew' then
   insert into public.subscription_periods(account_id,starts_at,ends_at,rules_limit,shortlist_ai_limit,deep_ai_limit)
    values(a.id,now(),p_expires,plan.rules_limit,plan.shortlist_ai_limit,plan.deep_ai_limit) returning id into period_id;
  else
   period_id:=p.id;
   update public.subscription_periods set ends_at=p_expires,rules_limit=plan.rules_limit,shortlist_ai_limit=plan.shortlist_ai_limit,deep_ai_limit=plan.deep_ai_limit where id=p.id;
  end if;
  update public.subscription_accounts set plan_code=p_plan,status=p_status,access_until=p_expires,current_period_id=period_id where id=a.id;
 end if;
 after_view:=blumr_subscriptions_private.snapshot(p_user);
 insert into public.subscription_admin_changes(id,account_id,user_id,actor_id,action,reason,request,before_state,after_state)
  values(p_request,a.id,p_user,actor,p_action,trim(p_reason),identity,before_view->'account',after_view->'account');
 return jsonb_build_object('replayed',false,'change_id',p_request,'snapshot',blumr_subscriptions_private.snapshot(p_user));
end$$;
revoke all on function blumr_subscriptions_private.change_access(uuid,uuid,text,text,text,text,timestamptz,text) from public,anon;
grant execute on function blumr_subscriptions_private.change_access(uuid,uuid,text,text,text,text,timestamptz,text) to authenticated;

-- The API wrappers are invoker functions; private implementations verify the
-- current database admin role on every lookup, mutation, and replay.
create or replace function public.admin_get_subscription(p_email text) returns jsonb
language sql volatile security invoker set search_path='' as $$select blumr_subscriptions_private.lookup(p_email)$$;
create or replace function public.admin_change_subscription(p_request uuid,p_user uuid,p_expected_version text,
 p_action text,p_plan text,p_status text,p_expires timestamptz,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select blumr_subscriptions_private.change_access(p_request,p_user,p_expected_version,p_action,p_plan,p_status,p_expires,p_reason)$$;
revoke all on function public.admin_get_subscription(text),public.admin_change_subscription(uuid,uuid,text,text,text,text,timestamptz,text) from public,anon;
grant execute on function public.admin_get_subscription(text),public.admin_change_subscription(uuid,uuid,text,text,text,text,timestamptz,text) to authenticated;
commit;
