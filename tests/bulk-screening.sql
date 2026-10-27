\set ON_ERROR_STOP on
\ir durable-worker-recovery.sql
create function public.preserve_record_creator() returns trigger language plpgsql as $$begin return new;end$$;
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
 begin perform update_screening_budget('b0000000-0000-0000-0000-000000000001',2);raise exception 'Foreign budget update accepted';exception when insufficient_privilege then null;end;
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
 -- Exercise the terminal failure after the existing worker's bounded retries.
 update resume_intake_tasks set attempts=3 where candidate_id=cid;
 perform finish_resume_intake(cid,rev,lease,null,'screening_budget_limit');
 if screening_batch_snapshot(b)#>>'{candidates,0,assessment,status}'<>'failed' then raise exception 'Budget failure lost';end if;
 perform select_screening_finalists(b,array[cid],s->>'sourceVersion',1);
 claimed:=claim_assessment_work('intake',null);lease:=(claimed->0->>'lease_id')::uuid;rev:=claimed->0->>'revision';
 if lease is null then raise exception 'Explicit retry did not recover budget-blocked finalist';end if;
 if reserve_screening_ai(lease,'test-model',300000,16000)->>'code'<>'screening_budget_limit' then raise exception 'Retry bypassed unchanged budget';end if;
 begin perform update_screening_budget(b,0.5);raise exception 'Budget decreased';exception when invalid_parameter_value then null;end;
 begin perform update_screening_budget(b,101);raise exception 'Maximum budget bypassed';exception when invalid_parameter_value then null;end;
 perform update_screening_budget(b,2);perform update_screening_budget(b,2);
 if (select count(*) from screening_ai_charges where batch_id=b)<>1 then raise exception 'Budget edit made a model reservation';end if;
 if reserve_screening_ai(lease,'test-model',300000,16000)->>'allowed'<>'true' then raise exception 'Raised budget did not admit retry';end if;
 call:=gen_random_uuid();
 if not begin_assessment_provider(lease,call) then raise exception 'Retry provider fence rejected valid work';end if;
 perform record_screening_ai_usage(lease,'{"id":"synthetic-response-retry","model":"test-model","usage":{"input_tokens":1000,"output_tokens":200}}');
 perform end_assessment_provider(lease,call);
 if reserve_screening_ai(lease,'test-model',1,1)->>'code'<>'screening_budget_limit' then raise exception 'Raised budget bypassed per-candidate call limit';end if;
 perform finish_resume_intake(cid,rev,lease,'{"score":8,"manager_score":8,"resume_evidence":[],"context_signature":"synthetic"}',null);
 if screening_batch_snapshot(b)#>>'{candidates,0,assessment,status}'<>'ready' then raise exception 'Deep result missing';end if;
 perform select_screening_finalists(b,array[cid],s->>'sourceVersion',2);
 if exists(select from resume_intake_tasks where candidate_id=cid and status<>'ready') then raise exception 'Cached assessment requeued';end if;
 update jobs set manager_feedback='Changed approved hiring priority' where id=(select job_id from screening_batches where id=b);
 if resume_intake_input(cid) is not null then raise exception 'Source edit reused obsolete approval';end if;
 if exists(select from job_reassessment_tasks where candidate_id=cid and status='queued') or exists(select from resume_intake_tasks where candidate_id=cid and status='queued') then raise exception 'Source edit triggered paid bulk fanout';end if;
 if screening_batch_snapshot(b)->>'source_current'<>'false' then raise exception 'Changed source shown as current';end if;
 if exists(select from screening_finalists where candidate_id=cid) then raise exception 'Stale finalist consent retained';end if;
 update jobs set manager_feedback='' where id=(select job_id from screening_batches where id=b);
 if exists(select from resume_intake_tasks where candidate_id=cid and status='queued') then raise exception 'Reverted edit silently restarted AI';end if;
end $$;

