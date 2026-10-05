\set ON_ERROR_STOP on
\ir beta-security.sql
alter table storage.objects add column metadata jsonb;
\ir ../supabase/migrations/20261005190251_production_readiness_guards.sql
\ir ../supabase/migrations/20261005190251_production_readiness_guards.sql
-- Free only synthetic storage/record quota created by the preceding fixture.
delete from storage.objects;
delete from jobs where title like 'Synthetic %' and title<>'Synthetic private role';
set test.actor='00000000-0000-0000-0000-000000000002';
create temp table fixture_scope as select j.id job_id,j.workspace_id from jobs j where j.title='Synthetic private role';
grant select on fixture_scope to authenticated;
grant select,insert,update,delete on public.candidates,public.candidate_documents to authenticated;
set role authenticated;
insert into candidates(id,job_id,workspace_id,name) select '00000000-0000-0000-0000-000000000321',job_id,workspace_id,'Synthetic' from fixture_scope;
insert into storage.objects(bucket_id,name,metadata) select 'resumes',workspace_id||'/'||job_id||'/00000000-0000-0000-0000-000000000321/source.pdf','{"size":123,"mimetype":"application/pdf"}' from fixture_scope;
insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,mime_type,file_size,extracted_text)
 select workspace_id,job_id,'00000000-0000-0000-0000-000000000321',workspace_id||'/'||job_id||'/00000000-0000-0000-0000-000000000321/source.pdf','Synthetic.pdf','application/pdf',123,'Synthetic resume contains manual regression testing and documented defect remediation.' from fixture_scope;
do $$declare d public.candidate_documents;begin
 select * into d from public.candidate_documents limit 1;
 begin update public.candidate_documents set file_size=124 where id=d.id;raise exception 'Forged byte count accepted';exception when invalid_parameter_value then null;end;
 begin update public.candidate_documents set mime_type='text/html' where id=d.id;raise exception 'HTML metadata accepted';exception when invalid_parameter_value then null;end;
 begin update public.candidate_documents set storage_path=replace(storage_path,'source.pdf','../source.pdf') where id=d.id;raise exception 'Traversal accepted';exception when invalid_parameter_value then null;end;
 begin update public.candidate_documents set extracted_text=repeat('x',120001) where id=d.id;raise exception 'Unbounded source accepted';exception when invalid_parameter_value then null;end;
 begin update public.candidate_documents set created_by='00000000-0000-0000-0000-000000000001' where id=d.id;raise exception 'Document creator forged';exception when insufficient_privilege then null;end;
 begin update public.jobs set created_by='00000000-0000-0000-0000-000000000001' where id=d.job_id;raise exception 'Job creator forged';exception when insufficient_privilege then null;end;
 update public.candidate_documents set file_name='Renamed.pdf' where id=d.id;
end $$;
reset role;
do $$begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'select,insert,update,delete') and c.relname<>'test_ids') then raise exception 'Client table without RLS';end if;
 if has_function_privilege('authenticated','public.validate_resume_document()','execute') or has_function_privilege('anon','public.preserve_record_creator()','execute') then raise exception 'Trigger helper exposed';end if;
 if (select allowed_mime_types from storage.buckets where id='resumes')<>array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'] then raise exception 'Storage allowlist missing';end if;
end $$;
select 'PASS: direct metadata forgery, file limits, object identity, immutable authorship and private guards';
