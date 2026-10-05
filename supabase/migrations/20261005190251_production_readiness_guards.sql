begin;
-- Enforce upload allowlists at Storage and metadata admission, including direct
-- REST clients. Original files stay private; this is not a malware scanner.
update storage.buckets set allowed_mime_types=array['application/pdf','application/msword',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'],
 file_size_limit=10485760,public=false where id='resumes';

create or replace function public.validate_resume_document() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare extension text;expected_mime text;stored jsonb;prefix text;
begin
 prefix:=new.workspace_id::text||'/'||new.job_id::text||'/'||new.candidate_id::text||'/';
 extension:=lower(substring(new.storage_path from '\.([^.]+)$'));
 expected_mime:=case extension when 'pdf' then 'application/pdf' when 'doc' then 'application/msword'
  when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' when 'txt' then 'text/plain' end;
 if expected_mime is null or new.mime_type is distinct from expected_mime
  or left(new.storage_path,length(prefix))<>prefix
  or substring(new.storage_path from length(prefix)+1)!~'^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$'
  or position('..' in new.storage_path)>0
  or char_length(new.file_name) not between 1 and 255 or new.file_name~'[/\\]'
  or new.file_size is null or new.file_size not between 1 and 10485760
  or new.extracted_text is null or char_length(btrim(new.extracted_text)) not between 40 and 120000 then
  raise exception 'Invalid resume metadata or unsupported file type' using errcode='22023';
 end if;
 select metadata into stored from storage.objects where bucket_id='resumes' and name=new.storage_path;
 if not found or coalesce(stored->>'size','')!~'^[0-9]+$'
  or (stored->>'size')::numeric<>new.file_size or stored->>'mimetype' is distinct from expected_mime then
  raise exception 'Resume metadata does not match the stored private object' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function public.validate_resume_document() from public,anon,authenticated;
grant execute on function public.validate_resume_document() to service_role;
drop trigger if exists validate_resume_document on public.candidate_documents;
create trigger validate_resume_document before insert or update of storage_path,file_name,mime_type,file_size,extracted_text
 on public.candidate_documents for each row execute function public.validate_resume_document();

-- A shared workspace permits collaboration, never rewriting the recorded author.
create or replace function public.preserve_record_creator() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
begin
 if current_user in ('anon','authenticated') and new.created_by is distinct from old.created_by then
  raise exception 'Record creator cannot be reassigned' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.preserve_record_creator() from public,anon,authenticated;
grant execute on function public.preserve_record_creator() to service_role;
do $$declare t record;begin
 for t in select table_name from information_schema.columns where table_schema='public' and column_name='created_by' loop
  execute format('drop trigger if exists preserve_record_creator on public.%I',t.table_name);
  execute format('create trigger preserve_record_creator before update of created_by on public.%I for each row execute function public.preserve_record_creator()',t.table_name);
 end loop;
end $$;
commit;
