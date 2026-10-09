begin;
-- Align stored files with the 1,000-candidate workspace capacity. Preserve
-- the original 1,000 MiB/workspace and 10,000 MiB/global byte ceilings.
-- Missing or invalid size metadata reserves the bucket's full 10 MiB/file.
create or replace function public.enforce_resume_storage_budget() returns trigger
language plpgsql security definer set search_path='' as $$
declare w text;old_id uuid;workspace_count bigint;global_count bigint;
 workspace_bytes bigint;global_bytes bigint;incoming_bytes bigint;
begin
 if new.bucket_id<>'resumes' then return new;end if;
 w:=split_part(new.name,'/',1);
 if tg_op='UPDATE' then old_id:=old.id;end if;
 incoming_bytes:=case when coalesce(new.metadata->>'size','') ~ '^[0-9]{1,10}$'
  then (new.metadata->>'size')::bigint else 10485760 end;
 if incoming_bytes>10485760 then raise exception 'Resume file exceeds the 10 MB limit.' using errcode='PT413';end if;
 perform pg_advisory_xact_lock(17200002);
 select count(*),count(*) filter(where split_part(name,'/',1)=w),
  coalesce(sum(reserved_bytes),0),coalesce(sum(reserved_bytes) filter(where split_part(name,'/',1)=w),0)
 into global_count,workspace_count,global_bytes,workspace_bytes
 from (select name,case when coalesce(metadata->>'size','') ~ '^[0-9]{1,10}$'
  then (metadata->>'size')::bigint else 10485760 end as reserved_bytes
  from storage.objects where bucket_id='resumes' and (old_id is null or id<>old_id)) existing;
 if workspace_count>=2000 or global_count>=20000
  or workspace_bytes+incoming_bytes>1048576000 or global_bytes+incoming_bytes>10485760000 then
  raise exception 'Resume storage limit reached. Remove unused resumes or contact the administrator.' using errcode='PT429';
 end if;
 return new;
end$$;

create or replace function public.enforce_beta_record_budget() returns trigger
language plpgsql security definer set search_path='' as $$
declare maximum integer;total bigint;row_data jsonb:=to_jsonb(new);
begin
 if pg_column_size(new)>1000000 then raise exception 'Record is too large' using errcode='PT413';end if;
 if tg_op<>'INSERT' then return new;end if;
 maximum:=case tg_table_name when 'jobs' then 100 when 'candidates' then 1000 when 'candidate_documents' then 1000
 when 'candidate_assessments' then 5000 when 'manager_feedback' then 5000 when 'interview_outcomes' then 5000 when 'screening_insights' then 5000 else 1000 end;
 perform pg_advisory_xact_lock(hashtextextended('record-budget:'||new.workspace_id::text,0));
 execute format('select count(*) from public.%I where workspace_id=$1',tg_table_name) into total using new.workspace_id;
 if total>=maximum then raise exception 'Workspace record limit reached. Contact the administrator.' using errcode='PT429';end if;
 return new;
end$$;
revoke all on function public.enforce_resume_storage_budget(),public.enforce_beta_record_budget() from public,anon,authenticated;
commit;
