\set ON_ERROR_STOP on
-- Preserve and exercise the released flow before upgrading its permissions.
\ir bulk-screening.sql
create temp table budgets_before_governance as select id,budget_usd from screening_batches;
\ir ../supabase/migrations/20261026181357_screening_budget_governance.sql
\ir ../supabase/migrations/20261026181357_screening_budget_governance.sql
do $$begin
 if exists(select from budgets_before_governance p join screening_batches b using(id) where p.budget_usd<>b.budget_usd) then raise exception 'Migration rewrote existing budgets';end if;
 if has_function_privilege('anon','public.create_screening_batch(uuid,uuid,jsonb,numeric)','execute') or has_function_privilege('anon','public.update_screening_budget(uuid,numeric)','execute') then raise exception 'Anonymous budget API exposed';end if;
 if has_table_privilege('authenticated','screening_batches','update,insert') then raise exception 'Direct budget writes exposed';end if;
end $$;
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='00000000-0000-0000-0000-000000000001';
set test.role='authenticated';
set test.admin='false';
set role authenticated;
do $$declare b uuid:='b0000000-0000-0000-0000-000000000003';j uuid:='00000000-0000-0000-0000-000000000011';m jsonb:='[{"name":"Governance.txt","size":100}]';begin
 perform create_screening_batch(b,j,m,100);
 if (select budget_usd from screening_batches where id=b)<>5 then raise exception 'Client raised initial cap';end if;
 perform create_screening_batch(b,j,m,null);
 perform create_screening_batch(b,j,m,0.01);
 perform create_screening_batch('b0000000-0000-0000-0000-000000000004',j,m);
 if (select budget_usd from screening_batches where id='b0000000-0000-0000-0000-000000000004')<>5 then raise exception 'Omitted budget did not use server default';end if;
 begin perform update_screening_budget(b,100);raise exception 'Member raised saved cap';exception when insufficient_privilege then null;end;
 begin update screening_batches set budget_usd=100 where id=b;raise exception 'Direct budget mutation accepted';exception when insufficient_privilege then null;end;
 begin perform create_screening_batch(b,j,'[{"name":"Different.txt","size":100}]',5);raise exception 'Conflicting replay accepted';exception when sqlstate 'PT409' then null;end;
 if exists(select from screening_ai_charges where batch_id=b) then raise exception 'Batch creation started paid work';end if;
end $$;
reset role;
create temp table queues_before_budget as select candidate_id,status,revision from resume_intake_tasks;
set test.admin='true';
set role authenticated;
do $$declare b uuid:='b0000000-0000-0000-0000-000000000003';begin
 if update_screening_budget(b,6)<>6 or update_screening_budget(b,6)<>6 then raise exception 'Scoped administrator update failed';end if;
 begin perform update_screening_budget(b,5);raise exception 'Administrator decreased cap';exception when invalid_parameter_value then null;end;
 begin perform update_screening_budget(b,101);raise exception 'Administrator bypassed ceiling';exception when invalid_parameter_value then null;end;
 begin perform update_screening_budget(b,null);raise exception 'Null cap accepted';exception when invalid_parameter_value then null;end;
 begin perform update_screening_budget(b,'NaN'::numeric);raise exception 'NaN cap accepted';exception when invalid_parameter_value then null;end;
end $$;
set test.admin='false';
select create_screening_batch('b0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000011','[{"name":"Governance.txt","size":100}]',100);
do $$begin
 if (select budget_usd from screening_batches where id='b0000000-0000-0000-0000-000000000003')<>6 then raise exception 'Replay reset administrator cap';end if;
end $$;
set test.admin='true';
set test.workspace='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform update_screening_budget('b0000000-0000-0000-0000-000000000003',10);raise exception 'Foreign administrator raised cap';exception when insufficient_privilege then null;end;
 begin perform create_screening_batch('b0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000011','[{"name":"Foreign.txt","size":100}]',100);raise exception 'Foreign job accepted';exception when insufficient_privilege then null;end;
end $$;
set test.workspace='00000000-0000-0000-0000-000000000001';
set test.actor='';
do $$begin
 begin perform update_screening_budget('b0000000-0000-0000-0000-000000000003',10);raise exception 'Missing authenticated identity accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
set role anon;
do $$begin
 begin perform update_screening_budget('b0000000-0000-0000-0000-000000000003',10);raise exception 'Anonymous update accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if exists((select candidate_id,status,revision from resume_intake_tasks except select * from queues_before_budget) union all (select * from queues_before_budget except select candidate_id,status,revision from resume_intake_tasks)) then raise exception 'Budget administration changed assessment work';end if;
 if exists(select from screening_ai_charges where batch_id in ('b0000000-0000-0000-0000-000000000003','b0000000-0000-0000-0000-000000000004')) then raise exception 'Budget administration started paid work';end if;
end $$;

-- Existing reservation controls still reject an over-cap attempt after upgrade.
set test.actor='00000000-0000-0000-0000-000000000001';
set test.admin='false';
truncate assessment_worker_attempts,resume_intake_tasks,job_reassessment_tasks;
do $$declare b uuid:='b0000000-0000-0000-0000-000000000004';p jsonb;s jsonb;rows jsonb;cid uuid;lease uuid;begin
 p:=prepare_screening_upload(b,0,'Synthetic governance applicant. Owned manual regression testing and documented defects.');cid:=(p->>'candidate_id')::uuid;
 insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
 values('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011',cid,'00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000011/'||cid||'/source.txt','Governance.txt','Synthetic governance applicant. Owned manual regression testing and documented defects.');
 perform update_screening_item(b,0,'saved');perform seal_screening_batch(b);
 s:=bulk_screening_source(b);rows:=bulk_screening_page(b,repeat('c',64));
 rows:=jsonb_build_array((rows->0)||jsonb_build_object('result',jsonb_build_object('candidateId',cid,'rubricKey',repeat('c',64),'score',100,'requiredStatus','evidenced')));
 perform save_bulk_screening_page(b,s->>'sourceVersion',jsonb_build_object('status','ready','asOf',current_date::text,'rubric',jsonb_build_object('key',repeat('c',64))),rows);
 perform select_screening_finalists(b,array[cid],s->>'sourceVersion',0);
 lease:=(claim_assessment_work('intake',null)->0->>'lease_id')::uuid;
 if lease is null then raise exception 'Finalist was not claimable after governance upgrade';end if;
 insert into ai_model_rates(model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million) values('over-cap-model',10,5,20);
 if reserve_screening_ai(lease,'over-cap-model',300000,16000)->>'code'<>'screening_budget_limit' then raise exception 'Server cap was bypassed';end if;
 if reserve_screening_ai(lease,'missing-model',1000,1000)->>'code'<>'screening_model_rate_missing' then raise exception 'Missing rates admitted work';end if;
 if reserve_screening_ai(lease,'test-model',1000,1000)->>'allowed'<>'true' then raise exception 'Valid capped work was blocked';end if;
 perform reserve_screening_ai(lease,'test-model',1000,1000);
 if (select count(*) from screening_ai_charges where lease_id=lease)<>1 then raise exception 'Reservation replay charged twice';end if;
end $$;
