begin;

-- Reliability #5: database invariants for rows the client treats as singletons.
create unique index if not exists candidate_assessments_manual_one_per_candidate
  on public.candidate_assessments(candidate_id)
  where assessment_type='manual_correction';

create unique index if not exists candidate_assessments_feedback_one_per_note
  on public.candidate_assessments(candidate_id,(evidence->>'feedback_id'))
  where assessment_type='manager_feedback' and nullif(evidence->>'feedback_id','') is not null;

create unique index if not exists screening_insights_one_per_candidate
  on public.screening_insights(candidate_id);

do $$ begin
 if not exists(select 1 from pg_constraint where conname='resume_intake_attempts_nonnegative' and conrelid='public.resume_intake_tasks'::regclass) then
  alter table public.resume_intake_tasks add constraint resume_intake_attempts_nonnegative check(attempts>=0);
 end if;
 if not exists(select 1 from pg_constraint where conname='resume_intake_lease_pair' and conrelid='public.resume_intake_tasks'::regclass) then
  alter table public.resume_intake_tasks add constraint resume_intake_lease_pair check((lease_id is null)=(lease_until is null));
 end if;
 if not exists(select 1 from pg_constraint where conname='job_reassessment_attempts_nonnegative' and conrelid='public.job_reassessment_tasks'::regclass) then
  alter table public.job_reassessment_tasks add constraint job_reassessment_attempts_nonnegative check(attempts>=0);
 end if;
 if not exists(select 1 from pg_constraint where conname='job_reassessment_lease_pair' and conrelid='public.job_reassessment_tasks'::regclass) then
  alter table public.job_reassessment_tasks add constraint job_reassessment_lease_pair check((lease_id is null)=(lease_until is null));
 end if;
 if not exists(select 1 from pg_constraint where conname='job_criteria_attempts_nonnegative' and conrelid='public.job_criteria_tasks'::regclass) then
  alter table public.job_criteria_tasks add constraint job_criteria_attempts_nonnegative check(attempts>=0);
 end if;
 if not exists(select 1 from pg_constraint where conname='job_criteria_lease_pair' and conrelid='public.job_criteria_tasks'::regclass) then
  alter table public.job_criteria_tasks add constraint job_criteria_lease_pair check((lease_id is null)=(lease_until is null));
 end if;
end $$;

-- Tighten privileged helper execution. RLS/trigger internals continue to work,
-- while exposed API roles receive only the helpers the signed-in app needs.
revoke all on function public.is_workspace_member(uuid) from public,anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
revoke all on function public.can_manage_workspace(uuid) from public,anon;
grant execute on function public.can_manage_workspace(uuid) to authenticated;
revoke all on function public.is_app_admin() from public,anon;
grant execute on function public.is_app_admin() to authenticated;
revoke all on function public.can_access_resume_path(text) from public,anon;
grant execute on function public.can_access_resume_path(text) to authenticated;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.rls_auto_enable() from public,anon,authenticated;

-- Reliability #6: structured, low-volume operational events. The client cannot
-- read or write this table directly; signed-in users can only submit validated
-- events for a workspace they belong to through the RPC below.
create table if not exists public.reliability_events (
 id bigint generated always as identity primary key,
 workspace_id uuid references public.workspaces(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 source text not null check(source in ('browser','database','storage','edge','email','auth')),
 category text not null check(category in ('api','ai','supabase','resume','upload','page','auth','email','performance')),
 operation text not null check(char_length(operation) between 1 and 120),
 severity text not null check(severity in ('info','warn','error')),
 error_code text check(error_code is null or char_length(error_code)<=120),
 duration_ms integer check(duration_ms is null or duration_ms between 0 and 600000),
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=4096),
 created_at timestamptz not null default now()
);
alter table public.reliability_events enable row level security;
revoke all on public.reliability_events from public,anon,authenticated;
grant all on public.reliability_events to service_role;
grant usage,select on sequence public.reliability_events_id_seq to service_role;
create index if not exists reliability_events_created_idx on public.reliability_events(created_at desc);
create index if not exists reliability_events_workspace_time_idx on public.reliability_events(workspace_id,created_at desc);
create index if not exists reliability_events_category_time_idx on public.reliability_events(category,created_at desc);

create or replace function public.record_reliability_event(
 p_workspace uuid,p_source text,p_category text,p_operation text,p_severity text,
 p_error_code text default null,p_duration_ms integer default null,p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path=''
as $$
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace) then
  raise exception 'Workspace unavailable' using errcode='42501';
 end if;
 if p_source not in ('browser','database','storage','edge','email','auth')
   or p_category not in ('api','ai','supabase','resume','upload','page','auth','email','performance')
   or p_severity not in ('info','warn','error')
   or char_length(coalesce(p_operation,'')) not between 1 and 120
   or char_length(coalesce(p_error_code,''))>120
   or (p_duration_ms is not null and p_duration_ms not between 0 and 600000)
   or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb))<>'object'
   or octet_length(coalesce(p_metadata,'{}'::jsonb)::text)>4096 then
  raise exception 'Invalid reliability event' using errcode='22023';
 end if;
 insert into public.reliability_events(workspace_id,actor_id,source,category,operation,severity,error_code,duration_ms,metadata)
 values(p_workspace,auth.uid(),p_source,p_category,p_operation,p_severity,nullif(p_error_code,''),p_duration_ms,coalesce(p_metadata,'{}'::jsonb));
