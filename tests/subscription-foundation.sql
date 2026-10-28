\set ON_ERROR_STOP on
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
grant usage on schema auth to authenticated,service_role;
create table public.workspaces(id uuid primary key);
create table public.workspace_members(workspace_id uuid references workspaces,user_id uuid references auth.users,primary key(workspace_id,user_id));
grant select on workspace_members to service_role;
\ir ../supabase/migrations/20261028134006_subscription_foundation.sql

insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
insert into workspaces values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into workspace_members values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
do $$begin
 if exists(select from subscription_accounts) then raise exception 'Existing users auto-enrolled';end if;
 if subscription_entitlement('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003')->>'code'<>'subscription_required' then raise exception 'Missing subscription admitted';end if;
end$$;
insert into subscription_accounts(id,user_id,plan_code,status,source) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','basic-v1','complimentary','manual'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','advanced-v1','trialing','manual');
insert into subscription_periods(id,account_id,starts_at,ends_at,rules_limit,shortlist_ai_limit,deep_ai_limit) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now()-interval '1 day',now()+interval '29 days',2,0,0),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',now()-interval '1 day',now()+interval '29 days',1000,100,0);
update subscription_accounts a set current_period_id=p.id from subscription_periods p where p.account_id=a.id;

set role service_role;
do $$declare w uuid:='10000000-0000-0000-0000-000000000001';u uuid:='00000000-0000-0000-0000-000000000001';
 attempt uuid:=gen_random_uuid();next_attempt uuid:=gen_random_uuid();r jsonb;id uuid;begin
 if subscription_entitlement(w,null)->>'code'<>'subscription_actor_required' then raise exception 'Actorless work admitted';end if;
 if subscription_entitlement(w,'00000000-0000-0000-0000-000000000002')->>'code'<>'subscription_actor_required' then raise exception 'Foreign user admitted';end if;
 if subscription_entitlement(w,u)->>'tier'<>'basic' then raise exception 'Basic lookup failed';end if;
 if reserve_subscription_evaluation(w,u,'deep_ai',repeat('a',64),attempt)->>'code'<>'subscription_feature_unavailable' then raise exception 'Basic admitted deep AI';end if;
 if reserve_subscription_evaluation(w,u,'shortlist_ai',repeat('a',64),attempt)->>'code'<>'subscription_feature_unavailable' then raise exception 'Basic admitted shortlist AI';end if;
 r:=reserve_subscription_evaluation(w,u,'rules',repeat('a',64),attempt);id:=(r->>'reservation_id')::uuid;
 if r->>'state'<>'reserved' or r->>'remaining'<>'1' then raise exception 'First reservation failed';end if;
 if reserve_subscription_evaluation(w,u,'rules',repeat('a',64),attempt)->>'allowed'<>'true' then raise exception 'Lost reservation response not replayable';end if;
 if reserve_subscription_evaluation(w,u,'rules',repeat('a',64),next_attempt)->>'state'<>'in_progress' then raise exception 'Concurrent duplicate owned work';end if;
 if not settle_subscription_evaluation(id,attempt,'failed') or not settle_subscription_evaluation(id,attempt,'failed') then raise exception 'Failure settlement not idempotent';end if;
 if reserve_subscription_evaluation(w,u,'rules',repeat('a',64),attempt)->>'code'<>'new_attempt_required' then raise exception 'Failed attempt silently restarted';end if;
 r:=reserve_subscription_evaluation(w,u,'rules',repeat('a',64),next_attempt);
 if r->>'remaining'<>'1' then raise exception 'Failure consumed allowance';end if;
 if settle_subscription_evaluation(id,attempt,'succeeded',gen_random_uuid()) then raise exception 'Stale attempt settled new work';end if;
 if not settle_subscription_evaluation(id,next_attempt,'succeeded','40000000-0000-0000-0000-000000000001') then raise exception 'Success not settled';end if;
 if settle_subscription_evaluation(id,next_attempt,'canceled') then raise exception 'Success refunded';end if;
 if reserve_subscription_evaluation(w,u,'rules',repeat('a',64),gen_random_uuid())->>'state'<>'cached' then raise exception 'Completed work charged again';end if;
 -- Same user, another workspace: shared allowance, not a second free pool.
 r:=reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002',u,'rules',repeat('b',64),attempt);id:=(r->>'reservation_id')::uuid;
 if r->>'remaining'<>'0' then raise exception 'Workspace multiplied allowance';end if;
 if not settle_subscription_evaluation(id,attempt,'uncertain') then raise exception 'Uncertain attempt not held';end if;
 if reserve_subscription_evaluation(w,u,'rules',repeat('c',64),gen_random_uuid())->>'code'<>'evaluation_allowance_exhausted' then raise exception 'Uncertain work released capacity';end if;
 if reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002',u,'rules',repeat('b',64),attempt)->>'allowed'<>'false' then raise exception 'Uncertain provider retried';end if;
 if not settle_subscription_evaluation(id,attempt,'canceled') then raise exception 'Reconciliation failed';end if;
 if (select count(*) from subscription_evaluation_events where event='failed')<>1 then raise exception 'Failure history lost on retry';end if;
