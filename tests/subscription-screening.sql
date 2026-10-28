\set ON_ERROR_STOP on
-- Reuse the real upload, source validation, queue and worker migrations.
-- The inherited harness stubs only Supabase auth/net and provider cost admission.
\ir bulk-screening.sql
reset role;
set test.role='authenticated';
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='00000000-0000-0000-0000-000000000001';
create table public.workspace_members(workspace_id uuid references workspaces,user_id uuid references auth.users,primary key(workspace_id,user_id));
insert into workspace_members values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
grant usage on schema auth to authenticated,service_role;
grant select on public.workspace_members,public.candidates,public.candidate_documents,public.manager_feedback,public.candidate_assessments to service_role;
alter table public.resume_intake_tasks add column usage_actor_id uuid references auth.users;
alter table public.job_reassessment_tasks add column usage_actor_id uuid references auth.users;
create function public.reserve_ai_budget(uuid,uuid,integer,integer) returns jsonb language sql as $$select '{"allowed":true}'::jsonb$$;
\ir ../supabase/migrations/20261028134006_subscription_foundation.sql
\ir ../supabase/migrations/20261028142020_subscription_screening_enforcement.sql
\ir ../supabase/migrations/20261028142020_subscription_screening_enforcement.sql

truncate public.assessment_worker_attempts,public.resume_intake_tasks,public.job_reassessment_tasks,public.direct_ai_requests;
insert into subscription_accounts(id,user_id,plan_code,status,source) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','basic-v1','complimentary','manual');
insert into subscription_periods(id,account_id,starts_at,ends_at,rules_limit,shortlist_ai_limit,deep_ai_limit) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',now()-interval '1 day',now()+interval '29 days',1000,100,500);
update subscription_accounts set current_period_id='30000000-0000-0000-0000-000000000001';

-- Synthetic files pass through the same public upload RPCs as the UI.
create function subscription_fixture(p_count integer,p_start boolean default true) returns uuid language plpgsql as $$
declare j uuid:=gen_random_uuid();b uuid:=gen_random_uuid();manifest jsonb;p jsonb;t text;i integer;
begin
 insert into jobs(id,workspace_id,title,description) values(j,'00000000-0000-0000-0000-000000000001','Manual QA','Manual regression testing');
 select jsonb_agg(jsonb_build_object('name','Synthetic-'||n||'.txt','size',150)) into manifest from generate_series(0,p_count-1) n;
 perform create_resume_upload(b,j,manifest);
 for i in 0..p_count-1 loop
  t:='Synthetic applicant '||i||'. Owned manual regression testing and documented billing defects.';
  p:=prepare_screening_upload(b,i,t);
  insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
   values('00000000-0000-0000-0000-000000000001',j,(p->>'candidate_id')::uuid,'00000000-0000-0000-0000-000000000001/'||j||'/'||(p->>'candidate_id')||'/source.txt','Synthetic.txt',t);
  perform update_screening_item(b,i,'saved');
 end loop;
 if p_start then perform start_resume_analysis(b);end if;
 return b;
end$$;

create function subscription_rules_fixture(b uuid,p_key text default repeat('a',64),p_billing text default repeat('b',64)) returns void language plpgsql as $$
declare rows jsonb;intel jsonb;
begin
 intel:=jsonb_build_object('status','ready','asOf',current_date::text,'billingKey',p_billing,'rubric',jsonb_build_object('key',p_key));
 loop
  rows:=bulk_screening_page(b,p_key,100);
  exit when jsonb_array_length(rows)=0;
  select jsonb_agg(value||jsonb_build_object('result',jsonb_build_object('candidateId',value->>'candidate_id','rubricKey',p_key,'score',80,'requiredStatus','evidenced'))) into rows from jsonb_array_elements(rows);
  perform save_bulk_screening_page(b,bulk_screening_source(b)->>'sourceVersion',intel,rows);
 end loop;
end$$;

