begin;
-- Additive sandbox infrastructure. No users are enrolled and no scheduler is enabled.
create schema if not exists blumr_billing_private;
revoke all on schema blumr_billing_private from public,anon,authenticated;
grant usage on schema blumr_billing_private to service_role;
create table if not exists blumr_billing_private.customers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 provision_id uuid not null default gen_random_uuid(),provision_started_at timestamptz,
 customer_id text unique check(customer_id ~ '^cus_[A-Za-z0-9]+$'),
 lease_id uuid,lease_until timestamptz,lease_events text[] not null default '{}',
 checkout_id uuid,checkout_tier text check(checkout_tier in ('basic','advanced','pro')),
 checkout_started_at timestamptz,checkout_expires_at timestamptz,checkout_session text,checkout_url text,
 subscription_id text,subscription_status text,period_start timestamptz,
 cancel_at_period_end boolean not null default false,
 reconciled_at timestamptz,next_reconcile_at timestamptz not null default now(),
 last_error text,created_at timestamptz not null default now()
);
create table if not exists blumr_billing_private.events (
 id text primary key check(id ~ '^evt_[A-Za-z0-9]+$'),
 customer_id text not null check(customer_id ~ '^cus_[A-Za-z0-9]+$'),
 event_type text not null,payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now(),processed_at timestamptz
);
create index if not exists billing_pending_events on blumr_billing_private.events(customer_id,received_at) where processed_at is null;
alter table blumr_billing_private.customers enable row level security;
alter table blumr_billing_private.events enable row level security;
revoke all on all tables in schema blumr_billing_private from public,anon,authenticated,service_role;

