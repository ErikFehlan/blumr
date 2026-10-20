begin;
set local lock_timeout='5s';
-- Opt-in rollout. No paid work is admitted by an upload or a ranking request.
create table if not exists public.screening_feature_config(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into public.screening_feature_config values(true,false) on conflict do nothing;
alter table public.screening_feature_config enable row level security;
revoke all on public.screening_feature_config from public,anon,authenticated;
grant all on public.screening_feature_config to service_role;

create table if not exists public.screening_batches(
 id uuid primary key,job_id uuid not null,workspace_id uuid not null,created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),sealed boolean not null default false,
 manifest jsonb not null,source_version text,intelligence jsonb,screened_at timestamptz,
 selected_ids uuid[] not null default '{}',selection_version integer not null default 0,
 budget_usd numeric not null default 5 check(budget_usd between 0.01 and 100),
 foreign key(job_id,workspace_id) references public.jobs(id,workspace_id) on delete cascade,
 unique(id,job_id,workspace_id)
);
alter table public.screening_batches add column if not exists worker_requested_at timestamptz;
alter table public.screening_batches add column if not exists worker_claimed_at timestamptz;
create index if not exists screening_batches_job on public.screening_batches(workspace_id,job_id,created_at desc);
create table if not exists public.screening_batch_items(
 batch_id uuid not null,ordinal integer not null check(ordinal between 0 and 999),job_id uuid not null,workspace_id uuid not null,
 file_name text not null,file_size bigint not null check(file_size between 1 and 10485760),
 status text not null default 'pending' check(status in ('pending','saved','failed','excluded')),
 candidate_id uuid,content_hash text,error_code text,
 primary key(batch_id,ordinal),
 foreign key(batch_id,job_id,workspace_id) references public.screening_batches(id,job_id,workspace_id) on delete cascade,
 foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade
);
create index if not exists screening_batch_candidate on public.screening_batch_items(candidate_id);
create table if not exists public.screening_managed_candidates(
 candidate_id uuid primary key,job_id uuid not null,workspace_id uuid not null,content_hash text not null,
 foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade,
 unique(workspace_id,job_id,content_hash)
);
create table if not exists public.screening_finalists(
 candidate_id uuid primary key,batch_id uuid not null,job_id uuid not null,workspace_id uuid not null,
 revision text not null,
 foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade,
 foreign key(batch_id,job_id,workspace_id) references public.screening_batches(id,job_id,workspace_id) on delete cascade
);
create index if not exists screening_finalists_batch on public.screening_finalists(batch_id);
-- Monetary reservations are never refunded on ambiguous provider outcomes.
create table if not exists public.screening_ai_charges(
 lease_id uuid not null,ordinal integer not null, batch_id uuid not null references public.screening_batches(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 revision text not null,model text not null,reserved_usd numeric not null,
 input_rate numeric not null,cached_rate numeric not null,output_rate numeric not null,
 response_id text,input_tokens integer,cached_input_tokens integer,cache_write_tokens integer,output_tokens integer,actual_usd numeric,
 created_at timestamptz not null default now(),primary key(lease_id,ordinal),unique(response_id)
);
create index if not exists screening_charges_batch on public.screening_ai_charges(batch_id);
create index if not exists screening_charges_candidate on public.screening_ai_charges(candidate_id,revision);
do $$declare tab text;begin
 foreach tab in array array['screening_batches','screening_batch_items','screening_managed_candidates','screening_finalists','screening_ai_charges'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('drop policy if exists screening_member_read on public.%I',tab);
  execute format('create policy screening_member_read on public.%I for select to authenticated using(public.is_workspace_member(workspace_id))',tab);
 end loop;
end $$;

create or replace function public.screening_capabilities() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',auth.uid() is not null and enabled,'max_files',1000,'max_file_bytes',10485760,'max_batch_bytes',1073741824) from public.screening_feature_config;
$$;
create or replace function public.require_screening_batch(p_batch uuid) returns public.screening_batches
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;
begin
 select * into b from public.screening_batches where id=p_batch;
 if not found or (coalesce(auth.role(),'')<>'service_role' and (auth.uid() is null or not public.is_workspace_member(b.workspace_id))) then
  raise exception 'Batch unavailable' using errcode='42501';end if;
 return b;
end $$;
create or replace function public.resume_content_hash(p_text text) returns text
language sql immutable parallel safe set search_path='' as $$
 select encode(sha256(convert_to(lower(trim(regexp_replace(normalize(p_text,NFKC),'\s+',' ','g'))),'UTF8')),'hex');
$$;
create index if not exists screening_resume_dedupe on public.candidate_documents(job_id,public.resume_content_hash(extracted_text));

create or replace function public.create_screening_batch(p_id uuid,p_job uuid,p_manifest jsonb,p_budget numeric default 5) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.jobs;b public.screening_batches;f jsonb;n integer:=0;bytes bigint:=0;
begin
 select * into j from public.jobs where id=p_job;
 if not found or auth.uid() is null or not public.is_workspace_member(j.workspace_id) then raise exception 'Job unavailable' using errcode='42501';end if;
 if j.status<>'active' or not exists(select from public.screening_feature_config where enabled) then raise exception 'Bulk screening is unavailable' using errcode='55000';end if;
 if p_id is null or jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest) not between 1 and 1000 or p_budget is null or p_budget not between 0.01 and 100 then raise exception 'Invalid batch' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(j.workspace_id::text,20261020));
 select * into b from public.screening_batches where id=p_id;
 if found then
  if b.job_id<>p_job or b.workspace_id<>j.workspace_id or b.manifest<>jsonb_build_object('fingerprint',md5(p_manifest::text),'count',jsonb_array_length(p_manifest)) or b.budget_usd<>p_budget then raise exception 'Batch changed' using errcode='PT409';end if;
  return b.id;
 end if;
 for f in select value from jsonb_array_elements(p_manifest) loop
  if jsonb_typeof(f->'name') is distinct from 'string' or length(f->>'name') not between 1 and 240 or f->>'name' !~* '\.(pdf|docx|doc|txt)$' or jsonb_typeof(f->'size') is distinct from 'number' or (f->>'size')::bigint not between 1 and 10485760 then raise exception 'Invalid resume manifest' using errcode='22023';end if;
  bytes:=bytes+(f->>'size')::bigint;
 end loop;
 if bytes>1073741824 then raise exception 'Batch exceeds 1 GB' using errcode='22023';end if;
 -- Existing candidate/storage/workspace quotas still apply to each insert.
 insert into public.screening_batches(id,job_id,workspace_id,created_by,manifest,budget_usd) values(p_id,p_job,j.workspace_id,auth.uid(),jsonb_build_object('fingerprint',md5(p_manifest::text),'count',jsonb_array_length(p_manifest)),p_budget);
 for f in select value from jsonb_array_elements(p_manifest) loop
  insert into public.screening_batch_items(batch_id,ordinal,job_id,workspace_id,file_name,file_size) values(p_id,n,p_job,j.workspace_id,f->>'name',(f->>'size')::bigint);n:=n+1;
 end loop;
 return p_id;