-- Basic ends at rules; a new cache date alone cannot consume another unit.
do $$declare b uuid;count_before integer;begin
 b:=subscription_fixture(2);perform subscription_rules_fixture(b);
 if (select count(*) from subscription_evaluations where state='succeeded')<>2 then raise exception 'Rules results were not metered';end if;
 if not auto_start_resume_analysis(b) or exists(select from resume_intake_tasks where job_id=(select job_id from screening_batches where id=b)) then raise exception 'Basic queued AI';end if;
 perform subscription_rules_fixture(b,repeat('c',64));
 if (select count(*) from subscription_evaluations)<>2 then raise exception 'Cache freshness charged unchanged evidence';end if;
 begin
  perform select_screening_finalists(b,array(select candidate_id from screening_batch_items where batch_id=b),bulk_screening_source(b)->>'sourceVersion',0);
  raise exception 'Basic selected AI finalists';
 exception when insufficient_privilege then null;end;
 if reserve_ai_budget('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',1,1)->>'allowed'<>'false' then raise exception 'Raw admission bypass';end if;
end$$;

-- A page that exceeds the allowance must roll back both its results and usage.
do $$declare b uuid;before_count integer;begin
 select count(*) into before_count from subscription_evaluations where state='succeeded';
 update subscription_periods set rules_limit=before_count+1;
 b:=subscription_fixture(2);
 begin perform subscription_rules_fixture(b);raise exception 'Rules allowance overspent';
 exception when sqlstate 'PT429' then null;end;
 if exists(select from candidate_screening_cache where job_id=(select job_id from screening_batches where id=b))
  or (select count(*) from subscription_evaluations where state='succeeded')<>before_count then raise exception 'Partial page committed after exhaustion';end if;
 update subscription_periods set rules_limit=1000;
 perform subscription_rules_fixture(b);
 -- A weak job may save its review state without spending an evaluation.
 perform save_bulk_screening_page(b,bulk_screening_source(b)->>'sourceVersion','{"status":"needs_review","issues":[]}', '[]');
end$$;