end $$;
revoke all on function public.record_reliability_event(uuid,text,text,text,text,text,integer,jsonb) from public,anon;
grant execute on function public.record_reliability_event(uuid,text,text,text,text,text,integer,jsonb) to authenticated;

-- Reliability #7: one admin snapshot built from durable operational state.
create or replace function public.get_system_health() returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
 ai_paused boolean:=false;
 latest_ai_success timestamptz;
 latest_ai_failure timestamptz;
 ai_task_failed integer:=0;
 resume_failed integer:=0;
 resume_stuck integer:=0;
 latest_resume_success timestamptz;
 latest_reassessment_success timestamptz;
 latest_assessment timestamptz;
 email_status text;
 email_at timestamptz;
 errors_24h integer:=0;
 slow_24h integer:=0;
 recent_events jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or not public.is_app_admin() then
  raise exception 'Admin access required' using errcode='42501';
 end if;

 select coalesce((select s.ai_paused from public.security_limits s where s.id=true),false) into ai_paused;
 select greatest(
   (select max(created_at) from public.ai_usage_events where status='succeeded'),
   (select max(created_at) from public.ai_provider_usage)
  ),
  (select max(created_at) from public.ai_usage_events where status='failed')
 into latest_ai_success,latest_ai_failure;

 select
  (select count(*) from public.resume_intake_tasks where status='failed' and updated_at>now()-interval '24 hours')+
  (select count(*) from public.job_reassessment_tasks where status='failed' and updated_at>now()-interval '24 hours')+
  (select count(*) from public.job_criteria_tasks where status='failed' and updated_at>now()-interval '24 hours')
 into ai_task_failed;

 select count(*) filter(where status='failed' and updated_at>now()-interval '24 hours'),
        count(*) filter(where status='processing' and lease_until<now()-interval '5 minutes'),
        max(updated_at) filter(where status in ('ready','approved'))
 into resume_failed,resume_stuck,latest_resume_success from public.resume_intake_tasks;

 select max(updated_at) filter(where status in ('ready','approved'))
 into latest_reassessment_success from public.job_reassessment_tasks;

 latest_assessment:=greatest(latest_resume_success,latest_reassessment_success);
 if latest_assessment='-infinity'::timestamptz then latest_assessment:=null;end if;

 select s.status,s.created_at into email_status,email_at
 from public.onboarding_reminder_sends s order by s.created_at desc limit 1;

 select count(*) filter(where severity='error'),
        count(*) filter(where category='performance')
 into errors_24h,slow_24h
 from public.reliability_events where created_at>now()-interval '24 hours';

 select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc),'[]'::jsonb) into recent_events
 from (
  select id,workspace_id,source,category,operation,severity,error_code,duration_ms,created_at
  from public.reliability_events order by created_at desc limit 50
 ) e;

 return jsonb_build_object(
  'generated_at',now(),
  'database',jsonb_build_object('status','healthy','detail','Health query completed'),
  'auth',jsonb_build_object('status','healthy','detail','Admin session verified'),
  'ai',jsonb_build_object(
    'status',case when ai_paused or ai_task_failed>0 then 'degraded'
      when latest_ai_failure is not null and latest_ai_failure>coalesce(latest_ai_success,'epoch'::timestamptz) and latest_ai_failure>now()-interval '30 minutes' then 'degraded'
      when latest_ai_success is not null and latest_ai_success>now()-interval '24 hours' then 'healthy'
      else 'unknown' end,
    'paused',ai_paused,'task_failed_24h',ai_task_failed,'latest_success',latest_ai_success,'latest_failure',latest_ai_failure),
  'resume',jsonb_build_object(
    'status',case when resume_stuck>0 or resume_failed>0 then 'degraded' when latest_resume_success is not null then 'healthy' else 'unknown' end,
    'failed_24h',resume_failed,'stuck',resume_stuck,'latest_success',latest_resume_success),
  'email',jsonb_build_object(
    'status',case when email_status='failed' then 'degraded'
      when email_status='claimed' and email_at<now()-interval '10 minutes' then 'degraded'
      when email_status='sent' then 'healthy' else 'unknown' end,
    'latest_status',email_status,'latest_at',email_at),
  'assessment',jsonb_build_object(
    'status',case when latest_assessment is null then 'unknown' else 'healthy' end,
    'latest_success',latest_assessment),
  'monitoring',jsonb_build_object('errors_24h',errors_24h,'slow_24h',slow_24h,'recent_events',recent_events)
 );
end $$;
revoke all on function public.get_system_health() from public,anon;
grant execute on function public.get_system_health() to authenticated;

comment on table public.reliability_events is 'Structured operational failures and slow operations. Direct client access is denied; writes use a scoped RPC and reads use the admin health RPC.';

commit;
