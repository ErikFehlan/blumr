export function assessHealth(snapshot,backup,now=Date.now()){
 const failures=[];
 const fields=['queued_over_15m','failed_last_24h','expired_workers','uncertain_workers','uncertain_direct','client_tables_without_rls','exposed_worker_functions','active_schedulers'];
 if(!snapshot||fields.some(k=>!(['number','string'].includes(typeof snapshot[k]))||String(snapshot[k]).trim()===''||!Number.isSafeInteger(Number(snapshot[k]))||Number(snapshot[k])<0)||typeof snapshot.private_resumes!=='boolean')return {healthy:false,failures:['health_evidence_incomplete']};
 if(Number(snapshot.failed_last_24h)>0)failures.push('recent_assessment_failures');
 if(Number(snapshot.queued_over_15m)>0)failures.push('assessment_queue_over_15_minutes');
 if(Number(snapshot.expired_workers)>0)failures.push('expired_worker_not_recovered');
 if(Number(snapshot.uncertain_workers)>0||Number(snapshot.uncertain_direct)>0)failures.push('provider_verification_required');
 if(Number(snapshot.client_tables_without_rls)>0||Number(snapshot.exposed_worker_functions)>0||snapshot.private_resumes!==true)failures.push('access_controls_drifted');
 if(Number(snapshot.active_schedulers)<2)failures.push('assessment_scheduler_inactive');
 if(!backup||!Number.isFinite(Date.parse(backup.completed_at))||backup.conclusion!=='success'||!backup.artifact||now-Date.parse(backup.completed_at)>36*3600000||Date.parse(backup.completed_at)>now+300000)failures.push('verified_backup_missing_or_stale');
 return {healthy:failures.length===0,failures};
}
export const healthSQL=`select
 (select count(*) from (select t.updated_at from public.resume_intake_tasks t join public.jobs j on j.id=t.job_id where t.status='queued' and j.status='active' union all select t.updated_at from public.job_reassessment_tasks t join public.jobs j on j.id=t.job_id where t.status='queued' and j.status='active' union all select t.updated_at from public.job_criteria_tasks t join public.jobs j on j.id=t.job_id where t.status in ('queued','processing') and j.status='active')t where updated_at<now()-interval '15 minutes') as queued_over_15m,
 (select count(*) from (select t.updated_at from public.resume_intake_tasks t join public.jobs j on j.id=t.job_id where t.status='failed' and j.status='active' union all select t.updated_at from public.job_reassessment_tasks t join public.jobs j on j.id=t.job_id where t.status='failed' and j.status='active' union all select t.updated_at from public.job_criteria_tasks t join public.jobs j on j.id=t.job_id where t.status='failed' and j.status='active')t where updated_at>now()-interval '24 hours') as failed_last_24h,
 (select count(*) from public.assessment_worker_attempts where state not in ('closed','uncertain') and lease_until<now()-interval '5 minutes') as expired_workers,
 (select count(*) from public.assessment_worker_attempts where state='uncertain') as uncertain_workers,
 (select count(*) from public.direct_ai_requests where status='processing' and provider_started_at is not null and expires_at<now()-interval '5 minutes') as uncertain_direct,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity and has_table_privilege('authenticated',c.oid,'select,insert,update,delete')) as client_tables_without_rls,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('claim_assessment_work','heartbeat_assessment_work','begin_assessment_provider','end_assessment_provider','finish_assessment_work','release_assessment_work','recover_expired_assessment_work','reserve_ai_budget') and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))) as exposed_worker_functions,
 (select not public and file_size_limit<=10485760 from storage.buckets where id='resumes') as private_resumes,
 (select count(*) from cron.job where active and jobname in ('ancalagon-job-reassessment','ancalagon-criteria-worker')) as active_schedulers`;
