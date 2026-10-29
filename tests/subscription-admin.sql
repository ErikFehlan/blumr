\set ON_ERROR_STOP on
\ir subscription-foundation.sql
set constraints all immediate;
-- Local identity fixtures model the existing verified beta/app-admin gate.
alter table auth.users add column email text,add column approved boolean not null default true;
update auth.users set email=case id when '00000000-0000-0000-0000-000000000001' then 'one@example.test' when '00000000-0000-0000-0000-000000000002' then 'two@example.test' else 'new@example.test' end;
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000004','admin@example.test'),('00000000-0000-0000-0000-000000000005','other-admin@example.test');
create table public.app_admins(user_id uuid primary key references auth.users);
insert into app_admins values('00000000-0000-0000-0000-000000000004'),('00000000-0000-0000-0000-000000000005');
create function public.has_beta_access(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select from auth.users where id=p_user and approved)$$;
create function public.is_app_admin() returns boolean language sql stable security definer set search_path='' as $$select public.has_beta_access(auth.uid()) and exists(select from public.app_admins where user_id=auth.uid())$$;
\ir ../supabase/migrations/20261028155821_subscription_admin_grants.sql
\ir ../supabase/migrations/20261028155821_subscription_admin_grants.sql
set test.actor='00000000-0000-0000-0000-000000000003';
set role authenticated;
do $$begin
 begin perform admin_get_subscription('admin@example.test');raise exception 'Regular user read admin data';exception when insufficient_privilege then null;end;
 begin perform admin_change_subscription(null,null,null,null,null,null,null,null);raise exception 'Regular user reached validation';exception when insufficient_privilege then null;end;
 begin perform blumr_subscriptions_private.lookup('new@example.test');raise exception 'Private schema bypassed authorization';exception when insufficient_privilege then null;end;
 begin perform blumr_subscriptions_private.snapshot(auth.uid());raise exception 'Private helper was exposed';exception when insufficient_privilege then null;end;
 begin select * from subscription_admin_changes;raise exception 'Audit data exposed directly';exception when insufficient_privilege then null;end;