end $$;

create or replace function public.prepare_screening_upload(p_batch uuid,p_ordinal integer,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;i public.screening_batch_items;c public.candidates;h text;k text;cid uuid;duplicate boolean:=false;
begin
 b:=public.require_screening_batch(p_batch);
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
 if b.sealed or p_status is null or p_status not in ('saved','failed','excluded') then raise exception 'Invalid item update' using errcode='22023';end if;
 select * into i from public.screening_batch_items where batch_id=p_batch and ordinal=p_ordinal for update;
 if not found then raise exception 'File unavailable' using errcode='22023';end if;
 if i.status='saved' and p_status<>'excluded' then return;end if;
 if p_status='saved' and not exists(select from public.candidate_documents d where d.candidate_id=i.candidate_id and d.workspace_id=b.workspace_id and d.job_id=b.job_id and public.resume_content_hash(d.extracted_text)=i.content_hash) then raise exception 'Resume not saved' using errcode='PT409';end if;
 update public.screening_batch_items set status=p_status,error_code=case when p_status='failed' then 'document_needs_attention' else null end where batch_id=p_batch and ordinal=p_ordinal;
 if p_status='saved' then
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
 if exists(select from public.screening_batch_items where batch_id=p_batch and status in ('pending','failed')) then raise exception 'Resolve or explicitly exclude unfinished files first' using errcode='PT409';end if;
 update public.screening_batches set sealed=true where id=p_batch;
 perform public.wake_job_reassessments(b.job_id);
end $$;

-- One canonical source bundle powers interactive and background screening.
create or replace function public.bulk_screening_source(p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;s jsonb;
begin
 b:=public.require_screening_batch(p_batch);
 select jsonb_build_object('workspaceId',b.workspace_id,'job',jsonb_build_object('id',j.id,'workspace_id',j.workspace_id,'title',j.title,'description',j.description,'criteria',j.criteria,'knockouts',j.knockouts,'manager_feedback',j.manager_feedback),
 'priorities',public.hiring_priorities_for_job(j.id),'lessons',public.assessment_lessons_for_job(j.id),
 'feedback',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'workspace_id',f.workspace_id,'job_id',f.job_id,'candidate_id',f.candidate_id,'updated_at',f.updated_at) order by f.id) from public.manager_feedback f where f.job_id=j.id),'[]'::jsonb),
 'assessments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'workspace_id',a.workspace_id,'job_id',a.job_id,'candidate_id',a.candidate_id,'assessment_type',a.assessment_type,'evidence',a.evidence,'created_at',a.created_at) order by a.created_at desc,a.id desc) from public.candidate_assessments a where a.job_id=j.id and a.assessment_type='manager_feedback'),'[]'::jsonb)) into s from public.jobs j where j.id=b.job_id;
 return s||jsonb_build_object('sourceVersion',md5(s::text),'batch',jsonb_build_object('id',b.id,'sealed',b.sealed,'source_version',b.source_version,'intelligence',b.intelligence,'screened_at',b.screened_at));
