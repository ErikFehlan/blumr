begin;
set local lock_timeout='2s';
-- Prospective identifiers only. No candidate text, feedback, or submittal content.
create table if not exists public.retention_events (
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid not null,
 candidate_ids uuid[] not null,
 document_id uuid,
 event_type text not null check(event_type in ('resume_uploaded','assessment_completed','submittal_saved','comparison_viewed')),
 source_key text not null unique,
 occurred_at timestamptz not null default clock_timestamp(),
 check(cardinality(candidate_ids) between 1 and 4)
);
create index if not exists retention_user_time on public.retention_events(user_id,occurred_at);
create index if not exists retention_workspace on public.retention_events(workspace_id);
create table if not exists public.retention_tracking_state (
 singleton boolean primary key default true check(singleton),started_at timestamptz not null default clock_timestamp()
);
insert into public.retention_tracking_state(singleton) values(true) on conflict do nothing;
create table if not exists public.retention_cohorts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 cohort text not null check(cohort in ('external','internal','test')),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz not null default clock_timestamp()
);
alter table public.retention_events enable row level security;
alter table public.retention_tracking_state enable row level security;
alter table public.retention_cohorts enable row level security;
revoke all on public.retention_events,public.retention_tracking_state,public.retention_cohorts from public,anon,authenticated;
grant all on public.retention_events,public.retention_tracking_state,public.retention_cohorts to service_role;
grant usage,select on sequence public.retention_events_id_seq to service_role;

-- Capture the durable candidate/document mapping while its source task still
-- exists. Later task replacement and candidate deletion cannot rewrite it.
create or replace function public.capture_retention_usage() returns trigger
language plpgsql security definer set search_path='' as $$
declare j uuid;c uuid;d uuid;
begin
 if new.recovered or new.user_id is null then return new;end if;
 if new.event_type='resume_uploaded' then
  select job_id,candidate_id,id into j,c,d from public.candidate_documents
   where 'candidate_documents:'||id=new.source_key and workspace_id=new.workspace_id;
 elsif new.event_type='resume_analysis_completed' then
  select t.job_id,t.candidate_id,doc.id into j,c,d from public.resume_intake_tasks t
   join public.candidate_documents doc on doc.id::text=t.input->>'document_id'
    and doc.candidate_id=t.candidate_id and doc.job_id=t.job_id and doc.workspace_id=t.workspace_id
   where 'resume_intake_tasks:'||t.usage_run_id||':resume_analysis_completed'=new.source_key and t.workspace_id=new.workspace_id;
 else return new;
 end if;
 if c is not null then
  insert into public.retention_events(workspace_id,user_id,job_id,candidate_ids,document_id,event_type,source_key,occurred_at)
  values(new.workspace_id,new.user_id,j,array[c],d,case when new.event_type='resume_uploaded' then 'resume_uploaded' else 'assessment_completed' end,
   'usage:'||new.id,new.occurred_at) on conflict(source_key) do nothing;
 end if;
 return new;
end$$;
revoke all on function public.capture_retention_usage() from public,anon,authenticated;
create or replace trigger capture_retention_usage after insert on public.product_usage_events for each row execute function public.capture_retention_usage();