-- Advanced admits only current selected finalists and binds the real actor.
update subscription_accounts set plan_code='advanced-v1';
do $$declare b uuid;claims jsonb;t jsonb;l uuid;r jsonb;call uuid;before_count integer;begin
 b:=subscription_fixture(3);perform subscription_rules_fixture(b);perform auto_start_resume_analysis(b);
 if (select cardinality(selected_ids) from screening_batches where id=b)<>3 then raise exception 'Shortlist was not selected';end if;
 if exists(select from resume_intake_tasks where job_id=(select job_id from screening_batches where id=b) and usage_actor_id is distinct from auth.uid()) then raise exception 'Wrong worker actor';end if;
 claims:=claim_assessment_work('intake',(select job_id from screening_batches where id=b));
 for t in select value from jsonb_array_elements(claims) loop
  l:=(t->>'lease_id')::uuid;
  if begin_assessment_provider(l,gen_random_uuid()) then raise exception 'Provider started without evaluation allowance';end if;
  r:=reserve_subscription_assessment(l,'intake-v1:test-model');
  if r->>'state'<>'reserved' or reserve_subscription_assessment(l,'intake-v1:test-model')->>'reservation_id'<>r->>'reservation_id' then raise exception 'Worker reservation replay failed';end if;
  if reserve_subscription_assessment(l,'intake-v1:changed-model')->>'code'<>'subscription_admission_required' then raise exception 'One lease acquired two evaluations';end if;
  if reserve_subscription_model_budget('00000000-0000-0000-0000-000000000002',auth.uid(),1,1,'assessment',l)->>'allowed'='true' then raise exception 'Foreign workspace budget admitted';end if;
  if reserve_subscription_model_budget('00000000-0000-0000-0000-000000000001',auth.uid(),1,1,'assessment',l)->>'allowed'<>'true' then raise exception 'Bound budget rejected';end if;
  perform reserve_screening_ai(l,'test-model',100,100);
  call:=gen_random_uuid();
  if not begin_assessment_provider(l,call) then raise exception 'Admitted finalist rejected';end if;
  perform end_assessment_provider(l,call);
  if not finish_resume_intake((t->>'candidate_id')::uuid,t->>'revision',l,valid_intake_result()) then raise exception 'Result not saved';end if;
  if not finish_resume_intake((t->>'candidate_id')::uuid,t->>'revision',l,valid_intake_result()) then raise exception 'Lost save acknowledgement charged again';end if;
 end loop;
 if (select count(*) from subscription_evaluations where metric='shortlist_ai' and state='succeeded')<>jsonb_array_length(claims) then raise exception 'Completed evaluations not settled';end if;
 -- Crash before a provider starts: expiry must free allowance for the replacement.
 claims:=claim_assessment_work('intake',(select job_id from screening_batches where id=b));t:=claims->0;l:=(t->>'lease_id')::uuid;
 r:=reserve_subscription_assessment(l,'intake-v1:test-model');
 update assessment_worker_attempts set lease_until=now()-interval '1 second' where lease_id=l;
 perform recover_expired_assessment_work();
 if (select state from subscription_evaluations where id=(r->>'reservation_id')::uuid)<>'released' then raise exception 'Expired unstarted worker leaked allowance';end if;
 update resume_intake_tasks set next_run_at=now() where candidate_id=(t->>'candidate_id')::uuid;
 claims:=claim_assessment_work('intake',(select job_id from screening_batches where id=b));t:=claims->0;l:=(t->>'lease_id')::uuid;
 if reserve_subscription_assessment(l,'intake-v1:test-model')->>'allowed'<>'true' then raise exception 'Replacement worker could not reserve';end if;
 perform reserve_screening_ai(l,'test-model',100,100);call:=gen_random_uuid();perform begin_assessment_provider(l,call);
 perform finish_resume_intake((t->>'candidate_id')::uuid,t->>'revision',l,null,'processing_failed');
 if (select state from subscription_evaluations where id=(r->>'reservation_id')::uuid)<>'uncertain' then raise exception 'Ambiguous call freed allowance';end if;
 if reserve_subscription_assessment(l,'intake-v1:test-model')->>'allowed'='true' then raise exception 'Ambiguous call replay admitted';end if;
 -- Existing verified admin recovery must close the same held allowance.
 update assessment_worker_attempts set deadline=now()-interval '3 minutes' where lease_id=l;
 perform set_config('test.admin','true',false);
 perform recover_direct_ai_request(l,'Synthetic provider outcome verified stopped',true);
 perform set_config('test.admin','false',false);
 if (select state from subscription_evaluations where id=(r->>'reservation_id')::uuid)<>'released' then raise exception 'Admin recovery leaked allowance';end if;
 update resume_intake_tasks set status='cancelled' where candidate_id=(t->>'candidate_id')::uuid;
 -- A renewed period can reuse a persisted result with no provider or new unit.
 update subscription_periods set ends_at=now() where id='30000000-0000-0000-0000-000000000001';
 insert into subscription_periods(id,account_id,starts_at,ends_at,rules_limit,shortlist_ai_limit,deep_ai_limit)
  values('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',now(),now()+interval '30 days',1000,100,500);
 update subscription_accounts set current_period_id='30000000-0000-0000-0000-000000000002';
 t:=claims->0;
 select to_jsonb(q) into t from resume_intake_tasks q where job_id=(select job_id from screening_batches where id=b) and status='ready' limit 1;
 update resume_intake_tasks set status='queued',attempts=0,next_run_at=now() where candidate_id=(t->>'candidate_id')::uuid;
 claims:=claim_assessment_work('intake',(select job_id from screening_batches where id=b));t:=claims->0;l:=(t->>'lease_id')::uuid;
 r:=reserve_subscription_assessment(l,'intake-v1:test-model');
 if r->>'state'<>'cached' or r->'cached_result' is distinct from valid_intake_result() then raise exception 'Saved evaluation was not reused';end if;
 if begin_assessment_provider(l,gen_random_uuid()) then raise exception 'Cached result called provider';end if;
 if not finish_resume_intake((t->>'candidate_id')::uuid,t->>'revision',l,r->'cached_result') then raise exception 'Cached result not saved';end if;
 if exists(select from subscription_evaluations where period_id='30000000-0000-0000-0000-000000000002') then raise exception 'Renewal charged historical result';end if;
end$$;

