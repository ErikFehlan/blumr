\set ON_ERROR_STOP on
\ir assessment-capacity.sql
\ir ../supabase/migrations/20261005133313_durable_worker_recovery.sql
\ir ../supabase/migrations/20261005133313_durable_worker_recovery.sql
truncate resume_intake_tasks,job_reassessment_tasks,direct_ai_requests,assessment_worker_attempts;
-- Use real source functions and revision triggers, not stubbed input checks.
update candidates set role='Resume awaiting analysis' where id in(select id from capacity_candidates where n=1 and g=1);
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
 select w,j,id,'manual_correction','{"resume_intake":{"phase":"uploading","backend":"durable-v1"}}' from capacity_candidates where n=1 and g=1;
insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
 select w,j,id,w||'/'||j||'/'||id||'/recovery.txt','Synthetic.txt','Synthetic QA Analyst. Owned manual regression testing and documented billing defects.' from capacity_candidates where n=1 and g=1;
create function reset_worker_fixture() returns void language plpgsql as $$begin
 truncate assessment_worker_attempts,job_reassessment_tasks,direct_ai_requests;
 update resume_intake_tasks set status='queued',attempts=0,lease_id=null,lease_until=null,error_code=null,result=null,next_run_at=now();
end$$;
create function claim_intake_fixture() returns public.resume_intake_tasks language plpgsql as $$declare t public.resume_intake_tasks;begin
 perform claim_assessment_work('intake',null);select * into t from resume_intake_tasks limit 1;return t;
end$$;
create function valid_intake_result() returns jsonb language sql as $$select '{"score":8,"manager_score":8,"resume_evidence":[],"context_signature":"synthetic"}'::jsonb$$;
-- Old workers cannot acquire unfenced paid work; all new controls stay private.
do $$begin
 if exists(select from claim_resume_intakes()) or exists(select from claim_job_reassessments()) then raise exception 'Old worker protocol still active';end if;
 if has_table_privilege('authenticated','assessment_worker_attempts','select,insert,update,delete') or has_table_privilege('anon','assessment_worker_attempts','select') then raise exception 'Attempt ledger exposed';end if;
 if has_function_privilege('authenticated','claim_assessment_work(text,uuid)','execute') or has_function_privilege('anon','begin_assessment_provider(uuid,uuid)','execute') then raise exception 'Worker protocol exposed';end if;
end$$;
-- A dead worker that never called the provider is safe to replace. Its old
-- token cannot begin provider work, renew, or save after reclamation.
do $$declare t resume_intake_tasks;n resume_intake_tasks;begin
 t:=claim_intake_fixture();
 update assessment_worker_attempts set lease_until=now()-interval '1 second' where lease_id=t.lease_id;
 perform recover_expired_assessment_work();
 if (select status from resume_intake_tasks where candidate_id=t.candidate_id)<>'queued' then raise exception 'Unstarted work did not recover';end if;
 update resume_intake_tasks set next_run_at=now();n:=claim_intake_fixture();
 if n.lease_id=t.lease_id or n.attempts<>2 then raise exception 'Recovery did not rotate lease';end if;
 if begin_assessment_provider(t.lease_id,gen_random_uuid()) or heartbeat_assessment_work(t.lease_id) or finish_resume_intake(t.candidate_id,t.revision,t.lease_id,valid_intake_result()) then raise exception 'Replaced owner remained active';end if;
end$$;
select reset_worker_fixture();
-- An acknowledged start is single-use. Expiry never reissues ambiguous work.
do $$declare t resume_intake_tasks;call uuid:=gen_random_uuid();begin
 t:=claim_intake_fixture();
 if not begin_assessment_provider(t.lease_id,call) or begin_assessment_provider(t.lease_id,call) or begin_assessment_provider(t.lease_id,gen_random_uuid()) then raise exception 'Provider start fence failed';end if;
 update assessment_worker_attempts set lease_until=now()-interval '1 second' where lease_id=t.lease_id;
 perform recover_expired_assessment_work();
 if active_assessment_count(null)<>1 or jsonb_array_length(claim_assessment_work('intake',null))<>0 then raise exception 'Ambiguous work was reissued';end if;
 if (select error_code from resume_intake_tasks where candidate_id=t.candidate_id)<>'provider_outcome_uncertain' then raise exception 'Recovery reason not shown';end if;
 -- A genuine late response can settle the original attempt, but not start more work.
 if not end_assessment_provider(t.lease_id,call) or begin_assessment_provider(t.lease_id,gen_random_uuid()) then raise exception 'Late response reopened provider start';end if;
 if not finish_resume_intake(t.candidate_id,t.revision,t.lease_id,valid_intake_result()) or active_assessment_count(null)<>0 then raise exception 'Late valid result not recovered';end if;
 if not finish_resume_intake(t.candidate_id,t.revision,t.lease_id,valid_intake_result()) then raise exception 'Lost save acknowledgement not idempotent';end if;
