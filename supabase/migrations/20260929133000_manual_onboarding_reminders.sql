begin;

-- Admins can inspect this week's result before attempting a manual send.
create or replace function public.get_onboarding_reminders() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',b.user_id,'email',b.email,'approved',b.approved,
  'enabled',coalesce(r.enabled,false),'opted_out',coalesce(r.opted_out,false),
  'step',public.onboarding_step(b.user_id),'last_sent_at',r.last_sent_at,'send_status',s.status) order by b.email)
  from public.beta_access b left join public.onboarding_reminder_recipients r on r.user_id=b.user_id
  left join public.onboarding_reminder_sends s on s.user_id=b.user_id
   and s.week_start=date_trunc('week',now() at time zone 'UTC')::date
  where b.user_id is not null),'[]'::jsonb);
end$$;

-- A manual send uses the same weekly claim and idempotency key as the schedule.
-- The caller is authenticated as an admin in the Edge Function; this claim is
-- service-role-only and rechecks the recipient at the moment of dispatch.
create function public.claim_manual_onboarding_reminder(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.role()<>'service_role' then raise exception 'Worker access required' using errcode='42501';end if;
 with eligible as (
  select r.user_id,u.email,public.onboarding_step(r.user_id) step
  from public.onboarding_reminder_recipients r join auth.users u on u.id=r.user_id
  join public.beta_access b on b.user_id=r.user_id and b.approved
  where r.user_id=p_user and r.enabled and not r.opted_out and u.email_confirmed_at is not null
   and (u.banned_until is null or u.banned_until<=now())
   and not exists(select from public.account_deletions d where d.user_id=r.user_id)
 ), claimed as (
  insert into public.onboarding_reminder_sends(user_id,week_start,step)
  select user_id,date_trunc('week',now() at time zone 'UTC')::date,step
  from eligible where step<>'done'
  on conflict(user_id,week_start) do update
   set status='claimed',step=excluded.step,provider_id=null,created_at=now()
   where public.onboarding_reminder_sends.status='failed'
    and public.onboarding_reminder_sends.provider_id is null
  returning user_id,week_start,step
 ) select jsonb_build_object('user_id',c.user_id,'email',e.email,'week_start',c.week_start,'step',c.step)
 into result from claimed c join eligible e on e.user_id=c.user_id;
 return result;
end$$;
revoke all on function public.claim_manual_onboarding_reminder(uuid) from public,anon,authenticated;
grant execute on function public.claim_manual_onboarding_reminder(uuid) to service_role;

commit;
