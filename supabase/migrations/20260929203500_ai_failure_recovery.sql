begin;

create or replace function public.retry_job_criteria(p_job uuid,p_revision text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  j public.jobs;
  t public.job_criteria_tasks;
  payload jsonb;
  current_revision text;
begin
  select * into j from public.jobs where id=p_job for update;
  if not found or auth.uid() is null or not public.is_workspace_member(j.workspace_id) then
    raise exception 'Job unavailable' using errcode='42501';
  end if;
  if j.status<>'active' then raise exception 'Reopen this job before retrying criteria';end if;

  select * into t from public.job_criteria_tasks where job_id=j.id for update;
  if not found then return false;end if;
  if t.revision is distinct from p_revision then
    raise exception 'Job evidence changed. Review the latest criteria state.' using errcode='PT409';
  end if;

  payload:=jsonb_build_object(
    'title',j.title,
    'description',j.description,
    'criteria',j.criteria,
    'manager_notes',j.manager_feedback,
    'knockouts',j.knockouts
  );
  current_revision:=md5(payload::text);
  if current_revision is distinct from t.revision then
    raise exception 'Job evidence changed. Save the job and review the latest criteria state.' using errcode='PT409';
  end if;
  if t.status<>'failed' then return false;end if;

  update public.job_criteria_tasks
  set status='queued',attempts=0,next_run_at=now(),lease_id=null,lease_until=null,error_code=null,updated_at=now()
  where job_id=j.id;

  -- The existing durable cron worker picks this due task up on its next pass.
  -- Do not call the trigger-only immediate-dispatch function outside trigger context.
  return true;
end
$$;

revoke all on function public.retry_job_criteria(uuid,text) from public,anon;
grant execute on function public.retry_job_criteria(uuid,text) to authenticated;

commit;
