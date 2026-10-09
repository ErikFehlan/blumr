\set ON_ERROR_STOP on
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
end$$;
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
create table public.candidate_documents(id bigint generated always as identity,workspace_id uuid);
\ir ../supabase/patches/resume-storage-budget.sql
create trigger resume_storage_budget before insert or update on storage.objects for each row execute function public.enforce_resume_storage_budget();
create trigger beta_record_budget before insert or update on public.candidate_documents for each row execute function public.enforce_beta_record_budget();
-- Regression: the 101st upload must succeed for a workspace with small files.
insert into storage.objects(bucket_id,name,metadata) select 'resumes','workspace/file-'||n,'{"size":22961}' from generate_series(1,101)n;
-- The file cap still applies; replacements at capacity remain possible.
alter table storage.objects disable trigger resume_storage_budget;
insert into storage.objects(bucket_id,name,metadata) select 'resumes','workspace/file-'||n,'{"size":1}' from generate_series(102,2000)n;
alter table storage.objects enable trigger resume_storage_budget;
do $$begin
 begin insert into storage.objects(bucket_id,name,metadata) values('resumes','workspace/overflow','{"size":1}');raise exception 'Object cap bypassed';exception when sqlstate 'PT429' then null;end;
 update storage.objects set metadata='{"size":2}' where name='workspace/file-1';
 begin update storage.objects set metadata='{"size":10485761}' where name='workspace/file-1';raise exception 'File size cap bypassed';exception when sqlstate 'PT413' then null;end;
end$$;
truncate storage.objects;
-- Missing metadata reserves a full file allowance; byte growth on UPDATE is checked.
insert into storage.objects(bucket_id,name) select 'resumes','workspace/file-'||n from generate_series(1,100)n;
do $$begin
 begin insert into storage.objects(bucket_id,name,metadata) values('resumes','workspace/overflow','{"size":1}');raise exception 'Byte cap bypassed';exception when sqlstate 'PT429' then null;end;
 update storage.objects set metadata='{"size":1}' where name='workspace/file-1';
 insert into storage.objects(bucket_id,name,metadata) values('resumes','workspace/small','{"size":1}');
 begin update storage.objects set metadata=null where name='workspace/file-1';raise exception 'Byte growth bypassed';exception when sqlstate 'PT429' then null;end;
 begin insert into storage.objects(bucket_id,name,metadata) values('resumes','workspace/bad-size','{"size":"bad"}');raise exception 'Unknown size bypassed';exception when sqlstate 'PT429' then null;end;
end$$;
truncate storage.objects;
alter table storage.objects disable trigger resume_storage_budget;
insert into storage.objects(bucket_id,name,metadata) select 'resumes','workspace-'||(n%20)||'/file-'||n,'{"size":1}' from generate_series(1,20000)n;
alter table storage.objects enable trigger resume_storage_budget;
do $$begin
 begin insert into storage.objects(bucket_id,name,metadata) values('resumes','fresh/overflow','{"size":1}');raise exception 'Global object cap bypassed';exception when sqlstate 'PT429' then null;end;
end$$;
truncate storage.objects;
alter table storage.objects disable trigger resume_storage_budget;
insert into storage.objects(bucket_id,name) select 'resumes','workspace-'||(n%10)||'/file-'||n from generate_series(1,1000)n;
alter table storage.objects enable trigger resume_storage_budget;
do $$begin
 begin insert into storage.objects(bucket_id,name,metadata) values('resumes','fresh/overflow','{"size":1}');raise exception 'Global byte cap bypassed';exception when sqlstate 'PT429' then null;end;
end$$;
-- Document capacity matches the existing candidate capacity, without removing caps.
insert into public.candidate_documents(workspace_id) select '00000000-0000-0000-0000-000000000001'::uuid from generate_series(1,1000)n;
do $$begin
 begin insert into public.candidate_documents(workspace_id) values('00000000-0000-0000-0000-000000000001');raise exception 'Document cap bypassed';exception when sqlstate 'PT429' then null;end;
 if has_function_privilege('authenticated','public.enforce_resume_storage_budget()','execute') then raise exception 'Storage trigger exposed';end if;
end$$;
select 'PASS: 101st upload, file and byte caps, metadata fallback, replacement, global limits and document capacity' as result;
