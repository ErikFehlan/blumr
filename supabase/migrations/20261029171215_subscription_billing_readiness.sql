begin;
set local lock_timeout='5s';
-- Minimal, durable risk receipts. No webhook payload, card, email or customer PII.
create table blumr_billing_private.risk_events (
 id text primary key check(id ~ '^evt_[A-Za-z0-9]+$'),
 event_type text not null check(event_type in ('charge.refunded','charge.dispute.created','radar.early_fraud_warning.created')),
 object_id text not null,charge_id text not null check(charge_id ~ '^ch_[A-Za-z0-9]+$'),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default now(),processed_at timestamptz,
 lease_id uuid,lease_until timestamptz,next_attempt_at timestamptz not null default now(),
 attempts integer not null default 0,last_error text
);
create index billing_risk_pending on blumr_billing_private.risk_events(next_attempt_at,received_at) where processed_at is null;
create table blumr_billing_private.risk_cases (
 object_id text not null,invoice_id text not null,primary key(object_id,invoice_id),
 event_id text not null references blumr_billing_private.risk_events(id),
 user_id uuid not null references auth.users(id),customer_id text not null,subscription_id text not null,charge_id text not null,
 kind text not null check(kind in ('refund','dispute','fraud_warning')),
 amount integer not null check(amount>=0),amount_refunded integer not null check(amount_refunded between 0 and amount),
 blocks_access boolean not null,revision bigint not null default 1,
 resolution text check(resolution in ('allow','keep_hold')),reviewed_by uuid references auth.users(id),reviewed_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index billing_risk_user on blumr_billing_private.risk_cases(user_id,subscription_id);
create index billing_risk_event on blumr_billing_private.risk_cases(event_id);
create index billing_risk_reviewer on blumr_billing_private.risk_cases(reviewed_by);
create table blumr_billing_private.risk_reviews (
 id uuid primary key,object_id text not null,invoice_id text not null,revision bigint not null,
 actor_id uuid not null references auth.users(id),decision text not null check(decision in ('allow','keep_hold')),
 reason text not null check(length(reason) between 10 and 500),created_at timestamptz not null default now()
);
create index billing_risk_review_actor on blumr_billing_private.risk_reviews(actor_id);
alter table blumr_billing_private.risk_events enable row level security;
alter table blumr_billing_private.risk_cases enable row level security;
alter table blumr_billing_private.risk_reviews enable row level security;
revoke all on blumr_billing_private.risk_events,blumr_billing_private.risk_cases,blumr_billing_private.risk_reviews from public,anon,authenticated,service_role;
alter table public.subscription_accounts add column billing_hold boolean not null default false;
-- Denormalized flag is recalculated on EVERY account update: canonical renewal
-- or an admin plan change cannot accidentally clear an unresolved risk hold.
create function blumr_billing_private.account_risk_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.billing_hold:=new.source='stripe' and exists(select from blumr_billing_private.risk_cases r
  where r.user_id=new.user_id and r.blocks_access and r.resolution is distinct from 'allow');
 return new;
end$$;
revoke all on function blumr_billing_private.account_risk_guard() from public,anon,authenticated,service_role;
create trigger subscription_billing_risk_guard before insert or update on public.subscription_accounts
 for each row execute function blumr_billing_private.account_risk_guard();

create function blumr_billing_private.risk_command(p_action text,p_args jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e blumr_billing_private.risk_events;r blumr_billing_private.risk_cases;m blumr_billing_private.customers;
 x jsonb;u uuid;review blumr_billing_private.risk_reviews;
begin
 if p_action='session' then
  return jsonb_build_object('valid',exists(select from auth.sessions s join auth.users u on u.id=s.user_id
   where s.id=(p_args->>'session')::uuid and s.user_id=(p_args->>'user')::uuid and u.deleted_at is null and (s.not_after is null or s.not_after>now())));
 elsif p_action='enqueue' then
  insert into blumr_billing_private.risk_events(id,event_type,object_id,charge_id,payload_hash)
   values(p_args->>'id',p_args->>'type',p_args->>'object',p_args->>'charge',p_args->>'hash') on conflict(id) do nothing;
  select * into e from blumr_billing_private.risk_events where id=p_args->>'id';
  if e.payload_hash is distinct from p_args->>'hash' then raise exception 'Risk receipt conflict' using errcode='PT409';end if;
  return '{"queued":true}'::jsonb;
 elsif p_action='claim_next' then
  select * into e from blumr_billing_private.risk_events where processed_at is null and next_attempt_at<=now()
   and coalesce(lease_until,'-infinity')<now() order by next_attempt_at,received_at for update skip locked limit 1;
  if not found then return null;end if;
  update blumr_billing_private.risk_events set lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1 where id=e.id returning * into e;
  return to_jsonb(e);
 elsif p_action='health' then
  return jsonb_build_object('pending_risk',(select count(*) from blumr_billing_private.risk_events where processed_at is null),
   'oldest_risk_seconds',(select coalesce(max(extract(epoch from now()-received_at)),0) from blumr_billing_private.risk_events where processed_at is null),
   'pending_receipts',(select count(*) from blumr_billing_private.events where processed_at is null),
   'oldest_receipt_seconds',(select coalesce(max(extract(epoch from now()-received_at)),0) from blumr_billing_private.events where processed_at is null),
   'worker_errors',(select count(*) from blumr_billing_private.customers where last_error is not null),
   'risk_errors',(select count(*) from blumr_billing_private.risk_events where last_error is not null and processed_at is null),
   'unreviewed_risks',(select count(*) from blumr_billing_private.risk_cases where reviewed_at is null),
   'active_subscriptions',(select count(*) from blumr_billing_private.customers where subscription_status not in ('canceled','incomplete_expired')),
   'overdue_customers',(select count(*) from blumr_billing_private.customers where next_reconcile_at<now()-interval '10 minutes' and subscription_status not in ('canceled','incomplete_expired')));
 elsif p_action='review' then
  -- This is an operator-only service RPC, never a browser endpoint. The explicit
  -- actor must be a current application admin; decisions are append-only audited.
  u:=(p_args->>'actor')::uuid;
  if not exists(select from public.app_admins a join auth.users au on a.email=lower(au.email) where au.id=u and au.deleted_at is null) then raise exception 'Admin required' using errcode='42501';end if;
  select * into review from blumr_billing_private.risk_reviews where id=(p_args->>'request')::uuid;
  if found then
   if review.object_id<>p_args->>'object' or review.invoice_id<>p_args->>'invoice' or review.actor_id<>u or review.decision<>p_args->>'decision' or review.reason<>p_args->>'reason' then raise exception 'Review identity conflict' using errcode='PT409';end if;
   return jsonb_build_object('reviewed',true);
  end if;
  select * into r from blumr_billing_private.risk_cases where object_id=p_args->>'object' and invoice_id=p_args->>'invoice';
  perform 1 from public.subscription_accounts where user_id=r.user_id for update;
  select * into r from blumr_billing_private.risk_cases where object_id=p_args->>'object' and invoice_id=p_args->>'invoice' for update;
  if not found or r.revision<>(p_args->>'revision')::bigint then raise exception 'Review changed' using errcode='PT409';end if;
  insert into blumr_billing_private.risk_reviews(id,object_id,invoice_id,revision,actor_id,decision,reason)
   values((p_args->>'request')::uuid,r.object_id,r.invoice_id,r.revision,u,p_args->>'decision',p_args->>'reason');
  update blumr_billing_private.risk_cases set resolution=p_args->>'decision',reviewed_by=u,reviewed_at=now(),revision=revision+1 where object_id=r.object_id and invoice_id=r.invoice_id;
  update public.subscription_accounts set billing_hold=billing_hold where user_id=r.user_id;
  return jsonb_build_object('reviewed',true);
 end if;
 select * into e from blumr_billing_private.risk_events where id=p_args->>'id' for update;
 if e.lease_id is null or e.lease_id is distinct from (p_args->>'lease')::uuid or e.lease_until<=now() then raise exception 'Risk lease expired' using errcode='PT409';end if;
 if p_action='release' then
  update blumr_billing_private.risk_events set lease_id=null,lease_until=null,next_attempt_at=now()+interval '1 minute',last_error='retry' where id=e.id;
 elsif p_action='complete' then
  if jsonb_array_length(p_args->'cases') not between 1 and 100 then raise exception 'Unresolved risk requires retry';end if;
  for x in select * from jsonb_array_elements(p_args->'cases') loop
   select * into m from blumr_billing_private.customers where customer_id=x->>'customer' for update;
   if not found then raise exception 'Unmapped customer requires review';end if;
   -- Lock account before case changes; admission already locks this same row.
   perform 1 from public.subscription_accounts where user_id=m.user_id for update;
   insert into blumr_billing_private.risk_cases(object_id,invoice_id,event_id,user_id,customer_id,subscription_id,charge_id,kind,amount,amount_refunded,blocks_access)
    values(e.object_id,x->>'invoice',e.id,m.user_id,m.customer_id,x->>'subscription',e.charge_id,x->>'kind',(x->>'amount')::integer,(x->>'refunded')::integer,(x->>'hold')::boolean)
    on conflict(object_id,invoice_id) do update set amount_refunded=excluded.amount_refunded,
     blocks_access=excluded.blocks_access,event_id=excluded.event_id,updated_at=now(),revision=risk_cases.revision+1,
     resolution=null,reviewed_at=null,reviewed_by=null
    where risk_cases.amount_refunded<excluded.amount_refunded or risk_cases.blocks_access is distinct from excluded.blocks_access;
   update public.subscription_accounts set billing_hold=billing_hold where user_id=m.user_id;
  end loop;
  update blumr_billing_private.risk_events set processed_at=now(),lease_id=null,lease_until=null,last_error=null where id=e.id;
 else raise exception 'Unknown risk command';end if;
 return '{"ok":true}'::jsonb;
end$$;
revoke all on function blumr_billing_private.risk_command(text,jsonb) from public,anon,authenticated;
grant execute on function blumr_billing_private.risk_command(text,jsonb) to service_role;
create function public.subscription_billing_risk_command(p_action text,p_args jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select blumr_billing_private.risk_command(p_action,p_args)$$;
revoke all on function public.subscription_billing_risk_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.subscription_billing_risk_command(text,jsonb) to service_role;

create or replace function public.subscription_entitlement(p_workspace uuid,p_actor uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.subscription_accounts; p public.subscription_periods; tier_name text;
begin
 if p_actor is null or not exists(select from public.workspace_members where workspace_id=p_workspace and user_id=p_actor) then
  return '{"allowed":false,"code":"subscription_actor_required"}'::jsonb;
 end if;
 select * into a from public.subscription_accounts where user_id=p_actor;
 if a.id is null then return '{"allowed":false,"code":"subscription_required"}'::jsonb;end if;
 if a.billing_hold then return '{"allowed":false,"code":"billing_review_required"}'::jsonb;end if;
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
create or replace function public.get_my_subscription() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a public.subscription_accounts;p public.subscription_periods;plan public.subscription_plan_versions;usage jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into a from public.subscription_accounts where user_id=auth.uid();
 if not found then return null;end if;
 select * into p from public.subscription_periods where id=a.current_period_id;
 select * into plan from public.subscription_plan_versions where code=a.plan_code;
 select jsonb_object_agg(metric,jsonb_build_object('used',used,'pending',pending,'limit',maximum,'remaining',greatest(0,maximum-used-pending))) into usage from (
  select m.metric,m.maximum,count(e.id) filter(where e.state='succeeded') as used,count(e.id) filter(where e.state in ('reserved','uncertain')) as pending
  from (values('rules',p.rules_limit),('shortlist_ai',p.shortlist_ai_limit),('deep_ai',p.deep_ai_limit)) m(metric,maximum)
  left join public.subscription_evaluations e on e.account_id=a.id and e.period_id=p.id and e.metric=m.metric group by m.metric,m.maximum
 ) totals;
 return jsonb_build_object('tier',plan.tier,'status',case when a.billing_hold then 'paused' else a.status end,'period_starts_at',p.starts_at,'period_ends_at',p.ends_at,'access_until',a.access_until,'usage',usage);
end$$;
commit;
