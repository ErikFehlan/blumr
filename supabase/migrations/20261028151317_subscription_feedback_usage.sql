begin;
set local lock_timeout='5s';

-- Run after identify_usage_operation. Basic feedback can update stored evidence
-- without filling the AI queue with tasks that the admission gate must reject.
-- Active provider attempts retain their existing lease and recovery protocol.
create or replace function public.guard_subscription_feedback_work() returns trigger
language plpgsql security definer set search_path='' as $$
declare tier_name text;actor uuid;
begin
 if new.status<>'queued' then return new;end if;
 if exists(select from public.assessment_worker_attempts where candidate_id=new.candidate_id and state<>'closed') then return new;end if;
 actor:=new.usage_actor_id;
 if tg_table_name='resume_intake_tasks' then
  select coalesce(b.analysis_actor_id,b.created_by) into actor from public.screening_finalists f
   join public.screening_batches b on b.id=f.batch_id where f.candidate_id=new.candidate_id and f.revision=new.revision;
  if found then new.usage_actor_id:=actor;else actor:=new.usage_actor_id;end if;
 end if;
 select p.tier into tier_name from public.subscription_accounts a join public.subscription_plan_versions p on p.code=a.plan_code where a.user_id=actor;
 if tier_name='basic' then
  new.status:='cancelled';new.error_code:='subscription_rules_only';new.result:=null;new.lease_id:=null;new.lease_until:=null;
 end if;
 return new;
end$$;
revoke all on function public.guard_subscription_feedback_work() from public,anon,authenticated;
drop trigger if exists zz_subscription_feedback_guard on public.resume_intake_tasks;
create trigger zz_subscription_feedback_guard before insert or update on public.resume_intake_tasks
 for each row execute function public.guard_subscription_feedback_work();
drop trigger if exists zz_subscription_feedback_guard on public.job_reassessment_tasks;
create trigger zz_subscription_feedback_guard before insert or update on public.job_reassessment_tasks
 for each row execute function public.guard_subscription_feedback_work();

-- RLS still limits every read to the authenticated subscriber. No billing
-- mutation, provider tokens, price IDs or internal costs are exposed here.
create or replace function public.get_my_subscription() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare a public.subscription_accounts;p public.subscription_periods;plan public.subscription_plan_versions;usage jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select * into a from public.subscription_accounts where user_id=auth.uid();
 if not found then return null;end if;
 select * into p from public.subscription_periods where id=a.current_period_id;
 select * into plan from public.subscription_plan_versions where code=a.plan_code;
 select jsonb_object_agg(metric,jsonb_build_object('used',used,'pending',pending,'limit',maximum,'remaining',greatest(0,maximum-used-pending))) into usage from (
  select m.metric,m.maximum,count(e.id) filter(where e.state='succeeded') as used,count(e.id) filter(where e.state in ('reserved','uncertain')) as pending
  from (values('rules',p.rules_limit),('shortlist_ai',p.shortlist_ai_limit),('deep_ai',p.deep_ai_limit)) m(metric,maximum)
  left join public.subscription_evaluations e on e.account_id=a.id and e.period_id=p.id and e.metric=m.metric group by m.metric,m.maximum
 ) totals;
 return jsonb_build_object('tier',plan.tier,'status',a.status,'period_starts_at',p.starts_at,'period_ends_at',p.ends_at,'access_until',a.access_until,'usage',usage);
end$$;
revoke all on function public.get_my_subscription() from public,anon;
grant execute on function public.get_my_subscription() to authenticated;
commit;