end$$;
reset role;
set test.actor='00000000-0000-0000-0000-000000000004';
set role authenticated;
do $$declare s jsonb;r jsonb;again jsonb;request uuid:=gen_random_uuid();u uuid:='00000000-0000-0000-0000-000000000003';ends timestamptz:=now()+interval '30 days';begin
 if admin_get_subscription('missing@example.test') is not null then raise exception 'Unknown account fabricated';end if;
 s:=admin_get_subscription(' NEW@example.test ');
 if s->>'version'<>'unassigned' or s->'account'<>'null'::jsonb or s#>>'{user,id}'<>u::text then raise exception 'Exact lookup failed';end if;
 r:=admin_change_subscription(request,u,s->>'version','save','basic-v1','trialing',ends,'Approved recruiting beta trial');
 again:=admin_change_subscription(request,u,s->>'version','save','basic-v1','trialing',ends,'Approved recruiting beta trial');
 if again->>'replayed'<>'true' or r#>>'{snapshot,account,id}'<>again#>>'{snapshot,account,id}' or jsonb_array_length(again#>'{snapshot,history}')<>1 then raise exception 'Response-loss retry duplicated grant';end if;
 if r#>>'{snapshot,account,usage,rules,limit}'<>'1000' or r#>>'{snapshot,account,tier}'<>'basic' then raise exception 'Server plan allowance not applied';end if;
 if r#>>'{snapshot,history,0,actor_id}'<>auth.uid()::text or r#>>'{snapshot,history,0,before_state}' is not null then raise exception 'Grant audit attribution failed';end if;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000005',true);
 begin perform admin_change_subscription(request,u,s->>'version','save','basic-v1','trialing',ends,'Approved recruiting beta trial');raise exception 'Another admin replayed a private request';exception when sqlstate 'PT409' then null;end;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000004',true);
 begin perform admin_change_subscription(request,u,s->>'version','save','pro-v1','trialing',ends,'Approved recruiting beta trial');raise exception 'Request identity reused';exception when sqlstate 'PT409' then null;end;
 begin perform admin_change_subscription(gen_random_uuid(),u,'unassigned','save','pro-v1','trialing',ends,'Stale tab must not replace trial');raise exception 'Stale update accepted';exception when sqlstate 'PT409' then null;end;
 begin perform admin_change_subscription(gen_random_uuid(),u,r#>>'{snapshot,version}','renew','basic-v1','beta',ends,'Early renewal must not reset usage');raise exception 'Active period renewed';exception when invalid_parameter_value then null;end;
 begin perform admin_change_subscription(gen_random_uuid(),u,r#>>'{snapshot,version}','save','basic-v1','active',ends,'Manual paid status is not valid');raise exception 'Manual paid access accepted';exception when invalid_parameter_value then null;end;
 begin perform admin_change_subscription(gen_random_uuid(),u,r#>>'{snapshot,version}','save','basic-v1','beta','infinity','Unlimited access must be rejected');raise exception 'Infinite expiry accepted';exception when invalid_parameter_value then null;end;
end$$;
reset role;

-- Updating/downgrading and extending retain both completed and uncertain usage.
do $$declare r jsonb;attempt uuid:=gen_random_uuid();begin
 r:=reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','rules',repeat('4',64),attempt);
 perform settle_subscription_evaluation((r->>'reservation_id')::uuid,attempt,'succeeded',gen_random_uuid());
 r:=reserve_subscription_evaluation('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','rules',repeat('5',64),attempt);
 perform settle_subscription_evaluation((r->>'reservation_id')::uuid,attempt,'uncertain');
end$$;
set role authenticated;
do $$declare s jsonb;r jsonb;period text;u uuid:='00000000-0000-0000-0000-000000000003';begin
 s:=admin_get_subscription('new@example.test');period:=s#>>'{account,period,id}';
 r:=admin_change_subscription(gen_random_uuid(),u,s->>'version','save','pro-v1','complimentary',now()+interval '45 days','Extend this recruiting evaluation');
 s:=r->'snapshot';
 if s#>>'{account,period,id}'<>period or s#>>'{account,usage,rules,used}'<>'1' or s#>>'{account,usage,rules,pending}'<>'1' then raise exception 'Plan update reset usage or period';end if;
 if s#>>'{account,usage,deep_ai,limit}'<>'500' then raise exception 'Pro capacity missing';end if;
 r:=admin_change_subscription(gen_random_uuid(),u,s->>'version','pause',null,null,null,'Pause requested for trial review');s:=r->'snapshot';
 if s#>>'{account,status}'<>'paused' or s#>>'{account,usage,rules,pending}'<>'1' then raise exception 'Pause erased usage';end if;
 if has_table_privilege('authenticated','subscription_admin_changes','insert,update,delete') or has_table_privilege('service_role','subscription_admin_changes','insert,update,delete') then raise exception 'Audit history mutable through API';end if;
 r:=admin_change_subscription(gen_random_uuid(),u,s->>'version','save','basic-v1','beta',now()+interval '10 days','Resume as Basic without AI access');
 if r#>>'{snapshot,account,usage,rules,used}'<>'1' or r#>>'{snapshot,account,usage,deep_ai,limit}'<>'0' then raise exception 'Downgrade changed usage or retained deep capacity';end if;
end$$;
reset role;
-- Expire the synthetic period, then explicitly renew it; historical reservations
-- must remain attached to their original period and remain settleable.
update subscription_periods set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where account_id=(select id from subscription_accounts where user_id='00000000-0000-0000-0000-000000000003');
set role authenticated;
do $$declare s jsonb;r jsonb;period text;u uuid:='00000000-0000-0000-0000-000000000003';begin
 s:=admin_get_subscription('new@example.test');period:=s#>>'{account,period,id}';
 begin perform admin_change_subscription(gen_random_uuid(),u,s->>'version','save','basic-v1','beta',now()+interval '30 days','Do not extend an expired allowance');raise exception 'Expired period silently extended';exception when invalid_parameter_value then null;end;
 r:=admin_change_subscription(gen_random_uuid(),u,s->>'version','renew','advanced-v1','beta',now()+interval '30 days','Renew approved recruiting beta access');
 if r#>>'{snapshot,account,period,id}'=period or r#>>'{snapshot,account,usage,rules,used}'<>'0' or r#>>'{snapshot,account,usage,rules,pending}'<>'0' then raise exception 'Renewal did not create a distinct period';end if;
end$$;
reset role;
do $$declare e subscription_evaluations;begin
 select * into e from subscription_evaluations where account_id=(select id from subscription_accounts where user_id='00000000-0000-0000-0000-000000000003') and state='uncertain';
 if e.id is null or not settle_subscription_evaluation(e.id,e.attempt_id,'succeeded',gen_random_uuid()) then raise exception 'Grant changes broke historical settlement';end if;
end$$;
update subscription_accounts set source='stripe' where user_id='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare s jsonb;begin
 s:=admin_get_subscription('two@example.test');
 begin perform admin_change_subscription(gen_random_uuid(),'00000000-0000-0000-0000-000000000002',s->>'version','pause',null,null,null,'Do not overwrite billing-managed access');raise exception 'Stripe account manually overwritten';exception when invalid_parameter_value then null;end;
end$$;
reset role;
update auth.users set approved=false where id='00000000-0000-0000-0000-000000000003';
set role authenticated;
do $$declare s jsonb;begin
 s:=admin_get_subscription('new@example.test');
 begin perform admin_change_subscription(gen_random_uuid(),'00000000-0000-0000-0000-000000000003',s->>'version','save','basic-v1','beta',now()+interval '30 days','Cannot bypass verified account access');raise exception 'Unapproved account granted';exception when invalid_parameter_value then null;end;
end$$;
reset role;
delete from app_admins where user_id='00000000-0000-0000-0000-000000000004';
set role authenticated;
do $$begin
 begin perform admin_get_subscription('new@example.test');raise exception 'Revoked admin still read data';exception when insufficient_privilege then null;end;
 begin perform admin_change_subscription(null,null,null,null,null,null,null,null);raise exception 'Revoked admin still mutated';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 if has_function_privilege('anon','public.admin_get_subscription(text)','execute') or has_function_privilege('anon','public.admin_change_subscription(uuid,uuid,text,text,text,text,timestamptz,text)','execute') or has_schema_privilege('anon','blumr_subscriptions_private','usage') then raise exception 'Anonymous administrative access';end if;
 if (select count(*) from subscription_accounts)<>3 then raise exception 'Unexpected enrollment';end if;
end$$;

-- Private privilege elevation is never exposed as a definer API wrapper.
do $$begin
 if exists(select from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_get_subscription','admin_change_subscription') and p.prosecdef) then raise exception 'Public admin wrapper elevated privileges';end if;
 if not (select relrowsecurity from pg_class where oid='public.subscription_admin_changes'::regclass) then raise exception 'Audit RLS disabled';end if;
end$$;
set test.actor='';
set role authenticated;
do $$begin
 begin perform admin_get_subscription('new@example.test');raise exception 'Missing session identity accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
