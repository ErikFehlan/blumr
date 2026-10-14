begin;
-- Read current task state, rather than treating every historical event as work
-- still waiting. The caller and workspace are checked before any rows are read.
create or replace function public.get_actionable_notifications(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(n)||jsonb_build_object('actionable',
  j.status='active' and case n.kind when 'assessments' then coalesce(s.notify_assessments,true) when 'uploads' then coalesce(s.notify_uploads,true) else coalesce(s.notify_automation,true) end
  and (exists(select 1 from public.resume_intake_tasks t where t.workspace_id=p_workspace and t.job_id=n.job_id and t.candidate_id=n.candidate_id and t.status in ('ready','failed') and n.event_key='resume_intake_tasks:'||t.candidate_id||':'||t.revision||':'||t.status)
   or exists(select 1 from public.job_reassessment_tasks t where t.workspace_id=p_workspace and t.job_id=n.job_id and t.candidate_id=n.candidate_id and t.status in ('ready','failed') and n.event_key='job_reassessment_tasks:'||t.candidate_id||':'||t.revision||':'||t.status)
   or exists(select 1 from public.job_criteria_tasks t where t.workspace_id=p_workspace and t.job_id=n.job_id and t.status='failed' and n.event_key='job_criteria_tasks:'||t.job_id||':'||t.revision||':'||t.status))) order by n.created_at desc)
 from (select * from public.user_notifications where user_id=auth.uid() and workspace_id=p_workspace order by created_at desc limit 100) n
 join public.jobs j on j.id=n.job_id and j.workspace_id=p_workspace
 left join public.user_settings s on s.user_id=auth.uid()),'[]'::jsonb);
end$$;
revoke all on function public.get_actionable_notifications(uuid) from public,anon;
grant execute on function public.get_actionable_notifications(uuid) to authenticated;

-- One destination per message. Only unfinished work in an active search that
-- has waited a day is eligible; an empty account is not a reason to send email.
create or replace function public.onboarding_reminder_target(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with ready as (
  select t.workspace_id,t.job_id,t.candidate_id,t.updated_at from public.resume_intake_tasks t where t.status='ready'
  union all
  select t.workspace_id,t.job_id,t.candidate_id,t.updated_at from public.job_reassessment_tasks t where t.status='ready'
 ), work as (
  select r.workspace_id,r.job_id,min(r.updated_at) waiting_since,count(distinct r.candidate_id) ready_count,
   case when count(distinct r.candidate_id)=1 then min(r.candidate_id::text)::uuid else null end candidate_id
  from ready r join public.workspace_members m on m.workspace_id=r.workspace_id and m.user_id=p_user
  join public.jobs j on j.id=r.job_id and j.workspace_id=r.workspace_id and j.status='active'
  left join public.user_settings s on s.user_id=p_user
  where r.updated_at<=now()-interval '24 hours' and coalesce(s.notify_assessments,true)
  group by r.workspace_id,r.job_id
 ), targets as (
  select workspace_id,job_id,candidate_id,ready_count,waiting_since,'review_assessment'::text step,0 priority from work
  union all
  select j.workspace_id,j.id,null::uuid,0::bigint,j.updated_at,'add_candidate',1
  from public.jobs j join public.workspace_members m on m.workspace_id=j.workspace_id and m.user_id=p_user
  where j.status='active' and j.updated_at<=now()-interval '24 hours'
   and not exists(select 1 from public.candidates c where c.workspace_id=j.workspace_id and c.job_id=j.id)
 ) select jsonb_build_object('workspace_id',workspace_id,'job_id',job_id,'candidate_id',candidate_id,'ready_count',ready_count,'step',step)
 from targets order by priority,waiting_since,job_id limit 1;
$$;
revoke all on function public.onboarding_reminder_target(uuid) from public,anon,authenticated;
grant execute on function public.onboarding_reminder_target(uuid) to service_role;
create or replace function public.onboarding_step(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select coalesce(public.onboarding_reminder_target(p_user)->>'step','done');
$$;
revoke all on function public.onboarding_step(uuid) from public,anon,authenticated;
grant execute on function public.onboarding_step(uuid) to service_role;
commit;
