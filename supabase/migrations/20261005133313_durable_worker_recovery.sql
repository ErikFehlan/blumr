begin;
-- Attempt ownership survives source edits and deletion of the queue row. No
-- resume, model output, name or email is retained in this service-only ledger.
create table if not exists public.assessment_worker_attempts (
 lease_id uuid primary key, kind text not null check(kind in ('intake','reassessment')),
 candidate_id uuid not null, job_id uuid not null, workspace_id uuid not null, revision text not null,
 state text not null check(state in ('reserved','provider','responded','uncertain','closed')),
 created_at timestamptz not null default now(), lease_until timestamptz not null,
 deadline timestamptz not null, provider_started_at timestamptz, provider_call uuid,
 provider_pending boolean not null default false, calls integer not null default 0,
 legacy boolean not null default false, accepted boolean not null default false,
 closed_at timestamptz, check(calls>=0)
);
alter table public.assessment_worker_attempts enable row level security;
revoke all on public.assessment_worker_attempts from public,anon,authenticated;
grant all on public.assessment_worker_attempts to service_role;
create index if not exists assessment_worker_active on public.assessment_worker_attempts(candidate_id,workspace_id,kind) where state<>'closed';
create index if not exists assessment_worker_retention on public.assessment_worker_attempts(closed_at) where state='closed';

-- Fence the old worker protocol during a rolling deployment. Existing calls
-- are conservatively tracked; an old binary cannot claim any additional work.
insert into public.assessment_worker_attempts(lease_id,kind,candidate_id,job_id,workspace_id,revision,state,lease_until,deadline,provider_started_at,provider_pending,calls,legacy)
 select lease_id,'intake',candidate_id,job_id,workspace_id,revision,'provider',lease_until,now()+interval '5 minutes',now(),true,1,true
 from public.resume_intake_tasks where status='processing' and lease_id is not null
 on conflict do nothing;
insert into public.assessment_worker_attempts(lease_id,kind,candidate_id,job_id,workspace_id,revision,state,lease_until,deadline,provider_started_at,provider_pending,calls,legacy)
 select lease_id,'reassessment',candidate_id,job_id,workspace_id,revision,'provider',lease_until,now()+interval '5 minutes',now(),true,1,true
 from public.job_reassessment_tasks where status='processing' and lease_id is not null
 on conflict do nothing;

create or replace function public.claim_resume_intakes(p_job uuid default null) returns setof public.resume_intake_tasks
language sql volatile security invoker set search_path='' as $$
 select * from public.resume_intake_tasks where false;
$$;
create or replace function public.claim_job_reassessments(p_job uuid default null) returns setof public.job_reassessment_tasks
language sql volatile security invoker set search_path='' as $$
 select * from public.job_reassessment_tasks where false;
$$;

create or replace function public.active_assessment_count(p_workspace uuid default null)
returns integer language sql volatile security invoker set search_path='' as $$
 select ((select count(*) from public.assessment_worker_attempts where state<>'closed'
  and (lease_until>=now() or calls>0) and (p_workspace is null or workspace_id=p_workspace))+
 (select count(*) from public.direct_ai_requests where status='processing'
  and (expires_at>now() or provider_started_at is not null) and (p_workspace is null or workspace_id=p_workspace)))::integer;
$$;

create or replace function public.recover_expired_assessment_work() returns void
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;tab text;
begin
 perform pg_advisory_xact_lock(2026100501);
 for a in select * from public.assessment_worker_attempts where state not in ('closed','uncertain') and lease_until<now() for update loop
  tab:=case when a.kind='intake' then 'resume_intake_tasks' else 'job_reassessment_tasks' end;
  if a.calls=0 then
   update public.assessment_worker_attempts set state='closed',closed_at=now() where lease_id=a.lease_id;
   execute format('update public.%I set status=case when attempts>=3 then ''failed'' else ''queued'' end,
    error_code=case when attempts>=3 then ''retry_limit'' else ''worker_interrupted'' end,
    lease_id=null,lease_until=null,next_run_at=now()+interval ''20 seconds'',updated_at=now()
    where candidate_id=$1 and lease_id=$2 and revision=$3 and status=''processing''',tab) using a.candidate_id,a.lease_id,a.revision;
  else
   update public.assessment_worker_attempts set state='uncertain' where lease_id=a.lease_id;
   execute format('update public.%I set status=''failed'',error_code=''provider_outcome_uncertain'',updated_at=now()
    where candidate_id=$1 and lease_id=$2 and revision=$3 and status=''processing''',tab) using a.candidate_id,a.lease_id,a.revision;
  end if;
 end loop;
 delete from public.assessment_worker_attempts where state='closed' and closed_at<now()-interval '7 days';
