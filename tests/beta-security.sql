\set ON_ERROR_STOP on
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
 if not exists(select from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin;end if;
end$$;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text unique,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz,email_confirmed_at timestamptz,banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('sub',auth.uid(),'email',current_setting('test.email',true))$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
grant usage on schema auth,storage to authenticated,service_role;
grant execute on function auth.uid(),auth.jwt(),storage.foldername(text) to authenticated,service_role;
\ir ../supabase/migrations/20260909160000_multi_user_foundation.sql
\ir ../supabase/migrations/20260910160000_admin_usage_analytics.sql
\ir ../supabase/migrations/20260915171000_account_controls.sql
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-000000000001','efehlan@gmail.com',now()),
 ('00000000-0000-0000-0000-000000000002','recruiter@example.test',now());
\ir ../supabase/migrations/20260917200000_beta_security.sql
\ir ../supabase/patches/open-beta-signup.sql
\ir ../supabase/migrations/20260917200000_beta_security.sql
\ir ../supabase/patches/open-beta-signup.sql
grant select,insert,update,delete on public.jobs,public.workspace_members,public.workspaces,storage.objects to authenticated;
create table test_ids as select owner_id as user_id,id as workspace_id from workspaces;
grant select on test_ids to authenticated,service_role;
set test.actor='00000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin
 if not is_app_admin() then raise exception 'Existing administrator locked out';end if;
 perform manage_beta_access('  APPROVED@example.test ',true);
 begin perform manage_beta_access('efehlan@gmail.com',false);raise exception 'Admin revoked self';exception when invalid_parameter_value then null;end;
end$$;
reset role;
do $$begin
 if before_beta_signup('{"user":{"email":"unknown@example.test"}}')<>'{}' then raise exception 'Self-service signup blocked';end if;
 if before_beta_signup('{"user":{"email":"approved@example.test"}}')<>'{}' then raise exception 'Approved signup blocked';end if;
 if before_beta_signup('{"user":{"email":""}}')#>>'{error,http_code}'<>'400' then raise exception 'Emailless signup allowed';end if;
 if before_beta_signup('{"user":{"email":"anonymous@example.test","is_anonymous":true}}')#>>'{error,http_code}'<>'400' then raise exception 'Anonymous signup allowed';end if;
 insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000004','unknown@example.test');
 if not exists(select from beta_access where email='unknown@example.test' and approved and user_id='00000000-0000-0000-0000-000000000004') then raise exception 'Automatic access binding missing';end if;
end$$;
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000003','approved@example.test');
do $$begin
 if has_beta_access('00000000-0000-0000-0000-000000000003') then raise exception 'Unverified account admitted';end if;
 if not exists(select from workspaces where owner_id='00000000-0000-0000-0000-000000000003') then raise exception 'Approved signup lost workspace';end if;
end$$;
update auth.users set email_confirmed_at=now() where id='00000000-0000-0000-0000-000000000003';
set test.actor='00000000-0000-0000-0000-000000000002';
set test.email='efehlan@gmail.com';
set role authenticated;
do $$begin
 if is_app_admin() then raise exception 'Email claim granted administrator access';end if;
 begin perform manage_beta_access('attacker@example.test',true);raise exception 'Non-admin approved an account';exception when insufficient_privilege then null;end;
 begin update beta_access set approved=true;raise exception 'Direct approval update allowed';exception when insufficient_privilege then null;end;
 begin perform reserve_ai_budget((select workspace_id from test_ids limit 1),auth.uid(),100,100);raise exception 'Client reserved its own credits';exception when insufficient_privilege then null;end;
 if exists(select from jobs) then raise exception 'Unexpected initial jobs';end if;
 insert into jobs(workspace_id,title) select workspace_id,'Synthetic private role' from test_ids where user_id=auth.uid();
end$$;
reset role;
do $$declare w uuid;foreign_workspace uuid;r jsonb;begin
 select workspace_id into w from test_ids where user_id='00000000-0000-0000-0000-000000000002';
 select workspace_id into foreign_workspace from test_ids where user_id='00000000-0000-0000-0000-000000000001';
 r:=reserve_ai_budget(foreign_workspace,'00000000-0000-0000-0000-000000000002',100,100);
 if r->>'code'<>'beta_access_required' then raise exception 'Foreign workspace charged';end if;
 update security_limits set workspace_minute=2;
 if reserve_ai_budget(w,null,100,100)->>'allowed'<>'true' then raise exception 'Worker denied';end if;
 if reserve_ai_budget(w,'00000000-0000-0000-0000-000000000002',100,100)->>'allowed'<>'true' then raise exception 'Second call denied';end if;
 if reserve_ai_budget(w,null,100,100)->>'code'<>'usage_limit' then raise exception 'Minute cap bypassed';end if;
 if (select calls from ai_budget_counters where scope='global' and period='day')<>2 then raise exception 'Rejected reservation consumed global capacity';end if;
 truncate ai_budget_counters;update security_limits set workspace_minute=20,global_day=1;
 perform reserve_ai_budget(w,null,100,100);
 if reserve_ai_budget(foreign_workspace,null,100,100)->>'code'<>'usage_limit' then raise exception 'Second account bypassed global cap';end if;
 truncate ai_budget_counters;update security_limits set global_day=1000,global_input_bytes_day=99;
 if reserve_ai_budget(w,null,100,100)->>'code'<>'usage_limit' then raise exception 'Input byte budget bypassed';end if;
 update security_limits set global_input_bytes_day=20000000,global_output_tokens_day=99;
 if reserve_ai_budget(w,null,100,100)->>'code'<>'usage_limit' then raise exception 'Output budget bypassed';end if;
 update security_limits set global_output_tokens_day=2000000,ai_paused=true;
 if reserve_ai_budget(w,null,100,100)->>'code'<>'ai_paused' then raise exception 'Pause bypassed';end if;
 update security_limits set ai_paused=false;
end$$;
-- Revoke the registered account. Its existing JWT and workspace ownership must
-- not bypass RLS, file access, direct analysis or worker admission.
set test.actor='00000000-0000-0000-0000-000000000001';set role authenticated;
select manage_beta_access('recruiter@example.test',false);
reset role;
\ir ../supabase/migrations/20260917200000_beta_security.sql
\ir ../supabase/patches/open-beta-signup.sql
set test.actor='00000000-0000-0000-0000-000000000002';set role authenticated;
do $$declare w uuid;begin
 select workspace_id into w from test_ids where user_id=auth.uid();
 if exists(select from jobs) or is_workspace_member(w) or can_access_resume_path(w::text||'/test.txt') then raise exception 'Revoked account retained access';end if;
 begin insert into jobs(workspace_id,title) values(w,'Forbidden');raise exception 'Revoked account wrote data';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$declare w uuid;begin
 select workspace_id into w from test_ids where user_id='00000000-0000-0000-0000-000000000002';
 if reserve_ai_budget(w,null,100,100)->>'code'<>'beta_access_required' then raise exception 'Revoked background job ran';end if;
end$$;
set test.actor='00000000-0000-0000-0000-000000000001';set role authenticated;
select manage_beta_access('recruiter@example.test',true);
reset role;
-- Test direct storage writes, missing size metadata, replacement, and capacity release.
set test.actor='00000000-0000-0000-0000-000000000002';set role authenticated;
insert into storage.objects(bucket_id,name) select 'resumes',workspace_id::text||'/file-'||n from test_ids cross join generate_series(1,100)n where user_id=auth.uid();
do $$declare w text;begin
 select workspace_id::text into w from test_ids where user_id=auth.uid();
 begin insert into storage.objects(bucket_id,name) values('resumes',w||'/extra');raise exception 'Storage cap bypassed';exception when sqlstate 'PT429' then null;end;
 update storage.objects set owner_id=auth.uid()::text where bucket_id='resumes';
 delete from storage.objects where name=w||'/file-1';
 insert into storage.objects(bucket_id,name) values('resumes',w||'/replacement');
end$$;
reset role;
do $$declare w uuid;begin
 select workspace_id into w from test_ids where user_id='00000000-0000-0000-0000-000000000002';
 insert into jobs(workspace_id,title) select w,'Synthetic '||n from generate_series(2,100)n;
 begin insert into jobs(workspace_id,title) values(w,'Over quota');raise exception 'Direct record cap bypassed';exception when sqlstate 'PT429' then null;end;
 if has_function_privilege('anon','public.get_beta_security()','execute') or has_function_privilege('authenticated','public.before_beta_signup(jsonb)','execute') then raise exception 'Private control exposed';end if;
 if has_function_privilege('authenticated','public.enforce_beta_signup()','execute') then raise exception 'Auth trigger exposed';end if;
end$$;
truncate ai_budget_counters;
select 'PASS: self-service registration, verification, admin identity, revocation, direct REST and storage quotas, worker budgets, and replay safety' as result;

-- A self-service user gets exactly one private workspace, hidden until verification.
set test.actor='00000000-0000-0000-0000-000000000004';set role authenticated;
do $$begin
 if exists(select from workspace_members) or exists(select from jobs) then raise exception 'Unverified account read private data';end if;
 if is_app_admin() then raise exception 'Self-service user became admin';end if;
end$$;
reset role;
update auth.users set email_confirmed_at=now(),raw_user_meta_data='{"role":"admin","approved":true}' where id='00000000-0000-0000-0000-000000000004';
set role authenticated;
do $$declare w uuid;begin
 select workspace_id into strict w from workspace_members where user_id=auth.uid();
 if is_app_admin() then raise exception 'Forged metadata promoted user';end if;
 insert into jobs(workspace_id,title) values(w,'Open beta private role');
 if (select count(*) from jobs)<>1 then raise exception 'Another workspace leaked';end if;
end$$;
reset role;
-- Existing blocks, even after deletion, must never be auto-approved again.
insert into beta_access(email,approved) values('blocked@example.test',false);
do $$begin
 if before_beta_signup('{"user":{"email":" BLOCKED@example.test "}}')#>>'{error,http_code}'<>'403' then raise exception 'Block ignored';end if;
 begin insert into auth.users(id,email) values(gen_random_uuid(),'blocked@example.test');raise exception 'Blocked direct signup allowed';exception when insufficient_privilege then null;end;
 if exists(select from auth.users where email='blocked@example.test') then raise exception 'Failed signup left a partial account';end if;
end$$;
-- Suspension follows identity even after a verified email change.
update auth.users set email='changed@example.test' where id='00000000-0000-0000-0000-000000000004';
set test.actor='00000000-0000-0000-0000-000000000001';set role authenticated;
select manage_beta_access('changed@example.test',false);
reset role;
\ir ../supabase/patches/open-beta-signup.sql
set test.actor='00000000-0000-0000-0000-000000000004';set role authenticated;
do $$begin
 if exists(select from jobs) or exists(select from workspace_members) then raise exception 'Suspended user still has access';end if;
end$$;
reset role;
select 'PASS: new verified account, isolated job creation, forged admin metadata, blocked signup rollback, changed-email suspension and replay protection';
