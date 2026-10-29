\set ON_ERROR_STOP on
\ir subscription-billing.sql
set constraints all immediate;
alter table auth.users add column email text,add column deleted_at timestamptz;
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create table public.app_admins(email text primary key);
update auth.users set email='operator@example.invalid' where id='00000000-0000-0000-0000-000000000003';
insert into public.app_admins values('operator@example.invalid');
\ir ../supabase/migrations/20261029171215_subscription_billing_readiness.sql
update public.subscription_accounts set status='active' where user_id='00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin
 begin perform subscription_billing_risk_command('health');raise exception 'Browser reached risk service';exception when insufficient_privilege then null;end;
 begin select * from blumr_billing_private.risk_cases;raise exception 'Risk cases exposed';exception when insufficient_privilege then null;end;
end$$;
reset role;
insert into auth.sessions(id,user_id) values('90000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
set role service_role;
do $$declare e jsonb;u uuid:='00000000-0000-0000-0000-000000000001';args jsonb;request uuid:=gen_random_uuid();begin
 if subscription_billing_risk_command('session',jsonb_build_object('user',u,'session','90000000-0000-0000-0000-000000000001'))->>'valid'<>'true' then raise exception 'Valid session denied';end if;
 if subscription_billing_risk_command('session',jsonb_build_object('user','00000000-0000-0000-0000-000000000002','session','90000000-0000-0000-0000-000000000001'))->>'valid'<>'false' then raise exception 'Cross-user session allowed';end if;
 args:=jsonb_build_object('id','evt_risk','type','charge.refunded','object','ch_risk','charge','ch_risk','hash',repeat('a',64));
 perform subscription_billing_risk_command('enqueue',args);perform subscription_billing_risk_command('enqueue',args);
 begin perform subscription_billing_risk_command('enqueue',args||jsonb_build_object('hash',repeat('b',64)));raise exception 'Conflicting risk accepted';exception when sqlstate 'PT409' then null;end;
 e:=subscription_billing_risk_command('claim_next');
 if subscription_billing_risk_command('claim_next') is not null then raise exception 'Risk lease stolen';end if;
 args:=jsonb_build_object('id','evt_risk','lease',e->>'lease_id','cases',jsonb_build_array(jsonb_build_object('customer','cus_first','invoice','in_risk','subscription','sub_first','kind','refund','amount',2900,'refunded',2900,'hold',true)));
 perform subscription_billing_risk_command('complete',args);
 if subscription_entitlement('10000000-0000-0000-0000-000000000002',u)->>'code'<>'billing_review_required' then raise exception 'Refund hold did not deny access: %, %',subscription_entitlement('10000000-0000-0000-0000-000000000002',u),(select to_jsonb(a) from public.subscription_accounts a where user_id=u);end if;
 -- Canonical updates cannot clear the separate hold or reset the period.
 update public.subscription_accounts set status='active',billing_hold=false where user_id=u;
 if subscription_entitlement('10000000-0000-0000-0000-000000000002',u)->>'code'<>'billing_review_required' then raise exception 'Reconciliation cleared hold';end if;
 args:=jsonb_build_object('object','ch_risk','invoice','in_risk','revision',1,'request',request,'actor',u,'decision','allow','reason','Reviewed sandbox refund and retained access');
 begin perform subscription_billing_risk_command('review',args);raise exception 'Nonadmin reviewed';exception when insufficient_privilege then null;end;
 args:=args||'{"actor":"00000000-0000-0000-0000-000000000003"}';
 perform subscription_billing_risk_command('review',args);perform subscription_billing_risk_command('review',args);
 if subscription_entitlement('10000000-0000-0000-0000-000000000002',u)->>'allowed'<>'true' then raise exception 'Reviewed access not restored';end if;
 begin perform subscription_billing_risk_command('review',args||jsonb_build_object('request',gen_random_uuid()));raise exception 'Stale review accepted';exception when sqlstate 'PT409' then null;end;
 if subscription_billing_risk_command('health')->>'pending_risk'<>'0' then raise exception 'Risk receipt remains pending';end if;
end$$;
reset role;
delete from auth.sessions;
set role service_role;
do $$begin
 if subscription_billing_risk_command('session','{"user":"00000000-0000-0000-0000-000000000001","session":"90000000-0000-0000-0000-000000000001"}')->>'valid'<>'false' then raise exception 'Revoked session allowed';end if;
end$$;
reset role;
do $$begin
 if (select count(*) from blumr_billing_private.risk_reviews)<>1 then raise exception 'Review replay duplicated audit';end if;
 if (select count(*) from blumr_billing_private.risk_events)<>1 then raise exception 'Receipt replay duplicated';end if;
end$$;
select 'PASS: durable risk queue, service-only review, hold enforcement, audit replay and revoked-session admission';
