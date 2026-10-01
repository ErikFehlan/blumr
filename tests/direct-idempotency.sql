\set ON_ERROR_STOP on
do $$begin if not exists(select from pg_roles where rolname='anon') then create role anon nologin;end if;if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end$$;
create schema auth;
create table auth.users(id uuid primary key);
create table public.workspaces(id uuid primary key);
\ir ../supabase/migrations/20261001124322_direct_ai_idempotency.sql
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
