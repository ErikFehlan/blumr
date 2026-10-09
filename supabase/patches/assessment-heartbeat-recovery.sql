begin;
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
 -- Source edits replace the queue row, but a paid synchronous call may
 -- already be in flight. Keep that original worker alive long enough to
 -- receive its terminal response. Completion still checks revision/lease
 -- ownership and discards stale output; a pending provider cannot start twice.
 if affected<>1 and not (a.state='provider' and a.provider_pending) then return false;end if;
 update public.assessment_worker_attempts set lease_until=least(now()+interval '2 minutes',deadline) where lease_id=p_lease;
 return true;
end $$;

revoke all on function public.heartbeat_assessment_work(uuid) from public,anon,authenticated;
grant execute on function public.heartbeat_assessment_work(uuid) to service_role;
commit;
