begin;
-- Observed actions are separate from confirmed server-side usage accounting.
create table if not exists public.activation_milestones (
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 milestone text not null check(milestone in ('quick_start_opened','resume_saved','assessment_viewed','submittal_prepared')),
 job_id uuid references public.jobs(id) on delete set null,
 created_at timestamptz not null default now(),
 primary key(user_id,workspace_id,milestone)
);
alter table public.activation_milestones enable row level security;
grant insert on public.activation_milestones to authenticated;
grant select on public.activation_milestones to authenticated;
drop policy if exists activation_insert_own on public.activation_milestones;
create policy activation_insert_own on public.activation_milestones for insert to authenticated with check(
 user_id=(select auth.uid()) and public.is_workspace_member(workspace_id)
 and (milestone='quick_start_opened' and job_id is null or exists(
  select from public.jobs j where j.id=activation_milestones.job_id and j.workspace_id=activation_milestones.workspace_id))
);
drop policy if exists activation_select_admin on public.activation_milestones;
create policy activation_select_admin on public.activation_milestones for select to authenticated using(public.is_app_admin());
create or replace function public.get_admin_activation_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 with observed as (
  select user_id,min(created_at) filter(where milestone='resume_saved') as resume_at,
   min(created_at) filter(where milestone='assessment_viewed') as view_at,
   min(created_at) filter(where milestone='submittal_prepared') as submittal_at
  from public.activation_milestones group by user_id
 ), saved_jobs as (
  select user_id,min(occurred_at) as job_at from public.product_usage_events where event_type='job_created' group by user_id
 ), people as (
  select u.id,u.created_at,j.job_at,o.resume_at,o.view_at,o.submittal_at from auth.users u
  left join saved_jobs j on j.user_id=u.id left join observed o on o.user_id=u.id
 ) select jsonb_build_object('accounts',count(*),'jobs',count(job_at),'resumes',count(resume_at),
  'views',count(view_at),'submittals',count(submittal_at),
  'median_minutes_to_view',percentile_cont(0.5) within group(order by extract(epoch from (view_at-created_at))/60) filter(where view_at>=created_at)) into result from people;
 return result;
end$$;
revoke all on function public.get_admin_activation_summary() from public,anon;
grant execute on function public.get_admin_activation_summary() to authenticated;
comment on table public.activation_milestones is 'First observed actions per user/workspace. No document text, candidate names, notes or model content. Browser observations are not confirmed server usage.';
notify pgrst,'reload schema';
commit;
