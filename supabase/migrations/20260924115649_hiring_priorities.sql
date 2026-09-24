begin;
set local lock_timeout='5s';
-- Reuse the existing private durable queue. Reviews live separately so a
-- wording refresh cannot overwrite a recruiter's accepted or edited priorities.
alter table public.job_criteria_tasks add column if not exists priority_suggestions jsonb;
alter table public.job_criteria_tasks add column if not exists priority_review jsonb;
alter table public.job_criteria_tasks add column if not exists priority_version integer not null default 0;

create or replace function public.hiring_priorities_for_job(p_job uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('basis','job_description','source_title',j.title,'source_description',coalesce(j.description,''),'review_status',coalesce(chosen.value->>'review_status','suggested'),'items',chosen.value->'items')
 from public.jobs j join public.job_criteria_tasks t on t.job_id=j.id and t.workspace_id=j.workspace_id
 cross join lateral(select case
  when t.priority_review->>'title'=j.title and t.priority_review->>'description'=coalesce(j.description,'') then t.priority_review
  when t.priority_suggestions->>'title'=j.title and t.priority_suggestions->>'description'=coalesce(j.description,'') then t.priority_suggestions
  else null end as value) chosen where j.id=p_job and chosen.value is not null;
$$;
revoke all on function public.hiring_priorities_for_job(uuid) from public,anon,authenticated;
grant execute on function public.hiring_priorities_for_job(uuid) to service_role;

create or replace function public.get_job_hiring_priorities(p_job uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select from public.jobs where id=p_job and public.is_workspace_member(workspace_id)) then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 return public.hiring_priorities_for_job(p_job);
end $$;
revoke all on function public.get_job_hiring_priorities(uuid) from public,anon;
grant execute on function public.get_job_hiring_priorities(uuid) to authenticated;

create or replace function public.capture_hiring_priorities() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.status='ready' and new.result is distinct from old.result and jsonb_typeof(new.result->'hiring_priorities')='array' then
  new.priority_suggestions:=jsonb_build_object('title',new.input->>'title','description',coalesce(new.input->>'description',''),
   'items',new.result->'hiring_priorities','model',new.result->>'model');
  new.priority_version:=old.priority_version+1;
 end if;
 return new;
end $$;
revoke all on function public.capture_hiring_priorities() from public,anon,authenticated;
drop trigger if exists capture_hiring_priorities on public.job_criteria_tasks;
create trigger capture_hiring_priorities before update on public.job_criteria_tasks for each row execute function public.capture_hiring_priorities();

create or replace function public.reassessment_job_input(p_job uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('job',jsonb_build_object('id',j.id,'title',j.title,'description',j.description,
  'criteria',j.criteria,'managerFeedback',j.manager_feedback,'knockouts',j.knockouts,'weights',j.weights,
  'assessmentLessons',public.assessment_lessons_for_job(j.id),'hiringPriorities',public.hiring_priorities_for_job(j.id)),
  'preferences',coalesce((select jsonb_agg(f-'interpretation' order by f->>'id') from jsonb_array_elements(public.reassessment_feedback(j.id)) f
   where f->>'learningScope'='job' and f->>'signalStatus'='approved'),'[]'::jsonb)) from public.jobs j where j.id=p_job;
$$;

create or replace function public.hiring_priorities_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if row(new.priority_suggestions,new.priority_review) is distinct from row(old.priority_suggestions,old.priority_review) then
  perform public.enqueue_job_reassessments(new.job_id,null,'Hiring priorities updated');
  perform public.enqueue_resume_intake(c.id) from public.candidates c where c.job_id=new.job_id;
 end if;
 return new;
end $$;
revoke all on function public.hiring_priorities_changed() from public,anon,authenticated;
drop trigger if exists hiring_priorities_changed on public.job_criteria_tasks;
create trigger hiring_priorities_changed after update on public.job_criteria_tasks for each row execute function public.hiring_priorities_changed();

create or replace function public.review_job_hiring_priorities(p_job uuid,p_version integer,p_decision text,p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.jobs;t public.job_criteria_tasks;source jsonb;item jsonb;original jsonb;items jsonb:='[]';seen text[]:='{}';
begin
 select * into j from public.jobs where id=p_job for update;
 if not found or auth.uid() is null or not public.is_workspace_member(j.workspace_id) then raise exception 'Not authorized' using errcode='42501';end if;
 select * into t from public.job_criteria_tasks where job_id=j.id and workspace_id=j.workspace_id for update;
 if not found or p_version is distinct from t.priority_version then raise exception 'Priorities changed. Refresh and review again.' using errcode='PT409';end if;
 source:=case when p_decision='edit' and t.priority_review->>'title'=j.title and t.priority_review->>'description'=coalesce(j.description,'') then t.priority_review else t.priority_suggestions end;
 if source is null or source->>'title' is distinct from j.title or source->>'description' is distinct from coalesce(j.description,'') then raise exception 'The job description changed. Wait for updated priorities.' using errcode='PT409';end if;
 if p_decision not in ('accept','edit','reset') or p_decision is null then raise exception 'Invalid decision';end if;
 if p_decision='edit' then
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>5 then raise exception 'Invalid priorities';end if;
  for item in select value from jsonb_array_elements(p_items) loop
   select value into original from jsonb_array_elements(source->'items') where value->>'id'=item->>'id';
   if original is null or item->>'id'=any(seen) then raise exception 'Invalid priority';end if;
   if jsonb_typeof(item->'title') is distinct from 'string' or length(trim(item->>'title')) not between 1 and 140
    or jsonb_typeof(item->'reason') is distinct from 'string' or length(trim(item->>'reason')) not between 1 and 240
    or jsonb_typeof(item->'question') is distinct from 'string' or length(trim(item->>'question')) not between 1 and 220 then raise exception 'Invalid priority text';end if;
   seen:=array_append(seen,item->>'id');
   items:=items||jsonb_build_array(original||jsonb_build_object('title',trim(item->>'title'),'reason',trim(item->>'reason'),'question',trim(item->>'question')));
  end loop;
 else items:=source->'items';end if;
 update public.job_criteria_tasks set priority_review=case when p_decision='reset' then null else
  jsonb_build_object('title',j.title,'description',coalesce(j.description,''),'items',items,'review_status',case when p_decision='edit' then 'edited' else 'accepted' end,
   'reviewed_by',auth.uid(),'reviewed_at',now()) end,priority_version=priority_version+1,updated_at=now() where job_id=j.id;
 return public.hiring_priorities_for_job(j.id);
end $$;
revoke all on function public.review_job_hiring_priorities(uuid,integer,text,jsonb) from public,anon;
grant execute on function public.review_job_hiring_priorities(uuid,integer,text,jsonb) to authenticated;

-- Legacy jobs generate on demand; rollout does not spend tokens on every job.
create or replace function public.request_hiring_priorities(p_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.jobs;payload jsonb;t public.job_criteria_tasks;
begin
 select * into j from public.jobs where id=p_job for update;
 if not found or auth.uid() is null or not public.is_workspace_member(j.workspace_id) then raise exception 'Not authorized' using errcode='42501';end if;
 if j.status<>'active' then raise exception 'Reopen this job to prepare priorities';end if;
 select * into t from public.job_criteria_tasks where job_id=j.id for update;
 if t.status in ('queued','processing') or public.hiring_priorities_for_job(j.id) is not null then return false;end if;
 payload:=jsonb_build_object('title',j.title,'description',j.description,'criteria',j.criteria,'manager_notes',j.manager_feedback,'knockouts',j.knockouts);
 insert into public.job_criteria_tasks(job_id,workspace_id,revision,input,next_run_at) values(j.id,j.workspace_id,md5(payload::text),payload,now())
 on conflict(job_id) do update set revision=excluded.revision,input=excluded.input,status='queued',attempts=0,next_run_at=now(),lease_id=null,lease_until=null,result=null,error_code=null,updated_at=now();
 return true;
end $$;
revoke all on function public.request_hiring_priorities(uuid) from public,anon;
grant execute on function public.request_hiring_priorities(uuid) to authenticated;
commit;
