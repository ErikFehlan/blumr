-- Match the canonical Auth UUID and active-access check used by is_app_admin.
-- A recycled or changed email cannot confer operator authority.
begin;
set local lock_timeout='5s';
create or replace function blumr_billing_private.risk_command(p_action text,p_args jsonb)
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
  if not exists(select from public.app_admins a join auth.users au on a.user_id=au.id where au.id=u and au.deleted_at is null and public.has_beta_access(au.id)) then raise exception 'Admin required' using errcode='42501';end if;
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

commit;
