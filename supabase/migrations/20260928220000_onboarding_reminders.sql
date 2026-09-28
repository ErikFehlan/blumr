begin;
create table public.onboarding_reminder_recipients (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 opted_out boolean not null default false,
 last_sent_at timestamptz,
 last_step text,
 updated_at timestamptz not null default now()
);
alter table public.onboarding_reminder_recipients enable row level security;
revoke all on public.onboarding_reminder_recipients from public,anon,authenticated;
grant all on public.onboarding_reminder_recipients to service_role;

-- Calculate a user's next action from live workspace data. Team members can
-- continue work in a shared workspace without receiving stale first-job nudges.
create function public.onboarding_step(p_user uuid) returns text
language sql stable security definer set search_path='' as $$
 select case
  when not exists(select 1 from public.workspace_members m join public.jobs j on j.workspace_id=m.workspace_id where m.user_id=p_user) then 'create_job'
  when not exists(select 1 from public.workspace_members m join public.candidates c on c.workspace_id=m.workspace_id where m.user_id=p_user) then 'add_candidate'
  when exists(select 1 from public.resume_intake_tasks t where t.reviewed_by=p_user and t.status='approved')
    or exists(select 1 from public.job_reassessment_tasks t where t.reviewed_by=p_user and t.status='approved') then 'done'
  when exists(select 1 from public.workspace_members m join public.resume_intake_tasks t on t.workspace_id=m.workspace_id where m.user_id=p_user and t.status='ready')
    or exists(select 1 from public.workspace_members m join public.job_reassessment_tasks t on t.workspace_id=m.workspace_id where m.user_id=p_user and t.status='ready') then 'review_assessment'
  else 'done' end;
$$;
revoke all on function public.onboarding_step(uuid) from public,anon,authenticated;
grant execute on function public.onboarding_step(uuid) to service_role;

create function public.get_onboarding_reminders() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',b.user_id,'email',b.email,'approved',b.approved,
  'enabled',coalesce(r.enabled,false),'opted_out',coalesce(r.opted_out,false),
  'step',public.onboarding_step(b.user_id),'last_sent_at',r.last_sent_at) order by b.email)
  from public.beta_access b left join public.onboarding_reminder_recipients r on r.user_id=b.user_id
  where b.user_id is not null),'[]'::jsonb);
end$$;
create function public.set_onboarding_reminder_recipient(p_user uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if p_enabled is null or not exists(select from public.beta_access where user_id=p_user and approved) then
  raise exception 'Select an active beta user' using errcode='22023';end if;
 insert into public.onboarding_reminder_recipients(user_id,enabled) values(p_user,p_enabled)
 on conflict(user_id) do update set enabled=excluded.enabled,updated_at=now()
 where not public.onboarding_reminder_recipients.opted_out;
end$$;
create function public.opt_out_onboarding_reminders() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 insert into public.onboarding_reminder_recipients(user_id,enabled,opted_out) values(auth.uid(),false,true)
 on conflict(user_id) do update set enabled=false,opted_out=true,updated_at=now();
end$$;
revoke all on function public.get_onboarding_reminders(),public.set_onboarding_reminder_recipient(uuid,boolean),public.opt_out_onboarding_reminders() from public,anon;
grant execute on function public.get_onboarding_reminders(),public.set_onboarding_reminder_recipient(uuid,boolean),public.opt_out_onboarding_reminders() to authenticated;

-- One claim per user per UTC week. A locked claim survives worker retries;
-- the same idempotency key is reused by the email provider.
create table public.onboarding_reminder_sends (
 user_id uuid not null references auth.users(id) on delete cascade,
 week_start date not null,
 step text not null check(step in ('create_job','add_candidate','review_assessment')),
 status text not null default 'claimed' check(status in ('claimed','sent','failed')),
 provider_id text,
 created_at timestamptz not null default now(),
 primary key(user_id,week_start)
);
alter table public.onboarding_reminder_sends enable row level security;
revoke all on public.onboarding_reminder_sends from public,anon,authenticated;
grant all on public.onboarding_reminder_sends to service_role;

create function public.claim_onboarding_reminders() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Worker access required' using errcode='42501';end if;
 with eligible as (
  select r.user_id,u.email,public.onboarding_step(r.user_id) step
  from public.onboarding_reminder_recipients r join auth.users u on u.id=r.user_id
  join public.beta_access b on b.user_id=r.user_id and b.approved
  where r.enabled and not r.opted_out and u.email_confirmed_at is not null
   and (u.banned_until is null or u.banned_until<=now())
   and u.created_at<=now()-interval '7 days'
   and (r.last_sent_at is null or r.last_sent_at<=now()-interval '7 days')
   and not exists(select from public.account_deletions d where d.user_id=r.user_id)
 ), claimed as (
  insert into public.onboarding_reminder_sends(user_id,week_start,step)
  select user_id,date_trunc('week',now() at time zone 'UTC')::date,step from eligible where step<>'done'
  on conflict do nothing returning user_id,week_start,step
 ) select coalesce(jsonb_agg(jsonb_build_object('user_id',c.user_id,'email',e.email,'week_start',c.week_start,'step',c.step)),'[]'::jsonb)
 into result from claimed c join eligible e on e.user_id=c.user_id;
 return result;
end$$;
create function public.finish_onboarding_reminder(p_user uuid,p_week date,p_provider text,p_sent boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'Worker access required' using errcode='42501';end if;
 update public.onboarding_reminder_sends set status=case when p_sent then 'sent' else 'failed' end,provider_id=p_provider
 where user_id=p_user and week_start=p_week and status='claimed';
 if p_sent then update public.onboarding_reminder_recipients set last_sent_at=now(),last_step=(select step from public.onboarding_reminder_sends where user_id=p_user and week_start=p_week),updated_at=now() where user_id=p_user;end if;
end$$;
create function public.can_send_onboarding_reminder(p_user uuid,p_week date,p_step text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.role()='service_role' and exists(
  select 1 from public.onboarding_reminder_sends s
  join public.onboarding_reminder_recipients r on r.user_id=s.user_id
  join public.beta_access b on b.user_id=s.user_id
  where s.user_id=p_user and s.week_start=p_week and s.step=p_step and s.status='claimed'
   and r.enabled and not r.opted_out and b.approved and public.onboarding_step(p_user)=p_step);
$$;
revoke all on function public.claim_onboarding_reminders(),public.can_send_onboarding_reminder(uuid,date,text),public.finish_onboarding_reminder(uuid,date,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_onboarding_reminders(),public.can_send_onboarding_reminder(uuid,date,text),public.finish_onboarding_reminder(uuid,date,text,boolean) to service_role;
commit;