-- Pro chooses beyond the Advanced shortlist, caps the pool at 500, and cannot
-- use its inherited shortlist capacity to bypass an exhausted deep allowance.
update subscription_accounts set plan_code='pro-v1';
do $$declare b uuid;claims jsonb;a uuid;z uuid;r jsonb;begin
 b:=subscription_fixture(501);perform subscription_rules_fixture(b);perform auto_start_resume_analysis(b);
 if (select cardinality(selected_ids) from screening_batches where id=b)<>500 then raise exception 'Pro did not select its 500-candidate pool';end if;
 if (select count(*) from resume_intake_tasks where job_id=(select job_id from screening_batches where id=b))<>500 then raise exception 'Pro queued outside its pool';end if;
 update subscription_periods set deep_ai_limit=1 where id='30000000-0000-0000-0000-000000000002';
 claims:=claim_assessment_work('intake',(select job_id from screening_batches where id=b));a:=(claims->0->>'lease_id')::uuid;z:=(claims->1->>'lease_id')::uuid;
 if a is null or z is null then raise exception 'Pro claims missing';end if;
 r:=reserve_subscription_assessment(a,'intake-v1:test-model');
 if r->>'allowed'<>'true' then raise exception 'Pro deep evaluation denied';end if;
 if reserve_subscription_assessment(z,'intake-v1:test-model')->>'code'<>'evaluation_allowance_exhausted' then raise exception 'Pro bypassed deep allowance';end if;
 if (select metric from subscription_evaluations where id=(r->>'reservation_id')::uuid)<>'deep_ai' then raise exception 'Pro used an unintended allowance';end if;
 perform finish_assessment_work(a,null,'ai_unavailable');
 if (select state from subscription_evaluations where id=(r->>'reservation_id')::uuid)<>'released' then raise exception 'Definitive failure consumed allowance';end if;
 if reserve_subscription_assessment(z,'intake-v1:test-model')->>'allowed'<>'true' then raise exception 'Failed evaluation did not free capacity';end if;
 perform finish_assessment_work(z,null,'provider_calls_disabled');
 update resume_intake_tasks set status='cancelled' where job_id=(select job_id from screening_batches where id=b);
end$$;

-- Legacy unenrolled users retain their path. A different subscribed initiator
-- owns the batch and every worker, even if the uploader has another plan.
insert into auth.users values('00000000-0000-0000-0000-000000000002');
insert into workspace_members values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
do $$begin
 if reserve_ai_budget('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',1,1)->>'allowed'<>'true' then raise exception 'Unenrolled workflow changed';end if;
 if reserve_ai_budget('00000000-0000-0000-0000-000000000001',null,1,1)->>'allowed'='true' then raise exception 'Missing actor bypassed subscription';end if;
end$$;
insert into subscription_accounts(id,user_id,plan_code,status,source) values
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','advanced-v1','trialing','manual');
insert into subscription_periods(id,account_id,starts_at,ends_at,rules_limit,shortlist_ai_limit,deep_ai_limit) values
 ('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002',now(),now()+interval '30 days',1000,100,0);
update subscription_accounts set current_period_id='30000000-0000-0000-0000-000000000003' where user_id='00000000-0000-0000-0000-000000000002';
do $$declare b uuid;claim jsonb;l uuid;begin
 b:=subscription_fixture(21,false);
 perform set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
 perform start_resume_analysis(b);
 perform set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
 perform start_resume_analysis(b);
 if (select analysis_actor_id from screening_batches where id=b)<>'00000000-0000-0000-0000-000000000002' then raise exception 'Replay stole the billing actor';end if;
 perform subscription_rules_fixture(b);
 -- Workers have no interactive auth.uid().
 perform set_config('test.actor','',false);perform set_config('test.role','service_role',false);
 perform auto_start_resume_analysis(b);
 if (select cardinality(selected_ids) from screening_batches where id=b)<>20 then raise exception 'Advanced exceeded shortlist cap';end if;
 if exists(select from resume_intake_tasks where job_id=(select job_id from screening_batches where id=b) and usage_actor_id<>'00000000-0000-0000-0000-000000000002') then raise exception 'Worker charged uploader instead of initiator';end if;
 claim:=claim_assessment_work('intake',(select job_id from screening_batches where id=b))->0;l:=(claim->>'lease_id')::uuid;
 if reserve_subscription_assessment(l,'intake-v1:test-model')->>'actor_id'<>'00000000-0000-0000-0000-000000000002' then raise exception 'Reservation used the wrong subscriber';end if;
 perform set_config('test.role','authenticated',false);
 perform set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
