-- Synthetic signup/RLS integration tests against the complete schema.
-- All fixtures and writes roll back; no email or provider requests are sent.
begin;
create temp table signup_fixture(id uuid,email text,kind text);
insert into signup_fixture select gen_random_uuid(),'blumr-signup-'||gen_random_uuid()||'@example.invalid',kind
 from unnest(array['new','other','admin','blocked']) kind;
grant select on signup_fixture to authenticated;
do $$declare f record;begin
 for f in select * from signup_fixture where kind<>'blocked' loop
  if public.before_beta_signup(jsonb_build_object('user',jsonb_build_object('email',f.email)))<>'{}' then raise exception 'New email needs approval';end if;
  insert into auth.users(id,email,role,aud,raw_user_meta_data,email_confirmed_at)
   values(f.id,f.email,'authenticated','authenticated','{"role":"admin","approved":true}',case when f.kind='new' then null else now() end);
  if (select count(*) from public.workspaces where owner_id=f.id)<>1
    or (select count(*) from public.profiles where id=f.id)<>1
    or (select count(*) from public.workspace_members where user_id=f.id)<>1 then raise exception 'Account provisioning incomplete';end if;
  if not exists(select from public.workspace_plans p join public.workspaces w on w.id=p.workspace_id
   where w.owner_id=f.id and p.plan='beta' and p.status='active') then raise exception 'Free beta plan missing';end if;
 end loop;
end$$;
-- Exercise deferred account-binding constraints before completing the test.
set constraints all immediate;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','email',email)::text,true) from signup_fixture where kind='new';
set local role authenticated;
do $$begin
 if exists(select from public.workspace_members) or exists(select from public.jobs) or public.is_app_admin() then raise exception 'Unverified user admitted';end if;
 begin perform public.get_beta_security();raise exception 'Non-admin read accounts';exception when insufficient_privilege then null;end;
 begin update public.beta_access set approved=true;raise exception 'Non-admin changed account controls';exception when insufficient_privilege then null;end;
end$$;
reset role;
update auth.users set email_confirmed_at=now() where id=(select id from signup_fixture where kind='new');
set local role authenticated;
do $$declare w uuid;j uuid;c uuid;begin
 select workspace_id into strict w from public.workspace_members where user_id=auth.uid();
 if public.is_app_admin() then raise exception 'Metadata granted administrator rights';end if;
 insert into public.jobs(workspace_id,title,created_by) values(w,'Disposable open beta verification',auth.uid()) returning id into j;
 insert into public.candidates(workspace_id,job_id,name,created_by) values(w,j,'Disposable beta candidate',auth.uid()) returning id into c;
 if (select count(*) from public.jobs)<>1 then raise exception 'Cross-workspace read leak';end if;
 if exists(select from public.workspace_members where user_id<>auth.uid()) then raise exception 'Membership leak';end if;
 if not public.can_access_resume_path(w::text||'/'||j||'/'||c||'/synthetic.txt') then raise exception 'Own storage access denied';end if;
 if public.can_access_resume_path(gen_random_uuid()::text||'/'||j||'/'||c||'/synthetic.txt') then raise exception 'Foreign storage admitted';end if;
 begin perform public.manage_beta_access((select email from signup_fixture where kind='new'),true);raise exception 'Non-admin changed access';exception when insufficient_privilege then null;end;
end$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','email',email)::text,true) from signup_fixture where kind='other';
set local role authenticated;
do $$begin
 if exists(select from public.jobs) then raise exception 'New account sees another recruiter job';end if;
end$$;
reset role;
insert into public.app_admins(email,user_id) select email,id from signup_fixture where kind='admin';
-- Controls must follow identity after an email change.
update auth.users set email='changed-'||email where id=(select id from signup_fixture where kind='new');
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','email',email)::text,true) from signup_fixture where kind='admin';
set local role authenticated;
select public.manage_beta_access('changed-'||email,false) from signup_fixture where kind='new';
do $$declare snapshot jsonb;begin
 snapshot:=public.get_beta_security();
 if snapshot->>'signup_mode'<>'open_beta' then raise exception 'Admin signup mode incorrect';end if;
 if not exists(select from jsonb_array_elements(snapshot->'accounts') a where a->>'email'='changed-'||(select email from signup_fixture where kind='new') and a->>'status'='suspended') then raise exception 'Admin suspension status incorrect';end if;
end$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','email',email)::text,true) from signup_fixture where kind='new';
set local role authenticated;
do $$begin
 if exists(select from public.jobs) or exists(select from public.workspace_members) then raise exception 'Old session bypassed suspension';end if;
end$$;
reset role;
do $$declare f record;begin
 select * into strict f from signup_fixture where kind='blocked';
 insert into public.beta_access(email,approved) values(f.email,false);
 if public.before_beta_signup(jsonb_build_object('user',jsonb_build_object('email',upper(f.email))))#>>'{error,http_code}'<>'403' then raise exception 'Blocked email admitted';end if;
 begin insert into auth.users(id,email,role,aud) values(f.id,f.email,'authenticated','authenticated');raise exception 'Direct route ignored suspension';exception when insufficient_privilege then null;end;
 if exists(select from public.workspaces where owner_id=f.id) or exists(select from public.profiles where id=f.id) then raise exception 'Failed registration left partial data';end if;
 if has_function_privilege('authenticated','public.before_beta_signup(jsonb)','execute')
  or has_function_privilege('anon','public.get_beta_security()','execute')
  or has_function_privilege('authenticated','public.enforce_beta_signup()','execute') then raise exception 'Private helper exposed';end if;
end$$;
select 'PASS: self-service signup, verification gate, private workspace and free plan, job creation, tenant isolation, admin security, changed-email suspension and signup rollback' as result;
rollback;