end$$;
select reset_worker_fixture();
-- Edits cannot free in-flight capacity or allow stale results to overwrite.
do $$declare t resume_intake_tasks;call uuid:=gen_random_uuid();begin
 t:=claim_intake_fixture();perform begin_assessment_provider(t.lease_id,call);
 update jobs set manager_feedback='Updated synthetic priority' where id=t.job_id;
 if active_assessment_count(null)<>1 or jsonb_array_length(claim_assessment_work('intake',null))<>0 then raise exception 'Source edit released running provider capacity';end if;
 if heartbeat_assessment_work(t.lease_id) then raise exception 'Superseded worker renewed';end if;
 update assessment_worker_attempts set lease_until=now()-interval '1 second' where lease_id=t.lease_id;
 perform claim_assessment_work('intake',null);
 if (select error_code from resume_intake_tasks where candidate_id=t.candidate_id)<>'provider_outcome_uncertain' then raise exception 'Superseded recovery not visible';end if;
 perform end_assessment_provider(t.lease_id,call);
 if finish_resume_intake(t.candidate_id,t.revision,t.lease_id,valid_intake_result()) then raise exception 'Stale result saved';end if;
 if active_assessment_count(null)<>0 or (select result from resume_intake_tasks where candidate_id=t.candidate_id) is not null then raise exception 'Stale completion affected queue';end if;
 if jsonb_array_length(claim_assessment_work('intake',null))<>1 then raise exception 'Latest input not claimable after settlement';end if;
end$$;
select reset_worker_fixture();
-- A completed response followed by a worker crash is not permission to bill
-- again. Normal explicit failures may retry; ambiguous local failures may not.
do $$declare t resume_intake_tasks;call uuid:=gen_random_uuid();begin
 t:=claim_intake_fixture();perform begin_assessment_provider(t.lease_id,call);perform end_assessment_provider(t.lease_id,call);
 if finish_resume_intake(t.candidate_id,t.revision,t.lease_id,null,'processing_failed') then raise exception 'Lost result automatically requeued';end if;
 if active_assessment_count(null)<>1 then raise exception 'Lost result reservation discarded';end if;
end$$;
select reset_worker_fixture();
do $$declare t resume_intake_tasks;call uuid:=gen_random_uuid();begin
 t:=claim_intake_fixture();perform begin_assessment_provider(t.lease_id,call);perform end_assessment_provider(t.lease_id,call);
 if not finish_resume_intake(t.candidate_id,t.revision,t.lease_id,null,'ai_rate_limit') then raise exception 'Explicit rejection not retryable';end if;
 if (select status from resume_intake_tasks where candidate_id=t.candidate_id)<>'queued' or active_assessment_count(null)<>0 then raise exception 'Safe retry failed';end if;
end$$;
select reset_worker_fixture();
-- Renewals are bounded; exhaustion and missing acknowledgements fail closed.
do $$declare t resume_intake_tasks;begin
 t:=claim_intake_fixture();
 if not heartbeat_assessment_work(t.lease_id) then raise exception 'Live worker heartbeat rejected';end if;
 update assessment_worker_attempts set deadline=now()-interval '1 second' where lease_id=t.lease_id;
 if heartbeat_assessment_work(t.lease_id) or begin_assessment_provider(t.lease_id,gen_random_uuid()) then raise exception 'Deadline extended without bound';end if;