end$$;
reset role;

-- Read policies enforce the subscriber, even inside a shared workspace.
set test.actor='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$begin
 if (select count(*) from subscription_accounts)<>1 or exists(select from subscription_evaluations) or exists(select from subscription_evaluation_events) then raise exception 'Subscription privacy failed';end if;
 if (select count(*) from subscription_periods)<>1 then raise exception 'Period privacy failed';end if;
 begin update subscription_accounts set plan_code='pro-v1';raise exception 'Self-upgrade allowed';exception when insufficient_privilege then null;end;
 begin perform reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002',auth.uid(),'rules',repeat('a',64),gen_random_uuid());raise exception 'Client supplied evaluation admitted';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','subscription_entitlement(uuid,uuid)','execute') or has_function_privilege('authenticated','settle_subscription_evaluation(uuid,uuid,text,uuid)','execute') then raise exception 'Accounting RPC exposed';end if;
end$$;
reset role;

-- Plan/period revocation is read fresh; no stale JWT entitlement.
update subscription_accounts set status='past_due' where user_id='00000000-0000-0000-0000-000000000001';
do $$begin
 if subscription_entitlement('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')->>'code'<>'subscription_inactive' then raise exception 'Past due admitted';end if;
end$$;
update subscription_accounts set status='complimentary',access_until=now()-interval '1 second' where user_id='00000000-0000-0000-0000-000000000001';
do $$begin
 if subscription_entitlement('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')->>'code'<>'subscription_inactive' then raise exception 'Expired grant admitted';end if;
end$$;
update subscription_accounts set access_until=null;
update subscription_periods set ends_at=now() where id='30000000-0000-0000-0000-000000000001';
do $$begin
 if subscription_entitlement('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001')->>'code'<>'subscription_period_inactive' then raise exception 'Expired period admitted';end if;
end$$;
insert into subscription_periods(id,account_id,starts_at,ends_at,rules_limit,shortlist_ai_limit,deep_ai_limit) values
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',now(),now()+interval '1 month',1,0,0);
update subscription_accounts set current_period_id='30000000-0000-0000-0000-000000000003' where id='20000000-0000-0000-0000-000000000001';
set role service_role;
do $$declare r jsonb;begin
 r:=reserve_subscription_evaluation('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','rules',repeat('a',64),gen_random_uuid());
 if r->>'state'<>'cached' then raise exception 'Renewal charged unchanged result';end if;
 r:=reserve_subscription_evaluation('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','rules',repeat('c',64),gen_random_uuid());
 if r->>'remaining'<>'0' then raise exception 'New period allowance not available';end if;
