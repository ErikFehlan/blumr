begin;
create schema if not exists operations_private;
revoke all on schema operations_private from public,anon,authenticated;
create table if not exists operations_private.config (
 id boolean primary key default true check(id), key_sha256 text check(key_sha256 ~ '^[a-f0-9]{64}$'),
 backup jsonb, alert_from text, alert_to text
);
revoke all on operations_private.config from public,anon,authenticated;
insert into operations_private.config(id) values(true) on conflict do nothing;
create or replace function public.operations_health(p_key_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare config operations_private.config; snapshot jsonb;
begin
 select * into strict config from operations_private.config where id;
 if config.key_sha256 is null or p_key_sha256 is distinct from config.key_sha256 then raise exception 'unauthorized' using errcode='28000';end if;
 select to_jsonb(s) into snapshot from (select
 (select count(*) from (select t.updated_at from public.resume_intake_tasks t join public.jobs j on j.id=t.job_id where t.status='queued' and j.status='active' union all select t.updated_at from public.job_reassessment_tasks t join public.jobs j on j.id=t.job_id where t.status='queued' and j.status='active' union all select t.updated_at from public.job_criteria_tasks t join public.jobs j on j.id=t.job_id where t.status in ('queued','processing') and j.status='active')t where updated_at<now()-interval '15 minutes') as queued_over_15m,
 (select count(*) from (select t.updated_at from public.resume_intake_tasks t join public.jobs j on j.id=t.job_id where t.status='failed' and j.status='active' union all select t.updated_at from public.job_reassessment_tasks t join public.jobs j on j.id=t.job_id where t.status='failed' and j.status='active' union all select t.updated_at from public.job_criteria_tasks t join public.jobs j on j.id=t.job_id where t.status='failed' and j.status='active')t where updated_at>now()-interval '24 hours') as failed_last_24h,
 (select count(*) from public.assessment_worker_attempts where state not in ('closed','uncertain') and lease_until<now()-interval '5 minutes') as expired_workers,
 (select count(*) from public.assessment_worker_attempts where state='uncertain') as uncertain_workers,
 (select count(*) from public.direct_ai_requests where status='processing' and provider_started_at is not null and expires_at<now()-interval '5 minutes') as uncertain_direct,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'select,insert,update,delete')) as client_tables_without_rls,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_assessment_work','heartbeat_assessment_work','begin_assessment_provider','end_assessment_provider','finish_assessment_work','release_assessment_work','recover_expired_assessment_work','reserve_ai_budget') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) as exposed_worker_functions,
 (select not public and file_size_limit<=10485760 from storage.buckets where id='resumes') as private_resumes,
 (select count(*) from cron.job where active and jobname in ('ancalagon-job-reassessment','ancalagon-criteria-worker')) as active_schedulers)s;
 return jsonb_build_object('snapshot',snapshot,'backup',config.backup,'alerts_configured',config.alert_from is not null and config.alert_to is not null);
end$$;
revoke all on function public.operations_health(text) from public,anon,authenticated;
grant execute on function public.operations_health(text) to service_role;
commit;