end$$;

set role authenticated;
do $$declare fn text;s jsonb;begin
 s:=get_my_subscription();
 if s->>'tier'<>'advanced' or s#>>'{usage,rules,used}'<>'21' or s#>>'{usage,shortlist_ai,pending}'<>'1' then raise exception 'Usage summary mixed accounts or omitted reservations';end if;
 if exists(select from subscription_accounts where user_id<>auth.uid()) or exists(select from subscription_evaluations where account_id<>'20000000-0000-0000-0000-000000000002') then raise exception 'Subscription RLS leaked another user';end if;
 foreach fn in array array['reserve_subscription_assessment(uuid,text)','save_subscription_rules_results(uuid,uuid,text,jsonb,jsonb)','subscription_base_save_bulk_page(uuid,text,jsonb,jsonb)','subscription_base_start_analysis(uuid)','subscription_base_auto_analysis(uuid)','subscription_base_ai_budget(uuid,uuid,integer,integer)','subscription_base_finish_assessment_work(uuid,jsonb,text)','subscription_base_begin_provider(uuid,uuid)','subscription_base_release_work(uuid,boolean)','reconcile_subscription_worker_state()'] loop
  if has_function_privilege('authenticated',fn,'execute') or has_function_privilege('anon',fn,'execute') then raise exception 'Internal operation exposed: %',fn;end if;
 end loop;
 if has_table_privilege('authenticated','subscription_evaluation_outputs','select') or has_table_privilege('authenticated','subscription_worker_reservations','select,insert,update,delete') then raise exception 'Worker accounting exposed';end if;
end$$;
reset role;

-- Source-bound direct saves execute as the real service role, while user reads
-- stay under RLS. Scope and stale-document failures cannot write or bill.
grant select,update on public.jobs,public.candidates,public.candidate_documents to service_role;
set test.actor='00000000-0000-0000-0000-000000000002';
create table subscription_direct_fixture as select subscription_fixture(1) as batch;
grant select on subscription_direct_fixture to service_role;
set test.actor='';
set test.role='service_role';
set role service_role;
do $$declare b uuid;j uuid;source text;rows jsonb;intel jsonb;before_count integer;l uuid;r jsonb;begin
 select batch into b from subscription_direct_fixture;select job_id into j from screening_batches where id=b;
 source:=subscription_rules_source(j,'00000000-0000-0000-0000-000000000002');
 rows:=bulk_screening_page(b,repeat('e',64),100);
 select jsonb_agg(value||jsonb_build_object('result',jsonb_build_object('candidateId',value->>'candidate_id','rubricKey',repeat('e',64),'score',80,'requiredStatus','evidenced'))) into rows from jsonb_array_elements(rows);
 intel:=jsonb_build_object('status','ready','billingKey',repeat('b',64),'rubric',jsonb_build_object('key',repeat('e',64)));
 begin perform save_subscription_rules_results(j,'00000000-0000-0000-0000-000000000002','stale',intel,rows);raise exception 'Stale direct source accepted';exception when sqlstate 'PT409' then null;end;
 begin perform save_subscription_rules_results(j,'00000000-0000-0000-0000-000000000002',source,intel,jsonb_set(rows,'{0,resume_hash}',to_jsonb(repeat('f',64))));raise exception 'Changed document accepted';exception when sqlstate 'PT409' then null;end;
 if not save_subscription_rules_results(j,'00000000-0000-0000-0000-000000000002',source,intel,rows) then raise exception 'Direct result rejected';end if;
 if not save_subscription_rules_results(j,'00000000-0000-0000-0000-000000000002',source,intel,rows) then raise exception 'Direct replay rejected';end if;
 if (select count(*) from subscription_evaluations where account_id='20000000-0000-0000-0000-000000000002' and metric='rules')<>22 then raise exception 'Direct result billed incorrectly';end if;
 select m.lease_id into l from subscription_worker_reservations m join assessment_worker_attempts a using(lease_id) where m.actor_id='00000000-0000-0000-0000-000000000002' and a.state='reserved' limit 1;
 r:=reserve_subscription_assessment(l,'intake-v1:test-model');
 if r->>'allowed'<>'true' then raise exception 'Service role could not reenter admitted work';end if;
end$$;
reset role;