end $$;
create or replace function public.bulk_screening_page(p_batch uuid,p_key text,p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;
begin
 b:=public.require_screening_batch(p_batch);
 if p_limit not between 1 and 100 then raise exception 'Invalid page size';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (
  select c.id as candidate_id,d.id as document_id,d.extracted_text as resume_text,encode(sha256(convert_to(d.extracted_text,'UTF8')),'hex') as resume_hash
  from public.candidates c join lateral(select doc.* from public.candidate_documents doc where doc.candidate_id=c.id order by doc.created_at desc,doc.id desc limit 1) d on true
  where c.job_id=b.job_id and exists(select from public.screening_batch_items i where i.batch_id=b.id and i.status='saved' and i.candidate_id=c.id)
  and not exists(select from public.candidate_screening_cache s where s.candidate_id=c.id and s.document_id=d.id and s.rubric_key=p_key and s.resume_hash=encode(sha256(convert_to(d.extracted_text,'UTF8')),'hex'))
  order by c.id limit p_limit
 ) r),'[]'::jsonb);
end $$;
create or replace function public.save_bulk_screening_page(p_batch uuid,p_source text,p_intelligence jsonb,p_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;r jsonb;
begin
 b:=public.require_screening_batch(p_batch);
 if public.bulk_screening_source(p_batch)->>'sourceVersion' is distinct from p_source then return false;end if;
 if jsonb_array_length(p_rows)>100 then raise exception 'Invalid page';end if;
 -- Foreground refresh and background pages share one short, ordered write lock.
 perform pg_advisory_xact_lock(hashtextextended(b.job_id::text,202610202));
 for r in select value from jsonb_array_elements(p_rows) order by value->>'candidate_id' loop
  if not exists(select from public.screening_batch_items i join public.candidate_documents d on d.candidate_id=i.candidate_id and d.id=(r->>'document_id')::uuid
   where i.batch_id=p_batch and i.status='saved' and i.candidate_id=(r->>'candidate_id')::uuid and r->>'resume_hash'=encode(sha256(convert_to(d.extracted_text,'UTF8')),'hex')) then return false;end if;
  insert into public.candidate_screening_cache(candidate_id,job_id,workspace_id,document_id,rubric_key,resume_hash,result)
  values((r->>'candidate_id')::uuid,b.job_id,b.workspace_id,(r->>'document_id')::uuid,p_intelligence#>>'{rubric,key}',r->>'resume_hash',r->'result')
  on conflict(candidate_id) do update set document_id=excluded.document_id,rubric_key=excluded.rubric_key,resume_hash=excluded.resume_hash,result=excluded.result,updated_at=now()
  where (candidate_screening_cache.document_id,candidate_screening_cache.rubric_key,candidate_screening_cache.resume_hash) is distinct from (excluded.document_id,excluded.rubric_key,excluded.resume_hash);
 end loop;
 update public.screening_batches set source_version=p_source,intelligence=p_intelligence,screened_at=now() where id=p_batch;
 return true;
end $$;

create or replace function public.screening_finalist_input(p_candidate uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select public.reassessment_input(c.id)||jsonb_build_object('document_id',d.id,'file_name',d.file_name,'resume_text',d.extracted_text)
 from public.candidates c join public.jobs j on j.id=c.job_id
 join lateral(select doc.* from public.candidate_documents doc where doc.candidate_id=c.id order by doc.created_at desc,doc.id desc limit 1) d on true
 where c.id=p_candidate and j.status='active' and length(trim(d.extracted_text)) between 40 and 120000;
$$;
-- Preserve the existing intake function for ordinary individual uploads.
do $$begin
 if to_regprocedure('public.standard_resume_intake_input(uuid)') is null then alter function public.resume_intake_input(uuid) rename to standard_resume_intake_input;end if;
end $$;
create or replace function public.resume_intake_input(p_candidate uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare f public.screening_finalists;payload jsonb;
begin
 if exists(select from public.screening_managed_candidates where candidate_id=p_candidate) then
  select * into f from public.screening_finalists where candidate_id=p_candidate;
  if not found then return null;end if;
  payload:=public.screening_finalist_input(p_candidate);
  if public.resume_intake_revision(payload) is distinct from f.revision then return null;end if;
  return payload;
 end if;
 return public.standard_resume_intake_input(p_candidate);
end $$;

-- Unselected bulk resumes never enter the legacy intake fan-out. Revoke stale
-- consent permanently, while retaining completed results as revision-bound cache.
do $$begin
 if to_regprocedure('public.standard_enqueue_resume_intake(uuid)') is null then alter function public.enqueue_resume_intake(uuid) rename to standard_enqueue_resume_intake;end if;
end $$;
create or replace function public.enqueue_resume_intake(p_candidate uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select from public.screening_managed_candidates where candidate_id=p_candidate) then
  if not exists(select from public.screening_finalists f where f.candidate_id=p_candidate and f.revision=public.resume_intake_revision(public.screening_finalist_input(p_candidate))) then
   delete from public.screening_finalists where candidate_id=p_candidate;
   update public.resume_intake_tasks set status='cancelled',lease_id=null,lease_until=null,result=null,updated_at=now()
    where candidate_id=p_candidate and status in ('queued','processing','failed');
   return;
  end if;
 end if;
 perform public.standard_enqueue_resume_intake(p_candidate);
end $$;
revoke all on function public.enqueue_resume_intake(uuid),public.standard_enqueue_resume_intake(uuid) from public,anon,authenticated;

create or replace function public.select_screening_finalists(p_batch uuid,p_ids uuid[],p_source text,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;cid uuid;payload jsonb;rev text;t public.resume_intake_tasks;f public.screening_finalists;
begin
 b:=public.require_screening_batch(p_batch);
 -- Same lock order as the worker prevents selection/provider-start races.
 perform pg_advisory_xact_lock(2026100501);
 select * into b from public.screening_batches where id=p_batch for update;
 if b.selection_version<>p_version then
  if b.selected_ids=p_ids and b.source_version=p_source then return b.selection_version;end if;
  raise exception 'Shortlist changed. Refresh before saving.' using errcode='PT409';
 end if;
 if not exists(select from public.screening_feature_config where enabled) or p_ids is null or not b.sealed or cardinality(p_ids) not between 1 and 20 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) or array_position(p_ids,null) is not null
  or b.source_version is distinct from p_source or public.bulk_screening_source(p_batch)->>'sourceVersion' is distinct from p_source
  or b.intelligence->>'status' is distinct from 'ready' or b.intelligence->>'asOf'<>current_date::text
  or exists(select from public.screening_batch_items where batch_id=p_batch and status in ('pending','failed'))
  or jsonb_array_length(public.bulk_screening_page(p_batch,b.intelligence#>>'{rubric,key}',1))>0 then raise exception 'Finish current screening before selecting finalists' using errcode='PT409';end if;
 if exists(select from unnest(p_ids) x where not exists(select from public.screening_batch_items i join public.candidate_screening_cache s on s.candidate_id=i.candidate_id
  where i.batch_id=p_batch and i.status='saved' and i.candidate_id=x and s.rubric_key=b.intelligence#>>'{rubric,key}')) then raise exception 'Candidate unavailable' using errcode='42501';end if;
 -- Running requests finish safely; changing their membership cannot cancel a
 -- paid call and immediately acquire another. Review the result first.
 if exists(select from public.screening_finalists sf join public.assessment_worker_attempts a using(candidate_id) where sf.batch_id=p_batch and a.state<>'closed') then raise exception 'Assessments are running. Wait before changing the shortlist.' using errcode='PT409';end if;
 for cid in select unnest(p_ids) loop
  select * into f from public.screening_finalists where candidate_id=cid;
  if found and f.batch_id<>p_batch and exists(select from public.assessment_worker_attempts where candidate_id=cid and state<>'closed') then raise exception 'This candidate is already being assessed' using errcode='PT409';end if;
  payload:=public.screening_finalist_input(cid);rev:=public.resume_intake_revision(payload);
  if payload is null then raise exception 'Resume unavailable' using errcode='PT409';end if;
  select * into t from public.resume_intake_tasks where candidate_id=cid;
  -- Previously imported ordinary candidates can reuse a current assessment.
  -- Do not silently take over or cancel their existing independent workflow.
  if not exists(select from public.screening_managed_candidates where candidate_id=cid) and (t.revision is distinct from rev or t.status not in ('ready','approved')) then
   raise exception 'Review the existing individual assessment before including this duplicate' using errcode='PT409';end if;
  insert into public.screening_finalists(candidate_id,batch_id,job_id,workspace_id,revision) values(cid,p_batch,b.job_id,b.workspace_id,rev)
  on conflict(candidate_id) do update set batch_id=excluded.batch_id,revision=excluded.revision;
  if exists(select from public.screening_managed_candidates where candidate_id=cid) then
   perform public.enqueue_resume_intake(cid);
   update public.resume_intake_tasks set status='queued',attempts=0,error_code=null,next_run_at=now() where candidate_id=cid and status='failed' and error_code in ('screening_model_rate_missing','screening_not_enabled','usage_limit','ai_rate_limit','ai_unavailable');
  end if;
 end loop;
 -- Retain the original rules ranking in the cache; this is a recruiter override.
 delete from public.screening_finalists where batch_id=p_batch and not(candidate_id=any(p_ids));
 update public.resume_intake_tasks queued_task set status='cancelled',result=null,lease_id=null,lease_until=null
 where queued_task.candidate_id=any(b.selected_ids) and not(queued_task.candidate_id=any(p_ids)) and exists(select from public.screening_managed_candidates m where m.candidate_id=queued_task.candidate_id) and queued_task.status='queued';
 update public.screening_batches set selected_ids=p_ids,selection_version=selection_version+1 where id=p_batch returning selection_version into p_version;
 perform public.wake_job_reassessments(b.job_id);
 return p_version;
end $$;

create or replace function public.reserve_screening_ai(p_lease uuid,p_model text,p_input_bytes integer,p_output_tokens integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;f public.screening_finalists;b public.screening_batches;r public.ai_model_rates;amount numeric;call_ordinal integer;
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into a from public.assessment_worker_attempts where lease_id=p_lease for update;
 if not found or a.state in ('closed','uncertain') or a.lease_until<=now() then return jsonb_build_object('allowed',false,'code','worker_lease_lost');end if;
 if not exists(select from public.screening_managed_candidates where candidate_id=a.candidate_id) then return jsonb_build_object('allowed',true,'bulk',false);end if;
 if not exists(select from public.screening_feature_config where enabled) then return jsonb_build_object('allowed',false,'code','screening_not_enabled');end if;
 select * into f from public.screening_finalists where candidate_id=a.candidate_id;
 if not found or f.revision<>a.revision or public.resume_intake_input(a.candidate_id) is null then return jsonb_build_object('allowed',false,'code','screening_selection_changed');end if;
 select * into b from public.screening_batches where id=f.batch_id for update;
 select * into r from public.ai_model_rates where model=p_model;
 if not found or r.updated_at<now()-interval '30 days' or r.input_usd_per_million is null or r.output_usd_per_million is null then return jsonb_build_object('allowed',false,'code','screening_model_rate_missing');end if;
 if p_input_bytes not between 1 and 800000 or p_output_tokens not between 1 and 16000 then return jsonb_build_object('allowed',false,'code','input_too_large');end if;
 call_ordinal:=a.calls+1;
 if exists(select from public.screening_ai_charges c where c.lease_id=p_lease and c.ordinal=call_ordinal) then return jsonb_build_object('allowed',true,'bulk',true);end if;
 -- UTF-8 bytes conservatively bound text tokens. The caller includes schema /
 -- instruction overhead. A validation repair needs its own reservation.
 amount:=(p_input_bytes*r.input_usd_per_million*1.25*(case when p_input_bytes>272000 then 2 else 1 end)+p_output_tokens*r.output_usd_per_million*(case when p_input_bytes>272000 then 1.5 else 1 end))/1000000;
 if amount+(select coalesce(sum(reserved_usd),0) from public.screening_ai_charges where batch_id=b.id)>b.budget_usd
  or (select count(*) from public.screening_ai_charges where batch_id=b.id)>=40
  or (select count(*) from public.screening_ai_charges where candidate_id=a.candidate_id and revision=a.revision)>=2 then return jsonb_build_object('allowed',false,'code','screening_budget_limit');end if;
 insert into public.screening_ai_charges(lease_id,ordinal,batch_id,candidate_id,workspace_id,revision,model,reserved_usd,input_rate,cached_rate,output_rate)
 values(p_lease,call_ordinal,b.id,a.candidate_id,a.workspace_id,a.revision,p_model,amount,r.input_usd_per_million,coalesce(r.cached_input_usd_per_million,r.input_usd_per_million),r.output_usd_per_million);
 return jsonb_build_object('allowed',true,'bulk',true,'reserved_usd',amount);
end $$;
create or replace function public.record_screening_ai_usage(p_lease uuid,p_response jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;it integer;ot integer;ct integer;cw integer;
begin
 select * into a from public.assessment_worker_attempts where lease_id=p_lease;
 if not found or nullif(p_response->>'id','') is null then return;end if;
 it:=(p_response#>>'{usage,input_tokens}')::integer;ot:=(p_response#>>'{usage,output_tokens}')::integer;ct:=coalesce((p_response#>>'{usage,input_tokens_details,cached_tokens}')::integer,0);
 cw:=coalesce((p_response#>>'{usage,input_tokens_details,cache_write_tokens}')::integer,0);
 if it is null or ot is null or it<0 or ot<0 or ct not between 0 and it or cw not between 0 and it-ct then return;end if;
 update public.screening_ai_charges set response_id=p_response->>'id',input_tokens=it,output_tokens=ot,cached_input_tokens=ct,cache_write_tokens=cw,
 actual_usd=(((it-ct-cw)*input_rate+ct*cached_rate+cw*input_rate*1.25)*(case when it>272000 then 2 else 1 end)+ot*output_rate*(case when it>272000 then 1.5 else 1 end))/1000000
 where lease_id=p_lease and ordinal=a.calls and model=p_response->>'model';
end $$;

create or replace function public.screening_batch_snapshot(p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;s jsonb;
begin
 b:=public.require_screening_batch(p_batch);s:=public.bulk_screening_source(p_batch);
 return jsonb_build_object('batch',to_jsonb(b)-'manifest','source_current',b.source_version=s->>'sourceVersion' and b.intelligence->>'asOf'=current_date::text,
 'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.ordinal) from public.screening_batch_items i where i.batch_id=p_batch),'[]'::jsonb),
 'candidates',coalesce((select jsonb_agg(jsonb_build_object('candidateId',c.id,'name',c.name,'result',case when k.document_id=d.id and k.resume_hash=encode(sha256(convert_to(d.extracted_text,'UTF8')),'hex') and k.rubric_key=b.intelligence#>>'{rubric,key}' then k.result else null end,
  'assessment',case when c.id=any(b.selected_ids) then case when t.revision=public.resume_intake_revision(public.screening_finalist_input(c.id)) then jsonb_build_object('status',t.status,'result',t.result,'revision',t.revision,'error',t.error_code) else null end else null end))
  from public.candidates c left join public.candidate_screening_cache k on k.candidate_id=c.id
  left join lateral(select doc.* from public.candidate_documents doc where doc.candidate_id=c.id order by doc.created_at desc,doc.id desc limit 1) d on true
  left join public.resume_intake_tasks t on t.candidate_id=c.id
  where exists(select from public.screening_batch_items i where i.batch_id=p_batch and i.status='saved' and i.candidate_id=c.id)),'[]'::jsonb),
 'cost', (select jsonb_build_object('provider_calls_reserved',count(*),'reserved_usd',coalesce(sum(reserved_usd),0),'actual_usd',coalesce(sum(actual_usd),0),'unsettled_calls',count(*) filter(where actual_usd is null),'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),'budget_usd',b.budget_usd) from public.screening_ai_charges where batch_id=p_batch));
end $$;
create or replace function public.next_screening_batches(p_job uuid default null) returns jsonb
language sql volatile security invoker set search_path='' as $$
 with eligible as (
 select b.id from public.screening_batches b join public.jobs j on j.id=b.job_id
 where j.status='active' and (p_job is null or b.job_id=p_job) and exists(select from public.screening_feature_config where enabled)
 and exists(select from public.screening_batch_items i where i.batch_id=b.id and i.status='saved')
 and (b.screened_at is null or b.screened_at<now()-interval '1 minute')
 and (b.worker_claimed_at is null or b.worker_claimed_at<now()-interval '2 minutes')
 order by b.screened_at nulls first,b.created_at limit 2 for update of b skip locked
 ), claimed as (
 update public.screening_batches b set worker_claimed_at=now() from eligible e where b.id=e.id returning b.id
 ) select coalesce(jsonb_agg(id),'[]'::jsonb) from claimed;
$$;

-- Private functions are never a second client write path around authorization.
revoke all on function public.require_screening_batch(uuid),public.standard_resume_intake_input(uuid),public.resume_content_hash(text),public.screening_finalist_input(uuid),public.resume_intake_input(uuid),public.save_bulk_screening_page(uuid,text,jsonb,jsonb),public.reserve_screening_ai(uuid,text,integer,integer),public.record_screening_ai_usage(uuid,jsonb),public.next_screening_batches(uuid) from public,anon,authenticated;
grant execute on function public.save_bulk_screening_page(uuid,text,jsonb,jsonb),public.reserve_screening_ai(uuid,text,integer,integer),public.record_screening_ai_usage(uuid,jsonb),public.next_screening_batches(uuid) to service_role;
revoke all on function public.screening_capabilities(),public.create_screening_batch(uuid,uuid,jsonb,numeric),public.prepare_screening_upload(uuid,integer,text),public.update_screening_item(uuid,integer,text),public.seal_screening_batch(uuid),public.bulk_screening_source(uuid),public.bulk_screening_page(uuid,text,integer),public.select_screening_finalists(uuid,uuid[],text,integer),public.screening_batch_snapshot(uuid) from public,anon;
grant execute on function public.screening_capabilities(),public.create_screening_batch(uuid,uuid,jsonb,numeric),public.prepare_screening_upload(uuid,integer,text),public.update_screening_item(uuid,integer,text),public.seal_screening_batch(uuid),public.bulk_screening_source(uuid),public.bulk_screening_page(uuid,text,integer),public.select_screening_finalists(uuid,uuid[],text,integer),public.screening_batch_snapshot(uuid) to authenticated;
grant execute on function public.bulk_screening_source(uuid),public.bulk_screening_page(uuid,text,integer),public.screening_batch_snapshot(uuid) to service_role;

create or replace function public.enqueue_job_reassessments(p_job uuid,p_candidate uuid default null,p_reason text default 'Job priorities changed') returns integer
language plpgsql security definer set search_path='' as $$
declare c record; payload jsonb; shared_revision text; n integer:=0; affected integer; active boolean;
begin
  select status='active' into active from public.jobs where id=p_job;
  if active is distinct from true then
    update public.job_reassessment_tasks set status='cancelled',lease_id=null,lease_until=null,updated_at=now()
      where job_id=p_job and status in ('queued','processing');
    return 0;
  end if;
  shared_revision:=md5(public.reassessment_job_input(p_job)::text);
  for c in select id,workspace_id,role from public.candidates where job_id=p_job and not exists(select from public.screening_managed_candidates m where m.candidate_id=candidates.id) and (p_candidate is null or id=p_candidate) order by id loop
    payload:=public.reassessment_input(c.id);
    -- Initial intake owns unreviewed resumes. Feedback still updates its revision,
    -- but must not start a second model pipeline against an empty profile.
    if c.role='Resume awaiting analysis' or
      (coalesce(payload#>'{candidate,resumeIntake}','null'::jsonb)<>'null'::jsonb
       and payload#>>'{candidate,resumeIntake,reviewedAt}' is null
       and coalesce(payload#>'{candidate,aiReview}','null'::jsonb)='null'::jsonb) then
      update public.job_reassessment_tasks set status='cancelled',lease_id=null,lease_until=null,result=null,updated_at=now()
      where candidate_id=c.id and status in ('queued','processing','ready','failed');
      continue;
    end if;
    insert into public.job_reassessment_tasks(candidate_id,job_id,workspace_id,revision,job_revision,input,reason,next_run_at)
      values(c.id,p_job,c.workspace_id,md5(payload::text),shared_revision,payload,p_reason,now()+interval '3 seconds')
    on conflict(candidate_id) do update set revision=excluded.revision,job_revision=excluded.job_revision,input=excluded.input,
      reason=excluded.reason,status='queued',attempts=0,next_run_at=excluded.next_run_at,lease_id=null,lease_until=null,
      result=null,error_code=null,reviewed_at=null,reviewed_by=null,updated_at=now()
      where job_reassessment_tasks.revision is distinct from excluded.revision or job_reassessment_tasks.status='cancelled';
    get diagnostics affected=row_count;n:=n+affected;
  end loop;
  if n>0 then perform public.wake_job_reassessments(p_job); end if;
  return n;
end $$;


create or replace function public.begin_assessment_provider(p_lease uuid,p_call uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;
begin
 perform pg_advisory_xact_lock(2026100501);
 if p_call is null or not public.heartbeat_assessment_work(p_lease) then return false;end if;
 select * into a from public.assessment_worker_attempts where lease_id=p_lease for update;
 -- A repeated start acknowledgement must never authorize a second network call.
 if a.provider_pending or a.calls>=(case when a.kind='intake' then 2 else 1 end) or a.provider_call=p_call then return false;end if;
 if exists(select from public.screening_managed_candidates where candidate_id=a.candidate_id) and (not exists(select from public.screening_feature_config where enabled) or public.resume_intake_input(a.candidate_id) is null or not exists(select from public.screening_ai_charges c join public.screening_finalists f using(candidate_id) where c.lease_id=p_lease and c.ordinal=a.calls+1 and c.revision=a.revision and f.revision=a.revision and c.batch_id=f.batch_id)) then return false;end if;
 update public.assessment_worker_attempts set state='provider',provider_pending=true,provider_call=p_call,
  provider_started_at=coalesce(provider_started_at,now()),calls=calls+1 where lease_id=p_lease;
 return true;
end $$;


grant execute on function public.resume_intake_input(uuid),public.resume_intake_revision(jsonb) to service_role;
-- The immutable expression index evaluates under the inserting user. This
-- function hashes only its argument and reads no records.
grant execute on function public.resume_content_hash(text) to authenticated,service_role;

-- Include batch progress and advisory results in the existing authenticated export.
do $$begin
 if to_regprocedure('public.standard_account_export()') is null then alter function public.get_account_export() rename to standard_account_export;end if;
end $$;
create or replace function public.get_account_export() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;tab text;rows jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 result:=public.standard_account_export();
 foreach tab in array array['screening_batches','screening_batch_items','screening_managed_candidates','screening_finalists','screening_ai_charges','job_screening_rubrics','candidate_screening_cache'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.%I r where public.is_workspace_member(r.workspace_id)',tab) into rows;
  result:=result||jsonb_build_object(tab,rows);
 end loop;
 return result;
end $$;
revoke all on function public.standard_account_export() from public,anon,authenticated;
revoke all on function public.get_account_export() from public,anon;
grant execute on function public.get_account_export() to authenticated;


-- Verified 2026-10-20 against https://developers.openai.com/api/docs/models/gpt-5.6-sol
-- and /api/docs/pricing. Preserve administrator-set rates. Rates older than 30
-- days fail closed for bulk admission; no indefinite promotional-price assumption.
insert into public.ai_model_rates(model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million,updated_at)
 values('gpt-5.6-sol',4,0.4,20,'2026-10-20T00:00:00Z') on conflict(model) do nothing;

create or replace function public.intake_source_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare j uuid;c record;
begin
 if tg_table_name='jobs' then
  if row(new.title,new.description,new.criteria,new.manager_feedback,new.knockouts,new.weights,new.status)
    is not distinct from row(old.title,old.description,old.criteria,old.manager_feedback,old.knockouts,old.weights,old.status) then return new;end if;
  j:=new.id;
 elsif tg_op='DELETE' then j:=old.job_id;else j:=new.job_id;end if;
 -- Revisions decide which candidates changed. Candidate-only notes do not
 -- invalidate another candidate; approved preferences do.
 for c in select id from public.candidates where job_id=j and
  (role='Resume awaiting analysis' or exists(select 1 from public.resume_intake_tasks t where t.candidate_id=candidates.id))
  and (not exists(select from public.screening_managed_candidates m where m.candidate_id=candidates.id)
   or exists(select from public.screening_finalists f where f.candidate_id=candidates.id)) loop
  perform public.enqueue_resume_intake(c.id);
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;

commit;
