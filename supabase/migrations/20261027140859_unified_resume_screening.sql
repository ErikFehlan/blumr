begin;
set local lock_timeout='5s';
-- Uploads are durable drafts. Only the explicit Analyze action admits work.
alter table public.screening_batches add column if not exists defer_analysis boolean not null default false;
alter table public.screening_batches add column if not exists analysis_requested_at timestamptz;
alter table public.screening_batches add column if not exists auto_selected boolean not null default false;

create or replace function public.create_resume_upload(p_id uuid,p_job uuid,p_manifest jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 perform public.create_screening_batch(p_id,p_job,p_manifest,5);
 update public.screening_batches set defer_analysis=true where id=p_id;
 return p_id;
end $$;

-- An expected offset makes retries idempotent and competing tabs detectable.
create or replace function public.append_resume_upload(p_batch uuid,p_offset integer,p_manifest jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;f jsonb;n integer;count_now integer;bytes bigint;
begin
 b:=public.require_screening_batch(p_batch);
 select * into b from public.screening_batches where id=p_batch for update;
 if b.sealed or not exists(select from public.jobs where id=b.job_id and status='active') then raise exception 'This upload has already started. Refresh before adding files.' using errcode='PT409';end if;
 if p_offset is null or p_offset<0 or jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest) not between 1 and 1000 then raise exception 'Invalid resume manifest' using errcode='22023';end if;
 select count(*),coalesce(sum(file_size),0) into count_now,bytes from public.screening_batch_items where batch_id=p_batch;
 if p_offset<count_now then
  if count_now=p_offset+jsonb_array_length(p_manifest) and not exists(select from jsonb_array_elements(p_manifest) with ordinality x(f,position) left join public.screening_batch_items i on i.batch_id=p_batch and i.ordinal=p_offset+x.position-1 where i.file_name is distinct from x.f->>'name' or i.file_size is distinct from (x.f->>'size')::bigint) then return;end if;
  raise exception 'The upload list changed. Refresh before adding files.' using errcode='PT409';
 end if;
 if p_offset<>count_now or count_now+jsonb_array_length(p_manifest)>1000 then raise exception 'Choose up to 1,000 resumes per upload.' using errcode='22023';end if;
 n:=p_offset;
 for f in select value from jsonb_array_elements(p_manifest) loop
  if jsonb_typeof(f->'name') is distinct from 'string' or length(f->>'name') not between 1 and 240 or f->>'name' !~* '\.(pdf|docx|doc|txt)$' or jsonb_typeof(f->'size') is distinct from 'number' or (f->>'size')::bigint not between 1 and 10485760 then raise exception 'Invalid resume manifest' using errcode='22023';end if;
  bytes:=bytes+(f->>'size')::bigint;
  insert into public.screening_batch_items(batch_id,ordinal,job_id,workspace_id,file_name,file_size) values(p_batch,n,b.job_id,b.workspace_id,f->>'name',(f->>'size')::bigint);n:=n+1;
 end loop;
 if bytes>1073741824 then raise exception 'Upload exceeds 1 GB' using errcode='22023';end if;
 update public.screening_batches set manifest=jsonb_build_object('count',n) where id=p_batch;
end $$;

create or replace function public.start_resume_analysis(p_batch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;
begin
 b:=public.require_screening_batch(p_batch);
 select * into b from public.screening_batches where id=p_batch for update;
 if not exists(select from public.jobs where id=b.job_id and status='active') or not exists(select from public.screening_feature_config where enabled) then raise exception 'Choose an open job to analyze resumes.' using errcode='PT409';end if;
 if b.analysis_requested_at is not null then return;end if;
 if not exists(select from public.screening_batch_items where batch_id=p_batch and status='saved') or exists(select from public.screening_batch_items where batch_id=p_batch and status in ('pending','failed')) then raise exception 'Finish uploading or remove files that need attention before analyzing.' using errcode='PT409';end if;
 update public.screening_batches set sealed=true,analysis_requested_at=now(),worker_claimed_at=null,worker_requested_at=now(),screened_at=null where id=p_batch;
 perform public.wake_job_reassessments(b.job_id);
end $$;

create or replace function public.prepare_screening_upload(p_batch uuid,p_ordinal integer,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;i public.screening_batch_items;c public.candidates;h text;k text;cid uuid;duplicate boolean:=false;
begin
 b:=public.require_screening_batch(p_batch);
 perform pg_advisory_xact_lock(hashtextextended(b.job_id::text,20261020));
 select * into b from public.screening_batches where id=p_batch for update;
 if b.sealed or not exists(select from public.jobs where id=b.job_id and status='active') then raise exception 'Batch closed' using errcode='PT409';end if;
 if p_text is null or length(trim(p_text)) not between 40 and 120000 then raise exception 'Resume needs review' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(b.job_id::text,20261020));
 select * into i from public.screening_batch_items where batch_id=p_batch and ordinal=p_ordinal for update;
 if not found or i.status='excluded' then raise exception 'File unavailable' using errcode='22023';end if;
 h:=public.resume_content_hash(p_text);
 if i.content_hash is not null and i.content_hash<>h then raise exception 'Choose the original file for this item' using errcode='PT409';end if;
 select c0.* into c from public.candidates c0 where c0.job_id=b.job_id and c0.workspace_id=b.workspace_id and
  (exists(select from public.candidate_documents d where d.candidate_id=c0.id and d.job_id=b.job_id and public.resume_content_hash(d.extracted_text)=h)
   or exists(select from public.screening_managed_candidates m where m.candidate_id=c0.id and m.content_hash=h)) order by c0.id limit 1;
 if found then cid:=c.id;duplicate:=true;
 else
  -- Match the existing browser identity to make interrupted legacy uploads safe.
  k:=public.resume_content_hash(b.workspace_id::text||'|'||b.job_id::text||'|'||h);
  cid:=(substr(k,1,8)||'-'||substr(k,9,4)||'-5'||substr(k,14,3)||'-a'||substr(k,18,3)||'-'||substr(k,21,12))::uuid;
  insert into public.candidates(id,workspace_id,job_id,name,role,stage,resume_jd_score,jd_score,original_manager_score,manager_score,recommendation,primary_signal,created_by)
  values(cid,b.workspace_id,b.job_id,left(regexp_replace(i.file_name,'\.[^.]+$',''),160),'Resume awaiting analysis','Sourced',0,0,0,0,'Screen First','Awaiting rules-based screening.',auth.uid()) on conflict(id) do nothing;
  select * into c from public.candidates where id=cid and job_id=b.job_id and workspace_id=b.workspace_id;
  if not found then raise exception 'Candidate identity conflict' using errcode='PT409';end if;
  insert into public.screening_managed_candidates values(cid,b.job_id,b.workspace_id,h) on conflict do nothing;
 end if;
 update public.screening_batch_items set candidate_id=cid,content_hash=h,status='pending',error_code=null where batch_id=p_batch and ordinal=p_ordinal and status<>'saved';
 return jsonb_build_object('candidate_id',cid,'hash',h,'duplicate',duplicate,'stored',exists(select from public.candidate_documents d where d.candidate_id=cid and public.resume_content_hash(d.extracted_text)=h));
end $$;
create or replace function public.update_screening_item(p_batch uuid,p_ordinal integer,p_status text) returns void
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;i public.screening_batch_items;
begin
 b:=public.require_screening_batch(p_batch);
 select * into b from public.screening_batches where id=p_batch for update;
 if b.sealed or p_status is null or p_status not in ('saved','failed','excluded') then raise exception 'Invalid item update' using errcode='22023';end if;
 select * into i from public.screening_batch_items where batch_id=p_batch and ordinal=p_ordinal for update;
 if not found then raise exception 'File unavailable' using errcode='22023';end if;
 if i.status='saved' and p_status<>'excluded' then return;end if;
 if p_status='saved' and not exists(select from public.candidate_documents d where d.candidate_id=i.candidate_id and d.workspace_id=b.workspace_id and d.job_id=b.job_id and public.resume_content_hash(d.extracted_text)=i.content_hash) then raise exception 'Resume not saved' using errcode='PT409';end if;
 update public.screening_batch_items set status=p_status,error_code=case when p_status='failed' then 'document_needs_attention' else null end where batch_id=p_batch and ordinal=p_ordinal;
 if p_status='saved' and not b.defer_analysis then
  -- Coalesce upload notifications; a 500-file import must not launch 500 workers.
  update public.screening_batches set worker_requested_at=now() where id=p_batch
   and (worker_requested_at is null or worker_requested_at<now()-interval '15 seconds');
  if found then perform public.wake_job_reassessments(b.job_id);end if;
 end if;
end $$;
create or replace function public.seal_screening_batch(p_batch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;
begin
 b:=public.require_screening_batch(p_batch);
 select * into b from public.screening_batches where id=p_batch for update;
 if b.defer_analysis and b.analysis_requested_at is null then raise exception 'Use Analyze resumes to start this upload.' using errcode='PT409';end if;
 if exists(select from public.screening_batch_items where batch_id=p_batch and status in ('pending','failed')) then raise exception 'Resolve or explicitly exclude unfinished files first' using errcode='PT409';end if;
 update public.screening_batches set sealed=true where id=p_batch;
 perform public.wake_job_reassessments(b.job_id);
end $$;
create or replace function public.bulk_screening_source(p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;s jsonb;
begin
 b:=public.require_screening_batch(p_batch);
 select jsonb_build_object('workspaceId',b.workspace_id,'job',jsonb_build_object('id',j.id,'workspace_id',j.workspace_id,'title',j.title,'description',j.description,'criteria',j.criteria,'knockouts',j.knockouts,'manager_feedback',j.manager_feedback),
 'priorities',public.hiring_priorities_for_job(j.id),'lessons',public.assessment_lessons_for_job(j.id),
 'feedback',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'workspace_id',f.workspace_id,'job_id',f.job_id,'candidate_id',f.candidate_id,'updated_at',f.updated_at) order by f.id) from public.manager_feedback f where f.job_id=j.id),'[]'::jsonb),
 'assessments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'workspace_id',a.workspace_id,'job_id',a.job_id,'candidate_id',a.candidate_id,'assessment_type',a.assessment_type,'evidence',a.evidence,'created_at',a.created_at) order by a.created_at desc,a.id desc) from public.candidate_assessments a where a.job_id=j.id and a.assessment_type='manager_feedback'),'[]'::jsonb)) into s from public.jobs j where j.id=b.job_id;
 return s||jsonb_build_object('sourceVersion',md5(s::text),'batch',jsonb_build_object('defer_analysis',b.defer_analysis,'analysis_requested_at',b.analysis_requested_at,'auto_selected',b.auto_selected,'id',b.id,'sealed',b.sealed,'source_version',b.source_version,'intelligence',b.intelligence,'screened_at',b.screened_at));
end $$;
-- Only the trusted worker chooses the bounded deep-assessment pool. The existing
-- selection RPC still enforces source freshness, scope, revisions and budgets.
create or replace function public.auto_start_resume_analysis(p_batch uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b public.screening_batches;ids uuid[];
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into b from public.screening_batches where id=p_batch for update;
 if not found or b.analysis_requested_at is null or b.auto_selected then return false;end if;
 if b.intelligence->>'status' is distinct from 'ready' or b.source_version is distinct from public.bulk_screening_source(p_batch)->>'sourceVersion' or jsonb_array_length(public.bulk_screening_page(p_batch,b.intelligence#>>'{rubric,key}',1))>0 then return false;end if;
 select array_agg(candidate_id order by band,score desc,candidate_id) into ids from (
  select distinct i.candidate_id,case k.result->>'requiredStatus' when 'not_applicable' then 0 when 'evidenced' then 0 when 'conflicting' then 2 else 1 end as band,(k.result->>'score')::numeric as score
  from public.screening_batch_items i join public.candidate_screening_cache k on k.candidate_id=i.candidate_id
  where i.batch_id=p_batch and i.status='saved' and k.rubric_key=b.intelligence#>>'{rubric,key}'
  order by band,score desc,i.candidate_id limit 20
 ) ranked
 where exists(select from public.screening_managed_candidates m where m.candidate_id=ranked.candidate_id)
 or exists(select from public.resume_intake_tasks t where t.candidate_id=ranked.candidate_id and t.status in ('ready','approved') and t.revision=public.resume_intake_revision(public.screening_finalist_input(ranked.candidate_id)));
 if cardinality(ids)>0 then
  perform public.select_screening_finalists(p_batch,ids,b.source_version,b.selection_version);
  update public.screening_batches set auto_selected=true where id=p_batch;
  return true;
 end if;
 -- Existing individual assessments keep their own durable tasks.
 update public.screening_batches set auto_selected=true where id=p_batch;
 return true;
end $$;

-- A shared candidate screen can read its evidence even outside the first 40.
create or replace function public.get_resume_analysis(p_candidate uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.candidates;b public.screening_batches;t public.resume_intake_tasks;d public.candidate_documents;k public.candidate_screening_cache;fresh boolean;
begin
 select * into c from public.candidates where id=p_candidate;
 if not found or auth.uid() is null or not public.is_workspace_member(c.workspace_id) then raise exception 'Candidate unavailable' using errcode='42501';end if;
 select * into d from public.candidate_documents where candidate_id=c.id order by created_at desc,id desc limit 1;
 select sb.* into b from public.screening_batches sb join public.screening_batch_items i on i.batch_id=sb.id where i.candidate_id=c.id and i.status='saved' order by sb.created_at desc limit 1;
 select * into k from public.candidate_screening_cache where candidate_id=c.id;
 if b.id is null then return jsonb_build_object('stored',d.id is not null,'fileName',d.file_name);end if;
 fresh:=b.source_version=public.bulk_screening_source(b.id)->>'sourceVersion' and b.intelligence->>'asOf'=current_date::text and k.rubric_key=b.intelligence#>>'{rubric,key}' and k.document_id=d.id and k.resume_hash=encode(sha256(convert_to(d.extracted_text,'UTF8')),'hex');
 select * into t from public.resume_intake_tasks where candidate_id=c.id and revision=public.resume_intake_revision(public.screening_finalist_input(c.id));
 return jsonb_build_object('batchId',b.id,'started',b.analysis_requested_at is not null or cardinality(b.selected_ids)>0,'stored',d.id is not null,'fileName',d.file_name,'rules',case when fresh then k.result else null end,'assessment',case when t.candidate_id is not null then jsonb_build_object('status',t.status,'result',t.result,'revision',t.revision,'error',t.error_code) else null end);
end $$;

create or replace function public.next_screening_batches(p_job uuid default null) returns jsonb
language sql volatile security invoker set search_path='' as $$
 with eligible as (
 select b.id from public.screening_batches b join public.jobs j on j.id=b.job_id
 where j.status='active' and (p_job is null or b.job_id=p_job) and exists(select from public.screening_feature_config where enabled)
 and (not b.defer_analysis or b.analysis_requested_at is not null)
 and exists(select from public.screening_batch_items i where i.batch_id=b.id and i.status='saved')
 and (b.screened_at is null or b.screened_at<now()-interval '1 minute')
 and (b.worker_claimed_at is null or b.worker_claimed_at<now()-interval '2 minutes')
 order by b.screened_at nulls first,b.created_at limit 2 for update of b skip locked
 ), claimed as (
 update public.screening_batches b set worker_claimed_at=now() from eligible e where b.id=e.id returning b.id
 ) select coalesce(jsonb_agg(id),'[]'::jsonb) from claimed;
$$;
revoke all on function public.create_resume_upload(uuid,uuid,jsonb),public.append_resume_upload(uuid,integer,jsonb),public.start_resume_analysis(uuid),public.get_resume_analysis(uuid) from public,anon;
grant execute on function public.create_resume_upload(uuid,uuid,jsonb),public.append_resume_upload(uuid,integer,jsonb),public.start_resume_analysis(uuid),public.get_resume_analysis(uuid) to authenticated;
revoke all on function public.auto_start_resume_analysis(uuid) from public,anon,authenticated;
grant execute on function public.auto_start_resume_analysis(uuid),public.select_screening_finalists(uuid,uuid[],text,integer),public.resume_intake_revision(jsonb),public.screening_finalist_input(uuid) to service_role;
commit;
