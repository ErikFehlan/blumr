begin;
set local lock_timeout='5s';
-- Server-owned admission policy: new batches retain the existing $5 default.
-- Keep p_budget for older clients, but never let a caller set the initial cap.
-- Existing batches and their reservations are not rewritten.
create or replace function public.create_screening_batch(p_id uuid,p_job uuid,p_manifest jsonb,p_budget numeric default 5) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.jobs;b public.screening_batches;f jsonb;n integer:=0;bytes bigint:=0;
begin
 select * into j from public.jobs where id=p_job;
 if not found or auth.uid() is null or not public.is_workspace_member(j.workspace_id) then raise exception 'Job unavailable' using errcode='42501';end if;
 if j.status<>'active' or not exists(select from public.screening_feature_config where enabled) then raise exception 'Bulk screening is unavailable' using errcode='55000';end if;
 if p_id is null or jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest) not between 1 and 1000 then raise exception 'Invalid batch' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text,20261020));
 select * into b from public.screening_batches where id=p_id;
 if found then
  if b.job_id<>p_job or b.workspace_id<>j.workspace_id or b.manifest<>jsonb_build_object('fingerprint',md5(p_manifest::text),'count',jsonb_array_length(p_manifest)) then raise exception 'Batch changed' using errcode='PT409';end if;
  -- Replay preserves an administrator-adjusted cap; legacy client budgets are ignored.
  return b.id;
 end if;
 for f in select value from jsonb_array_elements(p_manifest) loop
  if jsonb_typeof(f->'name') is distinct from 'string' or length(f->>'name') not between 1 and 240 or f->>'name' !~* '\.(pdf|docx|doc|txt)$' or jsonb_typeof(f->'size') is distinct from 'number' or (f->>'size')::bigint not between 1 and 10485760 then raise exception 'Invalid resume manifest' using errcode='22023';end if;
  bytes:=bytes+(f->>'size')::bigint;
 end loop;
 if bytes>1073741824 then raise exception 'Batch exceeds 1 GB' using errcode='22023';end if;
 -- Existing candidate/storage/workspace quotas still apply to each insert.
 insert into public.screening_batches(id,job_id,workspace_id,created_by,manifest,budget_usd) values(p_id,p_job,j.workspace_id,auth.uid(),jsonb_build_object('fingerprint',md5(p_manifest::text),'count',jsonb_array_length(p_manifest)),5);
 for f in select value from jsonb_array_elements(p_manifest) loop
  insert into public.screening_batch_items(batch_id,ordinal,job_id,workspace_id,file_name,file_size) values(p_id,n,p_job,j.workspace_id,f->>'name',(f->>'size')::bigint);n:=n+1;
 end loop;
 return p_id;
end $$;

-- Application administrators must also have access to this batch's workspace.
-- A cap edit alone never queues or restarts an assessment.
create or replace function public.update_screening_budget(p_batch uuid,p_budget numeric) returns numeric
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;
begin
 if auth.uid() is null or not coalesce(public.is_app_admin(),false) then
  raise exception 'Application administrator required' using errcode='42501';
 end if;
 b:=public.require_screening_batch(p_batch);
 select * into b from public.screening_batches where id=p_batch for update;
 if p_budget is null or p_budget not between 0.01 and 100 or p_budget<b.budget_usd then
  raise exception 'Choose a budget at least as large as the current cap, up to $100.' using errcode='22023';
 end if;
 update public.screening_batches set budget_usd=p_budget where id=p_batch;
 return p_budget;
end $$;

revoke all on function public.create_screening_batch(uuid,uuid,jsonb,numeric),public.update_screening_budget(uuid,numeric) from public,anon;
grant execute on function public.create_screening_batch(uuid,uuid,jsonb,numeric),public.update_screening_budget(uuid,numeric) to authenticated;
commit;