end$$;
select reset_worker_fixture();
-- Admin-only recovery requires provider verification and records an audit.
create or replace function public.is_app_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
do $$declare t resume_intake_tasks;begin
 t:=claim_intake_fixture();perform begin_assessment_provider(t.lease_id,gen_random_uuid());
 perform finish_resume_intake(t.candidate_id,t.revision,t.lease_id,null,'processing_failed');
 perform set_config('test.actor',(select a::text from capacity_fixtures where n=1),false);
 begin perform recover_direct_ai_request(t.lease_id,'Synthetic provider request verified stopped',true);raise exception 'Non-admin recovered worker';exception when insufficient_privilege then null;end;
 perform set_config('test.admin','true',false);
 begin perform recover_direct_ai_request(t.lease_id,'Synthetic provider request verified stopped',true);raise exception 'Live worker window was bypassed';exception when sqlstate 'PT409' then null;end;
 update assessment_worker_attempts set deadline=now()-interval '3 minutes' where lease_id=t.lease_id;
 if jsonb_array_length(get_direct_ai_recovery())<>1 then raise exception 'Interrupted worker not in admin recovery';end if;
 begin perform recover_direct_ai_request(t.lease_id,'Synthetic provider request verified stopped',false);raise exception 'Unverified recovery accepted';exception when invalid_parameter_value then null;end;
 perform recover_direct_ai_request(t.lease_id,'Synthetic provider request verified stopped',true);
 if active_assessment_count(null)<>0 or (select status from resume_intake_tasks where candidate_id=t.candidate_id)<>'queued' then raise exception 'Verified recovery not queued';end if;
 if not exists(select from reliability_events where operation='durable_worker_recovery' and metadata->>'claim_id'=t.lease_id::text) then raise exception 'Recovery audit missing';end if;
 if end_assessment_provider(t.lease_id,(select provider_call from assessment_worker_attempts where lease_id=t.lease_id)) or finish_resume_intake(t.candidate_id,t.revision,t.lease_id,valid_intake_result()) then raise exception 'Recovered old owner returned';end if;
end$$;
select reset_worker_fixture();
-- Test actual service-role calls, not only owner execution.
set role service_role;
select claim_assessment_work('intake',null);
select heartbeat_assessment_work(lease_id) from assessment_worker_attempts where state='reserved';
reset role;
select reset_worker_fixture();
-- Leave real reassessment sources and queue rows for multi-connection tests.
select enqueue_job_reassessments(j,null,'Synthetic recovery race') from capacity_fixtures;
update job_reassessment_tasks set next_run_at=now();
do $$declare t job_reassessment_tasks;call uuid:=gen_random_uuid();begin
 perform claim_assessment_work('reassessment',(select j from capacity_fixtures where n=2));
 select * into t from job_reassessment_tasks where status='processing' order by candidate_id limit 1;
 if t.candidate_id is null then raise exception 'Reassessment fixture not claimed';end if;
 if not begin_assessment_provider(t.lease_id,call) or not end_assessment_provider(t.lease_id,call) then raise exception 'Reassessment provider not fenced';end if;
 if not finish_job_reassessment(t.candidate_id,t.revision,t.lease_id,'{"jd_score":8,"manager_score":8,"evidence_ids":[],"context_signature":"synthetic"}') then raise exception 'Reassessment result not saved';end if;
 if (select manager_score from candidates where id=t.candidate_id)<>7 then raise exception 'Worker changed a score without human approval';end if;
end$$;
-- Conservatively adopt an old in-flight worker, including expired leases.
truncate assessment_worker_attempts;
update job_reassessment_tasks set status='queued',attempts=0,lease_id=null,lease_until=null;
update resume_intake_tasks set status='processing',lease_id=gen_random_uuid(),lease_until=now()-interval '1 second';
\ir ../supabase/migrations/20261005133313_durable_worker_recovery.sql
do $$declare t resume_intake_tasks;begin
 select * into t from resume_intake_tasks limit 1;
 if not exists(select from assessment_worker_attempts where lease_id=t.lease_id and legacy and provider_pending) then raise exception 'Legacy call not retained';end if;
 if not finish_resume_intake(t.candidate_id,t.revision,t.lease_id,valid_intake_result()) then raise exception 'Known successful legacy completion lost';end if;
end$$;
-- Restore due rows for the subsequent multi-connection test.
truncate assessment_worker_attempts;
update resume_intake_tasks set status='queued',attempts=0,lease_id=null,lease_until=null,next_run_at=now();
update job_reassessment_tasks set status='queued',attempts=0,lease_id=null,lease_until=null,next_run_at=now();
