\set ON_ERROR_STOP on
\ir subscription-screening.sql
\ir ../supabase/migrations/20261028151317_subscription_feedback_usage.sql
\ir ../supabase/migrations/20261028151317_subscription_feedback_usage.sql

-- Close unstarted synthetic leases left by the inherited admission assertions.
do $$declare l uuid;begin
 for l in select lease_id from assessment_worker_attempts where state='reserved' loop
  perform finish_assessment_work(l,null,'provider_calls_disabled');
 end loop;
end$$;

-- The reduced inherited schema predates usage attribution. Supply its actor
-- assignment, retaining the production trigger name to verify execution order.
create function public.test_feedback_actor() returns trigger language plpgsql as $$begin
 if tg_op='INSERT' or new.revision is distinct from old.revision or (new.status='queued' and old.status in ('ready','approved','ignored','cancelled')) then
  new.usage_actor_id:=coalesce(auth.uid(),(select created_by from public.candidates where id=new.candidate_id));
 end if;return new;
end$$;
create trigger identify_usage_operation before insert or update on resume_intake_tasks for each row execute function test_feedback_actor();
create trigger identify_usage_operation before insert or update on job_reassessment_tasks for each row execute function test_feedback_actor();
set test.role='authenticated';
set test.actor='00000000-0000-0000-0000-000000000001';
update subscription_accounts set plan_code='basic-v1' where user_id=auth.uid();

-- Both old reviewed candidates and resumes awaiting intake can store literal
-- notes and recruiter clarifications without leaving runnable AI work.
do $$declare j uuid:=gen_random_uuid();c uuid:=gen_random_uuid();f uuid:=gen_random_uuid();n integer;begin
 insert into jobs(id,workspace_id,title,description) values(j,'00000000-0000-0000-0000-000000000001','QA','Manual regression testing');
 insert into candidates(id,workspace_id,job_id,role,created_by) values(c,'00000000-0000-0000-0000-000000000001',j,'Resume awaiting analysis',auth.uid());
 insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
 values('00000000-0000-0000-0000-000000000001',j,c,'manual_correction','{"resume_intake":{"phase":"uploading","backend":"durable-v1"}}');
 insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
 values('00000000-0000-0000-0000-000000000001',j,c,'00000000-0000-0000-0000-000000000001/'||j||'/'||c||'/source.txt','Synthetic.txt','Synthetic applicant owned manual regression testing for billing systems and documented defects.');
 if not exists(select from resume_intake_tasks where candidate_id=c and status='cancelled' and error_code='subscription_rules_only') then raise exception 'Basic intake remained runnable';end if;
 select count(*) into n from subscription_evaluations;
 insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_text)
 values(f,'00000000-0000-0000-0000-000000000001',j,c,'Original note: verify personal ownership.');
 insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
 values('00000000-0000-0000-0000-000000000001',j,c,'manager_feedback',jsonb_build_object('feedback_id',f,'learning_scope','candidate','signal_status','candidate_only','interpretation',jsonb_build_object('text','Ask for a specific release.','source','recruiter','reviewStatus','corrected')));
 if (select feedback_text from manager_feedback where id=f)<>'Original note: verify personal ownership.' then raise exception 'Original note changed';end if;
 if not exists(select from jsonb_array_elements(reassessment_feedback(j)) v where v->>'text'='Original note: verify personal ownership.' and v#>>'{interpretation,source}'='recruiter') then raise exception 'Recruiter clarification was not preserved';end if;
 update candidates set role='QA' where id=c;
 update candidate_assessments set evidence=jsonb_set(evidence,'{resume_intake,reviewedAt}','123') where candidate_id=c and assessment_type='manual_correction';
 perform enqueue_job_reassessments(j,c,'Recruiter clarification saved');
 if not exists(select from job_reassessment_tasks where candidate_id=c and status='cancelled' and error_code='subscription_rules_only') then raise exception 'Basic reassessment remained runnable';end if;
 if claim_assessment_work('intake',j)<>'[]'::jsonb or claim_assessment_work('reassessment',j)<>'[]'::jsonb then raise exception 'Basic feedback could be claimed';end if;
 if (select count(*) from subscription_evaluations)<>n then raise exception 'Manual feedback consumed an evaluation';end if;
end$$;

-- A Basic uploader must not suppress the Advanced colleague who explicitly
-- starts this batch. Service workers have no interactive auth identity.
do $$declare b uuid;cid uuid;claims jsonb;l uuid;begin
 b:=subscription_fixture(2,false);
 perform set_config('test.actor','00000000-0000-0000-0000-000000000002',false);perform start_resume_analysis(b);
 perform subscription_rules_fixture(b);
 perform set_config('test.actor','',false);perform set_config('test.role','service_role',false);
 perform auto_start_resume_analysis(b);
 if (select count(*) from resume_intake_tasks where job_id=(select job_id from screening_batches where id=b) and status='queued' and usage_actor_id='00000000-0000-0000-0000-000000000002')<>2 then raise exception 'Guard lost the subscribed batch initiator';end if;
 claims:=claim_assessment_work('intake',(select job_id from screening_batches where id=b));cid:=(claims->0->>'candidate_id')::uuid;l:=(claims->0->>'lease_id')::uuid;
 if l is null then raise exception 'Advanced work was not claimable';end if;
 -- Downgrading must retain an already owned provider attempt for recovery.
 update subscription_accounts set plan_code='basic-v1' where user_id='00000000-0000-0000-0000-000000000002';
 update resume_intake_tasks set status='queued' where candidate_id=cid;
 if not exists(select from assessment_worker_attempts where lease_id=l and state<>'closed') or not exists(select from resume_intake_tasks where candidate_id=cid and lease_id=l) then raise exception 'Downgrade erased owned work';end if;
 update subscription_accounts set plan_code='advanced-v1' where user_id='00000000-0000-0000-0000-000000000002';
end$$;

set test.role='authenticated';
set test.actor='00000000-0000-0000-0000-000000000002';
set role authenticated;
do $$declare s jsonb;begin
 s:=get_my_subscription();
 if s->>'tier'<>'advanced' or (s->>'period_starts_at')::timestamptz>now() or (s->>'period_ends_at')::timestamptz<=now() then raise exception 'Current period dates unavailable';end if;
 if s#>>'{usage,rules,used}'<>'24' then raise exception 'Usage mixed another account';end if;
 if s ? 'user_id' or s ? 'stripe_customer_id' or s ? 'provider_tokens' then raise exception 'Internal billing fields exposed';end if;
 if has_function_privilege('authenticated','guard_subscription_feedback_work()','execute') or has_function_privilege('anon','get_my_subscription()','execute') then raise exception 'Subscription function permissions widened';end if;
end$$;
reset role;
