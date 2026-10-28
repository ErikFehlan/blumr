-- Integration is opt-in by subscription account. Unenrolled beta users retain
-- their existing workflow. Do not provision accounts in production yet.
begin;
set local lock_timeout='5s';
alter table public.screening_batches add column if not exists analysis_actor_id uuid references auth.users(id) on delete set null;
alter table public.screening_batches add column if not exists analysis_error_code text;

create or replace function public.subscription_scope_managed(p_workspace uuid,p_actor uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select from public.subscription_accounts where user_id=p_actor)
 or (p_actor is null and exists(select from public.subscription_accounts a join public.workspace_members m on m.user_id=a.user_id where m.workspace_id=p_workspace));
$$;

-- Scope is rechecked on every read; this hash contains no candidate text.
create or replace function public.subscription_rules_source(p_job uuid,p_actor uuid) returns text
language plpgsql stable security invoker set search_path='' as $$
declare j public.jobs;
begin
 select * into j from public.jobs where id=p_job;
 if j.id is null or not exists(select from public.workspace_members where workspace_id=j.workspace_id and user_id=p_actor) then raise exception 'screening_forbidden' using errcode='42501';end if;
 return md5(jsonb_build_object('job',to_jsonb(j)-'updated_at','priorities',public.hiring_priorities_for_job(j.id),
  'lessons',public.assessment_lessons_for_job(j.id),
  'feedback',(select jsonb_agg(to_jsonb(f) order by f.id) from public.manager_feedback f where f.job_id=j.id),
  'assessments',(select jsonb_agg(to_jsonb(a) order by a.id) from public.candidate_assessments a where a.job_id=j.id and a.assessment_type='manager_feedback'))::text);
end$$;