-- One service-only boundary. Customer ownership always comes from verified Auth
-- (interactive requests) or our customer mapping (the queue), never Stripe metadata.
create or replace function blumr_billing_private.command(p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c blumr_billing_private.customers; receipt blumr_billing_private.events;
 u uuid; a public.subscription_accounts; p public.subscription_periods;
 plan public.subscription_plan_versions; start_at timestamptz; end_at timestamptz;
 new_period uuid; state text; sid text; ids text[];
begin
 if p_action='enqueue' then
  insert into blumr_billing_private.events(id,customer_id,event_type,payload_hash)
   values(p_args->>'id',p_args->>'customer',p_args->>'type',p_args->>'hash') on conflict(id) do nothing;
  select * into receipt from blumr_billing_private.events where id=p_args->>'id';
  if receipt.payload_hash is distinct from p_args->>'hash' then raise exception 'Event identity conflict' using errcode='PT409';end if;
  return jsonb_build_object('queued',true);
 elsif p_action='claim_next' then
  select * into c from blumr_billing_private.customers b
   where b.customer_id is not null and coalesce(b.lease_until,'-infinity')<now()
    and not exists(select from public.account_deletions d where d.user_id=b.user_id)
    and b.next_reconcile_at<=now() and (exists(select from blumr_billing_private.events e where e.customer_id=b.customer_id and e.processed_at is null)
     or b.subscription_id is not null or b.checkout_id is not null)
   order by b.next_reconcile_at,b.user_id for update skip locked limit 1;
  if not found then return null;end if;
 else
  u:=(p_args->>'user')::uuid;
  if p_action in ('status','claim') then
   perform 1 from auth.users where id=u for update;
   if not found or exists(select from public.account_deletions where user_id=u) then raise exception 'Account unavailable' using errcode='42501';end if;
   if p_action='claim' and not public.has_beta_access(u) and coalesce(p_args->>'purpose','')<>'portal' then raise exception 'Account unavailable' using errcode='42501';end if;
   if p_action='claim' then insert into blumr_billing_private.customers(user_id) values(u) on conflict do nothing;end if;
  end if;
  select * into c from blumr_billing_private.customers where user_id=u for update;
  if p_action='status' then
   return jsonb_build_object('eligible',public.has_beta_access(u),'customer',c.customer_id is not null,
    'subscription',c.subscription_id is not null and c.subscription_status not in ('canceled','incomplete_expired'),
    'pending',c.checkout_id is not null,'pending_tier',c.checkout_tier,'cancel_at_period_end',coalesce(c.cancel_at_period_end,false),'reconciled_at',c.reconciled_at);
  end if;
  if c.user_id is null then raise exception 'Billing unavailable' using errcode='42501';end if;
 end if;
 if p_action in ('claim','claim_next') then
  if c.lease_until>now() then raise exception 'Billing is updating. Try again shortly.' using errcode='PT409';end if;
  select coalesce(array_agg(id),'{}') into ids from (select id from blumr_billing_private.events where customer_id=c.customer_id and processed_at is null order by received_at limit 100) q;
  update blumr_billing_private.customers set lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',lease_events=ids,
   provision_started_at=coalesce(provision_started_at,now()) where user_id=c.user_id returning * into c;
  return to_jsonb(c);
 end if;
 if c.lease_id is distinct from (p_args->>'lease')::uuid or c.lease_until<=now() or c.lease_until is null then
  raise exception 'Billing request expired. Try again.' using errcode='PT409';end if;
 if p_action='customer' then
  if c.customer_id is not null and c.customer_id<>p_args->>'customer' then raise exception 'Customer identity conflict';end if;
  update blumr_billing_private.customers set customer_id=p_args->>'customer' where user_id=c.user_id returning * into c;
 elsif p_action='checkout_start' then
  if not public.has_beta_access(c.user_id) then raise exception 'Account unavailable' using errcode='42501';end if;
  if c.checkout_id is not null then
   if c.checkout_tier<>p_args->>'tier' then raise exception 'Finish or let the existing checkout expire before choosing another plan.' using errcode='PT409';end if;
  else
   update blumr_billing_private.customers set checkout_id=gen_random_uuid(),checkout_tier=p_args->>'tier',checkout_started_at=now(),
    checkout_expires_at=date_trunc('second',now()+interval '1 hour'),checkout_session=null,checkout_url=null where user_id=c.user_id returning * into c;
  end if;
 elsif p_action='checkout_save' then
  if c.checkout_id is null then raise exception 'Checkout unavailable';end if;
  update blumr_billing_private.customers set checkout_session=p_args->>'session',checkout_url=p_args->>'url' where user_id=c.user_id returning * into c;
 elsif p_action='checkout_close' then
  update blumr_billing_private.customers set checkout_id=null,checkout_tier=null,checkout_session=null,checkout_url=null,
   checkout_started_at=null,checkout_expires_at=null where user_id=c.user_id returning * into c;
 elsif p_action='apply' then
  state:=p_args->>'status';sid:=p_args->>'subscription';
  if state not in ('active','past_due','unpaid','paused','canceled','incomplete','incomplete_expired','trialing') or sid !~ '^sub_[A-Za-z0-9]+$' or state is null or sid is null then raise exception 'Invalid subscription state';end if;
  select * into a from public.subscription_accounts where user_id=c.user_id for update;
  if state='active' then
   if p_args->>'paid' is distinct from 'true' then raise exception 'Paid invoice required';end if;
   select * into plan from public.subscription_plan_versions where code=p_args->>'plan';
   start_at:=(p_args->>'start')::timestamptz;end_at:=(p_args->>'end')::timestamptz;
   if plan.code is null or not isfinite(start_at) or not isfinite(end_at) or start_at is null or end_at is null or end_at<=start_at or start_at>now()+interval '5 minutes' then raise exception 'Invalid paid period';end if;
   if c.subscription_id=sid and c.period_start>start_at then raise exception 'Older period rejected';end if;
   if a.id is null then
    insert into public.subscription_accounts(user_id,plan_code,status,source) values(c.user_id,plan.code,'active','stripe') returning * into a;
   end if;
   select * into p from public.subscription_periods where id=a.current_period_id for update;
   -- A paid conversion starts a paid period; historical manual usage stays intact.
   -- A same-subscription update never refreshes its allowance or overlaps periods.
   if a.source='stripe' and c.subscription_id=sid and p.id is not null then
    if start_at=p.starts_at then
     if end_at<>p.ends_at then raise exception 'Billing anchor change requires review';end if;
     new_period:=p.id;
    elsif start_at<p.ends_at then raise exception 'Overlapping billing period requires review';end if;
   end if;
   if new_period is null then
    insert into public.subscription_periods(account_id,starts_at,ends_at,rules_limit,shortlist_ai_limit,deep_ai_limit)
     values(a.id,start_at,end_at,plan.rules_limit,plan.shortlist_ai_limit,plan.deep_ai_limit)
     on conflict(account_id,starts_at) do nothing returning id into new_period;
    if new_period is null then raise exception 'Period identity requires review';end if;
   else
    update public.subscription_periods set rules_limit=plan.rules_limit,shortlist_ai_limit=plan.shortlist_ai_limit,deep_ai_limit=plan.deep_ai_limit where id=new_period;
   end if;
   update public.subscription_accounts set source='stripe',status='active',plan_code=plan.code,current_period_id=new_period,access_until=end_at where id=a.id;
  elsif a.source='stripe' then
   update public.subscription_accounts set status=case when state in ('canceled','incomplete_expired') then 'canceled' when state in ('incomplete','trialing') then 'paused' else state end where id=a.id;
  end if;
  update blumr_billing_private.customers set subscription_id=sid,subscription_status=state,
   period_start=case when state='active' then start_at else period_start end,
   cancel_at_period_end=coalesce((p_args->>'cancel_at_period_end')::boolean,false) where user_id=c.user_id returning * into c;
 elsif p_action='finish' then
  update blumr_billing_private.events set processed_at=now() where id=any(c.lease_events);
  update blumr_billing_private.customers set lease_id=null,lease_until=null,lease_events='{}',reconciled_at=now(),next_reconcile_at=now()+interval '5 minutes',last_error=null where user_id=c.user_id;
  return jsonb_build_object('complete',true);
 elsif p_action='release' then
  update blumr_billing_private.customers set lease_id=null,lease_until=null,lease_events='{}',
   next_reconcile_at=now()+interval '1 minute',last_error=case when p_args->>'error'='retry' then 'retry' else last_error end where user_id=c.user_id;
  return jsonb_build_object('released',true);
 else raise exception 'Unknown billing command' using errcode='22023';end if;
 return to_jsonb(c);
end$$;
revoke all on function blumr_billing_private.command(text,jsonb) from public,anon,authenticated;
grant execute on function blumr_billing_private.command(text,jsonb) to service_role;
create or replace function public.subscription_billing_command(p_action text,p_args jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select blumr_billing_private.command(p_action,p_args)$$;
revoke all on function public.subscription_billing_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.subscription_billing_command(text,jsonb) to service_role;

-- Runs before the existing deletion queue starts removing Storage or Auth data.
create or replace function blumr_billing_private.guard_deletion() returns trigger
language plpgsql security definer set search_path='' as $$
declare c blumr_billing_private.customers;
begin
 select * into c from blumr_billing_private.customers where user_id=new.user_id for update;
 if c.lease_until>now() or c.checkout_id is not null or (c.subscription_id is not null and c.subscription_status not in ('canceled','incomplete_expired')) then
  raise exception 'Cancel your subscription in billing and wait for the paid period and any open checkout to end before deleting your account.' using errcode='PT409';end if;
 return new;
end$$;
revoke all on function blumr_billing_private.guard_deletion() from public,anon,authenticated,service_role;
drop trigger if exists subscription_billing_deletion_guard on public.account_deletions;
create trigger subscription_billing_deletion_guard before insert on public.account_deletions for each row execute function blumr_billing_private.guard_deletion();
commit;