end$$;
reset role;

-- Representative allowance sizes. No providers or candidate accuracy claims.
do $$declare size integer;i integer;r jsonb;attempt uuid;w uuid:='10000000-0000-0000-0000-000000000002';u uuid:='00000000-0000-0000-0000-000000000002';begin
 foreach size in array array[1,20,100,500,1000] loop
  delete from subscription_evaluations where account_id='20000000-0000-0000-0000-000000000002';
  update subscription_periods set rules_limit=size where account_id='20000000-0000-0000-0000-000000000002';
  for i in 1..size loop
   attempt:=gen_random_uuid();r:=reserve_subscription_evaluation(w,u,'rules',lpad(to_hex(i),64,'0'),attempt);
   if r->>'allowed'<>'true' then raise exception 'Allowance denied at % of %',i,size;end if;
   perform settle_subscription_evaluation((r->>'reservation_id')::uuid,attempt,'succeeded',gen_random_uuid());
  end loop;
  if reserve_subscription_evaluation(w,u,'rules',repeat('f',64),gen_random_uuid())->>'code'<>'evaluation_allowance_exhausted' then raise exception 'Allowance exceeded for %',size;end if;
 end loop;
 if reserve_subscription_evaluation(w,u,'deep_ai',repeat('e',64),gen_random_uuid())->>'code'<>'subscription_feature_unavailable' then raise exception 'Advanced used deep allowance';end if;
end$$;
-- Catalog caps are per-user commercial policy, not provider token budgets.
update subscription_accounts set plan_code='pro-v1' where id='20000000-0000-0000-0000-000000000002';
update subscription_periods set deep_ai_limit=500 where account_id='20000000-0000-0000-0000-000000000002';
set role service_role;
do $$declare i integer;r jsonb;begin
 for i in 1..500 loop
  r:=reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','deep_ai',lpad(to_hex(i),64,'0'),gen_random_uuid());
  if r->>'allowed' is distinct from 'true' then raise exception 'Pro denied deep capacity';end if;
 end loop;
 if reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','deep_ai',repeat('f',64),gen_random_uuid())->>'code' is distinct from 'evaluation_allowance_exhausted' then raise exception 'Pro exceeded 500 deep evaluations';end if;
end$$;
reset role;
update subscription_accounts set plan_code='basic-v1' where id='20000000-0000-0000-0000-000000000002';
do $$begin
 if reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','deep_ai',repeat('f',64),gen_random_uuid())->>'code' is distinct from 'subscription_feature_unavailable' then raise exception 'Downgrade retained AI capability';end if;
 if (select count(*) from subscription_evaluations where account_id='20000000-0000-0000-0000-000000000002')<>1500 then raise exception 'Plan change reset usage';end if;
 begin
  update subscription_accounts set current_period_id='30000000-0000-0000-0000-000000000001' where id='20000000-0000-0000-0000-000000000002';
  set constraints subscription_current_period immediate;
  raise exception 'Foreign account period accepted';
 exception when foreign_key_violation then null;end;
end$$;
update subscription_accounts set plan_code='advanced-v1' where id='20000000-0000-0000-0000-000000000002';
do $$begin
 if (select rules_limit from subscription_plan_versions where tier='basic')<>1000 or (select shortlist_ai_limit from subscription_plan_versions where tier='advanced')<>100 or (select deep_ai_limit from subscription_plan_versions where tier='pro')<>500 then raise exception 'Catalog mismatch';end if;
end$$;

-- Deleting a workspace cannot refund completed evaluation usage.
delete from workspace_members where workspace_id='10000000-0000-0000-0000-000000000001';
delete from workspaces where id='10000000-0000-0000-0000-000000000001';
do $$begin
 if (select count(*) from subscription_evaluations where account_id='20000000-0000-0000-0000-000000000001' and state='succeeded')<>1 then raise exception 'Workspace deletion refunded use';end if;
end$$;