-- Called within the same transaction that persists validated rules results.
-- Changing only a display/cache date does not consume another evaluation.
create or replace function public.meter_subscription_rules(p_workspace uuid,p_actor uuid,p_job uuid,p_billing_key text,p_rows jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare r jsonb;admission jsonb;attempt uuid;key text;
begin
 if not public.subscription_scope_managed(p_workspace,p_actor) then return;end if;
 admission:=public.subscription_entitlement(p_workspace,p_actor);
 if admission->>'allowed' is distinct from 'true' then raise exception '%',admission->>'code' using errcode='42501';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'invalid_screening_meter' using errcode='22023';end if;
 -- Review-only pages and warm caches contain no new completed evaluations.
 if jsonb_array_length(p_rows)=0 then return;end if;
 if p_billing_key is null or p_billing_key!~'^[a-f0-9]{64}$' then raise exception 'invalid_screening_meter' using errcode='22023';end if;
 for r in select value from jsonb_array_elements(p_rows) order by value->>'candidate_id' loop
  if not exists(select from public.candidate_screening_cache c where c.candidate_id=(r->>'candidate_id')::uuid and c.job_id=p_job and c.workspace_id=p_workspace and c.document_id=(r->>'document_id')::uuid and c.resume_hash=r->>'resume_hash' and c.result=r->'result') then raise exception 'screening_result_not_saved' using errcode='PT409';end if;
  key:=encode(sha256(convert_to(jsonb_build_array('rules-v1',p_workspace,p_job,r->>'candidate_id',r->>'resume_hash',p_billing_key)::text,'UTF8')),'hex');
  attempt:=gen_random_uuid();admission:=public.reserve_subscription_evaluation(p_workspace,p_actor,'rules',key,attempt);
  if admission->>'allowed' is distinct from 'true' then raise exception '%',admission->>'code' using errcode='PT429';end if;
  if admission->>'state'='reserved' and not public.settle_subscription_evaluation((admission->>'reservation_id')::uuid,attempt,'succeeded',(r->>'candidate_id')::uuid) then raise exception 'screening_settlement_failed';end if;
 end loop;
end$$;

create or replace function public.save_subscription_rules_results(p_job uuid,p_actor uuid,p_source text,p_intelligence jsonb,p_rows jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.jobs;r jsonb;d public.candidate_documents;
begin
 select * into j from public.jobs where id=p_job for share;
 if j.id is null or j.status<>'active' or public.subscription_rules_source(p_job,p_actor) is distinct from p_source then raise exception 'screening_source_changed' using errcode='PT409';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 or p_intelligence->>'status' is distinct from 'ready' then raise exception 'invalid_screening_result' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(j.id::text,202610202));
 for r in select value from jsonb_array_elements(p_rows) order by value->>'candidate_id' loop
  perform 1 from public.candidates where id=(r->>'candidate_id')::uuid and job_id=j.id and workspace_id=j.workspace_id for update;
  if not found then raise exception 'screening_forbidden' using errcode='42501';end if;
  select * into d from public.candidate_documents where candidate_id=(r->>'candidate_id')::uuid order by created_at desc,id desc limit 1 for update;
  if d.id is distinct from (r->>'document_id')::uuid or r->>'resume_hash' is distinct from encode(sha256(convert_to(d.extracted_text,'UTF8')),'hex') then raise exception 'screening_source_changed' using errcode='PT409';end if;
  insert into public.candidate_screening_cache(candidate_id,job_id,workspace_id,document_id,rubric_key,resume_hash,result)
  values((r->>'candidate_id')::uuid,j.id,j.workspace_id,d.id,p_intelligence#>>'{rubric,key}',r->>'resume_hash',r->'result')
  on conflict(candidate_id) do update set document_id=excluded.document_id,rubric_key=excluded.rubric_key,resume_hash=excluded.resume_hash,result=excluded.result,updated_at=now();
 end loop;
 perform public.meter_subscription_rules(j.workspace_id,p_actor,j.id,p_intelligence->>'billingKey',p_rows);
 return true;
end$$;

-- Retain established source validation and persistence; wrap them in the same
-- transaction as usage. Every adapter uses this service, not a separate engine.
do $$begin
 if to_regprocedure('public.subscription_base_save_bulk_page(uuid,text,jsonb,jsonb)') is null then alter function public.save_bulk_screening_page(uuid,text,jsonb,jsonb) rename to subscription_base_save_bulk_page;end if;
 if to_regprocedure('public.subscription_base_start_analysis(uuid)') is null then alter function public.start_resume_analysis(uuid) rename to subscription_base_start_analysis;end if;
 if to_regprocedure('public.subscription_base_auto_analysis(uuid)') is null then alter function public.auto_start_resume_analysis(uuid) rename to subscription_base_auto_analysis;end if;
end$$;

create or replace function public.start_resume_analysis(p_batch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;e jsonb;
begin
 b:=public.require_screening_batch(p_batch);
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into b from public.screening_batches where id=p_batch for update;
 if public.subscription_scope_managed(b.workspace_id,auth.uid()) then
  e:=public.subscription_entitlement(b.workspace_id,auth.uid());
  if e->>'allowed' is distinct from 'true' then raise exception '%',e->>'code' using errcode='42501';end if;
 end if;
 perform public.subscription_base_start_analysis(p_batch);
 -- Never reattribute a running or completed batch on a lost response/replay.
 if b.analysis_requested_at is null then update public.screening_batches set analysis_actor_id=auth.uid(),analysis_error_code=null where id=p_batch;end if;
end$$;

create or replace function public.save_bulk_screening_page(p_batch uuid,p_source text,p_intelligence jsonb,p_rows jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;r jsonb;
begin
 b:=public.require_screening_batch(p_batch);
 if public.subscription_scope_managed(b.workspace_id,coalesce(b.analysis_actor_id,b.created_by)) then
  -- Reject the whole page before any write if a document changed while scoring.
  for r in select value from jsonb_array_elements(p_rows) loop
   if not exists(select from public.candidate_documents d where d.id=(r->>'document_id')::uuid and d.id=(select latest.id from public.candidate_documents latest where latest.candidate_id=(r->>'candidate_id')::uuid order by created_at desc,id desc limit 1)) then raise exception 'screening_source_changed' using errcode='PT409';end if;
  end loop;
 end if;
 if not public.subscription_base_save_bulk_page(p_batch,p_source,p_intelligence,p_rows) then raise exception 'screening_source_changed' using errcode='PT409';end if;
 perform public.meter_subscription_rules(b.workspace_id,coalesce(b.analysis_actor_id,b.created_by),b.job_id,p_intelligence->>'billingKey',p_rows);
 update public.screening_batches set analysis_error_code=null where id=p_batch;
 return true;
end$$;

create or replace function public.auto_start_resume_analysis(p_batch uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b public.screening_batches;e jsonb;ids uuid[];maximum integer;actor uuid;
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into b from public.screening_batches where id=p_batch for update;
 if not found or b.analysis_requested_at is null or b.auto_selected then return false;end if;
 actor:=coalesce(b.analysis_actor_id,b.created_by);
 if not public.subscription_scope_managed(b.workspace_id,actor) then return public.subscription_base_auto_analysis(p_batch);end if;
 e:=public.subscription_entitlement(b.workspace_id,actor);
 if e->>'allowed' is distinct from 'true' then update public.screening_batches set analysis_error_code=e->>'code' where id=p_batch;return false;end if;
 if b.intelligence->>'status' is distinct from 'ready' or b.source_version is distinct from public.bulk_screening_source(p_batch)->>'sourceVersion' or jsonb_array_length(public.bulk_screening_page(p_batch,b.intelligence#>>'{rubric,key}',1))>0 then return false;end if;
 if e->>'tier'='basic' then
  update public.screening_batches set auto_selected=true,analysis_error_code=null where id=p_batch;
  return true;
 end if;
 maximum:=case when e->>'tier'='pro' then 500 else 20 end;
 select array_agg(candidate_id order by band,score desc,candidate_id) into ids from (
  select distinct i.candidate_id,case k.result->>'requiredStatus' when 'not_applicable' then 0 when 'evidenced' then 0 when 'conflicting' then 2 else 1 end as band,(k.result->>'score')::numeric as score
  from public.screening_batch_items i join public.candidate_screening_cache k on k.candidate_id=i.candidate_id
  where i.batch_id=p_batch and i.status='saved' and k.rubric_key=b.intelligence#>>'{rubric,key}'
  order by band,score desc,i.candidate_id limit maximum
 ) ranked
 where exists(select from public.screening_managed_candidates m where m.candidate_id=ranked.candidate_id)
 or exists(select from public.resume_intake_tasks t where t.candidate_id=ranked.candidate_id and t.status in ('ready','approved') and t.revision=public.resume_intake_revision(public.screening_finalist_input(ranked.candidate_id)));
 if cardinality(ids)>0 then perform public.select_screening_finalists(p_batch,ids,b.source_version,b.selection_version);end if;
 update public.screening_batches set auto_selected=true,analysis_error_code=null where id=p_batch;
 return true;
end$$;

-- A read-only, allowance-focused surface. No provider tokens or internal costs.
create or replace function public.get_my_subscription() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a public.subscription_accounts;p public.subscription_periods;plan public.subscription_plan_versions;usage jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into a from public.subscription_accounts where user_id=auth.uid();
 if not found then return null;end if;
 select * into p from public.subscription_periods where id=a.current_period_id;
 select * into plan from public.subscription_plan_versions where code=a.plan_code;
 select jsonb_object_agg(metric,jsonb_build_object('used',used,'pending',pending,'limit',maximum,'remaining',greatest(0,maximum-used-pending))) into usage from (
  select m.metric,m.maximum,count(e.id) filter(where e.state='succeeded') as used,count(e.id) filter(where e.state in ('reserved','uncertain')) as pending
  from (values('rules',p.rules_limit),('shortlist_ai',p.shortlist_ai_limit),('deep_ai',p.deep_ai_limit)) m(metric,maximum)
  left join public.subscription_evaluations e on e.account_id=a.id and e.period_id=p.id and e.metric=m.metric group by m.metric,m.maximum
 ) totals;
 return jsonb_build_object('tier',plan.tier,'status',a.status,'period_ends_at',p.ends_at,'access_until',a.access_until,'usage',usage);
end$$;

revoke all on function public.subscription_scope_managed(uuid,uuid),public.subscription_rules_source(uuid,uuid),public.meter_subscription_rules(uuid,uuid,uuid,text,jsonb),public.save_subscription_rules_results(uuid,uuid,text,jsonb,jsonb),public.save_bulk_screening_page(uuid,text,jsonb,jsonb),public.subscription_base_save_bulk_page(uuid,text,jsonb,jsonb),public.subscription_base_start_analysis(uuid),public.subscription_base_auto_analysis(uuid),public.auto_start_resume_analysis(uuid) from public,anon,authenticated;
grant execute on function public.subscription_scope_managed(uuid,uuid),public.subscription_rules_source(uuid,uuid),public.meter_subscription_rules(uuid,uuid,uuid,text,jsonb),public.save_subscription_rules_results(uuid,uuid,text,jsonb,jsonb),public.save_bulk_screening_page(uuid,text,jsonb,jsonb),public.auto_start_resume_analysis(uuid),public.subscription_base_auto_analysis(uuid) to service_role;
revoke all on function public.start_resume_analysis(uuid),public.get_my_subscription() from public,anon;
grant execute on function public.start_resume_analysis(uuid),public.get_my_subscription() to authenticated;

-- Replace the existing selection routine, retaining its source and lease guards.
create or replace function public.select_screening_finalists(p_batch uuid,p_ids uuid[],p_source text,p_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare b public.screening_batches;cid uuid;payload jsonb;rev text;t public.resume_intake_tasks;f public.screening_finalists;e jsonb;actor uuid;maximum integer:=20;
begin
 b:=public.require_screening_batch(p_batch);
 actor:=coalesce(auth.uid(),b.analysis_actor_id,b.created_by);
 if public.subscription_scope_managed(b.workspace_id,actor) then
  e:=public.subscription_entitlement(b.workspace_id,actor);
  if e->>'allowed' is distinct from 'true' then raise exception '%',e->>'code' using errcode='42501';end if;
  if e->>'tier'='basic' then raise exception 'subscription_ai_unavailable' using errcode='42501';end if;
  if e->>'tier'='pro' then maximum:=500;end if;
 end if;
 -- Same lock order as the worker prevents selection/provider-start races.
 perform pg_advisory_xact_lock(2026100501);
 select * into b from public.screening_batches where id=p_batch for update;
 if b.selection_version<>p_version then
  if b.selected_ids=p_ids and b.source_version=p_source then return b.selection_version;end if;
  raise exception 'Shortlist changed. Refresh before saving.' using errcode='PT409';
 end if;
 if not exists(select from public.screening_feature_config where enabled) or p_ids is null or not b.sealed or cardinality(p_ids) not between 1 and maximum or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) or array_position(p_ids,null) is not null
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
   if e is not null then
    update public.resume_intake_tasks set usage_actor_id=actor where candidate_id=cid and status in ('queued','failed');
   end if;
   update public.resume_intake_tasks set status='queued',attempts=0,error_code=null,next_run_at=now() where candidate_id=cid and status='failed' and error_code in ('screening_budget_limit','screening_model_rate_missing','screening_not_enabled','usage_limit','ai_rate_limit','ai_unavailable');
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

create table if not exists public.subscription_worker_reservations (
 lease_id uuid primary key,
 reservation_id uuid not null references public.subscription_evaluations(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade,
 cached boolean not null default false
);
create index if not exists subscription_worker_usage on public.subscription_worker_reservations(reservation_id);
create index if not exists subscription_worker_actor on public.subscription_worker_reservations(actor_id);
create table if not exists public.subscription_evaluation_outputs (
 reservation_id uuid primary key references public.subscription_evaluations(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 result jsonb not null check(jsonb_typeof(result)='object')
);
create index if not exists subscription_outputs_candidate on public.subscription_evaluation_outputs(candidate_id);
alter table public.subscription_worker_reservations enable row level security;
alter table public.subscription_evaluation_outputs enable row level security;
revoke all on public.subscription_worker_reservations,public.subscription_evaluation_outputs from public,anon,authenticated;
grant all on public.subscription_worker_reservations,public.subscription_evaluation_outputs to service_role;

-- Expiry and verified admin recovery update attempts directly. Follow their
-- actual state transition, including paths that never call the finish RPC.
create or replace function public.reconcile_subscription_worker_state() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.subscription_worker_reservations;
begin
 if new.state is not distinct from old.state or not (new.state='uncertain' or (new.state='closed' and not new.accepted)) then return new;end if;
 select * into m from public.subscription_worker_reservations where lease_id=new.lease_id;
 if m.lease_id is not null and not m.cached then
  if not public.settle_subscription_evaluation(m.reservation_id,new.lease_id,case when new.state='uncertain' then 'uncertain' else 'canceled' end) then raise exception 'subscription_recovery_failed';end if;
 end if;
 return new;
end$$;
revoke all on function public.reconcile_subscription_worker_state() from public,anon,authenticated;
drop trigger if exists subscription_worker_state on public.assessment_worker_attempts;
create trigger subscription_worker_state after update of state on public.assessment_worker_attempts
 for each row execute function public.reconcile_subscription_worker_state();

create or replace function public.reserve_subscription_assessment(p_lease uuid,p_policy text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;actor uuid;payload jsonb;e jsonb;r jsonb;metric_name text;key text;output jsonb;f public.screening_finalists;m public.subscription_worker_reservations;
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into a from public.assessment_worker_attempts where lease_id=p_lease for update;
 if not found or a.state in ('closed','uncertain') or a.lease_until<=now() then return '{"allowed":false,"code":"worker_lease_lost"}'::jsonb;end if;
 if a.kind='intake' then select usage_actor_id,input into actor,payload from public.resume_intake_tasks where candidate_id=a.candidate_id and lease_id=p_lease and revision=a.revision;
 else select usage_actor_id,input into actor,payload from public.job_reassessment_tasks where candidate_id=a.candidate_id and lease_id=p_lease and revision=a.revision;end if;
 if not found then return '{"allowed":false,"code":"worker_lease_lost"}'::jsonb;end if;
 if not public.subscription_scope_managed(a.workspace_id,actor) then return '{"allowed":true,"legacy":true}'::jsonb;end if;
 e:=public.subscription_entitlement(a.workspace_id,actor);
 if e->>'allowed' is distinct from 'true' then return e;end if;
 if e->>'tier'='basic' then return '{"allowed":false,"code":"subscription_ai_unavailable"}'::jsonb;end if;
 if p_policy is null or length(p_policy) not between 1 and 200 then raise exception 'Invalid evaluation policy';end if;
 if e->>'tier'='advanced' then
  select * into f from public.screening_finalists where candidate_id=a.candidate_id;
  if not found or a.kind<>'intake' or f.revision<>a.revision or public.resume_intake_input(a.candidate_id) is null
   or not exists(select from public.screening_batches b where b.id=f.batch_id and a.candidate_id=any(b.selected_ids) and cardinality(b.selected_ids)<=20) then
   return '{"allowed":false,"code":"subscription_shortlist_required"}'::jsonb;
  end if;
 end if;
 metric_name:=case when e->>'tier'='pro' then 'deep_ai' else 'shortlist_ai' end;
 -- Document storage identity and filename do not change resume evidence.
 key:=encode(sha256(convert_to(jsonb_build_array('assessment-v1',a.workspace_id,a.job_id,a.candidate_id,a.kind,
  case when a.kind='intake' then public.resume_intake_revision(payload-'document_id'-'file_name') else a.revision end,p_policy)::text,'UTF8')),'hex');
 select * into m from public.subscription_worker_reservations where lease_id=p_lease;
 if found and (m.actor_id<>actor or not exists(select from public.subscription_evaluations where id=m.reservation_id and evaluation_key=key and metric=metric_name)) then
  return '{"allowed":false,"code":"subscription_admission_required"}'::jsonb;
 end if;
 r:=public.reserve_subscription_evaluation(a.workspace_id,actor,metric_name,key,p_lease);
 if r->>'allowed' is distinct from 'true' then return r;end if;
 if r->>'state'='cached' then
  select result into output from public.subscription_evaluation_outputs where reservation_id=(r->>'reservation_id')::uuid and candidate_id=a.candidate_id;
  if output is null then return '{"allowed":false,"code":"subscription_result_recovery_required"}'::jsonb;end if;
 end if;
 insert into public.subscription_worker_reservations(lease_id,reservation_id,actor_id,cached)
 values(p_lease,(r->>'reservation_id')::uuid,actor,r->>'state'='cached')
 on conflict(lease_id) do update set reservation_id=excluded.reservation_id,cached=excluded.cached
 where subscription_worker_reservations.actor_id=excluded.actor_id;
 return r||jsonb_build_object('actor_id',actor,'cached_result',output);
end$$;

-- All successful result writes and allowance settlement share the worker's
-- existing transaction. Lost responses can replay without another provider call.
do $$begin
 if to_regprocedure('public.subscription_base_finish_assessment_work(uuid,jsonb,text)') is null then alter function public.finish_assessment_work(uuid,jsonb,text) rename to subscription_base_finish_assessment_work;end if;
 if to_regprocedure('public.subscription_base_begin_provider(uuid,uuid)') is null then alter function public.begin_assessment_provider(uuid,uuid) rename to subscription_base_begin_provider;end if;
 if to_regprocedure('public.subscription_base_release_work(uuid,boolean)') is null then alter function public.release_assessment_work(uuid,boolean) rename to subscription_base_release_work;end if;
end$$;
create or replace function public.finish_assessment_work(p_lease uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare m public.subscription_worker_reservations;a public.assessment_worker_attempts;accepted boolean;settled boolean;
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into m from public.subscription_worker_reservations where lease_id=p_lease;
 accepted:=public.subscription_base_finish_assessment_work(p_lease,p_result,p_error);
 if m.lease_id is null or m.cached then return accepted;end if;
 select * into a from public.assessment_worker_attempts where lease_id=p_lease;
 if accepted and p_error is null and p_result is not null then
  insert into public.subscription_evaluation_outputs(reservation_id,candidate_id,result) values(m.reservation_id,a.candidate_id,p_result) on conflict do nothing;
  settled:=public.settle_subscription_evaluation(m.reservation_id,p_lease,'succeeded',a.candidate_id);
 elsif a.state='uncertain' then
  settled:=public.settle_subscription_evaluation(m.reservation_id,p_lease,'uncertain');
 elsif a.state='closed' then
  settled:=public.settle_subscription_evaluation(m.reservation_id,p_lease,case when accepted then 'failed' else 'canceled' end);
 else return accepted;end if;
 if not settled then raise exception 'subscription_settlement_failed';end if;
 return accepted;
end$$;

create or replace function public.begin_assessment_provider(p_lease uuid,p_call uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;actor uuid;m public.subscription_worker_reservations;e jsonb;
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into a from public.assessment_worker_attempts where lease_id=p_lease;
 if a.kind='intake' then select usage_actor_id into actor from public.resume_intake_tasks where candidate_id=a.candidate_id and lease_id=p_lease;
 else select usage_actor_id into actor from public.job_reassessment_tasks where candidate_id=a.candidate_id and lease_id=p_lease;end if;
 if public.subscription_scope_managed(a.workspace_id,actor) then
  e:=public.subscription_entitlement(a.workspace_id,actor);
  select * into m from public.subscription_worker_reservations where lease_id=p_lease and actor_id=actor;
  if e->>'allowed' is distinct from 'true' or e->>'tier'='basic' or m.lease_id is null or m.cached
   or not exists(select from public.subscription_evaluations where id=m.reservation_id and attempt_id=p_lease and state='reserved') then return false;end if;
 end if;
 return public.subscription_base_begin_provider(p_lease,p_call);
end$$;

-- Manual verified recovery closes held usage too. Ordinary completion settles
-- in finish_assessment_work, so accepted=true must not release a successful unit.
create or replace function public.release_assessment_work(p_lease uuid,p_accepted boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare m public.subscription_worker_reservations;
begin
 perform public.subscription_base_release_work(p_lease,p_accepted);
 if not p_accepted then
  select * into m from public.subscription_worker_reservations where lease_id=p_lease;
  if m.lease_id is not null and not m.cached then perform public.settle_subscription_evaluation(m.reservation_id,p_lease,'canceled');end if;
 end if;
end$$;

-- Raw/legacy provider admission cannot bypass subscriber metering. The new
-- operation-aware entry point is service-only and bound to a verified lease.
do $$begin
 if to_regprocedure('public.subscription_base_ai_budget(uuid,uuid,integer,integer)') is null then alter function public.reserve_ai_budget(uuid,uuid,integer,integer) rename to subscription_base_ai_budget;end if;
end$$;
create or replace function public.reserve_ai_budget(p_workspace uuid,p_actor uuid,p_input_bytes integer,p_output_tokens integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if public.subscription_scope_managed(p_workspace,p_actor) then return '{"allowed":false,"code":"subscription_admission_required"}'::jsonb;end if;
 return public.subscription_base_ai_budget(p_workspace,p_actor,p_input_bytes,p_output_tokens);
end$$;
create or replace function public.reserve_subscription_model_budget(p_workspace uuid,p_actor uuid,p_input_bytes integer,p_output_tokens integer,p_operation text,p_lease uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e jsonb;m public.subscription_worker_reservations;
begin
 e:=public.subscription_entitlement(p_workspace,p_actor);
 if e->>'allowed' is distinct from 'true' then return e;end if;
 if e->>'tier'='basic' then return '{"allowed":false,"code":"subscription_ai_unavailable"}'::jsonb;end if;
 if p_operation='assessment' then
  select * into m from public.subscription_worker_reservations where lease_id=p_lease and actor_id=p_actor;
  if m.lease_id is null or m.cached or not exists(select from public.assessment_worker_attempts a join public.subscription_evaluations u on u.id=m.reservation_id where a.lease_id=p_lease and a.workspace_id=p_workspace and a.state not in ('closed','uncertain') and a.lease_until>now() and u.state='reserved' and u.attempt_id=p_lease) then return '{"allowed":false,"code":"subscription_admission_required"}'::jsonb;end if;
 elsif p_operation not in ('job_setup','feedback') or p_operation is null then return '{"allowed":false,"code":"subscription_admission_required"}'::jsonb;end if;
 return public.subscription_base_ai_budget(p_workspace,p_actor,p_input_bytes,p_output_tokens);
end$$;

revoke all on function public.reserve_subscription_assessment(uuid,text),public.finish_assessment_work(uuid,jsonb,text),public.begin_assessment_provider(uuid,uuid),public.release_assessment_work(uuid,boolean),public.reserve_ai_budget(uuid,uuid,integer,integer),public.reserve_subscription_model_budget(uuid,uuid,integer,integer,text,uuid),public.subscription_base_ai_budget(uuid,uuid,integer,integer),public.subscription_base_finish_assessment_work(uuid,jsonb,text),public.subscription_base_begin_provider(uuid,uuid),public.subscription_base_release_work(uuid,boolean) from public,anon,authenticated;
grant execute on function public.reserve_subscription_assessment(uuid,text),public.finish_assessment_work(uuid,jsonb,text),public.begin_assessment_provider(uuid,uuid),public.release_assessment_work(uuid,boolean),public.reserve_ai_budget(uuid,uuid,integer,integer),public.reserve_subscription_model_budget(uuid,uuid,integer,integer,text,uuid),public.subscription_base_ai_budget(uuid,uuid,integer,integer),public.subscription_base_finish_assessment_work(uuid,jsonb,text),public.subscription_base_begin_provider(uuid,uuid),public.subscription_base_release_work(uuid,boolean) to service_role;

-- Existing validation and durable write protocol, also accepting a bound cached result.
create or replace function public.subscription_base_finish_assessment_work(p_lease uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;tab text;t record;payload jsonb;current_revision text;
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into a from public.assessment_worker_attempts where lease_id=p_lease for update;
 if not found then return false;end if;
 if a.state='closed' then return a.accepted;end if;
 tab:=case when a.kind='intake' then 'resume_intake_tasks' else 'job_reassessment_tasks' end;
 -- A successful old-protocol result proves that its provider call returned.
 if a.legacy and p_error is null and p_result is not null then a.provider_pending:=false;end if;
 if a.provider_pending or (a.calls>0 and p_error in ('processing_failed','provider_outcome_uncertain')) then
  update public.assessment_worker_attempts set state='uncertain' where lease_id=p_lease;
  execute format('update public.%I set status=''failed'',error_code=''provider_outcome_uncertain'',updated_at=now()
   where candidate_id=$1 and lease_id=$2 and revision=$3',tab) using a.candidate_id,p_lease,a.revision;
  return false;
 end if;
 execute format('select * from public.%I where candidate_id=$1 for update',tab) into t using a.candidate_id;
 if t.candidate_id is null or t.revision is distinct from a.revision or t.lease_id is distinct from p_lease
  or t.status not in ('processing','failed') then
  perform public.release_assessment_work(p_lease,false);return false;
 end if;
 payload:=case when a.kind='intake' then public.resume_intake_input(a.candidate_id) else public.reassessment_input(a.candidate_id) end;
 current_revision:=case when a.kind='intake' then public.resume_intake_revision(payload) else md5(payload::text) end;
 if payload is null or current_revision is distinct from a.revision or not exists(select 1 from public.jobs where id=a.job_id and status='active') then
  if a.kind='intake' then perform public.enqueue_resume_intake(a.candidate_id);
  else perform public.enqueue_job_reassessments(a.job_id,a.candidate_id,'Evidence changed during assessment');end if;
  perform public.release_assessment_work(p_lease,false);return false;
 end if;
 if p_error is null then
  if (a.calls=0 and not exists(select from public.subscription_worker_reservations m join public.subscription_evaluation_outputs o on o.reservation_id=m.reservation_id where m.lease_id=p_lease and m.cached and o.candidate_id=a.candidate_id and o.result=p_result)) or p_result is null or jsonb_typeof(p_result->'manager_score') is distinct from 'number'
   or (p_result->>'manager_score')::numeric not between 0 and 10 or nullif(p_result->>'context_signature','') is null
   or (a.kind='intake' and (jsonb_typeof(p_result->'score') is distinct from 'number' or (p_result->>'score')::numeric not between 0 and 10 or jsonb_typeof(p_result->'resume_evidence') is distinct from 'array'))
   or (a.kind='reassessment' and (jsonb_typeof(p_result->'jd_score') is distinct from 'number' or (p_result->>'jd_score')::numeric not between 0 and 10 or jsonb_typeof(p_result->'evidence_ids') is distinct from 'array')) then raise exception 'Invalid assessment result';end if;
 end if;
 execute format('update public.%I set status=case when $1 is null then ''ready'' when attempts>=3 then ''failed'' else ''queued'' end,
  result=case when $1 is null then $2 else null end,error_code=left($1,80),next_run_at=now()+interval ''20 seconds''*power(2,attempts),
  lease_id=null,lease_until=null,updated_at=now() where candidate_id=$3',tab) using p_error,p_result,a.candidate_id;
 perform public.release_assessment_work(p_lease,true);
 perform public.wake_job_reassessments(null);
 return true;
end $$;
commit;
