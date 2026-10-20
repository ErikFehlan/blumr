\set ON_ERROR_STOP on
\ir durable-worker-recovery.sql
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('test.role',true),''),'authenticated')$$;
create table public.ai_model_rates(model text primary key,input_usd_per_million numeric,cached_input_usd_per_million numeric,output_usd_per_million numeric,updated_at timestamptz default now());
grant select on public.ai_model_rates to service_role;
create function public.hiring_priorities_for_job(p_job uuid) returns jsonb language sql as $$select jsonb_build_object('source_title',title,'source_description',description,'items',jsonb_build_array(jsonb_build_object('id','p1','title','Manual testing','reason','Owned manual regression testing','question','What testing did you own?'))) from public.jobs where id=p_job$$;
create function public.assessment_lessons_for_job(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
\ir ../supabase/migrations/20261019115657_screening_foundation_cache.sql
create function public.get_account_export() returns jsonb language sql as $$select '{}'::jsonb$$;
\ir ../supabase/migrations/20261020115320_bulk_screening_workflow.sql
\ir ../supabase/migrations/20261020115320_bulk_screening_workflow.sql
truncate public.assessment_worker_attempts,public.resume_intake_tasks,public.job_reassessment_tasks;
update public.screening_feature_config set enabled=true;
insert into public.ai_model_rates(model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million) values('test-model',1,0.5,2);
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.role='authenticated';
set test.actor='00000000-0000-0000-0000-000000000001';
insert into jobs(id,workspace_id,title,description) values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','Manual QA','Manual regression testing');
set role authenticated;
select create_screening_batch('b0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','[{"name":"Synthetic.txt","size":150},{"name":"Copy.txt","size":150},{"name":"Broken.pdf","size":500}]',1);
select create_screening_batch('b0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','[{"name":"Synthetic.txt","size":150},{"name":"Copy.txt","size":150},{"name":"Broken.pdf","size":500}]',1);
select prepare_screening_upload('b0000000-0000-0000-0000-000000000001',0,'Synthetic Applicant. Owned manual regression testing and documented defects in billing systems.');
select prepare_screening_upload('b0000000-0000-0000-0000-000000000001',1,'Synthetic Applicant. Owned manual regression testing and documented defects in billing systems.');
reset role;
do $$begin
 if (select count(distinct candidate_id) from screening_batch_items where batch_id='b0000000-0000-0000-0000-000000000001')<>1 then raise exception 'Duplicate candidate created';end if;
 if exists(select from resume_intake_tasks t join screening_managed_candidates m using(candidate_id)) then raise exception 'Upload queued paid work';end if;
end $$;
grant insert on public.candidate_documents to authenticated;
set role authenticated;
insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
 select workspace_id,job_id,candidate_id,workspace_id||'/'||job_id||'/'||candidate_id||'/source.txt','Synthetic.txt','Synthetic Applicant. Owned manual regression testing and documented defects in billing systems.' from screening_batch_items where ordinal=0 and batch_id='b0000000-0000-0000-0000-000000000001';
set role authenticated;
select update_screening_item('b0000000-0000-0000-0000-000000000001',0,'saved');
select update_screening_item('b0000000-0000-0000-0000-000000000001',1,'saved');
do $$begin
 begin perform seal_screening_batch('b0000000-0000-0000-0000-000000000001');raise exception 'Incomplete import finalized';exception when sqlstate 'PT409' then null;end;
end $$;
select update_screening_item('b0000000-0000-0000-0000-000000000001',2,'failed');
select update_screening_item('b0000000-0000-0000-0000-000000000001',2,'excluded');
select seal_screening_batch('b0000000-0000-0000-0000-000000000001');
reset role;
set role service_role;
do $$declare first jsonb;begin
 first:=next_screening_batches('00000000-0000-0000-0000-000000000011');
 if jsonb_array_length(first)<>1 then raise exception 'Background batch was not claimed';end if;
 if next_screening_batches('00000000-0000-0000-0000-000000000011')<>'[]'::jsonb then raise exception 'Concurrent worker reclaimed the same batch';end if;
end $$;
reset role;
update screening_batches set worker_claimed_at=now()-interval '3 minutes';
set role service_role;
do $$begin
 if jsonb_array_length(next_screening_batches('00000000-0000-0000-0000-000000000011'))<>1 then raise exception 'Interrupted background batch did not recover';end if;
end $$;
reset role;
set role authenticated;
set test.workspace='00000000-0000-0000-0000-000000000002';
do $$begin
 if exists(select from screening_batches) then raise exception 'Workspace isolation failed';end if;
 begin perform screening_batch_snapshot('b0000000-0000-0000-0000-000000000001');raise exception 'Foreign snapshot accepted';exception when insufficient_privilege then null;end;
 begin perform prepare_screening_upload('b0000000-0000-0000-0000-000000000001',0,'Private foreign candidate text with enough characters');raise exception 'Foreign write accepted';exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','save_bulk_screening_page(uuid,text,jsonb,jsonb)','execute') or has_function_privilege('authenticated','reserve_screening_ai(uuid,text,integer,integer)','execute') then raise exception 'Worker operation exposed';end if;
end $$;
reset role;
set test.workspace='00000000-0000-0000-0000-000000000001';
do $$declare b uuid:='b0000000-0000-0000-0000-000000000001';s jsonb;rows jsonb;intel jsonb;cid uuid;claimed jsonb;lease uuid;call uuid:=gen_random_uuid();rev text;begin
 s:=bulk_screening_source(b);rows:=bulk_screening_page(b,repeat('a',64));cid:=(rows->0->>'candidate_id')::uuid;
 intel:=jsonb_build_object('status','ready','asOf',current_date::text,'rubric',jsonb_build_object('key',repeat('a',64)));
 rows:=jsonb_build_array((rows->0)||jsonb_build_object('result',jsonb_build_object('candidateId',cid,'rubricKey',repeat('a',64),'score',100,'requiredStatus','evidenced')));
 if save_bulk_screening_page(b,'stale',intel,rows) then raise exception 'Stale source write accepted';end if;
 if not save_bulk_screening_page(b,s->>'sourceVersion',intel,rows) then raise exception 'Current page refused';end if;
 if exists(select from resume_intake_tasks where candidate_id=cid and status='queued') then raise exception 'Rules scoring queued AI';end if;
 perform select_screening_finalists(b,array[cid],s->>'sourceVersion',0);
 perform select_screening_finalists(b,array[cid],s->>'sourceVersion',0); -- lost acknowledgement
 claimed:=claim_assessment_work('intake',null);lease:=(claimed->0->>'lease_id')::uuid;rev:=claimed->0->>'revision';
 if lease is null then raise exception 'Selected finalist not claimable';end if;
 if begin_assessment_provider(lease,call) then raise exception 'Provider started without batch budget';end if;
 if reserve_screening_ai(lease,'missing-model',1000,1000)->>'code'<>'screening_model_rate_missing' then raise exception 'Unknown rate allowed';end if;
 if reserve_screening_ai(lease,'test-model',300000,16000)->>'allowed'<>'true' then raise exception 'Valid reservation refused';end if;
 if reserve_screening_ai(lease,'test-model',300000,16000)->>'allowed'<>'true' or (select count(*) from screening_ai_charges)<>1 then raise exception 'Reservation replay charged again';end if;
 if not begin_assessment_provider(lease,call) or begin_assessment_provider(lease,call) then raise exception 'Provider fence failed';end if;
 perform record_screening_ai_usage(lease,'{"id":"synthetic-response","model":"test-model","usage":{"input_tokens":1000,"output_tokens":200,"input_tokens_details":{"cached_tokens":400,"cache_write_tokens":100}}}');
 if (select actual_usd from screening_ai_charges where lease_id=lease)<>0.001225 then raise exception 'Cache-write cost was omitted';end if;
 perform end_assessment_provider(lease,call);
 if reserve_screening_ai(lease,'test-model',300000,16000)->>'code'<>'screening_budget_limit' then raise exception 'Batch budget exceeded';end if;
 perform finish_resume_intake(cid,rev,lease,'{"score":8,"manager_score":8,"resume_evidence":[],"context_signature":"synthetic"}',null);
 if screening_batch_snapshot(b)#>>'{candidates,0,assessment,status}'<>'ready' then raise exception 'Deep result missing';end if;
 perform select_screening_finalists(b,array[cid],s->>'sourceVersion',1);
 if exists(select from resume_intake_tasks where candidate_id=cid and status<>'ready') then raise exception 'Cached assessment requeued';end if;
 update jobs set manager_feedback='Changed approved hiring priority' where id=(select job_id from screening_batches where id=b);
 if resume_intake_input(cid) is not null then raise exception 'Source edit reused obsolete approval';end if;
 if exists(select from job_reassessment_tasks where candidate_id=cid and status='queued') or exists(select from resume_intake_tasks where candidate_id=cid and status='queued') then raise exception 'Source edit triggered paid bulk fanout';end if;
 if screening_batch_snapshot(b)->>'source_current'<>'false' then raise exception 'Changed source shown as current';end if;
 if exists(select from screening_finalists where candidate_id=cid) then raise exception 'Stale finalist consent retained';end if;
 update jobs set manager_feedback='' where id=(select job_id from screening_batches where id=b);
 if exists(select from resume_intake_tasks where candidate_id=cid and status='queued') then raise exception 'Reverted edit silently restarted AI';end if;
end $$;
