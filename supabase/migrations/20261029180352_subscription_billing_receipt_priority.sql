begin;
set local lock_timeout='5s';
-- Fresh receipts bypass periodic polling delay, including those arriving during
-- a lease. Provider-error backoff and fencing still apply. Preserve all grants.
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
    and (b.next_reconcile_at<=now() or (b.last_error is null and exists(select from blumr_billing_private.events e where e.customer_id=b.customer_id and e.processed_at is null)))
    and (exists(select from blumr_billing_private.events e where e.customer_id=b.customer_id and e.processed_at is null)
     or b.subscription_id is not null or b.checkout_id is not null)
   order by exists(select from blumr_billing_private.events e where e.customer_id=b.customer_id and e.processed_at is null) desc,b.next_reconcile_at,b.user_id for update skip locked limit 1;
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
commit;