-- Full evidence is bounded without dropping candidates or unprocessed records.
insert into jobs(id,workspace_id,title,description) values('f0000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','Manual QA snapshot','Manual regression testing');
do $$declare b uuid:='b0000000-0000-0000-0000-000000000002';j uuid:='f0000000-0000-0000-0000-000000000012';manifest jsonb;prepared jsonb;rows jsonb;payload jsonb;snapshot jsonb;source text;i integer;begin
 select jsonb_agg(jsonb_build_object('name','Synthetic-'||n||'.txt','size',100)) into manifest from generate_series(0,59) n;
 perform create_screening_batch(b,j,manifest,1);
 for i in 0..59 loop
  payload:=to_jsonb('Synthetic snapshot record '||i||'. Owned manual testing and reproduced defects in billing systems.');
  prepared:=prepare_screening_upload(b,i,payload#>>'{}');
  insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
   values('00000000-0000-0000-0000-000000000001',j,(prepared->>'candidate_id')::uuid,'00000000-0000-0000-0000-000000000001/'||j||'/'||(prepared->>'candidate_id')||'/source.txt','Synthetic.txt',payload#>>'{}');
  perform update_screening_item(b,i,'saved');
 end loop;
 perform seal_screening_batch(b);
 source:=bulk_screening_source(b)->>'sourceVersion';rows:=bulk_screening_page(b,repeat('b',64),100);
 select jsonb_agg(value||jsonb_build_object('result',jsonb_build_object('candidateId',value->>'candidate_id','rubricKey',repeat('b',64),'score',100-n,'requiredStatus','conflicting','findings',jsonb_build_array(jsonb_build_object('title','Synthetic finding'))))) into rows
 from jsonb_array_elements(rows) with ordinality a(value,n) where n<=55;
 if not save_bulk_screening_page(b,source,jsonb_build_object('status','ready','asOf',current_date::text,'rubric',jsonb_build_object('key',repeat('b',64))),rows) then raise exception 'Snapshot fixture rejected';end if;
 snapshot:=screening_batch_snapshot(b);
 if jsonb_array_length(snapshot->'candidates')<>60 then raise exception 'Compact snapshot dropped candidates';end if;
 if (select count(*) from jsonb_array_elements(snapshot->'candidates') r where (r->'result')?'findings')<>40 then raise exception 'Snapshot did not bound full evidence';end if;
 if (select count(*) from jsonb_array_elements(snapshot->'candidates') r where r->'result'='null'::jsonb)<>5 then raise exception 'Unprocessed candidates received fabricated scores';end if;
 if (select count(*) from jsonb_array_elements(snapshot->'candidates') r where (r->'result')?'rubricKey')<>55 then raise exception 'Brief scores lost their rubric binding';end if;
end $$;

reset role;
\ir ../supabase/migrations/20261027140859_unified_resume_screening.sql
\ir ../supabase/migrations/20261027140859_unified_resume_screening.sql
insert into jobs(id,workspace_id,title,description) values('f0000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','Unified upload','Manual regression testing');
set test.role='authenticated';
set role authenticated;
select create_resume_upload('b0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000013','[{"name":"One.txt","size":150}]');
select append_resume_upload('b0000000-0000-0000-0000-000000000003',1,'[{"name":"Remove.txt","size":150},{"name":"Retry.txt","size":150}]');
select append_resume_upload('b0000000-0000-0000-0000-000000000003',1,'[{"name":"Remove.txt","size":150},{"name":"Retry.txt","size":150}]');
do $$declare b uuid:='b0000000-0000-0000-0000-000000000003';p jsonb;i integer;text_value text;begin
 if (select count(*) from screening_batch_items where batch_id=b)<>3 then raise exception 'Manifest replay duplicated files';end if;
 begin perform append_resume_upload(b,1,'[{"name":"Unexpected.txt","size":150}]');raise exception 'Conflicting append accepted';exception when sqlstate 'PT409' then null;end;
 for i in 0..1 loop
  text_value:='Synthetic unified applicant '||i||'. Owned manual testing and documented defects in billing systems.';
  p:=prepare_screening_upload(b,i,text_value);
  insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text) values('00000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000013',(p->>'candidate_id')::uuid,'00000000-0000-0000-0000-000000000001/f0000000-0000-0000-0000-000000000013/'||(p->>'candidate_id')||'/source.txt','Synthetic.txt',text_value);
  perform update_screening_item(b,i,'saved');
 end loop;
 perform update_screening_item(b,1,'excluded');
 perform update_screening_item(b,2,'failed');
 begin perform start_resume_analysis(b);raise exception 'Analysis accepted unfinished uploads';exception when sqlstate 'PT409' then null;end;
 begin perform seal_screening_batch(b);raise exception 'Old seal bypassed explicit start';exception when sqlstate 'PT409' then null;end;
 if exists(select from resume_intake_tasks where job_id='f0000000-0000-0000-0000-000000000013') then raise exception 'Upload started analysis';end if;
 if (select worker_requested_at is not null or analysis_requested_at is not null or sealed from screening_batches where id=b) then raise exception 'Draft was queued or sealed';end if;
end $$;
set test.workspace='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform start_resume_analysis('b0000000-0000-0000-0000-000000000003');raise exception 'Foreign start accepted';exception when insufficient_privilege then null;end;
 begin perform append_resume_upload('b0000000-0000-0000-0000-000000000003',3,'[{"name":"Foreign.txt","size":150}]');raise exception 'Foreign append accepted';exception when insufficient_privilege then null;end;
end $$;
set test.workspace='00000000-0000-0000-0000-000000000001';
select update_screening_item('b0000000-0000-0000-0000-000000000003',2,'excluded');
select start_resume_analysis('b0000000-0000-0000-0000-000000000003');
select start_resume_analysis('b0000000-0000-0000-0000-000000000003');
do $$begin
 begin perform append_resume_upload('b0000000-0000-0000-0000-000000000003',3,'[{"name":"Late.txt","size":150}]');raise exception 'Append after start accepted';exception when sqlstate 'PT409' then null;end;
 begin perform update_screening_item('b0000000-0000-0000-0000-000000000003',0,'excluded');raise exception 'Removal after start accepted';exception when invalid_parameter_value then null;end;
 if has_function_privilege('authenticated','public.auto_start_resume_analysis(uuid)','execute') then raise exception 'Client can choose automatic finalists';end if;
end $$;
reset role;
set test.role='service_role';
set role service_role;
do $$declare b uuid:='b0000000-0000-0000-0000-000000000003';rows jsonb;source text;begin
 if auto_start_resume_analysis(b) then raise exception 'Incomplete rules admitted paid work';end if;
 source:=bulk_screening_source(b)->>'sourceVersion';rows:=bulk_screening_page(b,repeat('c',64),100);
 select jsonb_agg(value||jsonb_build_object('result',jsonb_build_object('candidateId',value->>'candidate_id','rubricKey',repeat('c',64),'score',85,'requiredStatus','evidenced','findings',jsonb_build_array(jsonb_build_object('title','Manual testing'))))) into rows from jsonb_array_elements(rows);
 perform save_bulk_screening_page(b,source,jsonb_build_object('status','ready','asOf',current_date::text,'rubric',jsonb_build_object('key',repeat('c',64))),rows);
 if not auto_start_resume_analysis(b) then raise exception 'Explicit request did not continue in background';end if;
 if auto_start_resume_analysis(b) then raise exception 'Replay restarted analysis';end if;
 if (select cardinality(selected_ids)<>1 or selection_version<>1 or not auto_selected from screening_batches where id=b) then raise exception 'Removed resumes were selected or replay changed selection';end if;
 if (select count(*) from resume_intake_tasks where job_id='f0000000-0000-0000-0000-000000000013' and status='queued')<>1 then raise exception 'Wrong analysis count';end if;
end $$;
reset role;
set test.role='authenticated';
set role authenticated;
do $$declare c uuid;v jsonb;begin
 select candidate_id into c from screening_batch_items where batch_id='b0000000-0000-0000-0000-000000000003' and ordinal=0;
 v:=get_resume_analysis(c);
 if v->>'stored'<>'true' or v#>>'{rules,findings,0,title}'<>'Manual testing' or v#>>'{assessment,status}'<>'queued' then raise exception 'Shared candidate review lost source or evidence';end if;
 perform set_config('test.workspace','00000000-0000-0000-0000-000000000002',true);
 begin perform get_resume_analysis(c);raise exception 'Foreign candidate evidence exposed';exception when insufficient_privilege then null;end;
end $$;
