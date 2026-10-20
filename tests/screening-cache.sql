\set ON_ERROR_STOP on
-- Minimal production-shaped source tables; exercise the actual migration and
-- user roles, including denied mutations and mismatched document ownership.
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
grant usage on schema auth to authenticated;
create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$select auth.uid() is not null and w::text=current_setting('test.workspace',true)$$;
create table public.jobs(id uuid primary key,workspace_id uuid not null,unique(id,workspace_id));
create table public.candidates(id uuid primary key,job_id uuid not null,workspace_id uuid not null,unique(id,job_id,workspace_id),foreign key(job_id,workspace_id) references jobs(id,workspace_id) on delete cascade);
create table public.candidate_documents(id uuid primary key,job_id uuid not null,candidate_id uuid not null,workspace_id uuid not null,extracted_text text,created_at timestamptz default now(),foreign key(candidate_id,job_id,workspace_id) references candidates(id,job_id,workspace_id) on delete cascade);
alter table jobs enable row level security;alter table candidates enable row level security;alter table candidate_documents enable row level security;
create policy jobs_read on jobs for select to authenticated using(is_workspace_member(workspace_id));
create policy candidates_read on candidates for select to authenticated using(is_workspace_member(workspace_id));
create policy docs_read on candidate_documents for select to authenticated using(is_workspace_member(workspace_id));
grant select on jobs,candidates,candidate_documents to authenticated;
\ir ../supabase/migrations/20261019115657_screening_foundation_cache.sql
\ir ../supabase/migrations/20261019115657_screening_foundation_cache.sql
insert into jobs values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into candidates values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
insert into candidate_documents(id,job_id,candidate_id,workspace_id,extracted_text)
 select ('30000000'||substr(id::text,9))::uuid,job_id,id,workspace_id,'Implemented Azure infrastructure without outages.' from candidates;
insert into candidate_screening_cache(candidate_id,job_id,workspace_id,document_id,rubric_key,resume_hash,result)
 select candidate_id,job_id,workspace_id,id,repeat('a',64),encode(sha256(convert_to(extracted_text,'UTF8')),'hex'),jsonb_build_object('candidateId',candidate_id,'rubricKey',repeat('a',64),'score',100) from candidate_documents;
set test.actor='90000000-0000-0000-0000-000000000001';set test.workspace='00000000-0000-0000-0000-000000000001';set role authenticated;
do $$declare r record;begin
 if (select count(*) from candidate_screening_cache)<>1 then raise exception 'Cache leaked workspace';end if;
 select * into r from get_screening_candidate_inputs('10000000-0000-0000-0000-000000000001',array['20000000-0000-0000-0000-000000000001'::uuid],repeat('a',64));
 if r.resume_text is not null or r.cached_result->>'score'<>'100' then raise exception 'Cache did not avoid text transfer';end if;
 select * into r from get_screening_candidate_inputs('10000000-0000-0000-0000-000000000001',array['20000000-0000-0000-0000-000000000001'::uuid],repeat('b',64));
 if r.resume_text is null or r.cached_result is not null then raise exception 'Changed rubric reused stale score';end if;
 begin perform get_screening_candidate_inputs('10000000-0000-0000-0000-000000000002',array['20000000-0000-0000-0000-000000000002'::uuid],repeat('a',64));raise exception 'Foreign job allowed';exception when insufficient_privilege then null;end;
 begin perform get_screening_candidate_inputs('10000000-0000-0000-0000-000000000001',array['20000000-0000-0000-0000-000000000002'::uuid],repeat('a',64));raise exception 'Foreign candidate allowed';exception when insufficient_privilege then null;end;
 begin perform get_screening_candidate_inputs('10000000-0000-0000-0000-000000000001',array_fill('20000000-0000-0000-0000-000000000001'::uuid,array[101]),repeat('a',64));raise exception 'Unbounded request allowed';exception when invalid_parameter_value then null;end;
 if has_table_privilege('authenticated','candidate_screening_cache','INSERT') or has_table_privilege('authenticated','job_screening_rubrics','UPDATE') or has_function_privilege('anon','get_screening_candidate_inputs(uuid,uuid[],text)','EXECUTE') then raise exception 'Private writes or anonymous reads allowed';end if;
end $$;
reset role;
update candidate_documents set extracted_text='No Azure experience. Different document content.' where candidate_id='20000000-0000-0000-0000-000000000001';
set role authenticated;
do $$declare r record;begin
 select * into r from get_screening_candidate_inputs('10000000-0000-0000-0000-000000000001',array['20000000-0000-0000-0000-000000000001'::uuid],repeat('a',64));
 if r.cached_result is not null or r.resume_text not like 'No Azure%' then raise exception 'Changed document reused stale score';end if;
end $$;
reset role;
insert into candidate_documents(id,job_id,candidate_id,workspace_id,extracted_text,created_at)
 select '30000000-0000-0000-0000-000000000010',job_id,candidate_id,workspace_id,'Newly uploaded unreadable document',now()+interval '1 second' from candidate_documents where id='30000000-0000-0000-0000-000000000001';
set role authenticated;
do $$declare r record;begin
 select * into r from get_screening_candidate_inputs('10000000-0000-0000-0000-000000000001',array['20000000-0000-0000-0000-000000000001'::uuid],repeat('a',64));
 if r.document_id<>'30000000-0000-0000-0000-000000000010' or r.cached_result is not null then raise exception 'Old resume used after new upload';end if;
end $$;
reset role;
do $$begin
 begin update candidate_screening_cache set document_id='30000000-0000-0000-0000-000000000002' where candidate_id='20000000-0000-0000-0000-000000000001';raise exception 'Cross-candidate document accepted';exception when foreign_key_violation then null;end;
end $$;
delete from candidate_documents where id='30000000-0000-0000-0000-000000000001';
do $$begin if exists(select from candidate_screening_cache where candidate_id='20000000-0000-0000-0000-000000000001') then raise exception 'Deleted resume evidence retained';end if;end $$;