-- A successful save counts only a nonempty changed draft; polling, retries,
-- failed transactions and copying the same saved draft add no saved work.
create or replace function public.capture_retention_submittal() returns trigger
language plpgsql security definer set search_path='' as $$
declare draft text:=btrim(new.evidence#>>'{submission_draft,text}');
begin
 if auth.uid() is null or not public.is_workspace_member(new.workspace_id) or new.assessment_type<>'manual_correction' or coalesce(draft,'')='' then return new;end if;
 if tg_op='UPDATE' and draft is not distinct from btrim(old.evidence#>>'{submission_draft,text}') then return new;end if;
 insert into public.retention_events(workspace_id,user_id,job_id,candidate_ids,event_type,source_key)
 values(new.workspace_id,auth.uid(),new.job_id,array[new.candidate_id],'submittal_saved','submittal:'||new.id||':'||txid_current()) on conflict(source_key) do nothing;
 return new;
end$$;
revoke all on function public.capture_retention_submittal() from public,anon,authenticated;
create or replace trigger capture_retention_submittal after insert or update on public.candidate_assessments for each row execute function public.capture_retention_submittal();

-- Browser observation, never presented as server-confirmed saved work.
create or replace function public.record_retention_comparison(p_job uuid,p_candidates uuid[],p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
declare w uuid;ids uuid[];
begin
 select workspace_id into w from public.jobs where id=p_job;
 if auth.uid() is null or w is null or not public.is_workspace_member(w) then raise exception 'Search unavailable' using errcode='42501';end if;
 if p_session is null or coalesce(cardinality(p_candidates),0) not between 2 and 4 then raise exception 'Select two to four candidates' using errcode='22023';end if;
 select array_agg(distinct x order by x) into ids from unnest(p_candidates) x;
 if cardinality(ids)<>cardinality(p_candidates) or exists(select 1 from unnest(ids) x where x is null or not exists(select 1 from public.candidates c where c.id=x and c.job_id=p_job and c.workspace_id=w)) then
  raise exception 'Candidates unavailable' using errcode='42501';
 end if;
 insert into public.retention_events(workspace_id,user_id,job_id,candidate_ids,event_type,source_key)
 values(w,auth.uid(),p_job,ids,'comparison_viewed','comparison:'||auth.uid()||':'||p_session||':'||p_job||':'||md5(ids::text)) on conflict(source_key) do nothing;
end$$;
revoke all on function public.record_retention_comparison(uuid,uuid[],uuid) from public,anon;
grant execute on function public.record_retention_comparison(uuid,uuid[],uuid) to authenticated;

create or replace function public.set_retention_cohort(p_user uuid,p_cohort text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if p_cohort is null or p_cohort not in ('external','internal','test','unreviewed') then raise exception 'Invalid cohort' using errcode='22023';end if;
 if not exists(select 1 from auth.users u where u.id=p_user and u.email not like '%@example.invalid' and not exists(select 1 from public.app_admins a where (a.email=lower(u.email) or to_jsonb(a)->>'user_id'=u.id::text))) then
  raise exception 'Account unavailable or automatically excluded' using errcode='22023';
 end if;
 if p_cohort='unreviewed' then delete from public.retention_cohorts where user_id=p_user;
 else insert into public.retention_cohorts(user_id,cohort,reviewed_by) values(p_user,p_cohort,auth.uid())
  on conflict(user_id) do update set cohort=excluded.cohort,reviewed_by=excluded.reviewed_by,reviewed_at=clock_timestamp();
 end if;
end$$;
revoke all on function public.set_retention_cohort(uuid,text) from public,anon;
grant execute on function public.set_retention_cohort(uuid,text) to authenticated;

create or replace function public.get_admin_retention_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare report jsonb;
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 with accounts as (
  select u.id,u.email,case when exists(select 1 from public.app_admins a where (a.email=lower(u.email) or to_jsonb(a)->>'user_id'=u.id::text)) then 'internal'
   when u.email like '%@example.invalid' then 'test' else coalesce(c.cohort,'unreviewed') end cohort,
   u.email like '%@example.invalid' or exists(select 1 from public.app_admins a where (a.email=lower(u.email) or to_jsonb(a)->>'user_id'=u.id::text)) as locked
  from auth.users u left join public.retention_cohorts c on c.user_id=u.id
 ), candidates as (
  select user_id,workspace_id,candidate_ids[1] candidate_id,min(occurred_at) completed_at from public.retention_events
  where event_type='assessment_completed' and occurred_at<=now() group by user_id,workspace_id,candidate_ids[1]
 ), ordered as (
  select *,row_number() over(partition by user_id order by completed_at,candidate_id) ordinal from candidates
 ), activations as (
  select user_id,min(completed_at) filter(where ordinal=1) first_at,min(completed_at) filter(where ordinal=2) second_at from ordered group by user_id
 ), human_work as (
  select user_id,occurred_at from public.product_usage_events where not recovered and not background and event_type in (
   'job_created','candidate_added','resume_uploaded','feedback_saved','screening_saved','interview_outcome_saved','job_updated','job_closed','job_reopened',
   'candidate_stage_changed','feedback_updated','screening_updated','interview_outcome_updated','assessment_approved','assessment_dismissed')
  union all select user_id,occurred_at from public.retention_events where event_type='submittal_saved'
 ), people as (
  select a.*,f.first_at,f.second_at,
   (select min(h.occurred_at) from human_work h where h.user_id=a.id and h.occurred_at<=now() and h.occurred_at>f.first_at
    and (h.occurred_at at time zone 'America/New_York')::date>(f.first_at at time zone 'America/New_York')::date) return_at,
   (select min(e.occurred_at) from public.retention_events e where e.user_id=a.id and e.event_type='comparison_viewed' and e.occurred_at<=now()
    and (e.occurred_at at time zone 'America/New_York')::date>(f.first_at at time zone 'America/New_York')::date) comparison_at,
   (select min(e.occurred_at) from public.retention_events e where e.user_id=a.id and e.event_type='submittal_saved' and e.occurred_at<=now()
    and (e.occurred_at at time zone 'America/New_York')::date>(f.first_at at time zone 'America/New_York')::date) submittal_at
  from accounts a left join activations f on f.user_id=a.id
 ), cohorts as (
  select cohort,count(*) accounts,count(first_at) activated,count(second_at) second_assessment,
   percentile_cont(0.5) within group(order by extract(epoch from second_at-first_at)/3600) filter(where second_at is not null) median_hours_to_second,
   count(*) filter(where first_at<=now()-interval '7 days') eligible_7d,
   count(*) filter(where first_at<=now()-interval '7 days' and return_at<=first_at+interval '7 days') returned_7d,
   count(*) filter(where first_at<=now()-interval '30 days') eligible_30d,
   count(*) filter(where first_at<=now()-interval '30 days' and return_at<=first_at+interval '30 days') returned_30d,
   count(*) filter(where first_at<=now()-interval '7 days' and comparison_at<=first_at+interval '7 days') comparison_return_7d,
   count(*) filter(where first_at<=now()-interval '7 days' and submittal_at<=first_at+interval '7 days') submittal_return_7d,
   count(*) filter(where first_at<=now()-interval '30 days' and comparison_at<=first_at+interval '30 days') comparison_return_30d,
   count(*) filter(where first_at<=now()-interval '30 days' and submittal_at<=first_at+interval '30 days') submittal_return_30d
  from people group by cohort
 ) select jsonb_build_object('generated_at',now(),'tracking_started_at',(select started_at from public.retention_tracking_state where singleton),
  'cohorts',coalesce((select jsonb_agg(to_jsonb(c) order by cohort) from cohorts c),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by cohort,email,id) from accounts a),'[]'::jsonb)) into report;
 return report;
end$$;
revoke all on function public.get_admin_retention_summary() from public,anon;
grant execute on function public.get_admin_retention_summary() to authenticated;
comment on table public.retention_events is 'Prospective candidate linkage and saved submittals; comparisons are browser observations. No business content. Candidate deletion preserves identifiers; account/workspace deletion removes events.';
commit;
