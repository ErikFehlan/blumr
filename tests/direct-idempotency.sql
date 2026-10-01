\set ON_ERROR_STOP on
do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end$$;
create schema auth;
create table auth.users(id uuid primary key);
create table public.workspaces(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function public.is_app_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='true'$$;
create table public.reliability_events(workspace_id uuid,actor_id uuid,source text,category text,operation text,severity text,metadata jsonb);
\ir ../supabase/migrations/20261001124322_direct_ai_idempotency.sql
\ir ../supabase/migrations/20261001132742_direct_ai_recovery_retention.sql
insert into auth.users values('00000000-0000-0000-0000-000000000001');
insert into public.workspaces values('00000000-0000-0000-0000-000000000002');
set role service_role;
do $$
declare w uuid:='00000000-0000-0000-0000-000000000002';a uuid:='00000000-0000-0000-0000-000000000001';owner uuid:=gen_random_uuid();other uuid:=gen_random_uuid();key text:=repeat('a',64);r jsonb;
begin
 if public.claim_direct_ai_request(w,a,key,owner)->>'state'<>'owner' then raise exception 'First request not owner';end if;
 if public.claim_direct_ai_request(w,a,key,other)->>'state'<>'processing' then raise exception 'Second owner allowed';end if;
 if public.finish_direct_ai_request(w,a,key,other,'{}') then raise exception 'Other owner completed';end if;
 if not public.finish_direct_ai_request(w,a,key,owner,'{"result":42}') then raise exception 'Completion failed';end if;
 r:=public.claim_direct_ai_request(w,a,key,other);
 if r->>'state'<>'complete' or r->'body'->>'result'<>'42' then raise exception 'Replay missing';end if;
 update public.direct_ai_requests set expires_at=now()-interval '1 second';
 if public.claim_direct_ai_request(w,a,key,other)->>'state'<>'owner' then raise exception 'Expired success not renewed';end if;
 update public.direct_ai_requests set expires_at=now()-interval '1 second';
 if public.claim_direct_ai_request(w,a,key,owner)->>'state'<>'uncertain' then raise exception 'Expired pending claim stolen';end if;
 if not public.finish_direct_ai_request(w,a,key,other,null) then raise exception 'Known failure not released';end if;
 if exists(select 1 from public.direct_ai_requests) then raise exception 'Failed claim retained';end if;
 if has_function_privilege('authenticated','public.claim_direct_ai_request(uuid,uuid,text,uuid)','execute') or has_function_privilege('anon','public.finish_direct_ai_request(uuid,uuid,text,uuid,jsonb)','execute') then raise exception 'Client RPC exposed';end if;
 if has_table_privilege('authenticated','public.direct_ai_requests','select') then raise exception 'Client result access exposed';end if;
end $$;
reset role;

reset role;
do $$
declare w uuid:='00000000-0000-0000-0000-000000000002';a uuid:='00000000-0000-0000-0000-000000000001';owner uuid:=gen_random_uuid();key text:=repeat('b',64);
begin
 perform public.claim_direct_ai_request(w,a,key,owner);
 if not public.mark_direct_ai_started(w,a,key,owner) then raise exception 'Live owner could not start';end if;
 update public.direct_ai_requests set expires_at=now()-interval '1 second';
 perform public.cleanup_direct_ai_requests();
 if not exists(select from public.direct_ai_requests where claim_id=owner) then raise exception 'Cleanup removed uncertain started call';end if;
 if public.mark_direct_ai_started(w,a,key,owner) then raise exception 'Expired owner could still start';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);perform set_config('test.admin','false',true);
 begin perform public.get_direct_ai_recovery();raise exception 'Nonadmin read recovery';exception when insufficient_privilege then null;end;
 perform set_config('test.admin','true',true);
 if jsonb_array_length(public.get_direct_ai_recovery())<>1 then raise exception 'Stalled call missing';end if;
 begin perform public.recover_direct_ai_request(owner,'Synthetic verification was performed.',false);raise exception 'Unverified started call released';exception when invalid_parameter_value then null;end;
 perform public.recover_direct_ai_request(owner,'Synthetic provider request verified stopped.',true);
 if exists(select from public.direct_ai_requests where claim_id=owner) then raise exception 'Verified recovery retained claim';end if;
 if not exists(select from public.reliability_events where metadata->>'claim_id'=owner::text) then raise exception 'Recovery audit missing';end if;
 perform public.claim_direct_ai_request(w,a,key,owner);
 update public.direct_ai_requests set expires_at=now()-interval '1 second';
 perform public.cleanup_direct_ai_requests();
 if exists(select from public.direct_ai_requests) then raise exception 'Unstarted cleanup failed';end if;
 if public.mark_direct_ai_started(w,a,key,owner) then raise exception 'Cleaned claim reached provider';end if;
end $$;
reset role;