end $$;

create or replace function public.claim_assessment_work(p_kind text,p_job uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare tab text;slots integer;t record;claimed jsonb;batch jsonb:='[]';lease uuid;
begin
 if p_kind is null or p_kind not in ('intake','reassessment') then raise exception 'Invalid worker kind';end if;
 perform pg_advisory_xact_lock(2026100501);
 perform public.recover_expired_assessment_work();
 tab:=case when p_kind='intake' then 'resume_intake_tasks' else 'job_reassessment_tasks' end;
 execute format('update public.%I t set status=''failed'',error_code=''provider_outcome_uncertain'',updated_at=now()
  where status=''queued'' and exists(select 1 from public.assessment_worker_attempts a where a.candidate_id=t.candidate_id and a.state=''uncertain'')',tab);
 slots:=least(2,6-public.active_assessment_count(null),(case when p_kind='intake' then 2 else 4 end)-
  (select count(*)::integer from public.assessment_worker_attempts where kind=p_kind and state<>'closed' and (lease_until>=now() or calls>0)));
 if slots<=0 then return batch;end if;
 for t in execute format('select t.* from public.%I t join public.jobs j on j.id=t.job_id and j.workspace_id=t.workspace_id
  where j.status=''active'' and ($1 is null or t.job_id=$1) and t.status=''queued'' and t.attempts<3 and t.next_run_at<=now()
  and not exists(select 1 from public.assessment_worker_attempts a where a.candidate_id=t.candidate_id and a.state<>''closed'')
  order by t.next_run_at,t.candidate_id for update of t skip locked',tab) using p_job
 loop
  if public.active_assessment_count(t.workspace_id)>=3 then continue;end if;
  lease:=gen_random_uuid();
  execute format('update public.%I t set status=''processing'',attempts=attempts+1,lease_id=$1,
   lease_until=now()+interval ''2 minutes'',updated_at=now() where candidate_id=$2 returning to_jsonb(t)',tab) into claimed using lease,t.candidate_id;
  insert into public.assessment_worker_attempts(lease_id,kind,candidate_id,job_id,workspace_id,revision,state,lease_until,deadline)
   values(lease,p_kind,t.candidate_id,t.job_id,t.workspace_id,t.revision,'reserved',now()+interval '2 minutes',now()+interval '5 minutes');
  batch:=batch||jsonb_build_array(claimed);slots:=slots-1;exit when slots<=0;
 end loop;
 return batch;
end $$;

create or replace function public.heartbeat_assessment_work(p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.assessment_worker_attempts;tab text;affected integer;
begin
 perform pg_advisory_xact_lock(2026100501);
 select * into a from public.assessment_worker_attempts where lease_id=p_lease for update;
 if not found or a.state in ('closed','uncertain') or a.lease_until<=now() or a.deadline<=now() then return false;end if;
 tab:=case when a.kind='intake' then 'resume_intake_tasks' else 'job_reassessment_tasks' end;
 execute format('update public.%I t set lease_until=least(now()+interval ''2 minutes'',$1),updated_at=now()
  where candidate_id=$2 and lease_id=$3 and revision=$4 and status=''processing''
  and exists(select 1 from public.jobs j where j.id=t.job_id and j.status=''active'')',tab)
  using a.deadline,a.candidate_id,p_lease,a.revision;
 get diagnostics affected=row_count;
 if affected<>1 then return false;end if;
 update public.assessment_worker_attempts set lease_until=least(now()+interval '2 minutes',deadline) where lease_id=p_lease;
 return true;
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
 update public.assessment_worker_attempts set state='provider',provider_pending=true,provider_call=p_call,
  provider_started_at=coalesce(provider_started_at,now()),calls=calls+1 where lease_id=p_lease;
 return true;
end $$;

create or replace function public.end_assessment_provider(p_lease uuid,p_call uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 perform pg_advisory_xact_lock(2026100501);
 -- Receipt of a complete terminal response may settle a late call, but never
 -- gives that worker permission to start another call after lease expiry.
 update public.assessment_worker_attempts set state='responded',provider_pending=false
 where lease_id=p_lease and provider_call=p_call and state<>'closed';
 get diagnostics affected=row_count;return affected=1;
end $$;

create or replace function public.release_assessment_work(p_lease uuid,p_accepted boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare candidate uuid;
begin
 perform pg_advisory_xact_lock(2026100501);
 update public.assessment_worker_attempts set state='closed',provider_pending=false,accepted=p_accepted,closed_at=now()
  where lease_id=p_lease returning candidate_id into candidate;
 -- A late, superseded response can unblock a newer revision that was held
 -- for recovery. Never revive approved/cancelled work or overwrite its input.
 if not exists(select 1 from public.assessment_worker_attempts where candidate_id=candidate and state<>'closed') then
  update public.resume_intake_tasks set status='queued',attempts=0,lease_id=null,lease_until=null,error_code=null,next_run_at=now(),updated_at=now()
   where candidate_id=candidate and status='failed' and error_code='provider_outcome_uncertain';
  update public.job_reassessment_tasks set status='queued',attempts=0,lease_id=null,lease_until=null,error_code=null,next_run_at=now(),updated_at=now()
   where candidate_id=candidate and status='failed' and error_code='provider_outcome_uncertain';
 end if;
end $$;

create or replace function public.finish_assessment_work(p_lease uuid,p_result jsonb,p_error text default null) returns boolean
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
  if a.calls=0 or p_result is null or jsonb_typeof(p_result->'manager_score') is distinct from 'number'
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

create or replace function public.finish_resume_intake(p_candidate uuid,p_revision text,p_lease uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.assessment_worker_attempts where lease_id=p_lease and kind='intake' and candidate_id=p_candidate and revision=p_revision) then return false;end if;
 return public.finish_assessment_work(p_lease,p_result,p_error);
end $$;
create or replace function public.finish_job_reassessment(p_candidate uuid,p_revision text,p_lease uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.assessment_worker_attempts where lease_id=p_lease and kind='reassessment' and candidate_id=p_candidate and revision=p_revision) then return false;end if;
 return public.finish_assessment_work(p_lease,p_result,p_error);
end $$;

-- Extend the existing admin recovery surface, retaining its authorization,
-- explicit provider verification and audit record requirements.
create or replace function public.get_direct_ai_recovery() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (
  select claim_id,workspace_id,created_at,expires_at,provider_started_at,'direct'::text as kind,null::uuid as provider_call
   from public.direct_ai_requests where status='processing' and expires_at<=now()
  union all select lease_id,workspace_id,created_at,lease_until,provider_started_at,kind,provider_call
   from public.assessment_worker_attempts where state='uncertain' or (state<>'closed' and calls>0 and lease_until<=now())
  order by created_at limit 50
 )r),'[]'::jsonb);
end $$;

create or replace function public.recover_direct_ai_request(p_claim uuid,p_note text,p_verified_stopped boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare r public.direct_ai_requests;a public.assessment_worker_attempts;tab text;
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if char_length(trim(coalesce(p_note,''))) not between 20 and 500 then raise exception 'Describe the verification (20–500 characters)' using errcode='22023';end if;
 perform pg_advisory_xact_lock(2026100501);
 select * into a from public.assessment_worker_attempts where lease_id=p_claim for update;
 if found then
  if a.state='closed' or (a.state<>'uncertain' and a.lease_until>now()) then raise exception 'Request is not stalled. Refresh health.' using errcode='PT409';end if;
  -- Seven minutes from claim exceeds the hosted worker's 400-second lifetime.
  -- A queued acknowledgement must not revive an old worker after manual release.
  if a.deadline+interval '2 minutes'>now() then raise exception 'The earlier worker shutdown window has not elapsed. Refresh recovery seven minutes after the request started.' using errcode='PT409';end if;
  if a.calls>0 and p_verified_stopped is distinct from true then raise exception 'Verify the provider request is no longer running before allowing a retry' using errcode='22023';end if;
  insert into public.reliability_events(workspace_id,actor_id,source,category,operation,severity,metadata)
   values((select id from public.workspaces where id=a.workspace_id),auth.uid(),'database','ai','durable_worker_recovery','warn',
   jsonb_build_object('claim_id',p_claim,'kind',a.kind,'provider_call',a.provider_call,'verification_note',trim(p_note)));
  update public.assessment_worker_attempts set state='closed',closed_at=now() where lease_id=p_claim;
  tab:=case when a.kind='intake' then 'resume_intake_tasks' else 'job_reassessment_tasks' end;
  execute format('update public.%I set status=''queued'',attempts=0,lease_id=null,lease_until=null,error_code=null,next_run_at=now(),updated_at=now()
   where candidate_id=$1 and ((lease_id=$2 and revision=$3 and status in (''failed'',''processing'',''queued''))
    or (status=''failed'' and error_code=''provider_outcome_uncertain''))',tab) using a.candidate_id,p_claim,a.revision;
  -- A source edit may move the same candidate from intake to reassessment.
  update public.resume_intake_tasks set status='queued',attempts=0,error_code=null,next_run_at=now(),updated_at=now()
   where candidate_id=a.candidate_id and status='failed' and error_code='provider_outcome_uncertain';
  update public.job_reassessment_tasks set status='queued',attempts=0,error_code=null,next_run_at=now(),updated_at=now()
   where candidate_id=a.candidate_id and status='failed' and error_code='provider_outcome_uncertain';
  perform public.wake_job_reassessments(null);return;
 end if;
 select * into r from public.direct_ai_requests where claim_id=p_claim for update;
 if not found or r.status<>'processing' or r.expires_at>now() then raise exception 'Request is not stalled. Refresh health.' using errcode='PT409';end if;
 if r.provider_started_at is not null and p_verified_stopped is distinct from true then raise exception 'Verify the provider request is no longer running before allowing a retry' using errcode='22023';end if;
 insert into public.reliability_events(workspace_id,actor_id,source,category,operation,severity,metadata)
 values(r.workspace_id,auth.uid(),'database','ai','direct_ai_recovery','warn',jsonb_build_object('claim_id',p_claim,'provider_started',r.provider_started_at is not null,'verification_note',trim(p_note)));
 delete from public.direct_ai_requests where claim_id=p_claim;
end $$;

revoke all on function public.recover_expired_assessment_work(),public.claim_assessment_work(text,uuid),public.heartbeat_assessment_work(uuid),public.begin_assessment_provider(uuid,uuid),public.end_assessment_provider(uuid,uuid),public.release_assessment_work(uuid,boolean),public.finish_assessment_work(uuid,jsonb,text),public.finish_resume_intake(uuid,text,uuid,jsonb,text),public.finish_job_reassessment(uuid,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.recover_expired_assessment_work(),public.claim_assessment_work(text,uuid),public.heartbeat_assessment_work(uuid),public.begin_assessment_provider(uuid,uuid),public.end_assessment_provider(uuid,uuid),public.release_assessment_work(uuid,boolean),public.finish_assessment_work(uuid,jsonb,text),public.finish_resume_intake(uuid,text,uuid,jsonb,text),public.finish_job_reassessment(uuid,text,uuid,jsonb,text) to service_role;
revoke all on function public.get_direct_ai_recovery(),public.recover_direct_ai_request(uuid,text,boolean) from public,anon;
grant execute on function public.get_direct_ai_recovery(),public.recover_direct_ai_request(uuid,text,boolean) to authenticated;
commit;
