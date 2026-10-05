begin;
-- One admission gate coordinates both durable queues and both direct API routes.
-- Six is the previous combined durable limit (two intakes + four reassessments).
-- A workspace may hold at most three reservations across all of these routes.
create index if not exists intake_capacity_workspace on public.resume_intake_tasks(workspace_id,lease_until) where status='processing';
create index if not exists reassessment_capacity_workspace on public.job_reassessment_tasks(workspace_id,lease_until) where status='processing';
create index if not exists direct_capacity_workspace on public.direct_ai_requests(workspace_id) where status='processing';

create or replace function public.active_assessment_count(p_workspace uuid default null)
returns integer language sql volatile security invoker set search_path='' as $$
 select (
  (select count(*) from public.resume_intake_tasks where status='processing' and lease_until>=now() and (p_workspace is null or workspace_id=p_workspace)) +
  (select count(*) from public.job_reassessment_tasks where status='processing' and lease_until>=now() and (p_workspace is null or workspace_id=p_workspace)) +
  -- An ambiguous direct provider call continues to consume capacity until its
  -- verified recovery; a clock timeout alone is not proof that it stopped.
  (select count(*) from public.direct_ai_requests where status='processing' and (expires_at>now() or provider_started_at is not null) and (p_workspace is null or workspace_id=p_workspace))
 )::integer;
$$;
revoke all on function public.active_assessment_count(uuid) from public,anon,authenticated;
grant execute on function public.active_assessment_count(uuid) to service_role;

create or replace function public.claim_resume_intakes(p_job uuid default null) returns setof public.resume_intake_tasks
language plpgsql security invoker set search_path='' as $$
declare slots integer;task record;
begin
 perform pg_advisory_xact_lock(2026100501);
 update public.resume_intake_tasks set status='failed',error_code='retry_limit',lease_id=null,lease_until=null,updated_at=now()
 where attempts>=3 and (status='queued' or (status='processing' and lease_until<now()));
 slots:=least(6-public.active_assessment_count(null),2-(select count(*)::integer from public.resume_intake_tasks where status='processing' and lease_until>=now()));
 if slots<=0 then return;end if;
 for task in
  select t.candidate_id,t.workspace_id from public.resume_intake_tasks t join public.jobs j on j.id=t.job_id and j.workspace_id=t.workspace_id
  where j.status='active' and (p_job is null or t.job_id=p_job) and attempts<3
  and ((t.status='queued' and next_run_at<=now()) or (t.status='processing' and lease_until<now()))
  order by next_run_at,t.candidate_id for update of t skip locked
 loop
  if public.active_assessment_count(task.workspace_id)>=3 then continue;end if;
  return query update public.resume_intake_tasks t set status='processing',attempts=t.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
   where t.candidate_id=task.candidate_id returning t.*;
  slots:=slots-1;
  exit when slots<=0;
 end loop;
end $$;

create or replace function public.claim_job_reassessments(p_job uuid default null) returns setof public.job_reassessment_tasks
language plpgsql security invoker set search_path='' as $$
declare slots integer;task record;
begin
 perform pg_advisory_xact_lock(2026100501);
 update public.job_reassessment_tasks set status='failed',error_code='retry_limit',lease_id=null,lease_until=null,updated_at=now()
 where attempts>=3 and (status='queued' or (status='processing' and lease_until<now()));
 slots:=least(2,6-public.active_assessment_count(null),4-(select count(*)::integer from public.job_reassessment_tasks where status='processing' and lease_until>=now()));
 if slots<=0 then return;end if;
 for task in
  select t.candidate_id,t.workspace_id from public.job_reassessment_tasks t join public.jobs j on j.id=t.job_id and j.workspace_id=t.workspace_id
  where j.status='active' and (p_job is null or t.job_id=p_job) and attempts<3
  and ((t.status='queued' and next_run_at<=now()) or (t.status='processing' and lease_until<now()))
  order by next_run_at,t.candidate_id for update of t skip locked
 loop
  if public.active_assessment_count(task.workspace_id)>=3 then continue;end if;
  return query update public.job_reassessment_tasks t set status='processing',attempts=t.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
   where t.candidate_id=task.candidate_id returning t.*;
  slots:=slots-1;
  exit when slots<=0;
 end loop;
end $$;

create or replace function public.claim_direct_ai_request(p_workspace uuid,p_actor uuid,p_fingerprint text,p_claim uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.direct_ai_requests;
begin
 perform pg_advisory_xact_lock(2026100501);
 delete from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor
  and fingerprint=p_fingerprint and status='complete' and expires_at<=now();
 select * into r from public.direct_ai_requests where workspace_id=p_workspace and actor_id=p_actor and fingerprint=p_fingerprint;
 -- Replays and waiting duplicates need no new capacity or budget reservation.
 if found then
  if r.status='complete' then
   if r.response_body->>'__blumr_failure'='true' then return jsonb_build_object('state','failed','status',(r.response_body->>'status')::integer,'body',r.response_body->'body');end if;
   return jsonb_build_object('state','complete','body',r.response_body);
  end if;
  if r.expires_at<=now() then return jsonb_build_object('state','uncertain','claim_id',r.claim_id);end if;
  if r.claim_id=p_claim then return jsonb_build_object('state','owner');end if;
  return jsonb_build_object('state','processing','claim_id',r.claim_id);
 end if;
 if public.active_assessment_count(null)>=6 or public.active_assessment_count(p_workspace)>=3 then
  return jsonb_build_object('state','capacity');
 end if;
 insert into public.direct_ai_requests(workspace_id,actor_id,fingerprint,claim_id,status,expires_at)
 values(p_workspace,p_actor,p_fingerprint,p_claim,'processing',now()+interval '15 minutes');
 return jsonb_build_object('state','owner');
end $$;

revoke all on function public.claim_resume_intakes(uuid),public.claim_job_reassessments(uuid),public.claim_direct_ai_request(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_resume_intakes(uuid),public.claim_job_reassessments(uuid),public.claim_direct_ai_request(uuid,uuid,text,uuid) to service_role;
commit;
